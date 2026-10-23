// 同步腳本測試：node --test scripts/sync-sheet.test.mjs
// 用模擬 gviz 回應，不連試算表。另外把前端讀 dogs.json 的函式載進來，確認前端讀回來的資料跟同步前一致。
process.env.TZ = 'Asia/Taipei';
// 真的試算表 ID 只放在 GitHub Secret；測試用假的
process.env.SHEET_ID = 'TEST_SHEET_ID';

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
    const sheet = u.searchParams.get('sheet'), h = +u.searchParams.get('headers'), range = u.searchParams.get('range');
    calls.push(`${sheet}:${h}${range ? `:${range}` : ''}`);
    if (fail === sheet || (fail === 'range' && range)) return new Response('<html>登入</html>', { status: 200 });
    let grid = sheet === '主清單' ? main : groups;
    // range=A{起}:Z{迄}：只回那一段（型別也只看那一段，跟真的 gviz 一樣）
    if (range) { const m = /^A(\d+):Z(\d+)$/.exec(range); grid = grid.slice(+m[1] - 1, +m[2]); }
    return new Response(`/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(fakeGviz(grid, h))});`);
  };
  fn.calls = calls;
  return fn;
}

test('讀試算表：狗、可以一起溜；不再輸出籠位清單', async () => {
  const f = fakeFetch();
  const data = await sync.buildData(f, TODAY);
  assert.deepEqual(f.calls.sort(), ['主清單:0', '主清單:7', '常遛狗群:0']);
  assert.deepEqual(data.dogs, [
    { cage: 'C03', id: '202101234', name: '測試狗甲', walkedDate: '2026-09-16', covered: true, myWalked: false, walkers: [], note: '' },
    { cage: 'A10', id: '202102345', name: '測試狗乙', walkedDate: '2026-09-22', covered: false, myWalked: false, walkers: [], note: '親人' },
    { cage: 'A2', id: '202102346', name: '測試狗丙', walkedDate: '2026-09-20', covered: false, myWalked: false, walkers: [], note: '勿溜' },
    { cage: '住院區', id: '', name: '測試狗丁', walkedDate: null, covered: false, myWalked: false, walkers: [], note: '新狗，原表沒填日期' },
  ]);
  assert.equal('cages' in data, false);
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

test('沒設定 SHEET_ID 時丟錯、不去連試算表', async () => {
  const saved = process.env.SHEET_ID;
  delete process.env.SHEET_ID;
  try {
    let called = false;
    await assert.rejects(sync.buildData(async () => { called = true; }, TODAY), /SHEET_ID/);
    assert.equal(called, false);
  } finally { process.env.SHEET_ID = saved; }
});

test('試算表 ID 從環境變數帶入，志工名字不寫進 dogs.json', async () => {
  const f = fakeFetch();
  const urls = [];
  await sync.buildData(async (url, ...rest) => { urls.push(url); return f(url, ...rest); }, TODAY);
  assert.ok(urls.every(u => u.includes('/d/TEST_SHEET_ID/')), '網址用環境變數的 ID');
  const data = await sync.buildData(fakeFetch(), TODAY);
  assert.ok(!JSON.stringify(data).includes('志工A'), 'dogs.json 裡沒有志工名字');
});

test('欄位被改掉、讀到 0 隻狗時丟錯', async () => {
  const noDate = MAIN.map(r => r.slice(0, 3));
  await assert.rejects(sync.buildData(fakeFetch({ main: noDate }), TODAY), /遛狗日期/);
  const empty = MAIN.slice(0, 7);
  empty.push(['', '', '', '', '', '']);
  await assert.rejects(sync.buildData(fakeFetch({ main: empty }), TODAY), /0 隻狗/);
});

// 跟前端比對（#32 起前端只讀 dogs.json）：同步腳本讀到的狗，寫成 dogs.json 再交給前端的 parseDogsData，
// 犬名、籠位、日期、可以一起溜都要跟同步前一樣，日期也不能因為存成文字而差一天
async function loadFrontend() {
  // 這間收容所的設定（js/site-config.js）在網頁上先載入，這裡也接在前面
  const src = (await readFile(new URL('../public/js/dates.js', import.meta.url), 'utf8')) + '\n' + (await readFile(new URL('../public/js/api.js', import.meta.url), 'utf8')) + '\n' + (await readFile(new URL('../public/js/store.js', import.meta.url), 'utf8')) + '\n' + (await readFile(new URL('../public/js/site-config.js', import.meta.url), 'utf8')) + '\n' + (await readFile(new URL('../public/js/detail-viewport.js', import.meta.url), 'utf8')) + '\n' + (await readFile(new URL('../public/js/walk-registration.js', import.meta.url), 'utf8')) + '\n' + (await readFile(new URL('../public/js/walk-flow.js', import.meta.url), 'utf8')) + '\n' + (await readFile(new URL('../public/js/detail-editor.js', import.meta.url), 'utf8')) + '\n' + (await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8'));
  // 只需要函式定義；頁面上的 DOM 事件綁定用空殼擋掉
  const stub = () => new Proxy(function () {}, { get: (t, k) => k in t ? t[k] : k === Symbol.toPrimitive ? () => '' : stub(), apply: () => stub() });
  const ctx = vm.createContext({ window: Object.assign(stub(), { __BQ_TEST__: true }), document: stub(), localStorage: stub(), fetch: undefined, Intl, URL, console });
  vm.runInContext(`${src}\n;globalThis.__fe = { parseDogsData };`, ctx);
  return ctx.__fe;
}

test('前端讀 dogs.json 的結果跟同步腳本讀試算表一致', async () => {
  const fe = await loadFrontend();
  const { dogs } = await sync.loadMainSheet(fakeFetch(), TODAY);
  const groupMap = sync.parseGroups(fakeGviz(GROUPS, 0).table, new Set(dogs.map(d => d.name)));
  // 狗卡已退役：性別、介紹由同步從 D1 補（scripts/sync-compact-plan.mjs），這裡跟它一樣給空的
  const data = await sync.buildData(fakeFetch(), TODAY);
  const file = JSON.stringify({ version: sync.FORMAT_VERSION, syncedAt: sync.formatTimestamp(TODAY), ...data, dogs: data.dogs.map(d => ({ ...d, sex: '', intro: '' })) });
  const got = fe.parseDogsData(JSON.parse(file));
  const plain = list => list.map(({ sex, intro, myWalked, walkers, formerIds, ...d }) => ({ ...d, walkedDate: d.walkedDate ? d.walkedDate.toDateString() : null }));
  assert.deepEqual(JSON.parse(JSON.stringify(plain(got.dogs))), JSON.parse(JSON.stringify(plain([...dogs]))));
  assert.equal(JSON.stringify(got.dogs.map(d => d.formerIds)), '[[],[],[],[]]', '沒寫舊編號的狗是空陣列（#75）：');
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

// 異動紀錄（K 2026-10-10 截圖）：狗的下面，籠位欄寫「備註1」…、編號欄寫內容；第 11 筆起籠位欄空白；備註欄的「ppp」不讀
const MAIN_NOTES = [
  ...MAIN,
  ['', '備註1', '1/7新獨10奈威肛門腺破裂移至新B03休養', '', '', ''],
  ['', '備註2', '2/22 有移動 果果到新A01', '', '', ''],
  ['', '備註9', '5/17有移動\n1.新B03 小樂 移至舊B05', '', 'ppp', ''],
  ['', '', '8/19煙捲咬傷泰森', '', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '10/1阿湯移至C區35', '', '', ''],
];

test('異動紀錄：從第一個「備註」那列讀到底，只讀那一段（編號欄才不會因為上面都是數字被丟掉）', async () => {
  const f = fakeFetch({ main: MAIN_NOTES });
  const data = await sync.buildData(f, TODAY);
  assert.deepEqual(data.sheetNotes, [
    { label: '備註1', text: '1/7新獨10奈威肛門腺破裂移至新B03休養' },
    { label: '備註2', text: '2/22 有移動 果果到新A01' },
    { label: '備註9', text: '5/17有移動\n1.新B03 小樂 移至舊B05' },
    { label: '', text: '8/19煙捲咬傷泰森' },
    { label: '', text: '10/1阿湯移至C區35' },
  ]);
  assert.ok(f.calls.includes(`主清單:0:A15:Z${15 + sync.NOTES_MAX_ROWS}`), f.calls.join());
  assert.equal(data.dogs.length, 4, '備註列不算狗');
});

test('異動紀錄：沒有「備註」列就是空的、不多讀；讀失敗回 null（同步沿用上一次），狗照常', async () => {
  const plain = fakeFetch();
  assert.deepEqual((await sync.buildData(plain, TODAY)).sheetNotes, []);
  assert.equal(plain.calls.some(c => c.split(':').length > 2), false);
  const data = await sync.buildData(fakeFetch({ main: MAIN_NOTES, fail: 'range' }), TODAY);
  assert.equal(data.sheetNotes, null);
  assert.equal(data.dogs.length, 4);
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

test('群名：分頁最下面有字的那一列；數字、狗名不當群名，沒寫是空字串', () => {
  const table = { cols: [{}, {}, {}], rows: [
    { c: [{ v: 2 }, { v: 1 }, { v: 1 }] },
    { c: [{ v: '宙斯' }, { v: '冬冬' }, { v: '金寶' }] },
    { c: [null, null, null] },
    { c: [{ v: '新十' }, null, { v: '金寶' }] },
    { c: [null, null, null] },
  ] };
  assert.deepEqual(sync.parseGroupLabels(table, new Set(['宙斯', '冬冬', '金寶'])), ['新十', '', '']);
});

test('可以一起溜：英文名不分大小寫（試算表 Mini 對到主清單 MINI），用主清單寫法', () => {
  const table = { cols: [{}], rows: [{ c: [{ v: 'Mini' }] }, { c: [{ v: '黑寶' }] }] };
  const map = sync.parseGroups(table, new Set(['MINI', '黑寶']));
  assert.deepEqual([...map['MINI']], ['黑寶']);
  assert.deepEqual([...map['黑寶']], ['MINI']);
});

// ── #56 每日快照與遛狗紀錄 ──

// 模擬主清單換日期：name → 新的遛狗日期（null 表示清空）、walker 換人
function mainWith(changes = {}) {
  return MAIN.map((r, i) => {
    if (i < 7 || !(r[0] in changes)) return r;
    const { date, walker } = changes[r[0]];
    const row = [...r];
    if (date !== undefined) row[3] = date;
    if (walker !== undefined) row[5] = walker;
    return row;
  });
}
// 跑一次同步的溜狗紀錄規則（跟 scripts/sync-compact-plan.mjs 的 planSync 一樣：先補代號、再追加、再算我最後一次），
// 結果存回 disk = { dogs, walks }；回傳 { added, changed }
async function syncOnce(disk, main, now) {
  const data = await sync.buildData(fakeFetch({ main }), now);
  const { walks, changed } = sync.upgradeWalks(disk.walks || null, data.dogs);
  const added = sync.newWalks(data.dogs, disk.dogs || null, walks);
  disk.walks = [...(walks || []), ...added];
  disk.dogs = sync.attachMyWalkedDate(data.dogs, disk.walks);
  return { added, changed };
}
const walksOf = disk => disk.walks;
const untouched = r => !r.changed && !r.added.length;

test('#56 第一次同步：用目前每隻狗的最後一次遛狗日期建立遛狗紀錄', async () => {
  const disk = {};
  const now = new Date(2026, 8, 25, 9);
  await syncOnce(disk, MAIN, now);
  assert.deepEqual(walksOf(disk), [
    { id: '202101234', name: '測試狗甲', date: '2026-09-16', mine: false },
    { id: '202102345', name: '測試狗乙', date: '2026-09-22', mine: false },
    { id: '202102346', name: '測試狗丙', date: '2026-09-20', mine: false },
  ], '沒有遛狗日期的狗（測試狗丁）不記');
});

test('#56 連續兩次同步：有新日期就追加、舊紀錄還在', async () => {
  const disk = {};
  await syncOnce(disk, MAIN, new Date(2026, 8, 25, 9));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25) } }), new Date(2026, 8, 25, 13));
  assert.equal(disk.dogs[0].walkedDate, '2026-09-25');
  assert.deepEqual(walksOf(disk).map(w => `${w.name} ${w.date}`), [
    '測試狗甲 2026-09-16', '測試狗乙 2026-09-22', '測試狗丙 2026-09-20', '測試狗甲 2026-09-25',
  ]);
});

test('#56 之後換人遛：前一筆紀錄仍在；日期沒變、改早、清空都不追加', async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: '志工A' } }), new Date(2026, 8, 25, 9));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 27), walker: '志工B' } }), new Date(2026, 8, 27, 21));
  assert.deepEqual(walksOf(disk).filter(w => w.name === '測試狗甲').map(w => w.date), ['2026-09-25', '2026-09-27']);

  const before = structuredClone(disk.walks);
  // 日期沒變（只換備註）
  let r = await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 27), walker: '志工C' } }), new Date(2026, 8, 27, 22));
  assert.ok(untouched(r));
  // 有人把日期改早（打錯修正）、清空
  r = await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 26) }, '測試狗乙': { date: '' } }), new Date(2026, 8, 27, 23));
  assert.ok(untouched(r));
  assert.deepEqual(disk.walks, before, '舊紀錄一筆都沒少');
  // 清空後又填回原本記過的日期：同一天不重複記
  await syncOnce(disk, MAIN, new Date(2026, 8, 28, 9));
  assert.equal(walksOf(disk).filter(w => w.name === '測試狗乙').length, 1);
});

