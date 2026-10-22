// 寫試算表（ADR 0006）：Worker 只透過 K 部署的 Apps Script 小程式（apps-script/sheet-write.gs）改試算表，
// 所有呼叫都經過這裡，小程式能做哪些動作就看 SHEET_ACTIONS：
// - walk／edit／undo：溜狗表的「遛狗日期」「誰遛的」兩欄（舊流程，#138）
// - note／log：追加一隻狗的備註、新增一筆異動紀錄（#239、#281）
// - group：常遛狗群分頁加狗、移出、開新群（K 2026-10-16）
// - walkWake／walkWakeBatch／walkScan：新登記流程寫回（單隻、合併最多 10 隻）、讀回主清單（walk-accept.js、walk-reconcile.js）
export const SHEET_ACTIONS = new Set(['walk', 'edit', 'undo', 'note', 'log', 'group', 'walkWake', 'walkWakeBatch', 'walkScan']);
const TIMEOUT_MS = 20 * 1000;
// 合併派送在 Apps Script 鎖內逐隻寫、每隻各回呼 Worker 兩次，10 隻要比單隻久
const BATCH_TIMEOUT_MS = 90 * 1000;

// status：要回給網站的 HTTP 狀態；code 'off' 是還沒設定（網站就照舊只記在手機上）
export class SheetWriteError extends Error {
  constructor(message, status, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// 送一個動作給小程式，回小程式的回應（ok 一定是 true）；任何失敗都丟 SheetWriteError，訊息可以直接給志工看
export async function callSheet(env, body) {
  if (!SHEET_ACTIONS.has(body && body.action)) throw new Error(`小程式沒有這個動作：${body && body.action}`);
  const url = env && env.SHEET_WRITE_URL ? String(env.SHEET_WRITE_URL) : '';
  if (!url) throw new SheetWriteError('還沒設定寫入試算表', 503, 'off');
  const payload = env.SHEET_WRITE_KEY ? { ...body, key: String(env.SHEET_WRITE_KEY) } : body;
  let res, out = null;
  try {
    // Apps Script 回應會先轉址到 googleusercontent.com，fetch 會自己跟過去
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(body.action === 'walkWakeBatch' ? BATCH_TIMEOUT_MS : TIMEOUT_MS),
    });
    out = await res.json().catch(() => null);
  } catch (e) {
    throw new SheetWriteError('連不上試算表，請稍後再試', 502);
  }
  if (!res.ok || !out) throw new SheetWriteError(`試算表沒有回應（${res.status}）`, 502);
  if (!out.ok) throw new SheetWriteError(out.code === 'key' ? '寫入試算表的金鑰不對，請 K 檢查設定' : scriptError(out.error), 502, out.code === 'key' ? 'key' : '');
  return out;
}

// 小程式的錯誤訊息會顯示給志工看：Google 的原始錯誤可能帶試算表 ID，換成白話、不帶 ID
export function scriptError(msg) {
  const text = typeof msg === 'string' ? msg : '';
  if (!text) return '試算表沒有寫進去';
  if (/spreadsheet id|Illegal spreadsheet|找不到.*檔案|not found/i.test(text)) return '試算表 ID 不對，請 K 檢查小程式設定';
  if (/permission|權限|access/i.test(text)) return '小程式沒有試算表的編輯權限，請 K 檢查設定';
  if (text.startsWith('小程式發生錯誤')) return '小程式發生錯誤，請 K 查看 Apps Script 的執行紀錄';
  return [...text.replace(/[A-Za-z0-9_-]{25,}/g, '…')].slice(0, 100).join('');
}
