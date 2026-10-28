// #518／#567「網站有、試算表沒有」：只讀保險掃描留在 v3_sync_state 的清單，對上 D1 的狗給管理者看。
// 不刪狗、不記離所、不合併；讀不懂與從未掃描分開標示，不當成「沒有差異」。
import { EXTRA_KEY } from '../dog-list.js';
import { CRON_JOBS, cronKey } from '../cron-status.js';
import { STOPPED_AT } from '../walk-accept.js';

const STALE_MS = 24 * 3600000; // 掃描一天三次，超過一天沒有新掃描就是過期
const SHOW_MAX = 200;
const CHUNK = 90; // D1 每個查詢最多綁 100 個參數
const sheets = { main: 'v3_sheet_main', departed: 'v3_dog_departures' };

function parseKey(key) {
  const at = key.indexOf(':');
  const sheet = at > 0 ? key.slice(0, at) : key, rest = at > 0 ? key.slice(at + 1) : '';
  if (sheets[sheet]) return rest.startsWith('名:') ? { sheet, key, number: '', name: rest.slice(2) } : { sheet, key, number: rest, name: '' };
  return { sheet, key, number: '', name: rest };
}

// 每張表最多 ceil(N/90) 個查詢，N 不超過 SHOW_MAX
async function lookup(db, sheet, items) {
  const found = new Map();
  for (let i = 0; i < items.length; i += CHUNK) {
    const part = items.slice(i, i + CHUNK);
    const numbers = part.filter(x => x.number).map(x => x.number), names = part.filter(x => !x.number).map(x => x.name);
    const marks = list => list.map(() => '?').join(',') || "''";
    const extra = sheet === 'main' ? ', cage' : ", '' AS cage";
    const { results = [] } = await db.prepare(`SELECT number, name, dog_id${extra} FROM ${sheets[sheet]} WHERE number IN (${marks(numbers)}) OR (number='' AND name IN (${marks(names)}))`)
      .bind(...numbers, ...names).all();
    for (const r of results) if (!found.has(r.number || `名:${r.name}`)) found.set(r.number || `名:${r.name}`, r);
  }
  return found;
}

export async function readSheetGaps(db, now = Date.now()) {
  const raw = await db.prepare('SELECT value FROM v3_sync_state WHERE key=?').bind(EXTRA_KEY).first('value');
  if (raw === null || raw === undefined) return { state: 'never', items: [], total: 0 };
  let saved;
  try { saved = JSON.parse(raw); } catch { saved = null; }
  if (!saved || !Array.isArray(saved.keys) || !saved.keys.every(k => typeof k === 'string')) return { state: 'error', items: [], total: 0 };
  const valid = s => (typeof s === 'string' && !isNaN(Date.parse(s)) ? s : null);
  const recordedAt = valid(saved.at), checkedAt = valid(saved.checkedAt);
  const items = saved.keys.slice(0, SHOW_MAX).map(parseKey);
  for (const sheet of Object.keys(sheets)) {
    const mine = items.filter(x => x.sheet === sheet);
    if (!mine.length) continue;
    const found = await lookup(db, sheet, mine);
    for (const item of mine) {
      const row = found.get(item.number || `名:${item.name}`);
      Object.assign(item, { name: row?.name || item.name, dogId: row?.dog_id || null, cage: row?.cage || '' });
    }
  }
  for (const item of items) if (!('dogId' in item)) Object.assign(item, { dogId: null, cage: '' });
  return {
    state: 'ok', recordedAt, checkedAt, total: saved.keys.length, items,
    stale: !checkedAt || now - Date.parse(checkedAt) > STALE_MS,
  };
}

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

// #684 寫回停止重試的狗：只列各狗目前版本的工作（舊版本已被新登記取代）。條件照 v3_walk_outbox_due 部分索引寫，走索引不掃表。
// 原因由 outbox.error 換成白話（前綴見 walk-accept.js 的 remoteError），次數讀 v3_walk_retry。
const stopReason = error => error === 'writeback-not-configured' ? '志工網站還沒設定寫入試算表'
  : String(error || '').replace(/^writeback-[a-z]+:\s*/, '') || '試算表沒有寫進去';

export async function readStoppedWalks(db) {
  const { results = [] } = await db.prepare(`SELECT s.number, s.name, s.dog_id, o.operation_date, o.error, COALESCE(r.failures, 0) AS failures
    FROM v3_walk_outbox o JOIN v3_walk_state s ON s.dog_key=o.dog_key AND s.version=o.version
    LEFT JOIN v3_walk_retry r ON r.dog_key=o.dog_key AND r.version=o.version
    WHERE o.status IN ('pending','retry','unconfirmed') AND o.next_attempt_at=?
    ORDER BY o.operation_date DESC, s.number LIMIT ?`).bind(STOPPED_AT, SHOW_MAX).all();
  return results.map(r => ({ number: r.number || '', name: r.name || '', dogId: r.dog_id || null, date: r.operation_date,
    failures: r.failures, reason: stopReason(r.error) }));
}
