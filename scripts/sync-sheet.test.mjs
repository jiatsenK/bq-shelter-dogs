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
    const sheet = u.searchParams.get('sheet'), h = +u.searchParams.get('headers');
    calls.push(`${sheet}:${h}`);
    if (fail === sheet) return new Response('<html>登入</html>', { status: 200 });
    const grid = sheet === '主清單' ? main : groups;
    return new Response(`/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(fakeGviz(grid, h))});`);
  };
  fn.calls = calls;
  return fn;
}

// 模擬 dogs/{編號}.md：甲有狗卡（含性別），其他沒有
const CARDS = { 202101234: '---\nname: 測試狗甲\nid: 202101234\nsex: male\n---\n**很親人**，怕機車。\n' };
function fakeCards() {
  const calls = [];
  const fn = async id => { calls.push(id); return CARDS[id] || ''; };
  fn.calls = calls;
  return fn;
}

test('產生 dogs.json：狗（含狗卡資訊與性別）、可以一起溜；不再輸出籠位清單', async () => {
  const f = fakeFetch();
  const cards = fakeCards();
  const data = await sync.buildData(f, TODAY, cards);
  assert.deepEqual(f.calls.sort(), ['主清單:0', '主清單:7', '常遛狗群:0']);
  assert.deepEqual(cards.calls.sort(), ['202101234', '202102345', '202102346'], '沒編號的狗不讀狗卡');
  assert.deepEqual(data.dogs, [
    { cage: 'C03', id: '202101234', name: '測試狗甲', walkedDate: '2026-09-16', covered: true, walkers: [], note: '', sex: 'male', intro: '很親人，怕機車。' },
    { cage: 'A10', id: '202102345', name: '測試狗乙', walkedDate: '2026-09-22', covered: false, walkers: [], note: '親人', sex: '', intro: '' },
    { cage: 'A2', id: '202102346', name: '測試狗丙', walkedDate: '2026-09-20', covered: false, walkers: [], note: '勿溜', sex: '', intro: '' },
    { cage: '住院區', id: '', name: '測試狗丁', walkedDate: null, covered: false, walkers: [], note: '新狗，原表沒填日期', sex: '', intro: '' },
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
  await sync.buildData(async (url, ...rest) => { urls.push(url); return f(url, ...rest); }, TODAY, fakeCards());
  assert.ok(urls.every(u => u.includes('/d/TEST_SHEET_ID/')), '網址用環境變數的 ID');
  const data = await sync.buildData(fakeFetch(), TODAY, fakeCards());
  assert.ok(!JSON.stringify(data).includes('志工A'), 'dogs.json 裡沒有志工名字');
});

test('欄位被改掉、讀到 0 隻狗時丟錯', async () => {
  const noDate = MAIN.map(r => r.slice(0, 3));
  await assert.rejects(sync.buildData(fakeFetch({ main: noDate }), TODAY), /遛狗日期/);
  const empty = MAIN.slice(0, 7);
  empty.push(['', '', '', '', '', '']);
  await assert.rejects(sync.buildData(fakeFetch({ main: empty }), TODAY), /0 隻狗/);
});

test('資料沒變不寫檔；有變才更新同步時間', async () => {
  const data = await sync.buildData(fakeFetch(), TODAY, fakeCards());
  const first = sync.renderFile(data, '', new Date(2026, 8, 24, 16, 30));
  const parsed = JSON.parse(first);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.syncedAt, '2026-09-24T16:30:00+08:00');
  assert.equal(sync.renderFile(data, first, new Date(2026, 8, 24, 17)), null);
  const changed = { ...data, dogs: data.dogs.map((d, i) => i ? d : { ...d, note: '改過' }) };
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
  const file = sync.renderFile(await sync.buildData(fakeFetch(), TODAY, fakeCards()), '', TODAY);
  const got = fe.parseDogsData(JSON.parse(file));
  const plain = list => list.map(({ sex, intro, walkers, formerIds, ...d }) => ({ ...d, walkedDate: d.walkedDate ? d.walkedDate.toDateString() : null }));
  assert.deepEqual(JSON.parse(JSON.stringify(plain(got.dogs))), JSON.parse(JSON.stringify(plain([...dogs]))));
  assert.deepEqual(got.dogs.map(d => [d.sex, d.intro]), [['♂', '很親人，怕機車。'], ['', ''], ['', ''], ['', '']], '性別符號與狗卡資訊：');
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

// ── 狗卡資訊（dogs/{編號}.md）：原本在 tests/index.html 測前端，改成同步時整理後移到這裡 ──

test('狗卡：去掉 YAML frontmatter，只留內文', () => {
  assert.equal(sync.parseFrontmatterBody('---\nname: 宙斯\ntags: [親人]\n---\n\n很黏人。\n'), '很黏人。');
  assert.equal(sync.parseFrontmatterBody('\uFEFF---\r\nname: 宙斯\r\n---\r\n很黏人。'), '很黏人。', 'BOM 與 Windows 換行');
  assert.equal(sync.parseFrontmatterBody('沒有 frontmatter 的介紹'), '沒有 frontmatter 的介紹');
  assert.equal(sync.parseFrontmatterBody('第一段\n\n---\n\n第二段'), '第一段\n\n---\n\n第二段', '內文中的分隔線不算 frontmatter');
});

test('狗卡：性別只認 frontmatter 的 male／female', () => {
  assert.equal(sync.parseFrontmatterSex('---\nname: 宙斯\nsex: male\n---\n內文'), 'male');
  assert.equal(sync.parseFrontmatterSex('---\nsex: Female\n---\n'), 'female');
  assert.equal(sync.parseFrontmatterSex('---\nsex: 不詳\n---\n'), '');
  assert.equal(sync.parseFrontmatterSex('sex: male'), '', '沒有 frontmatter');
});

test('狗卡：Markdown 符號不原樣露出', () => {
  const md = '# 宙斯\n\n**很親人**，喜歡 *散步*。\n\n- 怕機車\n- 會拉扯\n\n> 小心 __別的公狗__\n\n[領養頁](https://example.com) [[冬冬|好朋友冬冬]] ![照片](a.jpg) `暗號`\n\n---\n\n| 項目 | 說明 |\n|---|---|\n| 體重 | 20kg |';
  const text = sync.markdownToText(md);
  assert.equal(text, '宙斯 很親人，喜歡 散步。 怕機車 會拉扯 小心 別的公狗 領養頁 好朋友冬冬  暗號 項目 說明 體重 20kg');
  assert.doesNotMatch(text, /[*#`\[\]|>]/);
  assert.equal(sync.markdownToText('檔名 dog_01_a 保留'), '檔名 dog_01_a 保留', '底線在字中間不會被吃掉');
});

test('狗卡：同編號只讀一次；讀不到就留空；編號不是英數字不去讀檔', async () => {
  const cards = fakeCards();
  const dogs = await sync.attachDogCards([
    { name: '宙斯', id: '202101234' }, { name: '宙斯二號', id: '202101234' }, { name: '金寶', id: '' },
  ], cards);
  assert.deepEqual(cards.calls, ['202101234']);
  assert.deepEqual(dogs.map(d => [d.name, d.sex, d.intro]), [
    ['宙斯', 'male', '很親人，怕機車。'], ['宙斯二號', 'male', '很親人，怕機車。'], ['金寶', '', ''],
  ]);
  assert.equal(await sync.readDogCardFile('../README'), '');
  assert.equal(await sync.readDogCardFile('0000000000'), '', '沒有這個檔');
  assert.match(await sync.readDogCardFile('2017070102'), /LUCY/, '讀得到 repo 裡的狗卡');
});

// ── #75 同一隻狗兩次入所：舊編號 ──

test('狗卡：舊編號 formerIds 可寫多個，只收英數字、去掉跟自己相同的', async () => {
  assert.deepEqual(sync.parseFrontmatterFormerIds('---\nid: 2026051203\nformerIds: 2018041318\n---\n'), ['2018041318']);
  assert.deepEqual(sync.parseFrontmatterFormerIds('---\nformerIds: [2015010101, 2018041318]\n---\n'), ['2015010101', '2018041318']);
  assert.deepEqual(sync.parseFrontmatterFormerIds('---\nformerIds: 2015010101、2018041318、../x\n---\n'), ['2015010101', '2018041318']);
  assert.deepEqual(sync.parseFrontmatterFormerIds('---\nname: 甲\n---\n'), []);
  assert.deepEqual(sync.parseFrontmatterFormerIds('formerIds: 2018041318'), [], '沒有 frontmatter');
  const read = async id => id === '2026051203' ? '---\nformerIds: 2018041318, 2026051203\n---\n介紹' : '---\nsex: male\n---\n';
  const dogs = await sync.attachDogCards([{ name: '甲', id: '2026051203' }, { name: '乙', id: '2020010101' }], read);
  assert.deepEqual(dogs[0].formerIds, ['2018041318']);
  assert.equal('formerIds' in dogs[1], false, '沒寫舊編號的狗 dogs.json 不多欄位');
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
// 跑一次同步，回傳寫出的檔案，並把結果存回 disk（模擬 repo 裡的 data/）
async function syncOnce(disk, main, now) {
  const data = await sync.buildData(fakeFetch({ main }), now, fakeCards());
  const { writes } = sync.planWrites(data, {
    oldDogsText: disk['dogs.json'] || '',
    oldWalksText: disk['walks.json'] || '',
    oldSnapshotText: disk[`history/${sync.formatDate(now)}.json`] || '',
    oldIndexText: disk['history/index.json'] || '',
    historyDates: Object.keys(disk).filter(k => /^history\/\d{4}-\d{2}-\d{2}\.json$/.test(k)).map(k => k.slice(8, -5)),
  }, now);
  Object.assign(disk, writes);
  return writes;
}
const walksOf = disk => JSON.parse(disk['walks.json']).walks;

test('#56 第一次同步：存當天快照、用目前每隻狗的最後一次遛狗日期建立遛狗紀錄', async () => {
  const disk = {};
  const now = new Date(2026, 8, 25, 9);
  const writes = await syncOnce(disk, MAIN, now);
  assert.deepEqual(Object.keys(writes).sort(), ['dogs.json', 'history/2026-09-25.json', 'history/index.json', 'walks.json']);
  assert.deepEqual(JSON.parse(writes['history/index.json']).dates, ['2026-09-25'], '#60 快照目錄');
  assert.equal(writes['history/2026-09-25.json'], writes['dogs.json'], '快照內容跟 dogs.json 一樣');
  assert.deepEqual(walksOf(disk), [
    { id: '202101234', name: '測試狗甲', date: '2026-09-16' },
    { id: '202102345', name: '測試狗乙', date: '2026-09-22' },
    { id: '202102346', name: '測試狗丙', date: '2026-09-20' },
  ], '沒有遛狗日期的狗（測試狗丁）不記');
});

test('#56 連續兩次同步：有新日期就追加、舊紀錄還在；同一天快照覆蓋成最後一次', async () => {
  const disk = {};
  await syncOnce(disk, MAIN, new Date(2026, 8, 25, 9));
  const firstSnapshot = disk['history/2026-09-25.json'];
  const writes = await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25) } }), new Date(2026, 8, 25, 13));
  assert.deepEqual(Object.keys(writes).sort(), ['dogs.json', 'history/2026-09-25.json', 'walks.json']);
  assert.notEqual(disk['history/2026-09-25.json'], firstSnapshot);
  assert.equal(JSON.parse(disk['history/2026-09-25.json']).dogs[0].walkedDate, '2026-09-25');
  assert.deepEqual(walksOf(disk).map(w => `${w.name} ${w.date}`), [
    '測試狗甲 2026-09-16', '測試狗乙 2026-09-22', '測試狗丙 2026-09-20', '測試狗甲 2026-09-25',
  ]);
});

test('#56 之後換人遛：前一筆紀錄仍在；日期沒變、改早、清空都不追加', async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: '志工A' } }), new Date(2026, 8, 25, 9));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 27), walker: '志工B' } }), new Date(2026, 8, 27, 21));
  assert.deepEqual(walksOf(disk).filter(w => w.name === '測試狗甲').map(w => w.date), ['2026-09-25', '2026-09-27']);

  const before = disk['walks.json'];
  // 日期沒變（只換備註）
  let writes = await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 27), walker: '志工C' } }), new Date(2026, 8, 27, 22));
  assert.equal('walks.json' in writes, false);
  // 有人把日期改早（打錯修正）、清空
  writes = await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 26) }, '測試狗乙': { date: '' } }), new Date(2026, 8, 27, 23));
  assert.equal('walks.json' in writes, false);
  assert.equal(disk['walks.json'], before, '舊紀錄一筆都沒少');
  // 清空後又填回原本記過的日期：同一天不重複記
  writes = await syncOnce(disk, MAIN, new Date(2026, 8, 28, 9));
  assert.equal(walksOf(disk).filter(w => w.name === '測試狗乙').length, 1);
});

