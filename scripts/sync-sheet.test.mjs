// 同步腳本測試：node --test scripts/
// 用模擬 gviz 回應，不連試算表。另外把前端讀 dogs.json 的函式載進來，確認前端讀回來的資料跟同步前一致。
process.env.TZ = 'Asia/Taipei';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as sync from './sync-sheet.mjs';

// 模擬 gviz（同 tests/index.html）：依每欄多數型別推斷欄位型別，少數型別的格子回成 null；
// headers=N 時前 N 列合併成欄位標題
const D = (y, m, d) => ({ t: 'date', y, m, d });
const typeOf = v => typeof v === 'object' ? 'date' : typeof v === 'number' ? 'number' : 'string';
function fakeGviz(grid, headers) {
  const hdr = grid.slice(0, headers), data = grid.slice(headers);
  const cols = grid[0].map((_, ci) => {
    const cnt = {};
    data.forEach(r => { if (r[ci] !== '') cnt[typeOf(r[ci])] = (cnt[typeOf(r[ci])] || 0) + 1; });
    const type = (Object.entries(cnt).sort((a, b) => b[1] - a[1])[0] || ['string'])[0];
    return { label: hdr.map(r => typeof r[ci] === 'string' ? r[ci] : '').filter(Boolean).join(' '), type };
  });
  const rows = data.map(r => ({ c: r.map((v, ci) => {
    if (v === '') return null;
    if (typeOf(v) !== cols[ci].type) return { v: null };
    if (typeOf(v) === 'date') return { v: `Date(${v.y},${v.m - 1},${v.d})`, f: `${v.y}/${v.m}/${v.d}` };
    return { v };
  }) }));
  return { status: 'ok', table: { cols, rows } };
}

// 仿真實主清單：表頭在第 7 列、欄位順序打亂、有空籠與表尾提示、日期有各種寫法
const MAIN = [
  ['板橋收容所遛狗表', '', '', '', '', ''],
  ['', '', '', '', '', ''], ['說明文字', '', '', '', '', ''], ['', '', '', '', '', ''], ['', '', '', '', '', ''], ['', '', '', '', '', ''],
  ['犬名', ' 籠位 ', '編號', '遛狗日期', '備註', '誰遛的'],
  ['測試狗甲', 'C03', 202101234, D(2026, 9, 16), '', '志工A'],
  ['測試狗乙', 'A10', 202102345, D(2026, 9, 22), '親人', ''],
  ['測試狗丙', 'A2', 202102346, D(2026, 9, 20), '勿溜', ''],
  ['測試狗丁', '住院區', '', '', '新狗，原表沒填日期', ''],
  ['', 'A12', 999, D(2026, 9, 1), '犬名空白', ''],
  ['', '舊A01', '', '', '', ''],
  ['今天週四', '', '', '', '', ''],
];
// 常遛狗群：每一欄是一組（第一欄：甲、丙；第二欄：乙、已離所的狗）
const GROUPS = [
  ['測試狗甲', '測試狗乙'],
  ['測 試狗丙', '已離所的狗'],
  ['1', '測試狗乙'],
];
const TODAY = new Date(2026, 8, 24, 10);

function fakeFetch({ main = MAIN, groups = GROUPS, fail } = {}) {
  const calls = [];
  const fn = async url => {
    const u = new URL(url);
    const sheet = u.searchParams.get('sheet'), h = +u.searchParams.get('headers');
    calls.push(`${sheet}:${h}`);
    if (fail === sheet) return new Response('<html>登入</html>', { status: 200 });
    const grid = sheet === '主清單' ? main : groups;
    return new Response(`/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(fakeGviz(grid, h))});`);
  };
  fn.calls = calls;
  return fn;
}

