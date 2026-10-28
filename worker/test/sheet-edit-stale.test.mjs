// 人工連改兩格時，較早那次執行晚送舊值（2026-10-27 測試試算表莫莫：先改日期、再改誰遛的，第三版又變回舊名單）
// Apps Script 同一次執行會沿用第一次讀到的表內容；這裡每個 vm context 就是一次執行，讀過的範圍照第一次的內容回。
// 執行：node --test worker/test/sheet-edit-stale.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const source = readFileSync(new URL('../../apps-script/sheet-write.gs', import.meta.url), 'utf8');

function world({ dogs = 1 } = {}) {
  // 測試用假資料，不用真實狗名
  const values = [['籠位', '編號', '犬名', '遛狗日期', '誰遛的', '備註'], ['A01', '9001', '測試狗', '2026/10/14', '志工甲', '']];
  for (let i = 2; i <= dogs; i++) values.push([`A${String(i).padStart(2, '0')}`, String(9000 + i), `測試狗${i}`, '2026/10/14', '志工甲', '']);
  const store = { SHEET_ID: 'test', WRITE_KEY: 'test-secret', WALK_WORKER_URL: 'https://worker.example' };
  const hooks = { fetch: [], wait: [], mark: [] };
  const props = {
    getProperty: k => {
      const v = k in store ? store[k] : null;
      // 讀到記號「之後」才觸發，用來模擬核對完、送出前插進來的寫入
      if (k === 'SHEET_EDIT_MARK') { const hook = hooks.mark.shift(); if (hook) hook(); }
      return v;
    },
    setProperty: (k, v) => { store[k] = String(v); },
  };
  const sent = { rows: [], dogList: [] };
  // 假 Worker 的狗清單複本：單位 → 收過的指紋；dog-list-scan 回指紋不同的單位
  const d1 = {};
  let holder = null;
  const deferred = [];
  const take = name => {
    if (holder && holder !== name) throw new Error('鎖被占用');
    holder = name;
  };
  const release = name => {
    if (holder !== name) return;
    holder = null;
    while (!holder && deferred.length) deferred.shift()();
  };
  const execution = name => {
    const cache = new Map();
    const cached = (key, read) => { if (!cache.has(key)) cache.set(key, read()); return cache.get(key).map(r => [...r]); };
    const sheet = {
      getName: () => '主清單',
      getLastRow: () => values.length,
      getLastColumn: () => values[0].length,
      getDataRange: () => ({ getValues: () => cached('all', () => values.map(r => [...r])) }),
      getRange: (r, c, h = 1, w = 1) => ({
        getValues: () => cached([r, c, h, w].join(), () => values.slice(r - 1, r - 1 + h).map(row => row.slice(c - 1, c - 1 + w))),
      }),
    };
    const lock = {
      waitLock: () => {
        const hook = hooks.wait.shift();
        if (hook) hook(name);
        take(name);
      },
      releaseLock: () => release(name),
    };
    const ctx = vm.createContext({
      console: { warn() {}, info() {} },
      PropertiesService: { getScriptProperties: () => props },
      LockService: { getScriptLock: () => lock, getUserLock: () => ({ waitLock() {}, releaseLock() {} }) },
      SpreadsheetApp: { openById: () => ({ getSheetByName: n => (n === '主清單' ? sheet : null) }), flush() {} },
      Utilities: { DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
        computeDigest: (alg, text) => [...createHash(alg).update(text, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)) },
      UrlFetchApp: { fetch: (url, options) => {
        const body = JSON.parse(options.payload);
        const reply = out => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, ...out }) });
        if (url.endsWith('/dog-list-scan')) {
          return reply({ want: Object.keys(body.fingerprints).filter(k => d1[k] !== body.fingerprints[k]), extra: [] });
        }
        if (url.endsWith('/rows')) sent.rows.push(...body.rows.map(r => ({ by: name, ...r.current })));
        if (url.endsWith('/dog-list')) body.rows.forEach(r => {
          // stale：送出當下表上已經不是這個值（核對完、送出前被別人改了）
          const live = values.find(v => v[1] === r.dog.id);
          sent.dogList.push({ by: name, id: r.dog.id, date: r.date, walker: r.walker, stale: !!live && live[4] !== r.walker });
          d1[`${r.sheet}:${r.dog.id || '名:' + r.dog.name}`] = r.hash;
        });
        const hook = hooks.fetch.shift();
        if (hook) hook(name);
        return reply({ results: body.rows.map(() => ({ ok: true, ack: true })) });
      } },
    });
    vm.runInContext(source, ctx);
    return ctx;
  };
  // 網站寫回（doPost → writeLatestWalk）：拿 script lock 改格子、換記號；鎖被占用就等放鎖後才寫
  const writeback = (row, walker) => {
    const W = execution('W');
    const run = () => {
      take('W');
      try { values[row][4] = walker; W.markSheetChanged(props); } finally { release('W'); }
    };
    if (holder && holder !== 'W') deferred.push(run); else run();
  };
  return { values, sent, hooks, execution, store, writeback, d1 };
}

