// node 測試入口（CI 和 AGENTS.md 共用）：找 scripts/、worker/ 底下全部 *.test.mjs 交給 node --test。
// 自己找檔名，新增測試不用再改清單；node --test 也要逐一寫檔名，寫資料夾在 Node 22 會失敗。
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import localCheck from './local-check-record.cjs';

const root = fileURLToPath(new URL('..', import.meta.url));

async function find(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await find(p));
    else if (e.name.endsWith('.test.mjs')) out.push(relative(root, p));
  }
  return out;
}

let files = (await Promise.all(['scripts', 'worker'].map(d => find(join(root, d))))).flat().sort();
if (!files.length) { console.error('找不到任何 *.test.mjs'); process.exit(1); }
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--list') { console.log(files.map(f => f.replaceAll('\\', '/')).join('\n')); process.exit(0); }
if (args.length === 1 && args[0] === '--help') {
  console.log('check-local.ps1 -NodeTest scripts/example.test.mjs -Reason 原因\n--only 接受以逗號分隔的完整測試相對路徑；無篩選時跑全部。');
  process.exit(0);
}
let nodeOptions = args;
if (args.includes('--only')) {
  if (args.length !== 2 || args[0] !== '--only') throw new Error('請用 --only path[,path]');
  const selected = args[1].split(',').map(name => name.replaceAll('\\', '/'));
  const unknown = selected.filter(name => !files.some(file => file.replaceAll('\\', '/') === name));
  if (unknown.length) throw new Error(`未知測試：${unknown.join(',')}；用 --list 查看`);
  files = files.filter(file => selected.includes(file.replaceAll('\\', '/')));
  nodeOptions = [];
}
localCheck.requireLocalCheck(args);
const { status } = spawnSync(process.execPath, ['--test', ...nodeOptions, ...files], { cwd: root, stdio: 'inherit' });
process.exit(status ?? 1);
