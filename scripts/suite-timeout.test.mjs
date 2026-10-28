import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { withSuiteTimeout } = createRequire(import.meta.url)('./suite-timeout.cjs');

test('網頁測試逾時：套件準時跑完就回傳結果', async () => {
  assert.equal(await withSuiteTimeout('fast', 1000, async () => 'ok'), 'ok');
});

test('網頁測試逾時：套件卡住時在時限內失敗並寫出套件名稱（#713）', async () => {
  const started = Date.now();
  await assert.rejects(withSuiteTimeout('group-walks', 50, () => new Promise(() => {})), /group-walks.*超過 0\.05 秒/);
  assert.ok(Date.now() - started < 1000);
});

test('網頁測試逾時：套件本身失敗照原錯誤回報', async () => {
  await assert.rejects(withSuiteTimeout('broken', 1000, async () => { throw new Error('斷言失敗'); }), /斷言失敗/);
});

test('網頁測試逾時：計時器不讓程序在套件跑完後多等', () => {
  const script = `require(${JSON.stringify(fileURLToPath(new URL('./suite-timeout.cjs', import.meta.url)))}).withSuiteTimeout('x', 60000, async () => 1).then(v => console.log(v));`;
  const started = Date.now();
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '1');
  assert.ok(Date.now() - started < 3000, '套件跑完要清掉計時器，不能讓程序等滿 60 秒');
});
