// 寫入試算表小程式（#138，apps-script/sheet-write.gs）的測試：只測不碰 Google 的部分（找表頭、找狗、決定要寫哪些格子）
// 執行：node --test worker/test/sheet-write.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const code = await readFile(new URL('../../apps-script/sheet-write.gs', import.meta.url), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plan = (values, req, today = '2026-10-04') => vm.runInContext('planSheetWrites', ctx)(values, req, today, ymd);
// 測試用假資料，不用真實狗名
const sheet = () => [
  ['板收志工溜狗表', '', '', '', ''],
  ['籠位', '編號', '犬名', '遛狗日期', '誰遛的'],
  ['舊A01', 9001, '測試甲', new Date(2026, 9, 1), '志工乙'],
  ['舊A02', '9002', '測試乙', new Date(2026, 9, 4), '志工丙'],
  ['舊A03', '', '測試丙', '', ''],
  ['舊A04', '9004', '測試丁', new Date(2026, 9, 4), '志工丙、志工我'],
];

test('#138 溜了：日期改今天、誰遛的填我；用編號（數字也行）找狗，沒編號用犬名', () => {
  const out = plan(sheet(), { action: 'walk', walker: '志工我', dogs: [{ id: '9001', name: '測試甲' }, { id: '', name: '測試丙' }] });
  assert.deepEqual(JSON.parse(JSON.stringify(out.cells)), [
    { row: 2, col: 3, date: '2026-10-04' }, { row: 2, col: 4, value: '志工我' },
    { row: 4, col: 3, date: '2026-10-04' }, { row: 4, col: 4, value: '志工我' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(out.results[0])), { id: '9001', name: '測試甲', status: 'written', prev: { date: { date: '2026-10-01' }, walker: '志工乙' }, wrote: { walker: '志工我' } });
  assert.deepEqual(JSON.parse(JSON.stringify(out.results[1].prev)), { date: { text: '' }, walker: '' });
});

test('#138 今天已經有別人：名字接在後面不蓋掉；已經有我就不動；找不到的回 notFound', () => {
  const out = plan(sheet(), { action: 'walk', walker: '志工我', dogs: [{ id: '9002', name: '測試乙' }, { id: '9004', name: '測試丁' }, { id: '9999', name: '不在' }] });
  assert.deepEqual(JSON.parse(JSON.stringify(out.cells)), [{ row: 3, col: 4, value: '志工丙、志工我' }]);
  assert.deepEqual(out.results.map(r => r.status), ['written', 'already', 'notFound']);
});

test('#138 復原：還是我們寫的樣子才寫回原本的日期和名字；被別人改過就不動', () => {
  const values = sheet();
  const walk = plan(values, { action: 'walk', walker: '志工我', dogs: [{ id: '9001', name: '測試甲' }, { id: '9002', name: '測試乙' }] });
  // 模擬寫進去，之後別人又改了測試乙
  values[2][3] = new Date(2026, 9, 4); values[2][4] = '志工我';
  values[3][4] = '志工丙、志工我、志工戊';
  const undo = plan(values, { action: 'undo', dogs: walk.results.map(r => ({ id: r.id, name: r.name, prev: r.prev, wrote: r.wrote })) });
  assert.deepEqual(JSON.parse(JSON.stringify(undo.cells)), [{ row: 2, col: 3, date: '2026-10-01' }, { row: 2, col: 4, value: '志工乙' }]);
  assert.deepEqual(undo.results.map(r => r.status), ['restored', 'changed']);
  // 原本是空的格子寫回空的
  const empty = plan(sheet().map((r, i) => i === 4 ? ['舊A03', '', '測試丙', new Date(2026, 9, 4), '志工我'] : r),
    { action: 'undo', dogs: [{ id: '', name: '測試丙', prev: { date: { text: '' }, walker: '' }, wrote: { walker: '志工我' } }] });
  assert.deepEqual(JSON.parse(JSON.stringify(empty.cells)), [{ row: 4, col: 3, value: '' }, { row: 4, col: 4, value: '' }]);
});

test('#138 表頭找不到就不寫；分隔符號跟同步腳本一樣', async () => {
  assert.match(plan([['a', 'b']], { action: 'walk', walker: '我', dogs: [] }).error, /犬名/);
  assert.match(plan([['犬名', '遛狗日期']], { action: 'walk', walker: '我', dogs: [] }).error, /編號/);
  const sync = await readFile(new URL('../../scripts/sync-sheet.mjs', import.meta.url), 'utf8');
  assert.equal(code.match(/NAME_SEP = (\/.*\/);/)[1], sync.match(/NAME_SEP = (\/.*\/);/)[1]);
});

test('#138 金鑰：沒設 WRITE_KEY 就照常寫；有設就要一樣', () => {
  const run = (props, req) => {
    const writes = [];
    const g = {
      PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      SpreadsheetApp: { openById: () => ({ getSheetByName: () => ({
        getDataRange: () => ({ getValues: () => sheet() }),
        getRange: (r, c) => ({ setValue: v => writes.push([r, c, v]) }),
      }) }) },
      // 「今天」固定成 2026-10-04，其他日期照實轉
      Utilities: { formatDate: d => (Math.abs(d - Date.now()) < 60000 ? '2026-10-04' : ymd(d)) },
    };
    vm.createContext(g);
    vm.runInContext(code, g);
    return { out: JSON.parse(JSON.stringify(g.handleRequest(req))), writes };
  };
  const req = { action: 'walk', walker: '志工我', dogs: [{ id: '9001', name: '測試甲' }] };
  const open = run({ SHEET_ID: 'x' }, req);
  assert.equal(open.out.ok, true);
  assert.equal(open.writes.length, 2);
  const bad = run({ SHEET_ID: 'x', WRITE_KEY: 'k' }, { ...req, key: 'nope' });
  assert.deepEqual([bad.out.code, bad.writes.length], ['key', 0]);
  assert.equal(run({ SHEET_ID: 'x', WRITE_KEY: 'k' }, { ...req, key: 'k' }).out.ok, true);
});

test('#138 SHEET_ID 貼成網址或多了空白也認得', () => {
  const f = vm.runInContext('sheetIdOf', ctx);
  assert.equal(f(' abc_DEF-123 '), 'abc_DEF-123');
  assert.equal(f('https://docs.google.com/spreadsheets/d/abc_DEF-123/edit#gid=0'), 'abc_DEF-123');
});


test('#141 修改只改誰遛的，復原回到編輯前；過期快照不得覆寫別人的修改', () => {
  const values = sheet();
  const dog = { id: '9004', name: '測試丁', expected: '志工丙、志工我' };
  const edited = plan(values, { action: 'edit', walker: '志工丙、志工戊、志工戊', dogs: [dog] });
  assert.deepEqual(JSON.parse(JSON.stringify(edited.cells)), [{ row: 5, col: 4, value: '志工丙、志工戊' }]);
  assert.equal(edited.results[0].prev.walker, dog.expected);
  values[5][4] = '志工丙、志工戊';
  const undone = plan(values, { action: 'undo', dogs: edited.results });
  assert.equal(undone.results[0].status, 'restored');
  assert.equal(undone.cells[1].value, dog.expected);
  const conflict = plan(values, { action: 'edit', walker: '志工我', dogs: [dog] });
  assert.equal(conflict.cells.length, 0);
  assert.equal(conflict.results[0].status, 'changed');
  assert.equal(conflict.results[0].current.walker, '志工丙、志工戊');
});

test('#141 手打日期與多人新增：今天既有姓名保留，不重複、不改日期；already 回傳完整名單', () => {
  const values = sheet(); values[3][3] = '2026/10/4';
  const dog = { id: '9002', name: '測試乙' };
  const out = plan(values, { action: 'walk', walker: '志工丙、志工我、志工戊', dogs: [dog] });
  assert.deepEqual(JSON.parse(JSON.stringify(out.cells)), [{ row: 3, col: 4, value: '志工丙、志工我、志工戊' }]);
  const already = plan(values, { action: 'walk', walker: '志工丙', dogs: [dog] });
  assert.equal(already.cells.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(already.results[0].current)), { date: '2026-10-04', walker: '志工丙' });
});
