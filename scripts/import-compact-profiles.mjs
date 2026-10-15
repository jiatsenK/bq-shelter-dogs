// #248：把 GitHub JSON 的溜狗紀錄、介紹、休養和 R2 照片清單匯入 v3_ 表，再逐筆比對讀回的內容。
// 只操作呼叫者提供的 D1，不連線試算表、GitHub 或 R2。表結構見 db/compact-schema.sql、docs/COMPACT_D1.md
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const PHOTO = /^photos\/([0-9A-Za-z]{1,32})\.jpg$/;
const THUMB = /^photos\/thumbs\/([0-9A-Za-z]{1,32})\.jpg$/;
const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const walkKey = w => `${w.id || w.name}|${w.date}`;
const deleted = o => o.size === 0 || !!(o.customMetadata?.deleted || o.custom_metadata?.deleted || o.metadata?.deleted);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// 網站的規則（js/app.js parseMyWalks、js/cards.js bqMyDogs）：同一隻狗同一天以最後一筆有 walkers 的為準；
// 只有 mine、沒記人的舊紀錄仍算那天有溜。mine 網站已經不看，不搬。依日期、編號、狗名排序。
export function canonicalWalks(source) {
  const days = new Map();
  for (const w of source.walks) {
    const key = walkKey(w), day = days.get(key) || { id: w.id || '', name: w.name, date: w.date };
    // 狗名跟著採用的那筆走：有 walkers 的紀錄出現後，沒記人的紀錄不再改狗名
    if (Array.isArray(w.walkers)) { day.name = w.name; day.walkers = [...w.walkers]; } else if (!day.walkers) day.name = w.name;
    days.set(key, day);
  }
  return [...days.values()].sort((a, b) => byText(a.date, b.date) || byText(a.id, b.id) || byText(a.name, b.name));
}

// 空白介紹不存；休養只留截止日和原因（updatedAt 網站不看）。匯入和比對共用，規則才不會兩邊不一樣
const cleanIntros = intros => Object.entries(intros).filter(([, text]) => text.trim());
const cleanRest = rest => Object.entries(rest).map(([n, r]) => [n, { until: r.until, reason: r.reason || '' }]);

function validate({ walks, intros = {}, rest = {}, photos = [], names = {} }) {
  if (!Array.isArray(walks?.walks)) throw new Error('溜狗紀錄必須有 walks 陣列');
  for (const w of walks.walks) {
    if (!w || typeof w.name !== 'string' || !w.name.trim() || typeof (w.id ?? '') !== 'string') throw new Error(`溜狗紀錄缺狗名或編號格式錯：${JSON.stringify(w)}`);
    if (!validDate(w.date)) throw new Error(`溜狗日期格式錯：${walkKey(w)}`);
    if (w.walkers !== undefined && !(Array.isArray(w.walkers) && w.walkers.every(c => typeof c === 'string' && c))) throw new Error(`walkers 格式錯：${walkKey(w)}`);
  }
  for (const [n, text] of Object.entries(intros)) if (typeof text !== 'string') throw new Error(`介紹格式錯：${n}`);
  for (const [n, r] of Object.entries(rest)) if (!validDate(r?.until) || typeof (r.reason ?? '') !== 'string') throw new Error(`休養格式錯：${n}`);
  for (const [n, name] of Object.entries(names)) if (typeof name !== 'string') throw new Error(`狗名格式錯：${n}`);
  const keys = new Set();
  for (const o of photos) {
    if (typeof o?.key !== 'string' || keys.has(o.key)) throw new Error(`R2 路徑缺少或重複：${o?.key}`);
    keys.add(o.key);
  }
}

// 照片清單：有效的主照片（刪除標記不算）配上同編號的縮圖；其他物件和沒有主照片的縮圖列在 skipped
function photoEntries(photos) {
  const live = photos.filter(o => !deleted(o));
  const thumbs = new Set(live.filter(o => THUMB.test(o.key)).map(o => o.key));
  const entries = [], used = new Set();
  for (const o of live) {
    const m = o.key.match(PHOTO);
    if (!m) continue;
    const thumb = `photos/thumbs/${m[1]}.jpg`;
    entries.push({ number: m[1], key: o.key, thumb: thumbs.has(thumb) ? thumb : null, uploaded: o.last_modified || o.uploaded || null });
    used.add(o.key); if (thumbs.has(thumb)) used.add(thumb);
  }
  const skipped = live.filter(o => !used.has(o.key)).map(o => o.key).sort(byText);
  return { entries, skipped };
}

