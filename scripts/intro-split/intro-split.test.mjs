// 介紹搬家（#665，ADR 0022）：核對表的建議值與 migration 產生器。全部是假資料，地址也是編的
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReason, segmentsOf, suggestDog } from './suggest.mjs';
import { toCsv, parseCsv, decodeCsv, COLUMNS, ID_COLUMN, NO_NUMBER, REQUIRED } from './csv.mjs';
import { checklistRows } from './checklist.mjs';
import { buildSnapshot } from './snapshot.mjs';
import { planChanges, buildMigration, preview, changedDogs, sqlText, normalDay } from './migration.mjs';
import { splitStatements } from '../compact-schema.mjs';

const FAKE_ADDRESS = '測試路12巷3號';
const dog = (over = {}) => ({ dogId: 'd1', name: '阿福', intro: null, numbers: ['2020010101'], stays: null, mainNumber: '2020010101', onMain: true, departures: [], events: [], ...over });
const brief = s => s.records.map(r => [r.number, r.in, r.reason, r.out, r.outReason || r.departure || '']);
const notes = s => [...s.notes, ...s.records.flatMap(r => r.notes)].join('；');

test('入所原因：去掉日期、地址那句整句拿掉、句中地區名稱照留', () => {
  assert.equal(cleanReason('2024年1月5日從板橋被民眾拾獲入所，剛來時戴著項圈。'), '從板橋被民眾拾獲入所，剛來時戴著項圈');
  assert.equal(cleanReason(`由政府捕捉入所，捕獲地址是${FAKE_ADDRESS}。`), '由政府捕捉入所');
  assert.equal(cleanReason('民眾拾獲入所，拾獲地點是樹林區某山。'), '民眾拾獲入所');
  assert.equal(cleanReason('2023年2月23日被認養，2月28日退回，認養人說不吃飼料'), '被認養，退回，認養人說不吃飼料');
  assert.deepEqual(segmentsOf('2019年4月24日被棄養入所；2023年2月23日被認養，2月28日退回').map(s => s.lead?.day), ['2019-04-24', '2023-02-23']);
});

test('放哪一筆：日期等於編號放那筆；對不上多一筆沒編號的；沒日期放目前編號；差一年當打錯', () => {
  assert.deepEqual(brief(suggestDog(dog({ intro: '2020年1月1日迷路入所。' }))), [['2020010101', '2020-01-01', '迷路入所', '', '']]);
  const off = suggestDog(dog({ intro: '2016年8月23日迷路入所。' }));
  assert.deepEqual(brief(off), [['', '2016-08-23', '迷路入所', '', ''], ['2020010101', '2020-01-01', '', '', '']]);
  assert.match(notes(off), /介紹寫 2016\/8\/23 入所，但沒有這天的編號，所以多一筆沒有編號的/);
  assert.match(notes(off), /入所原因空著/);
  const none = suggestDog(dog({ intro: `由政府捕捉入所，捕獲地址是${FAKE_ADDRESS}。` }));
  assert.deepEqual(brief(none), [['2020010101', '2020-01-01', '由政府捕捉入所', '', '']]);
  assert.match(notes(none), /拿掉了捕獲地址/);
  assert.ok(!JSON.stringify(none).replace(none.intro, '').includes(FAKE_ADDRESS));
  const typo = suggestDog(dog({ intro: '2019年1月1日迷路入所。' }));
  assert.equal(typo.records[0].number, '2020010101');
  assert.match(notes(typo), /差一年，可能打錯，先放在這個編號/);
  assert.match(notes(suggestDog(dog({ name: '仲基', intro: '2018年從狗園轉來。' }))), /仲基只寫 2018 年，請填入所日/);
});

test('超過 40 字要 K 改；已手填的入所原因先保留', () => {
  const long = suggestDog(dog({ intro: '2020年1月1日迷路入所，' + '當時很瘦而且腳上有傷口需要每天換藥照顧'.repeat(2) + '。' }));
  assert.match(notes(long), /超過 40 字，請改短/);
  const typed = suggestDog(dog({ intro: '2020年1月1日迷路入所。', stays: JSON.stringify([{ number: '2020010101', in: '2020-01-01', out: '', reason: '走失' }]) }));
  assert.equal(typed.records[0].reason, '走失');
  assert.match(notes(typed), /原本填的是「走失」，先保留；介紹寫的是「迷路入所」/);
});

