import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { setup, post, request, day } from './walk-fixture.mjs';

const SITE = 'https://bq-shelter-dogs.jiatsen-k.workers.dev';
const getWalkers = env => worker.fetch(new Request(`${SITE}/api/walkers`, { headers: { Origin: SITE } }), env).then(async r => ({ status: r.status, body: await r.json() }));

// #519：/walkers 從 D1（主清單、今日溜狗狀態、志工代號）讀，不連 Google
test('#519 GET /walkers 從 D1 回每隻狗的誰遛的、日期與名字；最近出現的名字在前', async () => {
  const env = await setup(); worker.testing.resetState();
  const { DB } = env;
  const code = async name => (await DB.prepare('SELECT code FROM v3_identity_names WHERE name=?').bind(name).first()).code;
  await DB.batch([
    DB.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('d2','甜甜'),('d3','新來的')"),
    DB.prepare("INSERT INTO v3_dog_numbers VALUES('9002','d2')"),
    DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date) VALUES(2,'d2','9002','甜甜','2026-09-01'),(3,'d3','','新來的',NULL)"),
    DB.prepare('UPDATE v3_sheet_main SET walker_codes=json_array(?,?) WHERE row_index=2').bind(await code('丙'), await code('甲')),
  ]);
  const fetched = [];
  globalThis.fetch = async url => { fetched.push(String(url)); throw new Error('不該連網路'); };
  assert.equal((await post(env, request('walkers-0001', '乙'))).status, 200);
  worker.testing.resetState();

  const { status, body } = await getWalkers(env);
  assert.equal(status, 200);
  assert.deepEqual(body.walkers, { 9001: '乙', 9002: '丙、甲', '名:新來的': '' });
  assert.deepEqual(body.dates, { 9001: day(), 9002: '2026-09-01', '名:新來的': '' });
  assert.deepEqual(body.names, ['乙', '丙', '甲'], '今天遛的在前，同一天照表上順序');
  assert.ok(Date.parse(body.readAt));
  assert.equal(body.codes[await code('乙')], '乙');
  assert.ok(!fetched.some(u => u.includes('docs.google.com')), '不讀試算表 gviz');
});

test('#519 GET /walkers：沒接資料庫回 off', async () => {
  worker.testing.resetState();
  assert.equal((await getWalkers({ SHEET_ID: 'abc' })).body.code, 'off');
});

// #554：主清單「誰遛的」原文都補好（正式庫已經沒有 NULL）就不讀代號換名字那句；正式庫一次白讀 772 列（#559 起代號是主清單的 walker_codes 欄）
test('#554 GET /walkers：主清單都有「誰遛的」原文就不讀代號 JOIN，有 NULL 才只補那幾隻', async () => {
  const env = await setup(); worker.testing.resetState();
  const { DB } = env;
  const code = async name => (await DB.prepare('SELECT code FROM v3_identity_names WHERE name=?').bind(name).first()).code;
  await DB.batch([
    DB.prepare("UPDATE v3_sheet_main SET walker='乙' WHERE row_index=1"),
    DB.prepare('UPDATE v3_sheet_main SET walker_codes=json_array(?) WHERE row_index=1').bind(await code('甲')),
  ]);
  const sqls = [];
  const prepare = DB.prepare;
  DB.prepare = sql => { sqls.push(sql); return prepare(sql); };
  let body = (await getWalkers(env)).body;
  assert.deepEqual(body.walkers, { 9001: '乙' }, '有原文就用原文');
  assert.ok(!sqls.some(s => s.includes('walker_codes')), '沒有 NULL 不讀代號');

  DB.prepare = prepare;
  await DB.batch([
    DB.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('d2','甜甜')"),
    DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date) VALUES(2,'d2','9002','甜甜','2026-09-01')"),
    DB.prepare('UPDATE v3_sheet_main SET walker_codes=json_array(?) WHERE row_index=2').bind(await code('丙')),
  ]);
  DB.prepare = sql => { sqls.push(sql); return prepare(sql); };
  worker.testing.resetState();
  body = (await getWalkers(env)).body;
  assert.deepEqual(body.walkers, { 9001: '乙', 9002: '丙' }, 'NULL 的照舊用代號換名字');
});
