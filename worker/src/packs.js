// 資料包（ADR 0009，#315）：很少變的資料預先算好存在 D1，Worker 每次只讀 1 列版本號，有變才讀資料包或重算。
// small：狗清單、離所、休養；溜狗紀錄：切點（cutoff，正常是今天）以前的按月分段（#320），一年存一份；今天的紀錄另外只讀今天的列。
// 版本號由 db/compact-schema.sql 的觸發器自動加 1，所以網站、同步、別台 Worker 機器寫入都看得到。
// 輸出和直接讀表（compact.js 的 readDogsPayload 等）逐字元相同
import { readDogsPayload, readDepartures, readRest, HISTORY_START } from './compact.js';

// D1 一列上限 2 MB；資料包一律分段存，每段最多這麼多位元組（測試會調小）
let chunkBytes = 1_000_000;
export function setPackChunkBytes(n) { chunkBytes = n; }

let mem = null; // { db, small, walks: { total, months: { 月: { ver, list } } }, live: { ver, cutoff, list } }
export function resetPackCache() { mem = null; }
// 測試換一台機器用：換上 next（null 是空的記憶體），回傳原本的
export function swapPackCache(next) { const prev = mem; mem = next; return prev; }
function memFor(db) {
  if (!mem || mem.db !== db) mem = { db };
  mem.walks ||= { total: null, months: {} };
  return mem;
}

const WALK_COLS = 'dog_id,walk_date,walker_code,dog_number,dog_name,position';

// 跟 SQLite 的 BINARY（UTF-8 位元組）同樣的順序：UTF-16 只有代理對和 U+E000 以上的字比起來會不同
function cmpText(a, b) {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a.charCodeAt(i), y = b.charCodeAt(i);
    if (x === y) continue;
    if (x >= 0xD800 && y >= 0xD800) { x += x >= 0xE000 ? -0x800 : 0x2000; y += y >= 0xE000 ? -0x800 : 0x2000; }
    return x - y;
  }
  return a.length - b.length;
}

// 跟 readWalks 一樣：依日期、編號、狗名、順位排（不在 SQL 排序，D1 排序會讓讀取量加倍），一隻狗一天一筆
function groupWalks(rows) {
  rows.sort((a, b) => cmpText(a.walk_date, b.walk_date) || cmpText(a.dog_number, b.dog_number) || cmpText(a.dog_name, b.dog_name) || a.position - b.position);
  const days = new Map();
  for (const r of rows) {
    const key = `${r.dog_id}|${r.walk_date}`;
    if (!days.has(key)) days.set(key, { id: r.dog_number, name: r.dog_name, date: r.walk_date });
    if (r.walker_code !== null) (days.get(key).walkers ||= []).push(r.walker_code);
  }
  return [...days.values()];
}

// 切成每段不超過 chunkBytes 位元組（UTF-8），不切開一個字
function chunks(text) {
  const out = [];
  let start = 0, bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const pair = c >= 0xD800 && c < 0xDC00;
    const size = c < 0x80 ? 1 : c < 0x800 ? 2 : pair ? 4 : 3;
    if (bytes + size > chunkBytes && i > start) { out.push(text.slice(start, i)); start = i; bytes = 0; }
    bytes += size;
    if (pair) i++;
  }
  out.push(text.slice(start));
  return out;
}

// D1 裡的資料包：版本號（和切點）相符才用，不然回 null
async function loadPack(db, part, ver, cutoff) {
  const { results = [] } = await db.prepare('SELECT seq,ver,cutoff,body FROM v3_packs WHERE part=?').bind(part).all();
  results.sort((a, b) => a.seq - b.seq);
  if (!results.length || results.some((r, i) => r.seq !== i || r.ver !== ver || r.cutoff !== cutoff)) return null;
  return JSON.parse(results.map(r => r.body).join(''));
}

// 存資料包；存失敗只記日誌（這只是快取，下次再算）
async function savePack(db, part, ver, cutoff, body) {
  try {
    await db.batch([
      db.prepare('DELETE FROM v3_packs WHERE part=?').bind(part),
      ...chunks(JSON.stringify(body)).map((text, seq) => db.prepare('INSERT INTO v3_packs(part,seq,ver,cutoff,body) VALUES(?,?,?,?,?)').bind(part, seq, ver, cutoff, text)),
    ]);
  } catch (e) {
    console.error('pack', part, e);
  }
}

// ver 一律用「開始重算前」讀到的版本號：重算途中有人改，版本號已經往前，下次會再算
async function smallPack(db, ver) {
  if (mem.small && mem.small.ver === ver) return mem.small.body;
  let body = await loadPack(db, 'small', ver, '');
  if (!body) {
    // 主清單是空的（資料出問題）：狗清單回錯誤，離所、休養照給，也不存資料包
    let dogs = null;
    try { dogs = await readDogsPayload(db); } catch (e) { if (!/沒有資料/.test(e.message)) throw e; }
    body = { dogs, departures: await readDepartures(db), rest: await readRest(db) };
    if (!dogs) return body;
    await savePack(db, 'small', ver, '', body);
  }
  mem.small = { ver, body };
  return body;
}