test('#694 連改兩格：先改的那次執行等鎖後不能再送舊名單，今日溜狗和狗清單最後都是新值', () => {
  const w = world();
  const A = w.execution('A');
  let B;
  const range = (ctx, col) => ({ range: { getSheet: () => ctx.SpreadsheetApp.openById().getSheetByName('主清單'), getRow: () => 2, getNumRows: () => 1, getColumn: () => col, getLastColumn: () => col } });
  // A 送第一批的 HTTP 還沒回來時，K 改了第二格；B 被觸發，讀到新表、排進待通知，但鎖在 A 手上
  w.hooks.fetch.push(() => {
    w.values[1][4] = '志工乙';
    B = w.execution('B');
    B.onWalkSheetEdit(range(B, 5));
  });
  // A 回來、放鎖、要拿第二輪的鎖之前，B 先拿到鎖送出新值
  w.hooks.wait.push(null, null, null, () => B.flushWalkEdits());
  w.values[1][3] = '2026/10/27';
  A.onWalkSheetEdit(range(A, 4));
  B.flushDogList();

  const last = list => list[list.length - 1];
  assert.deepEqual(w.sent.rows.map(r => `${r.by}:${r.date}:${r.walker}`), ['A:2026-10-27:志工甲', 'B:2026-10-27:志工乙']);
  assert.equal(last(w.sent.rows).walker, '志工乙');
  assert.equal(last(w.sent.dogList).walker, '志工乙');
  assert.ok(w.sent.dogList.every(r => r.walker === '志工乙'), '狗清單不能送出舊名單');
  // 都送完，待通知清空
  assert.deepEqual(Object.keys(JSON.parse(w.store.WALK_EDITS_PENDING).items), []);
  assert.deepEqual(Object.keys(JSON.parse(w.store.DOG_LIST_PENDING).items), []);
});

test('沒有別人改表時照常送；每 10 分鐘補送的執行沒有自己的改動也能送', () => {
  const w = world();
  const A = w.execution('A');
  w.values[1][3] = '2026/10/27';
  A.onWalkSheetEdit({ range: { getSheet: () => A.SpreadsheetApp.openById().getSheetByName('主清單'), getRow: () => 2, getNumRows: () => 1, getColumn: () => 4, getLastColumn: () => 4 } });
  assert.deepEqual(w.sent.rows.map(r => r.date), ['2026-10-27']);
  assert.deepEqual(w.sent.dogList.map(r => r.date), ['2026-10-27']);

  // 送不出去留在待通知，之後的定時補送照送
  w.store.WALK_EDITS_PENDING = JSON.stringify({ seq: 5, items: { '9001': { seq: 5, sheet: 'main', dog: { id: '9001', name: '測試狗' }, other: false } } });
  w.execution('T').flushWalkEdits();
  assert.equal(w.sent.rows.length, 2);
  assert.deepEqual(JSON.parse(w.store.WALK_EDITS_PENDING).items, {});
});

