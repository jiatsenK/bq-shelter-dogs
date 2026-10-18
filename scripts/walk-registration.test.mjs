import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWalkRegistration } = require('../public/js/walk-registration.js');

function setup(send) {
  let records = {};
  const walks = createWalkRegistration({
    key: d => d.id, date: () => '2026-10-18', walker: () => '我', alias: () => null,
    canonical: n => n, split: n => (n || '').split('、').filter(Boolean),
    read: () => records, save: v => { records = v; }, apply: () => {}, send,
  });
  return { walks, records: () => records };
}
const dogs = [{ id: '1', name: '甲' }, { id: '2', name: '乙' }];

test('共用登記介面逐狗回報成功與失敗，不以整批回應猜測', async () => {
  const { walks } = setup(async () => ({ ok: true, today: '2026-10-18', results: [
    { ...dogs[0], status: 'written', prev: { walker: '' }, wrote: { walker: '我', date: '2026-10-18' } },
    { ...dogs[1], status: 'notFound' },
  ] }));
  const result = await walks.register(dogs);
  assert.deepEqual(result.successful.map(d => d.id), ['1']);
  assert.deepEqual(result.rows.map(r => r.status), ['written', 'notFound']);
  assert.equal(walks.canUndo(dogs[0]), true);
  assert.equal(walks.canUndo(dogs[1]), false);
});

test('重試保留送出時的狗與同行人，只送未成功者；缺漏回應是結果不明', async () => {
  const calls = [];
  const { walks } = setup(async payload => {
    calls.push(structuredClone(payload));
    return { ok: true, results: payload.dogs.filter(d => calls.length > 1 || d.id === '1').map(d => ({ ...d, status: 'written', prev: {}, wrote: { walker: payload.walker } })) };
  });
  const input = structuredClone(dogs);
  const result = await walks.register(input, { walker: '我、小明' });
  input[1].name = '改名後';
  assert.equal(result.rows[1].status, 'unknown');
  await walks.retry(result);
  assert.deepEqual(calls[1], { action: 'walk', walker: '我、小明', dogs: [{ id: '2', name: '乙' }] });
});

test('登記與同行人追加依序送出，復原只承認 restored，衝突不能再復原', async () => {
  const calls = [];
  const { walks } = setup(async payload => {
    calls.push(payload.action);
    await new Promise(resolve => setTimeout(resolve, 5));
    return { ok: true, results: payload.dogs.map((d, i) => ({ ...d,
      status: payload.action === 'undo' ? (i ? 'changed' : 'restored') : 'written',
      prev: { date: { text: '2026/10/17' }, walker: '前人' },
      wrote: { date: '2026-10-18', walker: payload.walker }, current: { date: '2026-10-18', walker: '別人' },
    })) };
  });
  const first = walks.register(dogs);
  const second = walks.register(dogs, { walker: '小明' });
  assert.equal(walks.pending(dogs[0]), true);
  await Promise.all([first, second]);
  const result = await walks.undo(dogs);
  assert.deepEqual(calls, ['walk', 'walk', 'undo']);
  assert.deepEqual(result.successful.map(d => d.id), ['1']);
  assert.deepEqual(result.rows.map(r => r.status), ['restored', 'changed']);
  assert.equal(walks.canUndo(dogs[1]), false);
  assert.equal(walks.pending(dogs[0]), false);
});

test('復原衝突即使沒有帶目前內容，也必須失去復原資格', async () => {
  const { walks } = setup(async payload => ({ ok: true, results: payload.dogs.map(d => ({ ...d,
    status: payload.action === 'undo' ? 'changed' : 'written', prev: {}, wrote: { walker: '我' },
  })) }));
  await walks.register([dogs[0]]);
  await walks.undo([dogs[0]]);
  assert.equal(walks.canUndo(dogs[0]), false);
});

test('整批網路失敗可保留原同行人重試；不明結果不能算成功', async () => {
  let fail = true;
  const payloads = [];
  const { walks } = setup(async payload => {
    payloads.push(payload);
    if (fail) throw new Error('斷線');
    return { ok: true, results: payload.dogs.map(d => ({ ...d, status: 'already', current: { walker: payload.walker } })) };
  });
  const result = await walks.register(dogs, { walker: '我、阿華' });
  assert.equal(result.successful.length, 0);
  assert.deepEqual(result.rows.map(r => r.status), ['unknown', 'unknown']);
  fail = false;
  const retried = await walks.retry(result);
  assert.deepEqual(payloads[1], payloads[0]);
  assert.equal(retried.successful.length, 2);
  assert.equal(walks.canUndo(dogs[0]), false, 'already 不能憑空產生復原快照');
});

test('佇列最多一筆寫入，且同一志工不同別名分組送出', async () => {
  let active = 0, maximum = 0;
  const names = [];
  let records = {};
  const walks = createWalkRegistration({
    key: d => d.id, date: () => '2026-10-18', walker: () => '我', alias: d => d.id === '1' ? '舊名' : null,
    canonical: n => n, split: n => (n || '').split('、'), read: () => records, save: v => { records = v; }, apply: () => {},
    send: async payload => {
      maximum = Math.max(maximum, ++active); names.push(payload.walker);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return { ok: true, results: payload.dogs.map(d => ({ ...d, status: 'already', current: { walker: payload.walker } })) };
    },
  });
  await Promise.all([walks.register(dogs), walks.register([dogs[0]], { walker: '小明' })]);
  assert.equal(maximum, 1);
  assert.deepEqual(names, ['舊名', '我', '小明']);
});

test('復原重試固定第一次送出的快照，不取消後來追加的同行人', async () => {
  const undoPayloads = [];
  const { walks } = setup(async payload => {
    if (payload.action === 'undo') {
      undoPayloads.push(payload);
      return { ok: false };
    }
    return { ok: true, results: payload.dogs.map(d => ({ ...d, status: 'written', prev: { walker: '' }, wrote: { walker: payload.walker } })) };
  });
  await walks.register([dogs[0]]);
  const failedUndo = await walks.undo([dogs[0]]);
  await walks.register([dogs[0]], { walker: '我、小明' });
  await walks.retry(failedUndo);
  assert.deepEqual(undoPayloads[1], undoPayloads[0]);
});

test('結果不明不套用舊資料，也不通知畫面這次有新寫入', async () => {
  let records = {}, applies = 0, fail = false;
  const walks = createWalkRegistration({
    key: d => d.id, date: () => '2026-10-18', walker: () => '我', alias: () => null, canonical: n => n, split: n => (n || '').split('、'),
    read: () => records, save: v => { records = v; }, apply: list => { applies += list.length; },
    send: async payload => fail ? { ok: false } : { ok: true, results: payload.dogs.map(d => ({ ...d, status: 'written', prev: {}, wrote: { walker: '我' } })) },
  });
  await walks.register([dogs[0]]);
  fail = true;
  await walks.register([dogs[0]], { walker: '小明' });
  assert.equal(applies, 1);
});

test('回應缺少登記內容或同狗重複回應時，不能宣稱成功', async () => {
  const { walks } = setup(async () => ({ ok: true, results: [
    { ...dogs[0], status: 'written' },
    { ...dogs[1], status: 'already', current: { walker: '我' } },
    { ...dogs[1], status: 'notFound' },
  ] }));
  const result = await walks.register(dogs);
  assert.deepEqual(result.rows.map(r => r.status), ['unknown', 'unknown']);
  assert.equal(result.successful.length, 0);
});
