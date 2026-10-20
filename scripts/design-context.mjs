import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// Read authoritative Markdown at invocation time; no generated summary cache.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let target, section, full = false;
function fail(message) { console.error(message); process.exit(1); }
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--full') full = true;
  else if (arg === '--target' || arg === '--section') {
    const value = args[++i];
    if (!value || value.startsWith('--')) fail(`${arg} 需要值`);
    if (arg === '--target') target = value.replaceAll('\\', '/');
    else section = value;
  } else fail(`未知參數：${arg}`);
}
const source = {
  'public/index.html': 'docs/DESIGN_GUIDE.md',
  'public/groups.html': 'docs/DESIGN_GUIDE.md',
  'public/cards.html': 'docs/design/cards.md',
}[target];
if (!source || (full && section)) fail('用法：node scripts/design-context.mjs --target public/index.html|public/groups.html|public/cards.html [--section 標題 | --full]');
const lines = readFileSync(resolve(root, source), 'utf8').trimEnd().split(/\r?\n/);
const headings = lines.flatMap((line, i) => {
  const match = /^(#{1,6})\s+(.+)$/.exec(line);
  return match ? [{ start: i, level: match[1].length, title: match[2] }] : [];
});
console.log(`目標：${target}\n來源：${source}（現行）；功能依 docs/PROJECT_GOALS.md，名詞依 GLOSSARY.md。`);
if (full) lines.forEach((line, i) => console.log(`${source}:${i + 1} ${line}`));
else if (section) {
  const matches = headings.filter(h => h.title === section);
  if (matches.length !== 1) fail(`找不到唯一標題「${section}」；請用預設摘要列出的完整標題。`);
  const h = matches[0];
  const end = headings.find(next => next.start > h.start && next.level <= h.level)?.start ?? lines.length;
  lines.slice(h.start, end).forEach((line, i) => console.log(`${source}:${h.start + i + 1} ${line}`));
} else {
  // Each entry provides one bounded excerpt and an exact source location.
  for (const [i, h] of headings.entries()) {
    const end = headings[i + 1]?.start ?? lines.length;
    const excerpt = lines.slice(h.start + 1, end).find(line => line.trim() && !line.startsWith('<!--')) ?? '';
    console.log(`${source}:${h.start + 1} ${h.title}${excerpt ? ` — ${excerpt.slice(0, 100)}${excerpt.length > 100 ? '…' : ''}` : ''}`);
  }
  console.log('展開：--section 完整標題；需要整份該頁規格才使用 --full。歷史文件不自動載入。');
}
