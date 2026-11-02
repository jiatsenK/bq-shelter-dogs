// #809 異常通知：跑真的 Worker 排程與 D1，Telegram 換成假的，只看送出去的訊息
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { alertMessage, runAlerts } from '../src/sync-alerts.js';
import { syncDogList } from '../src/dog-list.js';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';

const NOW = Date.parse('2026-11-02T05:23:00.000Z');
const SCAN_CRON = '23 1,5,15 * * *';

async function start(t, { sendOk = true, env: extra = { TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '42' } } = {}) {
  const DB = fakeD1();
  t.after(() => DB.close());
  await createCompactDatabase(DB);
  const sent = [];
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  const box = { ok: sendOk };
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response('{}', { status: box.ok ? 200 : 500 });
  };
  const env = { DB, ...extra };
  const scan = async (at = NOW) => {
    const tasks = [];
    await worker.scheduled({ scheduledTime: at, cron: SCAN_CRON }, env, { waitUntil: p => tasks.push(p) });
    await Promise.all(tasks);
  };
  const dog = async (id, name, number) => {
    await DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(id, name).run();
    if (number) await DB.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(number, id).run();
  };
  let row = 0;
  const onMain = (id, name, number = '') => DB.prepare('INSERT INTO v3_sheet_main(row_index,dog_id,number,name) VALUES(?,?,?,?)').bind(row++, id, number, name).run();
  return { DB, env, sent, box, scan, dog, onMain };
}
const texts = sent => sent.map(s => s.body.text).join('\n');

test('#809 沒設 Telegram 不跑、不送，排程紀錄也不記', async t => {
  const { DB, sent, scan, dog } = await start(t, { env: {} });
  await dog('a', '小白', '9001');
  await scan();
  assert.deepEqual(sent, []);
  assert.equal(await DB.prepare("SELECT value FROM v3_sync_state WHERE key='cron_alert'").first('value'), null);
});

test('#809 一切正常不送', async t => {
  const { sent, scan, dog, onMain } = await start(t);
  await dog('a', '小白', '9001');
  await onMain('a', '小白', '9001');
  await scan();
  assert.deepEqual(sent, []);
});

test('#809 主清單同名、同一隻兩列、待核對都送到設定的對象', async t => {
  const { sent, scan, dog, onMain } = await start(t);
  await dog('a', '小白', '9001');
  await dog('b', '小白', '9002');
  await onMain('a', '小白', '9001');
  await onMain('b', '小白', '9002');
  await dog('c', '小黑', '9003');
  await onMain('c', '小黑', '9003');
  await onMain('c', '小黑二', '');
  await dog('d', '阿福', '9004');
  await scan();
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/bottok\/sendMessage$/);
  assert.equal(sent[0].body.chat_id, '42');
  const text = texts(sent);
  assert.match(text, /主清單有 2 隻同名：小白/);
  assert.match(text, /同一隻狗在主清單有 2 列：小黑/);
  assert.match(text, /待核對：阿福（9004）/);
});

test('#809 同一個問題只通知一次；解決後再發生會再通知；有新問題只送新的', async t => {
  const { DB, sent, scan, dog } = await start(t);
  await dog('d', '阿福', '9004');
  await scan();
  await scan();
  assert.equal(sent.length, 1, '沒變不再送');
  await dog('e', '路路', '9005');
  await scan();
  assert.equal(sent.length, 2);
  assert.match(sent[1].body.text, /路路/);
  assert.doesNotMatch(sent[1].body.text, /阿福/, '通知過的不重複');
  await DB.prepare("INSERT INTO v3_dog_departures(dog_id,number,name) VALUES('d','9004','阿福')").run();
  await scan();
  assert.equal(sent.length, 2, '解決了不送');
  await DB.prepare("DELETE FROM v3_dog_departures WHERE dog_id='d'").run();
  await scan();
  assert.equal(sent.length, 3, '再發生會再通知');
  assert.match(sent[2].body.text, /阿福/);
});

test('#809 沒有變化不寫 D1', async t => {
  const { DB, scan, dog } = await start(t);
  await dog('d', '阿福', '9004');
  await scan();
  assert.equal(await DB.prepare("SELECT value FROM v3_sync_state WHERE key='alert_seen'").first('value'), '["pending:d"]');
  const changes = async () => (await DB.prepare('SELECT total_changes() n').first()).n;
  const start0 = await changes();
  await runAlerts({ DB, TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '42' }, NOW);
  assert.equal(await changes(), start0);
});

