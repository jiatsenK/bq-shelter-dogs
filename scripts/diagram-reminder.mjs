// 架構圖重畫提醒（K 2026-10-28）：PR 改到架構相關檔案、卻沒改 docs/ARCHITECTURE.md 對應的段落，就在 PR 留言列出可能要重畫的段落，不擋合併。
// 名稱、時間、次數這類事實由 scripts/diagram-facts.test.mjs 擋；這裡提醒的是測試比不了的流程與箭頭。
// 用法：node scripts/diagram-reminder.mjs <PR 編號> [--dry-run]（需要 gh，CI 用 GITHUB_TOKEN）；本機試跑一定加 --dry-run
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DOC, DIAGRAMS, DIAGRAM_TITLES as TITLES, parseDoc } from './admin-diagrams.mjs';

const MARK = '<!-- diagram-reminder -->';
// 哪些檔案改了，哪幾段可能要跟著改（代號見 scripts/admin-diagrams.mjs 的 DIAGRAM_TITLES）
export const WATCH = [
  [/^wrangler[^/]*\.jsonc$/, ['architecture', 'environments', 'daily-schedule']],
  [/^worker\/src\/index\.js$/, ['architecture', 'daily-schedule', 'writeback-sequence', 'sheet-sync-sequence']],
  [/^worker\/src\/(walk-accept|walk-retry|sheet-write)\.js$/, ['writeback-sequence', 'daily-schedule']],
  [/^worker\/src\/(dog-list|walk-reconcile)\.js$/, ['sheet-sync-sequence']],
  [/^worker\/src\/(dog-photo|r2)\.js$/, ['data-flows', 'daily-schedule']],
  [/^worker\/src\/admin\//, ['architecture', 'data-flows']],
  // 元件圖畫的是 worker/src 模組誰匯入誰，任何 Worker 程式改了都可能要改
  [/^worker\/src\//, ['code-architecture']],
  [/^apps-script\//, ['architecture', 'writeback-sequence', 'sheet-sync-sequence', 'daily-schedule']],
  [/^migrations\//, ['data-flows']],
  [/^\.github\/workflows\/(deploy-[^/]+|preview-cloudflare|seed-preview-db|d1-migrations)\.yml$/, ['environments']],
  [/^docs\/ARCHITECTURE_NOW\.md$/, DIAGRAMS],
];

// unified diff 的 patch → 新檔案裡改到的行號（新增的行；純刪除記在刪除位置）
export function changedLines(patch) {
  const lines = [];
  let line = 0;
  for (const row of (patch || '').split('\n')) {
    const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (row.startsWith('+')) lines.push(line++);
    else if (row.startsWith('-')) lines.push(line);
    else line++;
  }
  return lines;
}

// docs/ARCHITECTURE.md 的內容＋改到的行號 → 改到的段落代號
export function touchedSections(markdown, lines) {
  const { sections } = parseDoc(markdown);
  return DIAGRAMS.filter(name => {
    const s = sections.find(x => x.title === TITLES[name]);
    return s && lines.some(n => n >= s.start && n <= s.end);
  });
}

// files：PR 改到的檔案；touched：docs/ARCHITECTURE.md 改到的段落代號
export function affectedDiagrams(files, touched = []) {
  const done = new Set(touched);
  const out = new Map();
  for (const file of files) {
    for (const [pattern, names] of WATCH) {
      if (!pattern.test(file)) continue;
      for (const name of names) if (!done.has(name)) out.set(name, [...(out.get(name) || []), file]);
    }
  }
  return DIAGRAMS.filter(name => out.has(name)).map(name => ({ name, title: TITLES[name], files: [...new Set(out.get(name))] }));
}

export function reminderBody(list) {
  if (!list.length) return `${MARK}\n架構圖：這張 PR 改到的架構相關檔案，\`${DOC}\` 對應的段落都有一起改了。`;
  return `${MARK}\n架構圖可能要重畫（不擋合併）：這張 PR 改到下面的檔案，但 \`${DOC}\` 對應的段落沒改。看一下流程、箭頭有沒有變；沒變就不用理。\n\n` +
    list.map(d => `- **${d.title}**：${d.files.map(f => `\`${f}\``).join('、')}`).join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [number, flag] = process.argv.slice(2);
  if (!/^\d+$/.test(number || '')) throw new Error('用法：node scripts/diagram-reminder.mjs <PR 編號> [--dry-run]');
  const dryRun = flag === '--dry-run';
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const repo = process.env.GH_REPO || JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
  // 改到的檔案與 patch；docs/ARCHITECTURE.md 照 PR 的版本（workflow checkout 的是 PR）找改到哪幾段
  const changed = JSON.parse(gh(['api', `repos/${repo}/pulls/${number}/files`, '--paginate', '--slurp'])).flat();
  const doc = changed.find(f => f.filename === DOC);
  // 改動太大時 GitHub 不給 patch，就當整份都改了
  const touched = !doc ? [] : !doc.patch ? DIAGRAMS : touchedSections(readFileSync(new URL(`../${DOC}`, import.meta.url), 'utf8'), changedLines(doc.patch));
  const list = affectedDiagrams(changed.map(f => f.filename), touched);
  const old = JSON.parse(gh(['api', `repos/${repo}/issues/${number}/comments`, '--paginate', '--slurp'])).flat().find(c => c.body?.startsWith(MARK));
  // 從來沒提醒過、這次也沒東西要提醒，就不留言
  if (!list.length && !old) { console.log('沒有要提醒的段落'); process.exit(0); }
  const body = reminderBody(list);
  console.log(body);
  if (dryRun || old?.body === body) process.exit(0);
  if (old) gh(['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${old.id}`, '-f', `body=${body}`]);
  else gh(['pr', 'comment', number, '--body', body]);
}