test('#56 沒編號的狗用犬名比對', async () => {
  const dogs = [{ id: '', name: '無編號狗', walkedDate: '2026-09-25' }];
  assert.deepEqual(sync.newWalks(dogs, [{ id: '', name: '無 編號狗', walkedDate: '2026-09-25' }], []), []);
  assert.deepEqual(sync.newWalks(dogs, [{ id: '', name: '無編號狗', walkedDate: '2026-09-20' }], []),
    [{ id: '', name: '無編號狗', date: '2026-09-25', mine: false }]);
});

test('#56 公開檔案（dogs.json、快照、walks.json）都找不到志工名字', async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗乙': { date: D(2026, 9, 25), walker: '志工B' } }), new Date(2026, 8, 25, 9));
  await syncOnce(disk, mainWith({ '測試狗乙': { date: D(2026, 9, 26), walker: '志工C' } }), new Date(2026, 8, 26, 9));
  for (const [path, text] of Object.entries(disk).map(([k, v]) => [k, JSON.stringify(v)])) {
    for (const who of ['志工A', '志工B', '志工C']) assert.ok(!text.includes(who), `${path} 不該有 ${who}`);
  }
});

test('#56 #251 workflow 只跑寫 D1 的同步，不再提交快照與遛狗紀錄', async () => {
  const yml = await readFile(new URL('../.github/workflows/sync-sheet.yml', import.meta.url), 'utf8');
  assert.match(yml, /node scripts\/sync-compact-d1\.mjs/);
  assert.doesNotMatch(yml, /git add|node scripts\/sync-sheet\.mjs/);
});

