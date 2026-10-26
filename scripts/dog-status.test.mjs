import test from 'node:test';
import assert from 'node:assert/strict';
import { AMBER_DAYS, RED_DAYS, dogStatus, restFrom, sortDue, specialFlag, walkKey } from '../public/js/dog-status.js';
import { esc, highlightNote, matchesSearch } from '../public/js/ui-kit.js';
import { SITE } from '../public/js/site-config.js';

const today = new Date(2026, 9, 26, 10);
const ago = n => `2026-10-${String(26 - n).padStart(2, '0')}`;

test('Node 可直接匯入天數規則與小工具，不建立全域名稱', () => {
  assert.equal(globalThis.esc, undefined);
  assert.equal(globalThis.computeStatus, undefined);
});

test('天數色標照 SITE 的黃、紅門檻；日期讀不到就是沒有紀錄', () => {
  const at = n => dogStatus({}, today, { walk: { date: ago(n) } });
  assert.deepEqual(at(0), { kind: 'dated', days: 0, level: 'sage' });
  assert.equal(at(AMBER_DAYS - 1).level, 'sage');
  assert.equal(at(AMBER_DAYS).level, 'amber');
  assert.equal(at(RED_DAYS).level, 'red');
  assert.deepEqual(dogStatus({}, today, { walk: { date: '' } }), { kind: 'unknown' });
  assert.deepEqual(dogStatus({}, today), { kind: 'unknown' });
});

test('休養優先於固定照顧，固定照顧優先於今天自己登記', () => {
  const rest = { until: new Date(2026, 9, 30), reason: '術後' };
  assert.deepEqual(dogStatus({ covered: true }, today, { rest, walk: { mine: true } }), { kind: 'rest', ...rest });
  assert.deepEqual(dogStatus({ covered: true }, today, { walk: { mine: true } }), { kind: 'covered' });
  assert.deepEqual(dogStatus({}, today, { walk: { mine: true, date: ago(9) } }), { kind: 'dated', days: 0, level: 'sage', mine: true });
});

test('休養到設定那天為止（含當天），過了自動恢復；沒有編號的狗沒有休養', () => {
  const restMap = { 1: { until: '2026-10-26', reason: '' }, 2: { until: '2026-10-25' }, 3: { until: '看不懂' } };
  assert.equal(restFrom({ id: '1' }, today, restMap).until.getDate(), 26);
  assert.equal(restFrom({ id: '2' }, today, restMap), null);
  assert.equal(restFrom({ id: '3' }, today, restMap), null);
  assert.equal(restFrom({ name: '新來的' }, today, restMap), null);
});

test('溜狗表排序：沒有紀錄最前，再來最久沒溜；固定照顧在休養之上、都排最後；同分保持原順序', () => {
  const dogs = ['近', '遠', '無紀錄', '照顧', '休養', '同遠'].map(name => ({ name }));
  const status = { 近: { kind: 'dated', days: 1 }, 遠: { kind: 'dated', days: 20 }, 無紀錄: { kind: 'unknown' },
    照顧: { kind: 'covered' }, 休養: { kind: 'rest' }, 同遠: { kind: 'dated', days: 20 } };
  assert.deepEqual(sortDue(dogs, d => status[d.name]).map(d => d.name), ['無紀錄', '遠', '同遠', '近', '照顧', '休養']);
  assert.deepEqual(sortDue([{ name: '未來' }, { name: '今天' }], d => ({ kind: 'dated', days: d.name === '未來' ? -3 : 0 })).map(d => d.name), ['未來', '今天'], '日期在未來當作今天');
});

test('walkKey 有編號用編號，沒有用犬名，都沒有就是空的', () => {
  assert.deepEqual([walkKey({ id: '9', name: '甲' }), walkKey({ id: '', name: '甲' }), walkKey({ id: '', name: '' })], ['9', '名:甲', '']);
});

test('警示關鍵字：回傳命中的關鍵字與原文寫法；沒命中是 null', () => {
  const [label, ...variants] = SITE.warnKeywords[0];
  const written = variants[0] || label;
  assert.deepEqual(specialFlag(`備註：${written}`), { keywords: [label], terms: [written] });
  assert.equal(specialFlag('乖巧親人'), null);
  assert.equal(specialFlag(undefined), null);
});

test('HTML 跳脫與備註標示：只標命中的字，其餘照樣跳脫；搜尋不分全半形與空白', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(highlightNote('<小心>咬人', ['咬人']), '&lt;小心&gt;<mark>咬人</mark>');
  assert.equal(highlightNote('沒命中', []), '沒命中');
  assert.equal(matchesSearch({ name: 'Ｂｏ 比' }, ' bo比 '), true);
  assert.equal(matchesSearch({ name: '甲' }, '   '), true);
});
