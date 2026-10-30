import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildIndex, README } from './adr-index.mjs';

test('docs/adr/README.md 是最新的：ADR 修訂關係與開關現況都從原始檔產生', async () => {
  const current = await readFile(new URL(`../${README}`, import.meta.url), 'utf8').catch(() => '');
  assert.equal(current.replace(/\r\n/g, '\n'), await buildIndex(), '索引過期，執行 node scripts/adr-index.mjs --write');
});

test('被新 ADR 修訂的舊 ADR 標成先讀新的（0007、0012 → 0018 → 0025 → 0026）', async () => {
  const index = await buildIndex();
  assert.match(index, /\[0007\].*被 \[0018\]/);
  assert.match(index, /\[0012\].*被.*\[0018\]/);
  assert.match(index, /\[0018\].*被 \[0025\]/);
  assert.match(index, /\[0025\].*被 \[0026\]/);
  assert.match(index, /\[0026\].*\| 現行 \|/);
  assert.match(index, /## 網站開關\n\n目前 `public\/js\/site-config\.js` 沒有布林開關/);
});
