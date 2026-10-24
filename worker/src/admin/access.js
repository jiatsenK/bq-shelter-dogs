// Access policy selects managers; the origin independently validates the signed application token.
const decoder = new TextDecoder();
const encoder = new TextEncoder();
class AccessError extends Error {
  constructor(status) { super('管理存取遭拒'); this.status = status; }
}
const deny = status => { throw new AccessError(status); };
function decode(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) deny(401);
  return Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
function settings(env) {
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN || '') || !env.ACCESS_AUD?.trim()) deny(503);
  let origin;
  try { origin = new URL(env.ADMIN_ORIGIN); } catch { deny(503); }
  if (origin.protocol !== 'https:' || origin.origin !== env.ADMIN_ORIGIN || origin.username || origin.password) deny(503);
  return { origin: origin.origin, issuer: `https://${env.ACCESS_TEAM_DOMAIN}`, audience: env.ACCESS_AUD };
}
export function createAccessVerifier({ fetchKeys = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const cache = new Map();
  async function signingKeys(issuer) {
    const hit = cache.get(issuer);
    if (hit && hit.until > now()) return hit.pending;
    if (cache.size >= 8) cache.delete(cache.keys().next().value);
    const entry = { until: now() + 300000 };
    entry.pending = (async () => {
      const res = await fetchKeys(`${issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!res.ok) deny(503);
      const body = await res.json();
      if (!Array.isArray(body.keys) || !body.keys.length) deny(503);
      return body.keys;
    })();
    cache.set(issuer, entry);
    try { return await entry.pending; } catch { if (cache.get(issuer) === entry) cache.delete(issuer); deny(503); }
  }
  return async function verifyAccess(request, env) {
    const config = settings(env);
    if (new URL(request.url).origin !== config.origin) deny(403);
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!jwt || jwt.length > 16384) deny(401);
    try {
      const parts = jwt.split('.');
      if (parts.length !== 3) deny(401);
      const header = JSON.parse(decoder.decode(decode(parts[0])));
      const claims = JSON.parse(decoder.decode(decode(parts[1])));
      const seconds = now() / 1000;
      if (header.alg !== 'RS256' || typeof header.kid !== 'string') deny(401);
      if (claims.iss !== config.issuer || !Array.isArray(claims.aud) || !claims.aud.includes(config.audience)) deny(401);
      if (!Number.isFinite(claims.exp) || claims.exp <= seconds || !Number.isFinite(claims.iat) || claims.iat > seconds) deny(401);
      if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > seconds)) deny(401);
      if (claims.type !== 'app' || typeof claims.email !== 'string' || !claims.email.trim() || typeof claims.sub !== 'string' || !claims.sub) deny(401);
      const keys = await signingKeys(config.issuer);
      const jwk = keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
      if (!jwk) deny(401);
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`))) deny(401);
      return { subject: claims.sub, email: claims.email };
    } catch (error) { if (error instanceof AccessError) throw error; deny(401); }
  };
}
