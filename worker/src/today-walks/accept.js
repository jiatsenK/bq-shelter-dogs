// 志工接受（#456）：API 成功承諾止於 D1 原子接受；Google 寫回由持久工作追蹤（dispatch.js）。
import { walkerCode, editorOf } from '../editlog.js';
import { identityByCode } from '../identity.js';
import { names, keyOf, one, taiwanDay, WalkError, changedWalk } from './shared.js';
import { seedState, previousWalk } from './read.js';
import { writeVersion, previousOf } from './version.js';

export async function membersOf(db, text, secret) {
  const members = [];
  for (const name of names(text)) {
    // 沿用既有固定身分。登記不建立、猜測或合併任何人。
    const person = await identityByCode(db, await walkerCode(name, secret));
    if (!members.some(m => m.volunteerId === person.volunteerId)) members.push({ volunteerId: person.volunteerId, name });
  }
  return members;
}

// 已可信讀回的來源名單可含未使用網站的人；只保留精確文字，不建立或推測身分。
export async function sourceMembers(db, text, secret) {
  const members = [];
  for (const name of names(text)) {
    let volunteerId = null;
    try { volunteerId = (await identityByCode(db, await walkerCode(name, secret))).volunteerId; }
    catch (error) { if (error.status !== 409) throw error; }
    members.push({ volunteerId, name });
  }
  return members;
}

export async function acceptWalk(db, env, now, input) {
  if (!db || !env.WALKER_KEY) throw new WalkError(503, '身分服務尚未準備好');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId || '') || input.operationDate !== taiwanDay(now)) throw new WalkError(400, '請求識別或操作日期不對');
  if (!['walk', 'edit', 'undo'].includes(input.action) || !Array.isArray(input.dogs) || input.dogs.length !== 1) throw new WalkError(400, '此入口只接受單狗操作');
  const dog = input.dogs[0], key = keyOf(dog);
  const fingerprint = JSON.stringify({ action: input.action, operationDate: input.operationDate, walker: input.walker, editor: input.editor, dog });
  const stored = () => one(db, 'SELECT fingerprint,result_json FROM v3_walk_requests WHERE request_id=?', input.requestId);
  const replay = old => {
    if (old.fingerprint !== fingerprint) throw new WalkError(409, '相同請求識別不能更改內容');
    return JSON.parse(old.result_json);
  };
  const existing = await stored();
  if (existing) return replay(existing);
  const added = await membersOf(db, input.walker, env.WALKER_KEY);
  if (!added.length) throw new WalkError(400, '要先選好身分');
  const modifying = input.action !== 'walk';
  const editor = modifying ? await editorOf(input.action === 'edit' ? input.editor : input.walker, env.WALKER_KEY) : null;
  if (modifying && !editor) throw new WalkError(400, '要先選好身分');
  if (editor) await membersOf(db, editor.name, env.WALKER_KEY);
  for (let attempt = 0; attempt < 8; attempt++) {
    const old = await one(db, 'SELECT * FROM v3_walk_state WHERE dog_key=?', key) || await seedState(db, dog, input.operationDate);
    if (modifying && (dog.expectedVersion !== old.version || old.effective_date !== input.operationDate)) throw changedWalk(old);
    let members = old.effective_date === input.operationDate
      ? old.members_json ? JSON.parse(old.members_json) : await sourceMembers(db, old.walker, env.WALKER_KEY) : [];
    let effectiveDate = input.operationDate;
    if (input.action === 'undo') {
      if (members.length !== 1) throw changedWalk(old);
      const previous = old.previous_date !== undefined && old.previous_date < input.operationDate ? { date: { date: old.previous_date }, walker: old.previous_walker }
        : await previousWalk(db, dog, input.operationDate);
      if (!previous) throw new WalkError(409, '找不到唯一的主清單狗');
      effectiveDate = previous.date.date || '';
      members = await sourceMembers(db, previous.walker, env.WALKER_KEY);
    } else if (input.action === 'edit') {
      members = added;
    } else {
      for (const person of added) {
        const existingMember = members.find(m => m.volunteerId === person.volunteerId || (!m.volunteerId && m.name === person.name));
        if (existingMember && !existingMember.volunteerId) existingMember.volunteerId = person.volunteerId;
        else if (!existingMember) members.push(person);
      }
    }
    const walker = members.map(m => m.name).join('、'), version = old.version + 1;
    const prev = previousOf(old, old.effective_date === input.operationDate);
    const at = new Date(now).toISOString();
    const result = { ...dog, status: input.action === 'undo' ? 'restored' : 'written', accepted: true, requestId: input.requestId, operationDate: input.operationDate,
      version, current: { date: effectiveDate, walker }, wrote: { walker },
      prev: { date: { date: prev.date }, walker: prev.walker }, syncStatus: 'pending', at };
    // 今天照名單重寫那天；復原就刪掉今天（上一次那天本來就在溜狗紀錄裡，不動）。
    const today = effectiveDate === input.operationDate;
    const codes = today ? [...new Set(await Promise.all(members.map(m => walkerCode(m.name, env.WALKER_KEY))))] : [];
    const before = { date: old.effective_date, walker: old.walker };
    // 按溜了：操作者是這次按的人（一起溜就全部）；已經在今天名單裡、名單沒變就不記。
    // 名單照拆開的名字比（#707）：沒有溜狗狀態的狗改前是表上原文，可能用逗號或空白分隔
    const logs = editor ? [{ entry: { at, kind: input.action === 'undo' ? 'walkundo' : 'walkedit', source: 'volunteer', code: editor.code, name: editor.name, dogId: old.dog_id, number: dog.id, before, after: result.current } }]
      : before.date !== effectiveDate || names(before.walker).join('、') !== walker ? [{ entry: { at, kind: 'walk', source: 'volunteer', code: added.length === 1 ? await walkerCode(added[0].name, env.WALKER_KEY) : '',
        name: added.map(m => m.name).join('、'), dogId: old.dog_id, number: dog.id, before, after: result.current } }] : [];
    try {
      await writeVersion(db, env, now, { old, previous: prev, history: today ? 'rewrite' : 'drop', codes, logs,
        next: { dog, key, date: effectiveDate, walker, members, operationDate: input.operationDate, at, status: 'pending' },
        request: { id: input.requestId, fingerprint, result } });
      return result;
    } catch (error) {
      const duplicate = await stored();
      if (duplicate) return replay(duplicate);
      const latest = await one(db, 'SELECT version FROM v3_walk_state WHERE dog_key=?', key);
      if ((latest?.version || 0) === old.version) throw error;
    }
  }
  throw new WalkError(409, '登記競爭中，請用原請求再試');
}
