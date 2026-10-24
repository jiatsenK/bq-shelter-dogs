import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { closedIssues, refIssues, uncheckedItems, guardNotes, mergedNotes } from './pr-guard.mjs';

test('認得 Closes／Fixes／Resolves #N，不重複', () => {
  assert.deepEqual(closedIssues('Closes #270\nfixes #12 and Resolved #270；refs #9'), [270, 12]);
  assert.deepEqual(closedIssues(null), []);
});

test('目標分支不是 main、票已關閉、同一張票還有別的 PR 都提醒', () => {
  const notes = guardNotes({
    pr: { number: 455, base: 'claude/270-activity-records', body: 'Closes #271' },
    issues: { 271: { state: 'CLOSED', body: '' } },
    openPrs: [{ number: 455, body: 'Closes #271' }, { number: 454, body: 'Closes #270, closes #271' }, { number: 1, body: 'Closes #2710' }],
  });
  assert.equal(notes.length, 3);
  assert.match(notes[0], /不是 `main`/);
  assert.match(notes[1], /#271 已經關閉/);
  assert.match(notes[2], /#454，只留一個/);
});

test('一般 PR 不提醒', () => {
  assert.deepEqual(guardNotes({ pr: { number: 5, base: 'main', body: 'Closes #3' }, issues: { 3: { state: 'OPEN', body: '- [x] 做完' } }, openPrs: [{ number: 5, body: 'Closes #3' }] }), []);
});

test('認得 Refs／Part of 後面的票（含頓號、逗號列舉），已寫 Closes 的不算', () => {
  assert.deepEqual(refIssues('Refs #512（稽核段）'), [512]);
  assert.deepEqual(refIssues('Part of #498、#538\nref #7, #8'), [498, 538, 7, 8]);
  assert.deepEqual(refIssues('Closes #3\nRefs #3、#4'), [4]);
  assert.deepEqual(refIssues('見 #517 的說明'), []);
});

test('列出票上還沒勾的項目', () => {
  assert.deepEqual(uncheckedItems('- [x] 好了\n- [ ] 舊同步程式刪掉\n  * [ ] gviz 移除\n- 普通項目'), ['舊同步程式刪掉', 'gviz 移除']);
  assert.deepEqual(uncheckedItems(null), []);
});

// 2026-10-24 #541 寫 Refs #512，合併後票沒關、驗收清單一格沒勾，K 看不出做完沒有
test('寫 Refs 不寫 Closes：提醒合併後不會關票，列出還沒勾的項目', () => {
  const notes = guardNotes({
    pr: { number: 541, base: 'main', body: 'Refs #512' },
    issues: { 512: { state: 'OPEN', body: '- [x] 已做\n- [ ] 舊同步程式\n- [ ] gviz' } },
    openPrs: [],
  });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /#512.*不會自動關/);
  assert.match(notes[0], /舊同步程式/);
  assert.match(notes[0], /gviz/);
});

test('寫 Closes 但票上還有沒勾的：提醒合併會關掉還沒勾完的票', () => {
  const notes = guardNotes({ pr: { number: 9, base: 'main', body: 'Closes #3' }, issues: { 3: { state: 'OPEN', body: '- [ ] 照片清理' } }, openPrs: [] });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /#3.*照片清理/s);
});

test('合併後：Refs 的票還開著就到票上留言；Closes 關了但還有沒勾的也留言', () => {
  const comments = mergedNotes({
    pr: { number: 541, body: 'Closes #1\nRefs #512、#2' },
    issues: {
      1: { state: 'CLOSED', body: '- [ ] 漏勾' },
      512: { state: 'OPEN', body: '- [ ] gviz' },
      2: { state: 'OPEN', body: '- [x] 全勾' },
    },
  });
  assert.deepEqual(comments.map(c => c.issue), [1, 512, 2]);
  assert.match(comments[0].body, /#541 已合併.*已關閉/s);
  assert.match(comments[0].body, /漏勾/);
  assert.match(comments[1].body, /還開著/);
  assert.match(comments[1].body, /gviz/);
  assert.match(comments[2].body, /還開著/);
});

test('合併後：Closes 的票關了且全勾、Refs 的票已關，都不留言', () => {
  assert.deepEqual(mergedNotes({ pr: { number: 5, body: 'Closes #1\nRefs #2' }, issues: { 1: { state: 'CLOSED', body: '- [x] 好' }, 2: { state: 'CLOSED', body: '' } } }), []);
});

// 2026-10-22 解衝突時把 <<<<<<< 標記 commit 進去過；repo 裡的檔案不該有衝突標記
test('repo 檔案沒有合併衝突標記', () => {
  const root = new URL('..', import.meta.url);
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(f => f && !/\.(png|jpe?g|webp|gif|ico|woff2?)$/i.test(f));
  const bad = files.filter(f => { try { return /^(<{7}|>{7}) /m.test(readFileSync(new URL(f, root), 'utf8')); } catch { return false; } });
  assert.deepEqual(bad, [], '這些檔案還有衝突標記');
});