test('#56 資料沒變：同一天不寫任何檔；換天只補當天快照', async () => {
  const disk = {};
  await syncOnce(disk, MAIN, new Date(2026, 8, 25, 9));
  assert.deepEqual(await syncOnce(disk, MAIN, new Date(2026, 8, 25, 13)), {});
  const writes = await syncOnce(disk, MAIN, new Date(2026, 8, 26, 9));
  assert.deepEqual(Object.keys(writes).sort(), ['history/2026-09-26.json', 'history/index.json']);
  assert.deepEqual(JSON.parse(writes['history/index.json']).dates, ['2026-09-25', '2026-09-26'], '#60 換天時快照目錄多一天：');
  assert.equal(writes['history/2026-09-26.json'], disk['dogs.json'], '換天的快照就是目前的 dogs.json（同步時間不動）');
});

test('#56 沒編號的狗用犬名比對；walks.json 壞掉時重新建立', async () => {
  const dogs = [{ id: '', name: '無編號狗', walkedDate: '2026-09-25' }];
  assert.deepEqual(sync.newWalks(dogs, [{ id: '', name: '無 編號狗', walkedDate: '2026-09-25' }], []), []);
  assert.deepEqual(sync.newWalks(dogs, [{ id: '', name: '無編號狗', walkedDate: '2026-09-20' }], []),
    [{ id: '', name: '無編號狗', date: '2026-09-25' }]);
  assert.equal(sync.parseWalks('{壞掉'), null);
  assert.deepEqual(JSON.parse(sync.renderWalks([])), { version: 1, walks: [] });
});

