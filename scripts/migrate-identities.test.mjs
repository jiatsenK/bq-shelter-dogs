import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateBusinessDatabase } from './migrate-business-db.mjs';
import { migrateIdentities } from './migrate-identities.mjs';

async function setup(t) {
  const db = fakeD1(); t.after(() => db.close());
  await migrateBusinessDatabase(db);
  return db;
}

test('主清單身分可重跑，名字更改不換狗 ID，入所來源與原因不猜', async t => {
  const db = await setup(t);
  const input = { dogs: [{ id: '2026010101', name: '原名', cage: 'A1' }] };
  const first = await migrateIdentities(db, input);
  input.dogs[0].name = '新名';
  const second = await migrateIdentities(db, input);
  assert.equal(first.mapping[0].dog_id, second.mapping[0].dog_id);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_dogs').first('COUNT(*)'), 1);
  const admission = await db.prepare('SELECT * FROM v2_admissions').first();
  assert.equal(admission.intake_date, '2026-01-01');
  assert.equal(admission.intake_source, null);
  assert.equal(admission.intake_reason, null);
  assert.equal(await db.prepare('SELECT name FROM v2_dogs').first('name'), '新名');
});

test('中途失敗後重跑，已存無編號狗的來源對應避免重建', async t => {
  const db = await setup(t);
  const original = db.batch.bind(db);
  let calls = 0;
  db.batch = statements => ++calls === 2 ? Promise.reject(new Error('模擬中斷')) : original(statements);
  const input = { dogs: [{ name: '未編號' }, { id: '2026010101', name: '有編號' }] };
  await assert.rejects(migrateIdentities(db, input), /模擬中斷/);
  db.batch = original;
  await migrateIdentities(db, input);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_dogs').first('COUNT(*)'), 2);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_source_bindings').first('COUNT(*)'), 2);
});

test('模糊暫住與無證據補編號保留，已確認對應不能默默合併既有兩隻狗', async t => {
  const db = await setup(t);
  const input = { dogs: [{ id: '2026010101', name: '同名' }, { id: '2026020101', name: '同名' }, { name: '(同名)' }] };
  const out = await migrateIdentities(db, input);
  assert.equal(out.pending.length, 1);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_dogs').first('COUNT(*)'), 2);
  await assert.rejects(migrateIdentities(db, { ...input, confirmedMappings: [{ sourceKey: '2026010101', targetNumber: '2026020101', relation: 'readmission', evidence: '衝突範例' }] }), /兩個既有狗/);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_dogs').first('COUNT(*)'), 2);
  assert.equal(await db.prepare("SELECT COUNT(*) FROM v2_admissions WHERE status='in'").first('COUNT(*)'), 2);
});

test('新增可靠再入所對應保留狗 ID，重跑不擦掉已確認的舊離所事實', async t => {
  const db = await setup(t);
  const first = await migrateIdentities(db, { dogs: [{ id: '2020010101', name: '狗' }] });
  const input = { dogs: [{ id: '2020010101', name: '狗' }], cards: [{ id: '2026010101', formerIds: ['2020010101'] }] };
  const second = await migrateIdentities(db, input);
  assert.equal(second.mapping[0].dog_id, first.mapping[0].dog_id);
  await db.prepare("UPDATE v2_admissions SET status='departed',departed_date='2025-12-31',cage='舊籠',sheet_note='舊備註' WHERE admission_id=?").bind(first.mapping[0].admission_id).run();
  await migrateIdentities(db, input);
  const old = await db.prepare('SELECT status,departed_date,cage,sheet_note FROM v2_admissions WHERE admission_id=?').bind(first.mapping[0].admission_id).first();
  assert.deepEqual(old, { status: 'departed', departed_date: '2025-12-31', cage: '舊籠', sheet_note: '舊備註' });
});

