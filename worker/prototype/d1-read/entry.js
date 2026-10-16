// 丟棄式原型（prototype/d1-read-reduction）：量 D1 每個查詢回傳的 meta.rows_read，
// 比較「現在每次都讀整張表」和「歷史資料包＋今天紀錄＋記憶體快取」。只接原型 D1，不合併進 main
import { readDogsPayload, readWalks, readDepartures, readRest, HISTORY_START } from '../../src/compact.js';

// 包住 D1：每個 statement 的 meta.rows_read 記到 log。first() 改走 all()，才拿得到 meta
function meter(db, log) {
  const wrap = (stmt, sql) => ({
    _raw: stmt, _sql: sql,
    bind: (...a) => wrap(stmt.bind(...a), sql),
    async all() { const r = await stmt.all(); log.push({ sql, rows_read: r.meta.rows_read, rows_written: r.meta.rows_written }); return r; },
    async first(col) { const r = await this.all(); const row = (r.results || [])[0] ?? null; return col && row ? row[col] : row; },
    async run() { const r = await stmt.run(); log.push({ sql, rows_read: r.meta.rows_read, rows_written: r.meta.rows_written }); return r; },
  });
  return {
    prepare: sql => wrap(db.prepare(sql), sql),
    async batch(stmts) {
      const res = await db.batch(stmts.map(s => s._raw));
      res.forEach((r, i) => log.push({ sql: stmts[i]._sql, rows_read: r.meta.rows_read, rows_written: r.meta.rows_written }));
      return res;
    },
  };
}
const sum = (log, k = 'rows_read') => log.reduce((n, x) => n + (x[k] || 0), 0);
const json = (v, s = 200) => new Response(JSON.stringify(v, null, 1), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });
const ymd = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10); // 台灣日期

// ---- 現在的做法 ----
async function oldBody(db, what) {
  if (what === 'dogs') return { ok: true, ...await readDogsPayload(db) };
  if (what === 'walks') return { ok: true, ...await readWalks(db) };
  if (what === 'departures') return { ok: true, version: 1, departures: await readDepartures(db) };
  if (what === 'rest') return { ok: true, rest: await readRest(db) };
  throw new Error('?');
}

// ---- 新做法 ----
// 走同一套分組：同一隻狗同一天一筆，依日期排
function groupWalks(rows) {
  const days = new Map();
  for (const r of rows) {
    const key = `${r.dog_id}|${r.walk_date}`;
    if (!days.has(key)) days.set(key, { id: r.dog_number, name: r.dog_name, date: r.walk_date });
    if (r.walker_code !== null) (days.get(key).walkers ||= []).push(r.walker_code);
  }
  return [...days.values()];
}
const WALK_COLS = 'dog_id,walk_date,walker_code,dog_number,dog_name';
const WALK_ORDER = 'ORDER BY walk_date,dog_number,dog_name,position';

