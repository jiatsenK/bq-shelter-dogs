import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadFrontendModule } from './frontend-module-test-helper.mjs';
import { webcrypto } from 'node:crypto';

function storage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
}
// options.storage：手機儲存空間；給 null 時登記識別存不進去
async function setup(walk, todayWalks, options = {}) {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-23T04:00:00Z'])); }
    static now() { return Date.parse('2026-10-23T04:00:00Z'); }
  }
  const context = vm.createContext({ console, setTimeout, clearTimeout, AbortController, structuredClone, crypto: webcrypto, Date: FixedDate });
  context.BQWalks = (await loadFrontendModule('walk-flow.js', context)).BQWalks;
  context.BQStore = (await loadFrontendModule('store.js', context)).BQStore;
  context.BQDates = (await loadFrontendModule('dates.js', context)).BQDates;
  const phone = Object.hasOwn(options, 'storage') ? options.storage : storage();
  return vm.runInContext(`((walk, todayWalks, options, phone) => {
    const store = BQStore.create(phone);
    const records = BQWalks.createRecords({ store: () => store, dates: BQDates, key: d => d.id });
    let writeState = 'unknown';
    const flow = BQWalks.create({ records: () => records, store: () => store, api: { walk, todayWalks, walkResult: options.walkResult }, dates: BQDates,
      enabled: () => true, getWriteState: () => writeState, setWriteState: s => { writeState = s; },
      key: d => d.id, date: () => '2026-10-23', walker: () => '我', alias: () => null,
      canonical: n => n, split: n => (n || '').split('、').filter(Boolean),
      base: () => ({ date: '', walker: '' }), apply: () => {},
    });
    return { flow, records, store, feedback: BQWalks.undoFeedback, writeState: () => writeState };
  })`, context)(walk, todayWalks, options, phone);
}
const dog = { id: '1', name: '甲' };
let version = 0;
// D1 接受：登記回 written、復原回 restored，每次版本加一
const accepted = payload => {
  version++;
  const undo = payload.action === 'undo';
  return { ok: true, status: 200, data: { ok: true, source: 'd1', results: payload.dogs.map(d => ({ ...d, accepted: true,
    status: undo ? 'restored' : 'written', requestId: payload.requestId, operationDate: payload.operationDate, version,
    current: undo ? { date: '2026-10-22', walker: '前人' } : { date: '2026-10-23', walker: payload.walker } })) } };
};

test('登記後立即復原會等登記完成才送出', async () => {
  const sent = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { flow } = await setup(async payload => {
    sent.push(structuredClone(payload));
    if (payload.action === 'walk') await gate;
    return accepted(payload);
  });
  const writing = flow.register([dog]);
  const undoing = flow.undo([dog]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1);
  release();
  const walked = await writing;
  const result = await undoing;
  assert.equal(walked.rows[0].status, 'written');
  assert.equal(result.rows[0].status, 'restored');
  assert.equal(sent[1].action, 'undo');
  assert.equal(flow.state(dog).walker, '前人');
});

test('今日紀錄核對後更新手機紀錄，讀取失敗或不是 D1 回應時維持既有狀態', async () => {
  let offline = false, legacy = false;
  const { flow } = await setup(accepted, async () => {
    if (offline) throw new Error('離線');
    if (legacy) return { ok: true, data: { date: '2026-10-23', walks: [{ key: '1', walkedDate: '2026-10-23', walker: '別人' }] } };
    return { ok: true, data: { source: 'd1', date: '2026-10-23', version: 1, walks: [
      { key: '1', version: 1, walkedDate: '2026-10-23', walker: '我' },
    ] } };
  });
  assert.equal(await flow.loadToday(() => [dog]), true);
  assert.equal(flow.state(dog).mine, true);
  offline = true;
  assert.equal(await flow.loadToday(() => [dog]), false);
  offline = false; legacy = true;
  assert.equal(await flow.loadToday(() => [dog]), false);
  assert.equal(flow.state(dog).walker, '我');
});

