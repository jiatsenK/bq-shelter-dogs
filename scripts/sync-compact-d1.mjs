// 同步試算表（#251）：讀試算表，跟 D1 裡上一次的狀態比，算出新的溜狗紀錄和離所，整份換進 D1 的 v3_ 表。
// 網站從 D1 讀（#247、#260）。只寫 D1：不寫試算表、不寫 data/、不呼叫 git／GitHub。
// 由 .github/workflows/sync-sheet.yml 執行：先用 wrangler 讀正式 D1 的現況，在記憶體 D1 裡算好、匯入並比對，
// 一致才產生 SQL 交給 wrangler 寫回。試算表的部分（主清單、異動紀錄、常遛狗群、已出所）每次整份從試算表重建；
// 溜狗紀錄和離所是累積的，以 D1 上一次的內容為基準往上加。
// 休養、介紹、開卡、照片由網站直接寫 D1（#249、#250），這裡不碰。
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { readDogsPayload, readWalks, readDepartures } from '../worker/src/compact.js';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { importCompactDogs, compareCompactDogs } from './import-compact-dogs.mjs';
import { importCompactProfiles, compareCompactProfiles } from './import-compact-profiles.mjs';
import { importCompactDepartures, compareCompactDepartures } from './import-compact-departures.mjs';
import {
  fetchGviz, parseGroupColumns, buildData, loadDepartedRows, newWalks, upgradeWalks, attachMyWalkedDate,
  updateDepartures, myNames, walkerCode, formatDate, formatTimestamp, FORMAT_VERSION,
} from './sync-sheet.mjs';

// 從正式 D1 讀回的現況：永久狗與編號（重跑沿用 ID）、上一次的主清單複本（比對溜狗日期、離所）、
// 溜狗紀錄、離所紀錄（累積的基準），介紹（離所時記下最後的樣子）
export const SEED_TABLES = {
  v3_dogs: 'SELECT * FROM v3_dogs',
  v3_dog_numbers: 'SELECT * FROM v3_dog_numbers',
  v3_sheet_main: 'SELECT * FROM v3_sheet_main',
  v3_sheet_main_walkers: 'SELECT * FROM v3_sheet_main_walkers',
  v3_sheet_former_numbers: 'SELECT * FROM v3_sheet_former_numbers',
  v3_sheet_groups: 'SELECT * FROM v3_sheet_groups',
  v3_sheet_changes: 'SELECT * FROM v3_sheet_changes',
  v3_walks: 'SELECT * FROM v3_walks',
  v3_departures: 'SELECT * FROM v3_departures',
  v3_departure_items: 'SELECT * FROM v3_departure_items',
  v3_intros: 'SELECT * FROM v3_intros',
};
// 整份替換的表，子表在前（刪除照這個順序，新增反過來）
const REPLACED = ['v3_departure_items', 'v3_departures', 'v3_sheet_main_walkers', 'v3_sheet_former_numbers', 'v3_sheet_main', 'v3_sheet_groups', 'v3_sheet_changes', 'v3_walks'];

const sqlValue = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const insert = (table, row, tail = '') => `INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(sqlValue).join(',')})${tail};`;

// D1 上一次的狀態：主清單複本（還沒有就是 null）、溜狗紀錄、離所紀錄
export async function readPrevious(db) {
  // 第一次同步主清單複本是空的；其他讀取錯誤照樣丟出，不當成沒有上一次
  const empty = !(await db.prepare('SELECT COUNT(*) AS n FROM v3_sheet_main').first('n'));
  const dogs = empty ? null : await readDogsPayload(db);
  const identities = (await db.prepare('SELECT d.dog_id,d.sex,n.number FROM v3_dogs d LEFT JOIN v3_dog_numbers n USING(dog_id)').all()).results;
  const unnumbered = (await db.prepare("SELECT dog_id,name FROM v3_sheet_main WHERE number=''").all()).results;
  return { dogs, identities, unnumbered, walks: (await readWalks(db)).walks, departures: await readDepartures(db) };
}

// 試算表這次的內容 ＋ D1 上一次的狀態 → 要寫進 D1 的完整內容（跟原本 dogs.json、walks.json、departures.json 同樣子）。
// - sheet：buildData() 的結果；sheetNotes 是 null（異動紀錄讀不到）就沿用上一次
// - rows：已出所分頁（loadDepartedRows），null 表示讀不到，離所原因沿用上一次
// D1 的溜狗紀錄一隻狗一天只存最後一筆、沒有 mine，所以用代號推回 mine：newWalks 的「同一天換人」才比得準。
// 同一天多算出來的紀錄寫進 D1 時會合併成一筆（importCompactProfiles），不會重複。
export function planSync(prev, sheet, rows, now = new Date(), { key = process.env.WALKER_KEY, names = myNames() } = {}) {
  // 性別與編號關係由 D1 永久身分提供，不再讀狗卡；有編號的狗絕不按名字合併。
  const identities = prev.identities || [];
  sheet = { ...sheet, dogs: sheet.dogs.map(dog => {
    const identity = dog.id ? identities.find(r => r.number === dog.id)
      : identities.find(r => r.dog_id === (prev.unnumbered || []).find(r => r.name === dog.name)?.dog_id);
    const formerIds = identity ? identities.filter(r => r.dog_id === identity.dog_id && r.number && r.number !== dog.id).map(r => r.number).sort() : [];
    const { formerIds: ignored, ...sheetDog } = dog;
    return { ...sheetDog, sex: identity?.sex || '', intro: '', ...(formerIds.length ? { formerIds } : {}) };
  }) };
  const myCodes = new Set(key ? names.map(n => walkerCode(n, key)) : []);
  const walks = prev.walks.map(w => ({ ...w, mine: Array.isArray(w.walkers) && w.walkers.some(c => myCodes.has(c)) }));
  const prevDogs = prev.dogs ? prev.dogs.dogs : null;
  const upgraded = upgradeWalks(walks, sheet.dogs, { key, names }).walks;
  const allWalks = [...upgraded, ...newWalks(sheet.dogs, prevDogs, upgraded, key)];
  const dogs = attachMyWalkedDate(sheet.dogs, allWalks);
  const sheetNotes = sheet.sheetNotes ?? (prev.dogs ? prev.dogs.sheetNotes : []);
  const today = formatDate(now);
  const snapshots = [
    ...(prev.dogs ? [{ date: today, dogs: prev.dogs.dogs, groups: prev.dogs.groups }] : []),
    { date: today, dogs, groups: sheet.groups },
  ];
  return {
    dogs: { version: FORMAT_VERSION, syncedAt: formatTimestamp(now), dogs, groups: sheet.groups, sheetNotes },
    walks: { version: 1, walks: allWalks },
    departures: updateDepartures(prev.departures, snapshots, rows, now),
  };
}

