import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { affectedDiagrams, reminderBody, changedLines, touchedSections, WATCH } from './diagram-reminder.mjs';
import { DOC, DIAGRAMS, DIAGRAM_TITLES } from './admin-diagrams.mjs';

test('改到架構相關檔案、沒改對應的段落才提醒', () => {
  assert.deepEqual(affectedDiagrams(['public/js/app.js', 'README.md']), []);
  assert.deepEqual(affectedDiagrams(['worker/src/walk-retry.js']).map(d => d.name), ['daily-schedule', 'writeback-sequence', 'code-architecture']);
  assert.deepEqual(affectedDiagrams(['worker/src/walk-retry.js', DOC], ['daily-schedule']).map(d => d.name), ['writeback-sequence', 'code-architecture'], '改了的段落不再提醒');
  const [arch] = affectedDiagrams(['wrangler.jsonc', 'wrangler.admin.jsonc', 'apps-script/sheet-write.gs']);
  assert.deepEqual(arch, { name: 'architecture', title: DIAGRAM_TITLES.architecture, files: ['wrangler.jsonc', 'wrangler.admin.jsonc', 'apps-script/sheet-write.gs'] });
  assert.equal(affectedDiagrams(['docs/ARCHITECTURE_NOW.md']).length, DIAGRAMS.length);
});

test('從 patch 找出 docs/ARCHITECTURE.md 改到哪幾段', async () => {
  assert.deepEqual(changedLines('@@ -3,2 +3,3 @@\n a\n-b\n+c\n+d\n@@ -20 +21 @@\n-x\n+y'), [4, 4, 5, 21, 21]);
  const markdown = await readFile(new URL(`../${DOC}`, import.meta.url), 'utf8');
  const lines = markdown.split('\n');
  const at = title => lines.indexOf(`## ${title}`) + 1;
  assert.deepEqual(touchedSections(markdown, [1, 2]), [], '開頭不算任何一段');
  assert.deepEqual(touchedSections(markdown, [at(DIAGRAM_TITLES['daily-schedule']) + 2]), ['daily-schedule']);
  assert.deepEqual(touchedSections(markdown, [at(DIAGRAM_TITLES.environments), lines.length]), ['environments'], '檔尾的「從哪裡開始讀」不是任何一段');
  // 元件圖後面接的段落（決策、風險）不在管理網站的圖裡，照實際的下一個標題算
  const next = lines.findIndex((line, i) => i >= at(DIAGRAM_TITLES['code-architecture']) && line.startsWith('## ')) + 1;
  assert.deepEqual(touchedSections(markdown, [next - 2]), ['code-architecture'], '元件圖段落到下一個標題前為止');
});

test('留言內容：列出段落與檔案；都改了就說都改了', () => {
  const body = reminderBody(affectedDiagrams(['.github/workflows/deploy-admin.yml']));
  assert.ok(body.startsWith('<!-- diagram-reminder -->\n'));
  assert.match(body, /不擋合併/);
  assert.ok(body.includes(`- **${DIAGRAM_TITLES.environments}**：\`.github/workflows/deploy-admin.yml\``));
  assert.ok(body.includes(DOC));
  assert.match(reminderBody([]), /都有一起改了/);
});

test('提醒對照表跟 workflow 的 paths 對得上', async () => {
  const workflow = await readFile(new URL('../.github/workflows/diagram-reminder.yml', import.meta.url), 'utf8');
  for (const path of ['wrangler*.jsonc', 'worker/src/**', 'apps-script/**', 'migrations/**', '.github/workflows/**', 'docs/ARCHITECTURE_NOW.md', DOC]) {
    assert.ok(workflow.includes(`- '${path}'`), path);
  }
  for (const [, names] of WATCH) for (const name of names) assert.ok(DIAGRAMS.includes(name), name);
});
