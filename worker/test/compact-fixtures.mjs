// 測試用：把舊 JSON 形狀的狗、溜狗紀錄、離所灌進測試庫（只操作呼叫者給的 fakeD1）。
// 從已退役的一次性匯入腳本 scripts/import-compact-*.mjs 留下寫入部分（#596）；格式驗證和讀回比對一起退役了。
// 只給測試建資料，整份刪了重寫沒關係；不是請求路徑，不要搬進 worker/src（CODING_STANDARDS.md #408）。
import { randomBytes } from 'node:crypto';
import { SYNCED_AT_KEY } from '../src/compact.js';

const newId = () => randomBytes(16).toString('hex');

// 主清單欄位 → v3_sheet_main；sex 存 v3_dogs、formerIds 存 v3_dog_numbers
const columns = { id: 'number', name: 'name', cage: 'cage', note: 'note', walkedDate: 'walked_date' };
const key = dog => dog.id || `名:${dog.name}`;

// 整份替換主清單；舊編號（formerIds）串起來的算同一隻狗，沿用 v3_dog_numbers 既有的狗 ID
export async function importCompactDogs(db, input) {
  const numbers = new Map((await db.prepare('SELECT number,dog_id FROM v3_dog_numbers').all()).results.map(r => [r.number, r.dog_id]));
  // 沒有編號的狗只剩名字能認，用名字延續上次的狗 ID；有編號的狗只看編號，同名也不合併。
  const unnumbered = new Map((await db.prepare("SELECT name,dog_id FROM v3_sheet_main WHERE number=''").all()).results.map(r => [r.name, r.dog_id]));
  const parents = new Map();
  const root = n => {
    if (!parents.has(n)) parents.set(n, n);
    if (parents.get(n) !== n) parents.set(n, root(parents.get(n)));
    return parents.get(n);
  };
  for (const dog of input.dogs) {
    const own = root(key(dog));
    for (const number of dog.formerIds || []) parents.set(root(number), root(own));
  }
  const groups = new Map();
  for (const number of parents.keys()) {
    const group = root(number);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(number);
  }
  const resolved = new Map();
  for (const [group, members] of groups) {
    const ids = new Set(members.map(n => numbers.get(n)).filter(Boolean));
    for (const dog of input.dogs.filter(d => !d.id && root(key(d)) === group)) {
      if (unnumbered.has(dog.name)) ids.add(unnumbered.get(dog.name));
    }
    if (ids.size > 1) throw new Error(`編號對照衝突，不合併既有狗：${members.join(', ')}`);
    const dogId = [...ids][0] || newId();
    for (const number of members) resolved.set(number, dogId);
  }
  const statements = [db.prepare('DELETE FROM v3_sheet_main')];
  for (const [i, dog] of input.dogs.entries()) {
    const dogId = resolved.get(key(dog));
    statements.push(db.prepare('INSERT INTO v3_dogs(dog_id,name,sex) VALUES(?,?,?) ON CONFLICT(dog_id) DO UPDATE SET name=excluded.name,sex=excluded.sex').bind(dogId, dog.name, dog.sex || ''));
    for (const number of [dog.id, ...(dog.formerIds || [])].filter(Boolean)) {
      statements.push(db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?) ON CONFLICT(number) DO NOTHING').bind(number, dogId));
    }
    const scalar = Object.keys(columns);
    const values = scalar.map(f => dog[f] ?? (f === 'walkedDate' ? null : ''));
    const names = ['row_index', 'dog_id', 'walker_codes', ...scalar.map(f => columns[f])];
    statements.push(db.prepare(`INSERT INTO v3_sheet_main(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`).bind(i, dogId, JSON.stringify(dog.walkers || []), ...values));
  }
  if (input.syncedAt) statements.push(db.prepare(`INSERT INTO v3_sync_state(key,value) VALUES('${SYNCED_AT_KEY}',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(input.syncedAt));
  await db.batch(statements);
  return { dogs: input.dogs.length, identities: groups.size };
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// 同一隻狗同一天以最後一筆有 walkers 的為準；只有 mine、沒記人的舊紀錄仍算那天有溜
function canonicalWalks(source) {
  const days = new Map();
  for (const w of source.walks) {
    const k = `${w.id || w.name}|${w.date}`, day = days.get(k) || { id: w.id || '', name: w.name, date: w.date };
    if (Array.isArray(w.walkers)) { day.name = w.name; day.walkers = [...w.walkers]; } else if (!day.walkers) day.name = w.name;
    days.set(k, day);
  }
  return [...days.values()].sort((a, b) => byText(a.date, b.date) || byText(a.id, b.id) || byText(a.name, b.name));
}

// 永久狗 ID：有編號用 v3_dog_numbers，沒編號用同名的無編號狗；都找不到就新建
async function ensureDogs(db, wanted) {
  const numbers = new Map((await db.prepare('SELECT number,dog_id FROM v3_dog_numbers').all()).results.map(r => [r.number, r.dog_id]));
  const unnumbered = new Map([
    ...(await db.prepare("SELECT dog_name AS name,dog_id FROM v3_walks WHERE dog_number=''").all()).results,
    ...(await db.prepare("SELECT name,dog_id FROM v3_sheet_main WHERE number=''").all()).results,
  ].map(r => [r.name, r.dog_id]));
  const out = new Map(), statements = [];
  for (const { number, name } of wanted) {
    const k = number || `名:${name}`;
    if (out.has(k)) continue;
    let id = number ? numbers.get(number) : unnumbered.get(name);
    if (!id) {
      id = newId();
      statements.push(db.prepare('INSERT INTO v3_dogs(dog_id,name,sex) VALUES(?,?,?)').bind(id, name || '', ''));
      if (number) statements.push(db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(number, id));
    }
    out.set(k, id);
  }
  if (statements.length) await db.batch(statements);
  return (number, name) => out.get(number || `名:${name}`);
}

// 整份替換溜狗紀錄；有給 intros／rest 才換介紹、休養（空白介紹不存）
export async function importCompactProfiles(db, input) {
  const { walks, intros = {}, rest = {}, names = {} } = input;
  const days = canonicalWalks(walks);
  const nameFor = n => names[n] || days.findLast(d => d.id === n)?.name || '';
  const idOf = await ensureDogs(db, [
    ...days.map(d => ({ number: d.id, name: d.name })),
    ...[...Object.keys(intros), ...Object.keys(rest)].map(n => ({ number: n, name: nameFor(n) })),
  ]);
  // 同一隻狗的新舊編號各給一份時只存一份
  const introByDog = new Map(Object.entries(intros).filter(([, text]) => text.trim()).map(([n, intro]) => [idOf(n), intro]));
  const restByDog = new Map(Object.entries(rest).map(([n, r]) => [idOf(n), r]));
  const tables = ['v3_walks', ...(input.intros ? ['v3_intros'] : []), ...(input.rest ? ['v3_rest'] : [])];
  const statements = tables.map(t => db.prepare(`DELETE FROM ${t}`));
  for (const d of days) {
    const codes = d.walkers?.length ? d.walkers : [null];
    codes.forEach((code, position) => statements.push(db.prepare('INSERT INTO v3_walks(dog_id,walk_date,position,walker_name,walker_code,dog_number,dog_name) VALUES(?,?,?,NULL,?,?,?)').bind(idOf(d.id, d.name), d.date, position, code, d.id, d.name)));
  }
  for (const [id, intro] of introByDog) statements.push(db.prepare('INSERT INTO v3_intros(dog_id,intro) VALUES(?,?)').bind(id, intro));
  for (const [id, r] of restByDog) statements.push(db.prepare('INSERT INTO v3_rest(dog_id,until_date,reason) VALUES(?,?,?)').bind(id, r.until, r.reason || ''));
  await db.batch(statements);
  return { walks: days.length, intros: introByDog.size, rest: restByDog.size };
}

// 整份替換有編號的離所紀錄（只有名字的已出所狗卡不動）；不認得的編號新建狗
export async function importCompactDepartures(db, departures) {
  const list = JSON.parse(JSON.stringify(departures));
  const known = new Map((await db.prepare('SELECT number,dog_id FROM v3_dog_numbers').all()).results.map(r => [r.number, r.dog_id]));
  const newDogs = [];
  for (const e of list) {
    if (known.has(e.id)) continue;
    const id = newId();
    newDogs.push(db.prepare('INSERT INTO v3_dogs(dog_id,name,sex) VALUES(?,?,?)').bind(id, e.name, ''), db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(e.id, id));
    known.set(e.id, id);
  }
  if (newDogs.length) await db.batch(newDogs);
  const statements = [db.prepare("DELETE FROM v3_dog_departures WHERE number<>''")];
  const json = (values = []) => JSON.stringify(values);
  for (const e of list) {
    const l = e.last;
    statements.push(db.prepare(`INSERT INTO v3_dog_departures(dog_id,number,name,departed_date,date_source,seen_date,reason,matched,flags_json,returned_number,
      last_number,last_name,last_cage,last_walked_date,last_note,last_sex,last_intro,former_json,groups_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      known.get(e.id), e.id, e.name, e.date ?? null, e.dateSource ?? null, e.seen ?? null, e.reason || 'unknown', e.matched || '', json(e.flags), e.returned ?? null,
      l ? l.id : null, l ? l.name : null, l ? l.cage : null, l ? l.walkedDate ?? null : null, l ? l.note : null, l ? l.sex : null, l ? l.intro : null,
      json(l && l.formerIds), json(l && l.groups)));
  }
  await db.batch(statements);
  return { departures: list.length };
}
