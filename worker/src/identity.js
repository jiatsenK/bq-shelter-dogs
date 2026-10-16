import { walkerCode, walkerNameKey } from './editlog.js';

export class IdentityError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; }
}
const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();

export async function identityByCode(db, code) {
  const person = await one(db, 'SELECT v.volunteer_id, v.name FROM v3_identity_names n JOIN v3_volunteers v USING(volunteer_id) WHERE n.code=?', code);
  if (!person) throw new IdentityError(409, '請重新設定登記名字以接回志工身分');
  return identityOf(db, person.volunteer_id);
}
async function identityOf(db, id) {
  const redirect = await one(db, 'SELECT target_id FROM v3_identity_redirects WHERE volunteer_id=?', id);
  if (redirect) id = redirect.target_id;
  const person = await one(db, 'SELECT volunteer_id,name FROM v3_volunteers WHERE volunteer_id=?', id);
  if (!person) throw new IdentityError(404, '找不到志工身分');
  const names = await rows(db, 'SELECT code,name FROM v3_identity_names WHERE volunteer_id=? ORDER BY code', id);
  return { volunteerId: id, name: person.name, codes: names.map(n => n.code), names: names.map(n => n.name) };
}

// 只有相同正規化名字及同一算法的代號才建立對照，不推測不同名字。
export async function resolveIdentity(db, name, key) {
  return linkIdentityName(db, name, await walkerCode(name, key));
}

// 供離線演練使用已從原服務核對的代號；HTTP 仍由伺服器自行計算，不能接受客戶端指定代號。
export async function linkIdentityName(db, name, code) {
  if (!/^[a-f0-9]{12}$/.test(code)) throw new IdentityError(400, '名字代號格式不對');
  const nameKey = walkerNameKey(name);
  const existing = await one(db, 'SELECT volunteer_id FROM v3_identity_names WHERE code=?', code);
  if (existing) return identityOf(db, existing.volunteer_id);
  const people = await rows(db, 'SELECT volunteer_id,name FROM v3_volunteers ORDER BY volunteer_id');
  const matches = people.filter(p => walkerNameKey(p.name) === nameKey);
  if (matches.length > 1) throw new IdentityError(409, '這個名字有多個既有身分，請先確認對照');
  const id = matches[0]?.volunteer_id || crypto.randomUUID().replaceAll('-', '');
  const storedName = matches[0]?.name || name;
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO v3_volunteers(volunteer_id,name,last_seen) VALUES(?,?,?)').bind(id, name, new Date().toISOString()),
    db.prepare('INSERT INTO v3_volunteer_favorites(volunteer_id,dog_id,added_on) SELECT (SELECT volunteer_id FROM v3_volunteers WHERE name=?),dog_id,added_on FROM v3_favorites WHERE walker_code=? AND NOT EXISTS(SELECT 1 FROM v3_identity_names WHERE code=?) ON CONFLICT(volunteer_id,dog_id) DO UPDATE SET added_on=MIN(added_on,excluded.added_on)').bind(storedName, code, code),
    db.prepare('INSERT INTO v3_volunteer_cards(volunteer_id,dog_id,opened_on) SELECT (SELECT volunteer_id FROM v3_volunteers WHERE name=?),dog_id,opened_on FROM v3_card_opened WHERE walker_code=? AND NOT EXISTS(SELECT 1 FROM v3_identity_names WHERE code=?)').bind(storedName, code, code),
    db.prepare('INSERT OR IGNORE INTO v3_identity_names(code,name_key,name,volunteer_id) VALUES(?,?,?,(SELECT volunteer_id FROM v3_volunteers WHERE name=?))').bind(code, nameKey, name, storedName),
    db.prepare('INSERT OR IGNORE INTO v3_volunteer_codes(code,volunteer_id) SELECT code,volunteer_id FROM v3_identity_names WHERE code=?').bind(code),
  ]);
  return identityByCode(db, code);
}

