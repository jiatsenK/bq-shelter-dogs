// 介紹搬家（#665，ADR 0022）：核對表的建議值與 migration 產生器。全部是假資料，地址也是編的
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReason, suggestRows, segmentsOf, KINDS, NEW_STAY } from './suggest.mjs';
import { toCsv, parseCsv, decodeCsv, COLUMNS } from './csv.mjs';
import { checklistRows } from './checklist.mjs';
import { buildSnapshot } from './snapshot.mjs';
import { planChanges, buildMigration, preview, changedDogs, sqlText } from './migration.mjs';
import { splitStatements } from '../compact-schema.mjs';

const FAKE_ADDRESS = '測試路12巷3號';
const dog = (over = {}) => ({ dogId: 'd1', name: '阿福', intro: null, numbers: ['2020010101'], stays: null, mainNumber: '2020010101', onMain: true, departures: [], events: [], ...over });
const only = (rows, kind) => rows.filter(r => r.kind === kind);

test('入所原因：去掉日期、地址那句整句拿掉、句中地區名稱照留', () => {
  assert.equal(cleanReason('2024年1月5日從板橋被民眾拾獲入所，剛來時戴著項圈。'), '從板橋被民眾拾獲入所，剛來時戴著項圈');
  assert.equal(cleanReason(`由政府捕捉入所，捕獲地址是${FAKE_ADDRESS}。`), '由政府捕捉入所');
  assert.equal(cleanReason(`民眾拾獲入所，拾獲地點是樹林區某山。`), '民眾拾獲入所');
  assert.equal(cleanReason('2023年2月23日被認養，2月28日退回，認養人說不吃飼料'), '被認養，退回，認養人說不吃飼料');
  assert.deepEqual(segmentsOf('2019年4月24日被棄養入所；2023年2月23日被認養，2月28日退回').map(s => s.lead?.day), ['2019-04-24', '2023-02-23']);
});

test('建議放哪一筆：日期等於編號放那筆；對不上的建議新增沒編號＋入所日；沒日期的放目前編號', () => {
  const same = suggestRows(dog({ intro: '2020年1月1日迷路入所。' }));
  assert.deepEqual(only(same, KINDS.reason).map(r => [r.target, r.in, r.suggest]), [['2020010101', '2020-01-01', '迷路入所']]);
  assert.deepEqual(only(same, KINDS.intro).map(r => r.suggest), [''], '甲：整句搬走，介紹剩空的');
  const off = suggestRows(dog({ intro: '2016年8月23日迷路入所。' }));
  assert.deepEqual(only(off, KINDS.reason).map(r => [r.target, r.in]), [[NEW_STAY, '2016-08-23']]);
  assert.match(off[0].note, /對不上/);
  const none = suggestRows(dog({ intro: `由政府捕捉入所，捕獲地址是${FAKE_ADDRESS}。` }));
  assert.deepEqual(only(none, KINDS.reason).map(r => [r.target, r.suggest]), [['2020010101', '由政府捕捉入所']]);
  assert.ok(!JSON.stringify(none.map(r => [r.suggest, r.note])).includes(FAKE_ADDRESS));
  const typo = suggestRows(dog({ intro: '2019年1月1日迷路入所。' }));
  assert.equal(typo[0].target, '2020010101', '差一年同月日當成打錯，只是建議');
  assert.match(typo[0].note, /差一點/);
});

test('超過 40 字標記要 K 改；已手填的入所原因不覆蓋，建議值保留原本的', () => {
  const long = suggestRows(dog({ intro: '2020年1月1日迷路入所，' + '當時很瘦而且腳上有傷口需要每天換藥照顧'.repeat(2) + '。' }));
  assert.match(long[0].note, /超過 40 字/);
  const typed = suggestRows(dog({ intro: '2020年1月1日迷路入所。', stays: JSON.stringify([{ number: '2020010101', in: '2020-01-01', out: '', reason: '走失' }]) }));
  assert.equal(typed[0].current, '走失');
  assert.equal(typed[0].suggest, '走失');
  assert.match(typed[0].note, /已手填「走失」，建議保留；要換成「迷路入所」/);
});

