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
  'activities.js: SELECT activity_id, activity_date, kind, revision FROM v3_activities': '既有，待 #474 確認',
  'activities.js: DELETE FROM v3_activity_guard': '既有，待 #474 確認',
  "compact.js: SELECT m.*, COALESCE(i.intro, '') AS d1_intro, c.fixed_care FROM v3_sheet_main m": '既有，待 #474 確認',
  'compact.js: SELECT row_index, walker_code FROM v3_sheet_main_walkers': '既有，待 #474 確認',
  'compact.js: SELECT column_index, name FROM v3_sheet_groups': '既有，待 #474 確認',
  'compact.js: SELECT label, text FROM v3_sheet_changes': '既有，待 #474 確認',
  'compact.js: SELECT column_index, label FROM v3_sheet_group_labels': '既有，待 #474 確認',
  'compact.js: SELECT name FROM v3_sheet_main': 'mainNameMatcher：POST /groups 每次整張讀主清單，#474 要修',
  'compact.js: SELECT dog_id,walk_date,walker_code,dog_number,dog_name FROM v3_walks': '既有，待 #474 確認',
  'dog-list.js: SELECT row_index,dog_id,number,name,cage,note,walked_date,covered,my_walked,my_walked_date FROM v3_sheet_main': '#501 每批（≤10 列）讀一次主清單約 300 列，取代逐列查詢',
  'dog-list.js: SELECT label,text FROM v3_sheet_changes': '#501 只在異動紀錄被編輯時讀，最多 400 列',
  'dog-list.js: DELETE FROM v3_sheet_changes': '#501 異動紀錄整段換，有變才寫',
  'departed.js: SELECT c.dog_id, g.name, c.departed_date, c.reason FROM v3_departed_cards c': '既有，待 #474 確認',
  'identity.js: SELECT volunteer_id,name FROM v3_volunteers': '既有，待 #474 確認',
  'identity.js: DELETE FROM v3_identity_guard': '既有，待 #474 確認',
  'packs.js: SELECT year,seq,vers,body FROM v3_walk_summaries': '既有，待 #474 確認',
  'index.js: SELECT row_index, number, name, walked_date FROM v3_sheet_main': '#519 /walkers 要每隻狗的誰遛的，約 300 列；每個 Worker 1 分鐘最多讀一次（取代每分鐘讀 gviz）',
  'index.js: SELECT w.row_index, COALESCE(n.name, v.name) AS name FROM v3_sheet_main_walkers w': '#519 同上，主清單名單約數百列',
  'index.js: SELECT dog_key, effective_date, walker FROM v3_walk_state': '#519 同上，最多一隻狗一列',
  'walk-accept.js: DELETE FROM v3_walk_guard': '既有，待 #474 確認',
  'walk-reconcile.js: DELETE FROM v3_walk_guard': '既有，待 #474 確認',
  'walk-reconcile.js: SELECT s.*,o.status FROM v3_walk_state s': '既有，待 #474 確認',
};

test('D1 不整張讀：沒帶條件的 SELECT／DELETE 都要列在已知例外', () => {
  const found = new Set();
  for (const [file, code] of sources) {
    for (const [, , sql] of code.matchAll(/(['"`])(\s*(?:SELECT|DELETE)\b(?:(?!\1)[\s\S])*?\bFROM\b[\s\S]*?)\1/g)) {
      if (/\bWHERE\b|\bLIMIT\b|\$\{/i.test(sql)) continue;
      found.add(`${file}: ${sql.trim().replace(/\s+/g, ' ').replace(/( LEFT)? (JOIN|ORDER BY|GROUP BY)\b.*$/, '')}`);
    }
  }
  const unlisted = [...found].filter(k => !Object.hasOwn(FULL_SCAN_OK, k));
  assert.deepEqual(unlisted, [], '新的整張讀：改成用 WHERE 對到索引欄位，或附讀寫量測試後列進 FULL_SCAN_OK（CODING_STANDARDS.md）');
  const stale = Object.keys(FULL_SCAN_OK).filter(k => !found.has(k));
  assert.deepEqual(stale, [], '這些例外已經不在程式裡，從 FULL_SCAN_OK 刪掉');
});

test('拆名字只用 sheet-read.js 的 splitNames，不各自 split(NAME_SEP)', async () => {
  const files = [...sources, ['scripts/sync-sheet.mjs', await readFile(new URL('../../scripts/sync-sheet.mjs', import.meta.url), 'utf8')]];
  const own = files.filter(([file, code]) => file !== 'sheet-read.js' && /\.split\(NAME_SEP\)/.test(code)).map(([file]) => file);
  assert.deepEqual(own, [], '改用 splitNames（會去掉前後空白、空的名字）');
});
