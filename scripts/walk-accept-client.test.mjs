import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalkRegistration } from '../public/js/walk-registration.js';
const dog = { id: '9001', name: '測試狗' }, day = '2026-10-21';
function client(send, saved = {}) {
  let requests = saved;
  const registration = createWalkRegistration({ key: d => d.id, date: () => day, walker: () => '甲', alias: () => '', split: s => s.split('、').filter(Boolean), canonical: s => s,
    base: () => ({ date: '2026-10-01', walker: '舊' }), apply: () => {}, send,
    readRequests: () => requests, saveRequests: r => { requests = r; } });
  return { registration, requests: () => requests };
}
const accepted = payload => ({ ok: true, source: 'd1', today: day, results: [{ id: dog.id, name: dog.name, status: 'written', accepted: true, requestId: payload.requestId, operationDate: day, version: 1, current: { date: day, walker: '甲' }, syncStatus: 'pending', at: new Date().toISOString() }] });
test('D1 接受之前不變已溜；未知結果在重新建立手機介面後仍用同一請求重送', async () => {
  let payload;
  const first = client(async body => { payload = body; throw new Error('lost response'); });
  const result = await first.registration.register([dog]);
  assert.equal(first.registration.state(dog).today, false);
  assert.equal(result.rows[0].status, 'unknown');
  assert.ok(payload.requestId);
  const second = client(async body => { assert.deepEqual(body, payload); return accepted(body); }, first.requests());
  const next = await second.registration.register([dog]);
  assert.equal(next.successful.length, 1);
  assert.equal(second.registration.state(dog).today, true);
  assert.equal(second.registration.state(dog).syncStatus, 'pending');
  assert.deepEqual(second.requests(), {});
});

test('復原回應遺失後重開仍送原版本與原識別；舊登記待查時不把查回成功誤報成復原成功', async () => {
  let payload;
  const first = client(async body => { payload = body; throw new Error('lost'); });
  const row = { key:dog.id, version:1, walkedDate:day, walker:'乙', syncStatus:'pending' };
  first.registration.receiveToday({ source:'d1', version:1, date:day, walks:[row] },[dog]);
  await first.registration.undo([dog],{ revert:true });
  assert.equal(payload.action,'undo');
  const second = client(async body => {
    assert.deepEqual(body,payload);
    return { ...accepted(body), results:[{ ...accepted(body).results[0], status:'restored', version:2, current:{ date:'',walker:'' } }] };
  },first.requests());
  const restored = await second.registration.undo([dog],{ revert:true });
  assert.equal(restored.rows[0].status,'restored');
  assert.equal(second.registration.state(dog).date,'');
  const unresolved = { action:'walk', requestId:'unresolved-walk', operationDate:day, walker:'甲', dogs:[dog] };
  const third = client(async body => accepted(body),{ [dog.id]:unresolved });
  const out = await third.registration.undo([dog],{ revert:true });
  assert.equal(out.successful.length,0);
  assert.equal(out.rows[0].status,'changed');
  assert.deepEqual(out.retryDogs,[]);
  assert.deepEqual(third.requests(),{});
});

test('改名單傳操作者與觀測版本；衝突套用伺服器現況並停止重試', async () => {
  let payload;
  const { registration:r, requests } = client(async body => {
    payload = body;
    return { ok:false, source:'d1', error:'名單已改變', results:[{ ...dog, status:'changed', version:3, current:{ date:day, walker:'甲、乙、丙' } }],
      snapshot:{ source:'d1', date:day, version:7, walks:[{ key:dog.id, version:3, walkedDate:day, walker:'甲、乙、丙', syncStatus:'pending' }] } };
  });
  r.receiveToday({ source:'d1', version:1, date:day, walks:[{ key:dog.id, version:1, walkedDate:day, walker:'甲、乙', syncStatus:'pending' }] },[dog]);
  const out = await r.register([dog],{ walker:'乙', expected:'甲、乙' });
  assert.equal(payload.action,'edit');
  assert.equal(payload.editor,'甲');
  assert.equal(payload.dogs[0].expectedVersion,1);
  assert.equal(out.rows[0].status,'changed');
  assert.deepEqual(out.retryDogs,[]);
  assert.deepEqual(requests(),{});
  assert.equal(r.state(dog).walker,'甲、乙、丙');
});

