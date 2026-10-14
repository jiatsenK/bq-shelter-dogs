// #219 私有封存／SQL 演練入口。不含正式 D1 連線或自動部署。
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateBusinessDatabase } from './migrate-business-db.mjs';
import { migrateIdentities } from './migrate-identities.mjs';
import { migrateHistory } from './migrate-history.mjs';
import { migrateProfiles } from './migrate-profiles.mjs';
import { readProfileSources } from './check-profiles.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identifier = value => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error('非法 SQL 名稱');
  return `"${value}"`;
};
const normalizeSql = sql => sql.trim().replace(/\s+/g, ' ').replace(/;$/, '');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const canonicalRows = rows => rows.map(row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => compare(a, b)))).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
const allowedTable = name => /^v2_[a-z_]+$/.test(name) || ['walker_names', 'kv'].includes(name);

function orderedTables(schema) {
  const ordered = [], visiting = new Set();
  const tables = new Map(schema.filter(s => s.type === 'table').map(s => [s.name, s]));
  const visit = name => {
    if (ordered.includes(name)) return;
    if (visiting.has(name)) throw new Error('封存資料表外鍵循環');
    visiting.add(name);
    for (const match of tables.get(name).sql.matchAll(/REFERENCES\s+"?([a-zA-Z_][a-zA-Z0-9_]*)/gi)) if (tables.has(match[1]) && match[1] !== name) visit(match[1]);
    visiting.delete(name); ordered.push(name);
  };
  for (const name of tables.keys()) visit(name);
  return ordered;
}
const orderedSchema = schema => [...orderedTables(schema).map(name => schema.find(s => s.type === 'table' && s.name === name)), ...schema.filter(s => s.type === 'index')];

export async function captureDatabase(db) {
  const schema = (await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL ORDER BY type DESC,name").all()).results.filter(row => allowedTable(row.tbl_name)).map(row => ({ ...row, sql: normalizeSql(row.sql) }));
  const tables = {};
  for (const name of orderedTables(schema)) tables[name] = canonicalRows((await db.prepare(`SELECT * FROM ${identifier(name)}`).all()).results);
  const content = { version: 1, schema, tables };
  return { ...content, fingerprint: hash(content) };
}

function validateArchive(archive) {
  const { version, schema, tables, fingerprint } = archive;
  if (version !== 1 || hash({ version, schema, tables }) !== fingerprint) throw new Error('封存指紋不符，停止還原');
  if (schema.some(s => !allowedTable(s.tbl_name)) || Object.keys(tables).some(t => !allowedTable(t))) throw new Error('封存包含非演練資料表');
}

export async function restoreDatabase(db, archive) {
  validateArchive(archive);
  await db.batch(orderedSchema(archive.schema).map(s => db.prepare(s.sql.replace(/^CREATE (TABLE|(?:UNIQUE )?INDEX) /, 'CREATE $1 IF NOT EXISTS '))));
  const statements = [db.prepare('PRAGMA defer_foreign_keys=ON')];
  for (const [table, rows] of Object.entries(archive.tables)) for (const row of rows) {
    const columns = Object.keys(row);
    statements.push(db.prepare(`INSERT OR IGNORE INTO ${identifier(table)} (${columns.map(identifier)}) VALUES (${columns.map(() => '?')})`).bind(...Object.values(row)));
  }
  await db.batch(statements);
  return verifyDatabase(db, archive);
}

export async function verifyDatabase(db, archive) {
  validateArchive(archive);
  if ((await db.prepare('PRAGMA foreign_key_check').all()).results.length) throw new Error('外鍵檢核非零列');
  if ((await db.prepare('PRAGMA integrity_check').first('integrity_check')) !== 'ok') throw new Error('SQLite 完整性檢核失敗');
  const actual = await captureDatabase(db);
  if (actual.fingerprint !== archive.fingerprint) throw new Error('逐表逐筆核對不一致');
  return { tables: Object.keys(actual.tables).length, rows: Object.values(actual.tables).reduce((n, rows) => n + rows.length, 0), identical: true };
}

const literal = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `CAST(X'${Buffer.from(String(value), 'utf8').toString('hex')}' AS TEXT)`;
export function archiveSql(archive) {
  validateArchive(archive);
  const lines = ['PRAGMA defer_foreign_keys=ON;'];
  for (const s of orderedSchema(archive.schema)) lines.push(`${s.sql.replace(/^CREATE (TABLE|(?:UNIQUE )?INDEX) /, 'CREATE $1 IF NOT EXISTS ')};`);
  for (const [table, rows] of Object.entries(archive.tables)) for (const row of rows) lines.push(`INSERT OR IGNORE INTO ${identifier(table)} (${Object.keys(row).map(identifier)}) VALUES (${Object.values(row).map(literal)});`);
  return lines.join('\n') + '\n';
}

export const invariantQueries = {
  multipleIn: "SELECT dog_id FROM v2_admissions WHERE status='in' GROUP BY dog_id HAVING COUNT(*)>1",
  missingCurrentNumber: "SELECT admission_id FROM v2_admission_numbers GROUP BY admission_id HAVING SUM(kind='current')<>1",
  multiplePrimaryPhotos: "SELECT dog_id FROM v2_dog_photos WHERE state='active' AND is_primary=1 GROUP BY dog_id HAVING COUNT(*)>1",
  multiplePrimaryCodes: "SELECT walker_id FROM v2_walker_codes WHERE kind='primary' GROUP BY walker_id HAVING COUNT(*)>1",
  knownWithoutParticipants: "SELECT w.walk_id FROM v2_daily_walks w LEFT JOIN v2_walk_participants p USING(walk_id) WHERE w.participant_quality='known' GROUP BY w.walk_id HAVING COUNT(p.walker_id)=0",
  confirmedWithoutAdmission: "SELECT binding_id FROM v2_source_bindings WHERE state='confirmed' AND admission_id IS NULL",
  importedHistoryWithoutTarget: "SELECT source_id FROM v2_history_sources WHERE state='imported' AND admission_id IS NULL AND walk_id IS NULL AND source_kind<>'snapshot'",
};

export async function checkInvariants(db) {
  const result = {};
  for (const [name, sql] of Object.entries(invariantQueries)) {
    result[name] = (await db.prepare(sql).all()).results.length;
    if (result[name]) throw new Error(`業務檢核非零列：${name}`);
  }
  return result;
}

export async function verifySqlExport(archive, sql, { businessChecks = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  try {
    // D1 匯出依建表順序夾帶資料，整份匯入完成後必須再查所有外鍵。
    sqlite.exec('PRAGMA foreign_keys=OFF');
    sqlite.exec(sql);
    sqlite.exec('PRAGMA foreign_keys=ON');
    const db = { prepare: statement => ({ all: async () => ({ results: sqlite.prepare(statement).all().map(r => ({ ...r })) }), first: async col => sqlite.prepare(statement).get()?.[col] }) };
    return { ...await verifyDatabase(db, archive), ...(businessChecks ? { checks: await checkInvariants(db) } : {}), fingerprint: archive.fingerprint };
  } finally { sqlite.close(); }
}

async function buildArchive(input) {
  const db = fakeD1();
  try {
    await migrateBusinessDatabase(db);
    await db.batch([db.prepare('CREATE TABLE walker_names(name TEXT PRIMARY KEY,last_seen TEXT NOT NULL)'), db.prepare('CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)')]);
    const migrate = async () => ({ identities: await migrateIdentities(db, input.identities), history: await migrateHistory(db, input.history), profiles: await migrateProfiles(db, input.profiles) });
    const decisions = await migrate(), first = await captureDatabase(db);
    await migrate();
    await verifyDatabase(db, first);
    const checks = await checkInvariants(db);
    const expectedHistory = input.history.walks.length + input.history.snapshots.reduce((n, s) => n + s.dogs.length + 1, 0) + input.history.departedSheet.length + input.history.departures.length;
    if (first.tables.v2_source_bindings.length !== new Set(decisions.identities.mapping.map(row => JSON.stringify([row.source, row.source_key]))).size) throw new Error('身分來源覆蓋不平衡');
    if (first.tables.v2_history_sources.length !== expectedHistory) throw new Error('歷史來源覆蓋不平衡');
    const p = input.profiles;
    const expectedProfiles = p.cardOpened.length + p.walkerNames.length + p.kv.length + p.photos.length + p.cards.length + Object.keys(p.introOriginal).length + Object.keys(p.rest).length + Object.keys(p.notes).length;
    if (first.tables.v2_profile_sources.length !== expectedProfiles) throw new Error('附屬來源覆蓋不平衡');
    return { capturedAt: new Date().toISOString(), input, inputFingerprint: hash(input), decisions, database: first, checks, replayIdentical: true };
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [action, ...args] = process.argv.slice(2);
    if (action === 'build') {
      const [departed, legacy, photos, output] = args;
      const archive = await buildArchive(await readProfileSources(departed, legacy, photos));
      await writeFile(output, JSON.stringify(archive));
      await writeFile(`${output}.sql`, archiveSql(archive.database));
      console.log(JSON.stringify({ fingerprint: archive.database.fingerprint, counts: Object.fromEntries(Object.entries(archive.database.tables).map(([t, rows]) => [t, rows.length])), checks: archive.checks, replayIdentical: true }, null, 2));
    } else if (action === 'verify-export') {
      const [archivePath, sqlPath] = args;
      const archive = JSON.parse(await readFile(archivePath, 'utf8'));
      if (hash(archive.input) !== archive.inputFingerprint) throw new Error('來源封存指紋不符');
      console.log(JSON.stringify(await verifySqlExport(archive.database, await readFile(sqlPath, 'utf8'), { businessChecks: true }), null, 2));
    } else throw new Error('用法：build <已出所> <舊D1> <R2> <私有封存路徑> 或 verify-export <封存> <Cloudflare匯出SQL>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
