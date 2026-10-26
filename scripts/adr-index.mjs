// ADR 索引與開關現況（docs/adr/README.md）由這支產生，不手動改：
// - ADR 是否還有效，看各篇開頭「已由 [ADR NNNN] 修訂」和其他 ADR 裡「取代／修訂 ADR NNNN」
// - 開關現況直接讀 public/js/site-config.js 的 SITE 布林開關、wrangler.jsonc 的 vars／crons、Worker 讀的 env
// 重新產生：node scripts/adr-index.mjs --write；scripts/adr-index.test.mjs 會檢查 README 是最新的
import { readFile, readdir, writeFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const read = p => readFile(new URL(p, ROOT), 'utf8');
export const README = 'docs/adr/README.md';

export async function buildIndex() {
  const files = (await readdir(new URL('docs/adr/', ROOT))).filter(f => /^\d{4}-.*\.md$/.test(f)).sort();
  const adrs = await Promise.all(files.map(async file => {
    const text = await read(`docs/adr/${file}`);
    const title = (text.match(/^#\s+(.+)$/m) || [, file])[1].trim();
    return { file, num: file.slice(0, 4), title, text };
  }));
  const revisedBy = new Map(adrs.map(a => [a.file, new Set()]));
  for (const a of adrs) {
    // 開頭的引言：「已由 [ADR 0018](0018-….md) 修訂」；同號兩篇（0005）靠連結的檔名分
    for (const m of a.text.matchAll(/^>.*?已由\s*\[?ADR\s*(\d{4})\]?(?:\(([^)]+\.md)\))?/gm)) {
      const by = adrs.find(t => t.file === m[2]) || adrs.find(t => t.num === m[1]);
      if (by) revisedBy.get(a.file).add(by.file);
    }
    // 別篇寫「修訂 ADR 0007」「取代 ADR 0012」
    for (const m of a.text.matchAll(/(?:修訂|取代)\s*ADR\s*(\d{4})/g)) {
      const target = adrs.filter(t => t.num === m[1] && t.file !== a.file);
      if (target.length === 1) revisedBy.get(target[0].file).add(a.file);
    }
  }
  const rows = adrs.map(a => {
    const by = [...revisedBy.get(a.file)].sort();
    const link = f => `[${f.slice(0, 4)}](${f})`;
    return `| [${a.num}](${a.file}) | ${a.title.replace(/^\d{4}[：:\s]*/, '').replace(/\|/g, '／')} | ${by.length ? `部分或全部被 ${by.map(link).join('、')} 修訂，一起讀、以新的為準` : '現行'} |`;
  });

  const site = await read('public/js/site-config.js');
  const flags = [...site.matchAll(/^ {2}(\w+):\s*(true|false),/gm)].map(m => `| \`SITE.${m[1]}\` | \`${m[2]}\` | public/js/site-config.js |`);
  const wrangler = await read('wrangler.jsonc');
  const varsBlock = (wrangler.match(/"vars"\s*:\s*\{([\s\S]*?)\}/) || [, ''])[1];
  const vars = Object.fromEntries([...varsBlock.matchAll(/^\s*"(\w+)"\s*:\s*"([^"]*)"/gm)].map(m => [m[1], m[2]]));
  const crons = (wrangler.match(/"crons"\s*:\s*\[([^\]]*)\]/) || [, ''])[1].match(/"[^"]+"/g) || [];
  const src = (await readdir(new URL('worker/src/', ROOT))).filter(f => f.endsWith('.js'));
  const envNames = new Set();
  for (const f of src) for (const m of (await read(`worker/src/${f}`)).matchAll(/\benv\??\.([A-Z][A-Z0-9_]+)/g)) envNames.add(m[1]);
  const bindings = new Set([...wrangler.matchAll(/"binding"\s*:\s*"(\w+)"/g)].map(m => m[1]));
  const deploy = await read('.github/workflows/deploy-cloudflare.yml');
  // 部署時組成密鑰檔的那些鍵（const s = { ADMIN_KEY: …, … }）
  const deployed = new Set([...((deploy.match(/const s = \{([^}]*)\}/) || [, ''])[1]).matchAll(/(\w+):\s*process\.env/g)].map(m => m[1]));
  const preview = await read('.github/workflows/preview-cloudflare.yml');
  const previewOnly = new Set([...preview.matchAll(/--var\s+(\w+):/g)].map(m => m[1]));
  const where = n => n in vars ? [`\`${vars[n]}\``, 'wrangler.jsonc 的 vars']
    : deployed.has(n) ? ['GitHub Secret，部署時帶上（值不在 repo）', 'deploy-cloudflare.yml']
    : previewOnly.has(n) ? ['只有預覽版設定', 'preview-cloudflare.yml']
    : ['repo 沒設定：正式環境只可能是手動加的 Cloudflare 密鑰（後台加的一般變數部署時會被 keep_vars: false 清掉）', '—'];
  const envRows = [...envNames].filter(n => !bindings.has(n)).sort().map(n => `| \`${n}\` | ${where(n).join(' | ')} |`);

  return [
    '# ADR 索引與開關現況',
    '',
    '> 由 `node scripts/adr-index.mjs --write` 產生，不要手動改。新增 ADR、在開頭加「已由 [ADR NNNN] 修訂」、或改開關後重新產生；`scripts/adr-index.test.mjs` 會擋過期的索引。',
    '',
    '## ADR',
    '',
    '| 編號 | 決定 | 狀態 |',
    '|---|---|---|',
    ...rows,
    '',
    '## 網站開關',
    '',
    ...(flags.length ? ['| 開關 | 值 | 位置 |', '|---|---|---|', ...flags] : ['目前 `public/js/site-config.js` 沒有布林開關（`SITE.d1WalkAccept` 已隨舊寫回試算表路徑刪除）。']),
    '',
    '## Worker 讀的設定',
    '',
    '| 名稱 | repo 裡的值 | 位置 |',
    '|---|---|---|',
    ...envRows,
    '',
    '## 排程（wrangler.jsonc）',
    '',
    ...crons.map(c => `- \`${c.slice(1, -1)}\``),
    '',
  ].join('\n');
}

if (process.argv.includes('--write')) {
  await writeFile(new URL(README, ROOT), await buildIndex());
  console.log(`已更新 ${README}`);
}
