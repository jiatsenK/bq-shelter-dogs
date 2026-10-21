// THROWAWAY #441. Diagnostic counters only; no application state in the isolate.
let isolateId;
let invocation = 0;
const SHEET_ID = '<試算表ID>';
const DOG_ID = '2024010501';
const SEP = /[、,，\/／&＆+＋。｡．.;；:：|｜·・\s]+/;
function active(env) {
  const expires = Number(env.EXPIRES_AT);
  return Number.isFinite(expires) && expires > 0 && Date.now() <= expires;
}

function meta(results) {
  return results.reduce((sum, r) => ({ read: sum.read + (r.meta?.rows_read || 0),
    written: sum.written + (r.meta?.rows_written || 0) }), { read: 0, written: 0 });
}
async function authorized(request, env) {
  const value = request.headers.get('X-Bench-Key');
  if (!env.BENCH_KEY || !value) return false;
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', bytes.encode(env.BENCH_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, bytes.encode(value));
  return crypto.subtle.verify('HMAC', key, signature, bytes.encode(env.BENCH_KEY));
}
async function sheetRows() {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
  url.search = new URLSearchParams({ tqx: 'out:json', headers: '7', sheet: '主清單', tq: 'select B,C,D,E' });
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('gviz HTTP ' + response.status);
  const text = await response.text();
  if (text.length > 262144) throw new Error('Test sheet response too large');
  const match = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) throw new Error('Bad gviz envelope');
  const data = JSON.parse(match[1]);
  if (data.status === 'error' || data.table?.cols?.length !== 4) throw new Error('Bad gviz table');
  return data.table.rows || [];
}
async function compareSheet(env) {
  const rows = await sheetRows();
  const have = await env.DB.prepare('SELECT dog, fingerprint FROM bench441_sheet_hashes').all();
  const old = new Map(have.results.map(r => [r.dog, r.fingerprint]));
  const queries = [];
  const seen = new Set();
  // Store only hashes, never copied volunteer names. CPU includes normalization/hash work.
  for (const row of rows) {
    const c = row.c || [];
    const id = String(c[0]?.v ?? '').trim();
    const name = String(c[1]?.v ?? '').trim();
    if (!name) continue;
    const dog = id || '名:' + name;
    if (seen.has(dog)) throw new Error('Duplicate dog key in test sheet');
    seen.add(dog);
    const walkers = [...new Set(String(c[3]?.v ?? '').split(SEP).filter(Boolean))].sort();
    const raw = JSON.stringify([c[2]?.v ?? '', walkers]);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
    const fingerprint = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
    if (old.get(dog) !== fingerprint) queries.push(env.DB.prepare(
      'INSERT INTO bench441_sheet_hashes(dog,fingerprint) VALUES(?,?) ON CONFLICT(dog) DO UPDATE SET fingerprint=excluded.fingerprint'
    ).bind(dog, fingerprint));
  }
  if (queries.length > 200) throw new Error('Prototype per-event write budget exceeded');
  const writes = [];
  for (let i = 0; i < queries.length; i += 40) writes.push(...await env.DB.batch(queries.slice(i, i + 40)));
  return { dogs: seen.size, changed: queries.length, ...meta([have, ...writes]) };
}
async function writeBack(env, row) {
  const response = await fetch(env.WRITE_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'walk', testSheetId: SHEET_ID, key: env.SHEET_WRITE_KEY,
      walker: row.walker, dogs: [{ id: DOG_ID, name: '宙斯' }] }), signal: AbortSignal.timeout(20000)
  });
  const result = await response.json();
  const status = result.results?.[0]?.status;
  if (!response.ok || !result.ok || !['written', 'already'].includes(status)) throw new Error('Test writeback rejected');
  return env.DB.prepare('UPDATE bench441_walkers SET pending=0 WHERE run=? AND dog=? AND walker=? AND pending=1')
    .bind(row.run, DOG_ID, row.walker).run();
}
async function retry(env) {
  const pending = await env.DB.prepare('SELECT run, walker FROM bench441_walkers WHERE pending=1 LIMIT 3').all();
  const writes = [];
  let failed = 0;
  for (const row of pending.results) {
    try { writes.push(await writeBack(env, row)); } catch { failed++; }
  }
  return { jobs: pending.results.length, failed, ...meta([pending, ...writes]) };
}
function eventInfo(kind) {
  isolateId ||= crypto.randomUUID();
  return { kind, isolateId, invocation: ++invocation, at: new Date().toISOString() };
}
export default {
  async fetch(request, env, ctx) {
    const info = eventInfo(new URL(request.url).pathname);
    if (!await authorized(request, env)) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (!active(env)) return Response.json({ error: 'prototype expired' }, { status: 410 });
    try {
      const path = info.kind;
      let result;
      if (path === '/notify' && request.method === 'POST') result = await compareSheet(env);
      else if (path === '/retry' && request.method === 'POST') result = await retry(env);
      else if (path === '/walk' && request.method === 'POST') {
        const body = await request.text();
        if (body.length > 1024) return Response.json({ error: 'too large' }, { status: 413 });
        const input = JSON.parse(body);
        if (!/^r[0-9a-f]{16}$/.test(input.run) || !/^BENCH441_[A-Za-z0-9_]{1,80}$/.test(input.walker)) {
          return Response.json({ error: 'invalid test input' }, { status: 400 });
        }
        const row = { run: input.run, walker: input.walker };
        const inserted = await env.DB.prepare('INSERT OR IGNORE INTO bench441_walkers(run,dog,walker,pending) VALUES(?,?,?,1)')
          .bind(input.run, DOG_ID, input.walker).run();
        // Deferred mode exercises persisted pending jobs without making a Google call.
        if (!input.defer) ctx.waitUntil(writeBack(env, row)
          .then(result => console.log(JSON.stringify({ kind: 'writeback-done', run: row.run,
            walker: row.walker, isolateId: info.isolateId, invocation: info.invocation, ...meta([result]) })))
          .catch(() => console.log(JSON.stringify({ kind: 'writeback-pending', run: row.run, walker: row.walker }))));
        result = { accepted: true, ...meta([inserted]) };
      } else if (path === '/walks' && request.method === 'GET') {
        const run = new URL(request.url).searchParams.get('run');
        if (!/^r[0-9a-f]{16}$/.test(run || '')) return Response.json({ error: 'invalid run' }, { status: 400 });
        const rows = await env.DB.prepare('SELECT walker,pending FROM bench441_walkers WHERE run=? AND dog=? ORDER BY walker').bind(run, DOG_ID).all();
        result = { rows: rows.results, ...meta([rows]) };
      } else return Response.json({ error: 'not found' }, { status: 404 });
      console.log(JSON.stringify({ ...info, ...result, rows: undefined }));
      return Response.json({ ...info, ...result }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      console.error(JSON.stringify({ ...info, error: error.message }));
      return Response.json({ ...info, error: 'prototype operation failed' }, { status: 500 });
    }
  },
  async scheduled(event, env, ctx) {
    if (!active(env)) return;
    const info = eventInfo('cron');
    ctx.waitUntil((async () => {
      const [comparison, retried] = await Promise.allSettled([compareSheet(env), retry(env)]);
      const show = result => result.status === 'fulfilled' ? result.value : { failed: true, error: result.reason?.message };
      console.log(JSON.stringify({ ...info, scheduledTime: event.scheduledTime,
        comparison: show(comparison), retried: show(retried) }));
    })());
  }
};
