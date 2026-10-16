// node 測試入口（CI 和 AGENTS.md 共用）：找 scripts/、worker/ 底下全部 *.test.mjs 交給 node --test。
// 自己找檔名，新增測試不用再改清單；node --test 也要逐一寫檔名，寫資料夾在 Node 22 會失敗。
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const files = (await Promise.all(['scripts', 'worker'].map(d => find(join(root, d))))).flat().sort();
if (!files.length) { console.error('找不到任何 *.test.mjs'); process.exit(1); }
const { status } = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { cwd: root, stdio: 'inherit' });
process.exit(status ?? 1);