// ── #57 是不是我遛的（myWalked） ──
// 假名字；真名只放在 Actions Secret MY_NAME
const ME = '測試志工我';
async function withMyName(value, fn) {
  const saved = process.env.MY_NAME;
  if (value == null) delete process.env.MY_NAME; else process.env.MY_NAME = value;
  try { return await fn(); } finally {
    if (saved == null) delete process.env.MY_NAME; else process.env.MY_NAME = saved;
  }
}
const dogOf = (disk, name) => disk.dogs.find(d => d.name === name);

test('#57 我遛 → myWalked true；之後別人遛 → dogs.json 變 false，walks.json 我那筆仍是 mine', () => withMyName(ME, async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: ME } }), new Date(2026, 8, 25, 9));
  let d = dogOf(disk, '測試狗甲');
  assert.equal(d.myWalked, true);
  assert.equal(d.myWalkedDate, '2026-09-25');
  assert.equal(dogOf(disk, '測試狗乙').myWalked, false);
  assert.equal(dogOf(disk, '測試狗乙').myWalkedDate, null);

  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 27), walker: '志工B' } }), new Date(2026, 8, 27, 9));
  d = dogOf(disk, '測試狗甲');
  assert.equal(d.myWalked, false);
  assert.equal(d.myWalkedDate, '2026-09-25', '我最後一次遛的日期還在');
  assert.deepEqual(walksOf(disk).filter(w => w.name === '測試狗甲').map(w => [w.date, w.mine]),
    [['2026-09-25', true], ['2026-09-27', false]]);
}));