test('#56 公開檔案（dogs.json、快照、walks.json）都找不到志工名字', async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗乙': { date: D(2026, 9, 25), walker: '志工B' } }), new Date(2026, 8, 25, 9));
  await syncOnce(disk, mainWith({ '測試狗乙': { date: D(2026, 9, 26), walker: '志工C' } }), new Date(2026, 8, 26, 9));
  for (const [path, text] of Object.entries(disk)) {
    for (const who of ['志工A', '志工B', '志工C']) assert.ok(!text.includes(who), `${path} 不該有 ${who}`);
  }
});

test('#56 workflow 提交時一併加入快照與遛狗紀錄', async () => {
  const yml = await readFile(new URL('../.github/workflows/sync-sheet.yml', import.meta.url), 'utf8');
  assert.match(yml, /git add data\/dogs\.json data\/history data\/walks\.json/);
});

// 假名字（測試用）
const ME = '測試志工我';
const dogOf = (disk, name) => JSON.parse(disk['dogs.json']).dogs.find(d => d.name === name);

test('#97 不再輸出 myWalked／myWalkedDate／mine，workflow 不再帶 MY_NAME', () => withEnv({ WALKER_KEY: KEY, MY_NAME: ME }, async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: ME } }), new Date(2026, 8, 25, 9));
  assert.ok(JSON.parse(disk['dogs.json']).dogs.every(d => !('myWalked' in d) && !('myWalkedDate' in d)));
  assert.ok(walksOf(disk).every(w => !('mine' in w)));
  const yml = await readFile(new URL('../.github/workflows/sync-sheet.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(yml, /MY_NAME/);
}));

