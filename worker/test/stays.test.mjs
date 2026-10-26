// 出入所表（ADR 0021，#639）：編號、離所、手填合成一張表；存檔只留手填的部分
import test from 'node:test';
import assert from 'node:assert/strict';
import { stayTable, cleanStayTable, storedStays, joinStays } from '../src/stays.js';

const TODAY = '2026-10-26';

test('墨西哥：沒編號的那次加上目前編號那列，入所日是最早那天', () => {
  const rows = stayTable([{ in: '2015-08-18', out: '2017-09-05', reason: '整修移所' }], ['2017090508'], []);
  assert.deepEqual(rows, [
    { number: '', in: '2015-08-18', out: '2017-09-05', reason: '整修移所' },
    { number: '2017090508', in: '2017-09-05', out: '', reason: '' },
  ]);
});

test('納卡西：舊資料入所日跟編號同一天，接到那個編號、保留手填的出所日與原因', () => {
  const rows = stayTable([{ in: '2026-04-21', out: '2026-10-18', reason: '' }], ['2026042101'], []);
  assert.deepEqual(rows, [{ number: '2026042101', in: '2026-04-21', out: '2026-10-18', reason: '' }]);
});

test('新格式（帶空的 number）的沒編號紀錄，入所日剛好跟編號同一天也不接過去（只有舊格式才接）', () => {
  const departed = [{ number: '2016010101', date: '2016-06-06', reason: 'adopt' }];
  const rows = stayTable([{ number: '', in: '2016-01-01', out: '2016-03-01', reason: '走失' }], ['2016010101'], departed);
  assert.deepEqual(rows, [
    { number: '', in: '2016-01-01', out: '2016-03-01', reason: '走失' },
    { number: '2016010101', in: '2016-01-01', out: '2016-06-06', reason: '認養', departed: true },
  ]);
  // 存回去還是同一張表（志工存完再改不會 409）
  assert.deepEqual(stayTable(storedStays(rows), ['2016010101'], departed), rows);
});

test('有離所紀錄的編號：出所日、原因照離所紀錄，手填的不用', () => {
  const rows = stayTable(
    [{ number: '2020010101', in: '2020-01-01', out: '2020-02-02', reason: '手填' }],
    ['2020010101', '2021030301'],
    [{ number: '2020010101', date: '2020-05-05', reason: 'adopt' }, { number: '2021030301', date: null, reason: 'unknown' }],
  );
  assert.deepEqual(rows, [
    { number: '2020010101', in: '2020-01-01', out: '2020-05-05', reason: '認養', departed: true },
    { number: '2021030301', in: '2021-03-03', out: '', reason: '待確認', departed: true },
  ]);
});

test('編號已經不屬於這隻狗的手填紀錄當成沒編號；看不出日期的編號入所日空著、排最後', () => {
  const rows = stayTable([{ number: '2010010101', in: '2010-01-01', out: '2011-01-01', reason: '退養' }], ['A12', '2020010101'], []);
  assert.deepEqual(rows, [
    { number: '', in: '2010-01-01', out: '2011-01-01', reason: '退養' },
    { number: '2020010101', in: '2020-01-01', out: '', reason: '' },
    { number: 'A12', in: '', out: '', reason: '' },
  ]);
});

test('存檔：沒編號的照存；有編號的只在手填出所日或原因時存；有離所的不存', () => {
  const table = [
    { number: '', in: '2015-08-18', out: '2017-09-05', reason: '整修移所' },
    { number: '2017090508', in: '2017-09-05', out: '', reason: '' },
    { number: '2018010101', in: '2018-01-01', out: '2018-03-03', reason: '退養' },
    { number: '2019010101', in: '2019-01-01', out: '2019-05-05', reason: '認養', departed: true },
  ];
  assert.deepEqual(storedStays(table), [
    { number: '', in: '2015-08-18', out: '2017-09-05', reason: '整修移所' },
    { number: '2018010101', in: '2018-01-01', out: '2018-03-03', reason: '退養' },
  ]);
});

