// 丟棄式原型第二輪：快取失效與同步。
// 版本號由觸發器在「資料包會用到的表」每改一列就 +1，不靠每個寫入路徑自己記得改版本號。
// 資料包拆兩份：small（狗清單、離所、休養）和 walks（今天以前的溜狗紀錄），各有自己的版本號。
import { readDogsPayload, readWalks, readDepartures, readRest, HISTORY_START } from '../../src/compact.js';
import { readTodayWalks } from '../../src/today.js';

const SMALL_TABLES = ['v3_sheet_main', 'v3_intros', 'v3_sheet_main_walkers', 'v3_dog_numbers', 'v3_sheet_groups', 'v3_sheet_changes', 'v3_sheet_group_labels', 'v3_departures', 'v3_departure_items', 'v3_rest'];
export const INVAL_SETUP = [
  'DROP TABLE IF EXISTS proto_ver',
  'CREATE TABLE proto_ver (id INTEGER PRIMARY KEY, small INTEGER NOT NULL, walks INTEGER NOT NULL, live INTEGER NOT NULL, cutoff TEXT NOT NULL)',
  "INSERT INTO proto_ver VALUES (1,0,0,0,'')",
  'CREATE TABLE IF NOT EXISTS proto_pack2 (part TEXT PRIMARY KEY, ver INTEGER NOT NULL, json TEXT NOT NULL)',
  'DELETE FROM proto_pack2',
  ...SMALL_TABLES.flatMap(t => ['INSERT', 'UPDATE', 'DELETE'].map(op => `CREATE TRIGGER IF NOT EXISTS proto_${t}_${op} AFTER ${op} ON ${t} BEGIN UPDATE proto_ver SET small=small+1 WHERE id=1; END`)),
  // 溜狗紀錄：切點（資料包算到哪天）以前的列改了才動歷史版本號；今天的列只動 live 版本號
  ...['INSERT', 'UPDATE', 'DELETE'].map(op => { const d = op === 'INSERT' ? 'NEW.walk_date' : op === 'DELETE' ? 'OLD.walk_date' : 'MIN(OLD.walk_date,NEW.walk_date)'; return `CREATE TRIGGER IF NOT EXISTS proto_v3_walks_${op} AFTER ${op} ON v3_walks BEGIN UPDATE proto_ver SET walks=walks+(${d}<cutoff), live=live+(${d}>=cutoff) WHERE id=1; END`; }),
];
export const INVAL_TEARDOWN = [
  ...SMALL_TABLES.flatMap(t => ['INSERT', 'UPDATE', 'DELETE'].map(op => `DROP TRIGGER IF EXISTS proto_${t}_${op}`)),
  ...['INSERT', 'UPDATE', 'DELETE'].map(op => `DROP TRIGGER IF EXISTS proto_v3_walks_${op}`),
];

const WALK_COLS = 'dog_id,walk_date,walker_code,dog_number,dog_name,position';
function groupWalks(rows) {
  const days = new Map();
  for (const r of rows) {
    const key = `${r.dog_id}|${r.walk_date}`;
    if (!days.has(key)) days.set(key, { id: r.dog_number, name: r.dog_name, date: r.walk_date });
    if (r.walker_code !== null) (days.get(key).walkers ||= []).push(r.walker_code);
  }
  return [...days.values()];
}
function sortWalks(rows) {
  const k = r => [r.walk_date, r.dog_number, r.dog_name];
  return rows.sort((a, b) => { const x = k(a), y = k(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return a.position - b.position; });
}

// 重算一份資料包。ver 用「開始重算前」讀到的版本號：重算途中有人改，下次檢查版本號還是會不同，會再算一次
async function rebuild(db, part, ver, cutoff) {
  let body;
  if (part === 'small') body = { dogs: await readDogsPayload(db), departures: await readDepartures(db), rest: await readRest(db) };
  else body = { cutoff, walks: groupWalks(sortWalks((await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks WHERE walk_date < ?`).bind(cutoff).all()).results)) };
  if (part === 'walks') await db.prepare('UPDATE proto_ver SET cutoff=? WHERE id=1').bind(cutoff).run();
  await db.prepare('INSERT INTO proto_pack2(part,ver,json) VALUES(?,?,?) ON CONFLICT(part) DO UPDATE SET ver=excluded.ver,json=excluded.json').bind(part, ver, JSON.stringify(body)).run();
  return body;
}

// 記憶體快取，每台機器一份。stats 記這台機器重算過幾次
let mem = null;
export function resetMem() { mem = null; }
export async function fresh2(db, now, { today, checkMs = 60e3, cold = false } = {}) {
  let c = cold ? null : mem;
  if (c && now - c.checkedAt < checkMs && c.today === today) return c;
  const v = await db.prepare('SELECT small,walks,live FROM proto_ver WHERE id=1').first();
  c = c && c.today === today ? c : { today };
  for (const part of ['small', 'walks']) {
    if (c[part] && c[part].ver === v[part]) continue;
    // 先看 D1 裡的資料包是不是已經是最新（別台機器可能算好了），不是才自己重算
    const row = await db.prepare('SELECT ver,json FROM proto_pack2 WHERE part=?').bind(part).first();
    let body;
    if (row && row.ver === v[part] && (part === 'small' || JSON.parse(row.json).cutoff <= today)) body = JSON.parse(row.json);
    else body = await rebuild(db, part, v[part], part === 'walks' ? today : null);
    c[part] = { ver: v[part], body };
    if (part === 'walks') c.liveVer = null;
  }
  // 資料包切點之後的列（正常是今天）即時讀；walks 版本號變了才重讀
  if (c.liveVer !== v.live) {
    c.live = groupWalks(sortWalks((await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks WHERE walk_date >= ?`).bind(c.walks.body.cutoff).all()).results));
    c.liveVer = v.live;
  }
  c.checkedAt = now;
  if (!cold) mem = c;
  return c;
}
export function body2(c, what) {
  const s = c.small.body;
  if (what === 'dogs') return { ok: true, ...s.dogs };
  if (what === 'walks') return { ok: true, version: 1, historyStart: HISTORY_START, walks: [...c.walks.body.walks, ...c.live] };
  if (what === 'departures') return { ok: true, version: 1, departures: s.departures };
  if (what === 'rest') return { ok: true, rest: s.rest };
}
export async function oldBody2(db, what) {
  if (what === 'dogs') return { ok: true, ...await readDogsPayload(db) };
  if (what === 'walks') return { ok: true, ...await readWalks(db) };
  if (what === 'departures') return { ok: true, version: 1, departures: await readDepartures(db) };
  if (what === 'rest') return { ok: true, rest: await readRest(db) };
}
export { readTodayWalks };
