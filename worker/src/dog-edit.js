import { cleanStayTable, stayTable, storedStays } from './stays.js';
import { editLogWrites } from './editlog.js';

export const editError = (status, message) => Object.assign(new Error(message), { status });
const conflict = () => editError(409, '這隻狗的資料已變更，草稿仍保留；請重新讀取後核對再儲存');
const json = JSON.stringify;
const today = (now) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
export async function dogIdentity(db, key) {
  return db
    .prepare('SELECT dog_id FROM v3_dogs WHERE dog_id=? UNION SELECT dog_id FROM v3_dog_numbers WHERE number=?')
    .bind(key, key)
    .first('dog_id');
}
// GAS may have prepared a change while a human removed an old number. Check
// its observed identity version inside the same D1 transaction as those writes.
export async function guardedDogBatch(db, expected, statements) {
  if (!expected) return db.batch(statements);
  const id = crypto.randomUUID();
  const result = await db.batch([
    db
      .prepare(
        'INSERT INTO v3_dog_edit_guard(id,valid) VALUES(?,EXISTS(SELECT 1 FROM v3_dog_edit_state WHERE dog_id=? AND revision=?))'
      )
      .bind(id, expected.dog_id, expected.revision),
    ...statements,
    db.prepare('DELETE FROM v3_dog_edit_guard WHERE id=?').bind(id)
  ]);
  return result.slice(1, -1);
}
// A single statement provides the complete editable snapshot and its CAS version.
export async function readDogEdit(db, dogId) {
  const row = await db
    .prepare(
      `SELECT d.dog_id,d.sex,d.fixed_care,s.revision,
    COALESCE((SELECT intro FROM v3_intros WHERE dog_id=d.dog_id),'') AS intro,
    (SELECT json_object('until',until_date,'reason',reason) FROM v3_rest WHERE dog_id=d.dog_id) AS rest,
    COALESCE((SELECT stays_json FROM v3_stays WHERE dog_id=d.dog_id),'[]') AS stays,
    (SELECT json_group_array(number) FROM (SELECT number FROM v3_dog_numbers WHERE dog_id=d.dog_id ORDER BY number)) AS numbers,
    (SELECT json_group_array(number) FROM v3_sheet_main WHERE dog_id=d.dog_id AND number<>'') AS current_numbers,
    (SELECT json_group_array(json_object('number',number,'date',departed_date,'reason',reason)) FROM v3_dog_departures WHERE dog_id=d.dog_id AND number<>'') AS departures,
    '[]' AS sex_copies,
    (SELECT json_object('key',object_key,'thumb',thumb_key) FROM v3_photos WHERE dog_id=d.dog_id AND is_primary=1) AS photo
    FROM v3_dogs d JOIN v3_dog_edit_state s USING(dog_id) WHERE d.dog_id=?`
    )
    .bind(dogId)
    .first();
  if (!row) throw editError(404, '找不到這隻狗');
  const numbers = JSON.parse(row.numbers),
    departures = JSON.parse(row.departures);
  return {
    dogId,
    revision: row.revision,
    intro: row.intro,
    sex: row.sex,
    fixedCare: Boolean(row.fixed_care),
    rest: JSON.parse(row.rest),
    // 出入所表（ADR 0021）：每個編號一列＋沒編號的手填紀錄
    stays: stayTable(JSON.parse(row.stays), numbers, departures),
    numbers,
    currentNumbers: JSON.parse(row.current_numbers),
    departures,
    sexCopies: JSON.parse(row.sex_copies),
    photo: JSON.parse(row.photo)
  };
}
export function validFormer(value, now = Date.now()) {
  if (!/^\d{10}$/.test(value)) return false;
  const day = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  return !isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day && day <= today(now);
}
export function cleanDogValue(field, value, before, now, { admin = false } = {}) {
  if (field === 'intro') {
    if (typeof value !== 'string') throw editError(400, '介紹格式不對');
    const text = value
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
      .trim();
    if ([...text].length > 1000) throw editError(413, '介紹最多 1000 字');
    return text;
  }
  if (field === 'sex') {
    if (!['male', 'female', ''].includes(value)) throw editError(400, '性別請選公、母或待確認');
    return value;
  }
  if (field === 'fixedCare') {
    if (typeof value !== 'boolean') throw editError(400, '請指定開啟或關閉');
    return value;
  }
  if (field === 'stays') {
    // 補編號就是補一列、刪編號就是刪那一列（ADR 0021）；目前編號不能刪。管理者可以改離所日（#663）
    const cleaned = cleanStayTable(value, before, today(now), { admin });
    if (cleaned.error) throw editError(cleaned.conflict ? 409 : 400, cleaned.error);
    return cleaned.rows;
  }
  if (field === 'rest') {
    if (value === null) return null;
    if (
      !value ||
      Object.keys(value).sort().join(',') !== 'reason,until' ||
      typeof value.until !== 'string' ||
      typeof value.reason !== 'string'
    )
      throw editError(400, '休養格式不對');
    const days = (Date.parse(value.until + 'T00:00:00Z') - Date.parse(today(now))) / 86400000;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value.until) ||
      !Number.isInteger(days) ||
      new Date(value.until).toISOString().slice(0, 10) !== value.until ||
      days < 0 ||
      days > 180
    )
      throw editError(400, '休養日期須介於今天至 180 天內');
    const reason = value.reason.replace(/\s+/g, ' ').trim();
    if ([...reason].length > 40) throw editError(413, '原因最多 40 字');
    return { until: value.until, reason };
  }
  if (field === 'numbers') {
    if (
      !Array.isArray(value) ||
      value.length > 100 ||
      value.some((n) => typeof n !== 'string' || !validFormer(n, now)) ||
      new Set(value).size !== value.length
    )
      throw editError(400, '舊編號須為有效日期的 10 碼數字，不能重複');
    if (before.currentNumbers.some((n) => !value.includes(n))) throw editError(409, '不能刪除目前編號');
    const current = before.currentNumbers
      .filter((n) => /^\d{10}$/.test(n))
      .sort()
      .at(-1);
    if (current && value.some((n) => !before.numbers.includes(n) && n > current))
      throw editError(400, '舊編號不能晚於目前編號');
    return [...value].sort();
  }
  throw editError(400, '此欄位不能修改');
}
// D1 batch is one transaction. The token scopes every mutation and audit to the
// winning CAS; a log failure rolls the claim and data changes back together.
export async function saveDogEdit(
  db,
  dogId,
  input,
  { actor, editor, photo = false, photoBefore, dogNumber } = {}
) {
  if (!input || Object.keys(input).sort().join(',') !== 'field,revision,value' || !Number.isSafeInteger(input.revision))
    throw editError(400, '請重新讀取後再改');
  if (actor ? !actor.subject || !actor.email : !editor?.name) throw editError(403, '操作者未確認');
  if (input.field === 'sex' && !actor) throw editError(403, '性別僅限管理者補正');
  const before = await readDogEdit(db, dogId);
  if (before.revision !== input.revision) throw conflict();
  const field = input.field,
    now = Date.now();
  const value = field === 'photo' && photo ? input.value : cleanDogValue(field, input.value, before, now, { admin: Boolean(actor) });
  if (json(before[field]) === json(value)) return before;
  // 出入所表改到的編號：跟舊編號（/former）同一套寫法
  const nextNumbers =
    field === 'numbers' ? value : field === 'stays' ? value.filter((r) => r.number).map((r) => r.number) : null;
  if (nextNumbers) {
    for (const n of nextNumbers.filter((n) => !before.numbers.includes(n))) {
      const owner = await dogIdentity(db, n);
      if (owner && owner !== dogId) throw editError(409, '編號屬於另一隻狗，不能合併');
    }
  }
  const token = crypto.randomUUID();
  const guard = 'EXISTS(SELECT 1 FROM v3_dog_edit_state WHERE dog_id=? AND token=?)';
  const statement = (sql, args = []) => db.prepare(sql).bind(...args, dogId, token);
  const writes = [
    db
      .prepare('UPDATE v3_dog_edit_state SET revision=revision+1,token=? WHERE dog_id=? AND revision=?')
      .bind(token, dogId, input.revision)
  ];
  if (field === 'intro' && !value) writes.push(statement(`DELETE FROM v3_intros WHERE dog_id=? AND ${guard}`, [dogId]));
  if (field === 'intro' && value)
    writes.push(
      statement(
        `INSERT INTO v3_intros(dog_id,intro) SELECT ?,? WHERE ${guard} ON CONFLICT(dog_id) DO UPDATE SET intro=excluded.intro`,
        [dogId, value]
      )
    );
  if (field === 'sex' || field === 'fixedCare')
    writes.push(
      statement(`UPDATE v3_dogs SET ${field === 'sex' ? 'sex' : 'fixed_care'}=? WHERE dog_id=? AND ${guard}`, [
        field === 'sex' ? value : Number(value),
        dogId
      ])
    );
  if (field === 'rest') {
    writes.push(
      value
        ? statement(
            `INSERT INTO v3_rest(dog_id,until_date,reason) SELECT ?,?,? WHERE ${guard} ON CONFLICT(dog_id) DO UPDATE SET until_date=excluded.until_date,reason=excluded.reason`,
            [dogId, value.until, value.reason]
          )
        : statement(`DELETE FROM v3_rest WHERE dog_id=? AND ${guard}`, [dogId])
    );
  }
  const stored = field === 'stays' ? storedStays(value) : null;
  if (stored && !stored.length) writes.push(statement(`DELETE FROM v3_stays WHERE dog_id=? AND ${guard}`, [dogId]));
  if (stored?.length)
    writes.push(
      statement(
        `INSERT INTO v3_stays(dog_id,stays_json) SELECT ?,? WHERE ${guard} ON CONFLICT(dog_id) DO UPDATE SET stays_json=excluded.stays_json`,
        [dogId, json(stored)]
      )
    );
  // 管理者改了有離所紀錄那列的離所日（#663）：改離所紀錄本身，記成手動修正，同步就不再從試算表蓋回去
  if (field === 'stays')
    for (const row of value.filter(
      (r) => r.departed && r.out !== (before.departures.find((d) => d.number === r.number)?.date || '')
    ))
      writes.push(
        statement(
          `UPDATE v3_dog_departures SET departed_date=?,date_source='manual' WHERE number=? AND dog_id=? AND ${guard}`,
          [row.out, row.number, dogId]
        )
      );
  if (nextNumbers) {
    for (const n of before.numbers.filter((n) => !nextNumbers.includes(n))) {
      writes.push(statement(`DELETE FROM v3_dog_numbers WHERE number=? AND dog_id=? AND ${guard}`, [n, dogId]));
    }
    for (const n of nextNumbers.filter((n) => !before.numbers.includes(n)))
      writes.push(statement(`INSERT INTO v3_dog_numbers(number,dog_id) SELECT ?,? WHERE ${guard}`, [n, dogId]));
  }
  if (field === 'photo') {
    writes.push(statement(`UPDATE v3_photos SET is_primary=0 WHERE dog_id=? AND is_primary=1 AND ${guard}`, [dogId]));
    if (value)
      writes.push(
        statement(
          `INSERT INTO v3_photos(object_key,dog_id,thumb_key,is_primary,uploaded_at) SELECT ?,?,?,1,? WHERE ${guard} ON CONFLICT(object_key) DO UPDATE SET is_primary=1`,
          [value.key, dogId, value.thumb, new Date(now).toISOString()]
        )
      );
  }
  const kind = { fixedCare: 'fixed-care', numbers: 'former' }[field] || field;
  writes.push(
    ...editLogWrites(
      db,
      {
        at: new Date(now).toISOString(),
        code: actor ? '' : editor.code || '',
        name: actor ? '管理者' : editor.name,
        kind,
        dogId,
        number: dogNumber ?? before.currentNumbers[0] ?? '',
        before: field === 'photo' ? photoBefore : field === 'stays' && !before.stays.length ? null : before[field],
        after: field === 'stays' && !value.length ? null : value,
        source: actor ? 'access' : 'volunteer',
        actor: { requestId: token, subject: actor?.subject || '', email: actor?.email || '' }
      },
      [guard, dogId, token]
    )
  );
  const result = await db.batch(writes);
  if (!result[0].meta.changes) throw conflict();
  return readDogEdit(db, dogId);
}
