// Actual imported reader, 200 fake dog rows, 30 logical clients per minute.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { gvizTable } from '../../../worker/src/index.js';
const base = process.env.BENCH_WORKER_URL;
const key = process.env.BENCH_WRITE_KEY;
if (base !== 'https://bq-d1-walk-sync-441.jiatsen-k.workers.dev' || !key) throw new Error('Test URL/key required');
const here = new URL('.', import.meta.url);
const record = value => appendFileSync(new URL('cache-run.jsonl', here), JSON.stringify(value) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
async function call(path, body) {
  const start = performance.now();
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: { 'X-Bench-Key': key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  const { walks, ...stats } = result;
  record({ at: new Date().toISOString(), path, status: response.status, wallMs: performance.now() - start,
    result: stats, listHash: walks ? hash(JSON.stringify(walks)) : undefined,
    testWalkerHash: walks ? hash(walks.find(r => r.key === '2024010501')?.walker ?? '') : undefined });
  if (!response.ok) throw new Error('Cache scenario HTTP ' + response.status);
  return result;
}
function validate(result, expected) {
  if (result.walks?.length !== 200 || new Set(result.walks.map(r => r.key)).size !== 200) throw new Error('Incomplete today list');
  const dog = result.walks.find(row => row.key === '2024010501');
  const names = dog.walker.split('、').filter(Boolean).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected.slice().sort()) || dog.walked !== !!expected.length) throw new Error('Stale or overwritten test dog');
  for (const row of result.walks.filter(row => row.key !== '2024010501')) {
    const index = Number(row.key.slice('BENCH_DOG_'.length));
    if (!Number.isInteger(index) || index < 1 || index > 199 || row.walker !== `BENCH441_cache_seed_${index}` || !row.walked) throw new Error('Other dog changed');
  }
}
async function clients(stage, expected) {
  const results = await Promise.all(Array.from({ length: 30 }, () => call('/cache/today')));
  for (const result of results) validate(result, expected);
  const summary = { stage, clients: 30, allCorrect: true,
    hits: results.filter(r => r.cacheHit).length, misses: results.filter(r => !r.cacheHit).length,
    read: results.reduce((n, r) => n + r.read, 0), written: results.reduce((n, r) => n + r.written, 0) };
  record(summary); console.log(JSON.stringify(summary));
}
const mode = process.argv[2] || 'load';
if (mode === 'load') {
  await call('/cache/notify', {});
  const first = await call('/cache/today');
  let expected = first.walks.find(r => r.key === '2024010501').walker.split('、').filter(Boolean);
  validate(first, expected);
  const run = 'r' + randomBytes(8).toString('hex');
  const marker = 'BENCH441_' + run + '_cache';
  const start = Date.now();
  for (let round = 0; round < 3; round++) {
    if (round) await sleep(Math.max(0, start + round * 60000 - Date.now()));
    await clients('minute-' + round, expected);
    if (round === 0) {
      const at = new Date().toISOString();
      await call('/walk', { run, walker: marker, cacheExercise: true });
      expected = [...new Set([...expected, marker])];
      await clients('immediate-after-D1-write', expected);
      record({ appWriteAt: at, verifiedAt: new Date().toISOString(), run, marker });
    }
  }
  const pending = await call('/walks?run=' + run);
  if (pending.rows.length !== 1 || pending.rows[0].pending) throw new Error('Application writeback still pending');
  const sheet = new URL('https://docs.google.com/spreadsheets/d/1E2my7vuseiOwCK7EODr9AdJf8StW2fpit4CFkaY1d-4/gviz/tq');
  sheet.search = new URLSearchParams({ tqx: 'out:json', headers: '0', sheet: '主清單', tq: 'select B,E' });
  const response = await fetch(sheet);
  if (!response.ok) throw new Error('Sheet readback failed');
  const table = gvizTable(await response.text());
  const rows = table.rows.filter(r => String(r.c?.[0]?.v) === '2024010501');
  if (rows.length !== 1) throw new Error('Sheet dog not unique');
  const originalWalker = String(rows[0].c?.[1]?.v ?? '');
  if (!originalWalker.split('、').includes(marker)) throw new Error('Application marker missing from Sheet');
  writeFileSync(new URL('cache-session.generated.json', here), JSON.stringify({ run, marker, expected, originalWalker }));
  record({ stage: 'load-complete', run, allCorrect: true, pending: 0, sheetMarkerPresent: true });
  console.log(JSON.stringify({ stage: 'load-complete', run, allCorrect: true }));
} else if (mode === 'clear' || mode === 'restore') {
  const session = JSON.parse(readFileSync(new URL('cache-session.generated.json', here), 'utf8'));
  const expected = mode === 'clear' ? [] : session.originalWalker.split('、').filter(Boolean);
  let synced = false;
  for (let i = 0; i < 20; i++) {
    await call('/cache/notify', {});
    const result = await call('/cache/today');
    try { validate(result, expected); synced = true; break; } catch { await sleep(2000); }
  }
  if (!synced) throw new Error('Direct Sheet change not observed within polling window');
  await clients('sheet-' + mode, expected);
  record({ stage: 'sheet-' + mode + '-complete', allCorrect: true });
} else if (mode === 'cold') {
  for (let i = 0; i < 30; i++) {
    const result = await call('/cache/today?cold=1');
    if (result.cacheHit || result.count !== 200) throw new Error('Synthetic cold miss not exercised');
  }
  console.log(JSON.stringify({ stage: 'synthetic-cold-complete', count: 30 }));
} else throw new Error('Unknown scenario');