test('尚未接管的狗也用衝突結果更新狀態，空資料包不使手機沿用舊名單', async () => {
  const { registration:r } = client(async () => ({ ok:false,source:'d1',results:[{ ...dog,status:'changed',version:0,current:{ date:'2026-10-02',walker:'乙' } }],
    snapshot:{ source:'d1',date:day,version:0,walks:[] } }));
  const out = await r.undo([dog],{ revert:true });
  assert.equal(out.rows[0].status,'changed');
  assert.equal(r.state(dog).date,'2026-10-02');
  assert.equal(r.state(dog).walker,'乙');
});

test('已接管狀態不被舊格式 today 覆蓋；較舊版本拒絕', async () => {
  const { registration:r } = client(async body => accepted(body));
  await r.register([dog]);
  const row = { key:dog.id, version:2, walkedDate:day, walker:'甲、乙', syncStatus:'retry', at:'2026-10-21T02:00:00Z' };
  r.receiveToday({ source:'d1', version:5, date:day, walks:[row] },[dog]);
  r.receiveToday({ source:'d1', version:4, date:day, walks:[{ ...row, walker:'甲', syncStatus:'synced' }] },[dog]);
  r.receiveToday({ date:day, walks:[{ ...row, walker:'舊消息' }] },[dog]);
  assert.equal(r.state(dog).walker,'甲、乙');
  assert.equal(r.state(dog).syncStatus,'retry');
  assert.equal(r.today([dog]).length,1);
});

test('跨裝置的單人 D1 紀錄可復原；送出版本並立即套用較早日期及同步中', async () => {
  let payload;
  const { registration:r } = client(async body => {
    payload = body;
    return { ...accepted(body), results:[{ ...accepted(body).results[0], status:'restored', version:2, current:{ date:'2026-10-01', walker:'舊' } }] };
  });
  r.receiveToday({ source:'d1', version:1, date:day, walks:[{ key:dog.id, version:1, walkedDate:day, walker:'乙', syncStatus:'pending' }] },[dog]);
  assert.equal(r.state(dog).canRevert,true);
  const out = await r.undo([dog],{ revert:true });
  assert.equal(payload.action,'undo');
  assert.equal(payload.dogs[0].expectedVersion,1);
  assert.equal(payload.walker,'甲');
  assert.equal(payload.dogs[0].prev,undefined);
  assert.equal(out.rows[0].status,'restored');
  assert.equal(r.state(dog).today,false);
  assert.equal(r.state(dog).date,'2026-10-01');
  assert.equal(r.state(dog).syncStatus,'pending');
  assert.equal(r.state(dog).canRevert,false);
});

const dog2 = { id: '9002', name: '第二隻' };
test('#460 整群在 D1 模式逐狗送出單狗請求，部分成功逐狗回報，重試沿用原識別', async () => {
  const sent = [];
  let fail = true;
  const { registration:r, requests } = client(async body => {
    sent.push(body);
    if (body.dogs[0].id === dog2.id && fail) throw new Error('lost');
    const out = accepted(body);
    out.results[0] = { ...out.results[0], id: body.dogs[0].id, name: body.dogs[0].name };
    return out;
  });
  const out = await r.register([dog, dog2]);
  assert.equal(sent.length, 2);
  assert.ok(sent.every(p => p.dogs.length === 1));
  assert.notEqual(sent[0].requestId, sent[1].requestId);
  assert.deepEqual(out.rows.map(x => x.status), ['written', 'unknown']);
  assert.deepEqual(out.successful, [dog]);
  assert.deepEqual(out.retryDogs, [dog2]);
  assert.equal(r.state(dog).today, true);
  assert.equal(r.state(dog2).today, false);
  assert.deepEqual(Object.keys(requests()), [dog2.id]);
  fail = false;
  const again = await r.retry(out);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].requestId, sent[1].requestId);
  assert.deepEqual(again.successful, [dog2]);
});

