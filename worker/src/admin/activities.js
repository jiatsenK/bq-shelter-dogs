// #567 管理網站的活動紀錄：共用 activities.js 的驗證、revision 與資料表，不另存一份。
// 管理者不受志工活動開關限制；每次修改的紀錄（editor_name「管理者」＋Access 身分）跟活動同一個交易。
import { ActivityError, activityLog, cleanActivity, createActivity, deleteActivity, resolveDogs, updateActivity } from '../activities.js';
import { taiwanYmd } from '../sync-plan.js';
import { editLogWrites } from '../editlog.js';

function auditor(db, actor, now) {
  const requestId = crypto.randomUUID(), at = new Date(now).toISOString();
  return ({ before, after }, when, args) => editLogWrites(db, { at, name: '管理者', kind: 'activity', before: activityLog(before), after: activityLog(after),
    source: 'access', actor: { requestId, subject: actor.subject, email: actor.email } }, [when, ...args]);
}

export async function writeActivity(db, method, id, input, actor, now = Date.now()) {
  if (!(id ? ['PUT', 'DELETE'] : ['POST']).includes(method)) throw new ActivityError(405, '活動紀錄只能新增、修改或刪除');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ActivityError(400, '格式不對');
  const revision = Number.isSafeInteger(input.revision) ? input.revision : null;
  if (id && revision === null) throw new ActivityError(400, '請重新讀取後再改');
  const audit = auditor(db, actor, now);
  if (method === 'DELETE') {
    await deleteActivity(db, id, revision, audit);
    return { deleted: id };
  }
  const act = cleanActivity(input, taiwanYmd(now));
  act.dogs = await resolveDogs(db, act.dogs);
  if (method === 'POST') return { activity: await createActivity(db, act, audit) };
  const { after } = await updateActivity(db, id, revision, act, audit);
  if (!after) throw new ActivityError(404, '找不到這場活動（可能已經被刪掉），請重新整理');
  return { activity: after };
}
