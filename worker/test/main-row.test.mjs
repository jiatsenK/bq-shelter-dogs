// #803 主清單列認狗：試算表這一列是哪隻狗，規則的先後一次看完。只判斷，不寫資料；寫入由 dog-list.js 照判斷結果做。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { identifyRow } from '../src/main-row.js';
import { fakeD1 } from './fakes.mjs';
import { createCompactDatabase } from '../../scripts/compact-schema.mjs';

// 主清單複本的一列
const main = (dog_id, number, name, cage = 'Z9', note = '') => ({ row_index: Number(dog_id.slice(1)), dog_id, number, name, cage, note, revision: 1 });
const key = m => `main:${m.number || `名:${m.name}`}`;
// 這次請求的自動合併狀態（見 syncDogList）。present 預設表上有全部的 list
const mergeOf = (list, extra = {}) => ({ present: new Set(list.map(key)), departing: new Set(), done: false, waiting: new Set(), ...extra });

async function database(t) {
  const db = fakeD1();
  t.after(() => db.close());
  await createCompactDatabase(db);
  const dog = (id, name) => db.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(id, name).run();
  const number = (n, id) => db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(n, id).run();
  return {
    db,
    dog,
    number,
    known: async (id, name, n) => { await dog(id, name); await number(n, id); },
    walked: async (id, name, n = '') => {
      await dog(id, name);
      await db.prepare('INSERT INTO v3_walks(dog_id,walk_date,dog_number,dog_name) VALUES(?,?,?,?)').bind(id, '2026-10-01', n, name).run();
    },
    departed: async (id, name, n) => {
      await dog(id, name);
      await db.prepare('INSERT INTO v3_dog_departures(dog_id,number,name) VALUES(?,?,?)').bind(id, n, name).run();
    },
  };
}
const row = (id, name, cage = 'A01', note = '') => ({ dog: { id, name }, cage, note });
const identify = (db, r, list = [], stays = [], merge = mergeOf(list)) => identifyRow(db, r, { list, stays, merge });

test('#803 不是狗的列：沒犬名、沒籠位、表頭', async t => {
  const { db } = await database(t);
  for (const r of [row('', ''), row('9001', '小白', ''), row('', '犬名')]) assert.deepEqual(await identify(db, r), { kind: 'skip' });
});

test('#803 暫住：已有暫住紀錄的列照舊是暫住，那隻狗離開主清單也是', async t => {
  const { db } = await database(t);
  const stay = { name: '(皮蛋)', dog_id: 'd1', cage: 'A01', note: '', missing_at: null };
  assert.deepEqual(await identify(db, row('', '(皮蛋)'), [], [stay]), { kind: 'stay', target: null, dropLegacy: null });
});

test('#803 暫住：暫住紀錄和舊暫住列都有，舊列要移出主清單複本', async t => {
  const { db } = await database(t);
  const stay = { name: '(皮蛋)', dog_id: 'd1', cage: 'A01', note: '', missing_at: null };
  const legacy = main('d2', '', '(皮蛋)');
  assert.deepEqual(await identify(db, row('', '(皮蛋)'), [legacy], [stay]), { kind: 'stay', target: null, dropLegacy: legacy });
});

test('#803 暫住：沒編號、括號裡去掉空白跟主清單有編號的狗同名，半形全形混用都算', async t => {
  const { db } = await database(t);
  const pidan = main('d1', '9001', '皮 蛋');
  for (const name of ['(皮蛋)', '（皮蛋）', '(皮蛋）', '( 皮 蛋 )']) {
    assert.deepEqual(await identify(db, row('', name), [pidan]), { kind: 'stay', target: pidan, dropLegacy: null }, name);
  }
});

test('#803 暫住不成立：有編號、括號裡的狗沒編號或不在主清單，都不是暫住', async t => {
  const { db } = await database(t);
  const pidan = main('d1', '9001', '皮蛋'), nameless = main('d2', '', '乳白');
  assert.equal((await identify(db, row('9100', '(皮蛋)'), [pidan])).kind, 'new');
  assert.equal((await identify(db, row('', '(乳白)'), [nameless])).kind, 'new');
  assert.equal((await identify(db, row('', '(路過)'), [pidan])).kind, 'new');
});