test('整理送來的表：補編號、刪編號、目前編號不能刪、入所日照編號、有離所的出所日不能改', () => {
  const before = { numbers: ['2017090508', '2016010101'], currentNumbers: ['2017090508'], departures: [{ number: '2016010101', date: '2016-06-06', reason: 'adopt' }] };
  const ok = cleanStayTable([
    { number: '2017090508', in: '1999-01-01', out: '', reason: '' },
    { number: '2016010101', in: '2016-01-01', out: '2020-01-01', reason: '亂改' },
    { number: '2015081801', in: '', out: '2015-12-01', reason: '轉所' },
    { number: '', in: '2010-01-01', out: '', reason: '  迷路 ' },
  ], before, TODAY);
  assert.deepEqual(ok, {
    rows: [
      { number: '', in: '2010-01-01', out: '', reason: '迷路' },
      { number: '2015081801', in: '2015-08-18', out: '2015-12-01', reason: '轉所' },
      { number: '2016010101', in: '2016-01-01', out: '2016-06-06', reason: '認養', departed: true },
      { number: '2017090508', in: '2017-09-05', out: '', reason: '' },
    ],
    numbers: ['2015081801', '2016010101', '2017090508'],
  });
  const fail = (rows, message) => assert.match(cleanStayTable(rows, before, TODAY).error, message);
  fail([{ number: '2016010101', in: '', out: '', reason: '' }], /目前編號/);
  fail([{ number: '2017090508', in: '', out: '', reason: '' }], /有離所紀錄的編號不能刪/);
  fail([{ number: '2017090508', in: '', out: '', reason: '' }, { number: '2017090508', in: '', out: '', reason: '' }], /重複/);
  fail([{ number: '2017090508', in: '', out: '', reason: '' }, { number: '2018010101', in: '', out: '', reason: '' }], /晚於目前編號/);
  fail([{ number: '2017090508', in: '', out: '', reason: '' }, { number: '12345', in: '', out: '', reason: '' }], /10 碼/);
  fail([{ number: '2017090508', in: '', out: '2017-01-01', reason: '' }], /早於入所日/);
  fail([{ number: '2017090508', in: '', out: '', reason: '' }, { number: '', in: '2027-01-01', out: '', reason: '' }], /未來/);
  fail([{ number: '2017090508', in: '', out: '', reason: '' }, { number: '', in: '', out: '', reason: '' }], /YYYY-MM-DD/);
  fail([{ number: '2017090508', in: '', out: '', reason: 'x'.repeat(41) }], /40 字/);
  fail([{ number: '2017090508', in: '', out: '', reason: '', sql: 'x' }], /欄位不對/);
  fail(Array.from({ length: 101 }, () => ({ number: '', in: '2010-01-01', out: '', reason: '' })), /最多/);
});

test('原本就有、看不出日期的編號可以留著；同一天兩筆沒編號的照樣都留', () => {
  const before = { numbers: ['A12'], currentNumbers: ['A12'], departures: [] };
  const ok = cleanStayTable([
    { number: 'A12', in: '', out: '', reason: '' },
    { number: '', in: '2010-01-01', out: '', reason: '甲' },
    { number: '', in: '2010-01-01', out: '', reason: '甲' },
  ], before, TODAY);
  assert.equal(ok.rows.length, 3);
  assert.deepEqual(ok.numbers, ['A12']);
});

test('合併：兩邊的手填紀錄全部接在一起，照入所日排', () => {
  const a = JSON.stringify([{ in: '2015-08-18', out: '2017-09-05', reason: '整修移所' }]);
  const b = JSON.stringify([{ number: '2010010101', in: '2010-01-01', out: '2011-01-01', reason: '退養' }, { in: '2015-08-18', out: '2017-09-05', reason: '整修移所' }]);
  assert.deepEqual(JSON.parse(joinStays(a, b)), [
    { number: '2010010101', in: '2010-01-01', out: '2011-01-01', reason: '退養' },
    { in: '2015-08-18', out: '2017-09-05', reason: '整修移所' },
  ]);
});
