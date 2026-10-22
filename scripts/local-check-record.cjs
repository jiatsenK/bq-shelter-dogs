// check-local.ps1 的執行紀錄與 runner 防誤用；不快取或略過測試。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const root = path.resolve(__dirname, '..');
const recordDir = path.join(root, '.scratch/checks');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();

function snapshot(shellVersion) {
  const files = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0').filter(name => name && !name.startsWith('.scratch/')))].sort();
  const hash = crypto.createHash('sha256');
  for (const name of files) {
    const file = path.join(root, name);
    hash.update(JSON.stringify(name));
    if (!fs.existsSync(file)) { hash.update('deleted\0'); continue; }
    const stat = fs.lstatSync(file);
    hash.update(stat.isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file));
    hash.update('\0');
  }
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => /^(NODE_OPTIONS|NODE_PATH|TZ|PLAYWRIGHT_.*)$/i.test(key)).sort());
  let playwright = null;
  try { playwright = require(require.resolve('playwright/package.json', { paths: [root] })).version; } catch { /* Node 單套不需 Playwright。 */ }
  const runtime = { node: process.version, platform: process.platform, arch: process.arch, shellVersion, playwright, environmentHash: digest(JSON.stringify(environment)) };
  const contentHash = hash.digest('hex');
  return { head: git(['rev-parse', 'HEAD']), status: git(['status', '--porcelain=v1', '--untracked-files=all', '--', '.', ':!.scratch']),
    contentHash, runtime, fingerprint: digest(JSON.stringify({ contentHash, runtime })) };
}

function save(file, record) {
  // 以同目錄 rename 避免中斷留下半份 JSON。
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function readRecord(file) {
  if (path.dirname(path.resolve(file)) !== recordDir || !file.endsWith('.json')) throw new Error('紀錄路徑必須位於 .scratch/checks/');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function requireLocalCheck(args) {
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.CI === 'true') return;
  const file = process.env.BQ_LOCAL_CHECK_RECORD;
  if (file) {
    const record = readRecord(file);
    // runner 必須是入口核准的這一組命令；過期／已結束的紀錄不能用。
    const command = [path.relative(root, process.argv[1]).replaceAll('\\', '/'), ...args];
    if (record.result === 'running' && record.commands.some(item => JSON.stringify(item) === JSON.stringify(command))) {
      process.kill(record.ownerPid, 0);
      return;
    }
  }
  throw new Error('本機測試請使用 scripts/check-local.ps1 並填 -Reason；CI 保留原 runner。');
}

function start(commands, reason, repeatReason, shellVersion, ownerPid) {
  fs.mkdirSync(recordDir, { recursive: true });
  const initial = snapshot(shellVersion);
  const scope = JSON.stringify(commands);
  const previous = fs.readdirSync(recordDir).filter(name => name.endsWith('.json')).map(name => {
    const file = path.join(recordDir, name);
    // 損毀紀錄不視為通過；保留檔案供診斷。
    try { return { file, ...readRecord(file) }; } catch { return null; }
  }).find(record => record?.result === 'passed' && record.stable && record.initial.fingerprint === initial.fingerprint && JSON.stringify(record.commands) === scope);
  const file = path.join(recordDir, `${Date.now()}-${crypto.randomUUID()}.json`);
  const record = { startedAt: new Date().toISOString(), ownerPid: Number(ownerPid), commands, reason, repeatReason,
    previousPass: previous?.file ?? null, initial, result: 'running', checks: [] };
  const blocked = !reason.trim() ? '請填寫 -Reason 說明本次測試原因。'
    : previous && !repeatReason.trim() ? `相同條件已通過：${previous.file}；診斷重跑請填 -RepeatReason。` : null;
  if (blocked) Object.assign(record, { result: 'blocked', durationMs: 0, message: blocked });
  save(file, record);
  if (blocked) throw new Error(`${blocked}\n本次紀錄：${file}`);
  return file;
}

function finish(file, checks) {
  const record = readRecord(file);
  record.checks = checks;
  record.finishedAt = new Date().toISOString();
  record.durationMs = Date.parse(record.finishedAt) - Date.parse(record.startedAt);
  record.result = checks.length === record.commands.length && checks.every(check => check.exitCode === 0) ? 'passed' : 'failed';
  try {
    record.final = snapshot(record.initial.runtime.shellVersion);
    record.stable = record.final.fingerprint === record.initial.fingerprint;
  } catch (error) { record.stable = false; record.snapshotError = error.message; }
  save(file, record);
}

module.exports = { requireLocalCheck };
if (require.main === module) {
  try {
    const [action, ...args] = process.argv.slice(2);
    const unpack = value => JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    if (action === 'start') {
      const { commands, reason, repeatReason, shellVersion, ownerPid } = unpack(args[0]);
      console.log(start(commands, reason, repeatReason, shellVersion, ownerPid));
    } else if (action === 'finish') finish(args[0], unpack(args[1]));
    else throw new Error('未知紀錄操作');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
