// #214 正式／預覽部署都只驗證既有 R2；失敗直接停止，不移除綁定。
import { execFileSync } from 'node:child_process';
import { readFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 去掉 JSONC 的註解和結尾多的逗號（字串裡的 // 不動）
export function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const wrangler = args => execFileSync('npx', ['--yes', 'wrangler@4', ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

export async function ensureBucket({ run = wrangler, root = '.' } = {}) {
  const config = parseJsonc(await readFile(`${root}/wrangler.jsonc`, 'utf8'));
  const buckets = config.r2_buckets || [];
  if (!buckets.some(b => b.binding === 'PHOTOS' && b.bucket_name)) throw new Error('PHOTOS 綁定缺少，停止部署');
  for (const bucket of buckets) {
    if (!bucket.bucket_name) throw new Error('R2 綁定缺少 bucket_name，停止部署');
    try { run(['r2', 'bucket', 'info', bucket.bucket_name]); }
    catch { throw new Error('R2 檢核失敗，停止部署'); }
  }
  return { config: 'wrangler.jsonc', status: 'exists', bucket: buckets.find(b => b.binding === 'PHOTOS').bucket_name };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--create')) throw new Error('部署不建立 R2，停止部署；請另行明確建立資源');
    const r = await ensureBucket();
    const msg = `R2 ${r.bucket} 檢核通過，維持原綁定。`;
    console.log(msg);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${msg}\n`);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `config=${r.config}\n`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
