import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./run-browser-tests.cjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', timeout: 5000 });
test('網頁測試 CLI：未安裝瀏覽器也可查詢套件與說明', () => {
  const list = run('--list');
  assert.equal(list.status, 0, list.stderr);
  assert.ok(list.stdout.split(/\r?\n/).includes('startup-stability'));
  assert.ok(list.stdout.split(/\r?\n/).includes('index'));
  const help = run('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--only/);
});
test('網頁測試 CLI：錯字、空套件與任意路徑會失敗，不誤跑整套', () => {
  for (const args of [['--only'], ['--only', ''], ['--only', '../index'], ['--only', 'startup-stability,typo'], ['--typo']]) {
    const result = run(...args);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, /未知套件|請用/);
    assert.doesNotMatch(result.stderr, /Cannot find module|Executable doesn't exist/);
  }
});
