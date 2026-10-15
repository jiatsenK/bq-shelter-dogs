// #249：只在記憶體 SQLite 演練。不連正式 D1，也沒有執行遠端 SQL 的路徑。
// node scripts/check-compact-legacy.mjs <legacy.json> <封存dogs.json> [--sql <.migration-private/...sql>]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { importCompactDogs } from './import-compact-dogs.mjs';
import { importCompactLegacy, compareCompactLegacy, readCompactLegacy, renderCompactLegacySql } from './import-compact-legacy.mjs';

export async function checkCompactLegacy({ dogs, legacy }) {
  const db = fakeD1();
  try {
    await migrateCompactDatabase(db);
    await importCompactDogs(db, dogs);
    const baseline = await readCompactLegacy(db);
    await importCompactLegacy(db, legacy);
    const first = await readCompactLegacy(db);
    const ids = (await db.prepare('SELECT * FROM v3_volunteers ORDER BY name').all()).results;
    const imported = await importCompactLegacy(db, legacy);
    const second = await readCompactLegacy(db);
    const report = await compareCompactLegacy(db, legacy, baseline);
    return {
      source: { cardOpened: legacy.cardOpened.length, walkerNames: legacy.walkerNames.length }, imported,
      counts: {
        v3_card_opened: await db.prepare('SELECT COUNT(*) AS n FROM v3_card_opened').first('n'),
        v3_volunteers: await db.prepare('SELECT COUNT(*) AS n FROM v3_volunteers').first('n'),
      },
      replayIdentical: isDeepStrictEqual(first, second) && isDeepStrictEqual(ids, (await db.prepare('SELECT * FROM v3_volunteers ORDER BY name').all()).results),
      foreignKeyErrors: (await db.prepare('PRAGMA foreign_key_check').all()).results.length,
      ...report,
    };
  } finally { db.close(); }
}

export async function writeCompactLegacySql(path, legacy) {
  const output = resolve(path);
  if (!dirname(output).split(sep).includes('.migration-private') || !output.endsWith('.sql')) throw new Error('SQL 必須放在 .migration-private/ 下的 .sql 檔，不可提交');
  const sql = renderCompactLegacySql(legacy);
  await mkdir(dirname(output), { recursive: true });
  // 不覆寫既有匯出／待審 SQL。再次演練請省略 --sql 或選新檔名。
  await writeFile(output, sql, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [input, dogsPath, flag, output, ...extra] = process.argv.slice(2);
    if (!input || !dogsPath || (flag !== undefined && (flag !== '--sql' || !output)) || extra.length) throw new Error('用法：node scripts/check-compact-legacy.mjs <legacy.json> [--sql <.migration-private/...sql>]');
    const legacy = JSON.parse(await readFile(input, 'utf8'));
    const dogs = JSON.parse(await readFile(dogsPath, 'utf8'));
    const report = await checkCompactLegacy({ dogs, legacy });
    if (!report.equal || !report.replayIdentical || report.foreignKeyErrors) process.exitCode = 1;
    else if (output) report.sqlOutput = await writeCompactLegacySql(output, legacy);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
