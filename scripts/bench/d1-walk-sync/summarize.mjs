// Build a credential-free evidence artifact from this run's selected diagnostics.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const here = new URL('.', import.meta.url);
const readLines = file => readFileSync(new URL(file, here), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const version = '131bddfe-57d0-43aa-ac59-9c62e8c8d05d';
const tail = readLines('tail-selected.jsonl').filter(r => r.scriptVersion?.id === version);
const probe = readLines('probe-run.jsonl');
const load = readLines('cloudflare-run.jsonl');
const deferred = readLines('deferred-run.jsonl');
const cpu = kind => {
  const records = tail.filter(r => r.diagnostics.some(d => d.kind === kind));
  const values = records.map(r => r.cpuTime).sort((a, b) => a - b);
  return { capturedEvents: records.length, minMs: values[0], maxMs: values.at(-1),
    firstHandlerEvents: records.filter(r => r.diagnostics.some(d => d.kind === kind && d.invocation === 1)).length };
};
if (probe.length !== 20 || probe.some(r => r.status !== 200)) throw new Error('Expected 20 successful probes');
if (!load.some(r => r.complete) || load.some(r => r.failed)) throw new Error('Load did not complete');
if (!load.some(r => r.stage === 'sheet-readback' && r.matched === 10)) throw new Error('Sheet union not verified');
const recovery = tail.filter(r => r.diagnostics.some(d => d.kind === 'cron' && d.retried?.jobs === 1 && d.retried.failed === 0));
if (!recovery.length) throw new Error('Real Cron recovery evidence missing');
const codeSha256LF = Object.fromEntries(['worker.mjs', 'schema.sql', 'load.mjs', 'probe.mjs', 'deferred.mjs'].map(file => [file,
  createHash('sha256').update(readFileSync(new URL(file, here), 'utf8').replaceAll('\r\n', '\n')).digest('hex')]));
const summary = { version, disabledVersion: '56157f35-c4f7-4f3f-9dba-f7f1a29a681f',
  worker: 'bq-d1-walk-sync-441', testDatabaseId: '9e23a65c-c9dd-4f83-ad9c-2e01626910f0',
  codeSha256LF, notify: cpu('/notify'), walks: cpu('/walk'), reads: cpu('/walks'), cron: cpu('cron'),
  probeResponses: probe.length, loadComplete: true, realCronRecovery: true,
  limitations: ['Tail capture is incomplete; event counts are captured samples only.',
    'invocation=1 identifies first handler on an instrumented isolate, not guaranteed platform startup.',
    'Append-based test GAS and hashed snapshot comparison are not full replacement/reconciliation implementation.'] };
const evidence = { summary, probe, load, deferred, tail,
  graphql: JSON.parse(readFileSync(new URL('graphql-cpu.log', here), 'utf8')) };
writeFileSync(new URL('../../../docs/research/2026-10-21-d1-walk-sync-cloudflare-evidence.json', here), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(summary));