test('#97 舊紀錄的 mine 原樣保留、不影響換人判斷', () => withEnv({ WALKER_KEY: KEY }, async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: ME } }), new Date(2026, 8, 25, 9));
  // 模擬 #97 之前的檔案：dogs.json 有 myWalked、紀錄有 mine
  const old = JSON.parse(disk['dogs.json']);
  old.dogs = old.dogs.map(d => ({ ...d, myWalked: d.name === '測試狗甲', myWalkedDate: d.name === '測試狗甲' ? '2026-09-25' : null }));
  disk['dogs.json'] = JSON.stringify(old, null, 2) + '\n';
  disk['walks.json'] = sync.renderWalks(walksOf(disk).map(w => ({ ...w, mine: w.name === '測試狗甲' })));
  const before = disk['walks.json'];
  const writes = await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: ME } }), new Date(2026, 8, 25, 13));
  assert.equal(writes['walks.json'], undefined, '同一個人、同一天不多記');
  assert.equal(disk['walks.json'], before);
  assert.ok(!('myWalked' in dogOf(disk, '測試狗甲')), 'dogs.json 拿掉 myWalked');
}));

test('#60 快照目錄：日期排序去重、忽略不是日期的檔名；已有快照但還沒有目錄時補上', () => {
  const eq_ = assert.deepEqual;
  eq_(JSON.parse(sync.renderHistoryIndex(['2026-09-27', 'index', '2026-09-25', '2026-09-27'])).dates, ['2026-09-25', '2026-09-27']);
  const data = { syncedAt: '', dogs: [], groups: {} };
  const now = new Date(2026, 8, 27, 9);
  const { writes } = sync.planWrites(data, { oldDogsText: 'x', oldWalksText: '{"version":1,"walks":[]}', oldSnapshotText: 'x', historyDates: ['2026-09-25', '2026-09-27'] }, now);
  eq_(JSON.parse(writes['history/index.json']).dates, ['2026-09-25', '2026-09-27']);
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

test('#94 dogs.json 與遛狗紀錄記代號；同一天換人也記一筆；公開檔案沒有名字', () => withEnv({ WALKER_KEY: KEY }, async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: `${ME}、志工B` } }), new Date(2026, 8, 25, 9));
  assert.deepEqual(dogOf(disk, '測試狗甲').walkers, [CODE(ME), CODE('志工B')]);
  assert.deepEqual(dogOf(disk, '測試狗乙').walkers, []);
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: '志工C' } }), new Date(2026, 8, 25, 13));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: '志工C' } }), new Date(2026, 8, 25, 14));
  assert.deepEqual(walksOf(disk).filter(w => w.name === '測試狗甲').map(w => [w.date, w.walkers]), [
    ['2026-09-25', [CODE(ME), CODE('志工B')]],
    ['2026-09-25', [CODE('志工C')]],
  ]);
  for (const [path, text] of Object.entries(disk)) {
    for (const who of [ME, '志工A', '志工B', '志工C', KEY]) assert.ok(!text.includes(who), `${path} 不該有 ${who}`);
  }
}));

