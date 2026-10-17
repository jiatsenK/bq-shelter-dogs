// 什麼時候叫 GitHub 同步試算表（ADR 0012：有改才同步＋每天保險一次）
// - Apps Script 在有人手動改試算表時通知 Worker（markChanged），Worker 記下「有改」
// - Cron 每 10 分鐘看一次（planTick）：有改才同步，10 分鐘內改很多次只同步一次；一天（台灣時間）最多 SYNC_DAILY_MAX 次
// - 台灣 6:30 那一格不管有沒有改都同步一次（保險）
// - 頁首「更新」先比對試算表指紋（refreshPlan），沒變就不叫 GitHub
// 狀態存在 D1 的 v3_sync_state（db/compact-schema.sql），一列一個 key

// #329：30 → 12，GitHub Actions 免費額度一個月 2,000 分鐘，同步每次算 1 分鐘
export const SYNC_DAILY_MAX = 12;
// 同步讀的分頁（scripts/sync-sheet.mjs、scripts/sync-compact-d1.mjs）
export const SHEET_TABS = ['主清單', '常遛狗群', '已出所'];


// 台灣今天的日期 YYYY-MM-DD（index.js 也用這個）
export const taiwanYmd = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);

async function get(db, key) {
  return db.prepare('SELECT value FROM v3_sync_state WHERE key = ?').bind(key).first('value');
}
const put = (db, key, value) => db.prepare('INSERT INTO v3_sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, String(value));
const drop = (db, key) => db.prepare('DELETE FROM v3_sync_state WHERE key = ?').bind(key);

// Cron 是 UTC，台灣 6:30 ＝ UTC 22:30
export function isDailySlot(now) {
  const d = new Date(now);
  return d.getUTCHours() === 22 && d.getUTCMinutes() === 30;
}

export async function markChanged(db, now = Date.now()) {
  await put(db, 'changed', new Date(now).toISOString()).run();
}

// 回 'daily'（保險同步）、'changed'（有改，要同步）、'cap'（今天次數用完）、'none'（沒改）
export async function planTick(db, now = Date.now()) {
  const changed = await get(db, 'changed');
  if (isDailySlot(now)) {
    if (changed) await drop(db, 'changed').run();
    return 'daily';
  }
  if (!changed) return 'none';
  const day = taiwanYmd(now);
  const [countDay, count] = String((await get(db, 'count')) || '').split(' ');
  const used = countDay === day ? Number(count) || 0 : 0;
  if (used >= SYNC_DAILY_MAX) return 'cap';
  await db.batch([drop(db, 'changed'), put(db, 'count', `${day} ${used + 1}`)]);
  return 'changed';
}

// 試算表指紋：同步會讀的分頁內容（gviz）合起來的 SHA-256；讀不到就丟錯
export async function sheetSignature(sheetId, fetchImpl = fetch) {
  const texts = await Promise.all(SHEET_TABS.map(async name => {
    const res = await fetchImpl(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:json&headers=0&sheet=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`讀不到「${name}」分頁（HTTP ${res.status}）`);
    return res.text();
  }));
  const bytes = new TextEncoder().encode(texts.join('\u0000'));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function rememberSignature(db, sig) {
  await put(db, 'sheet_sig', sig).run();
}

// 「更新」：回 'same'（試算表沒變，不用同步）或 'sync'。指紋讀不到時照樣同步，寧可多跑一次
export async function refreshPlan(db, signature) {
  let sig;
  try { sig = await signature(); } catch (e) { return 'sync'; }
  if (sig === await get(db, 'sheet_sig')) return 'same';
  await put(db, 'sheet_sig', sig).run();
  return 'sync';
}
