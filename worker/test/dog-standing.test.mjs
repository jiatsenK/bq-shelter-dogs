// #802 狗的狀態 module：狀態與顯示編號的規則（ADR 0027）
import test from 'node:test';
import assert from 'node:assert/strict';
import { dogStatus, shownNumber } from '../src/dog-standing.js';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';

test('#802 狀態：在主清單優先，有離所紀錄是已出所，兩邊都沒有是待核對', () => {
  assert.equal(dogStatus({ onMain: true, hasDeparture: false }), 'main');
  assert.equal(dogStatus({ onMain: true, hasDeparture: true }), 'main');
  assert.equal(dogStatus({ onMain: false, hasDeparture: true }), 'departed');
  assert.equal(dogStatus({ onMain: false, hasDeparture: false }), 'unknown');
});

test('#802 顯示編號：主清單的優先，不在主清單取最大，沒有編號是 NULL', async t => {
  const db = fakeD1();
  t.after(() => db.close());
  await createCompactDatabase(db);
  const add = async (id, numbers, main = null) => {
    await db.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(id, id).run();
    for (const number of numbers) await db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(number, id).run();
    if (main !== null) await db.prepare('INSERT INTO v3_sheet_main(row_index,dog_id,number,name) VALUES((SELECT COUNT(*) FROM v3_sheet_main),?,?,?)').bind(id, main, id).run();
  };
  await add('main-newest', ['2020010101', '2024010101'], '2024010101');
  await add('main-older', ['2020010102', '2024010102'], '2020010102');
  await add('off-main', ['2020010103', '2024010103']);
  await add('no-number', []);
  await add('main-blank', ['2020010104'], '');
  const shown = async id => (await db.prepare(`SELECT ${shownNumber('?')} AS shown`).bind(id, id).first()).shown;
  assert.equal(await shown('main-newest'), '2024010101');
  assert.equal(await shown('main-older'), '2020010102');
  assert.equal(await shown('off-main'), '2024010103');
  assert.equal(await shown('no-number'), null);
  assert.equal(await shown('main-blank'), '2020010104');
});
