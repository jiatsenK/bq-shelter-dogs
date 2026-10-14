// #217 本機完整歷史演練；已出所來源由 CLI 提供暫存檔，不進 repo。
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateBusinessDatabase } from './migrate-business-db.mjs';
import { migrateIdentities } from './migrate-identities.mjs';
import { readIdentitySources } from './check-identities.mjs';
import { migrateHistory } from './migrate-history.mjs';

export async function readHistorySources(departedPath, root = new URL('../', import.meta.url)) {
  const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
  const identities = await readIdentitySources(root);
  const snapshots = [];
  for (const source of identities.sources) {
    const data = await json(source.source);
    snapshots.push({ source: source.source, date: source.source.match(/\d{4}-\d{2}-\d{2}/)[0], syncedAt: data.syncedAt, dogs: data.dogs });
  }
  const sheet = departedPath ? JSON.parse(await readFile(departedPath, 'utf8')) : { rows: [] };
  return { identities, reviewedTen: (await json('docs/migration-213/daily-walk-review.json')).checks, history: { snapshots, walks: (await json('data/walks.json')).walks, departures: (await json('data/departures.json')).departures, departedSheet: sheet.rows, asOf: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) } };
}

export async function checkHistory(input) {
  const db = fakeD1();
  try {
    await migrateBusinessDatabase(db); await migrateIdentities(db, input.identities);
    const first = await migrateHistory(db, input.history), second = await migrateHistory(db, input.history);
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('重跑歷史遷移結果不一致');
    const expected = input.history.walks.length + input.history.snapshots.reduce((n, s) => n + s.dogs.length + 1, 0) + input.history.departedSheet.length + input.history.departures.length;
    if (second.counts.sources !== expected) throw new Error('來源筆數不平衡');
    if ((await db.prepare('PRAGMA foreign_key_check').all()).results.length) throw new Error('外鍵檢核失敗');
    const reasons = (await db.prepare("SELECT source_kind,reason,COUNT(*) AS n FROM v2_history_sources WHERE state='pending' GROUP BY source_kind,reason").all()).results;
    const departures = (await db.prepare("SELECT COUNT(*) AS n FROM v2_admissions WHERE status='departed'").first()).n;
    const walkSources = (await db.prepare("SELECT state,reason,raw_json FROM v2_history_sources WHERE source_kind='walk'").all()).results.map(r => ({ ...r, row: JSON.parse(r.raw_json) }));
    const reviewedTen = (input.reviewedTen || []).map(item => {
      const source = walkSources.find(s => s.row.id === item.id && s.row.date === item.date);
      if (!source) throw new Error(`十筆差異來源遺失：${item.id} / ${item.date}`);
      return { id: item.id, date: item.date, state: source.state, reason: source.reason };
    });
    return { counts: second.counts, departures, replayIdentical: true, sourceBalance: expected, pendingReasons: reasons, reviewedTen };
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await checkHistory(await readHistorySources(process.argv[2])), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