test('#57 同一天換人遛（別人 → 我、我 → 別人）也各記一筆，不重複', () => withMyName(ME, async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗乙': { date: D(2026, 9, 25), walker: '志工B' } }), new Date(2026, 8, 25, 9));
  await syncOnce(disk, mainWith({ '測試狗乙': { date: D(2026, 9, 25), walker: ME } }), new Date(2026, 8, 25, 13));
  await syncOnce(disk, mainWith({ '測試狗乙': { date: D(2026, 9, 25), walker: ME } }), new Date(2026, 8, 25, 21));
  assert.deepEqual(walksOf(disk).filter(w => w.name === '測試狗乙').map(w => [w.date, w.mine]),
    [['2026-09-25', false], ['2026-09-25', true]]);
  assert.equal(dogOf(disk, '測試狗乙').myWalkedDate, '2026-09-25');
}));

test('#57 沒設定 MY_NAME：同步照常，myWalked 都是 false', () => withMyName(null, async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗甲': { walker: ME } }), new Date(2026, 8, 25, 9));
  assert.ok(disk.dogs.every(d => d.myWalked === false && d.myWalkedDate === null));
  assert.ok(walksOf(disk).every(w => w.mine === false));
}));

test('#57 名字比對：去空白、格子裡多人、MY_NAME 多種寫法；部分符合不算', () => {
  const names = sync.myNames(` ${ME}、小我 , `);
  assert.deepEqual(names, [ME, '小我']);
  assert.equal(sync.isMine(ME, names), true);
  assert.equal(sync.isMine('測試 志工我', names), false, '中間多空白會被拆成兩個名字，不算');
  assert.equal(sync.isMine(`志工B、${ME}`, names), true);
  assert.equal(sync.isMine('志工B/小我', names), true);
  assert.equal(sync.isMine('小我們', names), false);
  assert.equal(sync.isMine(`${ME}A`, names), false);
  assert.equal(sync.isMine(ME, []), false);
  assert.equal(sync.isMine('', names), false);
});

test('#57 公開檔案不出現任何志工名字（包含我的）', () => withMyName(ME, async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: ME }, '測試狗乙': { date: D(2026, 9, 25), walker: '志工B' } }), new Date(2026, 8, 25, 9));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 26), walker: '志工C' } }), new Date(2026, 8, 26, 9));
  for (const [path, text] of Object.entries(disk).map(([k, v]) => [k, JSON.stringify(v)])) {
    for (const who of [ME, '志工A', '志工B', '志工C']) assert.ok(!text.includes(who), `${path} 不該有 ${who}`);
  }
}));

