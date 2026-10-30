// 共用 fixture（#748）：vm 載入真的 apps-script/sheet-write.gs，小程式的 UrlFetchApp 接到 worker.fetch（同一個 D1）。
// 今日溜狗紀錄的 sheet 換成 gas.sheet：callSheet 照舊檢查動作、分類錯誤，只把送 HTTP 換成跑這份小程式，
// 測試不用換 globalThis.fetch，也不用自己寫「拿 target → 寫格子 → 送回執」。
//
// 用法：const gas = appsScript(env)；網站登記、排程走 gas.worker（背景派送、寫回重試、保險掃描都叫這份小程式），
// 直接測今日溜狗紀錄 module 就 todayWalks(env, { sheet: gas.sheet })。
// - gas.cell('9001')：表上那隻狗的兩欄（照小程式讀表的方式）；gas.set 人工改格子（沒有通知），gas.edit 改完再跑編輯觸發
// 管理者改表（#769，#768 從這裡測）：主清單要有籠位欄，人工改表才會送狗清單同步（/dog-list），表頭用 CAGE_HEADER。
//   哪一列（target）：狗的 key（'9001'、'名:犬名'，找第一列）或表上的列號（數字，1 是表頭；清空犬名後、新增列用列號）。
//   改哪幾格（cells）：{ cage, id, name, date, walker, note } 任選，值 '' 是清空這格。
// - gas.edit(target, cells)：一次改一列的幾格（例如犬名和編號一起貼上），跑一次編輯觸發，範圍是改到的欄
//   （只改遛狗日期、誰遛的時範圍固定是這兩欄）；先清空再打字就呼叫兩次（兩次執行）
// - gas.paste(target, [cells, cells…])：從 target 那列往下一次改好幾列，跑一次編輯觸發，範圍涵蓋全部改到的列與欄
// - gas.clear(target)：選整列按 Delete 清空內容，跑編輯觸發（範圍是整列）
// - gas.remove(target)：刪掉整列。Google 刪列只跑「變更時」觸發、不跑「編輯時」觸發，小程式只裝編輯觸發，所以不跑任何執行
// - gas.timer()：跑每 10 分鐘的補送（flushWalkEdits、flushDogList 各自一次執行）
// - gas.scan()：跑保險掃描（dogListScan）
// - gas.during(when, target, cells)：在下一次執行跑到 when 時插入一次人工改表（改格子、換表上變動記號），
//   那次執行結束後再跑這次改表的編輯觸發；那次執行沒跑到 when 就失敗。when：{ afterRead: n }（第 n 次讀主清單之後）或 { after: action }（拿到 Worker
//   這個 action 的回應之後）。例：保險掃描讀表後、送出前有人改表 → gas.during({ afterRead: 1 }, …) 再 gas.scan()
// - gas.idle()：等排在後面的執行（during 插入的編輯觸發）都跑完，那次編輯觸發失敗就丟出錯誤
// - gas.network(body, deliver)：Worker 到小程式中間的網路，預設直接送；測試換掉來模擬連不上、回應遺失、卡住
// - gas.stopAt(action)／gas.stopAfter(action)：小程式這次執行在呼叫 Worker 的 action 之前／之後中斷（逾時被停掉），表上停在當下
// - gas.cutOff()：下一次送到小程式後 Worker 那邊被停掉，小程式照常跑完、Worker 等不到回應也沒收尾；回傳小程式跑完的 promise
// - gas.beforeWorker(action, body)：小程式每次要呼叫 Worker 前先跑（例如讓時間走到隔天）；gas.sheetError：開試算表時丟的錯（ID 錯、沒權限）
// - gas.calls：Worker 送給小程式的內容；gas.posts：小程式送給 Worker 的呼叫與回應（stopAt 停下沒送出的標 stopped）；
//   gas.resend(post) 把一筆再送一次（晚到的舊回執）；gas.run(body) 直接跑小程式的動作（不經 Worker）
//
// 小程式的 UrlFetchApp 是同步的、worker.fetch 是非同步的：每次執行先同步跑，碰到還沒拿到回應的 Worker 呼叫就停下，
// 把表、指令碼屬性還原成這次執行開始時的樣子，等 Worker 回應後從頭重跑；拿過的回應照順序重播，重跑送的內容不同就報錯。
// 一次只跑一個執行（同一把 script lock）。
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createWorker } from '../src/index.js';
import { callSheet } from '../src/sheet-write.js';