// ---- 溜狗紀錄按月分段（#320）：每月版本號在 v3_walk_versions.months（JSON），資料包一年一份存在 v3_walk_packs ----
const monthOf = date => date.slice(0, 7);
const yearOf = month => month.slice(0, 4);
function monthEnd(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
// 走 walk_date 索引
const rowsBetween = async (db, from, to) => (await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks WHERE walk_date>=? AND walk_date<?`).bind(from, to).all()).results || [];
// 某個月切點以前的紀錄
async function buildMonth(db, month, cutoff) {
  const end = monthEnd(month);
  return groupWalks(await rowsBetween(db, month + '-01', end < cutoff ? end : cutoff));
}
function groupBy(items, key) {
  const out = new Map();
  for (const x of items) { const k = key(x); if (!out.has(k)) out.set(k, []); out.get(k).push(x); }
  return out;
}

// 一年的資料包：{ vers: { 月: 版本號 }, months: { 月: list } }；沒有或缺段回空的（每個月都對不上版本號，會重算）
async function loadYear(db, year) {
  const { results = [] } = await db.prepare('SELECT seq,vers,body FROM v3_walk_packs WHERE year=?').bind(year).all();
  results.sort((a, b) => a.seq - b.seq);
  if (results.length && results.every((r, i) => r.seq === i && r.vers === results[0].vers)) {
    try { return { vers: JSON.parse(results[0].vers), months: JSON.parse(results.map(r => r.body).join('')) }; } catch (e) { /* 缺段 */ }
  }
  return { vers: {}, months: {} };
}
// 每個月的資料和它的版本號一起存：兩台機器先後存同一年，各月份仍然對得上自己的版本號
async function saveYear(db, year, pack) {
  const vers = JSON.stringify(pack.vers);
  try {
    await db.batch([
      db.prepare('DELETE FROM v3_walk_packs WHERE year=?').bind(year),
      ...chunks(JSON.stringify(pack.months)).map((text, seq) => db.prepare('INSERT INTO v3_walk_packs(year,seq,vers,body) VALUES(?,?,?,?)').bind(year, seq, vers, text)),
    ]);
  } catch (e) {
    console.error('walk pack', year, e);
  }
}
// 資料包裡版本號對得上的月份都放進記憶體
function remember(pack, vers) {
  for (const m of Object.keys(pack.months)) if (pack.vers[m] === vers[m]) mem.walks.months[m] = { ver: vers[m], list: pack.months[m] };
}

function monthsFrom(from, to) {
  const out = [];
  for (let m = from; m <= to; m = monthEnd(m).slice(0, 7)) out.push(m);
  return out;
}
const monthKey = m => `'$."${m}"'`; // 月份只有數字和 -，直接放進 SQL
const bumpMonths = months => months.reduce((sql, m) => `json_set(${sql},${monthKey(m)},COALESCE(json_extract(months,${monthKey(m)}),0)+1)`, 'months');

// 跨日：把舊切點到今天（正常是昨天）的列補進那幾個月，切點移到今天，只讀這些列和那幾年的資料包。
// 先移切點（比對舊切點，別台機器先移了就回 null 重讀版本號），同一句 SQL 讓那幾個月加 1，再讀列：
// 移切點以前的寫入一定讀得到；移完以後才有人改那幾個月，版本號會比這裡存的新，下次重算那個月。
// 存的版本號是「舊的＋1」：移切點前剛好有人改了那個月以前的列，實際版本號更大，也會重算
async function advance(db, v, today) {
  if (!v.cutoff) return advanceFirst(db, v, today);
  const old = JSON.parse(v.months);
  const touched = monthsFrom(monthOf(v.cutoff), monthOf(today));
  const { meta } = await db.prepare(`UPDATE v3_walk_versions SET cutoff=?, total=total+1, months=${bumpMonths(touched)} WHERE id=1 AND cutoff=?`).bind(today, v.cutoff).run();
  if (!meta.changes) return null;
  const vers = { ...old };
  for (const m of touched) vers[m] = (old[m] || 0) + 1;
  const added = groupBy(await rowsBetween(db, v.cutoff, today), r => monthOf(r.walk_date));
  for (const [year, months] of groupBy(touched, yearOf)) {
    const pack = await loadYear(db, year);
    for (const m of months) {
      // 資料包裡的那個月不是用舊版本號算的：舊切點以前的部分重算
      const base = pack.vers[m] === old[m] ? pack.months[m] || [] : await buildMonth(db, m, v.cutoff);
      pack.months[m] = [...base, ...groupWalks(added.get(m) || [])];
      pack.vers[m] = vers[m];
    }
    await saveYear(db, year, pack);
    remember(pack, vers);
  }
  return walkVersions(db);
}

// 第一次（切點是空的，上線後只有一次）：讀今天以前全部的列，每個月從頭算。
// 先讀列、再比對版本號移切點：中間有人寫入（live 或 total 變了）這次不算，回 null 重來
async function advanceFirst(db, v, today) {
  const added = groupBy(await rowsBetween(db, '', today), r => monthOf(r.walk_date));
  const vers = JSON.parse(v.months);
  for (const m of added.keys()) vers[m] = (vers[m] || 0) + 1;
  const months = JSON.stringify(vers);
  const { meta } = await db.prepare('UPDATE v3_walk_versions SET cutoff=?, total=total+1, months=? WHERE id=1 AND cutoff=? AND total=? AND live=?')
    .bind(today, months, v.cutoff, v.total, v.live).run();
  if (!meta.changes) return null;
  for (const [year, list] of groupBy([...added.keys()], yearOf)) {
    const pack = { vers: {}, months: {} };
    for (const m of list) { pack.months[m] = groupWalks(added.get(m)); pack.vers[m] = vers[m]; }
    await saveYear(db, year, pack);
    remember(pack, vers);
  }
  return { ...v, cutoff: today, total: v.total + 1, months };
}

// 切點以前的紀錄：版本號變了的月份才讀那一年的資料包，資料包也對不上才重算那個月
async function history(db, v) {
  if (mem.walks.total === v.total) return;
  const vers = JSON.parse(v.months);
  const stale = Object.keys(vers).filter(m => mem.walks.months[m]?.ver !== vers[m]);
  for (const [year, list] of groupBy(stale, yearOf)) {
    const pack = await loadYear(db, year);
    let changed = false;
    for (const m of list) {
      if (pack.vers[m] === vers[m]) continue;
      pack.months[m] = await buildMonth(db, m, v.cutoff);
      pack.vers[m] = vers[m];
      changed = true;
    }
    if (changed) await saveYear(db, year, pack);
    remember(pack, vers);
  }
  mem.walks.total = v.total;
}

// 今天（切點以後）的紀錄：live 版本號變了才重讀，走 walk_date 索引
async function liveWalks(db, v) {
  if (mem.live && mem.live.ver === v.live && mem.live.cutoff === v.cutoff) return mem.live.list;
  const list = groupWalks((await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks WHERE walk_date>=?`).bind(v.cutoff).all()).results || []);
  mem.live = { ver: v.live, cutoff: v.cutoff, list };
  return list;
}

