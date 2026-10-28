// 用隔離 Git repo 驗證真正的 PowerShell 入口；不重跑產品全套。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('.', import.meta.url));
const legacyShell = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : null;
// Windows 常只有內建 5.1；沒有 pwsh 時改用它，避免子程序啟動失敗（#708）。
const checkShell = process.env.BQ_CHECK_PWSH
  || (legacyShell && spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).error ? legacyShell : 'pwsh');
// Windows 的執行原則可能擋 -File；Linux 沒有這個限制。
const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-ExecutionPolicy', 'Bypass'] : ['-NoProfile'];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'bq-check-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep), 'fixture 必須留在系統暫存目錄');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'worker'));
  for (const file of ['check-local.ps1', 'local-check-record.cjs', 'run-node-tests.mjs', 'run-browser-tests.cjs']) copyFileSync(join(source, file), join(root, 'scripts', file));
  writeFileSync(join(root, 'scripts/a.test.mjs'), "import { test } from 'node:test'; test('A', () => {});\n");
  writeFileSync(join(root, 'worker/b.test.mjs'), "import { test } from 'node:test'; test('B', () => { if (process.env.BQ_FIXTURE_FAIL) throw Error('fixture failure'); });\n");
  const env = { ...process.env };
  delete env.BQ_LOCAL_CHECK_RECORD;
  delete env.GITHUB_ACTIONS;
  delete env.CI;
  // node:test 的子程序標記會使內層 runner 略過測試，fixture 必須獨立啟動。
  delete env.NODE_TEST_CONTEXT;
  const run = (command, args, extraEnv = {}) => spawnSync(command, args, { cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 60000 });
  assert.equal(run('git', ['init', '-q']).status, 0);
  assert.equal(run('git', ['add', '.']).status, 0);
  assert.equal(run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']).status, 0);
  return { root, run,
    check: (...args) => run(checkShell, [...shellArgs, '-File', 'scripts/check-local.ps1', ...args]),
    records: () => readdirSync(join(root, '.scratch/checks')).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(join(root, '.scratch/checks', f), 'utf8'))) };
}
const passed = result => assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

test('Node 篩選只跑指定檔案，錯字先失敗；本機直接跑兩種 runner 會被拒絕，CI 全套保留', t => {
  const f = fixture(t);
  const list = f.run(process.execPath, ['scripts/run-node-tests.mjs', '--list']);
  passed(list);
  assert.match(list.stdout, /scripts\/a.test.mjs/);
  assert.match(list.stdout, /worker\/b.test.mjs/);
  const unknown = f.check('-NodeTest', 'scripts/missing.test.mjs', '-Reason', '驗證錯字');
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stdout, /未知測試/);
  const selected = f.check('-NodeTest', 'scripts/a.test.mjs', '-Reason', '只測 A');
  passed(selected);
  assert.equal(f.records().at(-1).checks[0].exitCode, 0);
  const log = readFileSync(f.records().at(-1).checks[0].log, 'utf8');
  assert.match(log, /tests 1/);
  assert.doesNotMatch(log, /Subtest: B/);
  for (const runner of ['scripts/run-node-tests.mjs', 'scripts/run-browser-tests.cjs']) {
    const direct = f.run(process.execPath, [runner]);
    assert.notEqual(direct.status, 0);
    assert.match(direct.stderr, /check-local.ps1/);
  }
  const ci = f.run(process.execPath, ['scripts/run-node-tests.mjs'], { CI: 'true', GITHUB_ACTIONS: 'true' });
  passed(ci);
  assert.match(ci.stdout, /tests 2/);
});

test('相同通過條件須另附重跑理由；失敗與被擋紀錄不當成通過，原因／耗時可讀回', t => {
  const f = fixture(t);
  const args = ['-NodeTest', 'scripts/a.test.mjs', '-Reason', '驗證入口'];
  passed(f.check(...args));
  const first = f.records().at(-1);
  assert.equal(first.result, 'passed');
  assert.equal(first.stable, true);
  assert.equal(first.reason, '驗證入口');
  assert.match(first.initial.head, /^[a-f0-9]{40}$/);
  assert.ok(first.durationMs > 0);
  assert.ok(first.checks[0].durationMs > 0);
  assert.notEqual(f.check(...args).status, 0);
  assert.equal(f.records().at(-1).result, 'blocked');
  passed(f.check(...args, '-RepeatReason', '診斷偶發問題'));
  assert.equal(f.records().at(-1).repeatReason, '診斷偶發問題');
  assert.ok(f.records().at(-1).previousPass);
  assert.notEqual(f.check('-NodeTest', 'worker/b.test.mjs').status, 0);
  assert.equal(f.records().at(-1).result, 'blocked');
  // 改成真實失敗的測試：連跑兩次都允許，且都留下 failed。
  writeFileSync(join(f.root, 'worker/b.test.mjs'), "throw Error('fixture failure');\n");
  for (let i = 0; i < 2; i++) {
    assert.notEqual(f.check('-NodeTest', 'worker/b.test.mjs', '-Reason', '診斷失敗').status, 0);
    assert.equal(f.records().at(-1).result, 'failed');
  }
});

