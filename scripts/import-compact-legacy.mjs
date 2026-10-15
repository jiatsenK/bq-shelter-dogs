// #249：只匯入舊 D1 的開卡和名字推薦；不建立狗、不推測代號的姓名。
const CARD_SQL = `INSERT INTO v3_card_opened(walker_code,dog_id,opened_on)
  VALUES(?,(SELECT dog_id FROM v3_dog_numbers WHERE number=?),?)
  ON CONFLICT(walker_code,dog_id) DO UPDATE SET opened_on=MIN(v3_card_opened.opened_on,excluded.opened_on)`;
const NAME_SQL = `INSERT INTO v3_volunteers(name,last_seen) VALUES(?,?)
  ON CONFLICT(name) DO UPDATE SET last_seen=CASE
  WHEN julianday(excluded.last_seen)>julianday(v3_volunteers.last_seen) THEN excluded.last_seen ELSE v3_volunteers.last_seen END`;
const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const cardKey = r => `${r.walker_code}|${r.dog_id}`;
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validOffset = value => {
  const offset = value.match(/[+-](\d{2}):(\d{2})$/);
  return !offset || (Number(offset[1]) <= 14 && Number(offset[2]) < 60 && (Number(offset[1]) < 14 || Number(offset[2]) === 0));
};
const validTimestamp = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && validDay(value.slice(0, 10)) && validOffset(value) && Number.isFinite(Date.parse(value))
  && new Date(`${value.slice(0, 19)}Z`).toISOString().slice(0, 19) === value.slice(0, 19);
const nonempty = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');

function validate(input) {
  if (!Array.isArray(input?.cardOpened) || !Array.isArray(input?.walkerNames)) throw new Error('來源必須有 cardOpened 和 walkerNames 陣列，不能把缺少來源當空資料');
  for (const [i, r] of input.cardOpened.entries()) {
    if (!nonempty(r?.walker_code) || !nonempty(r?.dog_id) || !validDay(r?.opened_on)) throw new Error(`cardOpened 第 ${i + 1} 筆格式錯誤`);
  }
  for (const [i, r] of input.walkerNames.entries()) {
    if (!nonempty(r?.name) || !validTimestamp(r?.last_seen)) throw new Error(`walkerNames 第 ${i + 1} 筆格式錯誤`);
  }
}

// baseline 的 dog_id 已是永久 ID；來源的 dog_id 是收容所編號。
// 保留已存在的開卡／較新名字推薦，比對時須傳入匯入前讀回的 baseline。
function mergeRows(source, baseline = { cardOpened: [], walkerNames: [] }) {
  const cards = new Map(), names = new Map();
  for (const r of [...baseline.cardOpened, ...source.cardOpened]) {
    const key = cardKey(r), had = cards.get(key);
    if (!had || r.opened_on < had.opened_on) cards.set(key, { ...r });
  }
  for (const r of [...baseline.walkerNames, ...source.walkerNames]) {
    const had = names.get(r.name);
    if (!had || Date.parse(r.last_seen) > Date.parse(had.last_seen)) names.set(r.name, { ...r });
  }
  return {
    cardOpened: [...cards.values()].sort((a, b) => byText(cardKey(a), cardKey(b))),
    walkerNames: [...names.values()].sort((a, b) => byText(a.name, b.name)),
  };
}

async function resolveSource(db, input) {
  validate(input);
  const numbers = new Map((await db.prepare('SELECT number,dog_id FROM v3_dog_numbers').all()).results.map(r => [r.number, r.dog_id]));
  const missing = [...new Set(input.cardOpened.filter(r => !numbers.has(r.dog_id)).map(r => r.dog_id))];
  if (missing.length) throw new Error(`v3_dog_numbers 找不到編號：${missing.join(', ')}；停止匯入，不建立狗或猜配`);
  return mergeRows({ cardOpened: input.cardOpened.map(r => ({ walker_code: r.walker_code, dog_id: numbers.get(r.dog_id), opened_on: r.opened_on })), walkerNames: input.walkerNames.map(r => ({ name: r.name, last_seen: r.last_seen })) });
}

// 匯入只接收明確提供的 DB，不連線外部服務。完整驗證後，以一個 batch 原子合併，不清表。
export async function importCompactLegacy(db, input) {
  const source = await resolveSource(db, input);
  const statements = [
    ...input.cardOpened.map(r => db.prepare(CARD_SQL).bind(r.walker_code, r.dog_id, r.opened_on)),
    ...input.walkerNames.map(r => db.prepare(NAME_SQL).bind(r.name, r.last_seen)),
  ];
  if (statements.length) await db.batch(statements);
  return { cardOpened: source.cardOpened.length, walkerNames: source.walkerNames.length };
}

export async function readCompactLegacy(db) {
  const [cards, names] = await db.batch([
    db.prepare('SELECT walker_code,dog_id,opened_on FROM v3_card_opened ORDER BY walker_code,dog_id'),
    db.prepare('SELECT name,last_seen FROM v3_volunteers ORDER BY name'),
  ]);
  return { cardOpened: cards.results, walkerNames: names.results };
}

export async function compareCompactLegacy(db, input, baseline) {
  const expected = mergeRows(await resolveSource(db, input), baseline);
  const actual = await readCompactLegacy(db), differences = [];
  for (const [kind, keyOf, field] of [['cardOpened', cardKey, 'opened_on'], ['walkerNames', r => r.name, 'last_seen']]) {
    const wanted = new Map(expected[kind].map(r => [keyOf(r), r]));
    const found = new Map(actual[kind].map(r => [keyOf(r), r]));
    for (const key of new Set([...wanted.keys(), ...found.keys()])) {
      const want = wanted.get(key), got = found.get(key);
      if (!want || !got) differences.push({ kind, key, field: '*', expected: want ?? null, actual: got ?? null });
      else if (want[field] !== got[field]) differences.push({ kind, key, field, expected: want[field], actual: got[field] });
    }
  }
  return { equal: differences.length === 0, differences };
}

// SQL 在正式庫執行時才查永久 ID，不寫入本機演練隨機產生的 ID。
// 未知編號的純量子查詢回 NULL，由 NOT NULL 約束拒絕；可重跑的 UPSERT 不刪現有資料。
export function renderCompactLegacySql(input) {
  validate(input);
  const quote = text => `'${text.replace(/'/g, "''")}'`;
  const literal = (sql, values) => {
    let i = 0;
    return `${sql.replace(/\?/g, () => quote(values[i++]))};`;
  };
  return [
    '-- #249 私密匯入 SQL；請 K 確認目標資料庫、編號對照與備份後再執行。',
    '-- 只合併 v3_card_opened / v3_volunteers，不建表、不刪資料、不改其他表。',
    ...input.cardOpened.map(r => literal(CARD_SQL, [r.walker_code, r.dog_id, r.opened_on])),
    ...input.walkerNames.map(r => literal(NAME_SQL, [r.name, r.last_seen])),
    '',
  ].join('\n');
}
