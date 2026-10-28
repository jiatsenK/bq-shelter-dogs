// 資料包（ADR 0009，#315）：很少變的資料預先算好存在 D1，Worker 每次只讀 1 列版本號，有變才讀資料包或重算。
// small：在所（狗清單、主清單上的狗的休養）；溜狗日期、溜狗人另外一包 walked（#679），GAS 送「溜過了」不讓 small 整份重算；離所按出所年份一年一份（ADR 0014，#362）；溜狗紀錄：切點（cutoff，正常是今天）以前的按月分段（#320），一年存一份；今天的紀錄另外只讀今天的列。
// 版本號由 db/compact-schema.sql 的觸發器自動加 1，所以網站、同步、別台 Worker 機器寫入都看得到。
// 輸出和直接讀表（compact.js 的 readDogsPayload 等）逐字元相同
import { readDogsPayload, readDepartures, readNameOnlyCards, readRest, readSyncedAt, sortDepartures, sortedRest, HISTORY_START } from './compact.js';
import { summarize, addMine } from './walk-summary.js';

// D1 一列上限 2 MB；資料包一律分段存，每段最多這麼多位元組（測試會調小）
let chunkBytes = 1_000_000;
export function setPackChunkBytes(n) { chunkBytes = n; }

let mem = null; // { db, small, walked, dogs, pending, deps: { 年: { ver, body } }, walks: { total, months: { 月: { ver, list } } }, live: { ver, cutoff, list } }
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
  // 一個 UTF-16 單位最多 3 位元組，總長度不可能超過上限就不用逐字算（#356）
  if (text.length * 3 <= chunkBytes) return [text];
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

// 同一台機器上同一版本號正在重算時，後進來的請求等同一次的結果（#679）。只在同一個 isolate 有效，不保證全域只算一次；
// 等的那次失敗（例如發出查詢的請求先結束被取消）就自己再算
async function once(name, ver, build) {
  const pending = mem.pending ||= {};
  if (pending[name]?.ver === ver) {
    try { return await pending[name].promise; } catch (e) { /* 自己再算 */ }
  }
  const promise = build();
  pending[name] = { ver, promise };
  try { return await promise; } finally { if (pending[name]?.promise === promise) delete pending[name]; }
}

// ver 一律用「開始重算前」讀到的版本號：重算途中有人改，版本號已經往前，下次會再算
async function smallPack(db, ver) {
  if (mem.small && mem.small.ver === ver) return mem.small.body;
  return once('small', ver, () => buildSmall(db, ver));
}
// 狗清單裡的 walkedDate、walkers 是重算當時的值，讀的時候一律用溜狗日期包蓋過（dogsPack）
async function buildSmall(db, ver) {
  const m = mem;
  let body = await loadPack(db, 'main', ver, ''); // 在所資料包（ADR 0014 以前叫 small、含離所）
  // #399：部署前的包使用試算表 covered，版本未變也必須重算一次。
  if (body && body.fixedCareVersion !== 1) body = null;
  if (!body) {
    // 主清單是空的（資料出問題）：狗清單回錯誤，休養照給，也不存資料包
    let dogs = null;
    try { dogs = await readDogsPayload(db); } catch (e) { if (!/沒有資料/.test(e.message)) throw e; }
    body = { dogs, rest: await readRest(db, 'main'), fixedCareVersion: 1 };
    if (!dogs) return body;
    await savePack(db, 'main', ver, '', body);
  }
  m.small = { ver, body };
  return body;
}

