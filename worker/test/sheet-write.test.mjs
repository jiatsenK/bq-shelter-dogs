// 寫入試算表小程式（#138，apps-script/sheet-write.gs）的測試：只測不碰 Google 的部分（找表頭、找狗、決定要寫哪些格子）；#597 起 walk／edit／undo 一律回請重新整理
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
const plan = (values, req, today = '2026-10-04') => vm.runInContext('planSheetWrites', ctx)(values, req, today);
// 測試用假資料，不用真實狗名
const sheet = () => [
  ['板收志工溜狗表', '', '', '', ''],
  ['籠位', '編號', '犬名', '遛狗日期', '誰遛的'],
  ['舊A01', 9001, '測試甲', new Date(2026, 9, 1), '志工乙'],
  ['舊A02', '9002', '測試乙', new Date(2026, 9, 4), '志工丙'],
  ['舊A03', '', '測試丙', '', ''],
  ['舊A04', '9004', '測試丁', new Date(2026, 9, 4), '志工丙、志工我'],
];

// 用假的 Google 服務跑 handleRequest：記下寫了哪些格子、有沒有開試算表、有沒有連 Worker
const runHandle = (props, req) => {
  const writes = [], fetched = [];
  let opened = 0;
  const g = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => { opened++; return { getSheetByName: () => ({
      getDataRange: () => ({ getValues: () => sheet() }),
      getRange: (r, c) => ({ setValue: v => writes.push([r, c, v]) }),
    }) }; } },
    UrlFetchApp: { fetch: url => { fetched.push(url); throw new Error('不該連 Worker'); } },
    // 「今天」固定成 2026-10-04，其他日期照實轉
    Utilities: { formatDate: d => (Math.abs(d - Date.now()) < 60000 ? '2026-10-04' : ymd(d)) },
  };
  vm.createContext(g);
  vm.runInContext(code, g);
  return { out: JSON.parse(JSON.stringify(g.handleRequest(req))), writes, opened, fetched };
};

test('#597 舊版直寫 walk／edit／undo 退場：回「請重新整理網頁」，不開試算表、不問 Worker', () => {
  const dogs = [{ id: '9001', name: '測試甲', expected: '志工乙', prev: { date: { text: '' }, walker: '' }, wrote: { walker: '志工我' } }];
  const props = [{ SHEET_ID: 'x' }, { SHEET_ID: 'x', WRITE_KEY: 'k', WALK_WORKER_URL: 'https://worker.example' }];
  for (const p of props) for (const action of ['walk', 'edit', 'undo']) {
    const r = runHandle(p, { action, walker: '志工我', dogs, key: 'k' });
    assert.deepEqual(r.out, { ok: false, error: '已使用新登記流程，請重新整理網頁' }, action);
    assert.deepEqual([r.writes.length, r.opened, r.fetched.length], [0, 0, 0], action);
  }
  assert.match(plan(sheet(), { action: 'walk', walker: '我', dogs: [] }).error, /沒有這個動作/);
});

test('#138 表頭找不到就不寫', () => {
  assert.match(plan([['a', 'b']], { action: 'log', walker: '我', text: 'x' }).error, /犬名/);
});

test('#138 金鑰：沒設 WRITE_KEY 就照常寫；有設就要一樣', () => {
  const req = { action: 'log', walker: '志工我', text: '測試' };
  const open = runHandle({ SHEET_ID: 'x' }, req);
  assert.equal(open.out.ok, true);
  assert.equal(open.writes.length, 2);
  const bad = runHandle({ SHEET_ID: 'x', WRITE_KEY: 'k' }, { ...req, key: 'nope' });
  assert.deepEqual([bad.out.code, bad.writes.length], ['key', 0]);
  assert.equal(runHandle({ SHEET_ID: 'x', WRITE_KEY: 'k' }, { ...req, key: 'k' }).out.ok, true);
});

test('#138 SHEET_ID 貼成網址或多了空白也認得', () => {
  const f = vm.runInContext('sheetIdOf', ctx);
  assert.equal(f(' abc_DEF-123 '), 'abc_DEF-123');
  assert.equal(f('https://docs.google.com/spreadsheets/d/abc_DEF-123/edit#gid=0'), 'abc_DEF-123');
});

// #239、#281：只追加的備註和異動紀錄
const noteSheet = () => [
  ['板收志工溜狗表', '', '', '', '', ''],
  ['籠位', '編號', '犬名', '遛狗日期', '誰遛的', '備註'],
  ['舊A01', 9001, '測試甲', '', '', '怕貓'],
  ['舊A02', '9002', '測試乙', '', '', ''],
  ['', '', '', '', '', ''],
  ['備註1', '1/7測試移籠', '', '', '', ''],
  ['備註 3', '1/9測試', '', '', '', ''],
  ['', '', '', '', '', ''],
];

test('#281 備註：原本有字就接「;日期內容（名字）」，空的不加分號；月日不補 0', () => {
  const a = plan(noteSheet(), { action: 'note', walker: '志工我', text: '今天很乖', dogs: [{ id: '9001', name: '測試甲' }] }, '2026-10-06');
  assert.deepEqual(JSON.parse(JSON.stringify(a.cells)), [{ row: 2, col: 5, value: '怕貓;2026/10/6今天很乖（志工我）' }]);
  const b = plan(noteSheet(), { action: 'note', walker: '志工我', text: '會拉', dogs: [{ id: '9002', name: '測試乙' }] }, '2026-10-16');
  assert.deepEqual(JSON.parse(JSON.stringify(b.cells)), [{ row: 3, col: 5, value: '2026/10/16會拉（志工我）' }]);
  assert.equal(plan(noteSheet(), { action: 'note', walker: '我', text: 'x', dogs: [{ id: '9999', name: '無' }] }).results[0].status, 'notFound');
  assert.match(plan(noteSheet(), { action: 'note', walker: '', text: 'x', dogs: [{ id: '9001', name: '測試甲' }] }).error, /名字/);
});

