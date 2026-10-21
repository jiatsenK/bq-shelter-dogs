// THROWAWAY #441: real notification-comparison invocations; wallMs is not CPU.
import { appendFileSync } from 'node:fs';
const base = process.env.BENCH_WORKER_URL;
const key = process.env.BENCH_WRITE_KEY;
if (base !== 'https://bq-d1-walk-sync-441.<子網域>.workers.dev' || !key) throw new Error('Test Worker URL/key required');
for (let i = 0; i < 20; i++) {
  const start = performance.now();
  const at = new Date().toISOString();
  const response = await fetch(base + '/notify', { method: 'POST', headers: { 'X-Bench-Key': key }, signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  const record = { at, index: i, status: response.status, wallMs: performance.now() - start, result };
  appendFileSync(new URL('./probe-run.jsonl', import.meta.url), JSON.stringify(record) + '\n');
  console.log(JSON.stringify(record));
  if (!response.ok) { process.exitCode = 1; break; }
}
