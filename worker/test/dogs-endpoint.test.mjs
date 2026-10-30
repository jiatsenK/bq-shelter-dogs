import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1, fakeR2 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';
import { readDogEdit } from '../src/dog-edit.js';

const dogId = 'a'.repeat(32);

// D1 每次讀取都先等 R2 開始列照片：一段等一段的話 R2 永遠等不到，請求卡住
function waitingFor(db, started) {
  const statement = s => ({
    bind: (...args) => statement(s.bind(...args)),
    run: async () => { await started; return s.run(); },
    all: async () => { await started; return s.all(); },
    first: async column => { await started; return s.first(column); },
    raw: async options => { await started; return s.raw(options); },
  });
  return { ...db, prepare: sql => statement(db.prepare(sql)), batch: async list => { await started; return db.batch(list); } };
}

test('/api/dogs 狗清單、今日溜狗、照片版本號同時讀（#788）', async t => {
  const db = fakeD1();
  t.after(() => db.close());
  await createCompactDatabase(db);
  await db.prepare('INSERT INTO v3_dogs(dog_id,name,sex) VALUES(?,?,?)').bind(dogId, '測試狗', 'male').run();
  await readDogEdit(db, dogId);
  await db.prepare('INSERT INTO v3_sheet_main(row_index,dog_id,number,name) VALUES(0,?,?,?)').bind(dogId, '2021010101', '測試狗').run();
  const PHOTOS = fakeR2();
  let listStarted;
  const started = new Promise(resolve => { listStarted = resolve; });
  const list = PHOTOS.list.bind(PHOTOS);
  PHOTOS.list = options => { listStarted(); return list(options); };
  const worker = (await import('../src/index.js')).default;
  worker.testing.resetState();
  const response = worker.fetch(new Request('https://example.org/api/dogs', { headers: { Origin: 'https://example.org' } }), { DB: waitingFor(db, started), PHOTOS });
  const stuck = new Promise(resolve => setTimeout(() => resolve('stuck'), 2000).unref());
  const result = await Promise.race([response, stuck]);
  assert.notEqual(result, 'stuck', '讀 D1 時 R2 還沒開始：三段沒有同時讀');
  const data = await result.json();
  assert.equal(result.status, 200);
  assert.equal(data.dogs[0].name, '測試狗');
});
