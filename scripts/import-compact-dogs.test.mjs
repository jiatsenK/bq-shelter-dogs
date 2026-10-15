import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { importCompactDogs, readCompactDogs, compareCompactDogs } from './import-compact-dogs.mjs';

async function setup(t) {
  const db = fakeD1(); t.after(() => db.close());
  await migrateCompactDatabase(db);
  return db;
}

test('再入所舊新編號共用永久狗 ID，有編號的同名狗不合併，無編號的狗以名字延續 ID', async t => {
  const db = await setup(t);
  const input = { dogs: [{ id: 'new', name: '圓仔', formerIds: ['old'] }, { id: 'other', name: '圓仔' }, { id: '', name: '金寶' }] };
  await importCompactDogs(db, input);
  const first = (await db.prepare('SELECT * FROM v3_dog_numbers ORDER BY number').all()).results;
  assert.equal(first.find(r => r.number === 'new').dog_id, first.find(r => r.number === 'old').dog_id);
  assert.notEqual(first.find(r => r.number === 'new').dog_id, first.find(r => r.number === 'other').dog_id);
  input.dogs.reverse();
  await importCompactDogs(db, input);
  assert.deepEqual((await db.prepare('SELECT * FROM v3_dog_numbers ORDER BY number').all()).results, first);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v3_dogs').first('COUNT(*)'), 3);
  assert.deepEqual((await compareCompactDogs(db, input)).equal, true);
});

test('真實 JSON 讀回完全一致，改一筆時指出狗編號和欄位', async t => {
  const db = await setup(t);
  const input = JSON.parse(await readFile(new URL('../data/dogs.json', import.meta.url), 'utf8'));
  await importCompactDogs(db, input);
  assert.deepEqual(await readCompactDogs(db), input.dogs);
  assert.deepEqual(await compareCompactDogs(db, input), { equal: true, differences: [] });
  await db.prepare("UPDATE v3_sheet_main SET cage='測試籠位' WHERE row_index=0").run();
  assert.deepEqual(await compareCompactDogs(db, input), {
    equal: false,
    differences: [{ key: input.dogs[0].id, field: 'cage', expected: input.dogs[0].cage, actual: '測試籠位' }],
  });
});

test('既有兩狗不可因新對照默默合併，格式錯誤在寫入前停止', async t => {
  const db = await setup(t);
  const input = { dogs: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }] };
  await importCompactDogs(db, input);
  await assert.rejects(importCompactDogs(db, { dogs: [{ id: 'b', name: '乙', formerIds: ['a'] }] }), /衝突/);
  for (const dogs of [[input.dogs[0], input.dogs[0]], [{ name: '' }], [{ name: '狗', walkers: '不合法' }], [{ name: '狗', newField: '不能默默丟掉' }]]) {
    await assert.rejects(importCompactDogs(db, { dogs }));
    assert.equal((await compareCompactDogs(db, input)).equal, true);
  }
});

test('整批匯入失敗時保留舊複本，重跑不變狗 ID', async t => {
  const db = await setup(t);
  const input = { dogs: [{ id: 'a', name: '甲', walkers: ['code'], formerIds: ['old'] }] };
  await importCompactDogs(db, input);
  const first = (await db.prepare('SELECT * FROM v3_dogs').all()).results;
  const batch = db.batch.bind(db);
  db.batch = statements => batch([...statements, db.prepare("INSERT INTO v3_dog_numbers VALUES('bad','missing')")]);
  await assert.rejects(importCompactDogs(db, { dogs: [{ id: 'b', name: '乙' }] }), /FOREIGN KEY/);
  db.batch = batch;
  assert.equal((await compareCompactDogs(db, input)).equal, true);
  await importCompactDogs(db, input);
  assert.deepEqual((await db.prepare('SELECT * FROM v3_dogs').all()).results, first);
});

test('比對抓出缺少、多出和排序差異', async t => {
  const db = await setup(t);
  const input = { dogs: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }] };
  await importCompactDogs(db, input);
  const reversed = await compareCompactDogs(db, { dogs: [...input.dogs].reverse() });
  assert.deepEqual(reversed.differences.map(d => d.field), ['order']);
  const missing = await compareCompactDogs(db, { dogs: [input.dogs[0], { id: 'c', name: '丙' }] });
  assert.deepEqual(missing.differences.map(d => [d.key, d.field]), [['c', '*'], ['b', '*'], ['*', 'order']]);
});
