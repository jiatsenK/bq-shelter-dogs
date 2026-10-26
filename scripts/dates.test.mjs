import test from 'node:test';
import assert from 'node:assert/strict';
import { BQDates as dates } from '../public/js/dates.js';

test('編號前八碼推入所日，跨年仍取最早編號或出入所紀錄', () => {
  assert.equal(dates.localDateKey(dates.idDate('2024032902')), '2024-03-29');
  assert.equal(dates.localDateKey(dates.firstIntake({ id: '2026010101', formerIds: ['2025123102'] })), '2025-12-31');
  assert.equal(dates.localDateKey(dates.firstIntake({ id: '2017090508', formerIds: ['2016010101'], stays: [{ in: '2015-08-18' }, { in: '2020-01-01' }] })), '2015-08-18');
});

test('看不懂的日期或編號回 null；閏年與既有單位數月日仍可解析', () => {
  for (const value of ['', null, undefined, '不是日期', '2025-02-29', '2026-13-01', '2026-04-31', '2026/1/1']) assert.equal(dates.parseYmd(value), null);
  for (const value of ['', null, '20240329', '2024023001', '202403290200']) assert.equal(dates.idDate(value), null);
  assert.equal(dates.localDateKey(dates.parseYmd('2024-2-29')), '2024-02-29');
  assert.equal(dates.firstIntake({ id: '不明', formerIds: ['2025022901'], stays: [{ in: '未知' }] }), null);
});

test('台灣今天在 UTC 下午四點換日與跨年，本地日期鍵仍保留傳入日', () => {
  assert.equal(dates.taipeiToday(new Date('2025-12-31T15:59:59Z')), '2025-12-31');
  assert.equal(dates.taipeiToday(new Date('2025-12-31T16:00:00Z')), '2026-01-01');
  assert.equal(dates.taipeiStamp(new Date('2025-12-31T16:00:00Z')), '2026/1/1');
  assert.equal(dates.localDateKey(dates.makeDate(2025, 12, 31)), '2025-12-31');
});

// #639（ADR 0021）：只有編號的狗，出入所表從編號排；Worker 有給整張表就照用
test('出入所表：編號日期、只有編號的狗照入所日排、看不出日期的排最後；有給 stays 就照用', () => {
  assert.equal(dates.idDay('2017090508'), '2017-09-05');
  assert.equal(dates.idDay('A12'), '');
  assert.deepEqual(dates.stayRows({ id: 'A12', formerIds: ['2026010101', '2015081801'] }), [
    { number: '2015081801', in: '2015-08-18', out: '', reason: '' },
    { number: '2026010101', in: '2026-01-01', out: '', reason: '' },
    { number: 'A12', in: '', out: '', reason: '' },
  ]);
  const stays = [{ number: '', in: '2015-08-18', out: '2017-09-05', reason: '整修移所' }];
  assert.equal(dates.stayRows({ id: '2017090508', stays }), stays);
  assert.deepEqual(dates.stayRows({ id: '' }), []);
});
