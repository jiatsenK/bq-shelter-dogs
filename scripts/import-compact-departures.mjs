// #259：把離所紀錄（data/departures.json 的 departures）整份換進 v3_departures，再逐筆比對讀回的內容。
// 只操作呼叫者提供的 D1，不連線試算表或 GitHub。讀回用 worker/src/compact.js 的 readDepartures（網站也讀這個）
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readDepartures } from '../worker/src/compact.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const optDate = d => d === null || d === undefined || DATE.test(d);
const strings = list => list === undefined || (Array.isArray(list) && list.every(s => typeof s === 'string'));

function validate(list) {
  if (!Array.isArray(list)) throw new Error('離所紀錄必須是陣列');
  const seen = new Set();
  for (const e of list) {
    if (!e || typeof e.id !== 'string' || !e.id || typeof e.name !== 'string') throw new Error(`離所紀錄缺編號或狗名：${JSON.stringify(e)}`);
    if (seen.has(e.id)) throw new Error(`離所紀錄編號重複：${e.id}`);
    seen.add(e.id);
    if (!optDate(e.date) || !optDate(e.seen)) throw new Error(`離所日期格式錯：${e.id}`);
    if (!strings(e.flags) || (e.last && (!strings(e.last.formerIds) || !strings(e.last.groups)))) throw new Error(`離所清單欄位格式錯：${e.id}`);
  }
}

// 跟同步寫出來的 JSON 一樣：undefined 的欄位不存在，比對才不會因為 null／undefined 不同而報差異
const plain = list => JSON.parse(JSON.stringify(list));

// 編號 → 永久狗 ID；不認得的（溜狗紀錄也沒出現過的離所狗）用編號新建，跟 importCompactProfiles 一樣只新增不改
async function dogIds(db, list) {
  const known = new Map((await db.prepare('SELECT number,dog_id FROM v3_dog_numbers').all()).results.map(r => [r.number, r.dog_id]));
  const statements = [];
  for (const e of list) {
    if (known.has(e.id)) continue;
    const id = randomBytes(16).toString('hex');
    statements.push(db.prepare('INSERT INTO v3_dogs(dog_id,name,sex) VALUES(?,?,?)').bind(id, e.name, ''));
    statements.push(db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(e.id, id));
    known.set(e.id, id);
  }
  if (statements.length) await db.batch(statements);
  return known;
}

// 同一個 batch 整份替換（失敗保留原本的內容）
export async function importCompactDepartures(db, departures) {
  validate(departures);
  const list = plain(departures);
  const idOf = await dogIds(db, list);
  const statements = [db.prepare('DELETE FROM v3_departure_items'), db.prepare('DELETE FROM v3_departures')];
  const items = (number, kind, values = []) => values.forEach((v, i) => statements.push(db.prepare('INSERT INTO v3_departure_items(number,kind,position,value) VALUES(?,?,?,?)').bind(number, kind, i, v)));
  for (const e of list) {
    const l = e.last;
    statements.push(db.prepare(`INSERT INTO v3_departures(number,dog_id,name,departed_date,date_source,seen_date,reason,matched,returned_number,
      last_number,last_name,last_cage,last_walked_date,last_note,last_sex,last_intro) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      e.id, idOf.get(e.id), e.name, e.date ?? null, e.dateSource ?? null, e.seen ?? null, e.reason || 'unknown', e.matched || '', e.returned ?? null,
      l ? l.id : null, l ? l.name : null, l ? l.cage : null, l ? l.walkedDate ?? null : null, l ? l.note : null, l ? l.sex : null, l ? l.intro : null));
    items(e.id, 'flag', e.flags);
    if (l) { items(e.id, 'former', l.formerIds); items(e.id, 'group', l.groups); }
  }
  await db.batch(statements);
  return { departures: list.length };
}

// 差異：key 是編號，field 是欄位名（'*' 表示整筆缺少或多出）
export async function compareCompactDepartures(db, departures) {
  validate(departures);
  const want = new Map(plain(departures).map(e => [e.id, e]));
  const got = new Map((await readDepartures(db)).map(e => [e.id, e]));
  const differences = [];
  for (const key of new Set([...want.keys(), ...got.keys()])) {
    const expected = want.get(key), actual = got.get(key);
    if (!expected || !actual) { differences.push({ kind: 'departures', key, field: '*', expected: expected ?? null, actual: actual ?? null }); continue; }
    for (const field of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      if (!isDeepStrictEqual(expected[field], actual[field])) differences.push({ kind: 'departures', key, field, expected: expected[field], actual: actual[field] });
    }
  }
  return { equal: differences.length === 0, differences };
}
