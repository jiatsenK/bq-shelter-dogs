import { readDogEdit, saveDogEdit } from '../dog-edit.js';
import { previewMerge, mergeDogs, unmergeDogs } from '../dog-merge.js';
import { photoInput, saveDogPhoto, restoreDogPhoto, listDogTrash, readDogTrash } from '../dog-photo.js';
import { TRASH_DAYS } from '../r2.js';
import { readSettings, saveSettings } from '../feature-settings.js';
import { createAccessVerifier } from './access.js';
import { readManageDogs } from './dogs.js';
import { readActivities } from '../activities.js';
import { writeActivity } from './activities.js';
import { readSheetGaps, readCronStatus } from './checks.js';
import { searchEdits } from './edits.js';
import { readSiteLinks } from './links.js';
import { isPhotoKey, isTomb, isThumbKey, r2Versions } from '../r2.js';

const verifyAccess = createAccessVerifier();
// Tabler uses data-image SVGs for select chevrons; executable content remains same-origin only.
export const ADMIN_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const json = (data, status = 200) => Response.json(data, { status });
const sameOrigin = (request, env) => request.headers.get('Origin') === env.ADMIN_ORIGIN && request.headers.get('Sec-Fetch-Site') !== 'cross-site';
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
async function settingsInput(request, maxBytes = 4096) {
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('設定格式不對'), { status: 400 });
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw Object.assign(new Error('設定內容太大'), { status: 413 }); }
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
          if (!sameOrigin(request, env)) response = json({ error: '請從管理網站儲存' }, 403);
          else if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') response = json({ error: '請使用 JSON' }, 415);
          else {
            response = json(await saveSettings(env.DB, await settingsInput(request), actor));
          }
        } else response = json({ error: '請使用 GET 或 PUT' }, 405);
       } else if (/^\/api\/manage\/dogs\//.test(path)) {
        const match=path.match(/^\/api\/manage\/dogs\/([a-f0-9]{32})(?:\/(photo|trash|restore|merge|unmerge)(?:\/([0-9]{13}-[a-f0-9]{4}))?)?$/);
        if(!match) response=json({error:'找不到狗資料'},404);
        else {
          const [,dogId,action,trashId]=match;
          if(['GET','HEAD'].includes(request.method)&&action==='trash'&&trashId) {const item=await readDogTrash(env,dogId,trashId);response=item?new Response(item.bytes,{headers:{'Content-Type':'image/jpeg'}}):json({error:'找不到這隻狗的備份'},404);}
          // 合併狗（K 2026-10-26）：GET 預覽 ?source=被併的那隻；POST merge／unmerge 寫入
          else if(['GET','HEAD'].includes(request.method)&&action==='merge') response=json(await previewMerge(env.DB,dogId,new URL(request.url).searchParams.get('source')||''));
          else if(['GET','HEAD'].includes(request.method)&&action==='unmerge') response=json({error:'請使用 POST'},405);
          else if(['GET','HEAD'].includes(request.method)) response=json(action==='trash'?{days:TRASH_DAYS,trash:await listDogTrash(env,dogId)}:await readDogEdit(env.DB,dogId));
          else if(!sameOrigin(request,env)) response=json({error:'請從管理網站儲存'},403);
          else if(action==='photo' && request.method==='POST') response=json(await saveDogPhoto(env,dogId,Number(request.headers.get('X-Dog-Revision')),await photoInput(request),{actor},new URL(request.url).origin));
          else if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json') response=json({error:'請使用 JSON'},415);
          else if(!action&&request.method==='PUT') response=json(await saveDogEdit(env.DB,dogId,await settingsInput(request,16000),{actor}));
          else if(action==='restore'&&request.method==='POST') {
            const input=await settingsInput(request);
            if(!input||Object.keys(input).sort().join(',')!=='revision,trashId')response=json({error:'復原欄位不對'},400);
            else response=json(await restoreDogPhoto(env,dogId,input.revision,input.trashId,{actor},new URL(request.url).origin));
          } else if(action==='merge'&&request.method==='POST') response=json(await mergeDogs(env.DB,dogId,await settingsInput(request),{actor}));
          else if(action==='unmerge'&&request.method==='POST') response=json(await unmergeDogs(env.DB,dogId,await settingsInput(request),{actor}));
          else response=json({error:'方法不支援'},405);
        }
      } else if (path === '/api/manage/activities' || path.startsWith('/api/manage/activities/')) {
        const match = path.match(/^\/api\/manage\/activities(?:\/([a-f0-9]{32}))?$/);
        if (!match) response = json({ error: '找不到這場活動' }, 404);
        else if (['GET', 'HEAD'].includes(request.method)) response = match[1] ? json({ error: '請使用 GET /api/manage/activities' }, 405) : json({ activities: await readActivities(env.DB) });
        else if (!sameOrigin(request, env)) response = json({ error: '請從管理網站儲存' }, 403);
        else if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') response = json({ error: '請使用 JSON' }, 415);
        else response = json(await writeActivity(env.DB, request.method, match[1], await settingsInput(request, 16000), actor));
      } else if (!['GET', 'HEAD'].includes(request.method)) {
        response = json({ error: '此階段僅提供唯讀查詢' }, 405);
        response.headers.set('Allow', 'GET, HEAD');
      } else if (path === '/api/manage/dogs') {
        // 有沒有照片看 R2 清單（同志工網站 /api/dogs 的 photoVersions，30 秒快取）；讀不到就整份 503，不把全部當成缺照片
        const photos = env.PHOTOS ? (await r2Versions(env)).versions : {};
        response = json({ dogs: await readManageDogs(env.DB, photos) });
      }
      else if (path === '/api/manage/data-checks') response = json({ sheetGaps: await readSheetGaps(env.DB) });
      else if (path === '/api/manage/cron-status') response = json({ jobs: await readCronStatus(env.DB) });
      else if (path === '/api/manage/links') response = json(readSiteLinks(env));
      else if (path === '/api/manage/edits') response = json(await searchEdits(env.DB, new URL(request.url).searchParams));
      else if (path === '/api' || path.startsWith('/api/')) response = json({ error: '找不到管理功能' }, 404);
      else if (path.startsWith('/photos/')) response = await photoResponse(path, env);
      else response = await env.ASSETS.fetch(request);
    } catch (error) { response = json({ error: error.status ? error.message : '管理資料暫時無法讀取，請稍後重試' }, error.status || 503); }
    return protectedResponse(response, request.method);
  },
};