// seed：{ 表名: 正式 D1 讀到的列 }；source：{ dogs（dogs.json 的樣子）, walks, departures, groupColumns }，
// 或是一個函式：拿到已經放好 seed 的記憶體 D1，回傳 source（同步要先讀上一次的狀態才算得出來）。
// 回傳要寫回正式 D1 的 SQL；讀回跟來源不一致就丟錯，不寫。
export async function buildSyncSql(seed, source) {
  const db = fakeD1();
  try {
    await migrateCompactDatabase(db);
    const seeds = Object.keys(SEED_TABLES).flatMap(t => (seed[t] || []).map(row => db.prepare(insert(t, row))));
    if (seeds.length) await db.batch(seeds);
    if (typeof source === 'function') source = await source(db);
    await importCompactDogs(db, source.dogs);
    const profiles = { walks: source.walks };
    await importCompactProfiles(db, profiles);
    const sheet = [];
    source.groupColumns.forEach((names, column) => names.forEach((name, row) => sheet.push(db.prepare('INSERT INTO v3_sheet_groups(column_index,row_index,name) VALUES(?,?,?)').bind(column, row, name))));
    (source.dogs.sheetNotes || []).forEach((n, row) => sheet.push(db.prepare('INSERT INTO v3_sheet_changes(row_index,label,text) VALUES(?,?,?)').bind(row, n.label || '', n.text || '')));
    await db.batch([db.prepare('DELETE FROM v3_sheet_groups'), db.prepare('DELETE FROM v3_sheet_changes'), ...sheet]);
    await importCompactDepartures(db, source.departures);
    const differences = [...(await compareCompactDogs(db, source.dogs)).differences, ...(await compareCompactProfiles(db, profiles)).differences,
      ...(await compareCompactDepartures(db, source.departures)).differences];
    if (differences.length) throw new Error(`匯入後比對有差異，不寫 D1：${JSON.stringify(differences.slice(0, 5))}`);
    const rows = async t => (await db.prepare(`SELECT * FROM ${t}`).all()).results;
    const schema = await readFile(new URL('../db/compact-schema.sql', import.meta.url), 'utf8');
    const out = schema.replace(/--[^\n]*/g, '').split(';').map(t => t.trim()).filter(t => /^CREATE TABLE IF NOT EXISTS v3_departure/.test(t)).map(t => `${t.replace(/\s+/g, ' ')};`);
    for (const row of await rows('v3_dogs')) out.push(insert('v3_dogs', row, ' ON CONFLICT(dog_id) DO UPDATE SET name=excluded.name,sex=excluded.sex'));
    for (const row of await rows('v3_dog_numbers')) out.push(insert('v3_dog_numbers', row, ' ON CONFLICT(number) DO NOTHING'));
    for (const t of REPLACED) out.push(`DELETE FROM ${t};`);
    for (const t of [...REPLACED].reverse()) for (const row of await rows(t)) out.push(insert(t, row));
    return out.join('\n') + '\n';
  } finally { db.close(); }
}

const wrangler = args => execFileSync('npx', ['--yes', 'wrangler@4', 'd1', 'execute', 'bq-shelter-dogs', '--remote', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });

async function main() {
  // D1 的溜狗紀錄沒有 mine，要靠代號推回來；沒有 WALKER_KEY 會把「我溜過」的日期算錯，寧可不同步
  if (!process.env.WALKER_KEY) throw new Error('沒有設定 WALKER_KEY，無法比對溜狗紀錄');
  const now = new Date();
  const sheet = await buildData(fetch, now, async () => '');
  const groupColumns = parseGroupColumns(await fetchGviz('常遛狗群'), new Set(sheet.dogs.map(d => d.name)));
  const rows = await loadDepartedRows(fetch, now);
  const seed = {};
  // 任何一張表讀不到就停：當成空的會把累積的溜狗紀錄、離所整份換掉
  for (const [table, sql] of Object.entries(SEED_TABLES)) seed[table] = JSON.parse(wrangler(['--json', '--command', sql]))[0].results;
  let plan;
  const sql = await buildSyncSql(seed, async db => {
    plan = planSync(await readPrevious(db), sheet, rows, now);
    return { ...plan, groupColumns };
  });
  const file = join(tmpdir(), 'bq-sync-compact.sql');
  await writeFile(file, sql);
  wrangler(['--file', file]);
  console.log(`已寫入 D1：${plan.dogs.dogs.length} 隻狗、${plan.walks.walks.length} 筆溜狗紀錄、${plan.departures.length} 筆離所、${groupColumns.filter(c => c.length).length} 欄常遛狗群。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(`同步失敗，D1 保留上一次的內容：${e.message}`); process.exit(1); });
}
