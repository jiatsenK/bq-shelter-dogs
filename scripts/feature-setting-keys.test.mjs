// 功能開關的鍵名分散在後端、志工網站、管理網站與 D1 初始值。志工網站要求鍵數完全相同，
// 後端多一個鍵、前端沒跟上，志工站會判定設定無效而關掉全部編輯與顯示入口；這裡逐份比對。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SETTING_KEYS, RETIRED_KEYS } from '../worker/src/feature-settings.js';
import { SETTING_KEYS as PUBLIC_KEYS } from '../public/js/feature-settings.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const sorted = keys => [...keys].sort();
// 管理網站 settings.js 頂層就碰 DOM，Node 無法匯入；從 groups 的 ['鍵','標籤'] 取出鍵名
const adminKeys = src => [...src.matchAll(/\['(\w+)',\s*'[^']*'\]/g)].map(m => m[1]);
const seedKeys = sql => Object.keys(JSON.parse(sql.match(/v3_feature_settings\(id,revision,values_json\) VALUES\(1,1,'(\{[^']*\})'\)/)[1]));

test('志工網站與後端的功能開關鍵名相同', () => {
  assert.deepEqual(sorted(PUBLIC_KEYS), sorted(SETTING_KEYS));
});

test('管理網站設定頁列出的鍵名與後端相同', async () => {
  const keys = adminKeys(await read('admin/public/js/settings.js'));
  assert.equal(new Set(keys).size, keys.length, '管理網站有重複的鍵');
  assert.deepEqual(sorted(keys), sorted(SETTING_KEYS));
});

// 退役的鍵（RETIRED_KEYS）初始值裡還在、讀的時候拿掉（#639：舊編號併進出入所紀錄）
test('D1 初始設定的鍵名與後端相同', async () => {
  for (const path of ['migrations/0003_feature_settings.sql', 'db/compact-schema.sql']) {
    assert.deepEqual(sorted(seedKeys(await read(path))), sorted([...SETTING_KEYS, ...RETIRED_KEYS]), path);
  }
});