export async function renameIdentity(db, { code, name, operationId }, key) {
  const signature = JSON.stringify({ code, name });
  const previous = await one(db, 'SELECT * FROM v3_identity_operations WHERE operation_id=?', operationId);
  if (previous) {
    if (previous.request_json !== signature) throw new IdentityError(409, '操作已變更，請重新檢視');
    return identityOf(db, previous.identity_id);
  }
  const revision = (await one(db, 'SELECT revision FROM v3_identity_revision WHERE id=1')).revision;
  const source = await identityByCode(db, code);
  const nextCode = await walkerCode(name, key);
  const target = await one(db, 'SELECT volunteer_id FROM v3_identity_names WHERE code=?', nextCode);
  if (target && target.volunteer_id !== source.volunteerId) throw new IdentityError(409, '這個名字已有人使用，請換一個', { targetCode: nextCode });
  const used = await one(db, 'SELECT volunteer_id FROM v3_volunteers WHERE name=? AND volunteer_id<>?', name, source.volunteerId);
  if (used && !target) {
    await resolveIdentity(db, name, key);
    throw new IdentityError(409, '這個名字已有人使用，請換一個', { targetCode: nextCode });
  }
  const before = { volunteerId: source.volunteerId, name: source.name };
  const after = { volunteerId: source.volunteerId, name };
  await db.batch([
    db.prepare('INSERT INTO v3_identity_guard SELECT CASE WHEN revision=? THEN 1 ELSE 0 END FROM v3_identity_revision WHERE id=1').bind(revision),
    db.prepare('INSERT INTO v3_identity_operations VALUES(?,?,?)').bind(operationId, signature, source.volunteerId),
    ...[['v3_volunteer_favorites', 'v3_favorites', 'added_on'], ['v3_volunteer_cards', 'v3_card_opened', 'opened_on']].map(([owned, legacy, date]) => db.prepare(
      `INSERT INTO ${owned}(volunteer_id,dog_id,${date}) SELECT ?,dog_id,${date} FROM ${legacy} WHERE walker_code=? AND NOT EXISTS(SELECT 1 FROM v3_identity_names WHERE code=?) ON CONFLICT(volunteer_id,dog_id) DO UPDATE SET ${date}=MIN(${owned}.${date},excluded.${date})`
    ).bind(source.volunteerId, nextCode, nextCode)),
    db.prepare('INSERT INTO v3_identity_names(code,name_key,name,volunteer_id) VALUES(?,?,?,?) ON CONFLICT(code) DO NOTHING').bind(nextCode, walkerNameKey(name), name, source.volunteerId),
    db.prepare('INSERT OR IGNORE INTO v3_volunteer_codes(code,volunteer_id) VALUES(?,?)').bind(nextCode, source.volunteerId),
    db.prepare('UPDATE v3_volunteers SET name=? WHERE volunteer_id=?').bind(name, source.volunteerId),
    db.prepare('INSERT INTO v3_edit_log(at,editor_code,editor_name,kind,before_json,after_json) VALUES(?,?,?,?,?,?)').bind(new Date().toISOString(), code, source.name, 'volunteer_rename', JSON.stringify(before), JSON.stringify(after)),
    db.prepare('DELETE FROM v3_identity_guard'),
  ]);
  return identityOf(db, source.volunteerId);
}

