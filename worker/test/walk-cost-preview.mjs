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
  console.log(JSON.stringify({ report, conservativeReservations:{ accept:32, claimIncludingRelease:16, target:16, receipt:16, failure:16 }, note:'changedRows includes guards, budget, projection and version triggers; index costs covered by conservative reservations; not production CPU or account-budget acceptance' },null,2));
} finally { globalThis.fetch=real; env.DB.close(); }
