import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

// 欄位是否存在也要保留，避免把缺欄的舊 JSON 偷改成預設值。
const columns = {
  id: 'number', name: 'name', cage: 'cage', note: 'note', sex: 'sex', intro: 'intro',
  covered: 'covered', walkedDate: 'walked_date', myWalked: 'my_walked', myWalkedDate: 'my_walked_date',
  walkers: null, formerIds: null,
};
const fields = Object.keys(columns);
const booleans = new Set(['covered', 'myWalked']);
const nullable = new Set(['walkedDate', 'myWalkedDate']);
const key = dog => dog.id || `名:${dog.name}`;

function validate(input) {
  if (!Array.isArray(input?.dogs)) throw new Error('來源必須有 dogs 陣列');
  const keys = new Set();
  for (const dog of input.dogs) {
    if (!dog || typeof dog.name !== 'string' || !dog.name.trim()) throw new Error('狗名不可空白');
    for (const [field, value] of Object.entries(dog)) {
      if (!Object.hasOwn(columns, field)) throw new Error(`未支援欄位：${field}`);
      const valid = field === 'walkers' || field === 'formerIds'
        ? Array.isArray(value) && value.every(v => typeof v === 'string' && v.length > 0)
        : booleans.has(field) ? typeof value === 'boolean'
          : nullable.has(field) ? value === null || typeof value === 'string' : typeof value === 'string';
      if (!valid) throw new Error(`欄位格式錯誤：${key(dog)}.${field}`);
    }
    if (keys.has(key(dog))) throw new Error(`來源鍵重複：${key(dog)}`);
    keys.add(key(dog));
  }
}

// #246：只接受呼叫者提供的 D1 和 JSON，沒有網路或正式資料庫預設值。
// 完整驗證和身分衝突檢查後，單一 batch 原子替換主清單複本。
export async function importCompactDogs(db, input) {
  validate(input);
  const numbers = new Map((await db.prepare('SELECT number,dog_id FROM v3_dog_numbers').all()).results.map(r => [r.number, r.dog_id]));
  const previous = (await db.prepare("SELECT name,dog_id FROM v3_sheet_main WHERE number='' ORDER BY row_index").all()).results;
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
      for (const row of previous.filter(r => r.name === dog.name)) ids.add(row.dog_id);
    }
    if (ids.size > 1) throw new Error(`編號對照衝突，不合併既有狗：${members.join(', ')}`);
    const dogId = [...ids][0] || randomBytes(16).toString('hex');
    for (const number of members) resolved.set(number, dogId);
  }
  const statements = [];
  // 只清掉本次重建的複本子列，不刪永久狗和編號，也不碰舊表。
  for (const table of ['v3_sheet_main_walkers', 'v3_sheet_former_numbers', 'v3_sheet_main']) statements.push(db.prepare(`DELETE FROM ${table}`));
  for (const [i, dog] of input.dogs.entries()) {
    const dogId = resolved.get(key(dog));
    statements.push(db.prepare('INSERT INTO v3_dogs(dog_id,name,sex) VALUES(?,?,?) ON CONFLICT(dog_id) DO UPDATE SET name=excluded.name,sex=excluded.sex').bind(dogId, dog.name, dog.sex || ''));
    for (const number of [dog.id, ...(dog.formerIds || [])].filter(Boolean)) {
      statements.push(db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?) ON CONFLICT(number) DO NOTHING').bind(number, dogId));
    }
    const scalar = fields.filter(f => columns[f]);
    const values = scalar.map(f => booleans.has(f) ? Number(dog[f] || false) : dog[f] ?? (nullable.has(f) ? null : ''));
    const mask = fields.reduce((mask, f, bit) => mask | (Object.hasOwn(dog, f) ? 1 << bit : 0), 0);
    const names = ['row_index', 'dog_id', 'synced_at', 'version', 'fields', ...scalar.map(f => columns[f])];
    statements.push(db.prepare(`INSERT INTO v3_sheet_main(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`).bind(i, dogId, input.syncedAt || '', input.version ?? 1, mask, ...values));
    for (const [position, code] of (dog.walkers || []).entries()) statements.push(db.prepare('INSERT INTO v3_sheet_main_walkers VALUES(?,?,?)').bind(i, position, code));
    for (const [position, number] of (dog.formerIds || []).entries()) statements.push(db.prepare('INSERT INTO v3_sheet_former_numbers VALUES(?,?,?)').bind(i, position, number));
  }
  if (statements.length) await db.batch(statements);
  return { dogs: input.dogs.length, identities: groups.size };
}

export async function readCompactDogs(db) {
  // 同一 batch 讀取，避免同步替換複本時混到不同版本。
  const [main, walkers, former] = await db.batch([
    db.prepare('SELECT * FROM v3_sheet_main ORDER BY row_index'),
    db.prepare('SELECT * FROM v3_sheet_main_walkers ORDER BY row_index,position'),
    db.prepare('SELECT * FROM v3_sheet_former_numbers ORDER BY row_index,position'),
  ]);
  return main.results.map(row => {
    const dog = {};
    fields.forEach((field, bit) => {
      if (!(row.fields & (1 << bit))) return;
      if (field === 'walkers') dog[field] = walkers.results.filter(r => r.row_index === row.row_index).map(r => r.walker_code);
      else if (field === 'formerIds') dog[field] = former.results.filter(r => r.row_index === row.row_index).map(r => r.number);
      else dog[field] = booleans.has(field) ? Boolean(row[columns[field]]) : row[columns[field]];
    });
    return dog;
  });
}

export async function compareCompactDogs(db, input) {
  validate(input);
  const actual = await readCompactDogs(db);
  const differences = [];
  const expectedByKey = new Map(input.dogs.map(d => [key(d), d]));
  const actualByKey = new Map(actual.map(d => [key(d), d]));
  for (const id of new Set([...expectedByKey.keys(), ...actualByKey.keys()])) {
    const expected = expectedByKey.get(id), found = actualByKey.get(id);
    if (!expected || !found) differences.push({ key: id, field: '*', expected: expected ?? null, actual: found ?? null });
    else for (const field of fields) {
      if (Object.hasOwn(expected, field) !== Object.hasOwn(found, field) || !isDeepStrictEqual(expected[field], found[field])) differences.push({ key: id, field, expected: expected[field], actual: found[field] });
    }
  }
  if (!isDeepStrictEqual(input.dogs.map(key), actual.map(key))) differences.push({ key: '*', field: 'order', expected: input.dogs.map(key), actual: actual.map(key) });
  return { equal: differences.length === 0, differences };
}
