import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = new URL('./design-context.mjs', import.meta.url);
function run(...args) { return spawnSync(process.execPath, [fileURLToPath(cli), ...args], { encoding: 'utf8' }); }
test('default context is bounded, source-addressed, and excludes other surfaces/history', () => {
  const result = run('--target', 'public/index.html');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /docs\/DESIGN_GUIDE.md:\d+ 天數色籤/);
  assert.ok(result.stdout.length < 2200);
  assert.doesNotMatch(result.stdout, /How Do Users|普卡白框|燙金卡包/);
});
test('section expands the requested rule without the next section', () => {
  const result = run('--target', 'public/groups.html', '--section', '天數色籤');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /今天／X天/);
  assert.match(result.stdout, /休養中/);
  assert.doesNotMatch(result.stdout, /## 字體與字級/);
});
test('cards and full mode read only the selected current source', () => {
  const result = run('--target', 'public/cards.html', '--full');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /燙金卡包/);
  assert.doesNotMatch(result.stdout, /## 手機鍵盤/);
});
test('invalid target, section and options fail explicitly', () => {
  for (const args of [[], ['--target'], ['--unknown'], ['--target', '../DESIGN.md'], ['--target','public/index.html','--section','missing'], ['--target','public/index.html','--section','天數色籤','--full']]) assert.notEqual(run(...args).status, 0);
});
