// 重複 PR 提醒（pr-guard.yml）：2026-10-22 一次合併 8 個 PR，有 4 個是重做已合併的票、或兩個 agent 做同一張票；
// 另一個 PR 的目標分支不是 main，顯示「已合併」但 main 上沒有。開 PR 時就留言提醒，不擋合併。
// 2026-10-24 #541 寫 Refs #512，合併後票沒關、驗收清單沒勾：開 PR 時提醒不會關票、列出沒勾的項目；合併後到票上留言（--merged）。
// 用法：node scripts/pr-guard.mjs <PR 編號> [--merged] [--dry-run]（需要 gh，CI 用 GITHUB_TOKEN）；本機試跑一定加 --dry-run，不然會真的留言
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// PR 內文裡的 Closes／Fixes／Resolves #N（GitHub 認得的關鍵字）
export function closedIssues(body) {
  return [...new Set([...(body || '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi)].map(m => Number(m[1])))];
}

// Refs／Ref／Part of 後面的票（可用頓號、逗號、和列舉），已寫 Closes 的不算
export function refIssues(body) {
  const closed = closedIssues(body);
  const lists = [...(body || '').matchAll(/\b(?:refs?|part of)\s+(#\d+(?:\s*(?:[、,，]|和|and)\s*#\d+)*)/gi)].map(m => m[1]);
  const nums = lists.flatMap(l => [...l.matchAll(/#(\d+)/g)].map(m => Number(m[1])));
  return [...new Set(nums)].filter(n => !closed.includes(n));
}

// 票內文裡還沒勾的 - [ ] 項目
export function uncheckedItems(body) {
  return [...(body || '').matchAll(/^\s*[-*]\s+\[ \]\s+(.+?)\s*$/gm)].map(m => m[1]);
}

const todoList = items => items.slice(0, 10).map(t => `  - ${t.length > 80 ? t.slice(0, 80) + '…' : t}`).join('\n') + (items.length > 10 ? `\n  - …另外 ${items.length - 10} 項` : '');

// pr: { number, base, body }；issues: { [N]: { state: 'OPEN'|'CLOSED', body } }；openPrs: [{ number, body }]（還開著的其他 PR）
export function guardNotes({ pr, issues, openPrs }) {
  const notes = [];
  if (pr.base !== 'main') notes.push(`目標分支是 \`${pr.base}\`，不是 \`main\`：合併後 main 上不會有這些改動，要等 \`${pr.base}\` 再合進 main。`);
  for (const n of closedIssues(pr.body)) {
    const issue = issues[n] || {};
    if (issue.state === 'CLOSED') notes.push(`#${n} 已經關閉，可能已有別的 PR 做完；先比對 main 再決定要不要合併。`);
    const others = openPrs.filter(o => o.number !== pr.number && closedIssues(o.body).includes(n)).map(o => `#${o.number}`);
    if (others.length) notes.push(`#${n} 還有其他開著的 PR：${others.join('、')}，只留一個。`);
    const todo = uncheckedItems(issue.body);
    if (issue.state === 'OPEN' && todo.length) notes.push(`合併會關掉 #${n}，但票上還有 ${todo.length} 格沒勾；做完的先勾，沒做的改寫 \`Part of #${n}\`：\n${todoList(todo)}`);
  }
  for (const n of refIssues(pr.body)) {
    const issue = issues[n] || {};
    if (issue.state !== 'OPEN') continue;
    const todo = uncheckedItems(issue.body);
    notes.push(`內文寫的是 Refs／Part of #${n}，合併後不會自動關票。做完整張票就改成 \`Closes #${n}\`` + (todo.length ? `；票上還有 ${todo.length} 格沒勾：\n${todoList(todo)}` : '。'));
  }
  return notes;
}

// 合併後要留在票上的留言：[{ issue, body }]
export function mergedNotes({ pr, issues }) {
  const comments = [];
  for (const n of closedIssues(pr.body)) {
    const issue = issues[n] || {};
    const todo = uncheckedItems(issue.body);
    if (issue.state === 'CLOSED' && todo.length) comments.push({ issue: n, body: `#${pr.number} 已合併，本票已關閉，但還有 ${todo.length} 格沒勾；確認做完就勾掉，沒做的另開票：\n${todoList(todo)}` });
  }
  for (const n of refIssues(pr.body)) {
    const issue = issues[n] || {};
    if (issue.state !== 'OPEN') continue;
    const todo = uncheckedItems(issue.body);
    comments.push({ issue: n, body: `#${pr.number} 已合併（內文寫 Refs／Part of），本票還開著。` + (todo.length ? `還沒勾的 ${todo.length} 格：\n${todoList(todo)}` : '票上的格子都勾了，確認做完就關票。') });
  }
  return comments;
}

const gh = args => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const number = Number(process.argv[2]);
  const dryRun = process.argv.includes('--dry-run');
  const p = gh(['pr', 'view', String(number), '--json', 'number,baseRefName,body']);
  const pr = { number: p.number, base: p.baseRefName, body: p.body };
  const issues = {};
  for (const n of [...closedIssues(pr.body), ...refIssues(pr.body)]) issues[n] = gh(['issue', 'view', String(n), '--json', 'state,body']);
  if (process.argv.includes('--merged')) {
    const comments = mergedNotes({ pr, issues });
    for (const c of comments) {
      if (!dryRun) execFileSync('gh', ['issue', 'comment', String(c.issue), '--body', c.body], { stdio: 'inherit' });
      console.log(`#${c.issue}：${c.body}`);
    }
    if (!comments.length) console.log('引用的票都已關閉且勾完');
  } else {
    const openPrs = gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,body']);
    const notes = guardNotes({ pr, issues, openPrs });
    if (notes.length && !dryRun) {
      const body = `## 合併前先確認\n\n${notes.map(n => `- ${n}`).join('\n')}`;
      execFileSync('gh', ['pr', 'comment', String(number), '--body', body], { stdio: 'inherit' });
    }
    console.log(notes.length ? notes.join('\n') : '沒有發現重複、目標分支或沒勾的問題');
  }
}
