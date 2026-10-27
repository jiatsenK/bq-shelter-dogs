import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { compactSchemaStatements, splitStatements } from './compact-schema.mjs';
import { MIGRATIONS_DIR, FILE_NAME, TARGETS, BACKUP_DB, BACKUP_DB_ID, migrationFiles, pendingMigrations, changesData, status, apply, backupDb, summary } from './d1-migrations.mjs';

// 表（欄位、外鍵、索引清單）、索引、觸發器、檢視，加上每張表的內容（預設列）。
// 表的 CHECK 只寫在建表 SQL 裡，ALTER 補欄後 SQL 文字會不同，所以表不比 SQL 文字；索引、觸發器比空白正規化後的 SQL
async function structure(db) {
  const all = async sql => (await db.prepare(sql).all()).results;
  const norm = sql => String(sql ?? '').replace(/\s+/g, ' ').replace(/ IF NOT EXISTS /i, ' ').trim();
  const out = {};
  for (const o of await all("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations' ORDER BY type, name")) {
    if (o.type !== 'table') { out[`${o.type} ${o.name}`] = { table: o.tbl_name, sql: norm(o.sql) }; continue; }
    out[`table ${o.name}`] = {
      columns: await all(`PRAGMA table_xinfo("${o.name}")`),
      foreignKeys: await all(`PRAGMA foreign_key_list("${o.name}")`),
      indexes: await all(`PRAGMA index_list("${o.name}")`),
      rows: await all(`SELECT * FROM "${o.name}" ORDER BY 1`),
    };
  }
  return out;
}

async function run(db, statements) {
  for (const sql of statements) await db.prepare(sql).run();
}

