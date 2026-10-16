// 同步試算表（#251、#302）：讀試算表，跟 D1 裡上一次的狀態比，算出新的溜狗紀錄和離所，只把有變的列寫進 D1 的 v3_ 表。
// 網站從 D1 讀（#247、#260）。只寫 D1：不寫試算表、不寫 data/、不呼叫 git／GitHub。
// 由 .github/workflows/sync-sheet.yml 執行：先用 wrangler 讀正式 D1 的現況，在記憶體 D1 裡算好、匯入並比對，
// 一致才跟現況照主鍵比對，只產生有變的列的 SQL 交給 wrangler 寫回（差異同步，#302；以前每次刪光重寫，一天就用完 D1 寫入額度）。
// 寫之前先檢查寫入預算（ADR 0008），異常就整次不寫。加 --dry-run 只算列數、不寫入（#309）。試算表的部分（主清單、異動紀錄、常遛狗群、已出所）照試算表重建；
// 溜狗紀錄和離所是累積的，以 D1 上一次的內容為基準往上加。
// 休養、介紹、開卡、照片由網站直接寫 D1（#249、#250），這裡不碰。
import { readFile, writeFile, appendFile } from 'node:fs/promises';
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
import { SYNC_TABLES, diffTables, budgetProblem, todayRowsWritten, MAX_ROWS_PER_SYNC, DAILY_BUDGET } from './sync-diff.mjs';
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
  v3_sheet_group_labels: 'SELECT * FROM v3_sheet_group_labels',
};
// 差異同步要知道現況才比得出差異，所以群名表也要讀；正式 D1 還沒建這張表時當成空的（SQL 開頭會自己 CREATE TABLE IF NOT EXISTS）
const OPTIONAL_TABLES = new Set(['v3_sheet_group_labels']);

const sqlValue = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const insert = (table, row, tail = '') => `INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(sqlValue).join(',')})${tail};`;

// seed：{ 表名: 正式 D1 讀到的列 }；source：{ dogs（dogs.json 的樣子）, walks, departures, groupColumns }，
// 或是一個函式：拿到已經放好 seed 的記憶體 D1，回傳 source（同步要先讀上一次的狀態才算得出來）。
// 回傳 { sql, rows }：要寫回正式 D1 的 SQL、其中要寫幾列；讀回跟來源不一致就丟錯，不寫。
export async function buildSyncPlan(seed, source) {
  const db = fakeD1();
  try {
    await migrateCompactDatabase(db);
    const seeds = Object.keys(SEED_TABLES).flatMap(t => (seed[t] || []).map(row => db.prepare(insert(t, row))));
    if (seeds.length) await db.batch(seeds);
    const rows = async t => (await db.prepare(`SELECT * FROM ${t}`).all()).results;
    // 現況從記憶體 D1 讀回，跟同步後的樣子同一個來源，欄位型別才比得準
    const snapshot = async () => Object.fromEntries(await Promise.all(Object.keys(SYNC_TABLES).map(async t => [t, await rows(t)])));
    const before = await snapshot();
    if (typeof source === 'function') source = await source(db);
    await applySource(db, source);
    const profiles = { walks: source.walks };
    const differences = [...(await compareCompactDogs(db, source.dogs)).differences, ...(await compareCompactProfiles(db, profiles)).differences,
      ...(await compareCompactDepartures(db, source.departures)).differences];
    if (differences.length) throw new Error(`匯入後比對有差異，不寫 D1：${JSON.stringify(differences.slice(0, 5))}`);
    const changes = diffTables(before, await snapshot());
    // 正式 D1 不另外建表（#214），新資料表（例如 v3_edit_log）靠同步時補建；全部是 IF NOT EXISTS，重跑不影響既有資料
    const schema = await readFile(new URL('../db/compact-schema.sql', import.meta.url), 'utf8');
    const out = schema.replace(/--[^\n]*/g, '').split(';').map(t => t.trim()).filter(t => /^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS /.test(t)).map(t => `${t.replace(/\s+/g, ' ')};`);
    for (const { sql, values } of changes) { let i = 0; out.push(`${sql.replace(/\?/g, () => sqlValue(values[i++]))};`); }
    return { sql: out.join('\n') + '\n', rows: changes.length };
  } finally { db.close(); }
}

export async function buildSyncSql(seed, source) {
  return (await buildSyncPlan(seed, source)).sql;
}

// 11 張表同時讀：每叫一次 npx wrangler 要 3 秒左右，一張一張讀會讓頁首「更新」多等半分鐘
// 第一張先單獨讀，讓 npx 把 wrangler 下載好，其餘再一起叫，免得同時下載互搶快取
// 任何一張表讀不到就整個停：當成空的會把累積的溜狗紀錄、離所整份換掉
// 只有還沒建表的群名表可以當成空的
export async function readSeed(query) {
  const [first, ...rest] = Object.keys(SEED_TABLES);
  const read = t => query(SEED_TABLES[t]).catch(e => { if (OPTIONAL_TABLES.has(t) && /no such table/i.test(String(e?.stdout ?? '') + e.message)) return []; throw e; });
  const results = [await read(first), ...await Promise.all(rest.map(read))];
  return Object.fromEntries([first, ...rest].map((t, i) => [t, results[i]]));
}

