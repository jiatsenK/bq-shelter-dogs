import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';
import { resolveIdentity } from '../src/identity.js';

const SITE = 'https://bq-shelter-dogs.example.workers.dev';
export const day = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export async function setup() {
  const DB = fakeD1();
  await createCompactDatabase(DB);
  await DB.batch([
    DB.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('dog','測試狗')"),
    DB.prepare("INSERT INTO v3_dog_numbers VALUES('9001','dog')"),
    DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date) VALUES(1,'dog','9001','測試狗','2026-10-01')"),
  ]);
  for (const name of ['甲','乙','丙']) await resolveIdentity(DB, name, 'test');
  return { DB, WALKER_KEY: 'test', SHEET_WRITE_URL: 'https://script.example/exec', SHEET_WRITE_KEY: 'test-secret' };
}
export const request = (id, walker = '甲', extra = {}) => ({ action: 'walk', requestId: id, operationDate: day(), walker, dogs: [{ id: '9001', name: '測試狗' }], ...extra });
// app：要接到試算表的話傳 apps-script.mjs 的 gas.worker（有 ctx 時登記後背景派送）
export async function post(env, body, ctx, app = worker) {
  const res = await app.fetch(new Request(`${SITE}/api/walk`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, ctx);
  return { status: res.status, body: await res.json() };
}
export async function current(env) {
  return (await worker.fetch(new Request(`${SITE}/api/today?source=d1`, { headers: { Origin: SITE } }), env)).json();
}
// 排程跑一次（沒帶 cron 跑保險掃描再寫回重試），等背景工作做完
export async function tick(gas, env, at, cron) {
  const tasks = [];
  await gas.worker.scheduled({ scheduledTime: at, cron }, env, { waitUntil: p => tasks.push(p) });
  await Promise.allSettled(tasks);
}
// 主清單多一隻狗：D1 和表上都有，表上上次溜是 2026/10/1
export async function addDog(env, gas, { id, dogId, name, row }) {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(dogId, name),
    env.DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?)').bind(id, dogId),
    env.DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date) VALUES(?,?,?,?,'2026-10-01')").bind(row, dogId, id, name),
  ]);
  gas?.add(id, name);
}
