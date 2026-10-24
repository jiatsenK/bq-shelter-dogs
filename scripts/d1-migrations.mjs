// #553 D1 結構改用 wrangler migrations：migrations/NNNN_*.sql 一個變更一個檔，D1 的 d1_migrations 表記套過哪些。
// 部署擋關：node scripts/d1-migrations.mjs check                      正式庫有還沒套的就紅叉（只送 SELECT）
// 套用：    node scripts/d1-migrations.mjs apply --target production    （.github/workflows/d1-migrations.yml）
//           node scripts/d1-migrations.mjs apply --target test --backup always   在測試庫演練
// 套用依序：有刪資料或搬資料的 migration → 整份複製到備用庫 bq-shelter-dogs-backup；記下套用前的 Time Travel 書籤；
// d1 migrations apply --remote；再查一次全部套上；印出書籤與還原指令（還原交給 K 執行）
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWrangler, parseJsonOutput, findDatabase } from './d1-database.mjs';
import { splitStatements } from './migrate-compact-db.mjs';
import { copyDatabase } from './copy-prod-d1.mjs';

export const TARGETS = {
  production: { name: 'bq-shelter-dogs', config: 'wrangler.jsonc' },
  test: { name: 'bq-shelter-dogs-test', config: 'wrangler.preview-db.jsonc' },
};
export const BACKUP_DB = 'bq-shelter-dogs-backup';
// K 2026-10-24 建的專門備用庫（#553）；照名字查到的 ID 要跟這個一樣才複製
export const BACKUP_DB_ID = 'd31b8371-c94a-4a04-960f-665a0365c5af';
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
export const FILE_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

// wrangler 照檔名排序套用；只認 NNNN_名稱.sql
export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
}

export function pendingMigrations(files, applied) {
  const done = new Set(applied);
  return files.filter(f => !done.has(f));
}

// 會刪資料或搬資料的句子：DROP TABLE、DELETE、UPDATE、REPLACE、ALTER TABLE 的 DROP／RENAME、INSERT … SELECT。
// 觸發器本體裡的 UPDATE／DELETE 不算（只在之後的寫入才跑）；預設列 INSERT OR IGNORE … VALUES 不算
export function changesData(sql) {
  return splitStatements(sql).some(s => !/^CREATE\s+TRIGGER/i.test(s) && (
    /^(DROP\s+TABLE|DELETE|UPDATE|REPLACE|INSERT\s+OR\s+REPLACE|ALTER\s+TABLE\s+\S+\s+(DROP|RENAME))\b/i.test(s) || /^INSERT\b[\s\S]*\bSELECT\b/i.test(s)));
}

const query = (run, db, sql) => parseJsonOutput(run(['d1', 'execute', db.name, '--remote', '--json', '--config', db.config, '--command', sql]))[0].results;

// 只送 SELECT：還沒有 d1_migrations 表就當作一個都沒套（不像 wrangler 的 migrations list 會建表）
export function appliedMigrations(db, run = runWrangler) {
  if (!query(run, db, "SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations'").length) return [];
  return query(run, db, 'SELECT name FROM d1_migrations ORDER BY id').map(r => r.name);
}

export function status(db, { run = runWrangler, files = migrationFiles() } = {}) {
  const applied = appliedMigrations(db, run);
  return { applied, pending: pendingMigrations(files, applied), unknown: applied.filter(f => !files.includes(f)) };
}

// 備用庫照名字查，ID 要等於 BACKUP_DB_ID；寫一份只有資料庫設定的暫存檔給 wrangler
export function backupDb(list, { productionId, expectedId = BACKUP_DB_ID, dir = mkdtempSync(join(tmpdir(), 'd1-backup-')) } = {}) {
  const id = findDatabase(list, BACKUP_DB);
  if (!id) throw new Error(`備用庫 ${BACKUP_DB} 還沒建：請 K 執行 npx.cmd wrangler d1 create ${BACKUP_DB}`);
  if (id === productionId) throw new Error('備用庫不能是正式庫');
  if (id !== expectedId) throw new Error(`${BACKUP_DB} 的 ID ${id} 跟 repo 記的 ${expectedId} 不同，停止（換了備用庫要改 scripts/d1-migrations.mjs 的 BACKUP_DB_ID）`);
  const config = join(dir, 'wrangler.backup.json');
  writeFileSync(config, JSON.stringify({ d1_databases: [{ binding: 'DB', database_name: BACKUP_DB, database_id: id }] }));
  return { name: BACKUP_DB, config };
}