test('舊資料重放（#651）：舊格式的「整修移所」改成沒編號那筆的離所原因、編號那筆的入所原因', () => {
  const rows = suggestRows(dog({ intro: '2015年8月18日迷路入所。', numbers: ['2017090508'], mainNumber: '2017090508',
    stays: JSON.stringify([{ in: '2015-08-18', out: '2017-09-05', reason: '整修移所' }]) }));
  assert.deepEqual(rows.filter(r => r.kind !== KINDS.intro).map(r => [r.kind, r.target, r.in, r.current, r.suggest]), [
    [KINDS.reason, NEW_STAY, '2015-08-18', '整修移所', '迷路入所'],
    [KINDS.outReason, NEW_STAY, '2015-08-18', '', '整修移所'],
    [KINDS.reason, '2017090508', '2017-09-05', '', '整修移所'],
  ]);
});

test('好幾件事分成好幾列；入所事件、離所時的介紹也列出來', () => {
  const rows = suggestRows(dog({ intro: '2018年4月13日從狗場轉來；曾被認養，一個月後退回。', numbers: ['2018041301', '2026051201'], mainNumber: '2026051201',
    events: [{ number: '2026051201', date: '2026-05-12', event: '認養後退回' }],
    departures: [{ number: '2026051201', name: '阿福', date: '2026-10-01', reason: 'adopt', lastIntro: '舊的介紹，很親人' }] }));
  assert.deepEqual(only(rows, KINDS.reason).map(r => [r.target, r.suggest]), [['2018041301', '從狗場轉來'], ['2026051201', '曾被認養，一個月後退回']]);
  assert.match(only(rows, KINDS.reason)[1].note, /入所事件.*認養後退回/);
  assert.deepEqual(only(rows, KINDS.lastIntro).map(r => [r.target, r.current, r.suggest]), [['2026051201', '舊的介紹，很親人', '舊的介紹，很親人']], '沒有入所經過的句子留在介紹');
});

test('核對表 CSV：UTF-8 BOM、逗號與引號照樣讀回、Excel 另存的 Big5 也讀得懂', () => {
  const snapshot = buildSnapshot({ dogs: [{ dog_id: 'd1', name: '阿福', intro: '2020年1月1日迷路入所，很"乖"。', numbers: '["2020010101"]', stays: null, main_number: '2020010101' }], departures: [], events: [] });
  const rows = checklistRows(snapshot);
  const csv = toCsv(rows);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  const back = parseCsv(decodeCsv(Buffer.from(csv)));
  assert.deepEqual(back.map(({ line, ...r }) => r), rows.map(r => Object.fromEntries(COLUMNS.map(c => [c, String(r[c])]))));
  assert.equal(decodeCsv(Buffer.from([0xaa, 0xfc])), '阿', 'Big5');
});

// 假的正式庫：在所兩隻、離所一隻
const SNAP = {
  takenAt: '2026-10-27T00:00:00.000Z',
  dogs: [
    dog({ intro: `2016年8月23日迷路入所，捕獲地址是${FAKE_ADDRESS}。`, numbers: ['2017090525'], mainNumber: '2017090525' }),
    dog({ dogId: 'd2', name: '小黑', intro: '2020年2月2日被通報入所。', numbers: ['2020020201'], mainNumber: '2020020201', stays: JSON.stringify([{ number: '2020020201', in: '2020-02-02', out: '', reason: '走失' }]) }),
    dog({ dogId: 'd3', name: '小白', intro: '2021年3月3日迷路入所。', numbers: ['2021030301'], mainNumber: '', onMain: false,
      departures: [{ number: '2021030301', name: '小白', date: '2026-10-01', reason: 'adopt', lastIntro: '2021年3月3日迷路入所。' }] }),
  ],
};
const decide = (choices = {}) => checklistRows(SNAP).map((r, i) => ({ ...r, line: i + 2, K勾選: '同意', ...(choices[`${r.狗名}:${r.項目}:${r.放哪一筆}`] || {}) }));

