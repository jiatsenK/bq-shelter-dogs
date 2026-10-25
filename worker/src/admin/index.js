import { readSettings, saveSettings } from '../feature-settings.js';
import { createAccessVerifier } from './access.js';
import { readManageDogs } from './dogs.js';
import { isPhotoKey, isTomb, isThumbKey } from '../r2.js';

const verifyAccess = createAccessVerifier();
// Tabler uses data-image SVGs for select chevrons; executable content remains same-origin only.
export const ADMIN_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const json = (data, status = 200) => Response.json(data, { status });
function protectedResponse(response, method) {
  const out = new Response(method === 'HEAD' ? null : response.body, response);
  out.headers.set('Cache-Control', 'no-store');
  out.headers.set('Vary', 'Cf-Access-Jwt-Assertion');
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Referrer-Policy', 'no-referrer');
  out.headers.set('X-Frame-Options', 'DENY');
  out.headers.set('Content-Security-Policy', ADMIN_CSP);
  return out;
}
async function settingsInput(request) {
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('設定格式不對'), { status: 400 });
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw Object.assign(new Error('設定內容太大'), { status: 413 }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw Object.assign(new Error('設定格式不對'), { status: 400 }); }
}
async function photoResponse(pathname, env) {
  let key;
  try { key = decodeURIComponent(pathname.slice(1)); } catch { return json({ error: '找不到照片' }, 404); }
  if (!isPhotoKey(key)) return json({ error: '找不到照片' }, 404);
  if (!env.PHOTOS) return json({ error: '照片暫時無法讀取' }, 503);
  let obj = await env.PHOTOS.get(key);
  if (!obj && isThumbKey(key)) obj = await env.PHOTOS.get(key.replace('photos/thumbs/', 'photos/'));
  if (!obj || isTomb(obj)) return json({ error: '找不到照片' }, 404);
  return new Response(obj.body, { headers: { 'Content-Type': 'image/jpeg' } });
}
export default {
  async fetch(request, env) {
    let response, actor;
    try { actor = await verifyAccess(request, env); }
    catch (error) {
      return protectedResponse(json({ error: error.status === 503 ? '管理權限暫時無法確認，請稍後重試' : '請由管理網站登入後再試' }, error.status || 401), request.method);
    }
    try {
      const path = new URL(request.url).pathname;
      if (path === '/api/manage/settings') {
        if (['GET','HEAD'].includes(request.method)) response = json(await readSettings(env.DB));
        else if (request.method === 'PUT') {
          if (request.headers.get('Origin') !== env.ADMIN_ORIGIN || request.headers.get('Sec-Fetch-Site') === 'cross-site') response = json({ error: '請從管理網站儲存' }, 403);
          else if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') response = json({ error: '請使用 JSON' }, 415);
          else {
            response = json(await saveSettings(env.DB, await settingsInput(request), actor));
          }
        } else response = json({ error: '請使用 GET 或 PUT' }, 405);
      } else if (!['GET', 'HEAD'].includes(request.method)) {
        response = json({ error: '此階段僅提供唯讀查詢' }, 405);
        response.headers.set('Allow', 'GET, HEAD');
      } else if (path === '/api/manage/dogs') response = json({ dogs: await readManageDogs(env.DB) });
      else if (path === '/api' || path.startsWith('/api/')) response = json({ error: '找不到管理功能' }, 404);
      else if (path.startsWith('/photos/')) response = await photoResponse(path, env);
      else response = await env.ASSETS.fetch(request);
    } catch (error) { response = json({ error: error.status ? error.message : '管理資料暫時無法讀取，請稍後重試' }, error.status || 503); }
    return protectedResponse(response, request.method);
  },
};
