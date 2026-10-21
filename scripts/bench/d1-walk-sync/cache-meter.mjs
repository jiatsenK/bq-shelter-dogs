// Import production reader unchanged; remap its two SELECTs to scratch tables.
import { AsyncLocalStorage } from 'node:async_hooks';
import { readTodayWalks, resetTodayCache } from '../../../worker/src/today.js';
const meters = new AsyncLocalStorage();
const adapters = new WeakMap();
export const CACHE_DATE = '2026-10-21';
export const CACHE_DOG = '2024010501';
function adapter(db) {
  if (adapters.has(db)) return adapters.get(db);
  const allowed = new Map([
    ['SELECT today FROM v3_data_versions WHERE id=1', 'SELECT today FROM bench441_cache_versions WHERE id=1'],
    ['SELECT dog_key,walked,walked_date,walker,updated_at FROM v3_today_walks WHERE walk_date=?',
      'SELECT dog_key,walked,walked_date,walker,updated_at FROM bench441_cache_today WHERE walk_date=?']
  ]);
  const value = { prepare(sql) {
    if (!allowed.has(sql)) throw new Error('Unexpected SQL in production today reader');
    const kind = sql.includes('v3_data_versions') ? 'version' : 'today-list';
    const wrap = statement => ({
      bind(...args) { return wrap(statement.bind(...args)); },
      async all() {
        const result = await statement.all();
        const meter = meters.getStore();
        if (!meter) throw new Error('Missing per-request meter');
        meter.read += result.meta.rows_read;
        meter.written += result.meta.rows_written;
        meter.queries.push({ kind, read: result.meta.rows_read, written: result.meta.rows_written });
        return result;
      },
      async first(column) { return (await this.all()).results[0]?.[column] ?? null; }
    });
    return wrap(db.prepare(allowed.get(sql)));
  } };
  adapters.set(db, value);
  return value;
}
export async function cacheRead(db, forceCold) {
  if (forceCold) resetTodayCache(); // Explicit synthetic miss, not a platform cold-start claim.
  const meter = { read: 0, written: 0, queries: [] };
  return meters.run(meter, async () => {
    const walks = await readTodayWalks(adapter(db), CACHE_DATE);
    return { walks, ...meter, cacheHit: meter.queries.length === 1, count: walks.length };
  });
}
export function cacheAppend(db, marker) {
  return db.prepare(`UPDATE bench441_cache_today SET walker=CASE WHEN walker='' THEN ? ELSE walker||'、'||? END,
    walked=1, walked_date=?, updated_at=? WHERE walk_date=? AND dog_key=? AND instr('、'||walker||'、','、'||?||'、')=0`)
    .bind(marker, marker, CACHE_DATE, new Date().toISOString(), CACHE_DATE, CACHE_DOG, marker);
}
export async function cacheSheetProjection(db, rows) {
  const matches = rows.filter(row => String(row.c?.[0]?.v ?? '').trim() === CACHE_DOG);
  if (matches.length !== 1) throw new Error('Expected unique test dog');
  const cell = matches[0].c || [];
  const walker = String(cell[3]?.v ?? '').trim();
  if (walker && !walker.split(/[、\s]+/).every(name => /^BENCH441_[A-Za-z0-9_]+$/.test(name))) {
    throw new Error('Only BENCH441 names may be projected to cache scratch data');
  }
  // Exercise invalidation after a direct Sheet edit. Not production reconciliation.
  return db.prepare(`UPDATE bench441_cache_today SET walker=?, walked=?, walked_date=?, updated_at=?
    WHERE walk_date=? AND dog_key=? AND walker<>?`).bind(walker, walker ? 1 : 0, walker ? CACHE_DATE : '',
      new Date().toISOString(), CACHE_DATE, CACHE_DOG, walker).run();
}