test('#803 暫住不成立：上線轉換前建成狗、還在複本上的舊暫住列，照一般列', async t => {
  const { db } = await database(t);
  const pidan = main('d1', '9001', '皮蛋'), legacy = main('d2', '', '(皮蛋)');
  assert.deepEqual(await identify(db, row('', '(皮蛋)'), [pidan, legacy]), { kind: 'listed', row: legacy, fillNumber: false, numberOwned: false });
});

test('#803 搬籠清舊列：同名同備註、有編號那隻還在表上，先不收', async t => {
  const { db } = await database(t);
  const pidan = main('d1', '9001', '皮蛋', 'A08', '怕生');
  assert.deepEqual(await identify(db, row('', '皮蛋', 'A13', '怕生'), [pidan]), { kind: 'held' });
  // 備註空白、備註不同、有編號那隻不在表上：都不是搬籠中間狀態
  const blank = main('d2', '9002', '小白', 'A08', '');
  assert.equal((await identify(db, row('', '小白', 'A13', ''), [blank])).kind, 'new');
  assert.equal((await identify(db, row('', '皮蛋', 'A13', '親人'), [pidan])).kind, 'new');
  assert.equal((await identify(db, row('', '皮蛋', 'A13', '怕生'), [pidan], [], mergeOf([]))).kind, 'new');
});

test('#803 主清單已有：有編號照編號，沒編號照名字', async t => {
  const { db } = await database(t);
  const white = main('d1', '9001', '小白'), fu = main('d2', '', '阿福');
  assert.deepEqual(await identify(db, row('9001', '改名了'), [white, fu]), { kind: 'listed', row: white, fillNumber: false, numberOwned: false });
  assert.deepEqual(await identify(db, row('', '阿福'), [white, fu]), { kind: 'listed', row: fu, fillNumber: false, numberOwned: false });
});

test('#803 補編號：主清單同名沒編號的那隻就是牠', async t => {
  const { db, known, number, dog } = await database(t);
  const fu = main('d1', '', '阿福');
  assert.deepEqual(await identify(db, row('9100', '阿福'), [fu]), { kind: 'listed', row: fu, fillNumber: true, numberOwned: false }, '編號還沒人用');
  await dog('d1', '阿福');
  await number('9100', 'd1');
  assert.deepEqual(await identify(db, row('9100', '阿福'), [fu]), { kind: 'listed', row: fu, fillNumber: true, numberOwned: true }, '編號已經是這隻的，不再記一次');
  // 編號是別隻的：不補在同名這隻身上，照編號認另一隻
  const other = main('d2', '', '小黑');
  await known('d3', '小黑舊', '9200');
  const found = await identify(db, row('9200', '小黑'), [other]);
  assert.equal(found.kind, 'known');
  assert.equal(found.dog.dog_id, 'd3');
});

test('#803 認得的狗：照編號，或沒編號照溜狗紀錄的名字；括號暫用名不找回舊狗', async t => {
  const { db, known, walked } = await database(t);
  await known('d1', '小白', '9001');
  const byNumber = await identify(db, row('9001', '小白'));
  assert.deepEqual([byNumber.kind, byNumber.dog.dog_id, byNumber.dog.revision], ['known', 'd1', 1]);
  await walked('d2', '阿福');
  await walked('d3', '(乳白)');
  const byWalk = await identify(db, row('', '阿福'));
  assert.deepEqual([byWalk.kind, byWalk.dog.dog_id], ['known', 'd2']);
  assert.equal((await identify(db, row('', '(乳白)'))).kind, 'new');
});