// ---- 溜狗日期包（#679）：主清單順序的 [編號, 狗名, 溜狗日期, 溜狗人代號]，版本號 v3_pack_versions.walked；重算只讀主清單 1 張表 ----
async function walkedPack(db, ver) {
  if (mem.walked && mem.walked.ver === ver) return mem.walked.list;
  return once('walked', ver, async () => {
    const m = mem;
    let list = await loadPack(db, 'walked', ver, '');
    if (!list) {
      const { results = [] } = await db.prepare('SELECT number,name,walked_date,walker_codes FROM v3_sheet_main ORDER BY row_index').all();
      list = results.map(r => [r.number, r.name, r.walked_date, JSON.parse(r.walker_codes)]);
      await savePack(db, 'walked', ver, '', list);
    }
    m.walked = { ver, list };
    return list;
  });
}

// 在所資料包的狗清單蓋上溜狗日期包：照位置對，編號、狗名對不上（兩包不是同一刻算的）才照編號＋狗名找，找不到就留在所資料包的值。
// 換掉的狗複製一份，不改到快取；欄位順序不變，輸出跟直接讀表逐字元相同
function withWalked(dogs, list) {
  const key = (id, name) => `${id}\n${name}`;
  let byKey = null;
  const merged = dogs.dogs.map((dog, i) => {
    let w = list[i];
    if (!w || w[0] !== dog.id || w[1] !== dog.name) {
      byKey ||= new Map([...list].reverse().map(x => [key(x[0], x[1]), x]));
      w = byKey.get(key(dog.id, dog.name));
    }
    return w ? { ...dog, walkedDate: w[2], walkers: w[3] } : dog;
  });
  return { ...dogs, dogs: merged };
}
// 狗清單（null 是主清單沒有狗）：兩個版本號都沒變就用記憶體裡合好的那份
async function dogsPack(db, v) {
  const small = await smallPack(db, v.small);
  if (!small.dogs) return null;
  const done = mem.dogs;
  if (done && done.small === v.small && done.walked === v.walked) return done.body;
  const body = withWalked(small.dogs, await walkedPack(db, v.walked));
  mem.dogs = { small: v.small, walked: v.walked, body };
  return body;
}

