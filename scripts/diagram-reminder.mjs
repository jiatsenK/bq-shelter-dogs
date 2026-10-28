// 架構圖重畫提醒（K 2026-10-28）：PR 改到架構相關檔案、卻沒改對應的圖，就在 PR 留言列出可能要重畫的圖，不擋合併。
// 名稱、時間、次數這類事實由 scripts/diagram-facts.test.mjs 擋；這裡提醒的是測試比不了的流程與箭頭。
// 用法：node scripts/diagram-reminder.mjs <PR 編號> [--dry-run]（需要 gh，CI 用 GITHUB_TOKEN）；本機試跑一定加 --dry-run
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DIAGRAMS, DIAGRAM_TITLES as TITLES } from './admin-diagrams.mjs';

const MARK = '<!-- diagram-reminder -->';
// 哪些檔案改了，哪幾張圖可能要跟著改
export const WATCH = [
  [/^wrangler[^/]*\.jsonc$/, ['architecture', 'environments', 'daily-schedule']],
  [/^worker\/src\/index\.js$/, ['architecture', 'daily-schedule', 'writeback-sequence', 'sheet-sync-sequence']],
  [/^worker\/src\/(walk-accept|walk-retry|sheet-write)\.js$/, ['writeback-sequence', 'daily-schedule']],
  [/^worker\/src\/(dog-list|walk-reconcile)\.js$/, ['sheet-sync-sequence']],
  [/^worker\/src\/(dog-photo|r2)\.js$/, ['data-flows', 'daily-schedule']],
  [/^worker\/src\/admin\//, ['architecture', 'data-flows']],
  // 程式架構圖畫的是 worker/src 模組誰匯入誰，任何 Worker 程式改了都可能要改
  [/^worker\/src\//, ['code-architecture']],
  [/^apps-script\//, ['architecture', 'writeback-sequence', 'sheet-sync-sequence', 'daily-schedule']],
  [/^migrations\//, ['data-flows']],
  [/^\.github\/workflows\/(deploy-[^/]+|preview-cloudflare|seed-preview-db|d1-migrations)\.yml$/, ['environments']],
  [/^docs\/ARCHITECTURE_NOW\.md$/, DIAGRAMS],
];

export function affectedDiagrams(files) {
  const touched = new Set(files.map(f => f.match(/^docs\/diagrams\/([^/]+)\.html$/)?.[1]).filter(Boolean));
  const out = new Map();
  for (const file of files) {
    for (const [pattern, names] of WATCH) {
      if (!pattern.test(file)) continue;
      for (const name of names) if (!touched.has(name)) out.set(name, [...(out.get(name) || []), file]);
    }
  }
  return DIAGRAMS.filter(name => out.has(name)).map(name => ({ name, title: TITLES[name], files: [...new Set(out.get(name))] }));
}

export function reminderBody(list) {
  if (!list.length) return `${MARK}\n架構圖：這張 PR 改到的架構相關檔案，對應的圖都有一起改了。`;
  return `${MARK}\n架構圖可能要重畫（不擋合併）：這張 PR 改到下面的檔案，但對應的圖沒改。看一下流程、箭頭有沒有變；沒變就不用理。\n\n` +
    list.map(d => `- **${d.title}**（\`docs/diagrams/${d.name}.html\`）：${d.files.map(f => `\`${f}\``).join('、')}`).join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [number, flag] = process.argv.slice(2);
  if (!/^\d+$/.test(number || '')) throw new Error('用法：node scripts/diagram-reminder.mjs <PR 編號> [--dry-run]');
  const dryRun = flag === '--dry-run';
  const gh = args => execFileSync('gh', args, { encoding: 'utf8' });
  const files = JSON.parse(gh(['pr', 'view', number, '--json', 'files'])).files.map(f => f.path);
  const list = affectedDiagrams(files);
  const repo = process.env.GH_REPO || JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
  const old = JSON.parse(gh(['api', `repos/${repo}/issues/${number}/comments`, '--paginate', '--slurp'])).flat().find(c => c.body?.startsWith(MARK));
  // 從來沒提醒過、這次也沒東西要提醒，就不留言
  if (!list.length && !old) { console.log('沒有要提醒的圖'); process.exit(0); }
  const body = reminderBody(list);
  console.log(body);
  if (dryRun || old?.body === body) process.exit(0);
  if (old) gh(['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${old.id}`, '-f', `body=${body}`]);
  else gh(['pr', 'comment', number, '--body', body]);
}