test('#281 異動紀錄：最後一列的下一列寫「備註N」，N 是現有最大 + 1', () => {
  const out = plan(noteSheet(), { action: 'log', walker: '志工我', text: '測試甲移到B03' }, '2026-10-16');
  assert.deepEqual(JSON.parse(JSON.stringify(out.cells)), [
    { row: 7, col: 0, value: '備註4' }, { row: 7, col: 1, value: '2026/10/16測試甲移到B03（志工我）' },
  ]);
});

// ── #500 有人編輯：只送受影響的列；待通知版本合併、只清同一版本 ──
const fn = name => vm.runInContext(name, ctx);
const plain = v => JSON.parse(JSON.stringify(v));

test('#500 改「誰遛的」一格只排那一列；改籠位標記非溜狗欄位；表頭與空列不算', () => {
  const values = sheet(), header = fn('findHeader')(values);
  assert.deepEqual(plain(fn('editedRows')(values.slice(2, 3), header, 2, 4, 4, 'main')), [{ sheet: 'main', dog: { id: '9001', name: '測試甲' }, other: false }]);
  assert.deepEqual(plain(fn('editedRows')(values.slice(2, 5), header, 2, 0, 0, 'main')).map(e => [e.dog.name, e.other]), [['測試甲', true], ['測試乙', true], ['測試丙', true]]);
  assert.deepEqual(plain(fn('editedRows')(values.slice(0, 3), header, 0, 3, 4, 'main')).map(e => e.dog.name), ['測試甲']);
  assert.deepEqual(plain(fn('editedRows')([['', '', '', '', '']], header, 7, 4, 4, 'main')), []);
});

test('#500 同一隻狗新出現在哪裡就以哪裡為準；版本號遞增', () => {
  let pending = fn('queueEdits')(null, [{ sheet: 'main', dog: { id: '9001', name: '測試甲' }, other: false }]);
  pending = fn('queueEdits')(pending, [{ sheet: 'departed', dog: { id: '9001', name: '測試甲' }, other: true }, { sheet: 'main', dog: { id: '', name: '測試丙' }, other: false }]);
  assert.equal(pending.seq, 3);
  assert.deepEqual(plain(pending.items['9001']), { seq: 2, sheet: 'departed', dog: { id: '9001', name: '測試甲' }, other: true });
  assert.equal(pending.items['名:測試丙'].seq, 3);
});

test('#500 通知確認只清同一版本；送出後又改的新版本留著，沒 ack 的也留著', () => {
  let pending = fn('queueEdits')(null, [{ sheet: 'main', dog: { id: '9001', name: '甲' }, other: false }, { sheet: 'main', dog: { id: '9002', name: '乙' }, other: false }]);
  const sent = Object.keys(pending.items).map(k => ({ key: k, seq: pending.items[k].seq }));
  pending = fn('queueEdits')(pending, [{ sheet: 'main', dog: { id: '9001', name: '甲' }, other: false }]);
  pending = fn('clearSent')(pending, sent, [{ ack: true }, { ack: false }]);
  assert.deepEqual(Object.keys(pending.items).sort(), ['9001', '9002']);
  assert.equal(pending.items['9001'].seq, 3);
  pending = fn('clearSent')(pending, [{ key: '9001', seq: 3 }, { key: '9002', seq: 2 }], [{ ack: true }, { ack: true }]);
  assert.deepEqual(Object.keys(pending.items), []);
});

test('#500 主清單送當下讀到的值；找不到唯一一列或在已出所只送 other', () => {
  const snapshot = [{ dog: { id: '9001', name: '甲' }, current: { date: '2026-10-04', walker: '乙' } },
    { dog: { id: '', name: '重' }, current: { date: '', walker: '' } }, { dog: { id: '', name: '重' }, current: { date: '', walker: '' } }];
  const out = plain(fn('editPayload')(snapshot, [
    { sheet: 'main', dog: { id: '9001', name: '甲' }, other: false },
    { sheet: 'main', dog: { id: '', name: '重' }, other: false },
    { sheet: 'main', dog: { id: '9009', name: '走' }, other: false },
    { sheet: 'departed', dog: { id: '9001', name: '甲' }, other: true },
  ]));
  assert.deepEqual(out[0], { sheet: 'main', dog: { id: '9001', name: '甲' }, other: false, current: { date: '2026-10-04', walker: '乙' } });
  assert.deepEqual(out.slice(1).map(r => [r.sheet, r.other, r.current]), [['main', true, undefined], ['main', true, undefined], ['departed', true, undefined]]);
});

test('#512 小程式不再有 notifyWorker 空殼；重裝觸發器時仍會刪掉留下來的舊觸發器', () => {
  assert.doesNotMatch(code, /function notifyWorker\b/);
  assert.match(code, /'dogListScan', 'notifyWorker'\]\.indexOf\(t\.getHandlerFunction\(\)\)/);
});