test('#809 送不出去：記在排程紀錄，下次掃描再送，錯誤訊息不帶 token', async t => {
  const { DB, sent, box, scan, dog } = await start(t, { sendOk: false });
  await dog('d', '阿福', '9004');
  await scan();
  const record = JSON.parse(await DB.prepare("SELECT value FROM v3_sync_state WHERE key='cron_alert'").first('value'));
  assert.match(record.error, /Telegram 回 500/);
  assert.doesNotMatch(record.error, /tok/);
  box.ok = true;
  await scan(NOW + 3600000);
  assert.equal(sent.length, 2, '上次沒送成，這次再送');
  await scan(NOW + 7200000);
  assert.equal(sent.length, 2);
});

test('#809 排程有問題要通知：出錯、過期；從沒跑過不算', async t => {
  const { DB, sent, scan } = await start(t);
  const put = (job, value) => DB.prepare('INSERT INTO v3_sync_state(key,value) VALUES(?,?)').bind(`cron_${job}`, JSON.stringify(value)).run();
  await put('retry', { okAt: new Date(NOW - 5 * 60000).toISOString(), failAt: new Date(NOW - 60000).toISOString(), error: 'D1 壞了' });
  await put('editlog', { okAt: new Date(NOW - 5 * 86400000).toISOString() });
  await scan();
  const text = texts(sent);
  assert.match(text, /排程有問題：寫回重試（D1 壞了）/);
  assert.match(text, /排程有問題：修改紀錄清理/);
  assert.doesNotMatch(text, /照片垃圾桶/);
});

test('#809 狗清單同步連續失敗 3 次才通知，成功一次就重算', async t => {
  const { DB, env, sent, scan } = await start(t);
  // 真的同步，D1 失敗：查編號那句丟錯
  const realPrepare = DB.prepare.bind(DB);
  let broken = true;
  DB.prepare = sql => {
    if (broken && /FROM v3_dog_numbers n JOIN v3_dog_edit_state/.test(sql)) throw new Error('D1 壞了');
    return realPrepare(sql);
  };
  const row = { sheet: 'main', hash: 'h1', dog: { id: '9001', name: '新狗' }, cage: 'A01', note: '', date: '', walker: '' };
  const fail = () => DB.prepare("SELECT value FROM v3_sync_state WHERE key='dog_list_fail'").first('value');
  await syncDogList(DB, [row], null, env, NOW);
  await syncDogList(DB, [row], null, env, NOW);
  assert.equal(JSON.parse(await fail()).count, 2);
  await scan();
  assert.deepEqual(sent, [], '兩次還不通知');
  await syncDogList(DB, [row], null, env, NOW);
  await scan();
  assert.match(texts(sent), /狗清單同步連續失敗 3 次/);
  broken = false;
  await syncDogList(DB, [row], null, env, NOW);
  assert.equal(await fail(), null, '成功就清掉');
});

test('#809 第二隻自動合併等下一次，不算同步失敗', async t => {
  const { DB, env, dog, onMain } = await start(t);
  await dog('g1', '舊一', '8001');
  await dog('g2', '舊二', '8002');
  await DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage) VALUES(100,'g1','8001','舊一','A01'),(101,'g2','8002','舊二','A02')").run();
  // 其他狗都在表上，才不會被當成讀錯表
  const stay = ['8003', '8004', '8005', '8006'];
  for (const n of stay) { await dog(`k${n}`, `留${n}`, n); await onMain(`k${n}`, `留${n}`, n); }
  const row = (id, name, cage) => ({ sheet: 'main', hash: id, dog: { id, name }, cage, note: '', date: '', walker: '' });
  const { results } = await syncDogList(DB, [row('9001', '新一', 'A01'), row('9002', '新二', 'A02')], ['main:9001', 'main:9002', ...stay.map(n => `main:${n}`)], env, NOW);
  assert.equal(results[1].ok, false, '第二隻等下一次');
  assert.equal(await DB.prepare("SELECT value FROM v3_sync_state WHERE key='dog_list_fail'").first('value'), null);
});

test('#809 訊息太長截斷，列出還有幾項', () => {
  const issues = Array.from({ length: 300 }, (_, i) => ({ key: String(i), text: `待核對：一隻名字有點長的狗狗編號第 ${i} 隻` }));
  const text = alertMessage(issues);
  assert.ok(text.length < 4096);
  assert.match(text, /還有 \d+ 項沒列出/);
});