test('#94 升級：目前最後一次補上試算表的代號、其他舊紀錄不動；不多記、跑兩次不再改', () => withEnv({ WALKER_KEY: null }, async () => {
  const disk = {};
  // #94 之前：甲 9/16 是我遛的，之後乙 9/22 志工A 遛；丙 9/20 沒人寫
  await syncOnce(disk, mainWith({ '測試狗甲': { walker: ME } }), new Date(2026, 8, 24, 9));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: '志工A' }, '測試狗乙': { walker: '志工A' } }), new Date(2026, 8, 25, 9));
  assert.ok(walksOf(disk).every(w => !('walkers' in w)));
  const before = walksOf(disk);

  await withEnv({ WALKER_KEY: KEY }, async () => {
    const main = mainWith({ '測試狗甲': { date: D(2026, 9, 25), walker: '志工A' }, '測試狗乙': { walker: '志工A' } });
    const writes = await syncOnce(disk, main, new Date(2026, 8, 25, 13));
    assert.ok(writes['walks.json']);
    assert.deepEqual(walksOf(disk).map(w => [w.name, w.date, w.walkers]), [
      ['測試狗甲', '2026-09-16', undefined],
      ['測試狗乙', '2026-09-22', [CODE('志工A')]],
      ['測試狗丙', '2026-09-20', undefined],
      ['測試狗甲', '2026-09-25', [CODE('志工A')]],
    ], '筆數不變，只補目前最後一次的代號');
    assert.equal(walksOf(disk).length, before.length);
    const again = await syncOnce(disk, main, new Date(2026, 8, 25, 14));
    assert.equal(again['walks.json'], undefined, '第二次不用再改');
  });
}));

