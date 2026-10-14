import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { captureDatabase, restoreDatabase, verifyDatabase, archiveSql, verifySqlExport } from './rehearse-d1.mjs';

test('封存還原保留外鍵、原文及永久 ID，重跑不增加資料', async () => {
  const source = fakeD1(), restored = fakeD1();
  try {
    await source.prepare('CREATE TABLE v2_parent(id TEXT PRIMARY KEY,body TEXT)').run();
    await source.prepare('CREATE TABLE v2_child(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES v2_parent(id))').run();
    await source.prepare('INSERT INTO v2_parent VALUES(?,?)').bind('fixed-id', "原文; '引號'\n下一行").run();
    await source.prepare('INSERT INTO v2_child VALUES(?,?)').bind('child', 'fixed-id').run();
    const archive = await captureDatabase(source);
    await restoreDatabase(restored, archive);
    await restoreDatabase(restored, archive);
    assert.deepEqual(await verifyDatabase(restored, archive), { tables: 2, rows: 2, identical: true });
    const sqlDb = new DatabaseSync(':memory:');
    try {
      sqlDb.exec(archiveSql(archive));
      assert.equal(sqlDb.prepare('SELECT body FROM v2_parent').get().body, "原文; '引號'\n下一行");
    } finally { sqlDb.close(); }
  } finally { source.close(); restored.close(); }
});

test('D1 交錯建表與資料的匯出可核對，缺少父列仍被外鍵檢核攔下', async () => {
  const source = fakeD1();
  try {
    await source.prepare('CREATE TABLE v2_parent(id TEXT PRIMARY KEY)').run();
    await source.prepare('CREATE TABLE v2_child(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES v2_parent(id))').run();
    await source.prepare("INSERT INTO v2_parent VALUES('parent')").run();
    await source.prepare("INSERT INTO v2_child VALUES('child','parent')").run();
    const archive = await captureDatabase(source);
    const sql = "CREATE TABLE v2_child(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES v2_parent(id)); INSERT INTO v2_child VALUES('child','parent'); CREATE TABLE v2_parent(id TEXT PRIMARY KEY); INSERT INTO v2_parent VALUES('parent');";
    assert.equal((await verifySqlExport(archive, sql)).identical, true);
    await assert.rejects(verifySqlExport(archive, sql.replace("INSERT INTO v2_parent VALUES('parent');", '')), /外鍵/);
  } finally { source.close(); }
});

test('封存被修改或目標同 ID 原文不同時拒絕核對', async () => {
  const source = fakeD1(), target = fakeD1();
  try {
    await source.prepare('CREATE TABLE v2_parent(id TEXT PRIMARY KEY,body TEXT)').run();
    await source.prepare('INSERT INTO v2_parent VALUES(?,?)').bind('fixed', 'original').run();
    const archive = await captureDatabase(source), changed = structuredClone(archive);
    changed.tables.v2_parent[0].body = 'tampered';
    await assert.rejects(restoreDatabase(target, changed), /指紋不符/);
    await restoreDatabase(target, archive);
    await target.prepare('UPDATE v2_parent SET body=?').bind('different').run();
    await assert.rejects(restoreDatabase(target, archive), /逐表逐筆/);
  } finally { source.close(); target.close(); }
});