test('空庫照順序跑完全部 migration，結構跟 db/compact-schema.sql 建出來的一樣', async t => {
  const fromSchema = fakeD1(), fromMigrations = fakeD1();
  t.after(() => { fromSchema.close(); fromMigrations.close(); });
  await run(fromSchema, await compactSchemaStatements());
  for (const f of migrationFiles()) await run(fromMigrations, splitStatements(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')));
  const expected = await structure(fromSchema);
  assert.ok(Object.keys(expected).length > 100, '完整結構應該有上百個物件');
  assert.deepEqual(await structure(fromMigrations), expected);
});

// #559：搬資料的 SQL 要跟舊表逐一對得上（代號、狗名照原本順序；只有群名的欄、沒人遛的狗也對），搬的時候不讓 small 加 1
test('0005 從舊表組 JSON：代號、狗群、群名逐一對得上，small 不變', async t => {
  const db = fakeD1();
  t.after(() => db.close());
  const files = migrationFiles();
  const at = files.indexOf('0005_walkers_groups_json.sql');
  for (const f of files.slice(0, at)) await run(db, splitStatements(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')));
  await run(db, [
    "INSERT INTO v3_dogs(dog_id,name) VALUES('a','甲狗'),('b','乙狗'),('c','丙狗')",
    "INSERT INTO v3_sheet_main(row_index,dog_id,number,name) VALUES(0,'a','1','甲狗'),(1,'b','2','乙狗'),(5,'c','3','丙狗')",
    // 故意不照 position 順序寫入
    "INSERT INTO v3_sheet_main_walkers VALUES(5,1,'c2'),(0,0,'a0'),(5,0,'c1'),(5,2,'c3')",
    "INSERT INTO v3_sheet_groups VALUES(2,1,'丙狗'),(0,0,'甲狗'),(2,0,'乙狗'),(0,1,'丙狗')",
    "INSERT INTO v3_sheet_group_labels VALUES(0,'一群'),(7,'只有群名')",
  ]);
  const small = async () => (await db.prepare('SELECT small FROM v3_pack_versions WHERE id=1').first()).small;
  const before = await small();
  await run(db, splitStatements(readFileSync(join(MIGRATIONS_DIR, files[at]), 'utf8')));
  assert.deepEqual((await db.prepare('SELECT row_index,walker_codes FROM v3_sheet_main ORDER BY row_index').all()).results.map(r => [r.row_index, JSON.parse(r.walker_codes)]),
    [[0, ['a0']], [1, []], [5, ['c1', 'c2', 'c3']]]);
  assert.deepEqual((await db.prepare('SELECT column_index,label,names FROM v3_sheet_group_columns ORDER BY column_index').all()).results.map(r => [r.column_index, r.label, JSON.parse(r.names)]),
    [[0, '一群', ['甲狗', '丙狗']], [2, '', ['乙狗', '丙狗']], [7, '只有群名', []]]);
  assert.equal(await small(), before, '搬資料不讓在所資料包失效');
  await db.prepare("UPDATE v3_sheet_main SET walker_codes='[\"x\"]' WHERE row_index=1").run();
  assert.equal(await small(), before + 1, '之後改代號 small 加 1');
  await db.prepare("UPDATE v3_sheet_group_columns SET names='[]' WHERE column_index=7").run();
  assert.equal(await small(), before + 2, '改狗群 small 加 1');
});

// #672：加 source 欄，舊資料都在；只有「試算表（自動認回所）」的舊編號紀錄改成試算表，其他舊紀錄維持 NULL（顯示舊紀錄）
test('0010 修改紀錄加來源：舊資料都在，自動認回所的紀錄來源變試算表', async t => {
  const db = fakeD1();
  t.after(() => db.close());
  const files = migrationFiles();
  const at = files.indexOf('0010_edit_log_source.sql');
  for (const f of files.slice(0, at)) await run(db, splitStatements(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')));
  await run(db, [
    `INSERT INTO v3_edit_log(at,editor_name,kind,dog_id,dog_number,before_json,after_json) VALUES('2026-10-20T00:00:00.000Z','試算表（自動認回所）','former','a','2','{"number":"1"}','{"number":"2"}')`,
    `INSERT INTO v3_edit_log(at,editor_name,kind,dog_id,dog_number,before_json,after_json) VALUES('2026-10-21T00:00:00.000Z','管理者','former','a','2','[]','["3"]')`,
    `INSERT INTO v3_edit_log(at,editor_code,editor_name,kind,before_json,after_json) VALUES('2026-10-22T00:00:00.000Z','c1','甲','note','null','"備註"')`,
  ]);
  const before = (await db.prepare('SELECT * FROM v3_edit_log ORDER BY id').all()).results;
  await run(db, splitStatements(readFileSync(join(MIGRATIONS_DIR, files[at]), 'utf8')));
  const after = (await db.prepare('SELECT * FROM v3_edit_log ORDER BY id').all()).results;
  assert.deepEqual(after.map(({ source, ...rest }) => rest), before);
  assert.deepEqual(after.map(r => r.source), ['sheet', null, null]);
});

test('migration 檔名是 NNNN_小寫名稱.sql，從 0000 起連號不重複', () => {
  const files = migrationFiles();
  assert.equal(files[0], '0000_compact_schema.sql');
  files.forEach((f, i) => {
    assert.match(f, FILE_NAME);
    assert.equal(f.slice(0, 4), String(i).padStart(4, '0'), `${f} 要是第 ${i} 號`);
  });
});

test('changesData：刪資料、搬資料才要先備份；加表、加索引、觸發器裡的 UPDATE、預設列不用', () => {
  const yes = ['DROP TABLE v3_x;', 'DELETE FROM v3_packs WHERE part=1;', 'UPDATE v3_dogs SET a=1;', 'ALTER TABLE v3_x DROP COLUMN a;', 'ALTER TABLE v3_x RENAME TO v3_y;',
    'INSERT INTO v3_new(a) SELECT a FROM v3_old;', 'INSERT OR REPLACE INTO v3_x VALUES(1);', 'REPLACE INTO v3_x VALUES(1);'];
  const no = ['CREATE TABLE IF NOT EXISTS v3_x (a TEXT);', 'CREATE INDEX IF NOT EXISTS i ON v3_x(a);', 'ALTER TABLE v3_x ADD COLUMN b TEXT;',
    'INSERT OR IGNORE INTO v3_x VALUES(1);', 'DROP TRIGGER IF EXISTS t;', 'DROP INDEX IF EXISTS i;', '-- DELETE 只在註解\nCREATE TABLE v3_y (a TEXT);',
    'CREATE TRIGGER IF NOT EXISTS t AFTER INSERT ON v3_x BEGIN UPDATE v3_v SET n=n+1; DELETE FROM v3_z; END;'];
  for (const sql of yes) assert.equal(changesData(sql), true, sql);
  for (const sql of no) assert.equal(changesData(sql), false, sql);
});

test('pendingMigrations：照檔名順序列出沒套過的', () => {
  assert.deepEqual(pendingMigrations(['0000_a.sql', '0001_b.sql', '0002_c.sql'], ['0000_a.sql', '0002_c.sql']), ['0001_b.sql']);
});

// 假 wrangler：記下每次呼叫，d1 execute 依 SQL 回結果
function fakeWrangler({ applied = null, list = [], onApply = () => {} } = {}) {
  const calls = [];
  const json = results => JSON.stringify([{ results, success: true }]);
  const run = args => {
    calls.push(args);
    const [, cmd] = args;
    if (cmd === 'list') return JSON.stringify(list);
    if (cmd === 'time-travel') return JSON.stringify({ bookmark: 'bm-1' });
    if (cmd === 'migrations') { onApply(); return '套用完成'; }
    const sql = args[args.indexOf('--command') + 1];
    if (/sqlite_master/.test(sql)) return json(applied ? [{ name: 'd1_migrations' }] : []);
    if (/FROM d1_migrations/.test(sql)) return json((applied || []).map(name => ({ name })));
    throw new Error(`沒預期的呼叫：${args.join(' ')}`);
  };
  return { run, calls };
}

test('status：還沒有 d1_migrations 表就當一個都沒套，而且只送 SELECT', () => {
  const w = fakeWrangler();
  assert.deepEqual(status(TARGETS.production, { run: w.run, files: ['0000_a.sql'] }), { applied: [], pending: ['0000_a.sql'], unknown: [] });
  for (const args of w.calls) assert.match(args[args.indexOf('--command') + 1], /^SELECT /);
  assert.ok(w.calls.every(a => a.includes('bq-shelter-dogs') && a.includes('wrangler.jsonc')));
});

test('status：記著 repo 沒有的 migration 會列出來', () => {
  const w = fakeWrangler({ applied: ['0000_a.sql', '0001_gone.sql'] });
  assert.deepEqual(status(TARGETS.production, { run: w.run, files: ['0000_a.sql'] }).unknown, ['0001_gone.sql']);
});

function migrationsDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

const DBS = [{ name: 'bq-shelter-dogs', uuid: 'prod-id' }, { name: 'bq-shelter-dogs-test', uuid: 'test-id' }, { name: BACKUP_DB, uuid: BACKUP_DB_ID }];

test('apply：有刪資料的 migration 先複製到備用庫，再記書籤、套用', () => {
  const dir = migrationsDir({ '0000_a.sql': 'CREATE TABLE a (x);', '0001_b.sql': 'DELETE FROM a;' });
  const applied = ['0000_a.sql'];
  const calls = [], copies = [];
  const run = args => { calls.push(args); return fakeWrangler({ applied, list: DBS, onApply: () => applied.push('0001_b.sql') }).run(args); };
  const r = apply({ target: 'production', run, copy: c => { calls.push(['copy']); copies.push(c); }, dir, log: () => {} });
  assert.deepEqual(r.applied, ['0001_b.sql']);
  assert.equal(r.backedUp, true);
  assert.deepEqual(copies.map(c => [c.from.name, c.to.name]), [['bq-shelter-dogs', BACKUP_DB]]);
  assert.deepEqual(calls.map(a => a[0] === 'copy' ? 'copy' : a[1]).filter(c => ['copy', 'time-travel', 'migrations'].includes(c)), ['copy', 'time-travel', 'migrations']);
  assert.ok(calls.find(a => a[1] === 'migrations').includes('--remote'));
  assert.match(summary(r), /time-travel restore bq-shelter-dogs --bookmark=bm-1/);
});

test('apply：只加東西不備份；沒有要套的就不呼叫套用', () => {
  const dir = migrationsDir({ '0000_a.sql': 'CREATE TABLE a (x);', '0001_b.sql': 'CREATE INDEX i ON a(x);' });
  const applied = ['0000_a.sql'];
  const calls = [];
  const run = args => { calls.push(args); return fakeWrangler({ applied, list: DBS, onApply: () => applied.push('0001_b.sql') }).run(args); };
  const copies = [];
  const r = apply({ target: 'test', run, copy: c => copies.push(c), dir, log: () => {} });
  assert.equal(r.backedUp, false);
  assert.equal(copies.length, 0);
  assert.ok(calls.every(a => !a.includes('bq-shelter-dogs') || a.includes('bq-shelter-dogs-test')), '測試庫演練不碰正式庫');
  calls.length = 0;
  const again = apply({ target: 'test', run, copy: c => copies.push(c), dir, log: () => {} });
  assert.deepEqual(again.applied, []);
  assert.ok(!calls.some(a => a[1] === 'migrations' || a[1] === 'time-travel'));
});

test('apply：套用後還有沒套上的就失敗', () => {
  const dir = migrationsDir({ '0000_a.sql': 'CREATE TABLE a (x);' });
  const run = fakeWrangler({ list: DBS }).run;
  assert.throws(() => apply({ target: 'test', run, dir, log: () => {} }), /套用後還有沒套上的/);
});

test('backupDb：備用庫還沒建就停，提示 K 用 npx.cmd 建；不能是正式庫；ID 要跟 repo 記的一樣', () => {
  assert.throws(() => backupDb(DBS.slice(0, 2), { productionId: 'prod-id' }), /npx\.cmd wrangler d1 create bq-shelter-dogs-backup/);
  assert.throws(() => backupDb([{ name: BACKUP_DB, uuid: 'prod-id' }], { productionId: 'prod-id' }), /不能是正式庫/);
  const db = backupDb(DBS, { productionId: 'prod-id' });
  assert.throws(() => backupDb([{ name: BACKUP_DB, uuid: 'other-id' }], { productionId: 'prod-id' }), /跟 repo 記的/);
  assert.equal(JSON.parse(readFileSync(db.config, 'utf8')).d1_databases[0].database_id, BACKUP_DB_ID);
});
