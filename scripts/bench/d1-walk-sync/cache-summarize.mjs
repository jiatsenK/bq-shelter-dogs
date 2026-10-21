// Reproduce the cache/budget report from credential-free local measurement logs.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const here = new URL('.', import.meta.url);
const text = name => readFileSync(new URL(name, here), 'utf8');
const lines = name => text(name).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const run = lines('cache-run.jsonl');
const stages = run.filter(r => r.stage);
const required = ['minute-0', 'minute-1', 'minute-2', 'immediate-after-D1-write', 'sheet-clear', 'sheet-restore'];
if (required.some(stage => !stages.some(r => r.stage === stage && r.allCorrect && r.clients === 30))) throw new Error('Missing successful 30-client stage');
if (!stages.some(r => r.stage === 'load-complete' && r.pending === 0 && r.sheetMarkerPresent)) throw new Error('Unconfirmed writeback');
const cold = run.filter(r => r.path === '/cache/today?cold=1');
if (cold.length !== 30 || cold.some(r => r.status !== 200 || r.result.read !== 201 || r.result.cacheHit)) throw new Error('Cold scan evidence mismatch');
const version = 'f32a23ba-7a42-4ddb-b4b2-c39121240f36';
const tail = lines('cache-tail-selected.jsonl').filter(r => r.scriptVersion?.id === version);
const baseline = JSON.parse(text('account-baseline.log'));
if (baseline.response.errors) throw new Error('Account baseline unavailable');
const account = baseline.response.data.viewer.accounts[0];
const days = new Map(account.d1AnalyticsAdaptiveGroups.map(r => [r.dimensions.date,
  { utcDate: r.dimensions.date, rowsRead: r.sum.rowsRead, rowsWritten: r.sum.rowsWritten, requests: 0 }]));
for (const row of account.workersInvocationsAdaptive) {
  const day = days.get(row.dimensions.datetimeHour.slice(0, 10));
  if (!day) throw new Error('Missing baseline D1 day');
  day.requests += row.sum.requests;
}
const daily = [...days.values()].sort((a, b) => a.utcDate.localeCompare(b.utcDate));
const complete = daily.filter(r => r.utcDate < baseline.variables.lastDay);
const recent = complete.filter(r => r.utcDate >= '2026-10-17');
const stable = stages.filter(r => ['minute-1', 'minute-2'].includes(r.stage));
const dailyPolls = 30 * 15 * 60;
const stableMean = stable.reduce((n, r) => n + r.read, 0) / stable.reduce((n, r) => n + r.clients, 0);
const cpuRetry = JSON.parse(text('cache-graphql-retry.log'));
if (cpuRetry.response.errors) throw new Error('Final CPU query unavailable');
const cpuGroups = cpuRetry.response.data.viewer.accounts[0].workersInvocationsAdaptive;
const summary = { version, disabledVersion: '35dec6c5-ebff-4818-8a5d-bed442137144',
  importedSourceSha256LF: createHash('sha256').update(readFileSync(new URL('../../../worker/src/today.js', here), 'utf8').replaceAll('\r\n', '\n')).digest('hex'),
  fixtureDogs: 200, stages, hitRows: [...new Set(run.filter(r => r.result?.cacheHit).map(r => r.result.read))],
  missRows: [...new Set(run.filter(r => r.result?.cacheHit === false).map(r => r.result.read))],
  syntheticColdN: cold.length, capturedCpuEvents: tail.length,
  capturedCpuMinMs: Math.min(...tail.map(r => r.cpuTime)), capturedCpuMaxMs: Math.max(...tail.map(r => r.cpuTime)),
  capturedOutcomes: [...new Set(tail.map(r => r.outcome))],
  graphqlGroups: cpuGroups.length, graphqlRequests: cpuGroups.reduce((n, r) => n + r.sum.requests, 0),
  graphqlMaxGroupCpuP99Microseconds: Math.max(...cpuGroups.map(r => r.quantiles.cpuTimeP99)),
  projections: { assumptions: '30 clients, 15 hours/day; empirical short-run rates are not guarantees',
    dailyPolls, warmOnly: dailyPolls, sampleStableMeanRows: stableMean, sampleStableDailyRows: dailyPolls * stableMean,
    allMissDailyRows: dailyPolls * 201, comparisonOnlyDailyRows: 116 * 1440,
    hypotheticalPending200DailyRows: 200 * 1440,
    recentCompleteMaxRead: Math.max(...recent.map(r => r.rowsRead)),
    completeMaxRead: Math.max(...complete.map(r => r.rowsRead)),
    completeMaxWrite: Math.max(...complete.map(r => r.rowsWritten)),
    completeMaxRequests: Math.max(...complete.map(r => r.requests)) } };
const ddl = ['cache-schema-apply.log', 'cache-seed-result1.log', 'cache-seed-result2.log'].map(file => {
  const body = text(file); return { file, results: JSON.parse(body.slice(body.indexOf('['))) };
});
const sheetEvents = JSON.parse(text('cache-sheet-events.log'));
if (!sheetEvents.some(e => e.action === 'restore-readback' && e.sameValue && e.sameFormat)) throw new Error('Sheet restoration not verified');
const shutdown = JSON.parse(text('cache-shutdown.log'));
if (shutdown.authenticatedStatus !== 410 || shutdown.schedulesCount !== 0) throw new Error('Test service not shut down');
const evidence = { summary, daily, baselineTimeframe: baseline.variables, accountBaseline: baseline.response,
  clientRecords: run, tail, ddl, sheetEvents, shutdown,
  graphqlCpuAttempt: JSON.parse(text('cache-graphql.log')), graphqlCpuRetry: cpuRetry };
writeFileSync(new URL('../../../docs/research/2026-10-21-d1-walk-cache-evidence.json', here), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(summary));
