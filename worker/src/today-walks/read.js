// 讀取面：今日溜狗紀錄、目前溜狗人、停住的寫回，以及接受時的起點（seedState）。
// 「目前溜狗日期與溜狗人」只有一條規則（currentWalk）：網站接管過的狗（v3_walk_state）用它，沒有的用主清單的遛狗日期與「誰遛的」原文。
import { splitNames } from '../sheet-read.js';
import { one, rows, keyOf, MAIN_DOG, WalkError } from './shared.js';

// 四個讀的地方（readAcceptedWalks、withTodayWalks、readWalkers、seedState）都經過 currentWalk。
// 溜狗狀態有三種來源列，先各自換成 { date, walker } 再交給規則：
//   v3_walk_state 一列（stateWalk）、溜狗資料包 v3_walk_pack 的一隻（packWalk，內容就是溜狗狀態）、主清單一列或狗清單的一隻（mainWalk）。
export const stateWalk = row => row && { date: row.effective_date || '', walker: row.walker || '' };
export const packWalk = w => w && { date: w.walkedDate || '', walker: w.walker || '' };
// 主清單的「誰遛的」原文是 NULL（#519 還沒補填）時用 codeNames（名單代號換回的名字）；狗清單的狗只有日期（walkedDate）
export const mainWalk = (row, codeNames = []) => row && { date: row.walked_date ?? row.walkedDate ?? '', walker: row.walker ?? codeNames.join('、') };
export function currentWalk(state, main) {
  return state || main || { date: '', walker: '' };
}

export async function readAcceptedWalks(db, today) {
  // 版本與內容在同一列，冷讀也只讀一列；午夜只換 today 判定。資料包只放網站接管過的狗（walk_pack 觸發器照 v3_walk_state 寫），所以沒有主清單那一邊。
  const pack = await one(db, 'SELECT version,payload FROM v3_walk_pack WHERE id=1');
  if (!pack) throw new Error('沒有溜狗資料包');
  return { version: pack.version, date: today, source: 'd1', walks: Object.values(JSON.parse(pack.payload))
    .map(w => ({ ...w, walked: currentWalk(packWalk(w), null).date === today })) };
}

// 狗清單的遛狗日期是試算表複本，要等狗清單保險掃描才更新；今日溜狗（ADR 0018）是正本，
// 有的狗用它的日期，並附上同一份今日紀錄，網站開頁就拿得到（K 2026-10-26）。
// 資料包快取裡的狗是共用的，換日期時複製一份，不改到快取
export function withTodayWalks(dogs, today) {
  const byKey = new Map(today.walks.map(w => [w.key, w])), onList = new Set();
  const merged = dogs.map(dog => {
    const w = byKey.get(keyOf(dog));
    if (!w) return dog;
    onList.add(w.key);
    // 狗清單的狗只帶日期，所以這裡只換日期
    const { date } = currentWalk(packWalk(w), mainWalk(dog));
    return date === dog.walkedDate ? dog : { ...dog, walkedDate: date || null };
  });
  return { dogs: merged, today: { ...today, walks: today.walks.filter(w => onList.has(w.key)) } };
}

// 主清單每隻狗的目前溜狗人（/walkers，#519）。
// 回 { walkers: { 狗的 key: 名單 }, dates: { 狗的 key: 'YYYY-MM-DD' 或 '' }, names: [最近出現的在前，同一天照名單順序] }
export async function readWalkers(db) {
  const [main, states] = await db.batch([
    db.prepare('SELECT row_index, number, name, walked_date, walker FROM v3_sheet_main ORDER BY row_index'),
    db.prepare('SELECT dog_key, effective_date, walker FROM v3_walk_state'),
  ]);
  // 代號換名字只給還沒補填原文（walker 是 NULL）的狗；正式庫已經沒有 NULL，平常不讀這段 JOIN（#554，原本一次白讀 772 列）
  const people = (main.results || []).some(r => r.walker == null)
    ? await db.prepare('SELECT m.row_index, n.name FROM v3_sheet_main m, json_each(m.walker_codes) w LEFT JOIN v3_identity_names n ON n.code=w.value WHERE m.walker IS NULL ORDER BY m.row_index, w.key').all()
    : { results: [] };
  const namesOf = new Map();
  for (const p of people.results || []) {
    if (!p.name) continue;
    if (!namesOf.has(p.row_index)) namesOf.set(p.row_index, []);
    namesOf.get(p.row_index).push(p.name);
  }
  const stateOf = new Map((states.results || []).map(s => [s.dog_key, s]));
  const walkers = {}, dates = {}, lastSeen = new Map(); // 名字 → 最近一次 { date, i: 名單裡第幾位 }
  for (const r of main.results || []) {
    const key = keyOf({ id: r.number, name: r.name });
    const { date, walker } = currentWalk(stateWalk(stateOf.get(key)), mainWalk(r, namesOf.get(r.row_index)));
    walkers[key] = walker;
    dates[key] = date;
    splitNames(walker).forEach((n, i) => { const prev = lastSeen.get(n); if (!prev || date > prev.date || (date === prev.date && i < prev.i)) lastSeen.set(n, { date, i }); });
  }
  const names = [...lastSeen].sort((x, y) => y[1].date.localeCompare(x[1].date) || x[1].i - y[1].i || x[0].localeCompare(y[0], 'zh-Hant')).map(([n]) => n);
  return { walkers, dates, names };
}

