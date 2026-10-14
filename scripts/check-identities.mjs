// #216 本機演練：不連 Cloudflare、不寫試算表、不寫 repo 資料。
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateBusinessDatabase } from './migrate-business-db.mjs';
import { migrateIdentities } from './migrate-identities.mjs';
import { parseFrontmatterFormerIds } from './sync-sheet.mjs';

export async function readIdentitySources(root = new URL('../', import.meta.url)) {
  const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
  const current = await json('data/dogs.json');
  const cards = [];
  for (const file of (await readdir(new URL('dogs/', root))).filter(file => /^\d{8}[0-9A-Za-z]*\.md$/.test(file)).sort()) {
    const raw = await readFile(new URL(`dogs/${file}`, root), 'utf8');
    cards.push({ id: file.slice(0, -3), formerIds: parseFrontmatterFormerIds(raw), raw });
  }
  const sources = [];
  for (const file of (await readdir(new URL('data/history/', root))).filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort()) {
    sources.push({ source: `data/history/${file}`, rows: (await json(`data/history/${file}`)).dogs });
  }
  return { dogs: current.dogs, cards, sources };
}

export async function checkIdentities(input) {
  const db = fakeD1();
  try {
    await migrateBusinessDatabase(db);
    const first = await migrateIdentities(db, input);
    const second = await migrateIdentities(db, input);
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('重跑產生不同對應');
    const counts = {};
    for (const table of ['v2_dogs', 'v2_admissions', 'v2_admission_numbers', 'v2_source_bindings']) counts[table] = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n');
    const violations = (await db.prepare('PRAGMA foreign_key_check').all()).results;
    if (violations.length) throw new Error('存在外鍵錯誤');
    return { counts, replayIdentical: true, sources: first.mapping.length, pending: first.pending };
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await checkIdentities(await readIdentitySources()), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
