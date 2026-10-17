// 原型（丟棄式）：資料累積 1／5／10／20 年後，每種操作讀 D1 幾列、一天合計會不會超過免費方案。
// 執行：node scripts/prototype/capacity-20y.mjs
// 讀取列數用「D1 照掃過的列計費」估：查詢計畫是整表 SCAN 就算整張表的列數，SQL 排序（TEMP B-TREE）再加一次回傳列數，
// 其餘算回傳列數。2026-10-16 原型在真的 D1 上量過這三條規則（docs/research/2026-10-16-d1-read-prototype.md）。
import { DatabaseSync } from 'node:sqlite';
import worker from '../../worker/src/index.js';
import { resetPackCache } from '../../worker/src/packs.js';
import { migrateCompactDatabase } from '../migrate-compact-db.mjs';
import { importCompactDogs } from '../import-compact-dogs.mjs';
import { readSeed, lastWalkChecks } from '../sync-compact-d1.mjs';

// ---- 會計費的假 D1 ----
function billedD1() {
  const sqlite = new DatabaseSync(':memory:');
  const stats = { read: 0, written: 0, scans: new Map() };
  const count = t => sqlite.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
  const bill = (sql, values, returned) => {
    let scanned = 0, sort = 0;
    try {
      for (const { detail } of sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values)) {
        const m = /^SCAN (\w+)(?: AS \w+)?$/.exec(detail) || /^SCAN (\w+)(?: AS \w+)? USING (?:COVERING )?INDEX/.exec(detail);
        if (m && /^v3_/.test(m[1])) { const n = count(m[1]); scanned += n; stats.scans.set(sql.slice(0, 90), n); }
        if (/TEMP B-TREE FOR ORDER BY/.test(detail)) sort = returned;
      }
    } catch { /* DDL 等不計 */ }
    stats.read += Math.max(scanned, returned) + sort;
  };
  const changesBefore = () => sqlite.prepare('SELECT total_changes() AS n').get().n;
  const prepare = (sql, values = []) => ({
    bind: (...a) => prepare(sql, a),
    async run() {
      const st = sqlite.prepare(sql);
      if (st.columns().length) { const r = st.all(...values); bill(sql, values, r.length); return { success: true, results: r, meta: {} }; }
      const c0 = changesBefore();
      const r = st.run(...values);
      stats.written += changesBefore() - c0;
      bill(sql, values, 0);
      return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    async all() { const r = sqlite.prepare(sql).all(...values); bill(sql, values, r.length); return { success: true, results: r, meta: {} }; },
    async first(col) { const r = sqlite.prepare(sql).get(...values); bill(sql, values, r ? 1 : 0); return r ? (col ? r[col] : { ...r }) : null; },
  });
  return {
    prepare, stats, sqlite,
    async batch(list) { sqlite.exec('BEGIN'); try { const out = []; for (const s of list) out.push(await s.run()); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } },
    async exec(sql) { sqlite.exec(sql); },
  };
}

// ---- 假資料：比例照正式（主清單約 120 隻、溜狗約 55 筆／天、志工約 150 人）----
const RESIDENT = 120, WALKS_PER_DAY = 55, DEPART_PER_YEAR = 150, EDITS_PER_DAY = 10, NEW_VOLUNTEERS_PER_YEAR = 60;
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // Worker 用真的時鐘，資料往前長
const day = (base, i) => new Date(Date.parse(base) + i * 86400e3).toISOString().slice(0, 10);
const code = i => (0x100000000000 + i).toString(16).slice(-12);
const num = i => String(2000000000 + i);