test('#57 升級：#56 的舊紀錄（沒有 mine）原樣保留；目前最後一次是我遛的補記一筆 mine', () => withMyName(ME, async () => {
  const disk = {};
  await withMyName(null, () => syncOnce(disk, MAIN, new Date(2026, 8, 25, 9)));
  // 模擬 #56 時期的資料：狗沒有 myWalked，紀錄沒有 mine
  disk.dogs = disk.dogs.map(({ myWalked, myWalkedDate, ...d }) => d);
  disk.walks = disk.walks.map(({ mine, ...w }) => w);
  const oldWalks = structuredClone(disk.walks);

  await syncOnce(disk, mainWith({ '測試狗甲': { walker: ME } }), new Date(2026, 8, 25, 13));
  assert.deepEqual(disk.walks.slice(0, oldWalks.length), oldWalks, '舊紀錄一字不改');
  assert.deepEqual(walksOf(disk).slice(oldWalks.length), [{ id: '202101234', name: '測試狗甲', date: '2026-09-16', mine: true }]);
  assert.equal(dogOf(disk, '測試狗甲').myWalkedDate, '2026-09-16');
}));

test('#57 workflow 從 Secret 帶入 MY_NAME', async () => {
  const yml = await readFile(new URL('../.github/workflows/sync-sheet.yml', import.meta.url), 'utf8');
  assert.match(yml, /MY_NAME: \$\{\{ secrets\.MY_NAME \}\}/);
});

// ── #94 誰遛的代號（walkers）──
// 假密鑰、假名字；真的密鑰只放在 Actions Secret／Worker Secret WALKER_KEY
const KEY = 'test-walker-key';
// 名字 → 代號的測試向量：worker/test/worker.test.mjs 用同一組，確認兩邊算法一樣
const WALKER_VECTORS = [
  ['測試志工我', 'ecdf46de08b4'],
  ['志工 B', '2569554f699b'],
  ['Ａｌｉｃｅ Chen', '0511a0a064fb'],
  ['alicechen', '0511a0a064fb'],
];
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  const set = v => { for (const [k, x] of Object.entries(v)) { if (x == null) delete process.env[k]; else process.env[k] = x; } };
  set(vars);
  try { return await fn(); } finally { set(saved); }
}
const CODE = n => sync.walkerCode(n, KEY);

test('#94 代號：測試向量、全形半形與空白大小寫視為同名、沒密鑰或沒名字是空的', () => {
  for (const [name, code] of WALKER_VECTORS) assert.equal(sync.walkerCode(name, KEY), code, name);
  assert.equal(sync.walkerCode('測試志工我', 'other-key') === 'ecdf46de08b4', false, '換密鑰代號就不同');
  assert.equal(sync.walkerCode('測試志工我', ''), '');
  assert.equal(sync.walkerCode('  ', KEY), '');
  assert.deepEqual(sync.walkerCodes(`志工B、${ME}、志工B`, KEY), [CODE('志工B'), CODE(ME)], '多人、去重');
  assert.deepEqual(sync.walkerCodes('', KEY), []);
  assert.deepEqual(sync.walkerCodes(ME, ''), []);
});

test('#94 dogs.json 與遛狗紀錄記代號；同一天換人也記一筆；公開檔案沒有名字', () => withEnv({ WALKER_KEY: KEY, MY_NAME: ME }, async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: `${ME}、志工B` } }), new Date(2026, 8, 25, 9));
  assert.deepEqual(dogOf(disk, '測試狗甲').walkers, [CODE(ME), CODE('志工B')]);
  assert.deepEqual(dogOf(disk, '測試狗乙').walkers, []);
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: '志工C' } }), new Date(2026, 8, 25, 13));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: '志工C' } }), new Date(2026, 8, 25, 14));
  assert.deepEqual(walksOf(disk).filter(w => w.name === '測試狗甲').map(w => [w.date, w.mine, w.walkers]), [
    ['2026-09-25', true, [CODE(ME), CODE('志工B')]],
    ['2026-09-25', false, [CODE('志工C')]],
  ]);
  for (const [path, text] of Object.entries(disk).map(([k, v]) => [k, JSON.stringify(v)])) {
    for (const who of [ME, '志工A', '志工B', '志工C', KEY]) assert.ok(!text.includes(who), `${path} 不該有 ${who}`);
  }
}));