test('產生器：照勾的結果寫出入所紀錄、清掉介紹；改前原文從 D1 讀，SQL 裡沒有地址；觸發器讓版本號加 1', () => {
  const { plans, errors } = planChanges(SNAP, decide({ '阿福:入所原因:新增沒編號': { 出所日: '2017-09-05' } }), '2026-10-27');
  assert.deepEqual(errors, []);
  const sql = buildMigration(plans, { takenAt: SNAP.takenAt });
  assert.ok(!sql.includes(FAKE_ADDRESS), 'migration 檔不能有地址');
  const r = preview(SNAP, sql);
  try {
    const stays = id => JSON.parse(r.db.prepare('SELECT stays_json s FROM v3_stays WHERE dog_id=?').get(id)?.s || 'null');
    assert.deepEqual(stays('d1'), [
      { number: '', in: '2016-08-23', out: '2017-09-05', reason: '迷路入所', outReason: '整修移所' },
      { number: '2017090525', in: '2017-09-05', out: '', reason: '整修移所' },
    ]);
    assert.deepEqual(stays('d2'), [{ number: '2020020201', in: '2020-02-02', out: '', reason: '走失' }], '同意保留手填的就不動');
    assert.deepEqual(stays('d3'), [{ number: '2021030301', in: '2021-03-03', out: '', reason: '迷路入所' }], '有離所紀錄那筆只存入所原因');
    assert.equal(r.db.prepare('SELECT COUNT(*) n FROM v3_intros').get().n, 0);
    assert.equal(r.db.prepare("SELECT last_intro l FROM v3_dog_departures WHERE dog_id='d3'").get().l, '');
    const log = r.db.prepare("SELECT kind, dog_number, before_json b, after_json a, editor_name e FROM v3_edit_log WHERE dog_id='d1' ORDER BY id").all();
    assert.deepEqual(log.map(l => [l.kind, l.dog_number, l.e]), [['intro', '2017090525', '管理者'], ['stays', '2017090525', '管理者']]);
    assert.equal(JSON.parse(log[0].b), SNAP.dogs[0].intro, '原文留在修改紀錄');
    assert.equal(log[0].a, null);
    assert.equal(r.db.prepare("SELECT COUNT(*) n FROM v3_edit_log WHERE dog_id='d3'").get().n, 2, '離所時的介紹跟介紹一樣，只記一筆介紹');
    assert.ok(r.db.prepare('SELECT small FROM v3_pack_versions').get().small > 1);
    assert.ok(r.db.prepare("SELECT revision FROM v3_dog_edit_state WHERE dog_id='d1'").get().revision > 2);
    assert.equal(r.skipped, 0);
  } finally { r.db.close(); }
});

test('產生器：只寫有變的狗；不改的不寫；核對表之後被改過的狗整隻跳過', () => {
  const keep = { K勾選: '不改' };
  const { plans } = planChanges(SNAP, decide({ '小黑:介紹:': keep, '阿福:入所原因:新增沒編號': keep, '阿福:離所原因:新增沒編號': keep, '阿福:入所原因:2017090525': keep, '阿福:介紹:': keep }), '2026-10-27');
  assert.deepEqual(plans.map(p => p.dog.name), ['小白'], '小黑同意保留手填＝沒變；阿福全部不改');
  const changed = { ...SNAP, dogs: SNAP.dogs.map(d => (d.dogId === 'd3' ? { ...d, intro: '有人剛改過' } : d)) };
  assert.deepEqual(changedDogs(SNAP, changed, new Set(['d3'])), ['小白']);
  // 套用時那隻已經被改過：每句條件不成立，整隻不寫
  const sql = buildMigration(plans);
  const r = preview(changed, sql);
  try {
    assert.equal(r.rowsWritten, 0);
    assert.equal(r.db.prepare("SELECT intro FROM v3_intros WHERE dog_id='d3'").get().intro, '有人剛改過');
  } finally { r.db.close(); }
});

test('產生器：沒勾、超過 40 字、入所日不對、不是這隻的編號、同一筆寫兩種，都不產生', () => {
  const rows = decide();
  const bad = [
    [{ K勾選: '' }, /K勾選要填/],
    [{ K勾選: '改成', K改成: '很長'.repeat(21) }, /最多 40 字/],
    [{ 入所日: '2016-02-30' }, /要填入所日/],
    [{ 放哪一筆: '1999010101' }, /沒有編號 1999010101/],
    [{ K勾選: '改成', K改成: '' }, /K改成 是空的/],
  ];
  for (const [over, message] of bad) {
    const i = rows.findIndex(r => r.狗名 === '阿福' && r.項目 === KINDS.reason && r.放哪一筆 === (over.放哪一筆 ? '2017090525' : NEW_STAY));
    const changed = rows.map((r, j) => (j === i ? { ...r, ...over } : r));
    const { errors } = planChanges(SNAP, changed, '2026-10-27');
    assert.match(errors.join('\n'), message);
  }
  const twice = [...rows, { ...rows.find(r => r.狗名 === '阿福' && r.項目 === KINDS.reason), line: 99, K勾選: '改成', K改成: '別的' }];
  assert.match(planChanges(SNAP, twice, '2026-10-27').errors.join('\n'), /跟第 \d+ 列寫的不一樣/);
});

test('SQL 字串裡的分號、連續減號拆開，切句不會切錯', () => {
  const text = "a;b--c'd";
  const sql = `SELECT ${sqlText(text)} AS v;`;
  assert.equal(splitStatements(sql).length, 1);
});