test('未提交／未追蹤變更與範圍變更形成新條件；完成的紀錄不能再授權 runner', t => {
  const f = fixture(t);
  passed(f.check('-NodeTest', 'scripts/a.test.mjs', '-Reason', '初次'));
  const first = f.records().at(-1);
  writeFileSync(join(f.root, 'scripts/a.test.mjs'), "import { test } from 'node:test'; test('A changed', () => {});\n");
  passed(f.check('-NodeTest', 'scripts/a.test.mjs', '-Reason', '補修後'));
  const changed = f.records().at(-1);
  assert.notEqual(first.initial.fingerprint, changed.initial.fingerprint);
  assert.match(changed.initial.status, /scripts\/a.test.mjs/);
  writeFileSync(join(f.root, 'new.txt'), 'untracked');
  passed(f.check('-NodeTest', 'scripts/a.test.mjs', '-Reason', '新增檔案後'));
  assert.match(f.records().at(-1).initial.status, /new.txt/);
  passed(f.check('-NodeTest', 'worker/b.test.mjs', '-Reason', '不同範圍'));
  const recordFile = readdirSync(join(f.root, '.scratch/checks')).filter(f => f.endsWith('.json')).sort().at(-1);
  const stale = f.run(process.execPath, ['scripts/run-node-tests.mjs', '--only', 'worker/b.test.mjs'], { BQ_LOCAL_CHECK_RECORD: join(f.root, '.scratch/checks', recordFile) });
  assert.notEqual(stale.status, 0);
});

test('全套保留兩種 runner，Node 失敗則停止；執行中改檔不算相同條件的通過', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'worker/b.test.mjs'), "throw Error('stop before browser');\n");
  assert.notEqual(f.check('-Full', '-Reason', '驗證全套失敗路徑').status, 0);
  const full = f.records().at(-1);
  assert.deepEqual(full.commands, [['scripts/run-node-tests.mjs'], ['scripts/run-browser-tests.cjs']]);
  assert.equal(full.checks.length, 1);
  assert.equal(full.result, 'failed');
  writeFileSync(join(f.root, 'scripts/a.test.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('generated.txt', 'changed during test');\n");
  passed(f.check('-NodeTest', 'scripts/a.test.mjs', '-Reason', '測試執行中產生檔案'));
  const mutated = f.records().at(-1);
  assert.equal(mutated.result, 'passed');
  assert.equal(mutated.stable, false);
  passed(f.check('-NodeTest', 'scripts/a.test.mjs', '-Reason', '產生檔案後的新條件'));
  assert.equal(f.records().at(-1).stable, true);
});

test('Windows PowerShell 5.1 能傳遞中文原因與空的重跑原因', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  passed(f.run(legacyShell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/check-local.ps1', '-NodeTest', 'scripts/a.test.mjs', '-Reason', '確認中文原因']));
  const record = f.records().at(-1);
  assert.equal(record.reason, '確認中文原因');
  assert.equal(record.repeatReason, '');
  assert.equal(record.result, 'passed');
  assert.match(record.initial.runtime.shellVersion, /^5\.1\./);
});

test('Windows PowerShell 5.1 遇到 stderr 仍寫完整 UTF-8 日誌與實際退出碼', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const check = (...args) => f.run(legacyShell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/check-local.ps1', ...args]);
  const unknown = check('-NodeTest', 'scripts/missing.test.mjs', '-Reason', '驗證錯字');
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stdout, /node exit=1；完整輸出：/);
  assert.match(unknown.stdout, /未知測試/);
  writeFileSync(join(f.root, 'worker/b.test.mjs'), "console.error('stderr 第一行\\n\\nstderr 空行後'); console.log('stdout 中文'); throw Error('fixture failure');\n");
  assert.notEqual(check('-NodeTest', 'worker/b.test.mjs', '-Reason', '診斷 5.1 失敗').status, 0);
  const record = f.records().at(-1);
  assert.equal(record.result, 'failed');
  assert.equal(record.checks[0].exitCode, 1);
  const log = readFileSync(record.checks[0].log, 'utf8');
  assert.match(log, /stderr 第一行\r?\n\r?\nstderr 空行後/);
  assert.match(log, /stdout 中文/);
  assert.match(log, /Error: fixture failure\s+at /);
  assert.match(log, /tests 1/);
  assert.doesNotMatch(log, /NativeCommandError|RemoteException/);
});
