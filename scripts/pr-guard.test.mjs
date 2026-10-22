import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { closedIssues, guardNotes } from './pr-guard.mjs';

test('認得 Closes／Fixes／Resolves #N，不重複', () => {
  assert.deepEqual(closedIssues('Closes #270\nfixes #12 and Resolved #270；refs #9'), [270, 12]);
  assert.deepEqual(closedIssues(null), []);
});

test('目標分支不是 main、票已關閉、同一張票還有別的 PR 都提醒', () => {
  const notes = guardNotes({
    pr: { number: 455, base: 'claude/270-activity-records', body: 'Closes #271' },
    issues: { 271: 'CLOSED' },
    openPrs: [{ number: 455, body: 'Closes #271' }, { number: 454, body: 'Closes #270, closes #271' }, { number: 1, body: 'Closes #2710' }],
  });
  assert.equal(notes.length, 3);
  assert.match(notes[0], /不是 `main`/);
  assert.match(notes[1], /#271 已經關閉/);
  assert.match(notes[2], /#454，只留一個/);
});

test('一般 PR 不提醒', () => {
  assert.deepEqual(guardNotes({ pr: { number: 5, base: 'main', body: 'Closes #3' }, issues: { 3: 'OPEN' }, openPrs: [{ number: 5, body: 'Closes #3' }] }), []);
});

// 2026-10-22 解衝突時把 <<<<<<< 標記 commit 進去過；repo 裡的檔案不該有衝突標記
test('repo 檔案沒有合併衝突標記', () => {
  const root = new URL('..', import.meta.url);
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(f => f && !/\.(png|jpe?g|webp|gif|ico|woff2?)$/i.test(f));
  const bad = files.filter(f => { try { return /^(<{7}|>{7}) /m.test(readFileSync(new URL(f, root), 'utf8')); } catch { return false; } });
  assert.deepEqual(bad, [], '這些檔案還有衝突標記');
});
