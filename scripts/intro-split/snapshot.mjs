// 讀正式 D1 的介紹、編號、出入所紀錄、入所事件、離所紀錄（只送 SELECT）。核對表和 migration 產生器共用。
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { parseJsonOutput } from '../d1-database.mjs';

const DB = 'bq-shelter-dogs';
const QUERIES = {
  dogs: `SELECT d.dog_id, d.name, i.intro, (SELECT json_group_array(number) FROM v3_dog_numbers n WHERE n.dog_id=d.dog_id) numbers,
    (SELECT stays_json FROM v3_stays s WHERE s.dog_id=d.dog_id) stays, (SELECT number FROM v3_sheet_main m WHERE m.dog_id=d.dog_id) main_number
    FROM v3_dogs d LEFT JOIN v3_intros i USING(dog_id) ORDER BY d.dog_id`,
  departures: 'SELECT dog_id, number, name, departed_date, reason, last_intro FROM v3_dog_departures ORDER BY dog_id, number',
  events: 'SELECT dog_id, position, number, event_date, event FROM v3_intake_events ORDER BY dog_id, position',
};

// 只准 SELECT：這支腳本不寫正式資料
export function wranglerQuery(sql) {
  if (!/^\s*SELECT\b/i.test(sql) || /;\s*\S/.test(sql)) throw new Error('只准送一句 SELECT');
  const npx = process.platform === 'win32' ? [process.execPath, [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')]] : ['npx', []];
  const out = execFileSync(npx[0], [...npx[1], '--yes', 'wrangler@4.153.0', 'd1', 'execute', DB, '--remote', '--json', '--command', sql.replace(/\s+/g, ' ')],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return parseJsonOutput(out)[0].results;
}

// query(sql) → 列；回 { takenAt, dogs: [{ dogId, name, intro, numbers, stays, mainNumber, onMain, departures, events }] }
export function readSnapshot(query = wranglerQuery, now = new Date()) {
  const [dogs, departures, events] = [QUERIES.dogs, QUERIES.departures, QUERIES.events].map(q => query(q));
  return buildSnapshot({ dogs, departures, events }, now);
}

export function buildSnapshot({ dogs, departures, events }, now = new Date()) {
  const by = (list, id) => list.filter(r => r.dog_id === id);
  return {
    takenAt: now.toISOString(),
    dogs: dogs.map(d => ({
      dogId: d.dog_id,
      name: d.name,
      intro: d.intro ?? null,
      numbers: JSON.parse(d.numbers || '[]').sort(),
      stays: d.stays ?? null,
      mainNumber: d.main_number || '',
      onMain: Boolean(d.main_number || d.main_number === ''),
      departures: by(departures, d.dog_id).map(p => ({ number: p.number, name: p.name, date: p.departed_date || '', reason: p.reason, lastIntro: p.last_intro ?? null })),
      events: by(events, d.dog_id).map(e => ({ number: e.number, date: e.event_date, event: e.event })),
    })),
  };
}
