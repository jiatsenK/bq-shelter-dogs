import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { memoryD1 } from '../../scripts/memory-d1.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';
import { readFlowStatus, DAILY_BUDGET } from '../src/admin/flow.js';

// 資料流頁的燈號（K 2026-10-26）：隔離記憶體 D1，只讀。
const now = Date.parse('2026-10-27T02:00:00.000Z');
const state = (db, key, name, version) => db.prepare(`INSERT INTO v3_walk_state(dog_key,dog_id,number,name,version,effective_date,walker,members_json,base_date,base_walker,previous_date,previous_walker,updated_at)
  VALUES(?,?,?,?,?,'2026-10-27','甲','[]','2026-10-20','乙','','',?)`).bind(key, `${key}`.padStart(32, '0'), key, name, version, `2026-10-27T01:0${version}:00.000Z`);
const outbox = (db, key, version, status, error = '') => db.prepare(`INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at,error)
  VALUES(?,?,'2026-10-27','2026-10-27','甲',?,?,?)`).bind(key, version, status, `2026-10-27T01:0${version}:00.000Z`, error);

test('資料流狀態：只算目前版本還沒寫回的狗，帶衝突、派送中、今天預算與最近登記', async t => {
  const DB = memoryD1();
  t.after(() => DB.close());
  await createCompactDatabase(DB);
  await DB.batch(['1', '2', '3'].map(k => DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(k.padStart(32, '0'), `狗${k}`)));
  await DB.batch([
    state(DB, '1', '狗1', 2), state(DB, '2', '狗2', 1), state(DB, '3', '狗3', 3),
    outbox(DB, '1', 1, 'superseded'), outbox(DB, '1', 2, 'retry', 'writeback-rejected: 找不到唯一的狗'),
    outbox(DB, '2', 1, 'synced'),
    outbox(DB, '3', 3, 'dispatching'),
    DB.prepare("INSERT INTO v3_walk_delivery VALUES('3','d',?)").bind('2026-10-27T01:03:00.000Z'),
    DB.prepare("INSERT INTO v3_walk_conflicts VALUES('2','{}','試算表可能是未確認派送結果')"),
    DB.prepare("INSERT INTO v3_walk_write_budget(day,reserved) VALUES('2026-10-27',1234),('2026-10-26',99)"),
    DB.prepare("INSERT INTO v3_sync_state(key,value) VALUES('synced_at','2026-10-27T09:30:00+08:00'),('dog_list_extra',?)")
      .bind(JSON.stringify({ at: '2026-10-26T01:00:00.000Z', checkedAt: '2026-10-27T01:44:00.000Z', keys: ['main:1', 'main:2'] })),
  ]);
  const s = await readFlowStatus(DB, now);
  assert.equal(s.writeback.total, 2);
  assert.deepEqual(s.writeback.items.map(i => [i.name, i.status, i.error]), [['狗1', 'retry', 'writeback-rejected: 找不到唯一的狗'], ['狗3', 'dispatching', '']]);
  assert.equal(s.conflicts, 1);
  assert.equal(s.delivering, 1);
  assert.deepEqual(s.budget, { day: '2026-10-27', reserved: 1234, limit: DAILY_BUDGET });
  assert.equal(s.lastWalkAt, '2026-10-27T01:03:00.000Z');
  assert.equal(s.dogListChangedAt, '2026-10-27T09:30:00+08:00');
  assert.deepEqual(s.dogListScan, { checkedAt: '2026-10-27T01:44:00.000Z', extra: 2 });
  assert.deepEqual(s.cron.map(j => [j.job, j.state]), [['retry', 'never'], ['scan', 'never'], ['trash', 'never']]);
});

test('資料流狀態：空庫全部是沒有紀錄，不當成出錯', async t => {
  const DB = memoryD1();
  t.after(() => DB.close());
  await createCompactDatabase(DB);
  const s = await readFlowStatus(DB, now);
  assert.deepEqual([s.writeback.total, s.conflicts, s.delivering, s.budget.reserved, s.lastWalkAt, s.dogListChangedAt, s.dogListScan], [0, 0, 0, 0, null, null, null]);
});

test('每日寫入預算跟志工網站設定一樣', async () => {
  const text = await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
  assert.equal(Number(text.match(/"SYNC_DAILY_BUDGET":\s*"(\d+)"/)[1]), DAILY_BUDGET);
});

test('資料流狀態 API：未登入 401 不讀 D1；登入只准讀', async t => {
  const { default: worker } = await import('../src/admin/index.js');
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'flow-key', alg: 'RS256', use: 'sig' };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ keys: [jwk] }));
  const sec = Math.floor(Date.now() / 1000), encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const data = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode({ iss: 'https://flow.cloudflareaccess.com', aud: ['flow-aud'], exp: sec + 3600, iat: sec - 10, nbf: sec - 10, type: 'app', sub: 'm', email: 'm@example.org' })}`;
  const jwt = `${data}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(data))).toString('base64url')}`;
  const origin = 'https://manage-flow.example.org';
  const env = { ADMIN_ORIGIN: origin, ACCESS_TEAM_DOMAIN: 'flow.cloudflareaccess.com', ACCESS_AUD: 'flow-aud' };
  const forbidden = () => { throw Error('unauthorized resource read'); };
  const call = (headers = {}, method = 'GET', DB) => worker.fetch(new Request(`${origin}/api/manage/flow-status`, { method, headers }), { ...env, DB: DB || { prepare: forbidden } });
  assert.equal((await call()).status, 401);
  const DB = memoryD1();
  t.after(() => DB.close());
  await createCompactDatabase(DB);
  const res = await call({ 'Cf-Access-Jwt-Assertion': jwt }, 'GET', DB);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).writeback.total, 0);
  assert.equal((await call({ 'Cf-Access-Jwt-Assertion': jwt, Origin: origin }, 'POST', DB)).status, 405);
});
