import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { DIAGRAMS } from './admin-diagrams.mjs';

// 架構圖事實核對（K 2026-10-28）：圖是手工畫的，程式改了名稱、時間、次數而圖沒跟著改，這裡會失敗。
// 只比得了寫死在設定或程式裡的值；箭頭方向、步驟先後要人看（docs/research/2026-10-28-diagram-auto-sync.md 第 3.3 節）。
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const jsonc = text => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
const TITLES = {
  'architecture': '系統架構', 'data-flows': '各類資料的流向', 'writeback-sequence': '網站登記寫回試算表',
  'sheet-sync-sequence': '試算表改動回到 D1', 'daily-schedule': '一天裡的排程', 'environments': '環境與部署',
};
const text = async name => (await read(`docs/diagrams/${name}.html`)).match(/<body[\s\S]*<\/body>/)[0]
  .replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const shows = async (name, value, why) => {
  assert.ok((await text(name)).includes(value), `「${TITLES[name]}」圖上找不到「${value}」：${why}。請改圖（docs/diagrams/${name}.html）或確認程式是不是改錯了`);
};
const pad = n => String(n).padStart(2, '0');
const twHours = field => field.split(',').map(h => (Number(h) + 8) % 24);

const prod = jsonc(await read('wrangler.jsonc'));
const admin = jsonc(await read('wrangler.admin.jsonc'));
const testSite = jsonc(await read('wrangler.test-site.jsonc'));
const preview = jsonc(await read('wrangler.preview-db.jsonc'));
const worker = await read('worker/src/index.js');
const gas = await read('apps-script/sheet-write.gs');
const [retryCron, scanCron] = prod.triggers.crons;
const gasScans = JSON.parse(gas.match(/(\[\[\d+, \d+\](?:, \[\d+, \d+\])*\])\.forEach\(function \(t\) \{ ScriptApp\.newTrigger\('dogListScan'\)/)[1]);
const scanTimes = twHours(scanCron.split(' ')[1]).map(h => `${pad(h)}:${pad(scanCron.split(' ')[0])}`);
const gasTimes = gasScans.map(([h, m]) => `${pad(h)}:${pad(m)}`);

test('六張圖都在、順序跟管理網站一樣', async () => {
  assert.deepEqual(Object.keys(TITLES), DIAGRAMS);
  for (const name of DIAGRAMS) assert.ok((await read(`docs/diagrams/${name}.html`)).includes(TITLES[name]), name);
});

test('Worker、D1、R2 名稱跟 wrangler 設定一致', async () => {
  for (const name of ['architecture', 'environments']) {
    await shows(name, prod.name, 'wrangler.jsonc 的志工網站 Worker 名稱');
    await shows(name, admin.name, 'wrangler.admin.jsonc 的管理網站 Worker 名稱');
    await shows(name, prod.d1_databases[0].database_name, 'wrangler.jsonc 的正式 D1 名稱');
    await shows(name, prod.r2_buckets[0].bucket_name, 'wrangler.jsonc 的正式照片空間名稱');
  }
  assert.equal(admin.d1_databases[0].database_name, prod.d1_databases[0].database_name, '圖上畫管理網站跟志工網站共用正式 D1');
  assert.equal(admin.r2_buckets[0].bucket_name, prod.r2_buckets[0].bucket_name, '圖上畫管理網站跟志工網站共用正式照片空間');
  await shows('environments', testSite.name, 'wrangler.test-site.jsonc 的測試網站 Worker 名稱');
  await shows('environments', preview.name, 'wrangler.preview-db.jsonc 的 PR 預覽 Worker 名稱');
  await shows('environments', testSite.d1_databases[0].database_name, 'wrangler.test-site.jsonc 的測試 D1 名稱');
  // 圖上框太窄，測試照片空間省略了共同的「bq-shelter-」開頭
  await shows('environments', testSite.r2_buckets[0].bucket_name.replace(/^bq-shelter-/, ''), 'wrangler.test-site.jsonc 的測試照片空間名稱（省略 bq-shelter- 開頭）');
  await shows('writeback-sequence', prod.name, 'wrangler.jsonc 的志工網站 Worker 名稱');
});

test('各環境的排程數量', async () => {
  await shows('environments', `${prod.triggers.crons.length} 個排程`, 'wrangler.jsonc 的 triggers.crons 數量（志工網站）');
  await shows('environments', `${testSite.triggers.crons.length} 個排程`, 'wrangler.test-site.jsonc 的 triggers.crons 數量（測試網站）');
  assert.deepEqual(preview.triggers.crons, [], '「一天裡的排程」寫 PR 預覽沒有排程，wrangler.preview-db.jsonc 卻有');
  assert.equal(admin.triggers, undefined, '「一天裡的排程」寫管理網站沒有排程，wrangler.admin.jsonc 卻有');
  assert.deepEqual(testSite.triggers.crons, [retryCron], '「一天裡的排程」寫測試網站只有每 10 分鐘那條');
  assert.equal(prod.triggers.crons.length, 2, '圖上只畫了寫回重試和今日溜狗保險掃描兩個 Worker 排程');
  assert.ok(worker.includes(`const RETRY_CRON = '${retryCron}'`) && worker.includes(`const SCAN_CRON = '${scanCron}'`), 'worker/src/index.js 的排程常數跟 wrangler.jsonc 不一致');
});

test('寫回重試：每 10 分鐘、每小時 :05 起', async () => {
  const [, start, step] = retryCron.match(/^(\d+)-59\/(\d+) \* \* \* \*$/) || [];
  assert.ok(step, `寫回重試排程 ${retryCron} 不是「每 N 分鐘」的格式，請重畫排程圖`);
  await shows('daily-schedule', `每 ${step} 分鐘（每小時 :${pad(start)} 起）`, `wrangler.jsonc 的寫回重試排程是 ${retryCron}`);
  await shows('writeback-sequence', `每 ${step} 分鐘的排程（每小時 :${pad(start)} 起）`, `wrangler.jsonc 的寫回重試排程是 ${retryCron}`);
  await shows('architecture', `每 ${step} 分鐘重試寫回`, `wrangler.jsonc 的寫回重試排程是 ${retryCron}`);
});

test('今日溜狗保險掃描的台灣時間', async () => {
  for (const time of scanTimes) await shows('daily-schedule', time, `wrangler.jsonc 的掃描排程 ${scanCron}（UTC）換成台灣時間是 ${scanTimes.join('、')}`);
  await shows('architecture', `${scanTimes.join('、')} 掃描今日溜狗`, `wrangler.jsonc 的掃描排程 ${scanCron}（UTC）換成台灣時間是 ${scanTimes.join('、')}`);
});

test('照片垃圾桶：每月 1 日、30 天以上', async () => {
  const { TRASH_DAYS } = await import('../worker/src/r2.js');
  assert.ok(worker.includes('d.getUTCDate() === 1 && d.getUTCHours() === 1'), 'worker/src/index.js 清照片垃圾桶的日子變了，請改「一天裡的排程」「系統架構」兩張圖的「每月 1 日」');
  await shows('daily-schedule', `每月 1 日這次順便清照片垃圾桶（${TRASH_DAYS} 天以上）`, `worker/src/r2.js 的 TRASH_DAYS 是 ${TRASH_DAYS}`);
  await shows('architecture', '每月 1 日清照片垃圾桶', 'worker/src/index.js 的 trashDue');
  await shows('data-flows', `照片垃圾桶每月 1 日清 ${TRASH_DAYS} 天以上的`, `worker/src/r2.js 的 TRASH_DAYS 是 ${TRASH_DAYS}`);
});

test('Apps Script：每 10 分鐘補送、狗清單保險掃描時間、跟 Worker 錯開', async () => {
  const flush = [...gas.matchAll(/newTrigger\('(flushWalkEdits|flushDogList)'\)\.timeBased\(\)\.everyMinutes\((\d+)\)/g)];
  assert.equal(flush.length, 2, 'apps-script/sheet-write.gs 的補送觸發數量變了，請改排程圖');
  for (const [, fn, minutes] of flush) await shows('daily-schedule', `每 ${minutes} 分鐘補送待通知`, `sheet-write.gs 的 ${fn} 每 ${minutes} 分鐘`);
  await shows('architecture', `排程：每 ${flush[0][2]} 分鐘補送`, 'sheet-write.gs 的補送觸發');
  for (const time of gasTimes) await shows('daily-schedule', `約 ${time}`, `sheet-write.gs 的 dogListScan 是 ${gasTimes.join('、')}`);
  await shows('architecture', `約 ${gasTimes.join('、')}`, `sheet-write.gs 的 dogListScan 是 ${gasTimes.join('、')}`);
  await shows('sheet-sync-sequence', `每天約 ${gasTimes.join('、')} 狗清單保險掃描`, `sheet-write.gs 的 dogListScan 是 ${gasTimes.join('、')}`);
  const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const gaps = gasTimes.map((t, i) => minutes(t) - minutes(scanTimes[i]));
  await shows('daily-schedule', `錯開 ${Math.min(...gaps)}～${Math.max(...gaps)} 分鐘`, `Worker ${scanTimes.join('、')} 跟 GAS ${gasTimes.join('、')} 相差 ${gaps.join('、')} 分鐘`);
  // 最後一次掃描到隔天第一次之間最久，圖上寫「約 N 小時」
  const longest = Math.max(...gasTimes.map((t, i) => (minutes(gasTimes[(i + 1) % gasTimes.length]) - minutes(t) + 1440) % 1440));
  await shows('sheet-sync-sequence', `最久約 ${Math.round(longest / 60)} 小時`, `狗清單保險掃描最長間隔 ${Math.floor(longest / 60)} 小時 ${longest % 60} 分`);
});

test('寫回重試間隔與上限', async () => {
  const accept = await read('worker/src/walk-accept.js');
  const { RETRY_LIMIT } = await import('../worker/src/walk-accept.js');
  const delays = JSON.parse(accept.match(/\+ (\[[\d,]+\])\[Math\.min\(failures - 1,\d+\)\] \* 60000/)[1]);
  await shows('writeback-sequence', `間隔 ${delays.join('、')} 分鐘`, `worker/src/walk-accept.js 的重試間隔是 ${delays.join('、')} 分鐘`);
  await shows('writeback-sequence', `第 ${RETRY_LIMIT} 次失敗`, `worker/src/walk-accept.js 的 RETRY_LIMIT 是 ${RETRY_LIMIT}`);
  assert.match(await read('worker/src/walk-retry.js'), /LIMIT 10`\)/, 'worker/src/walk-retry.js 每輪撿的數量變了，請改排程圖「每輪最多 10 隻」');
  await shows('daily-schedule', '每輪最多 10 隻', 'worker/src/walk-retry.js 每輪 LIMIT 10');
  assert.match(accept, /Math\.min\(10, /, 'worker/src/walk-accept.js 合併每批的上限變了，請改寫回圖「每批最多 10 隻」');
  await shows('writeback-sequence', '每批最多 10 隻', 'worker/src/walk-accept.js 合併每批最多 10 隻');
});

test('圖上的寫回端點、GAS 動作與待通知名稱都還在', async () => {
  const routes = JSON.parse(worker.match(/if \((\['\/walk-writeback\/[^\]]+\])\.includes\(path\)\)/)[1].replace(/'/g, '"'));
  for (const name of ['writeback-sequence', 'sheet-sync-sequence']) {
    const drawn = [...(await text(name)).matchAll(/\/(target|receipt|observe|rows|dog-list-scan|dog-list)\b/g)].map(m => `/walk-writeback/${m[1]}`);
    assert.ok(drawn.length, name);
    for (const route of drawn) assert.ok(routes.includes(route), `「${TITLES[name]}」圖上畫了 ${route.replace('/walk-writeback', '')}，但 worker/src/index.js 已經沒有這個端點`);
  }
  const { SHEET_ACTIONS } = await import('../worker/src/sheet-write.js');
  for (const action of ['walkWake', 'walkWakeBatch']) {
    assert.ok(SHEET_ACTIONS.has(action), `寫回圖畫了 GAS 動作 ${action}，但 worker/src/sheet-write.js 的 SHEET_ACTIONS 沒有了`);
    await shows('writeback-sequence', action, 'worker/src/sheet-write.js 的 SHEET_ACTIONS');
  }
  for (const key of ['WALK_EDITS_PENDING', 'DOG_LIST_PENDING']) {
    assert.ok(gas.includes(`'${key}'`), `改表回 D1 圖寫了待通知 ${key}，但 apps-script/sheet-write.gs 沒有了`);
    await shows('sheet-sync-sequence', key, 'apps-script/sheet-write.gs 的待通知名稱');
  }
  await access(new URL('../apps-script/sheet-write.gs', import.meta.url));
  for (const name of ['architecture', 'environments', 'writeback-sequence']) await shows(name, 'sheet-write.gs', 'Apps Script 檔名 apps-script/sheet-write.gs');
});

test('PR 預覽要加 preview 標籤', async () => {
  assert.match(await read('.github/workflows/preview-cloudflare.yml'), /contains\(github\.event\.pull_request\.labels\.\*\.name, 'preview'\)/, '.github/workflows/preview-cloudflare.yml 的預覽標籤變了，請改環境圖');
  await shows('environments', 'PR 加 preview 標籤', '.github/workflows/preview-cloudflare.yml 看 preview 標籤');
});