test('#803 回所：離所紀錄剛好一筆同名，主清單上沒別的同名；同名多筆或主清單有同名不猜', async t => {
  const { db, departed } = await database(t);
  await departed('d1', '小白', '8001');
  const back = await identify(db, row('9001', '小白'));
  assert.deepEqual([back.kind, back.dog.dog_id, back.dog.number], ['returned', 'd1', '8001']);
  assert.equal((await identify(db, row('', '小白'))).kind, 'new', '沒編號的列不認回所');
  assert.equal((await identify(db, row('9001', '小白'), [main('d9', '9009', '小白')])).kind, 'new', '主清單有同名');
  await departed('d2', '小白', '8002');
  assert.equal((await identify(db, row('9001', '小白'))).kind, 'new', '同名多筆');
});

test('#803 新狗：同籠剛好一個不在表上的列才是候選', async t => {
  const { db } = await database(t);
  const gone = main('d1', '9001', '舊狗', 'A01'), gone2 = main('d2', '9002', '舊狗二', 'A01'), elsewhere = main('d3', '9003', '別籠', 'B01');
  const stayLike = main('d4', '', '(別籠)', 'A01');
  const none = { present: new Set(['main:其他']), departing: new Set(), done: false, waiting: new Set() };
  assert.deepEqual(await identify(db, row('9100', '新狗'), [gone, elsewhere], [], none), { kind: 'new', candidate: gone });
  assert.deepEqual(await identify(db, row('9100', '新狗'), [gone, gone2], [], none), { kind: 'new', candidate: null }, '超過一隻不猜');
  assert.deepEqual(await identify(db, row('9100', '新狗'), [elsewhere], [], none), { kind: 'new', candidate: null }, '籠位不同');
  assert.deepEqual(await identify(db, row('9100', '新狗'), [gone, elsewhere], [], mergeOf([gone, elsewhere])), { kind: 'new', candidate: null }, '還在表上');
  assert.deepEqual(await identify(db, row('9100', '新狗'), [gone], [], { ...none, present: null }), { kind: 'new', candidate: null }, '沒有 present 不找');
  assert.deepEqual(await identify(db, row('9100', '新狗'), [gone], [], { ...none, departing: new Set(['9001']) }), { kind: 'new', candidate: null }, '這次一起送來已出所');
  assert.deepEqual(await identify(db, row('9100', '新狗'), [elsewhere, stayLike], [], none), { kind: 'new', candidate: null }, '舊暫住列不算候選');
});

test('#803 新狗：這次已經自動合併過一隻，第二隻等下一次', async t => {
  const { db } = await database(t);
  const gone = main('d1', '9001', '舊狗', 'A01');
  const merge = { present: new Set(['main:其他']), departing: new Set(), done: true, waiting: new Set() };
  assert.deepEqual(await identify(db, row('9100', '新狗'), [gone], [], merge), { kind: 'wait', candidate: gone });
  assert.deepEqual([...merge.waiting], [], '只判斷，狀態由呼叫端改');
});

test('#803 規則的先後', async t => {
  const { db, known, departed, walked } = await database(t);
  // 主清單已有，優先於編號查表
  const white = main('d1', '9001', '小白');
  await known('d2', '另一隻', '9001');
  assert.equal((await identify(db, row('9001', '小白'), [white])).row, white);
  // 編號認得，優先於回所
  await known('d3', '小黑', '9003');
  await departed('d4', '小黑', '8004');
  assert.equal((await identify(db, row('9003', '小黑'))).dog.dog_id, 'd3');
  // 回所優先於同籠候選
  await departed('d5', '阿福', '8005');
  const gone = main('d6', '9006', '舊狗', 'A01');
  const merge = { present: new Set(['main:其他']), departing: new Set(), done: true, waiting: new Set() };
  assert.equal((await identify(db, row('9100', '阿福'), [gone], [], merge)).kind, 'returned');
  // 溜狗紀錄的名字優先於同籠候選
  await walked('d7', '路路');
  assert.equal((await identify(db, row('', '路路'), [gone], [], merge)).kind, 'known');
});

test('#803 只判斷不寫資料', () => {
  const code = readFileSync(new URL('../src/main-row.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|REPLACE)\s+(OR\s+\w+\s+)?(INTO|FROM|v3_)/i);
  assert.doesNotMatch(code, /\.batch\(|\.run\(/);
});