test('#94 升級：目前最後一次補上試算表的代號、舊的 mine 紀錄補我的代號、別人的舊紀錄不動；不多記、跑兩次不再改', () => withEnv({ WALKER_KEY: null, MY_NAME: ME }, async () => {
  const disk = {};
  // #94 之前：甲 9/16 是我遛的，之後乙 9/22 志工A 遛；丙 9/20 沒人寫
  await syncOnce(disk, mainWith({ '測試狗甲': { walker: ME } }), new Date(2026, 8, 24, 9));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: '志工A' }, '測試狗乙': { walker: '志工A' } }), new Date(2026, 8, 25, 9));
  assert.ok(walksOf(disk).every(w => !('walkers' in w)));
  const before = walksOf(disk);

  await withEnv({ WALKER_KEY: KEY }, async () => {
    const main = mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: '志工A' }, '測試狗乙': { walker: '志工A' } });
    assert.equal((await syncOnce(disk, main, new Date(2026, 8, 25, 13))).changed, true);
    assert.deepEqual(walksOf(disk).map(w => [w.name, w.date, w.mine, w.walkers]), [
      ['測試狗甲', '2026-09-16', true, [CODE(ME)]],
      ['測試狗乙', '2026-09-22', false, [CODE('志工A')]],
      ['測試狗丙', '2026-09-20', false, undefined],
      ['測試狗甲', '2026-09-25', false, [CODE('志工A')]],
    ], '筆數不變，只補代號');
    assert.equal(walksOf(disk).length, before.length);
    const again = await syncOnce(disk, main, new Date(2026, 8, 25, 14));
    assert.ok(untouched(again), '第二次不用再改');
  });
}));

test('#94 沒設定 WALKER_KEY：同步照常，dogs.json 的 walkers 是空的、紀錄不加 walkers', () => withEnv({ WALKER_KEY: null }, async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗甲': { walker: '志工B' } }), new Date(2026, 8, 25, 9));
  assert.ok(disk.dogs.every(d => Array.isArray(d.walkers) && !d.walkers.length));
  assert.ok(walksOf(disk).every(w => !('walkers' in w)));
}));

test('#94 workflow 從 Secret 帶入 WALKER_KEY', async () => {
  const yml = await readFile(new URL('../.github/workflows/sync-sheet.yml', import.meta.url), 'utf8');
  assert.match(yml, /WALKER_KEY: \$\{\{ secrets\.WALKER_KEY \}\}/);
});

test('2026-10-04 誰遛的格子用句號、分號、冒號等隔開也拆成好幾個人；Worker 用同一組分隔符號', async () => {
  const names = sync.myNames('測試志工乙');
  for (const text of ['測試志工甲。測試志工乙', '測試志工甲.測試志工乙', '測試志工甲;測試志工乙', '測試志工甲；測試志工乙',
    '測試志工甲:測試志工乙', '測試志工甲｜測試志工乙', '測試志工甲・測試志工乙', '測試志工甲 。 測試志工乙']) {
    assert.equal(sync.isMine(text, names), true, text);
  }
  assert.equal(sync.isMine('測試志工乙經常', names), false, '分隔符號以外的字還是要整個名字相同');
  assert.deepEqual(sync.walkerCodes('測試志工甲。測試志工乙', KEY), [CODE('測試志工甲'), CODE('測試志工乙')]);
  // 同步和 Worker 的分隔符號要一樣，不然換出來的代號對不上：兩邊都 import worker/src/sheet-read.js 的 splitNames
  for (const file of ['../worker/src/index.js', './sync-sheet.mjs']) {
    const src = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(src, /import \{[^}]*\bsplitNames\b[^}]*\} from '[./]*(worker\/src\/)?sheet-read\.js'/, file);
    assert.doesNotMatch(src, /NAME_SEP = \//, `${file} 不要自己再定義一份`);
  }
});

test('K 2026-10-05 阿湯：同一天甲 → 甲＋我 → 甲，再記一筆甲，「我溜過」以最後一筆為準；舊檔漏記的也補回', () => withEnv({ WALKER_KEY: KEY, MY_NAME: ME }, async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 10, 4), walker: '志工B' } }), new Date(2026, 9, 4, 9));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 10, 4), walker: `志工B、${ME}` } }), new Date(2026, 9, 4, 10));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 10, 4), walker: '志工B' } }), new Date(2026, 9, 4, 11));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 10, 4), walker: '志工B' } }), new Date(2026, 9, 4, 12));
  assert.deepEqual(walksOf(disk).filter(w => w.name === '測試狗甲').map(w => [w.date, w.mine, [...w.walkers].sort()]), [
    ['2026-10-04', false, [CODE('志工B')]],
    ['2026-10-04', true, [CODE('志工B'), CODE(ME)].sort()],
    ['2026-10-04', false, [CODE('志工B')]],
  ]);
  assert.equal(dogOf(disk, '測試狗甲').myWalkedDate, null, '最後一筆不是我，myWalkedDate 不算這天');
  // 舊檔（修好前）最後一筆停在「有我」：下次同步補一筆現在的
  const all = walksOf(disk);
  const lastA = all.map(w => w.name).lastIndexOf('測試狗甲');
  const walks = all.filter((w, i) => i !== lastA);
  const dogs = [dogOf(disk, '測試狗甲')];
  assert.deepEqual(sync.newWalks(dogs, dogs, walks, KEY).map(w => [w.mine, w.walkers]), [[false, [CODE('志工B')]]]);
  assert.deepEqual(sync.newWalks(dogs, dogs, walksOf(disk), KEY), [], '已經對上就不再記');
}));

