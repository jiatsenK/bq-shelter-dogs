// 部署前確認照片用的 R2 bucket（#130），由「部署到 Cloudflare」「PR 預覽」兩個 Action 執行
// - bucket 已經有（或加 --create 時建起來了）→ 照 wrangler.jsonc 部署，照片存 R2
// - 沒有、也建不起來（帳號還沒開通 R2、token 沒有 R2 權限）→ 產生 wrangler.no-r2.json（拿掉 R2 設定）給這次部署用，
//   網站照舊（照片寫 GitHub），Action 不會失敗，只在摘要提醒照 docs/CLOUDFLARE_SETUP.md 設定
// - 用哪一份設定寫進 GITHUB_OUTPUT 的 config（wrangler.no-r2.json 不提交、不公開）
// 用法：node scripts/r2-bucket.mjs [--create]
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const FALLBACK_CONFIG = 'wrangler.no-r2.json';

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

// 拿掉 R2，照片、dogs.json 也不再先經過 Worker（跟 #130 以前一樣直接給靜態檔，_headers 的照片快取照常）
export function withoutR2(config) {
  const copy = { ...config };
  delete copy.r2_buckets;
  if (copy.assets && Array.isArray(copy.assets.run_worker_first)) {
    copy.assets = { ...copy.assets, run_worker_first: copy.assets.run_worker_first.filter(p => p === '/api' || p.startsWith('/api/')) };
  }
  return copy;
}

const wrangler = args => execFileSync('npx', ['--yes', 'wrangler@4', ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

export async function ensureBucket({ create = false, run = wrangler, root = '.' } = {}) {
  const config = parseJsonc(await readFile(`${root}/wrangler.jsonc`, 'utf8'));
  const bucket = config.r2_buckets && config.r2_buckets[0] && config.r2_buckets[0].bucket_name;
  if (!bucket) return { config: 'wrangler.jsonc', status: 'none' };
  try {
    run(['r2', 'bucket', 'info', bucket]);
    return { config: 'wrangler.jsonc', status: 'exists', bucket };
  } catch (e) { /* 還沒有 */ }
  if (create) {
    try {
      run(['r2', 'bucket', 'create', bucket]);
      return { config: 'wrangler.jsonc', status: 'created', bucket };
    } catch (e) {
      // 查詢失敗但其實已經有了（例如網路一時不穩）：建立時 Cloudflare 會說已存在
      if (/already exists|10004/i.test(`${e.stderr || ''}${e.stdout || ''}${e.message || ''}`)) return { config: 'wrangler.jsonc', status: 'exists', bucket };
    }
  }
  await writeFile(`${root}/${FALLBACK_CONFIG}`, `${JSON.stringify(withoutR2(config), null, 2)}\n`);
  return { config: FALLBACK_CONFIG, status: 'missing', bucket };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await ensureBucket({ create: process.argv.includes('--create') });
  const msg = {
    none: 'wrangler.jsonc 沒有設定 R2。',
    exists: `R2 bucket ${r.bucket} 已經有了，照片存 R2。`,
    created: `已建立 R2 bucket ${r.bucket}，照片存 R2。`,
    missing: `⚠️ 找不到 R2 bucket ${r.bucket}，也建不起來（Cloudflare 帳號還沒開通 R2，或 token 沒有 R2 權限）。這次先不用 R2 部署，照片照舊存 GitHub。設定步驟見 docs/CLOUDFLARE_SETUP.md「照片放 R2」。`,
  }[r.status];
  console.log(msg);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${msg}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `config=${r.config}\n`);
}
