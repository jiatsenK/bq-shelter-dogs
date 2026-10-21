// THROWAWAY #441: simulate lost background dispatch; only a real Cron may clear pending.
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const base = process.env.BENCH_WORKER_URL;
const key = process.env.BENCH_WRITE_KEY;
if (base !== 'https://bq-d1-walk-sync-441.jiatsen-k.workers.dev' || !key) throw new Error('Test Worker URL/key required');
const run = 'r' + randomBytes(8).toString('hex');
const walker = `BENCH441_${run}_deferred`;
async function call(path, input) {
  const response = await fetch(base + path, { method: input ? 'POST' : 'GET',
    headers: { 'X-Bench-Key': key, 'Content-Type': 'application/json' },
    body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  appendFileSync(new URL('./deferred-run.jsonl', import.meta.url), JSON.stringify({ at: new Date().toISOString(), run, path, status: response.status, result }) + '\n');
  if (!response.ok) throw new Error('Deferred scenario HTTP ' + response.status);
  return result;
}
await call('/walk', { run, walker, defer: true });
const duplicate = await call('/walk', { run, walker, defer: true });
if (duplicate.written !== 0) throw new Error('Idempotent insert unexpectedly wrote data');
const initial = await call('/walks?run=' + run);
if (initial.rows.length !== 1 || initial.rows[0].pending !== 1) throw new Error('Expected persisted pending row');
const start = performance.now();
while (performance.now() - start < 150000) {
  await sleep(5000);
  const result = await call('/walks?run=' + run);
  if (result.rows.length === 1 && result.rows[0].pending === 0) {
    console.log(JSON.stringify({ run, recoveredByCron: true, observedMs: performance.now() - start }));
    process.exit(0);
  }
}
throw new Error('Cron recovery was not observed in allotted window');