test('#94 沒設定 WALKER_KEY：同步照常，dogs.json 的 walkers 是空的、紀錄不加 walkers', () => withEnv({ WALKER_KEY: null }, async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗甲': { walker: '志工B' } }), new Date(2026, 8, 25, 9));
  assert.ok(JSON.parse(disk['dogs.json']).dogs.every(d => Array.isArray(d.walkers) && !d.walkers.length));
  assert.ok(walksOf(disk).every(w => !('walkers' in w)));
}));

test('#94 workflow 從 Secret 帶入 WALKER_KEY', async () => {
  const yml = await readFile(new URL('../.github/workflows/sync-sheet.yml', import.meta.url), 'utf8');
  assert.match(yml, /WALKER_KEY: \$\{\{ secrets\.WALKER_KEY \}\}/);
});

test('2026-10-04 誰遛的格子用句號、分號、冒號等隔開也拆成好幾個人；Worker 用同一組分隔符號', async () => {
  for (const text of ['測試志工甲。測試志工乙', '測試志工甲.測試志工乙', '測試志工甲;測試志工乙', '測試志工甲；測試志工乙',
    '測試志工甲:測試志工乙', '測試志工甲｜測試志工乙', '測試志工甲・測試志工乙', '測試志工甲 。 測試志工乙']) {
    assert.ok(sync.walkerCodes(text, KEY).includes(CODE('測試志工乙')), text);
  }
  assert.ok(!sync.walkerCodes('測試志工乙經常', KEY).includes(CODE('測試志工乙')), '分隔符號以外的字還是要整個名字相同');
  assert.deepEqual(sync.walkerCodes('測試志工甲。測試志工乙', KEY), [CODE('測試志工甲'), CODE('測試志工乙')]);
  const src = re => re.match(/NAME_SEP = (\/.*\/);/)[1];
  const worker = await readFile(new URL('../worker/src/index.js', import.meta.url), 'utf8');
  const script = await readFile(new URL('./sync-sheet.mjs', import.meta.url), 'utf8');
  assert.equal(src(worker), src(script), '同步和 Worker 的分隔符號要一樣，不然換出來的代號對不上');
});

test('K 2026-10-05 阿湯：同一天甲 → 甲＋我 → 甲，再記一筆甲，「我溜過」以最後一筆為準；舊檔漏記的也補回', () => withEnv({ WALKER_KEY: KEY }, async () => {
  const disk = {};
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 10, 4), walker: '志工B' } }), new Date(2026, 9, 4, 9));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 10, 4), walker: `志工B、${ME}` } }), new Date(2026, 9, 4, 10));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 10, 4), walker: '志工B' } }), new Date(2026, 9, 4, 11));
  await syncOnce(disk, mainWith({ '測試狗甲': { date: D(2026, 10, 4), walker: '志工B' } }), new Date(2026, 9, 4, 12));
  assert.deepEqual(walksOf(disk).filter(w => w.name === '測試狗甲').map(w => [w.date, [...w.walkers].sort()]), [
    ['2026-10-04', [CODE('志工B')]],
    ['2026-10-04', [CODE('志工B'), CODE(ME)].sort()],
    ['2026-10-04', [CODE('志工B')]],
  ]);
  // 舊檔（修好前）最後一筆停在「有我」：下次同步補一筆現在的
  const all = walksOf(disk);
  const lastA = all.map(w => w.name).lastIndexOf('測試狗甲');
  const walks = all.filter((w, i) => i !== lastA);
  const dogs = [dogOf(disk, '測試狗甲')];
  assert.deepEqual(sync.newWalks(dogs, dogs, walks, KEY).map(w => w.walkers), [[CODE('志工B')]]);
  assert.deepEqual(sync.newWalks(dogs, dogs, walksOf(disk), KEY), [], '已經對上就不再記');
}));