// ── #162 離所 ──
test('#162 判讀規則：三類關鍵字、否定與還沒定案的字、互相矛盾都標待確認', () => {
  const r = t => sync.classifyDeparture(t);
  assert.deepEqual([r('2026/10/1被認養').reason, r('已被領養').reason, r('送養').reason], ['adopt', 'adopt', 'adopt']);
  assert.deepEqual([r('10/2 安樂死').reason, r('病逝').reason, r('當天使了').reason], ['death', 'death', 'death']);
  assert.deepEqual([r('原主領回').reason, r('轉所').reason, r('逃脫').reason], ['other', 'other', 'other']);
  assert.equal(r('2026/10/1被認養').matched, '被認養');
  for (const t of ['想要認養', '認養未成', '待認養', '有人詢問領養', '認養中', '找領養人', '', '好在沒有攻擊，親人']) {
    assert.equal(r(t).reason, 'unknown', t);
  }
  assert.deepEqual(r('認養後退回').flags, ['unsure']);
  assert.deepEqual(r('試養一週').flags, ['unsure']);
  assert.equal(r('原本要認養，後來病逝').reason, 'unknown');
  assert.deepEqual(r('死亡 認養').flags, ['conflict']);
});

// 仿已出所分頁：表頭在第 2 列、有出所日期欄，也有照抄的遛狗日期欄
const DEPARTED = [
  ['已出所', '', '', '', '', ''],
  ['籠位', '編號', '犬名', '遛狗日期', '出所日期', '備註'],
  ['C區35', 2026021301, '雪寶', D(2026, 9, 30), '', '親人（嘉文）2026/10/1被認養'],
  ['新A08', 2024101903, '仲基', D(2026, 9, 23), D(2026, 9, 26), '過世'],
  ['新A09', 2024101904, '多多', D(2026, 9, 20), D(2026, 9, 28), '認養'],
  ['新A09', 2024101904, '多多', D(2026, 9, 20), D(2026, 9, 28), '病逝'],
  ['C區24', 2026092401, '豆花', '', '', '外宿'],
];
const departedTable = (grid = DEPARTED) => fakeGviz(grid, 2).table;
const OCT8 = new Date(2026, 9, 8, 10);

test('#162 已出所分頁：用編號找那一列；出所日期欄優先，沒有才用關鍵字前面的日期；遛狗日期不算', () => {
  const rows = sync.departedRows(departedTable(), OCT8);
  const j = id => sync.judgeDeparture({ id, name: '' }, rows, OCT8);
  assert.deepEqual([j('2026021301').reason, j('2026021301').date, j('2026021301').dateSource], ['adopt', '2026-10-01', 'note']);
  assert.deepEqual([j('2024101903').reason, j('2024101903').date, j('2024101903').dateSource], ['death', '2026-09-26', 'sheet']);
  assert.deepEqual([j('2026092401').reason, j('2026092401').date], ['unknown', null]);
  assert.deepEqual(j('2024101904').flags, ['duplicate']); // 同一隻兩列寫的不一樣
  assert.deepEqual(j('2099010101').flags, ['not-in-sheet']);
  assert.equal(sync.judgeDeparture({ id: '2024101903' }, null), null); // 讀不到分頁
});

test('#162 讀已出所分頁：先找表頭列再重讀；讀不到回 null、不擋同步', async () => {
  const f = async url => {
    const u = new URL(url);
    if (u.searchParams.get('sheet') !== '已出所') throw new Error('x');
    return new Response(`google.visualization.Query.setResponse(${JSON.stringify(fakeGviz(DEPARTED, +u.searchParams.get('headers')))});`);
  };
  const rows = await sync.loadDepartedRows(f, OCT8);
  assert.equal(sync.judgeDeparture({ id: '2024101903' }, rows, OCT8).dateSource, 'sheet');
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(await sync.loadDepartedRows(async () => { throw new Error('網路'); }, OCT8), null); } finally { console.warn = warn; }
});

test('#162 關鍵字前面的日期只看同一格：備註只寫「過世」時不會拿隔壁的遛狗日期', () => {
  const grid = [['籠位', '編號', '犬名', '遛狗日期', '備註'], ['A1', 2020010101, '阿福', '2026/9/30', '過世']];
  const j = sync.judgeDeparture({ id: '2020010101' }, sync.departedRows(fakeGviz(grid, 1).table, OCT8), OCT8);
  assert.deepEqual([j.reason, j.date], ['death', null]);
});

