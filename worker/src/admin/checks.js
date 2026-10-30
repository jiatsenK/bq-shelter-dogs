import { CRON_JOBS, cronKey } from '../cron-status.js';

// 稽核第 5 項：排程有沒有在跑。讀志工網站 Worker 每次跑完記的 cron_<工作>（worker/src/cron-status.js），
// 超過幾次沒跑完就算過期；讀不懂與從未記錄分開標示。
const CRON_STALE_MS = { retry: 40 * 60000, scan: 13 * 3600000, trash: 32 * 86400000, editlog: 26 * 3600000 };

export async function readCronStatus(db, now = Date.now()) {
  const keys = CRON_JOBS.map(cronKey);
  const { results = [] } = await db.prepare(`SELECT key, value FROM v3_sync_state WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all();
  const saved = new Map(results.map(r => [r.key, r.value]));
  const valid = s => (typeof s === 'string' && !isNaN(Date.parse(s)) ? s : null);
  return CRON_JOBS.map(job => {
    const raw = saved.get(cronKey(job));
    if (raw === undefined || raw === null) return { job, state: 'never', okAt: null, failAt: null, error: '', stale: true };
    let v;
    try { v = JSON.parse(raw); } catch { v = null; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { job, state: 'error', okAt: null, failAt: null, error: '', stale: true };
    const okAt = valid(v.okAt), failAt = valid(v.failAt);
    return { job, state: 'ok', okAt, failAt, error: failAt && typeof v.error === 'string' ? v.error : '',
      stale: !okAt || now - Date.parse(okAt) > CRON_STALE_MS[job] };
  });
}
// #684 寫回停止重試的狗在今日溜狗紀錄 module（today-walks/index.js 的 stopped()）。
