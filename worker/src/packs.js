// 資料包（ADR 0009，#315）：很少變的資料預先算好存在 D1，Worker 每次只讀 1 列版本號，有變才讀資料包或重算。
// small：狗清單、離所、休養；walks：切點（cutoff，正常是今天）以前的溜狗紀錄；今天的紀錄另外只讀今天的列。
// 版本號由 db/compact-schema.sql 的觸發器自動加 1，所以網站、同步、別台 Worker 機器寫入都看得到。
// 輸出和直接讀表（compact.js 的 readDogsPayload 等）逐字元相同
import { readDogsPayload, readDepartures, readRest, HISTORY_START } from './compact.js';

// D1 一列上限 2 MB；資料包一律分段存，每段最多這麼多位元組（測試會調小）
let chunkBytes = 1_000_000;
export function setPackChunkBytes(n) { chunkBytes = n; }

let mem = null; // { db, small, walks: { ver, cutoff, list }, live: { ver, cutoff, list } }
export function resetPackCache() { mem = null; }

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

// 歷史資料包切在今天：跨日後第一次讀重算一次，把昨天併進去。切點只往前移，時鐘慢一點的機器不會把它拉回去
async function walksPack(db, v, today) {
  if (mem.walks && mem.walks.ver === v.walks && mem.walks.cutoff === today) return mem.walks;
  let list = await loadPack(db, 'walks', v.walks, today);
  if (!list) {
    if (v.cutoff !== today) await db.prepare('UPDATE v3_pack_versions SET cutoff=? WHERE id=1 AND cutoff<?').bind(today, today).run();
    list = groupWalks((await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks WHERE walk_date<?`).bind(today).all()).results || []);
    await savePack(db, 'walks', v.walks, today, list);
  }
  mem.walks = { ver: v.walks, cutoff: today, list };
  mem.live = null;
  return mem.walks;
}

// 今天（切點以後）的紀錄：live 版本號變了才重讀，走 walk_date 索引
async function liveWalks(db, v, cutoff) {
  if (mem.live && mem.live.ver === v.live && mem.live.cutoff === cutoff) return mem.live.list;
  const list = groupWalks((await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks WHERE walk_date>=?`).bind(cutoff).all()).results || []);
  mem.live = { ver: v.live, cutoff, list };
  return list;
}

// 讀不到版本號（正式 D1 要等同步補建表）回 null，呼叫的人照舊直接讀表；D1 真的壞了，直接讀表也會失敗
async function versions(db) {
  try {
    return await db.prepare('SELECT small,walks,live,cutoff FROM v3_pack_versions WHERE id=1').first();
  } catch (e) {
    return null;
  }
}

// part 是 dogs／departures／rest；dogs 是 null 表示主清單沒有狗。沒有版本號時只直接讀要的那份
const DIRECT = { dogs: readDogsPayload, departures: readDepartures, rest: readRest };
export async function readSmall(db, part) {
  const v = await versions(db);
  if (!v) return DIRECT[part](db);
  if (!mem || mem.db !== db) mem = { db };
  return (await smallPack(db, v.small))[part];
}

// 跟 readWalks 一樣的形狀；today 是台灣日期
export async function readWalksPacked(db, today) {
  const v = await versions(db);
  let list;
  if (!v || v.cutoff > today) {
    list = groupWalks((await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks`).all()).results || []);
  } else {
    if (!mem || mem.db !== db) mem = { db };
    const hist = await walksPack(db, v, today);
    list = [...hist.list, ...await liveWalks(db, v, today)];
  }
  return { version: 1, historyStart: HISTORY_START, walks: list };
}

// 狗清單：回新物件，呼叫的人加 photoVersions 不會改到快取
export async function readDogsPacked(db) {
  const dogs = await readSmall(db, 'dogs');
  if (!dogs) throw new Error('v3_sheet_main 沒有資料');
  return { ...dogs };
}

// 狀態頁：從資料包數主清單和溜狗紀錄，不整表 COUNT(*)；沒變時只讀 1 列版本號
export async function packStatus(db, today) {
  const v = await versions(db);
  if (!v) return null;
  if (!mem || mem.db !== db) mem = { db };
  const { dogs } = await smallPack(db, v.small);
  let walks = 0;
  if (v.cutoff <= today) walks = (await walksPack(db, v, today)).list.length + (await liveWalks(db, v, today)).length;
  return { dogs: dogs ? dogs.dogs.length : 0, walks };
}
