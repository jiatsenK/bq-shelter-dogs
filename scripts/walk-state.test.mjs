import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createWalkRegistration } = createRequire(import.meta.url)('../public/js/walk-registration.js');

function setup(send) {
  let records = {}, ids = [], day = '2026-10-19', storedDay = day, time = Date.parse('2026-10-19T02:00:00Z'), since = 0;
  const dog = { id: '1', name: '甲', date: '2026-10-01', walker: '隊' };
  const walks = createWalkRegistration({
    key: d => d.id, date: () => day, walker: () => '我', alias: () => null,
    canonical: n => n, split: n => String(n || '').split('、').filter(Boolean),
    read: requested => requested === storedDay ? records : {}, save: (v, savedDay) => { records = v; storedDay = savedDay; }, apply: () => {},
    local: requested => requested === storedDay ? ids : [], saveLocal: v => { ids = v; }, base: d => ({ date: d.date, walker: d.walker }),
    now: () => time, syncedAt: () => since,
    send: send || (async p => ({ ok: true, today: day, results: p.dogs.map(d => ({ ...d, status: 'written', prev: { date: { date: '2026-10-01' }, walker: '隊' }, wrote: { date: day, walker: p.walker } })) })),
  });
  return { walks, dog, records: () => records, seed: v => { records = v; }, day: v => { day = v; }, time: v => { time = v; }, sync: v => { since = v; } };
}

test('復原同時核對日期與名字，不能覆蓋同名但日期已被修改的紀錄', () => {
  const s = setup();
  s.seed({ '1': { prev: {}, wrote: { date: '2026-10-19', walker: '我' }, current: { date: '2026-10-18', walker: '我' } } });
  assert.equal(s.walks.canUndo(s.dog), false);
});

test('另一支手機讀到自己今天已登記，不需要本機名單，也不取得復原資格', () => {
  const { walks, dog } = setup();
  dog.date = '2026-10-19'; dog.walker = '我、同行人';
  assert.deepEqual(walks.state(dog), {
    date: '2026-10-19', walker: '我、同行人', walkers: ['我', '同行人'], today: true, mine: true, canUndo: false, canRevert: false,
  });
});

test('輪詢先送出、登記成功後才回來，不能蓋掉自己與同行人的名單', async () => {
  const { walks, dog } = setup();
  const read = walks.beginRead();
  await walks.register([dog], { walker: '我、同行人' });
  walks.receiveToday({ date: '2026-10-19', walks: [{ key: '1', walkedDate: '2026-10-19', walker: '別人', at: '2026-10-19T02:00:01Z' }] }, [dog], read);
  assert.deepEqual(walks.state(dog).walkers, ['我', '同行人']);
  assert.equal(walks.canUndo(dog), true);
});

test('新同步正本取代已套入的今日紀錄與本機名單，不繼續顯示自己已登記', () => {
  const s = setup();
  s.walks.receiveToday({ date: '2026-10-19', walks: [{ key: '1', walkedDate: '2026-10-19', walker: '我', at: '2026-10-19T02:00:00Z' }] }, [s.dog]);
  assert.equal(s.walks.state(s.dog).mine, true);
  s.sync(Date.parse('2026-10-19T02:01:00Z'));
  assert.deepEqual(s.walks.state(s.dog), { date: '2026-10-01', walker: '隊', walkers: ['隊'], today: false, mine: false, canUndo: false, canRevert: false });
});

test('同步後日期與名單仍符合本機寫入，保留復原資格；改過日期或名單就停止', async () => {
  const s = setup();
  await s.walks.register([s.dog]);
  s.dog.date = '2026-10-19'; s.dog.walker = '我'; s.sync(Date.parse('2026-10-19T02:01:00Z'));
  assert.equal(s.walks.state(s.dog).canUndo, true);
  s.dog.walker = '我、別人';
  assert.equal(s.walks.state(s.dog).canUndo, false);
});

test('重新讀取名單確認自己已被移除，清除本機登記與復原資格', async () => {
  const { walks, dog } = setup();
  await walks.register([dog]);
  walks.receiveNames({ '1': '別人' }, [dog], walks.beginRead());
  assert.equal(walks.state(dog).mine, false);
  assert.equal(walks.canUndo(dog), false);
});

test('別人後來追加名字的今日紀錄先回來，較早的登記回應不能把對方拿掉', async () => {
  let finish, sent;
  const started = new Promise(resolve => { sent = resolve; });
  const s = setup(p => { sent(); return new Promise(resolve => { finish = () => resolve({ ok: true, today: '2026-10-19', results: [{ ...p.dogs[0], status: 'written', prev: {}, wrote: { date: '2026-10-19', walker: '我' } }] }); }); });
  const pending = s.walks.register([s.dog]);
  await started;
  s.walks.receiveToday({ date: '2026-10-19', walks: [{ key: '1', walkedDate: '2026-10-19', walker: '我、別人', at: '2026-10-19T02:00:01Z' }] }, [s.dog]);
  finish(); await pending;
  assert.deepEqual(s.walks.state(s.dog).walkers, ['我', '別人']);
  assert.equal(s.walks.canUndo(s.dog), false);
});