test('產生 dogs.json：狗、籠位（含空籠）、可以一起溜', async () => {
  const f = fakeFetch();
  const data = await sync.buildData(f, TODAY);
  assert.deepEqual(f.calls.sort(), ['主清單:0', '主清單:7', '常遛狗群:0']);
  assert.deepEqual(data.dogs, [
    { cage: 'C03', id: '202101234', name: '測試狗甲', walkedDate: '2026-09-16', walker: '志工A', note: '' },
    { cage: 'A10', id: '202102345', name: '測試狗乙', walkedDate: '2026-09-22', walker: '', note: '親人' },
    { cage: 'A2', id: '202102346', name: '測試狗丙', walkedDate: '2026-09-20', walker: '', note: '勿溜' },
    { cage: '住院區', id: '', name: '測試狗丁', walkedDate: null, walker: '', note: '新狗，原表沒填日期' },
  ]);
  assert.deepEqual(data.cages, ['A2', 'A10', 'A12', 'C03', '住院區', '舊A01']);
  assert.deepEqual(data.groups, {
    '測試狗甲': ['測試狗丙'],
    '測試狗丙': ['測試狗甲'],
    '測試狗乙': [],
  });
});

test('讀取失敗時丟錯（不產生資料）', async () => {
  await assert.rejects(sync.buildData(fakeFetch({ fail: '主清單' }), TODAY), /主清單/);
  await assert.rejects(sync.buildData(fakeFetch({ fail: '常遛狗群' }), TODAY), /常遛狗群/);
  await assert.rejects(sync.buildData(async () => { throw new Error('ENOTFOUND'); }, TODAY), /連不到/);
  await assert.rejects(sync.buildData(async () => new Response('', { status: 404 }), TODAY), /HTTP 404/);
});

test('欄位被改掉、讀到 0 隻狗時丟錯', async () => {
  const noDate = MAIN.map(r => r.slice(0, 3));
  await assert.rejects(sync.buildData(fakeFetch({ main: noDate }), TODAY), /遛狗日期/);
  const empty = MAIN.slice(0, 7);
  empty.push(['', '', '', '', '', '']);
  await assert.rejects(sync.buildData(fakeFetch({ main: empty }), TODAY), /0 隻狗/);
});

test('資料沒變不寫檔；有變才更新同步時間', async () => {
  const data = await sync.buildData(fakeFetch(), TODAY);
  const first = sync.renderFile(data, '', new Date(2026, 8, 24, 16, 30));
  const parsed = JSON.parse(first);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.syncedAt, '2026-09-24T16:30:00+08:00');
  assert.equal(sync.renderFile(data, first, new Date(2026, 8, 24, 17)), null);
  const changed = { ...data, dogs: data.dogs.map((d, i) => i ? d : { ...d, walker: '志工B' }) };
  const second = sync.renderFile(changed, first, new Date(2026, 8, 24, 17));
  assert.equal(JSON.parse(second).syncedAt, '2026-09-24T17:00:00+08:00');
  assert.ok(sync.renderFile(data, '{壞掉', TODAY), '舊檔壞掉時直接覆蓋');
});

// 跟前端比對（#32 起前端只讀 dogs.json）：同步腳本讀到的狗，寫成 dogs.json 再交給前端的 parseDogsData，
// 犬名、籠位、日期、可以一起溜都要跟同步前一樣，日期也不能因為存成文字而差一天
async function loadFrontend() {
  const src = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  // 只需要函式定義；頁面上的 DOM 事件綁定用空殼擋掉
  const stub = () => new Proxy(function () {}, { get: (t, k) => k in t ? t[k] : k === Symbol.toPrimitive ? () => '' : stub(), apply: () => stub() });
  const ctx = vm.createContext({ window: Object.assign(stub(), { __BQ_TEST__: true }), document: stub(), localStorage: stub(), fetch: undefined, Intl, URL, console });
  vm.runInContext(`${src}\n;globalThis.__fe = { parseDogsData };`, ctx);
  return ctx.__fe;
}

test('前端讀 dogs.json 的結果跟同步腳本讀試算表一致', async () => {
  const fe = await loadFrontend();
  const dogs = await sync.loadMainList(fakeFetch(), TODAY);
  const groupMap = sync.parseGroups(fakeGviz(GROUPS, 0).table, new Set(dogs.map(d => d.name)));
  const file = sync.renderFile(await sync.buildData(fakeFetch(), TODAY), '', TODAY);
  const got = fe.parseDogsData(JSON.parse(file));
  const plain = list => list.map(d => ({ ...d, walkedDate: d.walkedDate ? d.walkedDate.toDateString() : null }));
  assert.deepEqual(JSON.parse(JSON.stringify(plain(got.dogs))), JSON.parse(JSON.stringify(plain([...dogs]))));
  const sets = m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]));
  assert.deepEqual(JSON.parse(JSON.stringify(sets(got.groups))), sets(groupMap));
  assert.equal(got.syncedAt.getTime(), Math.floor(TODAY.getTime() / 1000) * 1000);
});