// 讀不到版本號就報錯，不退回整表讀取：整表讀取量隨歷史一直變多，退回去會悄悄吃光 D1 免費額度（ADR 0009）。
// 版本號表由同步補建（db/compact-schema.sql），有表沒那一列也算壞掉
async function versionRow(db, sql) {
  const v = await db.prepare(sql).first();
  if (!v) throw new Error('D1 沒有資料包版本號，等同步補建');
  return v;
}
const versions = db => versionRow(db, 'SELECT small FROM v3_pack_versions WHERE id=1');
const walkVersions = db => versionRow(db, 'SELECT total,live,cutoff,months FROM v3_walk_versions WHERE id=1');

// 溜狗紀錄（依日期排好）。切點以前讀資料包、以後讀 live，不管切點在哪天都是完整的一份：
// 切點比今天新（時鐘慢一點的機器不把它拉回去）或一直移不了切點，就照現在的切點給，下一次再移
async function packedWalks(db, today) {
  let v = await walkVersions(db);
  memFor(db);
  for (let i = 0; i < 3 && v.cutoff < today; i++) v = await advance(db, v, today) || await walkVersions(db);
  await history(db, v);
  const { months } = mem.walks;
  return [...Object.keys(months).sort().flatMap(m => months[m].list), ...await liveWalks(db, v)];
}

// part 是 dogs／departures／rest；dogs 是 null 表示主清單沒有狗
export async function readSmall(db, part) {
  const v = await versions(db);
  memFor(db);
  return (await smallPack(db, v.small))[part];
}

// 跟 readWalks 一樣的形狀；today 是台灣日期
export async function readWalksPacked(db, today) {
  return { version: 1, historyStart: HISTORY_START, walks: await packedWalks(db, today) };
}

// 狗清單：回新物件，呼叫的人加 photoVersions 不會改到快取
export async function readDogsPacked(db) {
  const dogs = await readSmall(db, 'dogs');
  if (!dogs) throw new Error('v3_sheet_main 沒有資料');
  return { ...dogs };
}

// 狀態頁：從資料包數主清單和溜狗紀錄，不整表 COUNT(*)；沒變時只讀 2 列版本號（small、溜狗紀錄）
export async function packStatus(db, today) {
  const v = await versions(db);
  memFor(db);
  const { dogs } = await smallPack(db, v.small);
  const walks = await packedWalks(db, today);
  return { dogs: dogs ? dogs.dogs.length : 0, walks: walks.length };
}
