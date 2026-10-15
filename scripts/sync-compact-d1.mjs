// #251 第一步：同步試算表後，把 data/dogs.json、walks.json 和常遛狗群整份換進 D1 的 v3_ 表，
// 網站（#247 起讀 D1）才看得到最新的試算表。GitHub 的 JSON 提交暫時照舊（溜狗紀錄和離所還要靠舊檔算），之後再拿掉。
// 由 .github/workflows/sync-sheet.yml 在同步後執行：先用 wrangler 讀正式 D1 現有的永久狗 ID，在記憶體 D1 裡匯入並比對，
// 一致才產生 SQL 交給 wrangler 寫回。只寫 D1，不寫試算表、不呼叫 GitHub。
// 休養、介紹、開卡、照片由網站直接寫 D1（#249、#250），這裡不碰。
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { importCompactDogs, compareCompactDogs } from './import-compact-dogs.mjs';
import { importCompactProfiles, compareCompactProfiles } from './import-compact-profiles.mjs';
import { fetchGviz, parseGroupColumns } from './sync-sheet.mjs';

// 重跑要沿用的身分：永久狗、編號、主清單上的無編號狗、溜狗紀錄裡的無編號狗
export const SEED_TABLES = {
  v3_dogs: 'SELECT * FROM v3_dogs',
  v3_dog_numbers: 'SELECT * FROM v3_dog_numbers',
  v3_sheet_main: 'SELECT * FROM v3_sheet_main',
  v3_walks: "SELECT * FROM v3_walks WHERE dog_number=''",
};
// 整份替換的表，子表在前（刪除照這個順序，新增反過來）
const REPLACED = ['v3_sheet_main_walkers', 'v3_sheet_former_numbers', 'v3_sheet_main', 'v3_sheet_groups', 'v3_sheet_changes', 'v3_walks'];

const sqlValue = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const insert = (table, row, tail = '') => `INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(sqlValue).join(',')})${tail};`;

// seed：{ 表名: 正式 D1 讀到的列 }；source：{ dogs（dogs.json）, walks, groupColumns }。
// 回傳要寫回正式 D1 的 SQL；讀回跟來源不一致就丟錯，不寫。
export async function buildSyncSql(seed, source) {
  const db = fakeD1();
  try {
    await migrateCompactDatabase(db);
    const seeds = Object.keys(SEED_TABLES).flatMap(t => (seed[t] || []).map(row => db.prepare(insert(t, row))));
    if (seeds.length) await db.batch(seeds);
    await importCompactDogs(db, source.dogs);
    const profiles = { walks: source.walks };
    await importCompactProfiles(db, profiles);
    const sheet = [];
    source.groupColumns.forEach((names, column) => names.forEach((name, row) => sheet.push(db.prepare('INSERT INTO v3_sheet_groups(column_index,row_index,name) VALUES(?,?,?)').bind(column, row, name))));
    (source.dogs.sheetNotes || []).forEach((n, row) => sheet.push(db.prepare('INSERT INTO v3_sheet_changes(row_index,label,text) VALUES(?,?,?)').bind(row, n.label || '', n.text || '')));
    await db.batch([db.prepare('DELETE FROM v3_sheet_groups'), db.prepare('DELETE FROM v3_sheet_changes'), ...sheet]);
    const differences = [...(await compareCompactDogs(db, source.dogs)).differences, ...(await compareCompactProfiles(db, profiles)).differences];
    if (differences.length) throw new Error(`匯入後比對有差異，不寫 D1：${JSON.stringify(differences.slice(0, 5))}`);
    const rows = async t => (await db.prepare(`SELECT * FROM ${t}`).all()).results;
    const out = [];
    for (const row of await rows('v3_dogs')) out.push(insert('v3_dogs', row, ' ON CONFLICT(dog_id) DO UPDATE SET name=excluded.name,sex=excluded.sex'));
    for (const row of await rows('v3_dog_numbers')) out.push(insert('v3_dog_numbers', row, ' ON CONFLICT(number) DO NOTHING'));
    for (const t of REPLACED) out.push(`DELETE FROM ${t};`);
    for (const t of [...REPLACED].reverse()) for (const row of await rows(t)) out.push(insert(t, row));
    return out.join('\n') + '\n';
  } finally { db.close(); }
}

const wrangler = args => execFileSync('npx', ['--yes', 'wrangler@4', 'd1', 'execute', 'bq-shelter-dogs', '--remote', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });

async function main() {
  const root = new URL('../', import.meta.url);
  const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
  const dogs = await json('data/dogs.json');
  const groupColumns = parseGroupColumns(await fetchGviz('常遛狗群'), new Set(dogs.dogs.map(d => d.name)));
  const seed = {};
  for (const [table, sql] of Object.entries(SEED_TABLES)) seed[table] = JSON.parse(wrangler(['--json', '--command', sql]))[0].results;
  const sql = await buildSyncSql(seed, { dogs, walks: await json('data/walks.json'), groupColumns });
  const file = join(tmpdir(), 'bq-sync-compact.sql');
  await writeFile(file, sql);
  wrangler(['--file', file]);
  console.log(`已寫入 D1：${dogs.dogs.length} 隻狗、${groupColumns.filter(c => c.length).length} 欄常遛狗群。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(`寫入 D1 失敗，D1 保留上一次的內容：${e.message}`); process.exit(1); });
}