// #32 前端改讀 dogs.json 後，試算表解析只剩同步腳本在做；原本 tests/index.html 對前端解析函式的測試移到這裡
const ymd = d => d ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` : null;

test('日期格式：Date(...)、各種文字寫法、民國年、沒寫年份、日期序號', () => {
  assert.equal(ymd(sync.cellDate({ v: 'Date(2026,8,16)' }, TODAY)), '2026/9/16');
  assert.equal(ymd(sync.cellDate({ v: '2026/9/1' }, TODAY)), '2026/9/1');
  assert.equal(ymd(sync.cellDate({ v: '2026-09-01' }, TODAY)), '2026/9/1');
  assert.equal(ymd(sync.cellDate({ v: '2026.9.1' }, TODAY)), '2026/9/1');
  assert.equal(ymd(sync.cellDate({ v: '2026年9月1日' }, TODAY)), '2026/9/1');
  assert.equal(ymd(sync.cellDate({ v: '115/9/1' }, TODAY)), '2026/9/1');
  assert.equal(ymd(sync.cellDate({ v: '9/1' }, TODAY)), '2026/9/1');
  assert.equal(ymd(sync.cellDate({ v: '12/28' }, TODAY)), '2025/12/28', '沒寫年份又落在未來時算去年');
  assert.equal(ymd(sync.cellDate({ v: 46266 }, TODAY)), '2026/9/1', '試算表日期序號');
});

test('不存在或不合理的日期回空值', () => {
  assert.equal(sync.cellDate({ v: 'Date(2026,1,30)' }, TODAY), null);
  assert.equal(sync.cellDate({ v: '2026/2/30' }, TODAY), null);
  assert.equal(sync.cellDate({ v: '2026/9/100' }, TODAY), null);
  assert.equal(sync.cellDate({ v: '不詳' }, TODAY), null);
  assert.equal(sync.cellDate(null, TODAY), null);
});

test('headers=0 時「編號」「遛狗日期」表頭會被吃掉，所以要先找表頭列再重讀', () => {
  const raw = fakeGviz(MAIN, 0).table;
  assert.equal(sync.findHeaderRow(raw), 6);
  const labels = raw.rows[6].c.map(sync.cellText);
  assert.equal(labels[2], ''); assert.equal(labels[3], '');
});

test('欄位標題缺漏時，用第一次讀到的表頭列補', () => {
  const table = fakeGviz(MAIN, 7).table;
  table.cols[3].label = '';
  const headerTexts = ['犬名', '籠位', '編號', '遛狗日期', '備註', '誰遛的'];
  assert.equal(ymd(sync.parseMainList(table, headerTexts, TODAY)[0].walkedDate), '2026/9/16');
});

test('可以一起溜：一隻狗在多組時合併去重；犬名多了空白（含全形空白）也對得到，用主清單寫法', () => {
  const table = { cols: [{}, {}, {}], rows: [
    { c: [{ v: '宙斯' }, { v: '宙斯' }, { v: '冬冬' }] },
    { c: [{ v: '冬　冬' }, { v: '比 比' }, { v: '金寶' }] },
    { c: [null, { v: '冬冬' }, { v: '已離所' }] },
  ] };
  const map = sync.parseGroups(table, new Set(['宙斯', '冬冬', '比比', '金寶']));
  assert.deepEqual([...map['宙斯']].sort(), ['冬冬', '比比'].sort());
  assert.deepEqual([...map['冬冬']].sort(), ['宙斯', '比比', '金寶'].sort());
  assert.deepEqual([...map['金寶']], ['冬冬']);
  assert.equal(map['已離所'], undefined);
});