// 永久狗 ID：有編號用 v3_dog_numbers，沒編號用同名的無編號狗。都找不到（已出所的狗）就用編號新建，
// 跟 importCompactDogs 一樣不刪不改既有的對照。
async function ensureDogs(db, wanted) {
  const numbers = new Map((await db.prepare('SELECT number,dog_id FROM v3_dog_numbers').all()).results.map(r => [r.number, r.dog_id]));
  // 沒編號、也不在主清單上的狗只出現在溜狗紀錄，重跑時從上次匯入的紀錄認回來
  const unnumbered = new Map([
    ...(await db.prepare("SELECT dog_name AS name,dog_id FROM v3_walks WHERE dog_number=''").all()).results,
    ...(await db.prepare("SELECT name,dog_id FROM v3_sheet_main WHERE number=''").all()).results,
  ].map(r => [r.name, r.dog_id]));
  const out = new Map(), statements = [], created = [];
  for (const { number, name } of wanted) {
    const key = number || `名:${name}`;
    if (out.has(key)) continue;
    let id = number ? numbers.get(number) : unnumbered.get(name);
    if (!id) {
      id = randomBytes(16).toString('hex');
      statements.push(db.prepare('INSERT INTO v3_dogs(dog_id,name,sex) VALUES(?,?,?)').bind(id, name || '', ''));
      if (number) statements.push(db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(number, id));
      created.push(key);
    }
    out.set(key, id);
  }
  if (statements.length) await db.batch(statements);
  return { idOf: (number, name) => out.get(number || `名:${name}`), created };
}

// 主清單上現在的編號優先，已出所的狗用最大的編號（跟 worker/src/compact.js 的開卡讀回一樣）
const NUMBER_OF_DOG = `COALESCE(
  (SELECT m.number FROM v3_sheet_main m WHERE m.dog_id = t.dog_id AND m.number <> '' ORDER BY m.row_index LIMIT 1),
  (SELECT MAX(n.number) FROM v3_dog_numbers n WHERE n.dog_id = t.dog_id))`;

// 每次整份替換四張表（同一個 batch，失敗保留原本的內容）；永久狗和編號只新增不刪。
// 沒給的類別不動那張表：同步程式拿不到 R2 清單（#251），介紹和休養 #250 起由網站直接寫 D1。
export async function importCompactProfiles(db, input) {
  validate(input);
  const { walks, intros = {}, rest = {}, names = {} } = input, photos = input.photos || [];
  const days = canonicalWalks(walks);
  const { entries, skipped } = photoEntries(photos);
  const nameFor = n => names[n] || days.findLast(d => d.id === n)?.name || '';
  const { idOf, created } = await ensureDogs(db, [
    ...days.map(d => ({ number: d.id, name: d.name })),
    ...[...Object.keys(intros), ...Object.keys(rest), ...entries.map(e => e.number)].map(n => ({ number: n, name: nameFor(n) })),
  ]);
  const onePerDog = (kind, pairs) => {
    const seen = new Map();
    for (const [n, value] of pairs) {
      const id = idOf(n);
      if (seen.has(id) && !isDeepStrictEqual(seen.get(id).value, value)) throw new Error(`同一隻狗有兩份${kind}：${seen.get(id).n}、${n}`);
      seen.set(id, { n, value });
    }
    return seen;
  };
  const introByDog = onePerDog('介紹', cleanIntros(intros));
  const restByDog = onePerDog('休養', cleanRest(rest));
  const current = new Set((await db.prepare("SELECT number FROM v3_sheet_main WHERE number<>''").all()).results.map(r => r.number));
  const primary = new Map();
  for (const e of [...entries].sort((a, b) => byText(a.number, b.number))) {
    const id = idOf(e.number), had = primary.get(id);
    // 依編號排序後新的取代舊的，除非舊的在主清單上、新的不在
    if (!had || current.has(e.number) || !current.has(had.number)) primary.set(id, e);
  }
  const tables = ['v3_walks', ...(input.intros ? ['v3_intros'] : []), ...(input.rest ? ['v3_rest'] : []), ...(input.photos ? ['v3_photos'] : [])];
  const statements = tables.map(t => db.prepare(`DELETE FROM ${t}`));
  for (const d of days) {
    const codes = d.walkers?.length ? d.walkers : [null];
    codes.forEach((code, position) => statements.push(db.prepare('INSERT INTO v3_walks(dog_id,walk_date,position,walker_name,walker_code,dog_number,dog_name) VALUES(?,?,?,NULL,?,?,?)').bind(idOf(d.id, d.name), d.date, position, code, d.id, d.name)));
  }
  for (const [id, { value }] of introByDog) statements.push(db.prepare('INSERT INTO v3_intros(dog_id,intro) VALUES(?,?)').bind(id, value));
  for (const [id, { value }] of restByDog) statements.push(db.prepare('INSERT INTO v3_rest(dog_id,until_date,reason) VALUES(?,?,?)').bind(id, value.until, value.reason));
  for (const e of entries) statements.push(db.prepare('INSERT INTO v3_photos(object_key,dog_id,thumb_key,is_primary,uploaded_at) VALUES(?,?,?,?,?)').bind(e.key, idOf(e.number), e.thumb, Number(primary.get(idOf(e.number)) === e), e.uploaded));
  await db.batch(statements);
  return { walks: days.length, intros: introByDog.size, rest: restByDog.size, photos: entries.length, newDogs: created, skipped };
}

