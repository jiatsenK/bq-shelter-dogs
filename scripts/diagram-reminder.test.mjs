import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { affectedDiagrams, reminderBody, WATCH } from './diagram-reminder.mjs';
import { DIAGRAMS } from './admin-diagrams.mjs';

test('改到架構相關檔案、沒改對應的圖才提醒', () => {
  assert.deepEqual(affectedDiagrams(['public/js/app.js', 'README.md']), []);
  assert.deepEqual(affectedDiagrams(['worker/src/walk-retry.js']).map(d => d.name), ['writeback-sequence', 'daily-schedule', 'code-architecture']);
  assert.deepEqual(affectedDiagrams(['worker/src/walk-retry.js', 'docs/diagrams/daily-schedule.html']).map(d => d.name), ['writeback-sequence', 'code-architecture'], '改了的圖不再提醒');
  const [arch] = affectedDiagrams(['wrangler.jsonc', 'wrangler.admin.jsonc', 'apps-script/sheet-write.gs']);
  assert.deepEqual(arch, { name: 'architecture', title: '系統架構', files: ['wrangler.jsonc', 'wrangler.admin.jsonc', 'apps-script/sheet-write.gs'] });
  assert.equal(affectedDiagrams(['docs/ARCHITECTURE_NOW.md']).length, DIAGRAMS.length);
});

test('留言內容：列出圖與檔案；都改了就說都改了', () => {
  const body = reminderBody(affectedDiagrams(['.github/workflows/deploy-admin.yml']));
  assert.ok(body.startsWith('<!-- diagram-reminder -->\n'));
  assert.match(body, /不擋合併/);
  assert.match(body, /\*\*環境與部署\*\*（`docs\/diagrams\/environments\.html`）：`\.github\/workflows\/deploy-admin\.yml`/);
  assert.match(reminderBody([]), /都有一起改了/);
});

test('提醒對照表跟 workflow 的 paths 對得上', async () => {
  const workflow = await readFile(new URL('../.github/workflows/diagram-reminder.yml', import.meta.url), 'utf8');
  for (const path of ['wrangler*.jsonc', 'worker/src/**', 'apps-script/**', 'migrations/**', '.github/workflows/**', 'docs/ARCHITECTURE_NOW.md', 'docs/diagrams/**']) {
    assert.ok(workflow.includes(`- '${path}'`), path);
  }
  for (const [, names] of WATCH) for (const name of names) assert.ok(DIAGRAMS.includes(name), name);
});