export function apply({ target = 'test', backup = 'auto', run = runWrangler, copy = copyDatabase, dir = MIGRATIONS_DIR, log = console.log } = {}) {
  const db = TARGETS[target];
  if (!db) throw new Error(`不認得的目標：${target}（production 或 test）`);
  const before = status(db, { run, files: migrationFiles(dir) });
  if (before.unknown.length) log(`注意：${db.name} 記著 repo 沒有的 migration：${before.unknown.join('、')}`);
  if (!before.pending.length) return { db, applied: [], backedUp: false, bookmark: '' };
  log(`${db.name} 要套：${before.pending.join('、')}`);
  const risky = before.pending.filter(f => changesData(readFileSync(join(dir, f), 'utf8')));
  const backedUp = backup === 'always' || (backup === 'auto' && risky.length > 0);
  if (backedUp) {
    const list = parseJsonOutput(run(['d1', 'list', '--json']));
    const to = backupDb(list, { productionId: findDatabase(list, TARGETS.production.name) });
    log(`${risky.length ? `會刪資料或搬資料（${risky.join('、')}）` : '指定先備份'}：${db.name} 整份複製到 ${to.name}`);
    copy({ from: db, to });
  }
  const bookmark = parseJsonOutput(run(['d1', 'time-travel', 'info', db.name, '--json', '--config', db.config])).bookmark;
  log(`套用前的 Time Travel 書籤：${bookmark}`);
  log(run(['d1', 'migrations', 'apply', db.name, '--remote', '--config', db.config]));
  const after = status(db, { run, files: migrationFiles(dir) });
  if (after.pending.length) throw new Error(`套用後還有沒套上的：${after.pending.join('、')}`);
  return { db, applied: before.pending, backedUp, bookmark };
}

export function summary({ db, applied, backedUp, bookmark }) {
  if (!applied.length) return `**${db.name}**：沒有要套的 migration。\n`;
  return [`**${db.name}** 套上：${applied.map(f => `\`${f}\``).join('、')}`,
    `- 先複製到備用庫 ${BACKUP_DB}：${backedUp ? '有' : '沒有（沒有刪資料或搬資料的 migration）'}`,
    `- 套用前的 Time Travel 書籤：\`${bookmark}\``,
    `- 要退回套用前（會覆蓋之後的寫入，交給 K 執行）：\`npx.cmd wrangler d1 time-travel restore ${db.name} --bookmark=${bookmark}\``, ''].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = name => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : undefined; };
  const out = text => { console.log(text); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`); };
  try {
    if (process.argv[2] === 'check') {
      const db = TARGETS[arg('target') || 'production'];
      const s = status(db);
      if (s.unknown.length) throw new Error(`${db.name} 記著 repo 沒有的 migration：${s.unknown.join('、')}，先查清楚再部署`);
      if (s.pending.length) throw new Error(`${db.name} 有還沒套的 migration：${s.pending.join('、')}。到 Actions 按「套用 D1 migration」→「Run workflow」，它會套用後接著部署。`);
      out(`${db.name} 的 migration 全部套過（${s.applied.length} 個），可以部署。`);
    } else if (process.argv[2] === 'apply') {
      out(summary(apply({ target: arg('target'), backup: arg('backup') || 'auto' })));
    } else throw new Error('用法：node scripts/d1-migrations.mjs check|apply [--target production|test] [--backup auto|always|never]');
  } catch (e) {
    console.error(e.message);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**停止**：${e.message}\n`);
    process.exitCode = 1;
  }
}
