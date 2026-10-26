// #214 部署只驗證既有 D1，不建立資料庫、不建表、不匯入。
// 正式：node scripts/d1-database.mjs --config <R2 檢核後的設定>
// 預覽：node scripts/d1-database.mjs --config wrangler.jsonc --preview。稽核第 3 項：預覽改上傳到獨立 Worker（wrangler.preview-db.jsonc 的 name），
//   只綁測試 R2、測試 D1，Worker 上除了 WALKER_KEY 不能有密鑰；密鑰跟著 Worker 走，預覽當正式 Worker 的版本一定會拿到正式密鑰。
// 第一次建立預覽 Worker：同上再加 --create-preview-worker（只在 Worker 還不存在時 deploy 一次）。
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseJsonc } from './r2-bucket.mjs';

export const DB_NAME = 'bq-shelter-dogs';
export const DB_BINDING = 'DB';
export const DEPLOY_CONFIG = 'wrangler.deploy.json';
export const PREVIEW_CONFIG = 'wrangler.preview.json';
const PREVIEW_DB_CONFIG = 'wrangler.preview-db.jsonc';
// npx wrangler@4；Windows 的 npx 是 .cmd，execFileSync 不能直接跑，改用 node 執行 npm 附的 npx-cli.js（本機演練用，#553）
export function runWrangler(args, { stderr = 'pipe', maxBuffer } = {}) {
  const npx = process.platform === 'win32' ? [process.execPath, [join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js')]] : ['npx', []];
  return execFileSync(npx[0], [...npx[1], '--yes', 'wrangler@4', ...args], { stdio: ['ignore', 'pipe', stderr], encoding: 'utf8', ...(maxBuffer && { maxBuffer }) });
}
const wrangler = args => runWrangler(args);

export function parseJsonOutput(text) {
  const s = String(text || '');
  const at = s.search(/^[\[{]/m);
  if (at < 0) throw new Error('看不懂 wrangler 的輸出');
  return JSON.parse(s.slice(at));
}
export function findDatabase(list, name = DB_NAME) {
  const hit = (Array.isArray(list) ? list : []).find(d => d?.name === name);
  return hit ? (hit.uuid || hit.database_id || hit.id || '') : '';
}

// 預覽要跟正式完全分開：Worker 名稱、照片空間都不能跟正式設定一樣。只看設定，不接觸 Cloudflare。回傳問題或 ''
export function previewIsolationProblem(base, isolated) {
  if (!isolated?.name || isolated.name === base.name) return '預覽要用獨立 Worker，停止部署';
  // 稽核第 5 項：排程上限算整個帳號，預覽一個都不准有
  const crons = isolated.triggers?.crons;
  if (!Array.isArray(crons) || crons.length) return '預覽 Worker 要明寫 "triggers": { "crons": [] }，停止部署';
  const buckets = isolated.r2_buckets || [];
  if (!buckets.some(b => b.binding === 'PHOTOS' && b.bucket_name)) return '預覽缺少照片空間綁定，停止部署';
  const production = new Set((base.r2_buckets || []).map(b => b.bucket_name));
  if (buckets.some(b => !b.bucket_name || production.has(b.bucket_name))) return '預覽不能使用正式 R2，停止部署';
  return '';
}

const missingWorker = e => /10007|not found|does not exist/i.test(`${e?.message || ''}\n${e?.stderr || ''}`);

// K 2026-10-26：預覽只准有 WALKER_KEY（算志工代號，不能寫任何東西；跟正式同一把，代號才對得上從正式複製的測試庫）
export const PREVIEW_ALLOWED_SECRETS = ['WALKER_KEY'];

// 預覽 Worker 上不准有其他密鑰（正式 GAS、ADMIN_KEY 都不准）；Worker 不存在就停，請 K 先建一次
export function ensurePreviewSecrets({ config, run = wrangler }) {
  let list;
  try { list = parseJsonOutput(run(['secret', 'list', '--config', config])); }
  catch (e) { throw new Error(missingWorker(e) ? '預覽 Worker 還沒建立，停止部署；照 docs/setup/CLOUDFLARE_SETUP.md「PR 預覽」建一次' : '預覽密鑰查證失敗，停止部署'); }
  if (!Array.isArray(list)) throw new Error('預覽密鑰查證失敗，停止部署');
  const extra = list.map(x => x?.name).filter(n => !PREVIEW_ALLOWED_SECRETS.includes(n));
  if (extra.length) throw new Error(`預覽 Worker 只准有 ${PREVIEW_ALLOWED_SECRETS.join('、')}，多了 ${extra.join('、')}，停止部署`);
}

// 第一次建立預覽 Worker：確認還不存在才 deploy；已經存在就停，之後只走 versions upload
export function createPreviewWorker({ config, run = wrangler }) {
  try { run(['secret', 'list', '--config', config]); }
  catch (e) {
    if (!missingWorker(e)) throw new Error('預覽 Worker 查證失敗，停止建立');
    run(['deploy', '--config', config]);
    return;
  }
  throw new Error('預覽 Worker 已經存在，不用再建立');
}

export async function ensureDatabase({ config = 'wrangler.jsonc', preview = false, create = false, run = wrangler, root = '.' } = {}) {
  const base = parseJsonc(await readFile(`${root}/${config}`, 'utf8'));
  const production = base.d1_databases?.find(d => d.binding === DB_BINDING);
  if (!production?.database_id || production.database_name !== DB_NAME) throw new Error('正式 DB 綁定缺少或名稱不符，停止部署');
  if (!preview && base.vars?.PREVIEW) throw new Error('正式設定不能帶 PREVIEW，停止部署');
  const isolated = preview ? parseJsonc(await readFile(`${root}/${PREVIEW_DB_CONFIG}`, 'utf8')) : null;
  const selected = preview ? isolated.d1_databases?.find(d => d.binding === DB_BINDING) : production;
  if (!selected?.database_id || !selected.database_name) throw new Error('D1 綁定缺少，停止部署');
  if (preview && (selected.database_id === production.database_id || selected.database_name === production.database_name)) throw new Error('預覽不能使用正式 D1，停止部署');
  const problem = preview ? previewIsolationProblem(base, isolated) : '';
  if (problem) throw new Error(problem);
  let id;
  try {
    id = findDatabase(parseJsonOutput(run(['d1', 'list', '--json'])), selected.database_name);
  } catch { throw new Error('D1 查證失敗，停止部署'); }
  if (!id || id !== selected.database_id) throw new Error('D1 不存在或與設定 ID 不符，停止部署');
  if (preview) {
    for (const bucket of isolated.r2_buckets) {
      try { run(['r2', 'bucket', 'info', bucket.bucket_name]); }
      catch { throw new Error('R2 檢核失敗，停止部署'); }
    }
  }
  const output = preview ? PREVIEW_CONFIG : DEPLOY_CONFIG;
  const binding = { ...selected };
  // preview_database_id 只給 wrangler dev；上傳配置明確使用 database_id。
  delete binding.preview_database_id;
  const target = { ...base, d1_databases: [binding] };
  if (preview) {
    // 預覽 Worker 不跑排程（寫回重試、保險掃描、清照片垃圾桶）：明寫空的，deploy 時會清掉
    Object.assign(target, { name: isolated.name, r2_buckets: isolated.r2_buckets, vars: { ...base.vars, PREVIEW: '1' }, preview_urls: true, triggers: { crons: [] } });
  }
  await writeFile(`${root}/${output}`, `${JSON.stringify(target, null, 2)}\n`);
  try {
    const results = parseJsonOutput(run(['d1', 'execute', selected.database_name, '--remote', '--json', '--config', output, '--command', 'SELECT 1 AS ok']));
    if (!Array.isArray(results) || results.length !== 1 || results[0].success !== true || results[0].results?.[0]?.ok !== 1) throw new Error('invalid probe');
  } catch { throw new Error('D1 無法讀取，停止部署'); }
  if (preview && create) createPreviewWorker({ config: output, run });
  else if (preview) ensurePreviewSecrets({ config: output, run });
  return { config: output, status: 'exists', id, name: selected.database_name, ...(preview && { worker: isolated.name }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const at = process.argv.indexOf('--config');
    const r = await ensureDatabase({ config: at > 0 ? process.argv[at + 1] : 'wrangler.jsonc', preview: process.argv.includes('--preview'), create: process.argv.includes('--create-preview-worker') });
    const msg = `D1 ${r.name} 綁定與唯讀查詢通過；沒有建表或匯入。${r.worker ? `預覽 Worker ${r.worker} 只綁測試資源、沒有寫入用的密鑰。` : ''}`;
    console.log(msg);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${msg}\n`);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `config=${r.config}\n`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
