// 部署前準備資料庫（Cloudflare D1，第 2 步之二），由「部署到 Cloudflare」執行，接在 scripts/r2-bucket.mjs 後面：
// 1. 找名字叫 DB_NAME 的資料庫，沒有就建；拿到它的 id
// 2. 套 db/schema.sql（可以重複執行）
// 3. 資料庫是空的（dogs 沒有半列）才把 repo 現有的資料匯進去一次（scripts/build-db.mjs）
// 4. 產生 wrangler.deploy.json：上一步的設定（--config，可能是拿掉 R2 的那份）加上 d1_databases，給這次部署用
// 任何一步失敗（token 沒有 D1 權限、Cloudflare 一時不穩）就不帶資料庫，照上一步的設定部署：網站目前還不讀資料庫，
// 所以不會壞，只在摘要提醒照 docs/CLOUDFLARE_SETUP.md 設定。Action 不會失敗。
// 用法：node scripts/d1-database.mjs --config <上一步的設定檔>
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from './r2-bucket.mjs';
import { loadRepoData, buildAll, seedSql } from './build-db.mjs';

export const DB_NAME = 'bq-shelter-dogs';
export const DB_BINDING = 'DB';
export const DEPLOY_CONFIG = 'wrangler.deploy.json';
const SEED_FILE = 'db/seed.sql'; // db/ 不公開（.assetsignore）、不提交（.gitignore）

const wrangler = args => execFileSync('npx', ['--yes', 'wrangler@4', ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// wrangler --json 的輸出前面有時會多幾行提示，從第一個 [ 或 { 開始讀
export function parseJsonOutput(text) {
  const s = String(text || '');
  const at = s.search(/^[\[{]/m); // 從第一個以 [ 或 { 開頭的那一行開始
  if (at < 0) throw new Error('看不懂 wrangler 的輸出');
  return JSON.parse(s.slice(at));
}
export function findDatabase(list, name = DB_NAME) {
  const hit = (Array.isArray(list) ? list : []).find(d => d && d.name === name);
  return hit ? (hit.uuid || hit.database_id || hit.id || '') : '';
}
export function withD1(config, id, name = DB_NAME) {
  return { ...config, d1_databases: [{ binding: DB_BINDING, database_name: name, database_id: id }] };
}

export async function ensureDatabase({ config = 'wrangler.jsonc', run = wrangler, root = '.', seed = async () => seedSql(buildAll(await loadRepoData())) } = {}) {
  const base = parseJsonc(await readFile(`${root}/${config}`, 'utf8'));
  let id = '', status = 'exists';
  try {
    id = findDatabase(parseJsonOutput(run(['d1', 'list', '--json'])));
    if (!id) {
      run(['d1', 'create', DB_NAME]);
      id = findDatabase(parseJsonOutput(run(['d1', 'list', '--json'])));
      status = 'created';
    }
    if (!id) throw new Error('建好之後還是找不到資料庫');
  } catch (e) {
    return { config, status: 'missing', error: String(e.stderr || e.message || e).split('\n').find(Boolean) || '' };
  }
  await writeFile(`${root}/${DEPLOY_CONFIG}`, `${JSON.stringify(withD1(base, id), null, 2)}\n`);
  const exec = extra => run(['d1', 'execute', DB_NAME, '--remote', '--yes', '--config', DEPLOY_CONFIG, ...extra]);
  try {
    exec(['--file', 'db/schema.sql']);
    const rows = parseJsonOutput(exec(['--json', '--command', 'SELECT COUNT(*) AS n FROM dogs']));
    const n = Number(rows && rows[0] && rows[0].results && rows[0].results[0] && rows[0].results[0].n);
    if (n === 0) {
      await writeFile(`${root}/${SEED_FILE}`, await seed());
      exec(['--file', SEED_FILE]);
      status = status === 'created' ? 'created-seeded' : 'seeded';
    }
  } catch (e) {
    // 資料庫在、但表建不起來或匯不進去：還是帶著資料庫部署（網站目前不讀它），下次部署再試
    return { config: DEPLOY_CONFIG, status: 'schema-failed', id, error: String(e.stderr || e.message || e).split('\n').find(Boolean) || '' };
  }
  return { config: DEPLOY_CONFIG, status, id };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--config');
  const r = await ensureDatabase({ config: at > 0 && process.argv[at + 1] ? process.argv[at + 1] : 'wrangler.jsonc' });
  const msg = {
    exists: `資料庫 ${DB_NAME} 已經有了，資料表是最新的。`,
    seeded: `資料庫 ${DB_NAME} 是空的，已經把 repo 現有的資料匯進去。`,
    created: `已建立資料庫 ${DB_NAME}。`,
    'created-seeded': `已建立資料庫 ${DB_NAME}，並把 repo 現有的資料匯進去。`,
    'schema-failed': `⚠️ 資料庫 ${DB_NAME} 在，但建表或匯入失敗（${r.error}）。網站照常部署（目前還不讀資料庫），下次部署會再試。`,
    missing: `⚠️ 找不到資料庫 ${DB_NAME}，也建不起來（${r.error}）。多半是 Cloudflare 的 API token 沒有 D1 的編輯權限；這次先不帶資料庫部署，網站不受影響。設定步驟見 docs/CLOUDFLARE_SETUP.md「資料庫（D1）」。`,
  }[r.status];
  console.log(msg);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${msg}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `config=${r.config}\n`);
}