// 預演時只准送 SELECT 給正式 D1（#309）：預演用的 token 有寫入權限，萬一寫入那段被改壞也送不出去
let readOnly = false;
const wranglerArgs = args => {
  const sql = args[args.indexOf('--command') + 1];
  if (readOnly && (!args.includes('--command') || !/^\s*SELECT\s/i.test(sql))) throw new Error('預演只能讀 D1，擋下一個寫入指令');
  return ['--yes', 'wrangler@4', 'd1', 'execute', 'bq-shelter-dogs', '--remote', ...args];
};
const wranglerAsync = args => new Promise((resolve, reject) => {
  execFile('npx', wranglerArgs(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (stderr) process.stderr.write(stderr);
    // wrangler --json 把錯誤原因印在 stdout，接到訊息後面，失敗時才看得出原因
    if (err) { if (stdout) err.message += `\n${stdout.slice(0, 2000)}`; reject(err); } else resolve(stdout);
  });
});
// 預演（#309）：PR 改到同步程式時，用正式試算表和正式 D1 算一次要寫幾列，不寫入；結果貼在 PR 上給 K 看
// 單次門檻、每天預算跟真的同步一樣（budgetProblem），超過就讓 CI 失敗
export function dryRunReport(planned, todayWritten, limits) {
  const problem = budgetProblem(planned, todayWritten, limits);
  const used = todayWritten === null ? '查不到' : `${todayWritten} 列`;
  const text = `## 預演：會寫 ${planned} 列${problem ? '（超過門檻）' : ''}

用正式試算表和正式 D1 算的，沒有寫入。

- 今天帳號已寫：${used}
- 單次門檻 ${limits.maxRows} 列、每天預算 ${limits.dailyBudget} 列（ADR 0008）

${problem ? `**${problem}，不要合併。** 通常是程式又變回整份重寫。` : '列數很小（個位數到幾十）就可以合併。'}
`;
  return { ok: !problem, text };
}

export function dryRunFailure(error) {
  return `## 預演失敗

用正式資料預演同步時出錯，沒有寫入。**不要合併**，先查原因：

\`\`\`
${error.message}
\`\`\`
`;
}

const wrangler = args => execFileSync('npx', wranglerArgs(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });

async function main({ dryRun = false } = {}) {
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
  const { sql, rows: planned } = await buildSyncPlan(seed, async db => {
    plan = planSync(await readPrevious(db), sheet, rows, now);
    return { ...plan, groupColumns, groupLabels };
  });
  const limits = { maxRows: Number(process.env.SYNC_MAX_ROWS) || MAX_ROWS_PER_SYNC, dailyBudget: Number(process.env.SYNC_DAILY_BUDGET) || DAILY_BUDGET };
  const todayWritten = await todayRowsWritten({ token: process.env.CLOUDFLARE_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID });
  // 查不到今天的用量不擋同步（只是少一道檢查），但在摘要寫出來，讓 K 知道 token 要補權限
  if (todayWritten === null) console.log('::warning::查不到今天的 D1 寫入量（CLOUDFLARE_API_TOKEN 要有 Account Analytics 讀取權限），這次只檢查單次門檻');
  if (dryRun) {
    const report = dryRunReport(planned, todayWritten, limits);
    console.log(report.text);
    await summary(report.text);
    await writeDryRunComment(report.text);
    // 報告已經寫好，直接結束；用 throw 會被下面的「預演失敗」蓋掉，看不到列數
    if (!report.ok) process.exitCode = 1;
    return;
  }
  const problem = budgetProblem(planned, todayWritten, limits);
  const used = todayWritten === null ? '查不到' : `${todayWritten} 列`;
  if (problem) {
    await summary(`## 同步停寫

${problem}。這次沒有寫入，D1 保留上一次的內容。

- 這次要寫：${planned} 列
- 今天帳號已寫：${used}
- 單次門檻 ${limits.maxRows} 列、每天預算 ${limits.dailyBudget} 列（ADR 0008）

寫入量突然變大通常是程式又變回整份重寫，或試算表被大量改動；確認原因前不要調高門檻。
`);
    throw new Error(`寫入量異常，不寫 D1：${problem}`);
  }
  const file = join(tmpdir(), 'bq-sync-compact.sql');
  await writeFile(file, sql);
  wrangler(['--file', file]);
  const message = `已同步：寫入 ${planned} 列（今天帳號已寫 ${used}）。共 ${plan.dogs.dogs.length} 隻狗、${plan.walks.walks.length} 筆溜狗紀錄、${plan.departures.length} 筆離所、${groupColumns.filter(c => c.length).length} 欄常遛狗群。`;
  console.log(message);
  await summary(`${message}
`);
}

// GitHub Actions 的 Job Summary：手機推播點進去就看得到；本機跑沒有這個檔就略過
async function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
}

// 預演結果另外寫一份，給 CI 貼成 PR 留言（DRY_RUN_COMMENT 是檔案路徑）
async function writeDryRunComment(text) {
  if (process.env.DRY_RUN_COMMENT) await writeFile(process.env.DRY_RUN_COMMENT, text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  readOnly = dryRun;
  main({ dryRun }).catch(async e => {
    if (dryRun) {
      const text = dryRunFailure(e);
      await summary(text).catch(() => {});
      await writeDryRunComment(text).catch(() => {});
      console.error(`預演失敗，沒有寫入：${e.message}`);
    } else console.error(`同步失敗，D1 保留上一次的內容：${e.message}`);
    process.exit(1);
  });
}
