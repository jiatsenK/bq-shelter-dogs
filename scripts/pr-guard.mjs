// 重複 PR 提醒（pr-guard.yml）：2026-10-22 一次合併 8 個 PR，有 4 個是重做已合併的票、或兩個 agent 做同一張票；
// 另一個 PR 的目標分支不是 main，顯示「已合併」但 main 上沒有。開 PR 時就留言提醒，不擋合併。
// 用法：node scripts/pr-guard.mjs <PR 編號> [--dry-run]（需要 gh，CI 用 GITHUB_TOKEN）；本機試跑一定加 --dry-run，不然會真的留言
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// PR 內文裡的 Closes／Fixes／Resolves #N（GitHub 認得的關鍵字）
export function closedIssues(body) {
  return [...new Set([...(body || '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi)].map(m => Number(m[1])))];
}

// pr: { number, base, body }；issues: { [N]: 'OPEN'|'CLOSED' }；openPrs: [{ number, body }]（還開著的其他 PR）
export function guardNotes({ pr, issues, openPrs }) {
  const notes = [];
  if (pr.base !== 'main') notes.push(`目標分支是 \`${pr.base}\`，不是 \`main\`：合併後 main 上不會有這些改動，要等 \`${pr.base}\` 再合進 main。`);
  for (const n of closedIssues(pr.body)) {
    if (issues[n] === 'CLOSED') notes.push(`#${n} 已經關閉，可能已有別的 PR 做完；先比對 main 再決定要不要合併。`);
    const others = openPrs.filter(o => o.number !== pr.number && closedIssues(o.body).includes(n)).map(o => `#${o.number}`);
    if (others.length) notes.push(`#${n} 還有其他開著的 PR：${others.join('、')}，只留一個。`);
  }
  return notes;
}

const gh = args => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const number = Number(process.argv[2]);
  const p = gh(['pr', 'view', String(number), '--json', 'number,baseRefName,body']);
  const pr = { number: p.number, base: p.baseRefName, body: p.body };
  const issues = {};
  for (const n of closedIssues(pr.body)) issues[n] = gh(['issue', 'view', String(n), '--json', 'state']).state;
  const openPrs = gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,body']);
  const notes = guardNotes({ pr, issues, openPrs });
  if (notes.length && !process.argv.includes('--dry-run')) {
    const body = `## 合併前先確認\n\n${notes.map(n => `- ${n}`).join('\n')}`;
    execFileSync('gh', ['pr', 'comment', String(number), '--body', body], { stdio: 'inherit' });
  }
  console.log(notes.length ? notes.join('\n') : '沒有發現重複或目標分支問題');
}
