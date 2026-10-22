// 合成資料＋記憶體 SQLite；不接觸 Google、正式 D1 或已停用的測試服務。
import { setup,post,request,day } from './walk-fixture.mjs';
import { writebackTarget,confirmWalk,reconcileWalk } from '../src/walk-accept.js';
import { scanNotifiedWalks } from '../src/walk-reconcile.js';
const env=await setup(),dog={ id:'9001',name:'測試狗' },real=globalThis.fetch;
const total=async ()=>(await env.DB.prepare('SELECT total_changes() AS n').first()).n;
const report=[];
async function measure(name,fn) { const before=await total(); await fn(); report.push({ name,changedRows:await total()-before }); }
try {
  await post(env,request('preview-base-0001','甲、丙'));
  const target=await writebackTarget(env.DB,{ dog,dispatchId:'preview-baseline',current:{ date:'2026-10-01',walker:'' } },env);
  await confirmWalk(env.DB,{ dogKey:dog.id,...target },env);
  await post(env,request('preview-add-0002','乙'));
  await measure('same base; keep pending; zero writes',()=>reconcileWalk(env.DB,dog,{ date:day(),walker:'甲、丙' },env));
  await measure('manual deletion plus website addition',()=>reconcileWalk(env.DB,dog,{ date:day(),walker:'丙' },env));
  await measure('repeat same observation; zero writes',()=>reconcileWalk(env.DB,dog,{ date:day(),walker:'丙' },env));
  await measure('manual clear supersedes pending',()=>reconcileWalk(env.DB,dog,{ date:'',walker:'' },env));
  await measure('manual earlier date',()=>reconcileWalk(env.DB,dog,{ date:'2026-09-01',walker:'甲' },env));
  globalThis.fetch=async ()=>Response.json({ ok:true,sig:'preview',rows:[] });
  await measure('notification scan; control claim, completion and fingerprint; no data differences',()=>scanNotifiedWalks(env.DB,env));
  globalThis.fetch=async ()=>{ throw new Error('synthetic unavailable'); };
  await measure('notification failure retained pending',()=>scanNotifiedWalks(env.DB,env));
  console.log(JSON.stringify({ report,conservativeReservations:{ comparison:32,diagnosticOrCleanup:8,controlTransition:8 },
    bound:'At most 2 scan passes x 10 changes x 40, plus at most 5 control transitions x 8 = 840 reserved rows per notification (#460: notification runs the insurance scan); machine observe max 10 x (32+8) = 400. Single-row writeback uses existing reservations separately.',
    note:'total_changes includes data, guards, budget and projection/version triggers; indexes use conservative reservations. Not a live CPU, trigger delivery latency or account-wide budget acceptance.' },null,2));
} finally { globalThis.fetch=real; env.DB.close(); }