export async function identitiesForCodes(db, codes) {
  const people = [];
  for (const code of codes) {
    const person = await identityByCode(db, code);
    if (!people.some(p => p.volunteerId === person.volunteerId)) people.push(person);
  }
  return people;
}
async function summary(db, person) {
  const count = async table => (await one(db, `SELECT COUNT(*) AS n FROM ${table} WHERE volunteer_id=?`, person.volunteerId)).n;
  const walks = await one(db, 'SELECT COUNT(*) AS n FROM v3_walks WHERE walker_code IN (SELECT code FROM v3_identity_names WHERE volunteer_id=?)', person.volunteerId);
  return { ...person, favorites: await count('v3_volunteer_favorites'), cards: await count('v3_volunteer_cards'), walkRows: walks.n };
}
async function mergeState(db, code, targetCode) {
  const revision = (await one(db, 'SELECT revision FROM v3_identity_revision WHERE id=1')).revision;
  const source = await identityByCode(db, code), target = await identityByCode(db, targetCode);
  if (source.volunteerId === target.volunteerId) throw new IdentityError(409, '這兩個名字已是同一位志工');
  return { source, target, revision };
}
async function stateToken(state, key) {
  const bytes = new TextEncoder();
  const secret = await crypto.subtle.importKey('raw', bytes.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', secret, bytes.encode(JSON.stringify(state)));
  return [...new Uint8Array(sig)].map(n => n.toString(16).padStart(2,'0')).join('');
}
export async function previewMerge(db, { code, targetCode }, key) {
  const state = await mergeState(db, code, targetCode);
  const source = await summary(db, state.source), target = await summary(db, state.target);
  // 讀取摘要期間有寫入就重看，不能拿不同時間的摘要確認。
  if ((await one(db, 'SELECT revision FROM v3_identity_revision WHERE id=1')).revision !== state.revision) throw new IdentityError(409, '資料已變動，請重新檢視');
  return { source, target, token: await stateToken(state, key) };
}
export async function mergeIdentity(db, input, key) {
  const { code, targetCode, operationId } = input;
  const signature = JSON.stringify({ code, targetCode, token: input.token });
  const previous = await one(db, 'SELECT * FROM v3_identity_operations WHERE operation_id=?', operationId);
  if (previous) {
    if (previous.request_json !== signature) throw new IdentityError(409, '操作已變更，請重新檢視');
    return identityOf(db, previous.identity_id);
  }
  if (input.confirm !== true) throw new IdentityError(400, '請確認這兩個身分都是我');
  const state = await mergeState(db, code, targetCode);
  if (await stateToken(state, key) !== input.token) throw new IdentityError(409, '資料已變動，請重新檢視');
  const { source, target } = state;
  const before = { source: await summary(db, source), target: await summary(db, target) };
  await db.batch([
    db.prepare('INSERT INTO v3_identity_guard SELECT CASE WHEN revision=? THEN 1 ELSE 0 END FROM v3_identity_revision WHERE id=1').bind(state.revision),
    db.prepare('INSERT INTO v3_identity_operations VALUES(?,?,?)').bind(operationId, signature, target.volunteerId),
    ...[['v3_volunteer_favorites','added_on'],['v3_volunteer_cards','opened_on']].flatMap(([table, date]) => [
      db.prepare(`INSERT INTO ${table}(volunteer_id,dog_id,${date}) SELECT ?,dog_id,${date} FROM ${table} WHERE volunteer_id=? ON CONFLICT(volunteer_id,dog_id) DO UPDATE SET ${date}=MIN(${table}.${date},excluded.${date})`).bind(target.volunteerId, source.volunteerId),
      db.prepare(`DELETE FROM ${table} WHERE volunteer_id=?`).bind(source.volunteerId),
    ]),
    db.prepare('UPDATE v3_identity_names SET volunteer_id=? WHERE volunteer_id=?').bind(target.volunteerId, source.volunteerId),
    db.prepare('UPDATE v3_volunteer_codes SET volunteer_id=? WHERE volunteer_id=?').bind(target.volunteerId, source.volunteerId),
    db.prepare('UPDATE v3_identity_redirects SET target_id=? WHERE target_id=?').bind(target.volunteerId, source.volunteerId),
    db.prepare('UPDATE v3_volunteers SET name=? WHERE volunteer_id=?').bind('__merged:' + source.volunteerId, source.volunteerId),
    db.prepare('INSERT INTO v3_identity_redirects VALUES(?,?)').bind(source.volunteerId, target.volunteerId),
    db.prepare('INSERT INTO v3_edit_log(at,editor_code,editor_name,kind,before_json,after_json) VALUES(?,?,?,?,?,?)').bind(new Date().toISOString(), code, source.name, 'volunteer_merge', JSON.stringify(before), JSON.stringify({ volunteerId: target.volunteerId, name: target.name })),
    db.prepare('DELETE FROM v3_identity_guard'),
  ]);
  return identityOf(db, target.volunteerId);
}
