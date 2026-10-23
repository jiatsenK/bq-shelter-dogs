import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

function setup(walk, todayWalks, options = {}) {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-23T04:00:00Z'])); }
    static now() { return Date.parse('2026-10-23T04:00:00Z'); }
  }
  const context = vm.createContext({ console, setTimeout, clearTimeout, AbortController, structuredClone, crypto: webcrypto, Date: FixedDate });
  for (const file of ['dates', 'store', 'walk-registration', 'walk-flow']) {
    vm.runInContext(readFileSync(new URL(`../public/js/${file}.js`, import.meta.url), 'utf8'), context);
  }
  return vm.runInContext(`((walk, todayWalks, options) => {
    const store = BQStore.create(options.storage || null);
    const records = BQWalks.createRecords({ store: () => store, dates: BQDates, key: d => d.id });
    let writeState = 'unknown';
    const flow = BQWalks.create({ records: () => records, store: () => store, api: { walk, todayWalks, walkResult: options.walkResult }, dates: BQDates,
      get d1() { return options.d1; },
      enabled: () => true, getWriteState: () => writeState, setWriteState: s => { writeState = s; },
      key: d => d.id, date: () => '2026-10-23', walker: () => '我', alias: () => null,
      canonical: n => n, split: n => (n || '').split('、').filter(Boolean),
      base: () => ({ date: '', walker: '' }), apply: () => {},
    });
    return { flow, records, store, feedback: BQWalks.undoFeedback, writeState: () => writeState };
  })`, context)(walk, todayWalks, options);
}
const dog = { id: '1', name: '甲' };
const response = payload => ({ ok: true, status: 200, data: { ok: true, today: '2026-10-23',
  results: payload.dogs.map(d => ({ ...d, status: payload.action === 'undo' ? 'restored' : 'written',
    prev: { date: { text: '2026/10/22' }, walker: '前人' }, wrote: { walker: payload.walker } })) } });

test('登記後立即復原會等登記完成，送出原本日期與名字', async () => {
  const sent = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { flow } = setup(async payload => {
    sent.push(structuredClone(payload));
    if (payload.action === 'walk') await gate;
    return response(payload);
  });
  const writing = flow.register([dog]);
  const undoing = flow.undo([dog]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1);
  release();
  await writing;
  const result = await undoing;
  assert.equal(result.rows[0].status, 'restored');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[1])), { action: 'undo', walker: '我', dogs: [
    { ...dog, prev: { date: { text: '2026/10/22' }, walker: '前人' }, wrote: { walker: '我' } },
  ] });
});

test('今日紀錄核對後更新手機紀錄，讀取失敗維持既有狀態', async () => {
  let offline = false;
  const { flow } = setup(response, async () => {
    if (offline) throw new Error('離線');
    return { ok: true, data: { date: '2026-10-23', walks: [
      { key: '1', walkedDate: '2026-10-23', walker: '我', at: '2026-10-23T08:00:00Z' },
    ] } };
  });
  assert.equal(await flow.loadToday(() => [dog]), true);
  assert.equal(flow.state(dog).mine, true);
  offline = true;
  assert.equal(await flow.loadToday(() => [dog]), false);
  assert.equal(flow.state(dog).walker, '我');
});

test('斷線與找不到狗的失敗種類及提示沿用原本規則', async () => {
  const { flow } = setup(async () => ({ ok: false, status: 0, error: 'network', message: '網頁載入失敗' }));
  const failed = await flow.write([dog], true);
  assert.equal(failed.value, false);
  assert.equal(failed.failure, 'network');
  assert.equal(failed.message, '未全部登記成功；甲 尚未確認登記結果（網路不通）');
  const missing = setup(async () => ({ ok: true, status: 200, data: { ok: true, results: [{ ...dog, status: 'notFound' }] } }));
  const result = await missing.flow.write([dog], true);
  assert.equal(result.failure, 'missed');
  assert.equal(result.message, '未全部登記成功；試算表找不到 甲，請自己填');
});

test('舊模式先記手機，部分失敗只收回失敗的狗；停用寫入時保留手機備援', async () => {
  const other = { id: '2', name: '乙' };
  const { flow, records } = setup(async payload => ({ ok: true, status: 200, data: { ok: true,
    results: payload.dogs.map(d => ({ ...d, status: d.id === '1' ? 'written' : 'notFound', prev: {}, wrote: { walker: '我' } })) } }));
  const day = new Date(2026, 9, 23);
  const pending = flow.startWalk([dog, other]);
  assert.equal(JSON.stringify(records.loadWalkedIds(day)), '["2","1"]');
  const result = await pending;
  assert.equal(result.message, '已登記 1 隻；未全部登記成功；試算表找不到 乙，請自己填');
  assert.equal(JSON.stringify(records.loadWalkedIds(day)), '["1"]');
  const disabled = setup(async () => ({ ok: false, status: 503, data: { code: 'off' } }));
  const off = await disabled.flow.startWalk([dog]);
  assert.equal(off.off, true);
  assert.equal(JSON.stringify(disabled.records.loadWalkedIds(day)), '["1"]');
});

