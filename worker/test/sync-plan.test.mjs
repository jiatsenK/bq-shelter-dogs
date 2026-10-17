// ADR 0012：有改才同步＋每天保險一次（worker/src/sync-plan.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './fakes.mjs';
import { markChanged, planTick, isDailySlot, sheetSignature, refreshPlan, rememberSignature, SYNC_DAILY_MAX } from '../src/sync-plan.js';

const at = iso => new Date(iso).getTime();

test('每天台灣 6:30（UTC 22:30）那一格是保險同步，其他格不是', () => {
  assert.equal(isDailySlot(at('2026-10-16T22:30:00Z')), true);
  assert.equal(isDailySlot(at('2026-10-16T22:20:00Z')), false);
  assert.equal(isDailySlot(at('2026-10-16T06:30:00Z')), false);
});

test('沒人改試算表：每 10 分鐘看一次都不同步', async () => {
  const db = fakeD1();
  assert.equal(await planTick(db, at('2026-10-16T02:00:00Z')), 'none');
});

test('有人改：下一格同步一次，改很多次也只同步一次', async () => {
  const db = fakeD1();
  await markChanged(db, at('2026-10-16T02:01:00Z'));
  await markChanged(db, at('2026-10-16T02:03:00Z'));
  assert.equal(await planTick(db, at('2026-10-16T02:10:00Z')), 'changed');
  assert.equal(await planTick(db, at('2026-10-16T02:20:00Z')), 'none');
});

test('保險同步：沒人改也同步，順便清掉「有改」', async () => {
  const db = fakeD1();
  await markChanged(db, at('2026-10-16T22:25:00Z'));
  assert.equal(await planTick(db, at('2026-10-16T22:30:00Z')), 'daily');
  assert.equal(await planTick(db, at('2026-10-16T22:40:00Z')), 'none');
});

test(`一天最多 ${SYNC_DAILY_MAX} 次，台灣隔天重新算；超過的「有改」留到隔天`, async () => {
  const db = fakeD1();
  // 台灣 10/17 一整天 ＝ UTC 10/16 16:00 起
  let t = at('2026-10-16T16:00:00Z');
  for (let i = 0; i < SYNC_DAILY_MAX; i++, t += 600000) {
    await markChanged(db, t);
    assert.equal(await planTick(db, t + 1), 'changed');
  }
  await markChanged(db, t);
  assert.equal(await planTick(db, t + 1), 'cap');
  // 台灣 10/18 00:00（UTC 10/17 16:00）重新算
  assert.equal(await planTick(db, at('2026-10-17T16:00:00Z')), 'changed');
});

test('試算表指紋：三個分頁內容的雜湊，內容一樣指紋就一樣', async () => {
  const sheets = { 主清單: 'a', 常遛狗群: 'b', 已出所: 'c' };
  const seen = [];
  const fetchImpl = async url => { const name = new URL(url).searchParams.get('sheet'); seen.push(name); return new Response(sheets[name]); };
  const one = await sheetSignature('ID', fetchImpl);
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.deepEqual(seen.sort(), ['主清單', '已出所', '常遛狗群'].sort());
  assert.equal(await sheetSignature('ID', fetchImpl), one);
  sheets.已出所 = 'd';
  assert.notEqual(await sheetSignature('ID', fetchImpl), one);
  await assert.rejects(sheetSignature('ID', async () => new Response('', { status: 500 })));
});

test('「更新」：試算表沒變不同步；變了才同步並記住指紋；讀不到試算表就照樣同步', async () => {
  const db = fakeD1();
  assert.equal(await refreshPlan(db, async () => 'x'), 'sync');
  assert.equal(await refreshPlan(db, async () => 'x'), 'same');
  assert.equal(await refreshPlan(db, async () => 'y'), 'sync');
  assert.equal(await refreshPlan(db, async () => { throw new Error('連不到'); }), 'sync');
  // 定時同步時記下的指紋，之後按「更新」也算數
  await rememberSignature(db, 'z');
  assert.equal(await refreshPlan(db, async () => 'z'), 'same');
});