for (const [label, reply, status] of [
  ['斷線', { ok: false, status: 0, error: 'network', message: '網頁載入失敗' }, 'unknown'],
  ['HTTP 錯誤', { ok: false, status: 500, data: { error: '服務忙碌' } }, 'unknown'],
  ['非 JSON', { ok: false, status: 200, data: null, error: 'format', message: '格式不對' }, 'unknown'],
  ['紀錄被改過', { ok: false, status: 409, data: { ok: false, source: 'd1', results: [{ ...dog, status: 'changed', version: 7,
    current: { date: '2026-10-23', walker: '別人' } }] } }, 'changed'],
]) {
  test(label + '保留逐狗失敗種類及可重試對象', async () => {
    const { flow } = await setup(async () => reply);
    const result = await flow.startWalk([dog]);
    assert.equal(result.rows[0].status, status);
    assert.equal(result.retryDogs.length, status === 'unknown' ? 1 : 0);
    assert.equal(JSON.stringify(result.failed.map(d => d.id)), '["1"]');
    assert.match(result.message, status === 'unknown' ? /^未全部登記成功；甲 尚未確認登記結果/ : /^未全部登記成功；甲 紀錄已經被改過，沒有蓋掉別人的紀錄$/);
    if (status === 'changed') assert.equal(flow.state(dog).walker, '別人');
  });
}

test('復原成功清除同行人；衝突提示與未知結果維持原文', async () => {
  const { flow, records, feedback } = await setup(accepted);
  await flow.register([dog]);
  records.addWalkWith([dog], ['小明'], new Date(2026, 9, 23));
  const result = await flow.undo([dog]);
  assert.equal(records.loadWalkWith(new Date(2026, 9, 23))['1'], undefined);
  assert.deepEqual({ ...feedback(result) }, { text: '已復原 1 隻', show: false });
  const failed = feedback({ successful: [], retryDogs: [dog], error: '斷線', rows: [{ dog, status: 'unknown' }] });
  assert.deepEqual({ ...failed }, { text: '甲 尚未確認：斷線，尚未復原', show: true });
  const changed = feedback({ successful: [], rows: [{ dog, status: 'changed' }] });
  assert.equal(changed.text, '甲 紀錄已經被改過，沒有蓋掉別人的紀錄');
});

test('今日回應回來時使用最新狗清單，較舊版本不能覆蓋較新的登記', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const { flow } = await setup(accepted, async () => { await waiting; return { ok: true, data: { source: 'd1', date: '2026-10-23', version: 1, walks: [
    { key: '1', version: 0, walkedDate: '2026-10-23', walker: '別人' },
  ] } }; });
  let dogs = [];
  const reading = flow.loadToday(() => dogs);
  dogs = [dog];
  await flow.register([dog]);
  release();
  await reading;
  assert.equal(flow.state(dog).walker, '我');
});

test('D1 未接受前不記已溜；回應不明時重建流程仍沿用手機內的原識別', async () => {
  const phone = storage(), payloads = [];
  const api = async payload => { payloads.push(structuredClone(payload)); return { ok: false, status: 0, error: 'network' }; };
  const options = { storage: phone };
  const first = await setup(api, null, options);
  const unknown = await first.flow.startWalk([dog]);
  assert.equal(unknown.rows[0].status, 'unknown');
  assert.equal(first.flow.state(dog).mine, false);
  const second = await setup(async payload => {
    payloads.push(structuredClone(payload));
    return { ok: true, status: 200, data: { ok: true, source: 'd1', results: [{ ...dog, accepted: true,
      status: 'written', requestId: payload.requestId, operationDate: payload.operationDate,
      version: 2, current: { date: '2026-10-23', walker: '我' } }] } };
  }, null, options);
  const result = await second.flow.startWalk([dog]);
  assert.equal(result.rows[0].status, 'written');
  assert.equal(payloads[1].requestId, payloads[0].requestId);
  assert.equal(second.flow.state(dog).mine, true);
});

test('D1 識別存不進持久儲存時不送出，沿用原本提示', async () => {
  let sent = false;
  const { flow } = await setup(async payload => { sent = true; return accepted(payload); }, null, { storage: null });
  const result = await flow.startWalk([dog]);
  assert.equal(sent, false);
  assert.equal(result.rows[0].status, 'notSent');
  assert.equal(result.error, '無法保留登記識別，尚未送出');
});