// 重算歷史資料包（同步、改介紹／休養等「歷史」資料後跑一次）：昨天以前的溜狗紀錄＋其他整包資料
async function buildPack(db, cutoff) {
  const hist = (await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks WHERE walk_date < ? ${WALK_ORDER}`).bind(cutoff).all()).results;
  const pack = {
    cutoff,
    dogs: await readDogsPayload(db),
    departures: await readDepartures(db),
    rest: await readRest(db),
    walks: groupWalks(hist),
  };
  const body = JSON.stringify(pack);
  await db.batch([
    db.prepare('INSERT INTO proto_pack(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').bind(body),
    db.prepare('UPDATE proto_versions SET hist=hist+1 WHERE id=1'),
  ]);
  return body.length;
}

// 每台機器（isolate）的記憶體快取
let cache = null;
const CHECK_MS = 60e3;
async function fresh(db, now, cold) {
  if (cold) cache = null;
  const today = ymd(now), yesterday = ymd(now - 864e5);
  if (cache && now - cache.checkedAt < CHECK_MS && cache.today === today) return cache;
  const v = await db.prepare('SELECT hist,today FROM proto_versions WHERE id=1').first();
  const c = cache && cache.today === today ? cache : { today };
  if (c.hist !== v.hist) { c.pack = JSON.parse((await db.prepare('SELECT json FROM proto_pack WHERE id=1').first()).json); c.hist = v.hist; c.todayV = null; }
  if (c.todayV !== v.today) {
    // 資料包切在 cutoff，之後的列都即時讀（cutoff 正常是昨天；資料包舊了也不會漏列）
    const from = c.pack.cutoff < yesterday ? c.pack.cutoff : yesterday;
    // 不在 SQL 排序（D1 排序會把讀到的列再算一次），讀出來在記憶體照原本的順序排
    const rows = (await db.prepare(`SELECT ${WALK_COLS},position FROM v3_walks WHERE walk_date >= ?`).bind(c.pack.cutoff).all()).results;
    const k = r => [r.walk_date, r.dog_number, r.dog_name];
    rows.sort((a, b) => { const x = k(a), y = k(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return a.position - b.position; });
    c.live = groupWalks(rows);
    c.todayV = v.today; c.from = from;
  }
  c.checkedAt = now;
  return (cache = c);
}
function newBody(c, what) {
  if (what === 'dogs') return { ok: true, ...c.pack.dogs };
  if (what === 'walks') return { ok: true, version: 1, historyStart: HISTORY_START, walks: [...c.pack.walks, ...c.live] };
  if (what === 'departures') return { ok: true, version: 1, departures: c.pack.departures };
  if (what === 'rest') return { ok: true, rest: c.pack.rest };
  throw new Error('?');
}

const SETUP = [
  'CREATE INDEX IF NOT EXISTS proto_walks_date ON v3_walks(walk_date)',
  'CREATE TABLE IF NOT EXISTS proto_pack (id INTEGER PRIMARY KEY, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS proto_versions (id INTEGER PRIMARY KEY, hist INTEGER NOT NULL, today INTEGER NOT NULL)',
  'INSERT OR IGNORE INTO proto_versions VALUES (1,0,0)',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const q = url.searchParams;
    const now = Number(q.get('now') || Date.now());
    const log = [];
    const db = meter(env.DB, log);
    const p = url.pathname.split('/').filter(Boolean);
    try {
      if (p[0] === 'setup') { for (const s of SETUP) await db.prepare(s).run(); return json({ log }); }
      if (p[0] === 'drop-index') { await db.prepare('DROP INDEX IF EXISTS proto_walks_date').run(); return json({ log }); }
      if (p[0] === 'build') { const bytes = await buildPack(db, q.get('cutoff') || ymd(now - 864e5)); cache = null; return json({ bytes, rows_read: sum(log), rows_written: sum(log, 'rows_written'), log }); }
      if (p[0] === 'old') { const body = await oldBody(db, p[1]); return json({ rows_read: sum(log), log, size: JSON.stringify(body).length }); }
      // cold=1：當成剛開的新機器（沒有記憶體快取），量最壞情況；不影響原本那份快取
      if (p[0] === 'new') { const cold = q.get('cold') === '1', keep = cache; const c = await fresh(db, now, cold); if (cold) cache = keep; newBody(c, p[1]); return json({ rows_read: sum(log), log }); }
      if (p[0] === 'compare') {
        const out = {};
        for (const w of ['dogs', 'walks', 'departures', 'rest']) {
          const a = JSON.stringify(await oldBody(db, w));
          const b = JSON.stringify(newBody(await fresh(db, now, true), w));
          out[w] = { same: a === b, bytes: a.length, ...(a === b ? {} : { firstDiff: [...a].findIndex((ch, i) => ch !== b[i]) }) };
        }
        return json(out);
      }
      // 登記溜狗：寫一列今天的紀錄，今日版本號 +1
      if (p[0] === 'walk') {
        const d = ymd(now);
        const dog = await db.prepare('SELECT dog_id,number,name FROM v3_sheet_main WHERE row_index=?').bind(Number(q.get('row') || 1)).first();
        await db.batch([
          db.prepare('INSERT OR IGNORE INTO v3_walks(dog_id,walk_date,position,walker_name,walker_code,dog_number,dog_name) VALUES(?,?,?,?,?,?,?)').bind(dog.dog_id, d, Number(q.get('pos') || 0), '原型', 'proto0000000', dog.number, dog.name),
          db.prepare('UPDATE proto_versions SET today=today+1 WHERE id=1'),
        ]);
        return json({ rows_read: sum(log), rows_written: sum(log, 'rows_written'), log });
      }
      // 單一查詢：直接量 rows_read
      if (p[0] === 'sql') { const r = await env.DB.prepare(q.get('q')).all(); return json({ rows_read: r.meta.rows_read, n: r.results.length, first: r.results[0] }); }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.stack || e), log }, 500);
    }
  },
};
