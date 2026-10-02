// 照片版本號（#127）：部署到 Cloudflare 前，把每張照片的內容雜湊寫進要上傳的 data/dogs.json（photoVersions）
// - 網站組照片網址時加 ?v=雜湊（js/app.js 的 versioned），Cloudflare 讓照片在手機上快取 30 天（_headers）；
//   換了照片雜湊就變、網址跟著變，手機就會抓新的
// - 只改部署用的那份（GitHub Action 裡 checkout 出來的檔案），不提交回 repo，所以不會多出提交
// - 主照片、相簿、縮圖都算（photos/ 底下所有 .jpg）
// 用法：node scripts/photo-versions.mjs [repo 根目錄]
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HASH_LENGTH = 8;

async function listJpgs(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listJpgs(p)));
    else if (e.isFile() && e.name.toLowerCase().endsWith('.jpg')) out.push(p);
  }
  return out;
}

// 照片路徑（photos/...，用 / 分隔）→ 內容雜湊前 8 碼，路徑排序固定
export async function photoVersions(root) {
  const files = (await listJpgs(join(root, 'photos'))).sort();
  const versions = {};
  for (const f of files) {
    const hash = createHash('sha256').update(await readFile(f)).digest('hex').slice(0, HASH_LENGTH);
    versions[relative(root, f).split(sep).join('/')] = hash;
  }
  return versions;
}

export async function writePhotoVersions(root) {
  const path = join(root, 'data', 'dogs.json');
  const data = JSON.parse(await readFile(path, 'utf8'));
  data.photoVersions = await photoVersions(root);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  return Object.keys(data.photoVersions).length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const n = await writePhotoVersions(process.argv[2] || '.');
  console.log(`照片版本號：${n} 張，寫進 data/dogs.json（只給這次部署用，不提交）`);
}
