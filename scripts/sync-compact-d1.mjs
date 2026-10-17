// 同步試算表（#251、#302）：讀試算表，跟 D1 裡上一次的狀態比，算出新的溜狗紀錄和離所，只把有變的列寫進 D1 的 v3_ 表。
// 網站從 D1 讀（#247、#260）。只寫 D1：不寫試算表、不寫 data/、不呼叫 git／GitHub。
// 由 .github/workflows/sync-sheet.yml 執行：先用 wrangler 讀正式 D1 的現況，在記憶體 D1 裡算好、匯入並比對，
// 一致才跟現況照主鍵比對，只產生有變的列的 SQL 交給 wrangler 寫回（差異同步，#302；以前每次刪光重寫，一天就用完 D1 寫入額度）。
// 寫之前先檢查寫入預算（ADR 0008），異常就整次不寫。加 --dry-run 只算列數、不寫入（#309）。試算表的部分（主清單、異動紀錄、常遛狗群、已出所）照試算表重建；
// 溜狗紀錄和離所是累積的，以 D1 上一次的內容為基準往上加。
// 休養、介紹、開卡、照片由網站直接寫 D1（#249、#250），這裡不碰。
import { writeFile, appendFile } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase, compactSchemaStatements } from './migrate-compact-db.mjs';
import { compareCompactDogs } from './import-compact-dogs.mjs';
import { compareCompactProfiles } from './import-compact-profiles.mjs';
import { compareCompactDepartures } from './import-compact-departures.mjs';
import { fetchGviz, parseGroupColumns, parseGroupLabels, buildData, loadDepartedRows, formatDate } from './sync-sheet.mjs';
import { planSync, readPrevious, applySource } from './sync-compact-plan.mjs';
import { SYNC_TABLES, diffTables, budgetProblem, todayRowsWritten, MAX_ROWS_PER_SYNC, DAILY_BUDGET } from './sync-diff.mjs';
import { SYNCED_AT_KEY } from '../worker/src/compact.js';
export { planSync, readPrevious };

// 從正式 D1 讀回的現況（全量核對用的整張讀；平常的同步改用 narrowSeedSql 只讀需要的，ADR 0014）：永久狗與編號（重跑沿用 ID）、上一次的主清單複本（比對溜狗日期、離所）、
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
// 同步不補建的 schema（測試也用這份比對，#321）：身分的觸發器和 v3_identity_revision 那一列照現況不在同步建
export const SYNC_SCHEMA_SKIP = { triggers: /^identity_/, rows: ['v3_identity_revision'] };
const skipSchemaStatement = t => {
  const trigger = t.match(/^CREATE TRIGGER IF NOT EXISTS (\w+)/);
  const row = t.match(/^INSERT OR IGNORE INTO (\w+)/);
  return Boolean((trigger && SYNC_SCHEMA_SKIP.triggers.test(trigger[1])) || (row && SYNC_SCHEMA_SKIP.rows.includes(row[1])));
};

// 差異同步要知道現況才比得出差異，所以群名表也要讀；正式 D1 還沒建這張表時當成空的（SQL 開頭會自己 CREATE TABLE IF NOT EXISTS）
const OPTIONAL_TABLES = new Set(['v3_sheet_group_labels']);

const sqlValue = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const insert = (table, row, tail = '') => `INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(sqlValue).join(',')})${tail};`;