async function build(years) {
  const DB = billedD1();
  await migrateCompactDatabase(DB);
  const dogs = Array.from({ length: RESIDENT }, (_, i) => ({ cage: `A${i}`, id: num(i), name: `狗${i}`, walkedDate: TODAY, covered: false, myWalked: false, walkers: [code(i % 150)], note: '', sex: 'female', intro: '介紹'.repeat(40), myWalkedDate: null }));
  await importCompactDogs(DB, { version: 1, syncedAt: `${TODAY}T08:00:00+08:00`, dogs });
  const sql = DB.sqlite;
  sql.exec('PRAGMA foreign_keys=OFF; BEGIN');
  const ids = sql.prepare('SELECT dog_id, number FROM v3_dog_numbers').all();
  const days = years * 365, start = day(TODAY, -days);
  const insWalk = sql.prepare("INSERT OR IGNORE INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) VALUES(?,?,0,?,?,?)");
  for (let d = 0; d < days; d++) for (let k = 0; k < WALKS_PER_DAY; k++) { const g = ids[(d * 7 + k) % ids.length]; insWalk.run(g.dog_id, day(start, d), code(k % 150), g.number, '狗'); }
  // 歷年出所的狗、入所事件、編輯紀錄、志工
  const insDog = sql.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)"), insNum = sql.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)');
  const insDep = sql.prepare("INSERT INTO v3_departures(number,dog_id,name,departed_date,reason,last_number,last_name,last_cage,last_intro) VALUES(?,?,?,?,'adopt',?,?,'A1',?)");
  const insItem = sql.prepare("INSERT INTO v3_departure_items(number,kind,position,value) VALUES(?,'flag',0,'x')");
  const insIntake = sql.prepare("INSERT INTO v3_intake_events(dog_id,position,number,event_date,event) VALUES(?,0,?,?,'入所')");
  const insLog = sql.prepare("INSERT INTO v3_edit_log(at,editor_name,kind,dog_number,before_json,after_json) VALUES(?,'志工','intro',?,'\"a\"','\"b\"')");
  const insVol = sql.prepare('INSERT OR IGNORE INTO v3_volunteers(name,last_seen) VALUES(?,?)');
  for (let i = 0; i < years * DEPART_PER_YEAR; i++) {
    const id = `old${i}`, n = num(100000 + i), date = day(start, Math.floor(i * 365 / DEPART_PER_YEAR));
    insDog.run(id, `舊${i}`); insNum.run(n, id); insDep.run(n, id, `舊${i}`, date, n, `舊${i}`, '介紹'.repeat(40)); insItem.run(n); insIntake.run(id, n, date);
  }
  for (let d = 0; d < days; d++) for (let k = 0; k < EDITS_PER_DAY; k++) insLog.run(`${day(start, d)}T10:00:00Z`, num(k));
  for (let i = 0; i < 150 + years * NEW_VOLUNTEERS_PER_YEAR; i++) insVol.run(`志工${i}`, TODAY);
  sql.exec("INSERT INTO v3_sync_state(key,value) VALUES('walks_synced','" + day(TODAY, -1) + "') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  sql.exec('COMMIT; PRAGMA foreign_keys=ON');
  return { DB, dogs };
}

const SITE = 'https://bq-shelter-dogs.<子網域>.workers.dev';
const get = (DB, path) => worker.fetch(new Request(`${SITE}/api${path}`, { headers: { 'Sec-Fetch-Site': 'same-origin' } }), { DB, ALLOWED_ORIGINS: SITE });
const PAGE = ['/dogs', '/walks', '/rest', '/today'];
async function cost(DB, fn) { const r0 = DB.stats.read, w0 = DB.stats.written; await fn(); return { read: DB.stats.read - r0, written: DB.stats.written - w0 }; }
const page = DB => async () => { for (const p of PAGE) { const r = await get(DB, p); if (r.status !== 200) throw new Error(`${p} ${r.status}`); await r.text(); } };