for (const [label, reply, status] of [
  ['HTTP 錯誤', { ok: false, status: 500, data: { error: '服務忙碌' } }, 'unknown'],
  ['非 JSON', { ok: false, status: 200, data: null, error: 'format', message: '格式不對' }, 'unknown'],
  ['紀錄被改過', { ok: true, status: 200, data: { ok: true, results: [{ ...dog, status: 'changed', current: { date: '2026-10-23', walker: '別人' } }] } }, 'changed'],
]) {
  test(label + '保留逐狗失敗種類及可重試對象', async () => {
    const { flow } = setup(async () => reply);
    const result = await flow.register([dog]);
    assert.equal(result.rows[0].status, status);
    assert.equal(result.retryDogs.length, status === 'unknown' ? 1 : 0);
    assert.equal(flow.canUndo(dog), false);
  });
}

test('手機舊格式仍能讀取，隔天不沿用；本機復原還原原本順序', () => {
  const { records, store } = setup(response);
  const day = new Date(2026, 9, 23);
  store.writeJson('bq-walked-today', { date: '2026-10-23', ids: ['old'] });
  const result = records.recordWalked([dog], true, day);
  assert.equal(JSON.stringify(records.loadWalkedIds(day)), '["1","old"]');
  result.undo();
  assert.equal(JSON.stringify(store.readJson('bq-walked-today')), '{"date":"2026-10-23","ids":["old"]}');
  assert.equal(records.loadWalkedIds(new Date(2026, 9, 24)).length, 0);
});

test('復原成功清除同行人；衝突提示與未知結果維持原文', async () => {
  const { flow, records, feedback } = setup(response);
  await flow.register([dog]);
  records.addWalkWith([dog], ['小明'], new Date(2026, 9, 23));
  const result = await flow.undo([dog]);
  assert.equal(records.loadWalkWith(new Date(2026, 9, 23))['1'], undefined);
  assert.equal(feedback(result).text, '已從試算表復原 1 隻');
  const failed = feedback({ successful: [], retryDogs: [dog], error: '斷線', rows: [{ dog, status: 'unknown' }] });
  assert.equal(failed.text, '甲 試算表沒改回來：斷線，尚未復原');
  const changed = feedback({ source: 'd1', successful: [], rows: [{ dog, status: 'changed' }] });
  assert.equal(changed.text, '甲 紀錄已經被改過，沒有蓋掉別人的紀錄');
});

test('今日回應回來時使用最新狗清單，舊名單不能覆蓋較新的寫入', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const { flow } = setup(response, async () => { await waiting; return { ok: true, data: { date: '2026-10-23', walks: [
    { key: '1', walkedDate: '2026-10-23', walker: '別人', at: '2026-10-23T03:00:00Z' },
  ] } }; });
  let dogs = [];
  const reading = flow.loadToday(() => dogs);
  dogs = [dog];
  await flow.register([dog]);
  release();
  await reading;
  assert.equal(flow.state(dog).walker, '我');
});

function storage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
}

test('D1 未接受前不記已溜；回應不明時重建流程仍沿用手機內的原識別', async () => {
  const phone = storage(), payloads = [];
  const api = async payload => { payloads.push(structuredClone(payload)); return { ok: false, status: 0, error: 'network' }; };
  const options = { storage: phone, d1: true };
  const first = setup(api, null, options);
  const unknown = await first.flow.startWalk([dog]);
  assert.equal(unknown.rows[0].status, 'unknown');
  assert.equal(first.flow.state(dog).mine, false);
  assert.equal(first.records.loadWalkedIds(new Date(2026, 9, 23)).length, 0);
  const second = setup(async payload => {
    payloads.push(structuredClone(payload));
    return { ok: true, status: 200, data: { ok: true, source: 'd1', results: [{ ...dog, accepted: true,
      status: 'written', requestId: payload.requestId, operationDate: payload.operationDate,
      version: 2, current: { date: '2026-10-23', walker: '我' } }] } };
  }, null, options);
  const accepted = await second.flow.startWalk([dog]);
  assert.equal(accepted.rows[0].status, 'written');
  assert.equal(payloads[1].requestId, payloads[0].requestId);
  assert.equal(second.flow.state(dog).mine, true);
});

test('D1 識別存不進持久儲存時不送出，沿用原本提示', async () => {
  let sent = false;
  const { flow } = setup(async () => { sent = true; return response({ dogs: [dog] }); }, null, { d1: true });
  const result = await flow.startWalk([dog]);
  assert.equal(sent, false);
  assert.equal(result.rows[0].status, 'notSent');
  assert.equal(result.error, '無法保留登記識別，尚未送出');
});