test('#460 整群復原在 D1 模式逐狗帶版本', async () => {
  const sent = [];
  const { registration:r } = client(async body => {
    sent.push(body);
    const out = accepted(body);
    out.results[0] = { ...out.results[0], id: body.dogs[0].id, name: body.dogs[0].name, status: 'restored', version: 2, current: { date: '2026-10-01', walker: '' } };
    return out;
  });
  r.receiveToday({ source:'d1', version:3, date:day, walks:[dog, dog2].map(d => ({ key:d.id, version:1, walkedDate:day, walker:'甲', syncStatus:'synced' })) },[dog, dog2]);
  const out = await r.undo([dog, dog2],{ revert:true });
  assert.deepEqual(sent.map(p => [p.action, p.dogs.length, p.dogs[0].expectedVersion]), [['undo',1,1],['undo',1,1]]);
  assert.equal(out.successful.length, 2);
  assert.equal(r.state(dog2).today, false);
});

test('#460 未接管的狗只看伺服器基準，不採舊格式今日回應', () => {
  const r = createWalkRegistration({ key: d => d.id, date: () => day, walker: () => '甲', alias: () => '', split: s => s.split('、').filter(Boolean), canonical: s => s,
    base: () => ({ date: '2026-10-01', walker: '舊' }), apply: () => {}, send: async () => ({}) });
  assert.equal(r.state(dog).today, false);
  assert.equal(r.state(dog).mine, false);
  assert.equal(r.state(dog).walker, '舊');
  assert.equal(r.canRevert(dog), false);
  r.receiveToday({ date: day, walks: [{ key: dog.id, walkedDate: day, walker: '舊消息', at: new Date(Date.now() + 99999).toISOString() }] }, [dog]);
  assert.equal(r.state(dog).walker, '舊');
  assert.equal(r.today([dog]).length, 0);
});

test('#498 D1 整群 11 隻：逐狗接受，斷線的只重試那幾隻且沿用原識別，已成功的不建新操作', async () => {
  const eleven = Array.from({ length: 11 }, (_, i) => ({ id: String(9100 + i), name: `狗${i}` }));
  const sent = [], lostOnce = new Set(['9103', '9107']);
  const reply = body => {
    const d = body.dogs[0];
    return { ok: true, source: 'd1', today: day, results: [{ ...d, status: 'written', accepted: true, requestId: body.requestId, operationDate: day, version: 1,
      current: { date: day, walker: '甲' }, syncStatus: 'pending', at: new Date().toISOString() }] };
  };
  const { registration: r } = client(async body => {
    sent.push({ id: body.dogs[0].id, requestId: body.requestId });
    assert.equal(body.dogs.length, 1);
    if (lostOnce.delete(body.dogs[0].id)) throw new Error('lost');
    return reply(body);
  });
  const result = await r.register(eleven);
  assert.equal(sent.length, 11);
  assert.equal(result.successful.length, 9);
  assert.deepEqual(result.retryDogs.map(d => d.id), ['9103', '9107']);
  assert.equal(r.state(eleven[3]).today, false); // 結果不明不顯示成功
  assert.equal(r.state(eleven[0]).today, true);
  const first = new Map(sent.map(s => [s.id, s.requestId]));
  const again = await r.retry(result);
  assert.deepEqual(sent.slice(11).map(s => s.id), ['9103', '9107']);
  assert.ok(sent.slice(11).every(s => s.requestId === first.get(s.id)));
  assert.equal(again.successful.length, 2);
  assert.ok(eleven.every(d => r.state(d).today));
});
