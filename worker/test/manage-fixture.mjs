// 測試呼叫管理網站 API（#769）：Cloudflare Access 的登入憑證在測試裡自己簽，管理網站 Worker 驗證時抓的公鑰也接到這裡。
// 用法：const manage = await manageApi(t, env)；await manage('/api/manage/data-checks') 回 { status, body }。
// 會用 t.mock 換掉 globalThis.fetch（只給管理網站抓 Access 公鑰），測試結束自動還原。
import worker from '../src/admin/index.js';

const origin = 'https://manage.example.org';
const issuer = 'https://shelter.cloudflareaccess.com';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

export async function manageApi(t, env) {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ keys: [jwk] }));
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: issuer, aud: ['admin-audience'], exp: now + 3600, iat: now - 10, nbf: now - 10, type: 'app', sub: 'manager-id', email: 'manager@example.org' };
  const data = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode(claims)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(data));
  const jwt = `${data}.${Buffer.from(signature).toString('base64url')}`;
  const bindings = { ...env, ADMIN_ORIGIN: origin, ACCESS_TEAM_DOMAIN: 'shelter.cloudflareaccess.com', ACCESS_AUD: 'admin-audience' };
  return async (path, { method = 'GET', body } = {}) => {
    const headers = { 'Cf-Access-Jwt-Assertion': jwt, ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) };
    const res = await worker.fetch(new Request(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), bindings);
    return { status: res.status, body: await res.json() };
  };
}