const script = new vm.Script(readFileSync(new URL('../../apps-script/sheet-write.gs', import.meta.url), 'utf8'), { filename: 'sheet-write.gs' });
const HEADER = ['編號', '犬名', '遛狗日期', '誰遛的'];
export const CAGE_HEADER = ['籠位', '編號', '犬名', '遛狗日期', '誰遛的', '備註'];
const LABELS = { cage: '籠位', id: '編號', name: '犬名', date: '遛狗日期', walker: '誰遛的', note: '備註' };
const WORKER_URL = 'https://worker.example';
const SHEET_MARK = 'SHEET_EDIT_MARK'; // 小程式的表上變動記號（指令碼屬性）
class Suspend extends Error {}
class Stopped extends Error {}
const clone = value => structuredClone(value);

// rows：主清單表頭下的列（預設表頭 HEADER；要測備註、異動紀錄就傳 header 加上籠位、備註）；
// key：小程式自己的 WRITE_KEY（跟 Worker 的 SHEET_WRITE_KEY 不同就是金鑰錯）；
// onRead(values, n, { full })：這次執行第 n 次讀主清單前呼叫（full：整張讀），用來模擬「讀表之間有人手動改」
export function appsScript(env, { header = HEADER, rows = [['9001', '測試狗', '2026/10/1', '']], key = 'test-secret', onRead } = {}) {
  const col = Object.fromEntries(['編號', '犬名', '遛狗日期', '誰遛的'].map(h => [h, header.indexOf(h)]));
  const state = { values: [[...header], ...rows.map(r => [...r])], props: { SHEET_ID: 'test', WRITE_KEY: key, WALK_WORKER_URL: WORKER_URL }, writes: [] };
  const restore = saved => Object.assign(state, clone(saved));
  // 執行中的起點：測試在執行途中人工改表，重跑時也要看得到
  const running = new Set();
  const change = fn => { fn(state); for (const start of running) fn(start); };
  const colOf = k => { const i = header.indexOf(LABELS[k]); assert.ok(i >= 0, `主清單沒有「${LABELS[k]}」欄`); return i; };
  const gas = { calls: [], posts: [], network: (body, deliver) => deliver(), onRead };
  let stop = null, queue = Promise.resolve(), during = null, followUp = Promise.resolve(), manual = 0;
  // during 的人工改表：只改這次重跑的表（重跑都在同一個時間點再改一次，讀到的內容才一樣）
  const interrupt = (at, attempt) => {
    if (!during || attempt.interrupted) return;
    const { when } = during;
    if ('afterRead' in when ? when.afterRead !== at.read : when.after !== at.action) return;
    attempt.interrupted = during.applied = true;
    during.row = rowOf(during.target);
    writeCells(state, during.row, during.cells);
    state.props[SHEET_MARK] = `manual-${++manual}`;
  };

  // 一次執行的小程式環境；attempt 記這次重跑讀到第幾個 Worker 回應、停在哪個呼叫
  function globals(replay, attempt) {
    let scriptLocks = 0;
    // 整張讀（getDataRange）的範圍在 onRead 改過表之後才算
    const read = (r, c, height, width) => {
      const full = height === undefined;
      const n = ++attempt.reads; // 沒設 onRead 也要算（during 的 afterRead 用）
      gas.onRead?.(state.values, n, { full });
      const values = state.values.slice(r, full ? undefined : r + height).map(row => row.slice(c, full ? undefined : c + width));
      interrupt({ read: n }, attempt);
      return values;
    };
    const main = {
      getName: () => '主清單',
      getLastRow: () => state.values.length,
      getLastColumn: () => state.values[0].length,
      getDataRange: () => ({ getValues: () => read(0, 0) }),
      getRange: (r, c, height = 1, width = 1) => ({
        getValues: () => read(r - 1, c - 1, height, width),
        setValue: value => {
          while (state.values.length < r) state.values.push(state.values[0].map(() => '')); // 寫到表下面新的一列
          state.values[r - 1][c - 1] = value;
          state.writes.push([r, c, value]);
        },
      }),
    };
    const lock = scriptLock => ({ waitLock: () => { if (scriptLock) scriptLocks++; }, tryLock: () => true, releaseLock: () => { if (scriptLock) scriptLocks--; } });
    const quiet = () => {};
    return {
      console: { log: quiet, info: quiet, warn: quiet, error: quiet },
      PropertiesService: { getScriptProperties: () => ({ getProperty: k => state.props[k] ?? null, setProperty: (k, v) => { state.props[k] = String(v); } }) },
      LockService: { getScriptLock: () => lock(true), getUserLock: () => lock(false) },
      SpreadsheetApp: { openById: () => { if (gas.sheetError) throw new Error(gas.sheetError); return { getSheetByName: name => name === '主清單' ? main : null }; }, flush: () => {} },
      ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
      Utilities: { DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
        // Google 回的是有正負號的位元組；日期只用到台灣時區的 yyyy-MM-dd
        computeDigest: (algorithm, text) => [...createHash(algorithm).update(text, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
        formatDate: (date, zone, format) => { assert.deepEqual([zone, format], ['Asia/Taipei', 'yyyy-MM-dd']); return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10); } },
      UrlFetchApp: { fetch(url, options) {
        if (attempt.pending) throw new Suspend();
        // 保險掃描送指紋（dog-list-scan）現在是放開 script lock 後才送（#768 要改成鎖內核對記號再送）
        if (!url.endsWith('/dog-list-scan')) assert.ok(scriptLocks > 0, '呼叫 Worker 要拿著 script lock');
        const request = { url, key: options.headers['X-Sheet-Write-Key'], payload: options.payload };
        if (attempt.i < replay.length) {
          const got = replay[attempt.i++];
          assert.deepEqual(request, got.request, 'Apps Script 重跑送的內容跟上次不同');
          interrupt({ action: url.split('/').pop() }, attempt);
          return { getResponseCode: () => got.status, getContentText: () => got.text };
        }
        attempt.pending = request;
        attempt.paused = clone(state);
        throw new Suspend();
      } },
    };
  }

  // 跑一次執行：fn(小程式的全域) 同步呼叫進入點，例如 g => g.doPost(e)
  async function execute(fn) {
    const start = clone(state), replay = [];
    running.add(start);
    try { return await replayed(fn, start, replay); } finally {
      running.delete(start);
      afterDuring();
    }
  }
  // during 只給下一次執行：改表發生在這次執行裡，這次結束後才輪到那次改表的編輯觸發；沒跑到 when 就是測試寫錯
  function afterDuring() {
    if (!during) return;
    const { applied, when, row, cells } = during;
    during = null;
    assert.ok(applied, `這次執行沒跑到 during 的 ${JSON.stringify(when)}`);
    followUp = run(g => editTrigger(g, row, [cells]));
    followUp.catch(() => {}); // 測試沒呼叫 gas.idle 也不算沒處理的錯誤
  }
  async function replayed(fn, start, replay) {
    for (;;) {
      const attempt = { i: 0, reads: 0, pending: null };
      const context = vm.createContext(globals(replay, attempt));
      script.runInContext(context);
      let out, error;
      try { out = fn(context); } catch (e) { error = e; }
      const { pending } = attempt;
      if (!pending) { if (error) throw error; return out; }
      const action = pending.url.split('/').pop(), halt = stop?.action === action ? stop : null;
      if (halt) stop = null;
      if (halt?.before) {
        gas.posts.push({ action, body: JSON.parse(pending.payload), stopped: true });
        restore(attempt.paused);
        throw new Stopped(`Apps Script 在送 ${action} 前中斷`);
      }
      await gas.beforeWorker?.(action, JSON.parse(pending.payload));
      const res = await gas.worker.fetch(new Request(pending.url, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sheet-Write-Key': pending.key }, body: pending.payload }), env);
      const text = await res.text();
      gas.posts.push({ action, body: JSON.parse(pending.payload), status: res.status, out: JSON.parse(text) });
      if (halt) { restore(attempt.paused); throw new Stopped(`Apps Script 在 ${action} 後中斷`); }
      restore(start);
      replay.push({ request: pending, status: res.status, text });
    }
  }
  const run = fn => { const done = queue.then(() => execute(fn)); queue = done.catch(() => {}); return done; };
  // 不呼叫 Worker 的唯讀小工具（讀格子）
  const peek = fn => {
    const context = vm.createContext(globals([], { i: 0, reads: 0, pending: null }));
    script.runInContext(context);
    return fn(context);
  };
  const dogOf = id => (id.startsWith('名:') ? { id: '', name: id.slice(2) } : { id, name: '' });
  // target → state.values 的索引（列號 n 是索引 n - 1，可以在表的下面）
  const rowOf = id => {
    if (typeof id === 'number') { assert.ok(id > 1, '列號從表頭下一列（2）算'); return id - 1; }
    const dog = dogOf(id);
    const found = state.values.findIndex((r, i) => i > 0 && (dog.id ? String(r[col.編號]) === dog.id : !String(r[col.編號]) && r[col.犬名] === dog.name));
    assert.ok(found > 0, `表上沒有 ${id}`);
    return found;
  };
  const writeCells = (s, r, cells) => {
    while (s.values.length <= r) s.values.push(header.map(() => ''));
    for (const [k, v] of Object.entries(cells)) if (v !== undefined) s.values[r][colOf(k)] = v;
  };
  // 編輯觸發（onWalkSheetEdit）的範圍：從第 r 列（索引）往下 list.length 列；只改遛狗日期、誰遛的時固定是這兩欄
  const editTrigger = (g, r, list, cols) => {
    const keys = [...new Set(list.flatMap(cells => Object.keys(cells)))];
    const walkOnly = keys.every(k => k === 'date' || k === 'walker');
    const picked = cols || (walkOnly ? [col.遛狗日期, col.誰遛的] : keys.map(colOf));
    const first = Math.min(...picked), last = Math.max(...picked);
    const main = g.SpreadsheetApp.openById().getSheetByName('主清單');
    return g.onWalkSheetEdit({ range: { getSheet: () => main, getRow: () => r + 1, getNumRows: () => list.length,
      getColumn: () => first + 1, getLastColumn: () => last + 1 } });
  };

  // Worker 這邊送 HTTP 的方式：先過 gas.network，送到了就跑小程式的 doPost
  gas.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    gas.calls.push(body);
    const deliver = async () => new Response(await run(g => g.doPost({ postData: { contents: init.body } }).text), { headers: { 'Content-Type': 'application/json' } });
    return gas.network(body, deliver);
  };
  gas.sheet = (sheetEnv, body) => callSheet(sheetEnv, body, gas.fetch);
  gas.worker = createWorker({ sheet: gas.sheet });

  gas.cutOff = () => new Promise(ran => {
    const network = gas.network;
    gas.network = (_body, deliver) => { gas.network = network; deliver().catch(() => {}).then(ran); return new Promise(() => {}); };
  });
  gas.stopAt = action => { stop = { action, before: true }; };
  gas.stopAfter = action => { stop = { action, before: false }; };
  gas.values = () => clone(state.values);
  gas.writes = () => clone(state.writes);
  gas.mark = () => state.props.SHEET_EDIT_MARK;
  gas.props = () => clone(state.props);
  gas.replace = rows => change(s => { s.values = [[...header], ...rows.map(r => [...r])]; });
  gas.add = (id, name, date = '2026/10/1', walker = '') => change(s => {
    const row = header.map(() => '');
    Object.assign(row, { [col.編號]: id, [col.犬名]: name, [col.遛狗日期]: date, [col.誰遛的]: walker });
    s.values.push(row);
  });
  gas.cell = id => ({ ...peek(g => g.directWalkCell(g.SpreadsheetApp.openById().getSheetByName('主清單'), dogOf(id)).current) });
  gas.set = (id, cells) => {
    const r = rowOf(id);
    change(s => writeCells(s, r, cells));
  };
  // 人工改表：改格子後跑編輯觸發（onWalkSheetEdit）。列號先找好再改（改犬名、編號後原本的 key 就找不到）
  gas.paste = (id, list) => {
    const r = rowOf(id);
    change(s => list.forEach((cells, i) => writeCells(s, r + i, cells)));
    return run(g => editTrigger(g, r, list));
  };
  gas.edit = (id, cells) => gas.paste(id, [cells]);
  gas.clear = id => {
    const r = rowOf(id);
    change(s => writeCells(s, r, Object.fromEntries(Object.keys(LABELS).filter(k => header.includes(LABELS[k])).map(k => [k, '']))));
    return run(g => editTrigger(g, r, [{}], [0, header.length - 1]));
  };
  gas.remove = id => {
    const r = rowOf(id);
    change(s => { s.values.splice(r, 1); });
  };
  gas.timer = async () => { await run(g => g.flushWalkEdits()); await run(g => g.flushDogList()); };
  gas.scan = () => run(g => g.dogListScan());
  gas.during = (when, id, cells) => { during = { when, target: id, cells }; };
  gas.idle = async () => { await queue; await followUp; };
  // 直接跑小程式的動作（不經 Worker 的 callSheet），回小程式的回應（轉成 JSON 再讀回，跟走 HTTP 一樣）
  gas.run = async body => JSON.parse(await run(g => JSON.stringify(g.handleRequest(body))));
  gas.resend = async (post, override = {}, key = state.props.WRITE_KEY) => {
    const res = await gas.worker.fetch(new Request(`${WORKER_URL}/api/walk-writeback/${post.action}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sheet-Write-Key': key }, body: JSON.stringify({ ...post.body, ...override }) }), env);
    return { status: res.status, ...await res.json() };
  };
  return gas;
}
