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
    let response;
    try { await verifyAccess(request, env); }
    catch (error) {
      return protectedResponse(json({ error: error.status === 503 ? '管理權限暫時無法確認，請稍後重試' : '請由管理網站登入後再試' }, error.status || 401), request.method);
    }
    try {
      const path = new URL(request.url).pathname;
      if (!['GET', 'HEAD'].includes(request.method)) {
        response = json({ error: '此階段僅提供唯讀查詢' }, 405);
        response.headers.set('Allow', 'GET, HEAD');
      } else if (path === '/api/manage/dogs') response = json({ dogs: await readManageDogs(env.DB) });
      else if (path === '/api' || path.startsWith('/api/')) response = json({ error: '找不到管理功能' }, 404);
      else if (path.startsWith('/photos/')) response = await photoResponse(path, env);
      else response = await env.ASSETS.fetch(request);
    } catch { response = json({ error: '管理資料暫時無法讀取，請稍後重試' }, 503); }
    return protectedResponse(response, request.method);
  },
};
