// 資料流頁（K 2026-10-26）：節點圖上的燈號。一次 batch、只讀，0 寫入：
// 還沒寫回的狗（只看目前版本）、衝突、派送中、今天的寫入預算、最近一次網站登記、狗清單最後一次有改到、狗清單保險掃描、三件排程。
import { readCronStatus } from './checks.js';
import { EXTRA_KEY } from '../dog-list.js';
import { SYNCED_AT_KEY } from '../compact.js';

// 跟 wrangler.jsonc 的 SYNC_DAILY_BUDGET 一樣（worker/test/admin-flow.test.mjs 核對）；管理網站 Worker 沒有這個變數
export const DAILY_BUDGET = 40000;
const OPEN_MAX = 20;

const OPEN = `SELECT s.number, s.name, o.status, o.error, o.next_attempt_at AS nextAt, o.target_date AS targetDate
  FROM v3_walk_outbox o JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version
  WHERE o.status NOT IN ('synced','superseded') ORDER BY o.next_attempt_at, o.dog_key`;

export async function readFlowStatus(db, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10); // 寫入預算以 UTC 日計（walk-accept.js 的 writeBudget）
  const [open, conflicts, delivering, budget, lastWalk, state] = await db.batch([
    db.prepare(OPEN),
    db.prepare('SELECT COUNT(*) AS n FROM v3_walk_conflicts'),
    db.prepare('SELECT COUNT(*) AS n FROM v3_walk_delivery'),
    db.prepare('SELECT reserved FROM v3_walk_write_budget WHERE day=?').bind(day),
    db.prepare('SELECT MAX(updated_at) AS at FROM v3_walk_state'),
    db.prepare('SELECT key, value FROM v3_sync_state WHERE key IN (?,?)').bind(SYNCED_AT_KEY, EXTRA_KEY),
  ]).then(results => results.map(r => r.results || []));
  const saved = new Map(state.map(r => [r.key, r.value]));
  let scan = null;
  try {
    const v = JSON.parse(saved.get(EXTRA_KEY) ?? 'null');
    if (v && Array.isArray(v.keys)) scan = { checkedAt: typeof v.checkedAt === 'string' ? v.checkedAt : null, extra: v.keys.length };
  } catch { /* 讀不懂就當成沒有紀錄 */ }
  return {
    readAt: new Date(now).toISOString(),
    writeback: { total: open.length, items: open.slice(0, OPEN_MAX).map(r => ({ ...r, error: r.error || '' })) },
    conflicts: conflicts[0]?.n || 0,
    delivering: delivering[0]?.n || 0,
    budget: { day, reserved: budget[0]?.reserved || 0, limit: DAILY_BUDGET },
    lastWalkAt: lastWalk[0]?.at || null,
    dogListChangedAt: saved.get(SYNCED_AT_KEY) || null,
    dogListScan: scan,
    cron: await readCronStatus(db, now),
  };
}
