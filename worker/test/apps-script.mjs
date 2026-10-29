// 共用 fixture（#748）：vm 載入真的 apps-script/sheet-write.gs，小程式的 UrlFetchApp 接到 worker.fetch（同一個 D1）。
// 今日溜狗紀錄的 sheet 換成 gas.sheet：callSheet 照舊檢查動作、分類錯誤，只把送 HTTP 換成跑這份小程式，
// 測試不用換 globalThis.fetch，也不用自己寫「拿 target → 寫格子 → 送回執」。
//
// 用法：const gas = appsScript(env)；網站登記、排程走 gas.worker（背景派送、寫回重試、保險掃描都叫這份小程式），
// 直接測今日溜狗紀錄 module 就 todayWalks(env, { sheet: gas.sheet })。
// - gas.cell('9001')：表上那隻狗的兩欄（照小程式讀表的方式）；gas.set 人工改格子（沒有通知），gas.edit 改完再跑編輯觸發
// - gas.network(body, deliver)：Worker 到小程式中間的網路，預設直接送；測試換掉來模擬連不上、回應遺失、卡住
// - gas.stopAt(action)／gas.stopAfter(action)：小程式這次執行在呼叫 Worker 的 action 之前／之後中斷（逾時被停掉），表上停在當下
// - gas.cutOff()：下一次送到小程式後 Worker 那邊被停掉，小程式照常跑完、Worker 等不到回應也沒收尾；回傳小程式跑完的 promise
// - gas.beforeWorker(action, body)：小程式每次要呼叫 Worker 前先跑（例如讓時間走到隔天）；gas.sheetError：開試算表時丟的錯（ID 錯、沒權限）
// - gas.calls：Worker 送給小程式的內容；gas.posts：小程式送給 Worker 的呼叫與回應（stopAt 停下沒送出的標 stopped）；
//   gas.resend(post) 把一筆再送一次（晚到的舊回執）
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
export const HEADER = ['編號', '犬名', '遛狗日期', '誰遛的'];
const WORKER_URL = 'https://worker.example';
class Suspend extends Error {}
class Stopped extends Error {}
const clone = value => structuredClone(value);

// rows：主清單表頭下的列（預設表頭 HEADER：編號、犬名、遛狗日期、誰遛的；要測備註、異動紀錄就傳 header 加上籠位、備註）；key：小程式自己的 WRITE_KEY（跟 Worker 的 SHEET_WRITE_KEY 不同就是金鑰錯）；
// onRead(values, n, { full })：這次執行第 n 次讀主清單前呼叫（full：整張讀），用來模擬「讀表之間有人手動改」
export function appsScript(env, { header = HEADER, rows = [['9001', '測試狗', '2026/10/1', '']], key = 'test-secret', onRead } = {}) {
  const col = Object.fromEntries(['編號', '犬名', '遛狗日期', '誰遛的'].map(h => [h, header.indexOf(h)]));
  const state = { values: [[...header], ...rows.map(r => [...r])], props: { SHEET_ID: 'test', WRITE_KEY: key, WALK_WORKER_URL: WORKER_URL }, writes: [], logs: [] };
  const restore = saved => Object.assign(state, clone(saved));
  // 執行中的起點：測試在執行途中人工改表，重跑時也要看得到
  const running = new Set();
  const change = fn => { fn(state); for (const start of running) fn(start); };
  const gas = { calls: [], posts: [], network: (body, deliver) => deliver(), onRead };
  let stop = null, queue = Promise.resolve();

  // 一次執行的小程式環境；attempt 記這次重跑讀到第幾個 Worker 回應、停在哪個呼叫
  function globals(replay, attempt) {
    let scriptLocks = 0;
    // 整張讀（getDataRange）的範圍在 onRead 改過表之後才算
    const read = (r, c, height, width) => {
      const full = height === undefined;
      gas.onRead?.(state.values, ++attempt.reads, { full });
      return state.values.slice(r, full ? undefined : r + height).map(row => row.slice(c, full ? undefined : c + width));
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
    const log = level => (...args) => { if (!attempt.pending) state.logs.push([level, args.map(String).join(' ')]); };
    return {
      console: { log: log('log'), info: log('info'), warn: log('warn'), error: log('error') },
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
        assert.ok(scriptLocks > 0, '呼叫 Worker 要拿著 script lock');
        const request = { url, key: options.headers['X-Sheet-Write-Key'], payload: options.payload };
        if (attempt.i < replay.length) {
          const got = replay[attempt.i++];
          assert.deepEqual(request, got.request, 'Apps Script 重跑送的內容跟上次不同');
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
    try { return await replayed(fn, start, replay); } finally { running.delete(start); }
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
  const rowOf = id => {
    const dog = dogOf(id);
    const found = state.values.findIndex((r, i) => i > 0 && (dog.id ? String(r[col.編號]) === dog.id : !String(r[col.編號]) && r[col.犬名] === dog.name));
    assert.ok(found > 0, `表上沒有 ${id}`);
    return found;
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
  gas.logs = () => clone(state.logs);
  gas.mark = () => state.props.SHEET_EDIT_MARK;
  gas.props = () => clone(state.props);
  gas.replace = rows => change(s => { s.values = [[...header], ...rows.map(r => [...r])]; });
  gas.add = (id, name, date = '2026/10/1', walker = '') => change(s => {
    const row = header.map(() => '');
    Object.assign(row, { [col.編號]: id, [col.犬名]: name, [col.遛狗日期]: date, [col.誰遛的]: walker });
    s.values.push(row);
  });
  gas.cell = id => ({ ...peek(g => g.directWalkCell(g.SpreadsheetApp.openById().getSheetByName('主清單'), dogOf(id)).current) });
  gas.set = (id, { date, walker }) => {
    const r = rowOf(id);
    change(s => {
      if (date !== undefined) s.values[r][col.遛狗日期] = date;
      if (walker !== undefined) s.values[r][col.誰遛的] = walker;
    });
  };
  // 人工改表：改格子後跑編輯觸發（onWalkSheetEdit），範圍是那一列的遛狗日期到誰遛的
  gas.edit = (id, change) => {
    gas.set(id, change);
    const row = rowOf(id) + 1;
    return run(g => g.onWalkSheetEdit({ range: { getSheet: () => g.SpreadsheetApp.openById().getSheetByName('主清單'),
      getRow: () => row, getNumRows: () => 1, getColumn: () => col.遛狗日期 + 1, getLastColumn: () => col.誰遛的 + 1 } }));
  };
  // 直接跑小程式的動作（不經 Worker 的 callSheet），回小程式的回應（轉成 JSON 再讀回，跟走 HTTP 一樣）
  gas.run = async body => JSON.parse(await run(g => JSON.stringify(g.handleRequest(body))));
  gas.resend = async (post, change = {}, key = state.props.WRITE_KEY) => {
    const res = await gas.worker.fetch(new Request(`${WORKER_URL}/api/walk-writeback/${post.action}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sheet-Write-Key': key }, body: JSON.stringify({ ...post.body, ...change }) }), env);
    return { status: res.status, ...await res.json() };
  };
  return gas;
}
