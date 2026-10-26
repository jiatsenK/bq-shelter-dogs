import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEWS, parseFlowStatus, liveStatus, edgesOf } from '../admin/public/js/flow-model.js';

// 資料流頁（K 2026-10-26）的純規則：圖的定義自洽、燈號門檻、格式不對要丟錯。
const now = Date.parse('2026-10-27T02:00:00.000Z'), iso = ms => new Date(ms).toISOString();
const base = () => ({
  readAt: iso(now), writeback: { total: 0, items: [] }, conflicts: 0, delivering: 0,
  budget: { day: '2026-10-27', reserved: 0, limit: 40000 }, lastWalkAt: null, dogListChangedAt: null, dogListScan: null,
  cron: ['retry', 'scan', 'trash'].map(job => ({ job, state: 'never', okAt: null, failAt: null, error: '', stale: true })),
});
const item = (over = {}) => ({ number: '1', name: '阿福', status: 'pending', error: '', nextAt: iso(now), targetDate: '2026-10-27', ...over });

test('兩張圖：節點不重疊、在格子內，連線兩端都是存在的節點與合法的邊', () => {
  for (const [name, v] of Object.entries(VIEWS)) {
    const ids = new Set(v.nodes.map(n => n.id)), cells = new Set();
    assert.equal(ids.size, v.nodes.length, `${name} 節點 id 不重複`);
    for (const n of v.nodes) {
      assert.ok(n.col >= 0 && n.col < v.cols && n.row >= 0 && n.row < v.rows, `${name}/${n.id} 在格子內`);
      assert.ok(!cells.has(`${n.col},${n.row}`), `${name}/${n.id} 不跟別的節點同格`);
      cells.add(`${n.col},${n.row}`);
      for (const key of ['role', 'data', 'trigger', 'failure', 'code']) assert.ok(n.detail[key], `${name}/${n.id} 有 ${key}`);
    }
    for (const e of v.edges) {
      for (const end of [e.from, e.to]) {
        assert.ok(ids.has(end[0]), `${name} 連線接到 ${end[0]}`);
        assert.ok(['l', 'r', 't', 'b'].includes(end[1]));
      }
      assert.ok(e.label);
    }
  }
  assert.deepEqual(edgesOf('flow', 'trash').map(e => e.to[0]), ['r2']);
});

test('寫回燈號：沒有就綠；被拒紅；到期超過 15 分鐘沒派送橘；剛登記的正在寫回不算問題', () => {
  const s = base();
  assert.deepEqual([liveStatus('writeback', s, now).level, liveStatus('writeback', s, now).text], ['ok', '沒有等著寫回的狗']);
  s.writeback = { total: 1, items: [item({ nextAt: iso(now - 60000) })] };
  assert.equal(liveStatus('writeback', s, now).text, '1 隻正在寫回');
  s.writeback.items = [item({ nextAt: iso(now - 16 * 60000) })];
  assert.equal(liveStatus('writeback', s, now).level, 'warn');
  s.writeback = { total: 25, items: [item({ status: 'retry', error: 'writeback-rejected: 找不到唯一的狗', nextAt: iso(now + 60000) })] };
  const r = liveStatus('writeback', s, now);
  assert.equal(r.level, 'bad');
  assert.deepEqual(r.lines, ['阿福（1）：等待重試・writeback-rejected: 找不到唯一的狗', '還有 24 隻沒列出']);
});

test('預算、不一致、排程、狗清單保險掃描的燈號', () => {
  const s = base();
  assert.equal(liveStatus('budget', s, now).level, 'ok');
  s.budget.reserved = 20000;
  assert.equal(liveStatus('budget', s, now).level, 'warn');
  s.budget.reserved = 32000;
  assert.deepEqual([liveStatus('budget', s, now).level, liveStatus('budget', s, now).text], ['bad', '今天寫入預算 80%']);
  assert.equal(liveStatus('conflicts', s, now).level, 'ok');
  s.conflicts = 2;
  assert.equal(liveStatus('conflicts', s, now).text, '2 隻跟網站不一致');
  assert.equal(liveStatus('cron:scan', s, now).level, 'none', '還沒跑過不算出錯');
  s.cron[1] = { job: 'scan', state: 'ok', okAt: iso(now - 3600000), failAt: null, error: '', stale: false };
  assert.equal(liveStatus('cron:scan', s, now).level, 'ok');
  s.cron[1] = { ...s.cron[1], failAt: iso(now - 60000), error: '主清單直接讀回失敗' };
  assert.equal(liveStatus('cron:scan', s, now).level, 'bad');
  assert.equal(liveStatus('dogListScan', s, now).level, 'none');
  s.dogListScan = { checkedAt: iso(now - 25 * 3600000), extra: 0 };
  assert.equal(liveStatus('dogListScan', s, now).level, 'bad');
  s.dogListScan = { checkedAt: iso(now - 3600000), extra: 3 };
  assert.equal(liveStatus('dogListScan', s, now).level, 'warn');
  assert.equal(liveStatus('lastWalk', s, now).level, 'none');
});

test('狀態格式不對就丟錯，不畫成正常', () => {
  assert.doesNotThrow(() => parseFlowStatus(base()));
  for (const broken of [null, { ...base(), conflicts: -1 }, { ...base(), budget: { reserved: 1, limit: 0 } },
    { ...base(), writeback: { total: 1, items: [item({ status: 'synced' })] } }, { ...base(), cron: [{ job: 'x', state: 'ok' }] }]) {
    assert.throws(() => parseFlowStatus(broken), /格式不正確/);
  }
});