// ADR 0010：溜狗紀錄只讀、只寫最近一段。v3_sync_state 記上一次成功同步是哪一天（台灣時間），
// 起點是那天的前一天（停擺後第一次同步自動補回）；還沒記過或「全量核對」就整張讀。
export const WALKS_SYNCED_KEY = 'walks_synced';
export const WALKS_SYNCED_SQL = `SELECT value FROM v3_sync_state WHERE key='${WALKS_SYNCED_KEY}'`;
export function walkSince(walksSynced, { full = false } = {}) {
  if (full || !/^\d{4}-\d{2}-\d{2}$/.test(walksSynced || '')) return '';
  const d = new Date(`${walksSynced}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// 讀 v3_walks 的 SQL：since 以後走 v3_walks_date 索引；checks（lastWalkChecks）照編號找永久狗，用主鍵（狗＋日期）核對
export function walkSeedSql(since, checks = []) {
  if (!since) return SEED_TABLES.v3_walks;
  const pairs = checks.filter(c => c.number && c.date && c.date < since).map(c => `(${sqlValue(c.number)},${sqlValue(c.date)})`);
  return [
    `SELECT * FROM v3_walks WHERE walk_date>=${sqlValue(since)}`,
    ...(pairs.length ? [`SELECT w.* FROM v3_walks w JOIN v3_dog_numbers n ON n.dog_id=w.dog_id WHERE (n.number,w.walk_date) IN (VALUES ${pairs.join(',')})`] : []),
  ].join(' UNION ');
}

// 6:30 保險同步要核對的：試算表上每隻有編號的狗最後一次溜狗。
// 沒編號的狗只能照上一次主清單的犬名找，這次剛改名會找不到而重複補一筆（撞主鍵），所以不核對
export const lastWalkChecks = sheet => sheet.dogs.filter(d => d.id && d.walkedDate).map(d => ({ number: d.id, date: d.walkedDate }));

// seed：{ 表名: 正式 D1 讀到的列 }；source：{ dogs（dogs.json 的樣子）, walks, departures, groupColumns }，
// 或是一個函式：拿到已經放好 seed 的記憶體 D1，回傳 source（同步要先讀上一次的狀態才算得出來）。
// 回傳 { sql, rows }：要寫回正式 D1 的 SQL、其中要寫幾列；讀回跟來源不一致就丟錯，不寫。
// today：這次同步是哪天，跟 seed.walksSynced 不同就順便記下（ADR 0010）；跟資料寫在同一份 SQL，寫成功才算數
export async function buildSyncPlan(seed, source, { today = '' } = {}) {
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
    // 正式 D1 不另外建表（#214），compact-schema.sql 整份靠同步時補建，只排除 SYNC_SCHEMA_SKIP（#321）；
    // 全部是 IF NOT EXISTS／OR IGNORE，重跑不影響既有資料
    const out = (await compactSchemaStatements()).filter(t => !skipSchemaStatement(t)).map(t => `${t.replace(/\s+/g, ' ')};`);
    for (const { sql, values } of changes) { let i = 0; out.push(`${sql.replace(/\?/g, () => sqlValue(values[i++]))};`); }
    const recordDay = Boolean(today) && today !== seed.walksSynced;
    if (recordDay) out.push(`INSERT INTO v3_sync_state(key,value) VALUES('${WALKS_SYNCED_KEY}',${sqlValue(today)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);
    // 同步時間另存 v3_sync_state（ADR 0014，#361）：每次同步寫 1 列，沒有 small 觸發器，試算表沒改時 small 不會失效
    const syncedAt = source.dogs?.syncedAt || '';
    if (syncedAt) out.push(`INSERT INTO v3_sync_state(key,value) VALUES('${SYNCED_AT_KEY}',${sqlValue(syncedAt)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);
    return { sql: out.join('\n') + '\n', rows: changes.length + Number(recordDay) + Number(Boolean(syncedAt)) };
  } finally { db.close(); }
}

export async function buildSyncSql(seed, source, options) {
  return (await buildSyncPlan(seed, source, options)).sql;
}

// ADR 0014（#364）：出所滿 60 天的離所定下來，平常的同步不讀也不改。
// 只讀 60 天內（或日期不明）的離所與明細，狗和編號照主鍵（dog_id）讀：上一次主清單上的、這些離所的、
// 試算表這次的編號（找回來的狗）、這次要讀的溜狗紀錄的。記憶體 D1 裡沒有舊離所，寫回時比不出差異，不會被刪。
export const SETTLED_DAYS = 60;
export function departureCutoff(today) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - SETTLED_DAYS);
  return d.toISOString().slice(0, 10);
}
export function narrowSeedSql({ cutoff, numbers = [], walksSql }) {
  const recent = `SELECT * FROM v3_departures WHERE departed_date IS NULL OR departed_date='' OR departed_date>=${sqlValue(cutoff)}`;
  const nums = [...new Set(numbers.filter(Boolean))];
  const dogIds = [
    'SELECT dog_id FROM v3_sheet_main',
    `SELECT dog_id FROM (${recent})`,
    ...(nums.length ? [`SELECT dog_id FROM v3_dog_numbers WHERE number IN (${nums.map(sqlValue).join(',')})`] : []),
    `SELECT dog_id FROM (${walksSql})`,
  ].join(' UNION ');
  return {
    v3_dogs: `SELECT * FROM v3_dogs WHERE dog_id IN (${dogIds})`,
    v3_dog_numbers: `SELECT * FROM v3_dog_numbers WHERE dog_id IN (${dogIds})`,
    v3_intros: `SELECT * FROM v3_intros WHERE dog_id IN (${dogIds})`,
    v3_departures: recent,
    v3_departure_items: `SELECT * FROM v3_departure_items WHERE number IN (SELECT number FROM (${recent}))`,
  };
}

// 12 張表同時讀：每叫一次 npx wrangler 要 3 秒左右，一張一張讀會讓頁首「更新」多等半分鐘
// 上一次同步的日期先單獨讀（溜狗紀錄要從哪天讀看它，ADR 0010），順便讓 npx 把 wrangler 下載好，其餘再一起叫，免得同時下載互搶快取
// 任何一張表讀不到就整個停：當成空的會把累積的溜狗紀錄、離所整份換掉
// 只有還沒建表的群名表可以當成空的；v3_sync_state 還沒建（沒記過日期）就整張讀溜狗紀錄
// full：全量核對（溜狗紀錄、離所、狗都整張讀）；checks(since)：6:30 保險同步要用主鍵核對的 [{ number, name, date }]（見 walkSeedSql）
// numbers：試算表這次的編號；today：台灣時間的今天，離所從 60 天前讀起（ADR 0014）
// 回傳 { 表名: 列, walksSynced（上一次同步的日期）, since（溜狗紀錄從哪天讀，'' 是整張） }
export async function readSeed(query, { full = false, checks = () => [], numbers = [], today = formatDate(new Date()) } = {}) {
  const missing = e => /no such table/i.test(String(e?.stdout ?? '') + e.message);
  const walksSynced = (await query(WALKS_SYNCED_SQL).catch(e => { if (missing(e)) return []; throw e; }))[0]?.value || '';
  const since = walkSince(walksSynced, { full });
  const tables = Object.keys(SEED_TABLES);
  const walksSql = walkSeedSql(since, checks(since));
  const narrow = full ? {} : narrowSeedSql({ cutoff: departureCutoff(today), numbers, walksSql });
  const sqlOf = t => (t === 'v3_walks' ? walksSql : narrow[t] || SEED_TABLES[t]);
  const read = t => query(sqlOf(t)).catch(e => { if (OPTIONAL_TABLES.has(t) && missing(e)) return []; throw e; });
  const results = await Promise.all(tables.map(read));
  return { ...Object.fromEntries(tables.map((t, i) => [t, results[i]])), walksSynced, since };
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
// 只有這次要寫的列數超過單次門檻才讓 CI 失敗；今天帳號已寫多少跟 PR 的程式無關，只列出來提醒
export function dryRunReport(planned, todayWritten, limits) {
  const problem = budgetProblem(planned, null, limits);
  const daily = budgetProblem(planned, todayWritten, { ...limits, maxRows: Infinity });
  const used = `${todayWritten === null ? '查不到' : `${todayWritten} 列`}${daily ? '（已超過每天預算，跟這張 PR 無關，但今天正式同步會停寫）' : ''}`;
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

// mode（SYNC_MODE）：daily＝6:30 保險同步（Worker 叫的）、full＝手動勾「全量核對」，空的是平常的同步（ADR 0010）
async function main({ dryRun = false, mode = '' } = {}) {
  // D1 的溜狗紀錄沒有 mine，要靠代號推回來；沒有 WALKER_KEY 會把「我溜過」的日期算錯，寧可不同步
  if (!process.env.WALKER_KEY) throw new Error('沒有設定 WALKER_KEY，無法比對溜狗紀錄');
  const now = new Date();
  const sheet = await buildData(fetch, now, async () => '');
  const groupTable = await fetchGviz('常遛狗群');
  const dogNames = new Set(sheet.dogs.map(d => d.name));
  const groupColumns = parseGroupColumns(groupTable, dogNames);
  const groupLabels = parseGroupLabels(groupTable, dogNames);
  const rows = await loadDepartedRows(fetch, now);
  const daily = mode === 'daily';
  const checks = () => (daily ? lastWalkChecks(sheet) : []);
  const seed = await readSeed(async sql => JSON.parse(await wranglerAsync(['--json', '--command', sql]))[0].results, { full: mode === 'full', checks, numbers: sheet.dogs.map(d => d.id), today: formatDate(now) });
  let plan;
  const { sql, rows: planned } = await buildSyncPlan(seed, async db => {
    plan = planSync(await readPrevious(db), sheet, rows, now, { since: seed.since, daily });
    return { ...plan, groupColumns, groupLabels };
  }, { today: formatDate(now) });
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
  const message = `已同步：寫入 ${planned} 列（今天帳號已寫 ${used}）。共 ${plan.dogs.dogs.length} 隻狗、比對 ${seed.since ? `${seed.since} 以後` : '全部'}${daily ? '（加上每隻狗最後一次）' : ''}的 ${plan.walks.walks.length} 筆溜狗紀錄、${plan.departures.length} 筆離所、${groupColumns.filter(c => c.length).length} 欄常遛狗群。`;
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
  main({ dryRun, mode: process.env.SYNC_MODE || '' }).catch(async e => {
    if (dryRun) {
      const text = dryRunFailure(e);
      await summary(text).catch(() => {});
      await writeDryRunComment(text).catch(() => {});
      console.error(`預演失敗，沒有寫入：${e.message}`);
    } else console.error(`同步失敗，D1 保留上一次的內容：${e.message}`);
    process.exit(1);
  });
}