test('較早的執行被擋下時，待通知留給較新的執行送，不清掉', () => {
  const w = world();
  const A = w.execution('A');
  w.values[1][4] = '志工乙';
  A.onWalkSheetEdit({ range: { getSheet: () => A.SpreadsheetApp.openById().getSheetByName('主清單'), getRow: () => 2, getNumRows: () => 1, getColumn: () => 5, getLastColumn: () => 5 } });
  w.sent.rows.length = 0;
  // A 讀過表之後又有人改表（或網站寫回改了格子），A 再送就是舊內容
  w.store.WALK_EDITS_PENDING = JSON.stringify({ seq: 9, items: { '9001': { seq: 9, sheet: 'main', dog: { id: '9001', name: '測試狗' }, other: false } } });
  w.store.SHEET_EDIT_MARK = 'someone-else';
  A.flushWalkEdits();
  assert.equal(w.sent.rows.length, 0);
  assert.deepEqual(Object.keys(JSON.parse(w.store.WALK_EDITS_PENDING).items), ['9001']);
  w.execution('T').flushWalkEdits();
  assert.equal(w.sent.rows.length, 1);
});

test('#701 保險掃描核對記號後、送出前網站寫回同一隻狗：不能送出舊名單', () => {
  const w = world();
  const S = w.execution('S');
  // 第 1 次讀記號是讀表前記下，第 2 次是送第一批前核對；核對讀完，網站寫回就來
  w.hooks.mark.push(null, () => w.writeback(1, '志工乙'));
  S.dogListScan();
  assert.equal(w.values[1][4], '志工乙', '網站寫回最後還是要寫進表');
  assert.ok(w.sent.dogList.length > 0);
  assert.deepEqual(w.sent.dogList.filter(r => r.stale), [], '送出的名單要跟送出當下表上一樣');
});

test('狗清單待通知：較早的執行被擋下時保留，交給較新的執行送', () => {
  const w = world();
  const A = w.execution('A');
  w.values[1][4] = '志工乙';
  A.onWalkSheetEdit({ range: { getSheet: () => A.SpreadsheetApp.openById().getSheetByName('主清單'), getRow: () => 2, getNumRows: () => 1, getColumn: () => 5, getLastColumn: () => 5 } });
  w.sent.dogList.length = 0;
  w.store.DOG_LIST_PENDING = JSON.stringify({ seq: 9, items: { 'main:9001': { seq: 9 } } });
  w.store.SHEET_EDIT_MARK = 'someone-else';
  A.flushDogList();
  assert.equal(w.sent.dogList.length, 0);
  assert.deepEqual(Object.keys(JSON.parse(w.store.DOG_LIST_PENDING).items), ['main:9001']);
  w.execution('T').flushDogList();
  assert.deepEqual(w.sent.dogList.map(r => r.id), ['9001']);
  assert.deepEqual(JSON.parse(w.store.DOG_LIST_PENDING).items, {});
});

test('保險掃描中途有人改表就停，下次掃描補送剩下的', () => {
  const w = world({ dogs: 12 });
  // 第一批（10 隻）送出途中有人改表（編輯觸發會換記號）
  w.hooks.fetch.push(() => { w.store.SHEET_EDIT_MARK = 'someone-edited'; });
  w.execution('S1').dogListScan();
  assert.equal(w.sent.dogList.length, 10, '第一批送完就停');
  w.execution('S2').dogListScan();
  assert.equal(w.sent.dogList.length, 12);
  assert.deepEqual(w.sent.dogList.filter(r => r.by === 'S2').map(r => r.id), ['9011', '9012']);
  assert.deepEqual(w.sent.dogList.filter(r => r.stale), []);
});
