// #460 CPU 驗收用的獨立 Worker（wrangler.cpu-bench.jsonc）：只接測試 D1，量完就刪。
// POST /cpu-round 跑一輪 Cron 的溜狗工作（scanTick 保險掃描＋retryWalks 最多十隻派送）；資料由工作流程用 SQL 準備。
// 回呼 Worker（wrangler.cpu-bench-callback.jsonc）用同一份程式，只接 /api/walk-writeback/*，由服務綁定呼叫。
import worker from '../src/index.js';
import { retryWalks, scanTick } from '../src/walk-retry.js';
import { fakeSheet } from './fake-gas.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (env.BENCH_ROLE === 'callback') return url.pathname.startsWith('/api/walk-writeback/') ? worker.fetch(request, env, ctx) : new Response('not found', { status: 404 });
    if (url.pathname !== '/cpu-round') return new Response('not found', { status: 404 });
    if (request.method !== 'POST' || !env.BENCH_KEY || request.headers.get('X-Bench-Key') !== env.BENCH_KEY) return new Response('forbidden', { status: 403 });
    const real = globalThis.fetch;
    globalThis.fetch = fakeSheet(env, worker);
    try { await scanTick(env, Date.now()); await retryWalks(env, Date.now()); }
    finally { globalThis.fetch = real; }
    const { synced, waiting } = await env.DB.prepare("SELECT SUM(status='synced') AS synced, SUM(status IN ('pending','retry','unconfirmed','dispatching')) AS waiting FROM v3_walk_outbox WHERE dog_key LIKE 'CPU%'").first();
    return Response.json({ ok: true, synced, waiting });
  },
};
