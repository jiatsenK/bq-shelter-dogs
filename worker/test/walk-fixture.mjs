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
export async function post(env, body, ctx) {
  const res = await worker.fetch(new Request(`${SITE}/api/walk`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, ctx);
  return { status: res.status, body: await res.json() };
}
export async function current(env) {
  return (await worker.fetch(new Request(`${SITE}/api/today?source=d1`, { headers: { Origin: SITE } }), env)).json();
}