test('兩次輪詢逆序回來或拿到更舊的列，都不能把較新名字倒退', () => {
  const { walks, dog } = setup();
  const older = walks.beginRead(), newer = walks.beginRead();
  const payload = (walker, at) => ({ date: '2026-10-19', walks: [{ key: '1', walkedDate: '2026-10-19', walker, at }] });
  walks.receiveToday(payload('我、同行人', '2026-10-19T02:00:02Z'), [dog], newer);
  walks.receiveToday(payload('別人', '2026-10-19T02:00:00Z'), [dog], older);
  walks.receiveToday(payload('別人', '2026-10-19T02:00:01Z'), [dog]);
  assert.deepEqual(walks.state(dog).walkers, ['我', '同行人']);
});

test('今日紀錄先到再登記，與登記先到再拿同一今日紀錄，結果一致', async () => {
  const a = setup(), b = setup();
  const payload = { date: '2026-10-19', walks: [{ key: '1', walkedDate: '2026-10-19', walker: '我', at: '2026-10-19T02:00:00Z' }] };
  a.walks.receiveToday(payload, [a.dog]); await a.walks.register([a.dog]);
  await b.walks.register([b.dog]); b.walks.receiveToday(payload, [b.dog]);
  assert.deepEqual(a.walks.state(a.dog), b.walks.state(b.dog));
});

test('名字被別人追加後，即使之後回到原名單也不恢復舊復原證據', async () => {
  const { walks, dog } = setup();
  await walks.register([dog]);
  walks.receiveToday({ date: '2026-10-19', walks: [{ key: '1', walkedDate: '2026-10-19', walker: '我、別人', at: '2026-10-19T02:00:01Z' }] }, [dog]);
  walks.receiveToday({ date: '2026-10-19', walks: [{ key: '1', walkedDate: '2026-10-19', walker: '我', at: '2026-10-19T02:00:02Z' }] }, [dog]);
  assert.equal(walks.state(dog).mine, true);
  assert.equal(walks.canUndo(dog), false);
});

test('跨日回來的輪詢與寫入回應，不把昨天的登記存成今天', async () => {
  let finish, sent;
  const started = new Promise(resolve => { sent = resolve; });
  const s = setup(p => { sent(); return new Promise(resolve => { finish = () => resolve({ ok: true, today: '2026-10-19', results: [{ ...p.dogs[0], status: 'written', prev: {}, wrote: { date: '2026-10-19', walker: '我' } }] }); }); });
  const read = s.walks.beginRead(), pending = s.walks.register([s.dog]);
  await started; s.day('2026-10-20');
  s.walks.receiveToday({ date: '2026-10-19', walks: [{ key: '1', walkedDate: '2026-10-19', walker: '我', at: '2026-10-19T02:00:00Z' }] }, [s.dog], read);
  finish(); await pending;
  assert.equal(s.walks.state(s.dog).mine, false);
  assert.deepEqual(s.records(), {});
});

test('部分成功只改成功的狗，缺漏結果不取得本機登記或復原證據', async () => {
  const s = setup(async p => ({ ok: true, today: '2026-10-19', results: [{ ...p.dogs[0], status: 'written', prev: {}, wrote: { date: '2026-10-19', walker: '我、同行人' } }] }));
  const other = { id: '2', name: '乙', date: '2026-10-01', walker: '' };
  const result = await s.walks.register([s.dog, other], { walker: '我、同行人' });
  assert.deepEqual(result.rows.map(r => r.status), ['written', 'unknown']);
  assert.equal(s.walks.state(s.dog).mine, true);
  assert.deepEqual([s.walks.state(other).mine, s.walks.canUndo(other)], [false, false]);
});

test('新同步之後重新讀名字，不能讓被淘汰的今日日期重新生效', async () => {
  const s = setup();
  await s.walks.register([s.dog]);
  s.sync(Date.parse('2026-10-19T02:01:00Z')); s.time(Date.parse('2026-10-19T02:02:00Z'));
  s.walks.receiveNames({ '1': '別人' }, [s.dog]);
  assert.deepEqual([s.walks.state(s.dog).date, s.walks.state(s.dog).today], ['2026-10-01', false]);
});

test('舊版未存時間的快照不能蓋過新同步，即使名字相同也以同步日期為準', () => {
  const s = setup();
  s.dog.walker = '我';
  s.seed({ '1': { prev: {}, wrote: { date: '2026-10-19', walker: '我' }, current: { date: '2026-10-19', walker: '我' }, mine: true } });
  s.sync(Date.parse('2026-10-19T02:01:00Z'));
  s.walks.receiveNames({ '1': '我' }, [s.dog]);
  assert.deepEqual([s.walks.state(s.dog).date, s.walks.state(s.dog).mine, s.walks.canUndo(s.dog)], ['2026-10-01', false, false]);
});
