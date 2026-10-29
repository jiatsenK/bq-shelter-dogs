// CODING_STANDARDS.md 能機械判斷的規則：程式搬到哪裡都會被抓到，舊的例外也一直列在這裡，不會跟著搬家消失
// 執行：node --test worker/test/standards.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const SRC = new URL('../src/', import.meta.url);
const sources = await Promise.all((await readdir(SRC)).filter(f => f.endsWith('.js'))
  .map(async f => [f, await readFile(new URL(f, SRC), 'utf8')]));

// 「不整張讀」：沒帶 WHERE／LIMIT 的 SELECT、DELETE。SQL 裡有 ${…} 的（條件另外組）不判斷。
// 已知例外：鍵是「檔名: SQL 開頭」，值寫為什麼可以，或要修的票號。修掉就把這一行刪掉。
const FULL_SCAN_OK = {
  'activities.js: SELECT activity_id, activity_date, kind, revision FROM v3_activities': 'readActivities 只在活動版本號變更或 Worker 冷啟動時重建清單；同版本使用記憶體快取',
  "compact.js: SELECT m.row_index, m.dog_id, m.number, m.name, m.cage, m.note, m.walked_date, m.walker_codes, c.sex AS dog_sex, COALESCE(i.intro, '') AS d1_intro, c.fixed_care, es.revision AS edit_revision, p.object_key AS photo_key FROM v3_sheet_main m": 'ADR 0009／0014：readDogsPayload 只在 small 版本變更、需要重建在所資料包時讀取',
  'compact.js: SELECT column_index, label, names FROM v3_sheet_group_columns': 'ADR 0009／0014：readDogsPayload 只在 small 版本變更、需要重建在所資料包時讀取',
  'compact.js: SELECT label, text FROM v3_sheet_changes': 'ADR 0009／0014：readDogsPayload 只在 small 版本變更、需要重建在所資料包時讀取',
  'compact.js: SELECT dog_id,walk_date,walker_code,dog_number,dog_name FROM v3_walks': 'readWalks 僅供離線對照與測試；正式 API 使用 packs.js 按月／按年讀取',
  'dog-list.js: SELECT m.row_index,m.dog_id,m.number,m.name,m.cage,m.note,m.walked_date,m.walker,m.walker_codes,s.revision FROM v3_sheet_main m': 'GAS 編輯觸發／保險掃描補送（≤10 單位一批）才跑；網站讀取與登記不跑，applyGroup 需完整主清單核對狗名（#501）',
  'dog-list.js: SELECT row_index,label,text FROM v3_sheet_changes': 'GAS 只在主清單下方異動紀錄被編輯或掃描發現指紋不同才讀（#501）；只寫有變的段（#554）',
  'identity.js: SELECT volunteer_id,name FROM v3_volunteers': 'linkIdentityName 僅首次遇到尚無對照的代號才核對既有名字（NFKC）；已有代號由 code 索引返回，不在一般身分請求跑',
  'packs.js: SELECT number,name,walked_date,walker_codes FROM v3_sheet_main': '#679 溜狗日期包只在 walked 版本變更、需要重建時讀主清單（約 120 列）；沒變只讀 1 列版本號',
  'packs.js: SELECT year,seq,vers,body FROM v3_walk_summaries': 'ADR 0013：yearSummaries 只在記憶體缺少摘要或月份版本變更才讀，按年存分段摘要，不讀溜狗歷史整表',
  'index.js: SELECT row_index, number, name, walked_date, walker FROM v3_sheet_main': '#519 /walkers 要每隻狗的誰遛的，約 300 列；每個 Worker 1 分鐘最多讀一次（取代每分鐘讀 gviz）',
  'index.js: SELECT dog_key, effective_date, walker FROM v3_walk_state': '#519 同上，最多一隻狗一列',
  'walk-reconcile.js: SELECT s.*,o.status FROM v3_walk_state s': 'scanWalks 只在每日三次 cron 保險掃描跑，用每隻狗 base 值算指紋（ADR 0018）；不在網站請求跑',
};

test('D1 不整張讀：沒帶條件的 SELECT／DELETE 都要列在已知例外', () => {
  const found = new Set();
  for (const [file, code] of sources) {
    for (const [, , sql] of code.matchAll(/(['"`])(\s*(?:SELECT|DELETE)\b(?:(?!\1)[\s\S])*?\bFROM\b[\s\S]*?)\1/g)) {
      if (/\bWHERE\b|\bLIMIT\b|\$\{/i.test(sql)) continue;
      found.add(`${file}: ${sql.trim().replace(/\s+/g, ' ').replace(/( LEFT| CROSS)? (JOIN|ORDER BY|GROUP BY)\b.*$/, '')}`);
    }
  }
  const unlisted = [...found].filter(k => !Object.hasOwn(FULL_SCAN_OK, k));
  assert.deepEqual(unlisted, [], '新的整張讀：改成用 WHERE 對到索引欄位，或附讀寫量測試後列進 FULL_SCAN_OK（CODING_STANDARDS.md）');
  const stale = Object.keys(FULL_SCAN_OK).filter(k => !found.has(k));
  assert.deepEqual(stale, [], '這些例外已經不在程式裡，從 FULL_SCAN_OK 刪掉');
});

test('拆名字只用 sheet-read.js 的 splitNames，不各自 split(NAME_SEP)', () => {
  const own = sources.filter(([file, code]) => file !== 'sheet-read.js' && /\.split\(NAME_SEP\)/.test(code)).map(([file]) => file);
  assert.deepEqual(own, [], '改用 splitNames（會去掉前後空白、空的名字）');
});

// #512：GitHub 同步退役。試算表只由 GAS 讀（編輯觸發、保險掃描），repo 不再有 gviz 讀表或叫同步的路徑
test('#512 不再有 gviz 讀表、舊同步程式；Worker 不 import scripts/', async () => {
  const root = new URL('../../', import.meta.url);
  const read = async dir => Promise.all((await readdir(new URL(dir, root))).filter(f => /\.(mjs|cjs|js)$/.test(f))
    .map(async f => [`${dir}${f}`, await readFile(new URL(`${dir}${f}`, root), 'utf8')]));
  const files = [...await read('worker/src/'), ...await read('scripts/'), ...await read('public/js/')];
  assert.deepEqual(files.map(([f]) => f).filter(f => /^scripts\/(sync-|fixed-care-sync)/.test(f)), [], '舊同步程式已刪');
  assert.deepEqual(files.filter(([, code]) => /\/gviz\/tq|gvizTable|fetchGviz/.test(code)).map(([f]) => f), [], 'gviz 讀表');
  assert.deepEqual(sources.filter(([, code]) => /from '\.\.\/\.\.\/scripts\//.test(code)).map(([f]) => f), [], 'Worker 程式不依賴 scripts/');
});
