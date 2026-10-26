// #493：repo 公開，帳號的 workers.dev 子網域（拼得回正式網址）不寫進追蹤的檔案。
// 「<Worker>.<子網域>.workers.dev」的子網域只准用 example 或佔位字（<子網域>、你的帳號名稱、${WORKERS_SUBDOMAIN}）；
// 實際值在 GitHub Secret WORKERS_SUBDOMAIN。真的子網域只會是英數字與 -，所以只抓這種。
// 交接紀錄（docs/agent-log/、AGENT_LOG.md）是歷史，跟 Git 歷史一起另外清理（#493 第 6 項），這裡先不查。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const SKIP = /^(docs\/agent-log\/|AGENT_LOG\.md$)/;
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|zip|pdf)$/i;

function accountHosts(text) {
  return [...text.matchAll(/[a-z0-9-]+\.([a-z0-9-]+)\.workers\.dev/g)].filter(m => m[1] !== 'example').map(m => m[0]);
}

test('#493 判斷：佔位子網域放行，真的子網域會被抓到', () => {
  assert.deepEqual(accountHosts('https://bq-shelter-dogs.example.workers.dev https://pr-1-bq-shelter-dogs-preview.<子網域>.workers.dev "https://bq-shelter-dogs-test.${WORKERS_SUBDOMAIN}.workers.dev" https://x.workers.dev'), []);
  // 拆開寫，免得這個檔自己被抓到
  const real = ['bq-shelter-dogs', 'someone-1', 'workers', 'dev'].join('.');
  assert.deepEqual(accountHosts(`打開 https://${real}/api/`), [real]);
});

test('#493 追蹤的檔案不含帳號子網域（交接紀錄除外）', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(f => f && !SKIP.test(f) && !BINARY.test(f));
  const found = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(new URL(f, ROOT), 'utf8'); } catch { continue; }
    for (const hit of accountHosts(text)) found.push(`${f}：${hit}`);
  }
  assert.deepEqual(found, []);
});