test('補編號與編號更正只依明確證據，無編號鍵 NFKC 去空白', async t => {
  const db = await setup(t);
  const out = await migrateIdentities(db, {
    dogs: [{ id: '2026100101', name: '米香' }],
    confirmedMappings: [
      { sourceKey: '名: 米　香 ', targetNumber: '2026100101', relation: 'same_admission', evidence: 'K 確認補編號' },
      { sourceKey: '2026093001', targetNumber: '2026100101', relation: 'same_admission', evidence: 'K 確認更正' },
    ],
    sources: [{ source: 'old.json', rows: [{ name: '米　香' }, { id: '2026093001', name: '米香' }] }],
  });
  assert.equal(out.pending.length, 0);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_admissions').first('COUNT(*)'), 1);
  assert.equal(out.mapping.find(x => x.source_key === '名:米香').admission_id, out.mapping[0].admission_id);
  assert.equal(await db.prepare("SELECT kind FROM v2_admission_numbers WHERE number='2026093001'").first('kind'), 'corrected');
});

test('暫住必須無編號、括號名、主清單唯一同名；有編號括號名當改名', async t => {
  const db = await setup(t);
  const out = await migrateIdentities(db, {
    dogs: [{ id: '2026010101', name: '阿拉丁' }, { name: '（阿拉丁）', cage: '暫住籠' }, { id: '2026020101', name: '寶妮' }],
    sources: [{ source: 'old.json', rows: [{ name: '( 阿 拉 丁 )' }, { id: '2026020101', name: '（梗奶奶）' }, { name: '(無對應)' }] }],
  });
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_dogs').first('COUNT(*)'), 2);
  assert.equal(out.mapping.find(x => x.source === 'main' && x.source_key === '名:(阿拉丁)').dog_id, out.mapping[0].dog_id);
  assert.equal(out.mapping.find(x => x.source === 'old.json' && x.source_key === '名:(阿拉丁)').dog_id, out.mapping[0].dog_id);
  assert.equal(out.mapping.find(x => x.source_key === '2026020101' && x.source === 'old.json').dog_id, out.mapping.find(x => x.source_key === '2026020101' && x.source === 'main').dog_id);
  assert.equal(out.pending.length, 1);
});

test('同名與無對應狗卡不能猜配，五張待確認卡不建立額外狗', async t => {
  const db = await setup(t);
  const cards = [
    { id: '2018070201', name: '小偉' }, { id: '2019042407', name: 'JOJO' },
    { id: '2026040501', name: '栗子' }, { id: '2026072401', name: '芊芊' }, { id: '2026091401', name: '豆花' },
  ];
  const out = await migrateIdentities(db, {
    dogs: [{ id: '2022030205', name: '小偉' }, { id: '2024022801', name: 'JOJO' }, { id: '2021083002', name: '栗子' }], cards,
    sources: [{ source: 'old.json', rows: [{ name: '小偉' }] }],
  });
  assert.equal(out.pending.filter(x => x.source.startsWith('dogs/')).length, 5);
  assert.equal(out.pending.length, 6);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_dogs').first('COUNT(*)'), 3);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_source_bindings').first('COUNT(*)'), 9);
  const evidence = await db.prepare("SELECT evidence FROM v2_source_bindings WHERE source_key='2018070201'").first('evidence');
  assert.equal(JSON.parse(evidence).row.name, '小偉');
});

test('狗卡明載舊編號：舊號認同狗，目前入所用新號，舊來源仍對舊入所', async t => {
  const db = await setup(t);
  const input = {
    dogs: [{ id: '2018041318', name: '試算表名字' }],
    cards: [{ id: '2026051203', name: '非權威名字', formerIds: ['2018041318'] }],
    sources: [{ source: 'history/old.json', rows: [{ id: '2018041318', name: '舊名' }] }],
  };
  const out = await migrateIdentities(db, input);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_dogs').first('COUNT(*)'), 1);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_admissions').first('COUNT(*)'), 2);
  const rows = (await db.prepare('SELECT number,status FROM v2_admission_numbers JOIN v2_admissions USING(admission_id) ORDER BY number').all()).results;
  assert.deepEqual(rows, [{ number: '2018041318', status: 'unknown' }, { number: '2026051203', status: 'in' }]);
  assert.notEqual(out.mapping.find(x => x.source === 'main').admission_id, out.mapping.find(x => x.source === 'history/old.json').admission_id);
  await migrateIdentities(db, input);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM v2_admissions').first('COUNT(*)'), 2);
});
