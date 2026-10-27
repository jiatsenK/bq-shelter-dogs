// 本機合成資料預演：SQLite total_changes 包含 trigger；索引另用保守上界列出。
// 不呼叫正式 D1／Google／測試服務。
import { setup, post, request, current } from './walk-fixture.mjs';
import { dispatchWalk } from '../src/walk-accept.js';
const env = await setup(), real = globalThis.fetch;
const total = async () => (await env.DB.prepare('SELECT total_changes() AS n').first()).n;
const measure = async (name, fn) => { const before = await total(); await fn(); return { name, changedRows:await total()-before }; };
const report = [];
try {
  report.push(await measure('accept',async () => { if ((await post(env,request('preview-0001'))).status !== 200) throw new Error('accept failed'); }));
  report.push(await measure('same request replay',() => post(env,request('preview-0001'))));
  globalThis.fetch = async () => { throw new Error('synthetic Google failure'); };
  report.push(await measure('dispatch and retained failure',() => dispatchWalk(env.DB,{ id:'9001',name:'測試狗' },env)));
  if ((await current(env)).walks[0].syncStatus !== 'retry') throw new Error('failure not retained');
  const before=await total();
  const tasks=[];
  const worker=(await import('../src/index.js')).default;
  globalThis.fetch=async () => Response.json({ ok:true,rows:[] });
  await worker.scheduled({ scheduledTime:Date.now() },{ ...env,WALK_RETRY_ENABLED:'true' },{ waitUntil:p=>tasks.push(p) });
  await Promise.all(tasks);
  report.push({ name:'unchanged scan and retry not yet due',changedRows:await total()-before });
  const modify = (id, action, version, walker = '乙') => request(id,walker,{ action,editor:'甲',dogs:[{ id:'9001',name:'測試狗',expectedVersion:version }] });
  const edit = modify('preview-edit','edit',1);
  report.push(await measure('edit accepted',async () => { if ((await post(env,edit)).status !== 200) throw new Error('edit failed'); }));
  report.push(await measure('same edit replay',() => post(env,edit)));
  report.push(await measure('stale version rejected',async () => { if ((await post(env,modify('preview-stale','undo',1))).status !== 409) throw new Error('stale accepted'); }));
  const undo = modify('preview-undo','undo',2);
  report.push(await measure('undo accepted',async () => { if ((await post(env,undo)).status !== 200) throw new Error('undo failed'); }));
  report.push(await measure('same undo replay',() => post(env,undo)));
  console.log(JSON.stringify({ report, conservativeReservations:{ accept:40, acceptUnchangedMembers:32, edit:40, undo:40, completeAttempt:96, standaloneTargetOrReceipt:16, manualSnapshotChange:48 }, note:'changedRows includes guards, budget, projection and version triggers; index costs covered by conservative reservations; not production CPU or account-budget acceptance' },null,2));
} finally { globalThis.fetch=real; env.DB.close(); }
