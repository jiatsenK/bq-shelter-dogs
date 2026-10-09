// 照片一次性搬到 Cloudflare R2（#130），由 GitHub Action「照片搬到 R2」執行（.github/workflows/migrate-photos-r2.yml）
// - 清點 repo 裡 photos/ 底下所有 .jpg（主照片、相簿、縮圖），算 sha256 和大小，一次 10 張送給網站的 /api/admin/migrate，
//   Worker 從部署上去的舊檔複製進 R2，R2 寫入時用 sha256 驗證內容
// - R2 已經有的（網站換過、刪過）不會被舊檔蓋掉（相簿 K 2026-10-09 拿掉，不再接相簿清單）
// - 搬完再逐檔核對（/api/admin/verify）：大小、sha256 都對才算數；數量和每一種結果寫進 Action 的摘要
// - 可以重跑：已經搬過的會顯示「R2 已有」，不會重複複製
// - repo 裡的舊照片不刪，等 K 驗收 R2 沒問題再另外處理
// 用法：SITE_URL=https://... ADMIN_PASSCODE=... node scripts/migrate-photos-r2.mjs [repo 根目錄]
import { createHash } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listJpgs } from './photo-versions.mjs';

export const BATCH = 10;
const LABELS = {
  copied: '這次複製', exists: 'R2 已有（之前搬過或網站換過）', deleted: '網站已刪除（不搬）', missing: '找不到', mismatch: '內容不符',
  ok: '核對正確', changed: '網站後來換過（不算錯）',
};

// 原圖先、縮圖後（縮圖比原圖晚寫進 R2，才不會被當成「縮圖比原圖舊」又重做一次）
export async function listPhotos(root) {
  const files = (await listJpgs(join(root, 'photos'))).map(f => relative(root, f).split(sep).join('/'));
  const thumb = p => p.startsWith('photos/thumbs/');
  const sorted = files.sort((a, b) => thumb(a) - thumb(b) || a.localeCompare(b));
  const items = [];
  for (const path of sorted) {
    const bytes = await readFile(join(root, path));
    items.push({ path, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length });
  }
  return items;
}

async function post(site, passcode, path, body, fetchImpl) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchImpl(`${site}/api/admin/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': encodeURIComponent(passcode) },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => null);
      if (res.ok && out && out.ok) return out;
      last = new Error(`${path} 失敗（HTTP ${res.status}）：${(out && out.error) || '沒有回應內容'}`);
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 503) break;
    } catch (e) {
      last = e;
    }
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw last;
}

const count = results => results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});

export async function migrate({ root = '.', site, passcode, fetchImpl = fetch, log = console.log }) {
  if (!site || !passcode) throw new Error('要設 SITE_URL 和 ADMIN_PASSCODE（GitHub Secret NOTES_PASSCODE）');
  site = site.replace(/\/+$/, '');
  const items = await listPhotos(root);
  log(`repo 裡的照片：${items.length} 張（原圖 ${items.filter(i => !i.path.startsWith('photos/thumbs/')).length}、縮圖 ${items.filter(i => i.path.startsWith('photos/thumbs/')).length}）`);

  const copied = [];
  for (let i = 0; i < items.length; i += BATCH) {
    copied.push(...(await post(site, passcode, 'migrate', { items: items.slice(i, i + BATCH) }, fetchImpl)).results);
  }
  const verified = [];
  for (let i = 0; i < items.length; i += BATCH) {
    verified.push(...(await post(site, passcode, 'verify', { items: items.slice(i, i + BATCH) }, fetchImpl)).results);
  }

  const c = count(copied);
  const v = count(verified);
  const bad = [...copied.filter(r => r.status === 'missing' || r.status === 'mismatch'), ...verified.filter(r => r.status === 'missing' || r.status === 'mismatch')];
  const lines = [
    '## 照片搬到 R2',
    '',
    `repo 裡的照片共 **${items.length}** 張`,
    '',
    '| 搬遷 | 張數 |', '|---|---|',
    ...Object.entries(c).map(([k, n]) => `| ${LABELS[k] || k} | ${n} |`),
    '',
    '| 核對 | 張數 |', '|---|---|',
    ...Object.entries(v).map(([k, n]) => `| ${LABELS[k] || k} | ${n} |`),
    '',
    bad.length ? `❌ 有 ${bad.length} 筆不對：\n\n${[...new Set(bad.map(r => `- ${r.path}（${LABELS[r.status]}）`))].join('\n')}` : '✅ 每一張都核對過，數量一致。',
  ];
  const summary = lines.join('\n');
  log(summary);
  return { total: items.length, copied: c, verified: v, bad, summary, ok: !bad.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await migrate({ root: process.argv[2] || '.', site: process.env.SITE_URL, passcode: process.env.ADMIN_PASSCODE });
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${r.summary}\n`);
  if (!r.ok) process.exit(1);
}
