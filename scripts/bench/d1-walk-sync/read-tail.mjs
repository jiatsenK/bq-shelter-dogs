// Only publish selected diagnostic fields; never copy request headers or client metadata.
import { readFileSync, writeFileSync } from 'node:fs';
const events = [];
let buffer = '';
const prefix = process.argv[2] === 'cache' ? 'cache-tail' : 'tail';
for (const line of readFileSync(new URL(`./${prefix}-redacted.log`, import.meta.url), 'utf8').split(/\r?\n/)) {
  if (!buffer && line.trim() !== '{') continue;
  buffer += line + '\n';
  try { events.push(JSON.parse(buffer)); buffer = ''; } catch { /* incomplete streamed JSON */ }
}
const records = events.map(event => ({
  eventTimestamp: event.eventTimestamp, outcome: event.outcome,
  scriptVersion: event.scriptVersion, cpuTime: event.cpuTime, wallTime: event.wallTime,
  scheduledTime: event.event?.scheduledTime,
  diagnostics: (event.logs || []).flatMap(log => log.message.flatMap(message => {
    try { const data = JSON.parse(message); return data.kind ? [data] : []; } catch { return []; }
  }))
}));
writeFileSync(new URL(`./${prefix}-selected.jsonl`, import.meta.url), records.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify({ events: records.length, topLevelFields: events[0] ? Object.keys(events[0]) : [],
  kinds: [...new Set(records.flatMap(r => r.diagnostics.map(d => d.kind)))],
  outcomes: [...new Set(records.map(r => r.outcome))] }));