async function measure(years) {
  const { DB, dogs } = await build(years);
  const t0 = Date.now();
  const out = { years, walks: DB.sqlite.prepare('SELECT COUNT(*) n FROM v3_walks').get().n };
  // 第一次（把歷史包好；上線後只有一次，之後跨日只補昨天）
  resetPackCache(); out.firstEver = (await cost(DB, page(DB))).read;
  resetPackCache(); out.coldMachine = (await cost(DB, page(DB))).read; // 新機器、資料包已在 D1
  out.warm = (await cost(DB, page(DB))).read; // 同一台機器、沒變
  // Worker 的 CPU：新機器第一次讀溜狗紀錄（解析所有年份的資料包＋組回應）；回應多大（手機要下載）
  resetPackCache();
  let t = performance.now(); const body = await (await get(DB, '/walks')).text(); out.coldWalksCpuMs = Math.round(performance.now() - t);
  out.walksResponseKB = Math.round(body.length / 1024);
  t = performance.now(); await (await get(DB, '/walks')).text(); out.warmWalksCpuMs = Math.round(performance.now() - t);
  // #347 之後：圖鑑我溜過的狗（新機器）、按年拿一年（月曆往前翻）
  const post = (path, body) => worker.fetch(new Request(`https://bq-shelter-dogs.<子網域>.workers.dev/api${path}`, { method: 'POST', headers: { Origin: 'https://bq-shelter-dogs.<子網域>.workers.dev', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { DB });
  resetPackCache(); out.mineCold = (await cost(DB, async () => { const r = await post('/walks/mine', { codes: ['aaaaaaaaaaaa'] }); if (r.status !== 200) throw new Error(`mine ${r.status}`); await r.text(); })).read;
  out.mineWarm = (await cost(DB, async () => (await post('/walks/mine', { codes: ['aaaaaaaaaaaa'] })).text())).read;
  const lastYear = String(+TODAY.slice(0, 4) - 1);
  resetPackCache(); t = performance.now(); const yb = await (await get(DB, `/walks?year=${lastYear}`)).text(); out.yearCpuMs = Math.round(performance.now() - t); out.yearKB = Math.round(yb.length / 1024);
  out.departures = (await cost(DB, async () => (await get(DB, '/departures')).text())).read;
  // 改一筆介紹 → small 失效，下一次讀（每台機器各一次）
  DB.sqlite.exec("UPDATE v3_sheet_main SET note=note||'!' WHERE row_index=(SELECT MIN(row_index) FROM v3_sheet_main)");
  out.afterEdit = (await cost(DB, page(DB))).read;
  // 新增今天一筆溜狗 → 只動 live
  DB.sqlite.exec(`INSERT OR IGNORE INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) SELECT dog_id,'${TODAY}',5,'aaaaaaaaaaaa',number,'狗' FROM v3_dog_numbers LIMIT 1`);
  out.afterTodayWalk = (await cost(DB, page(DB))).read;
  // 改去年的紀錄（例如合併志工）→ 那一個月重算
  DB.sqlite.exec(`UPDATE v3_walks SET walker_code='cccccccccccc' WHERE rowid=(SELECT MIN(rowid) FROM v3_walks WHERE walk_date='${day(TODAY, -300)}')`);
  out.afterOldEdit = (await cost(DB, page(DB))).read;
  // 同步讀 D1 現況（平常／6:30 保險）
  const query = async s => (await DB.prepare(s).all()).results;
  const sheet = { dogs };
  out.syncRead = (await cost(DB, () => readSeed(query, { checks: () => [] }))).read;
  out.syncDaily = (await cost(DB, () => readSeed(query, { checks: () => lastWalkChecks(sheet).map(c => ({ ...c, name: '狗' })) }))).read;
  // 資料包大小、資料庫大小
  out.biggestPackKB = Math.round(DB.sqlite.prepare("SELECT MAX(len) m FROM (SELECT year, SUM(length(body)) len FROM v3_walk_packs GROUP BY year)").get().m / 1024);
  out.dbMB = Math.round(DB.sqlite.prepare('SELECT page_count*page_size s FROM pragma_page_count(), pragma_page_size()').get().s / 1048576);
  out.scans = [...DB.stats.scans].filter(([, n]) => n > 1000).map(([s, n]) => `${n}: ${s}`);
  out.ms = Date.now() - t0;
  return out;
}

// 一天的最壞估算：I 台機器，每次失效每台都要重讀；同步最多 12 次＋保險 1 次（ADR 0012）
function daily(m, { I = 5, syncs = 12, edits = EDITS_PER_DAY, pageLoads = 300, todayPolls = 5 * 60 * 14 } = {}) {
  const read = I * m.coldMachine // 每台機器一天至少冷啟動一次
    + I * (syncs + edits) * m.afterEdit // 每次同步、每次編輯都讓 small 失效
    + I * WALKS_PER_DAY * m.afterTodayWalk // 每登記一筆溜狗，各台重讀今天
    + pageLoads * m.warm + todayPolls * 1 // 平常每次只讀版本號
    + I * m.afterOldEdit // 一天改一次舊紀錄
    + syncs * m.syncRead + m.syncDaily;
  return read;
}

const LIMIT = { read: 5_000_000, write: 100_000, dbMB: 500, packRowMB: 2 };
const rows = [];
for (const y of (process.argv[2] || '1,5,10,20').split(',').map(Number)) {
  const m = await measure(y);
  m.dailyWorst = daily(m);
  m.dailyBusy = daily(m, { I: 10, syncs: 12, edits: 30, pageLoads: 1000 });
  rows.push(m);
  console.error(`${y} 年完成（${m.ms} ms）`);
}
console.log(JSON.stringify({ limits: LIMIT, rows }, null, 1));