test('舊資料：舊格式的「整修移所」改放到離所原因、編號那筆的入所原因', () => {
  const s = suggestDog(dog({ intro: '2015年8月18日迷路入所。', numbers: ['2017090508'], mainNumber: '2017090508',
    stays: JSON.stringify([{ in: '2015-08-18', out: '2017-09-05', reason: '整修移所' }]) }));
  assert.deepEqual(brief(s), [['', '2015-08-18', '迷路入所', '2017-09-05', '整修移所'], ['2017090508', '2017-09-05', '整修移所', '', '']]);
  assert.match(notes(s), /原本填的是「整修移所」，改成介紹寫的「迷路入所」/);
  assert.ok(!/#\d/.test(notes(s)), '不寫票號');
});

test('好幾件事拆成好幾筆；入所事件放進它的編號；離所時存的介紹不一樣要說', () => {
  const s = suggestDog(dog({ intro: '2018年4月13日從狗場轉來；曾被認養，一個月後退回。', numbers: ['2018041301', '2026051201'], mainNumber: '2026051201',
    events: [{ number: '2026051201', date: '2026-05-12', event: '認養後退回' }],
    departures: [{ number: '2026051201', name: '阿福', date: '2026-10-01', reason: 'adopt', lastIntro: '舊的介紹，很親人' }] }));
  assert.deepEqual(brief(s), [['2018041301', '2018-04-13', '從狗場轉來', '', ''], ['2026051201', '2026-05-12', '曾被認養，一個月後退回', '2026-10-01', '認養']]);
  assert.match(notes(s), /以前介紹表單還記了「認養後退回」/);
  assert.match(notes(s), /離所時存的介紹不一樣（像改寫前的原文），一起清空/);
  assert.deepEqual(s.lasts, [{ number: '2026051201', text: '' }]);
});

test('核對表 CSV：欄位照順序、一列一筆出入所紀錄、介紹只寫第一列；BOM、引號、Big5 都讀得回來', () => {
  const snapshot = buildSnapshot({ dogs: [
    { dog_id: 'd2', name: '小黑', intro: '2016年8月23日迷路入所，很"乖"。', numbers: '["2020010101"]', stays: null, main_number: '2020010101' },
    { dog_id: 'd3', name: '小白', intro: '2021年3月3日迷路入所。', numbers: '["2021030301"]', stays: null, main_number: null },
  ], departures: [], events: [] });
  const rows = checklistRows(snapshot);
  assert.deepEqual(rows.map(r => [r.狗名, r.編號, Boolean(r.原本的介紹)]), [['小黑', NO_NUMBER, true], ['小黑', '2020010101', false], ['小白', '2021030301', true]], '在所在前');
  const csv = toCsv(rows);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.equal(csv.slice(1, csv.indexOf('\r\n')), COLUMNS.join(','));
  assert.equal(COLUMNS.at(-1), ID_COLUMN);
  for (const gone of ['現有的值', '建議值', '項目', '建議字數', '放哪一筆', '在所']) assert.ok(!COLUMNS.includes(gone));
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
// K 勾的結果：預設全部「對」；over 照「狗名 編號」改格子
const decide = (over = {}) => checklistRows(SNAP).map((r, i) => ({ ...r, line: i + 2, 對嗎: '對', ...(over[`${r.狗名} ${r.編號}`] || {}) }));

test('產生器：照勾的結果寫出入所紀錄、清掉介紹；改前原文從 D1 讀，SQL 裡沒有地址；觸發器讓版本號加 1', () => {
  const { plans, errors } = planChanges(SNAP, decide({ [`阿福 ${NO_NUMBER}`]: { 出所日: '2017/9/5', 對嗎: '改', 改成的離所原因: '整修移所' } }), '2026-10-27');
  assert.deepEqual(errors, []);
  const sql = buildMigration(plans, { takenAt: SNAP.takenAt });
  assert.ok(!sql.includes(FAKE_ADDRESS), 'migration 檔不能有地址');
  const r = preview(SNAP, sql);
  try {
    const stays = id => JSON.parse(r.db.prepare('SELECT stays_json s FROM v3_stays WHERE dog_id=?').get(id)?.s || 'null');
    assert.deepEqual(stays('d1'), [
      { number: '', in: '2016-08-23', out: '2017-09-05', reason: '迷路入所', outReason: '整修移所' },
      { number: '2017090525', in: '2017-09-05', out: '', reason: '整修移所' },
    ], 'K 改的出所日（Excel 格式）、離所原因照寫');
    assert.equal(stays('d2')[0].reason, '走失', '保留手填的就不動');
    assert.deepEqual(stays('d3'), [{ number: '2021030301', in: '2021-03-03', out: '', reason: '迷路入所' }], '有離所紀錄那筆只存入所原因');
    assert.equal(r.db.prepare('SELECT COUNT(*) n FROM v3_intros').get().n, 0, '介紹清空');
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

test('產生器：K 改編號、改入所日照寫；只寫有變的；核對表之後被改過的狗整隻跳過', () => {
  const moved = planChanges(SNAP, decide({ [`阿福 ${NO_NUMBER}`]: { 入所日: '2016-08-24' } }), '2026-10-27').plans.find(p => p.dog.dogId === 'd1');
  assert.equal(JSON.parse(moved.stays.json)[0].in, '2016-08-24');
  // K 把沒編號那列改成編號、刪掉原本編號那列
  const toNumber = planChanges(SNAP, decide({ [`阿福 ${NO_NUMBER}`]: { 編號: '2017090525', 入所日: '2017-09-05', 出所日: '', 離所原因: '' } }).filter(r => !(r.狗名 === '阿福' && r.編號 === '2017090525' && r.入所原因 === '整修移所')), '2026-10-27');
  assert.deepEqual(toNumber.errors, []);
  assert.deepEqual(JSON.parse(toNumber.plans.find(p => p.dog.dogId === 'd1').stays.json), [{ number: '2017090525', in: '2017-09-05', out: '', reason: '迷路入所' }]);
  const { plans } = planChanges(SNAP, decide().filter(r => r.狗名 === '小黑'), '2026-10-27');
  assert.deepEqual(plans.map(p => [p.dog.name, Boolean(p.stays), p.intro]), [['小黑', false, '']], '保留手填＝出入所紀錄沒變，只清介紹');
  const changed = { ...SNAP, dogs: SNAP.dogs.map(d => (d.dogId === 'd3' ? { ...d, intro: '有人剛改過' } : d)) };
  assert.deepEqual(changedDogs(SNAP, changed, new Set(['d3'])), ['小白']);
  const sql = buildMigration(planChanges(SNAP, decide().filter(r => r.狗名 === '小白'), '2026-10-27').plans);
  const r = preview(changed, sql);
  try {
    assert.equal(r.rowsWritten, 0);
    assert.equal(r.db.prepare("SELECT intro FROM v3_intros WHERE dog_id='d3'").get().intro, '有人剛改過');
  } finally { r.db.close(); }
});

test('產生器：沒勾、超過 40 字、入所日不對、不是這隻的編號、改離所日，都不產生', () => {
  const bad = [
    ['阿福 ' + NO_NUMBER, { 對嗎: '好' }, /「對嗎」要填 對、不對、改、重複的狗/],
    ['阿福 ' + NO_NUMBER, { 對嗎: '改', 改成的入所原因: '很長'.repeat(21) }, /原因最多 40 字/],
    ['阿福 ' + NO_NUMBER, { 入所日: '2016-02-30' }, /日期請用 YYYY-MM-DD/],
    ['阿福 ' + NO_NUMBER, { 入所日: '2099-01-01' }, /未來/],
    ['阿福 ' + NO_NUMBER, { 編號: '1999010101' }, /這隻狗沒有這個編號/],
    ['阿福 2017090525', { 入所日: '2017-09-06' }, /編號前 8 碼/],
  ];
  for (const [key, over, message] of bad) assert.match(planChanges(SNAP, decide({ [key]: over }), '2026-10-27').errors.join('\n'), message, key);
});

test('Excel 的日期格式、SQL 字串裡的分號與連續減號', () => {
  assert.equal(normalDay('2017/9/5'), '2017-09-05');
  assert.equal(normalDay(''), '');
  assert.equal(splitStatements(`SELECT ${sqlText("a;b--c'd")} AS v;`).length, 1);
});

// K 實際的填法（2026-10-27）：刪了「原本的介紹」「說明」、欄位順序不同、Excel 日期、不對／重複的狗／空白
test('K 的填法：用欄名找欄、Excel 日期、不對用改成的、重複的狗刪掉那筆、空白先不寫、離所紀錄那筆改不了的列出來', () => {
  const snap = { takenAt: '', dogs: [
    dog({ dogId: 'g1', name: '奶奶', intro: '2026年8月26日從板橋被拾獲入所。', numbers: ['2026082607'], mainNumber: '', onMain: false,
      departures: [{ number: '2026082607', name: '奶奶', date: '2026-10-15', reason: 'death', lastIntro: '2026年8月26日從板橋被拾獲入所。' }] }),
    dog({ dogId: 'j1', name: '喬喬', intro: '2019年4月24日被主人退回，主人說會咬人。', numbers: ['2019042407'], mainNumber: '', onMain: false }),
    dog({ dogId: 's1', name: '小七七', intro: '2023年3月28日從樹林入所，有晶片但沒人領回。', numbers: ['2026032605'], mainNumber: '', onMain: false,
      departures: [{ number: '2026032605', name: '小七七', date: '2026-10-27', reason: 'unknown', lastIntro: '' }] }),
    dog({ dogId: 'b1', name: '還沒勾', intro: '2020年1月1日迷路入所。' }),
  ] };
  const csv = [
    `狗名,編號,入所日,入所原因,出所日,離所原因,對嗎,改成的入所原因,改成的離所原因,${ID_COLUMN}`,
    '奶奶,2026082607,2026/8/26,從板橋被拾獲入所,2026/10/15,死亡,不對,,離世,g1',
    '喬喬,2019042407,2019/4/24,被主人退回，主人說會咬人,,,不對,被棄養入所，主人說不親人,領養後退養,j1',
    `小七七,${NO_NUMBER},2023/3/28,從樹林入所，有晶片但沒人領回,,,重複的狗,,,s1`,
    '小七七,2026032605,2026/3/26,,2026/10/27,待確認,不對,從樹林入所，有晶片但沒人領回,,s1',
    '還沒勾,2020010101,2020/1/1,迷路入所,,,,,,b1',
  ].join('\r\n');
  const rows = parseCsv(decodeCsv(Buffer.from('﻿' + csv)));
  const { plans, errors, skipped, cantChange } = planChanges(snap, rows, '2026-10-27');
  assert.deepEqual(errors, []);
  assert.deepEqual(skipped, ['還沒勾']);
  assert.equal(cantChange.length, 1);
  assert.match(cantChange[0], /第 2 列（奶奶 2026082607）：離所原因照離所紀錄（「死亡」），這裡改不了（表上寫「離世」）/);
  const stays = Object.fromEntries(plans.map(p => [p.dog.name, p.stays && JSON.parse(p.stays.json)]));
  assert.deepEqual(stays.奶奶, [{ number: '2026082607', in: '2026-08-26', out: '', reason: '從板橋被拾獲入所' }], '入所原因照寫，離所原因不動');
  assert.deepEqual(stays.喬喬, [{ number: '2019042407', in: '2019-04-24', out: '', reason: '被棄養入所，主人說不親人', outReason: '領養後退養' }], '沒有離所紀錄的編號，改成的離所原因照寫');
  assert.deepEqual(stays.小七七, [{ number: '2026032605', in: '2026-03-26', out: '', reason: '從樹林入所，有晶片但沒人領回' }], '重複的狗那筆沒編號的不寫');
  assert.ok(!plans.some(p => p.dog.name === '還沒勾'));
  assert.throws(() => parseCsv(`狗名,編號,入所日,對嗎,${ID_COLUMN}\r\n`), new RegExp(`少了欄位：${['入所原因', '出所日', '離所原因'].join('、')}`), '少了原因欄不能讀，免得寫成空的');
  assert.ok(REQUIRED.every(c => COLUMNS.includes(c)));
});
