// Shared response parsing; no app state, storage or automatic requests.
export async function settle(pending) {
  let res;
  try { res = await pending; } catch (e) {
    const raw = (e && e.message) || String(e);
    return { ok: false, status: 0, data: null, error: 'network', message: raw === 'Load failed' ? '網頁載入失敗' : raw };
  }
  let data = null, message = '';
  try { data = await res.json(); } catch (e) { message = (e && e.message) || String(e); }
  if (!res.ok) return { ok: false, status: res.status, data, error: 'http', message };
  if (message) return { ok: false, status: res.status, data: null, error: 'format', message };
  return { ok: true, status: res.status, data, error: null, message: '' };
}
