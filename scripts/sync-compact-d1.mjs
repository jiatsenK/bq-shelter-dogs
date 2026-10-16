// 同步試算表（#251）：讀試算表，跟 D1 裡上一次的狀態比，算出新的溜狗紀錄和離所，整份換進 D1 的 v3_ 表。
// 網站從 D1 讀（#247、#260）。只寫 D1：不寫試算表、不寫 data/、不呼叫 git／GitHub。
// 由 .github/workflows/sync-sheet.yml 執行：先用 wrangler 讀正式 D1 的現況，在記憶體 D1 裡算好、匯入並比對，
// 一致才產生 SQL 交給 wrangler 寫回。試算表的部分（主清單、異動紀錄、常遛狗群、已出所）每次整份從試算表重建；
// 溜狗紀錄和離所是累積的，以 D1 上一次的內容為基準往上加。
// 休養、介紹、開卡、照片由網站直接寫 D1（#249、#250），這裡不碰。
import { readFile, writeFile } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { compareCompactDogs } from './import-compact-dogs.mjs';
import { compareCompactProfiles } from './import-compact-profiles.mjs';
import { compareCompactDepartures } from './import-compact-departures.mjs';
import { fetchGviz, parseGroupColumns, parseGroupLabels, buildData, loadDepartedRows } from './sync-sheet.mjs';
import { planSync, readPrevious, applySource } from './sync-plan.mjs';
export { planSync, readPrevious };

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
// 群名表 v3_sheet_group_labels 不在上面：每次都整份從試算表重建，不用先讀；正式 D1 還沒建表時讀了會讓同步失敗
// （SQL 開頭會自己 CREATE TABLE IF NOT EXISTS）
// 整份替換的表，子表在前（刪除照這個順序，新增反過來）
const REPLACED = ['v3_departure_items', 'v3_departures', 'v3_sheet_main_walkers', 'v3_sheet_former_numbers', 'v3_sheet_main', 'v3_sheet_groups', 'v3_sheet_group_labels', 'v3_sheet_changes', 'v3_walks'];

const sqlValue = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const insert = (table, row, tail = '') => `INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(sqlValue).join(',')})${tail};`;

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
    await applySource(db, source);
    const profiles = { walks: source.walks };
    const differences = [...(await compareCompactDogs(db, source.dogs)).differences, ...(await compareCompactProfiles(db, profiles)).differences,
      ...(await compareCompactDepartures(db, source.departures)).differences];
    if (differences.length) throw new Error(`匯入後比對有差異，不寫 D1：${JSON.stringify(differences.slice(0, 5))}`);
    const rows = async t => (await db.prepare(`SELECT * FROM ${t}`).all()).results;
    // 正式 D1 不另外建表（#214），新資料表（例如 v3_edit_log）靠同步時補建；全部是 IF NOT EXISTS，重跑不影響既有資料
    const schema = await readFile(new URL('../db/compact-schema.sql', import.meta.url), 'utf8');
    const out = schema.replace(/--[^\n]*/g, '').split(';').map(t => t.trim()).filter(t => /^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS /.test(t)).map(t => `${t.replace(/\s+/g, ' ')};`);
    for (const row of await rows('v3_dogs')) out.push(insert('v3_dogs', row, ' ON CONFLICT(dog_id) DO UPDATE SET name=excluded.name,sex=excluded.sex'));
    for (const row of await rows('v3_dog_numbers')) out.push(insert('v3_dog_numbers', row, ' ON CONFLICT(number) DO NOTHING'));
    for (const t of REPLACED) out.push(`DELETE FROM ${t};`);
    for (const t of [...REPLACED].reverse()) for (const row of await rows(t)) out.push(insert(t, row));
    return out.join('\n') + '\n';
  } finally { db.close(); }
}

// 11 張表同時讀：每叫一次 npx wrangler 要 3 秒左右，一張一張讀會讓頁首「更新」多等半分鐘
// 第一張先單獨讀，讓 npx 把 wrangler 下載好，其餘再一起叫，免得同時下載互搶快取
// 任何一張表讀不到就整個停：當成空的會把累積的溜狗紀錄、離所整份換掉
export async function readSeed(query) {
  const [first, ...rest] = Object.keys(SEED_TABLES);
  const results = [await query(SEED_TABLES[first]), ...await Promise.all(rest.map(t => query(SEED_TABLES[t])))];
  return Object.fromEntries([first, ...rest].map((t, i) => [t, results[i]]));
}

const wranglerArgs = args => ['--yes', 'wrangler@4', 'd1', 'execute', 'bq-shelter-dogs', '--remote', ...args];
const wranglerAsync = args => new Promise((resolve, reject) => {
  execFile('npx', wranglerArgs(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (stderr) process.stderr.write(stderr);
    if (err) reject(err); else resolve(stdout);
  });
});
const wrangler = args => execFileSync('npx', wranglerArgs(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });

async function main() {
  // D1 的溜狗紀錄沒有 mine，要靠代號推回來；沒有 WALKER_KEY 會把「我溜過」的日期算錯，寧可不同步
  if (!process.env.WALKER_KEY) throw new Error('沒有設定 WALKER_KEY，無法比對溜狗紀錄');
  const now = new Date();
  const sheet = await buildData(fetch, now, async () => '');
  const groupTable = await fetchGviz('常遛狗群');
  const dogNames = new Set(sheet.dogs.map(d => d.name));
  const groupColumns = parseGroupColumns(groupTable, dogNames);
  const groupLabels = parseGroupLabels(groupTable, dogNames);
  const rows = await loadDepartedRows(fetch, now);
  const seed = await readSeed(async sql => JSON.parse(await wranglerAsync(['--json', '--command', sql]))[0].results);
  let plan;
  const sql = await buildSyncSql(seed, async db => {
    plan = planSync(await readPrevious(db), sheet, rows, now);
    return { ...plan, groupColumns, groupLabels };
  });
  const file = join(tmpdir(), 'bq-sync-compact.sql');
  await writeFile(file, sql);
  wrangler(['--file', file]);
  console.log(`已寫入 D1：${plan.dogs.dogs.length} 隻狗、${plan.walks.walks.length} 筆溜狗紀錄、${plan.departures.length} 筆離所、${groupColumns.filter(c => c.length).length} 欄常遛狗群。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(`同步失敗，D1 保留上一次的內容：${e.message}`); process.exit(1); });
}
