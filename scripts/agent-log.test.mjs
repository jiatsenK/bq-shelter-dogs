// AGENT_LOG.md 2026-10-16 起封存（docs/agent-log/README.md）：新紀錄一筆一檔，不再改這個檔，PR 之間才不會互相衝突
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// 2026-10-28 #493：repo 公開，去掉志工真名與正式子網域後重算（只有這種去識別才改）
const FROZEN = '29e807154e2ff9eedfdec6def1efd6807e5c08a756c98d0c672235e938dbed09';

test('AGENT_LOG.md 已封存，內容不能再改', async () => {
  const text = (await readFile(new URL('../AGENT_LOG.md', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const hash = createHash('sha256').update(text).digest('hex');
  assert.equal(hash, FROZEN, 'AGENT_LOG.md 已封存：新紀錄請放 docs/agent-log/YYYY-MM-DD-<主題>.md');
});

test('docs/agent-log 的紀錄檔名是 YYYY-MM-DD-主題.md', async () => {
  const names = (await readdir(new URL('../docs/agent-log/', import.meta.url))).filter(n => n !== 'README.md');
  assert.ok(names.length > 0);
  for (const n of names) assert.match(n, /^\d{4}-\d{2}-\d{2}-[^\s/]+\.md$/, n);
});