const dog = (id, name, extra = {}) => ({ cage: 'A1', id, name, walkedDate: '2026-09-20', covered: true, myWalked: true, walkers: ['abc123abc123'], note: '親人', sex: 'male', intro: '入所介紹', myWalkedDate: null, ...extra });

test('#162 第一次從快照補：記下第一次不在主清單的那天、最後一次的樣子；不寫志工代號和已出所原文', () => {
  const snaps = [
    { date: '2026-09-25', dogs: [dog('2026021301', '雪寶'), dog('2024101903', '仲基'), dog('2026092401', '豆花')], groups: { 仲基: ['松果'] } },
    { date: '2026-09-27', dogs: [dog('2026021301', '雪寶'), dog('2026092401', '豆花')], groups: {} },
    { date: '2026-10-01', dogs: [dog('2026092401', '豆花')], groups: {} },
    { date: '2026-10-08', dogs: [dog('2026092401', '豆花')], groups: {} },
  ];
  const list = sync.updateDepartures(null, snaps, sync.departedRows(departedTable(), OCT8), OCT8);
  const text = JSON.stringify(list);
  assert.deepEqual(list.map(e => [e.name, e.reason, e.date, e.seen]), [
    ['雪寶', 'adopt', '2026-10-01', '2026-10-01'],
    ['仲基', 'death', '2026-09-26', '2026-09-27'],
  ]);
  assert.deepEqual(list[1].last, { cage: 'A1', id: '2024101903', name: '仲基', walkedDate: '2026-09-20', note: '親人', sex: 'male', intro: '入所介紹', groups: ['松果'] });
  assert.ok(!text.includes('abc123abc123') && !text.includes('myWalked'));
  assert.ok(!text.includes('2026/10/1被認養')); // 已出所分頁的原文不進 repo
  // 再跑一次結果一樣
  assert.deepEqual(sync.updateDepartures(list, snaps.slice(-2), sync.departedRows(departedTable(), OCT8), OCT8), list);
});

test('#162 之後的同步：新消失的記今天；又回到主清單的刪掉；再入所標新編號；志工後來補原因會改過來', () => {
  const old = [
    { id: '2026092401', name: '豆花', date: '2026-10-02', dateSource: 'seen', seen: '2026-10-02', reason: 'unknown', matched: '', flags: [], last: { id: '2026092401', name: '豆花' } },
    { id: '2020010101', name: '誤刪', date: '2026-10-07', dateSource: 'seen', seen: '2026-10-07', reason: 'unknown', matched: '', flags: [], last: { id: '2020010101', name: '誤刪' } },
  ];
  const grid = DEPARTED.map(r => [...r]);
  grid[6][5] = '外宿後原主領回';
  const prev = [dog('2020010101', '誤刪'), dog('2024101904', '多多'), dog('2020050501', '小白')];
  const now = [dog('2020010101', '誤刪'), dog('2026100801', '小白', { formerIds: ['2026092401'] })];
  const list = sync.updateDepartures(old, [{ date: '2026-10-08', dogs: prev, groups: {} }, { date: '2026-10-08', dogs: now, groups: {} }],
    sync.departedRows(fakeGviz(grid, 2).table, OCT8), OCT8);
  const by = Object.fromEntries(list.map(e => [e.id, e]));
  assert.equal(by['2020010101'], undefined);
  assert.deepEqual([by['2026092401'].reason, by['2026092401'].matched, by['2026092401'].returned], ['other', '原主領回', '2026100801']);
  assert.deepEqual([by['2024101904'].seen, by['2024101904'].flags], ['2026-10-08', ['duplicate']]);
  assert.deepEqual([by['2020050501'].reason, by['2020050501'].flags], ['unknown', ['not-in-sheet']]);
});

test('#162 讀不到已出所分頁：原因沿用上一次；那一列後來不見也不丟掉已判出的原因', () => {
  const old = [{ id: '2024101903', name: '仲基', date: '2026-09-26', dateSource: 'sheet', seen: '2026-09-27', reason: 'death', matched: '過世', flags: [], last: { id: '2024101903', name: '仲基' } }];
  const snaps = [{ date: '2026-10-08', dogs: [], groups: {} }, { date: '2026-10-08', dogs: [], groups: {} }];
  assert.deepEqual(sync.updateDepartures(old, snaps, null, OCT8), old);
  assert.deepEqual(sync.updateDepartures(old, snaps, [], OCT8), old);
});

test('#162 同步程式不寫入試算表（#251 起離所存 D1，見 sync-compact-d1.test.mjs）', async () => {
  const src = await readFile(new URL('./sync-sheet.mjs', import.meta.url), 'utf8');
  assert.ok(!/method:\s*['"]POST/.test(src));
});
