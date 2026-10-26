import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryD1 } from '../../scripts/memory-d1.mjs';
import { fakeR2 } from './fakes.mjs';
import worker from '../src/admin/index.js';
import { createAccessVerifier } from '../src/admin/access.js';
import { readManageDogs } from '../src/admin/dogs.js';

const origin = 'https://manage.example.org';
const issuer = 'https://shelter.cloudflareaccess.com';
const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const now = Math.floor(Date.now() / 1000);
const claims = { iss: issuer, aud: ['admin-audience'], exp: now + 3600, iat: now - 10, nbf: now - 10, type: 'app', sub: 'manager-id', email: 'manager@example.org' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function token(overrides = {}, header = {}) {
  const data = `${encode({ alg: 'RS256', kid: jwk.kid, ...header })}.${encode({ ...claims, ...overrides })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(data));
  return `${data}.${Buffer.from(signature).toString('base64url')}`;
}
const env = { ADMIN_ORIGIN: origin, ACCESS_TEAM_DOMAIN: 'shelter.cloudflareaccess.com', ACCESS_AUD: 'admin-audience' };
const request = (path = '/', jwt, options = {}) => new Request(origin + path, { ...options, headers: { ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}), ...options.headers } });
const fetchKeys = async url => {
  assert.equal(String(url), `${issuer}/cdn-cgi/access/certs`);
  return Response.json({ keys: [jwk] });
};
test('Access：有效簽章、issuer、audience、時間及人員識別；同 issuer 共用金鑰快取', async () => {
  let calls = 0;
  const verify = createAccessVerifier({ fetchKeys: async url => { calls++; return fetchKeys(url); } });
  const jwt = await token();
  assert.equal((await verify(request('/', jwt), env)).email, claims.email);
  await Promise.all([verify(request('/', jwt), env), verify(request('/', jwt), env)]);
  assert.equal(calls, 1);
});
test('Access：取金鑰使用 Workers 支援的手動轉址模式，成功可驗證且 302 不跟隨', async () => {
  const jwt = await token();
  let calls = 0;
  const runtimeFetch = async (url, init) => {
    calls++;
    // workerd rejects redirect:error before sending a request; Node fetch does not.
    if (!['follow', 'manual'].includes(init.redirect)) throw new TypeError('Invalid redirect value');
    assert.equal(init.redirect, 'manual', 'signing keys must not follow redirects to another origin');
    return fetchKeys(url);
  };
  const verify = createAccessVerifier({ fetchKeys: runtimeFetch });
  assert.equal((await verify(request('/', jwt), env)).email, claims.email);
  assert.equal(calls, 1);
  let redirects = 0;
  const redirected = createAccessVerifier({ fetchKeys: async (url, init) => {
    redirects++;
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/keys' } });
  } });
  await assert.rejects(redirected(request('/', jwt), env), error => error.status === 503);
  assert.equal(redirects, 1, 'redirects never trigger a second request');
});
test('Access：缺設定、假 email、偽造、過期、錯 issuer／audience、未生效及非人員憑證全拒絕', async () => {
  const verify = createAccessVerifier({ fetchKeys });
  for (const setting of ['ADMIN_ORIGIN', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD']) {
    await assert.rejects(verify(request('/', await token()), { ...env, [setting]: '' }));
  }
  await assert.rejects(verify(request('/', undefined, { headers: { 'Cf-Access-Authenticated-User-Email': claims.email, Authorization: 'Bearer machine-key' } }), env));
  const valid = await token();
  const parts = valid.split('.');
  parts[1] = encode({ ...claims, email: 'forged@example.org' });
  for (const jwt of [parts.join('.'), await token({ exp: now - 1 }), await token({ iss: 'https://other.cloudflareaccess.com' }), await token({ aud: ['other'] }), await token({ nbf: now + 600 }), await token({ iat: now + 600 }), await token({ email: '' }), await token({ type: 'service' }), await token({}, { alg: 'none' }), await token({}, { kid: 'unknown' }), 'bad.token.value']) {
    await assert.rejects(verify(request('/', jwt), env));
  }
  await assert.rejects(verify(new Request('https://alternate.workers.dev/', { headers: { 'Cf-Access-Jwt-Assertion': valid } }), env));
});
test('Access：金鑰取得失敗不放行，失敗後可重試，過快取期限重新讀取', async () => {
  let clock = Date.now(), calls = 0;
  const verify = createAccessVerifier({ now: () => clock, fetchKeys: async url => { if (++calls === 1) throw Error('offline'); return fetchKeys(url); } });
  const req = request('/', await token());
  await assert.rejects(verify(req, env));
  await verify(req, env);
  clock += 301000;
  await verify(req, env);
  assert.equal(calls, 3);
});
test('管理 Worker：所有路徑在讀資產／D1／R2 前拒絕無權限請求', async () => {
  const forbidden = () => { throw Error('unauthorized resource read'); };
  const bindings = { ...env, ASSETS: { fetch: forbidden }, DB: { prepare: forbidden }, PHOTOS: { get: forbidden } };
  for (const path of ['/', '/index.html', '/js/main.js', '/vendor/tabler.min.css', '/api/manage/dogs', '/photos/123.jpg', '/api/walk', '/not-found']) {
    const res = await worker.fetch(request(path), bindings);
    assert.equal(res.status, 401, path);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal((await worker.fetch(request('/'), {})).status, 503);
});
test('管理 Worker：真實簽章可讀資產／狗表／照片；替代來源、寫入與機器入口拒絕', async t => {
  t.mock.method(globalThis, 'fetch', fetchKeys);
  const db = memoryD1();
  t.after(() => db.close());
  const { createCompactDatabase } = await import('../../scripts/compact-schema.mjs');
  await createCompactDatabase(db);
  await db.prepare("INSERT INTO v3_dogs(dog_id,name,sex,fixed_care) VALUES('dog1','阿福','male',1),('dog2','無編號','',0)").run();
  await db.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage,note) VALUES(0,'dog1','2026010101','阿福','A1','表格備註')").run();
  await db.prepare("INSERT INTO v3_intros VALUES('dog1','網站介紹')").run();
  await db.prepare("INSERT INTO v3_rest VALUES('dog1','2099-01-01','休養原因')").run();
  const PHOTOS = fakeR2();
  await PHOTOS.put('photos/2026010101.jpg', new Uint8Array([1, 2, 3]));
  let assetCalls = 0;
  const bindings = { ...env, DB: db, PHOTOS, ASSETS: { fetch: async () => { assetCalls++; return new Response('<html>管理網站</html>', { headers: { 'Cache-Control': 'public, max-age=3600' } }); } } };
  const jwt = await token();
  let queries = 0;
  const measured = { prepare(sql) { queries++; assert.match(sql.trim(), /^WITH current_rows/); return db.prepare(sql); } };
  const beforeRows = db.stats.rowsRead;
  assert.equal((await readManageDogs(measured)).length, 2);
  assert.equal(queries, 1, 'one SQL query for the entire table');
  assert.equal(db.stats.rowsRead - beforeRows, 2, 'local counter measures returned rows only');
  const page = await worker.fetch(request('/', jwt), bindings);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('Cache-Control'), 'no-store');
  assert.match(page.headers.get('Content-Security-Policy'), /default-src 'self'/);
  const res = await worker.fetch(request('/api/manage/dogs', jwt), bindings);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.dogs.length, 2);
  const dog = data.dogs.find(d => d.dogId === 'dog1');
  assert.equal(dog.intro, '網站介紹');
  assert.equal(dog.sex, 'male');
  assert.equal(dog.sexMismatch, false);
  assert.equal(dog.fixedCare, true);
  assert.equal(dog.rest.until, '2099-01-01');
  assert.equal(dog.photoUrl, '/photos/2026010101.jpg', '照片看 R2，沒有縮圖用主照片');
  assert.equal(data.dogs.find(d => d.dogId === 'dog2').photoUrl, null);
  assert.equal(data.dogs.find(d => d.dogId === 'dog2').onMain, false);
  assert.equal(data.dogs.find(d => d.dogId === 'dog2').number, '');
  assert.equal((await worker.fetch(request('/photos/2026010101.jpg', jwt), bindings)).status, 200);
  assert.equal((await worker.fetch(request('/photos/thumbs/2026010101.jpg', jwt), bindings)).status, 200, 'missing thumbnail falls back to the main image');
  const head = await worker.fetch(request('/api/manage/dogs', jwt, { method: 'HEAD' }), bindings);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await worker.fetch(request('/photos/trash/secret.jpg', jwt), bindings)).status, 404);
  assert.equal((await worker.fetch(new Request('https://alternate.workers.dev/api/manage/dogs', { headers: { 'Cf-Access-Jwt-Assertion': jwt } }), bindings)).status, 403);
  assert.equal((await worker.fetch(request('/api/manage/dogs', jwt, { method: 'POST', body: '{}' }), bindings)).status, 405);
  assert.equal((await worker.fetch(request('/api/walk', jwt), bindings)).status, 404);
  assert.equal(assetCalls, 1);
  for (const path of ['/', '/js/main.js', '/api/manage/dogs', '/photos/2026010101.jpg']) {
    assert.equal((await worker.fetch(request(path, await token({ exp: now - 1 })), bindings)).status, 401);
  }
  const failed = await worker.fetch(request('/api/manage/dogs', jwt), { ...bindings, DB: { prepare() { throw Error('private database details'); } } });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /private database details/);
});

test('管理設定：只有 Access 身分可改；同來源、型別、大小、白名單與版本驗證', async t => {
  t.mock.method(globalThis, 'fetch', fetchKeys);
  const DB = memoryD1(); t.after(() => DB.close());
  await (await import('../../scripts/compact-schema.mjs')).createCompactDatabase(DB);
  const bindings = { ...env, DB }, jwt = await token();
  const read = await worker.fetch(request('/api/manage/settings', jwt), bindings);
  assert.equal(read.status, 200); const initial = await read.json();
  const put = (body, headers = {}) => request('/api/manage/settings', jwt, { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { Origin: origin, 'Content-Type': 'application/json', ...headers } });
  const changed = { ...initial, values: { ...initial.values, editIntro: false } };
  assert.equal((await worker.fetch(put(changed, { Origin: 'https://evil.org' }), bindings)).status, 403);
  assert.equal((await worker.fetch(put(changed, { 'Content-Type': 'text/plain' }), bindings)).status, 415);
  assert.equal((await worker.fetch(put('x'.repeat(4097)), bindings)).status, 413);
  assert.equal((await worker.fetch(put('{'), bindings)).status, 400);
  assert.equal((await worker.fetch(put({ ...changed, email: 'forged@example.org' }), bindings)).status, 400);
  assert.equal((await worker.fetch(put(changed), bindings)).status, 200);
  assert.equal((await worker.fetch(put(changed), bindings)).status, 409);
  const log = await DB.prepare('SELECT * FROM v3_feature_settings_log').first();
  assert.equal(log.actor_email, claims.email); assert.equal(log.actor_subject, claims.sub);
  const publicWorker = (await import('../src/index.js')).default;
  const publicRead = await publicWorker.fetch(new Request('https://volunteer.example/api/feature-settings', { headers: { Origin: 'https://volunteer.example' } }), { DB });
  assert.equal(publicRead.status, 200); assert.doesNotMatch(await publicRead.text(), /manager@example|manager-id/);
  const volunteer = await publicWorker.fetch(new Request('https://volunteer.example/api/intro/2026010101', { method: 'PUT', headers: { Origin: 'https://volunteer.example', 'Cf-Access-Authenticated-User-Email': claims.email, 'Cf-Access-Jwt-Assertion': jwt } }), { DB });
  assert.equal(volunteer.status, 403, 'public host never trusts manager email or JWT to bypass');
  assert.equal((await worker.fetch(request('/api/manage/settings', undefined, { method: 'PUT', body: '{}' }), bindings)).status, 401);
});

test('#566 真實 Access 狗資料 API：權限、CSRF、白名單、版本、管理者不受志工開關限制',async t=>{
  t.mock.method(globalThis,'fetch',fetchKeys);
  const DB=memoryD1();t.after(()=>DB.close());
  await (await import('../../scripts/compact-schema.mjs')).createCompactDatabase(DB);
  const dogId='a'.repeat(32),jwt=await token(),bindings={...env,DB};
  await DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(dogId,'阿福').run();
  const path='/api/manage/dogs/'+dogId;
  const call=(body,headers={},auth=jwt)=>worker.fetch(request(path,auth,{method:'PUT',body:JSON.stringify(body),headers:{Origin:origin,'Content-Type':'application/json',...headers}}),bindings);
  let snapshot=await (await worker.fetch(request(path,jwt),bindings)).json();
  const input={revision:snapshot.revision,field:'sex',value:'female'};
  assert.equal((await call(input,{},null)).status,401);
  assert.equal((await call(input,{Origin:'https://other.example'})).status,403);
  assert.equal((await call(input,{'Content-Type':'text/plain'})).status,415);
  assert.equal((await call({...input,admin:true})).status,400);
  assert.equal((await call({...input,field:'number'})).status,400);
  assert.equal((await call(input)).status,200);
  assert.equal((await call(input)).status,409);
  const {readSettings,saveSettings}=await import('../src/feature-settings.js');
  const settings=await readSettings(DB);
  await saveSettings(DB,{...settings,values:{...settings.values,editIntro:false}},{subject:claims.sub,email:claims.email});
  snapshot=await (await worker.fetch(request(path,jwt),bindings)).json();
  assert.equal((await call({revision:snapshot.revision,field:'intro',value:'管理者仍可改'})).status,200);
  assert.equal((await worker.fetch(request('/api/manage/dogs/'+'f'.repeat(32),jwt),bindings)).status,404);
  const publicWorker=(await import('../src/index.js')).default;
  const forged=await publicWorker.fetch(new Request('https://volunteer.example/api/intro/2026010101',{method:'PUT',headers:{Origin:'https://volunteer.example','Content-Type':'application/json','Cf-Access-Jwt-Assertion':jwt},body:JSON.stringify({editor:'管理者',revision:snapshot.revision,text:'偽造'})}),{DB});
  assert.equal(forged.status,403);
  const oldSex=await publicWorker.fetch(new Request('https://volunteer.example/api/sex/2026010101',{method:'POST',headers:{Origin:'https://volunteer.example','Content-Type':'image/jpeg','X-Editor':'self'},body:new Uint8Array([255,216,255])}),{DB});
  assert.equal(oldSex.status,404,'未知路由不能繞過照片開關');
  const logs=await (await publicWorker.fetch(new Request('https://volunteer.example/api/edits',{headers:{Origin:'https://volunteer.example'}}),{DB})).json();
  assert.doesNotMatch(JSON.stringify(logs),/manager@example|manager-id/);
  assert.equal(logs.edits[0].source,'access');
});
