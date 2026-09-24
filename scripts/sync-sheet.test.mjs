// 同步腳本測試：node --test scripts/
// 用模擬 gviz 回應，不連試算表。另外把前端的解析函式載進來，確認同步結果跟前端直接讀試算表一致。
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

// 跟前端比對：載入前端原始碼（js/app.js，還沒拆檔時用 index.html 的 <script>），
// 用同一份模擬回應分別跑前端的 loadMainList／parseGroups 與同步腳本，結果要一樣
async function loadFrontend() {
  let src = await readFile(new URL('../js/app.js', import.meta.url), 'utf8').catch(() => null);
  if (src == null) {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  }
  if (!/function loadMainList/.test(src)) return null; // 前端已改讀 dogs.json，不再有解析函式
    // 只需要函式定義；頁面上的 DOM 事件綁定用空殼擋掉
  const stub = () => new Proxy(function () {}, { get: (t, k) => k in t ? t[k] : k === Symbol.toPrimitive ? () => '' : stub(), apply: () => stub() });
  const ctx = vm.createContext({ window: Object.assign(stub(), { __BQ_TEST__: true }), document: stub(), localStorage: stub(), fetch: undefined, Intl, URL, console });
  vm.runInContext(`${src}\n;globalThis.__fe = { loadMainList, parseGroups, sortCages };`, ctx);
  return ctx;
}

test('結果跟前端直接讀試算表一致', async t => {
  const ctx = await loadFrontend();
  if (!ctx) return t.skip('前端已不含試算表解析函式');
  const fe = ctx.__fe;
  // 前端的 cellDate 用當下時間判斷沒寫年份的日期；兩邊都用真實的現在時間
  const now = new Date();
  ctx.fetch = fakeFetch();
  const dogs = await fe.loadMainList();
  const groupTable = fakeGviz(GROUPS, 0).table;
  const groupMap = fe.parseGroups(groupTable, new Set(dogs.map(d => d.name)));
  const cages = fe.sortCages([...new Set([...(dogs.cages || []), ...dogs.map(d => d.cage).filter(Boolean)])]);
  const expected = {
    dogs: dogs.map(d => ({ ...d, walkedDate: sync.formatDate(d.walkedDate) })),
    cages: [...cages],
    groups: Object.fromEntries(Object.entries(groupMap).map(([k, v]) => [k, [...v]])),
  };
  const actual = await sync.buildData(fakeFetch(), now);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
});