export async function readCompactProfiles(db) {
  const [walks, intros, rest, photos] = await db.batch([
    db.prepare('SELECT dog_id,walk_date,walker_code,dog_number,dog_name FROM v3_walks ORDER BY walk_date,dog_number,dog_name,position'),
    db.prepare(`SELECT ${NUMBER_OF_DOG} AS number, t.intro FROM v3_intros t`),
    db.prepare(`SELECT ${NUMBER_OF_DOG} AS number, t.until_date, t.reason FROM v3_rest t`),
    db.prepare('SELECT object_key,thumb_key FROM v3_photos'),
  ]);
  const days = new Map();
  for (const r of walks.results) {
    const key = `${r.dog_id}|${r.walk_date}`;
    if (!days.has(key)) days.set(key, { id: r.dog_number, name: r.dog_name, date: r.walk_date });
    if (r.walker_code !== null) (days.get(key).walkers ||= []).push(r.walker_code);
  }
  return {
    walks: [...days.values()],
    intros: Object.fromEntries(intros.results.map(r => [r.number, r.intro])),
    rest: Object.fromEntries(rest.results.map(r => [r.number, { until: r.until_date, reason: r.reason }])),
    photos: photos.results.flatMap(r => [r.object_key, r.thumb_key]).filter(Boolean).sort(byText),
  };
}

// 差異：kind（walks／intros／rest／photos）、key（溜狗是「編號或狗名|日期」，其他是編號或 R2 路徑）、
// field（'*' 表示整筆缺少或多出）、expected、actual
export async function compareCompactProfiles(db, input) {
  validate(input);
  const actual = await readCompactProfiles(db);
  const { intros = {}, rest = {}, photos = [] } = input;
  const expected = {
    walks: canonicalWalks(input.walks),
    intros: Object.fromEntries(cleanIntros(intros)),
    rest: Object.fromEntries(cleanRest(rest)),
    photos: photoEntries(photos).entries.flatMap(e => [e.key, e.thumb]).filter(Boolean).sort(byText),
  };
  const differences = [];
  const diff = (kind, want, got, fields) => {
    for (const key of new Set([...want.keys(), ...got.keys()])) {
      const expected = want.get(key), found = got.get(key);
      if (expected === undefined || found === undefined) differences.push({ kind, key, field: '*', expected: expected ?? null, actual: found ?? null });
      else for (const field of fields) if (!isDeepStrictEqual(expected[field], found[field])) differences.push({ kind, key, field, expected: expected[field], actual: found[field] });
    }
  };
  const byKey = list => new Map(list.map(w => [walkKey(w), w]));
  diff('walks', byKey(expected.walks), byKey(actual.walks), ['id', 'name', 'date', 'walkers']);
  if (input.intros) diff('intros', new Map(Object.entries(expected.intros).map(([n, intro]) => [n, { intro }])), new Map(Object.entries(actual.intros).map(([n, intro]) => [n, { intro }])), ['intro']);
  if (input.rest) diff('rest', new Map(Object.entries(expected.rest)), new Map(Object.entries(actual.rest)), ['until', 'reason']);
  if (input.photos) diff('photos', new Map(expected.photos.map(k => [k, {}])), new Map(actual.photos.map(k => [k, {}])), []);
  return { equal: differences.length === 0, differences };
}
