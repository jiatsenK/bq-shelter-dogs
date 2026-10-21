// THROWAWAY #441. Writes one BENCH441 marker to a separately configured test sheet.
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { gvizTable } from '../../../worker/src/index.js';

if (process.argv.includes('--help')) {
  console.log('Required env: BENCH_SHEET_ID, BENCH_WRITE_URL, BENCH_WRITE_KEY, BENCH_DOG_ID, BENCH_DOG_NAME, BENCH_COLUMNS (id,name,date,walker column letters). See README.md.');
  process.exit(0);
}
const required = ['SHEET_ID', 'WRITE_URL', 'WRITE_KEY', 'DOG_ID', 'DOG_NAME', 'COLUMNS'];
const config = Object.fromEntries(required.map(name => {
  const value = process.env['BENCH_' + name]?.trim();
  if (!value) throw new Error('Missing BENCH_' + name);
  return [name, value];
}));
if (!/^[A-Za-z0-9_-]+$/.test(config.SHEET_ID)) throw new Error('Invalid test sheet ID');
const writeUrl = new URL(config.WRITE_URL);
if (writeUrl.origin !== 'https://script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(writeUrl.pathname) || writeUrl.search || writeUrl.hash) {
  throw new Error('Expected Apps Script /exec URL');
}
const columns = config.COLUMNS.split(',').map(x => x.trim());
if (columns.length !== 4 || new Set(columns).size !== 4 || columns.some(x => !/^[A-Z]+$/.test(x))) {
  throw new Error('BENCH_COLUMNS must be four distinct column letters: id,name,date,walker');
}
const marker = 'BENCH441_' + randomUUID().replaceAll('-', '_');
const attemptStartedAt = new Date().toISOString();
const attemptStart = performance.now();
let startedAt = null;
let phase = 'identity';
let postMs = null;
let polls = 0;
let lastAbsentResponseMs = null;
try {
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}
const identity = await (await request(writeUrl)).json();
if (!identity.ok || identity.prototype !== 'd1-walk-sync-441' || identity.sheetId !== config.SHEET_ID) {
  throw new Error('Refusing write: test deployment identity mismatch');
}
const readUrl = new URL(`https://docs.google.com/spreadsheets/d/${config.SHEET_ID}/gviz/tq`);
readUrl.search = new URLSearchParams({ tqx: 'out:json', headers: '0', sheet: '主清單', tq: 'select ' + columns.join(',') });
async function readDog() {
  const table = gvizTable(await (await request(readUrl)).text());
  if (table.cols?.length !== 4 || !Array.isArray(table.rows)) throw new Error('Unexpected gviz columns');
  const rows = table.rows.filter(row => String(row.c?.[0]?.v ?? '').trim() === config.DOG_ID);
  if (rows.length !== 1 || String(rows[0].c?.[1]?.v ?? '').trim() !== config.DOG_NAME) throw new Error('Test dog identity mismatch');
  return String(rows[0].c?.[3]?.v ?? '');
}
phase = 'baseline';
await readDog(); // Confirm gviz access and row mapping before any write.
startedAt = new Date().toISOString();
const start = performance.now();
phase = 'post';
const result = await (await request(writeUrl, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'walk', testSheetId: config.SHEET_ID, key: config.WRITE_KEY,
    walker: marker, dogs: [{ id: config.DOG_ID, name: config.DOG_NAME }] })
})).json();
postMs = performance.now() - start;
if (!result.ok || result.results?.length !== 1 || result.results[0].status !== 'written') throw new Error('Test write did not return written');
phase = 'poll';
while (performance.now() - start < 180000) {
  const observed = await readDog();
  const elapsedMs = performance.now() - start;
  polls++;
  if (observed.split(/[、,，\/／&＆+＋。｡．.;；:：|｜·・\s]+/).includes(marker)) {
    console.log(JSON.stringify({ prototype: 'd1-walk-sync-441', startedAt, marker, postMs,
      firstVisibleResponseMs: elapsedMs, lastAbsentResponseMs, polls, pollIntervalMs: 2000,
      metric: 'client response completion times from POST start, not server visibility bounds or Worker CPU' }));
    process.exit(0);
  }
  lastAbsentResponseMs = elapsedMs;
  await sleep(2000);
}
console.log(JSON.stringify({ prototype: 'd1-walk-sync-441', startedAt, marker, postMs,
  lastAbsentResponseMs, polls, timeout: true, metric: 'visibility not observed; not a latency upper bound' }));
process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ prototype: 'd1-walk-sync-441', attemptStartedAt,
    elapsedMs: performance.now() - attemptStart, startedAt, marker,
    phase, failed: true, errorType: error.name, postMs, polls, lastAbsentResponseMs,
    writeOutcome: phase === 'post' ? 'unknown: inspect marker in test sheet before retry' : phase === 'poll' ? 'confirmed' : 'not attempted' }));
  process.exitCode = 1;
}
