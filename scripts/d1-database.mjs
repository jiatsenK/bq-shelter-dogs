// #214 部署只驗證既有 D1，不建立資料庫、不建表、不匯入。
// 正式：node scripts/d1-database.mjs --config <R2 檢核後的設定>
// 預覽：同上加 --preview，改用 wrangler.preview-db.jsonc 的隔離測試庫。
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

export async function ensureDatabase({ config = 'wrangler.jsonc', preview = false, run = wrangler, root = '.' } = {}) {
  const base = parseJsonc(await readFile(`${root}/${config}`, 'utf8'));
  const production = base.d1_databases?.find(d => d.binding === DB_BINDING);
  if (!production?.database_id || production.database_name !== DB_NAME) throw new Error('正式 DB 綁定缺少或名稱不符，停止部署');
  if (!preview && base.vars?.PREVIEW) throw new Error('正式設定不能帶 PREVIEW，停止部署');
  const selected = preview
    ? parseJsonc(await readFile(`${root}/${PREVIEW_DB_CONFIG}`, 'utf8')).d1_databases?.find(d => d.binding === DB_BINDING)
    : production;
  if (!selected?.database_id || !selected.database_name) throw new Error('D1 綁定缺少，停止部署');
  if (preview && (selected.database_id === production.database_id || selected.database_name === production.database_name)) throw new Error('預覽不能使用正式 D1，停止部署');
  let id;
  try {
    id = findDatabase(parseJsonOutput(run(['d1', 'list', '--json'])), selected.database_name);
  } catch { throw new Error('D1 查證失敗，停止部署'); }
  if (!id || id !== selected.database_id) throw new Error('D1 不存在或與設定 ID 不符，停止部署');
  const output = preview ? PREVIEW_CONFIG : DEPLOY_CONFIG;
  const binding = { ...selected };
  // preview_database_id 只給 wrangler dev；上傳配置明確使用 database_id。
  delete binding.preview_database_id;
  const target = { ...base, d1_databases: [binding] };
  if (preview) target.vars = { ...base.vars, PREVIEW: '1' };
  await writeFile(`${root}/${output}`, `${JSON.stringify(target, null, 2)}\n`);
  try {
    const results = parseJsonOutput(run(['d1', 'execute', selected.database_name, '--remote', '--json', '--config', output, '--command', 'SELECT 1 AS ok']));
    if (!Array.isArray(results) || results.length !== 1 || results[0].success !== true || results[0].results?.[0]?.ok !== 1) throw new Error('invalid probe');
  } catch { throw new Error('D1 無法讀取，停止部署'); }
  return { config: output, status: 'exists', id, name: selected.database_name };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const at = process.argv.indexOf('--config');
    const r = await ensureDatabase({ config: at > 0 ? process.argv[at + 1] : 'wrangler.jsonc', preview: process.argv.includes('--preview') });
    const msg = `D1 ${r.name} 綁定與唯讀查詢通過；沒有建表或匯入。`;
    console.log(msg);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${msg}\n`);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `config=${r.config}\n`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