// ---- 離所按出所年份（ADR 0014，#362）：每年版本號在 v3_departure_versions.years（JSON，{"2026":3,"none":1}），
// 觸發器依出所日的年份只讓那一年加 1；資料包存在 v3_packs，part 是 departures:年，一年一份 ----
const depPart = year => `departures:${year}`;
// 每年 { departures, cards, rest }（cards 是那年只有名字的已出所狗卡，#560；rest 是那年離所、現在不在主清單上的狗）；只讀版本號變了的那幾年
async function departurePacks(db) {
  const years = JSON.parse((await versionRow(db, 'SELECT years FROM v3_departure_versions WHERE id=1')).years);
  const deps = mem.deps ||= {};
  for (const y of Object.keys(deps)) if (!(y in years)) delete deps[y];
  const stale = Object.keys(years).filter(y => deps[y]?.ver !== years[y]);
  if (stale.length) {
    // 一次讀這幾年的資料包，版本號對不上的那年才重算
    const { results = [] } = await db.prepare(`SELECT part,seq,ver,body FROM v3_packs WHERE part IN (${stale.map(() => '?').join(',')})`).bind(...stale.map(depPart)).all();
    const rows = groupBy(results, r => r.part);
    for (const y of stale) {
      const segs = (rows.get(depPart(y)) || []).sort((a, b) => a.seq - b.seq);
      let body = segs.length && segs.every((r, i) => r.seq === i && r.ver === years[y]) ? JSON.parse(segs.map(r => r.body).join('')) : null;
      // #560 以前的資料包沒有 cards（套 migration 到部署之間舊程式可能用新版本號存過）：當作過期重算
      if (body && !Array.isArray(body.cards)) body = null;
      if (!body) {
        body = { departures: await readDepartures(db, y), cards: await readNameOnlyCards(db, y), rest: await readRest(db, y) };
        await savePack(db, depPart(y), years[y], '', body);
      }
      deps[y] = { ver: years[y], body };
    }
  }
  return { years, packs: Object.keys(years).map(y => deps[y].body) };
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
// 每個月的資料和它的版本號一起存：兩台機器先後存同一年，各月份仍然對得上自己的版本號。
// 同一批也存這一年的「我溜過的狗」摘要（#344），版本號跟資料包同一份
async function saveYear(db, year, pack) {
  const vers = JSON.stringify(pack.vers);
  const summary = summarize(Object.keys(pack.months).sort().flatMap(m => pack.months[m]));
  try {
    await db.batch([
      db.prepare('DELETE FROM v3_walk_packs WHERE year=?').bind(year),
      ...chunks(JSON.stringify(pack.months)).map((text, seq) => db.prepare('INSERT INTO v3_walk_packs(year,seq,vers,body) VALUES(?,?,?,?)').bind(year, seq, vers, text)),
      db.prepare('DELETE FROM v3_walk_summaries WHERE year=?').bind(year),
      ...chunks(JSON.stringify(summary)).map((text, seq) => db.prepare('INSERT INTO v3_walk_summaries(year,seq,vers,body) VALUES(?,?,?,?)').bind(year, seq, vers, text)),
    ]);
    mem.mine ||= {};
    mem.mine[year] = { vers: pack.vers, body: summary };
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
// year 有給就只補那一年（/api/walks?year=，#346）
async function history(db, v, year) {
  if (mem.walks.total === v.total) return;
  const vers = JSON.parse(v.months);
  const stale = Object.keys(vers).filter(m => mem.walks.months[m]?.ver !== vers[m] && (!year || yearOf(m) === year));
  for (const [y, list] of groupBy(stale, yearOf)) remember(await freshYear(db, y, list, vers, v.cutoff), vers);
  if (!year) mem.walks.total = v.total;
}

// 讀那一年的資料包，版本號對不上的月份重算再存
async function freshYear(db, year, months, vers, cutoff, force = false) {
  const pack = await loadYear(db, year);
  let changed = force;
  for (const m of months) {
    if (pack.vers[m] === vers[m]) continue;
    pack.months[m] = await buildMonth(db, m, cutoff);
    pack.vers[m] = vers[m];
    changed = true;
  }
  if (changed) await saveYear(db, year, pack);
  return pack;
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
const versions = db => versionRow(db, 'SELECT small,walked FROM v3_pack_versions WHERE id=1');
const walkVersions = db => versionRow(db, 'SELECT total,live,cutoff,months FROM v3_walk_versions WHERE id=1');

// 溜狗紀錄（依日期排好）。切點以前讀資料包、以後讀 live，不管切點在哪天都是完整的一份：
// 切點比今天新（時鐘慢一點的機器不把它拉回去）或一直移不了切點，就照現在的切點給，下一次再移
async function currentVersions(db, today) {
  let v = await walkVersions(db);
  memFor(db);
  for (let i = 0; i < 3 && v.cutoff < today; i++) v = await advance(db, v, today) || await walkVersions(db);
  return v;
}
async function packedWalks(db, today) {
  const v = await currentVersions(db, today);
  await history(db, v);
  mem.walks.v = v;
  const { months } = mem.walks;
  return [...Object.keys(months).sort().flatMap(m => months[m].list), ...await liveWalks(db, v)];
}

// part 是 dogs／departures／rest（只有名字的卡用 readDeparted）；dogs 是 null 表示主清單沒有狗。
// 離所由各年資料包接起來；休養是在所的加上各年離所的（同一隻狗回到主清單時以在所為準）
export async function readSmall(db, part) {
  memFor(db);
  if (part === 'departures') return (await readDeparted(db)).departures;
  const v = await versions(db);
  if (part === 'dogs') return dogsPack(db, v);
  const small = await smallPack(db, v.small);
  const rest = new Map();
  for (const p of (await departurePacks(db)).packs) for (const [id, r] of Object.entries(p.rest)) rest.set(id, r);
  for (const [id, r] of Object.entries(small.rest)) rest.set(id, r);
  return sortedRest([...rest]);
}

// 離所和只有名字的已出所狗卡一起拿（已出所狗卡兩個都要）：同一份離所資料包，版本號只讀一次（#678）
export async function readDeparted(db) {
  memFor(db);
  const { packs } = await departurePacks(db);
  return { departures: sortDepartures(packs.flatMap(p => p.departures)), cards: packs.flatMap(p => p.cards) };
}

// 離所名冊索引（ADR 0014，#363）：每隻只留編號、狗名、舊編號、出所日、原因（和名冊那一行要顯示的推估、再入所），
// 從各年資料包組，不讀離所表；years 是每年的版本號，網站拿來組 ?year= 的網址
export async function readDepartureIndex(db) {
  memFor(db);
  const { years, packs } = await departurePacks(db);
  const dogs = sortDepartures(packs.flatMap(p => p.departures)).map(e => {
    const last = e.last || {};
    const dog = { id: e.id, name: String(last.name || '').trim() ? last.name : e.name, date: e.date, dateSource: e.dateSource, reason: e.reason };
    if (e.returned !== undefined) dog.returned = e.returned;
    if (last.formerIds) dog.formerIds = last.formerIds;
    return dog;
  });
  return { version: 1, years: Object.fromEntries(Object.entries(years).map(([y, v]) => [y, String(v)])), dogs };
}

// 一年的離所紀錄（#363）：year 是四位數年份或 none；ver 是那一年的版本號（沒有那年是 ''，departures 是空的）
export async function readDepartureYear(db, year) {
  memFor(db);
  const { years } = await departurePacks(db);
  if (!(year in years)) return { version: 1, year, ver: '', departures: [] };
  return { version: 1, year, ver: String(years[year]), departures: sortDepartures([...mem.deps[year].body.departures]) };
}

// 每年的版本號（#346）：各月版本號只會加 1，加總不會回到舊值；切點那年起還有今天的紀錄，再帶切點和 live
export function yearVersions(v) {
  const out = {};
  for (const [m, n] of Object.entries(JSON.parse(v.months))) out[yearOf(m)] = (out[yearOf(m)] || 0) + n;
  const live = v.cutoff ? yearOf(v.cutoff) : '';
  return Object.fromEntries(Object.entries(out).map(([y, n]) => [y, live && y >= live ? `${n}.${v.cutoff}.${v.live}` : String(n)]));
}

// 近期溜狗紀錄的起點：上個月 1 號（ADR 0013）；today 是台灣日期 YYYY-MM-DD
export function recentStart(today) {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
}

// 跟 readWalks 一樣的形狀，但只有近期溜狗紀錄（#347）；更早的用 ?year= 拿。years 是每年的版本號，網站拿來組 ?year= 的網址
export async function readWalksPacked(db, today) {
  const v = await currentVersions(db, today);
  const from = recentStart(today);
  const vers = JSON.parse(v.months);
  const stale = Object.keys(vers).filter(m => m >= monthOf(from) && mem.walks.months[m]?.ver !== vers[m]);
  for (const [y, list] of groupBy(stale, yearOf)) remember(await freshYear(db, y, list, vers, v.cutoff), vers);
  const { months } = mem.walks;
  const old = Object.keys(months).filter(m => m >= monthOf(from)).sort().flatMap(m => months[m].list);
  const walks = [...old, ...await liveWalks(db, v)].filter(w => w.date >= from);
  return { version: 1, historyStart: HISTORY_START, recentStart: from, years: yearVersions(v), walks };
}

// 一年的溜狗紀錄（#346）：只讀版本號和那一年的資料包；ver 是 years 裡那一年的版本號（沒有那年是 ''）
export async function readWalksYear(db, today, year) {
  const v = await currentVersions(db, today);
  await history(db, v, year);
  const { months } = mem.walks;
  const live = v.cutoff && yearOf(v.cutoff) <= year ? (await liveWalks(db, v)).filter(w => w.date.startsWith(year)) : [];
  const walks = [...Object.keys(months).filter(m => yearOf(m) === year).sort().flatMap(m => months[m].list), ...live];
  return { version: 1, historyStart: HISTORY_START, year, ver: yearVersions(v)[year] || '', walks };
}

// 狗清單：回新物件，呼叫的人加 photoVersions 不會改到快取；同步時間另外讀 1 列合進來，欄位順序跟直接讀表一樣
export async function readDogsPacked(db) {
  const dogs = await readSmall(db, 'dogs');
  if (!dogs) throw new Error('v3_sheet_main 沒有資料');
  const { version, ...rest } = dogs;
  return { version, syncedAt: await readSyncedAt(db), ...rest };
}

// 狀態頁：從資料包數主清單和溜狗紀錄，不整表 COUNT(*)；沒變時只讀 2 列版本號（small、溜狗紀錄）
export async function packStatus(db, today) {
  const v = await versions(db);
  memFor(db);
  const { dogs } = await smallPack(db, v.small);
  const walks = await packedWalks(db, today);
  return { dogs: dogs ? dogs.dogs.length : 0, walks: walks.length };
}

// ---- 我溜過的狗（ADR 0013，#344）：計算規則在 walk-summary.js，這裡管各年摘要的快取與版本號 ----
// 各年的摘要：版本號和那一年每個月都對得上才用；一次讀整張摘要表（約每年 1 列）
async function yearSummaries(db, v) {
  const vers = JSON.parse(v.months);
  const years = groupBy(Object.keys(vers), yearOf);
  // #271 以前存的摘要沒有 dogs：當成舊的，重算一次（讀那一年的資料包，不讀 v3_walks 整表）
  const fits = (s, months) => s && s.body.dogs && months.every(m => s.vers[m] === vers[m]);
  mem.mine ||= {};
  if ([...years].some(([y, ms]) => !fits(mem.mine[y], ms))) {
    const { results = [] } = await db.prepare('SELECT year,seq,vers,body FROM v3_walk_summaries').all();
    for (const [year, rows] of groupBy(results, r => r.year)) {
      rows.sort((a, b) => a.seq - b.seq);
      if (!rows.every((r, i) => r.seq === i && r.vers === rows[0].vers)) continue;
      try { mem.mine[year] = { vers: JSON.parse(rows[0].vers), body: JSON.parse(rows.map(r => r.body).join('')) }; } catch (e) { /* 缺段 */ }
    }
  }
  const out = [];
  for (const [year, months] of years) {
    // 摘要舊了或還沒有（剛上線）：讀那一年的資料包重算，連摘要一起存
    if (!fits(mem.mine[year], months)) {
      const pack = await freshYear(db, year, months, vers, v.cutoff, true);
      if (!fits(mem.mine[year], months)) mem.mine[year] = { vers: pack.vers, body: summarize(Object.keys(pack.months).sort().flatMap(m => pack.months[m])) };
    }
    out.push(mem.mine[year].body);
  }
  return out;
}

// { 編號: { times, first, last } }；codes 是這個人的全部代號（含舊代號）
export async function readMineWalks(db, today, codes) {
  const v = await currentVersions(db, today);
  const out = {};
  for (const s of await yearSummaries(db, v)) addMine(out, s, codes);
  addMine(out, summarize(await liveWalks(db, v)), codes);
  return out;
}

// 每隻狗（編號）溜過幾天（#271 已出所狗卡）：跟 readMineWalks 一樣用各年摘要加上今天的紀錄，不整表讀 v3_walks
export async function readDogWalkDays(db, today) {
  const v = await currentVersions(db, today);
  const out = {};
  for (const s of [...await yearSummaries(db, v), summarize(await liveWalks(db, v))]) {
    for (const [id, days] of Object.entries(s.dogs)) out[id] = (out[id] || 0) + days;
  }
  return out;
}