export async function uniqueMainDog(db, dog) {
  const matches = await rows(db, MAIN_DOG(dog), dog.id || dog.name);
  if (matches.length !== 1) throw new WalkError(409, '找不到唯一的主清單狗');
  return matches[0];
}

// 還沒有溜狗狀態的狗：接受或比對的起點照主清單（currentWalk）。
// 溜狗人用主清單存的試算表原文（#707）：代號換名字再以「、」接起來，表上用逗號、空白分隔或名字換不回代號時，
// 比對會把沒改的表當成人工改表，跟狗清單同步各記一筆。原文還沒補填（NULL，#519）才退回用代號換名字
export async function seedState(db, dog, today) {
  const seed = await uniqueMainDog(db, dog);
  const codeNames = seed.walker == null ? (await rows(db, 'SELECT n.name FROM v3_sheet_main m, json_each(m.walker_codes) w LEFT JOIN v3_identity_names n ON n.code=w.value WHERE m.row_index=? ORDER BY w.key', seed.row_index))
    .map(p => p.name).filter(Boolean) : [];
  const { date, walker } = currentWalk(null, mainWalk(seed, codeNames));
  const previous = date === today ? await previousWalk(db, dog, today) : null;
  return { dog_id: seed.dog_id, effective_date: date, walker, version: 0, main: seed,
    ...(previous ? { previous_date: previous.date.date || '', previous_walker: previous.walker } : {}) };
}

// 撤銷溜了（ADR 0016）：手機沒有復原證據時，從 D1 溜狗紀錄找這隻狗今天以前最後一次（日期、那天的名字），寫回試算表用。
// 主鍵是 (dog_id, walk_date, position)，只讀這隻狗最近幾列；從沒溜過回空白。找不到這隻狗回 null
export async function previousWalk(db, dog, today) {
  const found = dog.id
    ? await db.prepare('SELECT dog_id FROM v3_dog_numbers WHERE number=?').bind(dog.id).all()
    : await db.prepare("SELECT dog_id FROM v3_sheet_main WHERE number='' AND name=?").bind(dog.name).all();
  const ids = [...new Set((found.results || []).map(r => r.dog_id))];
  if (ids.length !== 1) return null;
  const { results: list = [] } = await db.prepare('SELECT walk_date,walker_code FROM v3_walks WHERE dog_id=? AND walk_date<? ORDER BY walk_date DESC,position LIMIT 20').bind(ids[0], today).all();
  if (!list.length) return { date: { text: '' }, walker: '' };
  const date = list[0].walk_date;
  const codes = [...new Set(list.filter(r => r.walk_date === date).map(r => r.walker_code).filter(Boolean))];
  const names = new Map();
  if (codes.length) {
    const marks = codes.map(() => '?').join(',');
    const { results = [] } = await db.prepare(`SELECT code,name FROM v3_identity_names WHERE code IN (${marks})`).bind(...codes).all();
    for (const r of results) if (!names.has(r.code)) names.set(r.code, r.name);
  }
  // 對不到名字的代號（舊資料）略過，不寫代號進試算表
  return { date: { date }, walker: [...new Set(codes.map(c => names.get(c)).filter(Boolean))].join('、') };
}

// #684 寫回停止重試的狗：只列各狗目前版本的工作（舊版本已被新登記取代）。條件照 v3_walk_outbox_due 部分索引寫，走索引不掃表。
// 原因由 outbox.error 換成白話（前綴見 dispatch.js 的 remoteError），次數讀 v3_walk_retry。
const SHOW_MAX = 200;
const stopReason = error => error === 'writeback-not-configured' ? '志工網站還沒設定寫入試算表'
  : String(error || '').replace(/^writeback-[a-z]+:\s*/, '') || '試算表沒有寫進去';

export async function readStoppedWalks(db, stoppedAt) {
  const { results = [] } = await db.prepare(`SELECT s.number, s.name, s.dog_id, o.operation_date, o.error, COALESCE(r.failures, 0) AS failures
    FROM v3_walk_outbox o JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version
    LEFT JOIN v3_walk_retry r ON r.dog_key=o.dog_key AND r.version=o.version
    WHERE o.status IN ('pending','retry','unconfirmed') AND o.next_attempt_at=?
    ORDER BY o.operation_date DESC, s.number LIMIT ?`).bind(stoppedAt, SHOW_MAX).all();
  return results.map(r => ({ number: r.number || '', name: r.name || '', dogId: r.dog_id || null, date: r.operation_date,
    failures: r.failures, reason: stopReason(r.error) }));
}
