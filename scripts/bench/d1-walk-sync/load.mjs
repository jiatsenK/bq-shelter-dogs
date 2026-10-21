// THROWAWAY #441: ten logical clients, three read rounds at minute intervals.
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { appendFileSync } from 'node:fs';
import { gvizTable } from '../../../worker/src/index.js';

const base = process.env.BENCH_WORKER_URL;
const key = process.env.BENCH_WRITE_KEY;
if (!base || !key) throw new Error('BENCH_WORKER_URL and BENCH_WRITE_KEY required');
const url = new URL(base);
if (url.protocol !== 'https:' || !url.hostname.startsWith('bq-d1-walk-sync-441.') || !url.hostname.endsWith('.workers.dev')) throw new Error('Refusing non-test Worker');
const run = 'r' + randomBytes(8).toString('hex');
const expected = Array.from({ length: 10 }, (_, i) => `BENCH441_${run}_client${i}`);
const records = new URL('./cloudflare-run.jsonl', import.meta.url);
function record(value) { appendFileSync(records, JSON.stringify(value) + '\n'); }
async function call(path, method = 'GET', data) {
  const start = performance.now();
  const response = await fetch(new URL(path, base), {
    method, headers: { 'X-Bench-Key': key, 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  record({ at: new Date().toISOString(), run, path, status: response.status,
    wallMs: performance.now() - start, result });
  if (!response.ok) throw new Error('Test Worker returned ' + response.status);
  return result;
}
const startAt = Date.now();
record({ at: new Date(startAt).toISOString(), run, scenario: 'ten-logical-clients-three-minute-read-rounds' });
const written = await Promise.allSettled(expected.map(walker => call('/walk', 'POST', { run, walker })));
if (written.some(r => r.status === 'rejected')) {
  record({ run, failed: true, stage: 'write', succeeded: written.filter(r => r.status === 'fulfilled').length });
  throw new Error('One or more writes uncertain; inspect run before retry');
}
for (let round = 0; round < 3; round++) {
  const wait = startAt + round * 60000 - Date.now();
  if (wait > 0) await sleep(wait);
  const read = await Promise.all(Array.from({ length: 10 }, () => call('/walks?run=' + run)));
  for (const result of read) {
    const actual = new Set(result.rows.map(row => row.walker));
    if (actual.size !== 10 || expected.some(w => !actual.has(w))) throw new Error('Concurrent union lost a client');
  }
  console.log(JSON.stringify({ run, round, readers: 10, namesPerReader: 10,
    pending: read.map(r => r.rows.filter(x => x.pending).length) }));
}
const final = await call('/walks?run=' + run);
const pending = final.rows.filter(x => x.pending).length;
if (pending) {
  record({ run, complete: false, d1UnionPassed: true, pending });
  throw new Error('Persisted writebacks remain pending; inspect Cron before retry');
}
let sheetUnionPassed = false;
const sheetUrl = new URL('https://docs.google.com/spreadsheets/d/1E2my7vuseiOwCK7EODr9AdJf8StW2fpit4CFkaY1d-4/gviz/tq');
sheetUrl.search = new URLSearchParams({ tqx: 'out:json', headers: '0', sheet: '主清單', tq: 'select B,E' });
for (let poll = 0; poll < 10; poll++) {
  const response = await fetch(sheetUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Sheet verification HTTP ' + response.status);
  const table = gvizTable(await response.text());
  const rows = table.rows.filter(r => String(r.c?.[0]?.v ?? '') === '2024010501');
  if (rows.length !== 1) throw new Error('Sheet dog identity mismatch');
  const actual = new Set(String(rows[0].c?.[1]?.v ?? '').split(/[、\s]+/));
  const matched = expected.filter(walker => actual.has(walker)).length;
  record({ run, stage: 'sheet-readback', poll, matched, expected: 10 });
  if (matched === 10) { sheetUnionPassed = true; break; }
  await sleep(2000);
}
if (!sheetUnionPassed) throw new Error('Sheet union not verified within polling window');
record({ run, complete: true, expected, pending: final.rows.filter(x => x.pending).length });
console.log(JSON.stringify({ run, complete: true, expectedCount: expected.length,
  pending, sheetUnionPassed }));
