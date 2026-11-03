import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOC, DIAGRAMS, DIAGRAM_TITLES, parseDoc, diagramSections, sectionText } from './architecture-doc.mjs';

const markdown = await readFile(new URL(`../${DOC}`, import.meta.url), 'utf8');

test('讀 ARCHITECTURE.md：每段的 Mermaid 與說明', () => {
  const doc = parseDoc('# 架構圖：x\n\n> 核對日：2026-10-28｜依據 commit：`abc1234`\n\n## 主圖（容器）｜x\n\n```mermaid\nflowchart LR\n  a --> b\n```\n\n- 一點 `a/b.js:1`\n\n## 從哪裡開始讀\n\n- `a/b.js`：入口\n');
  assert.deepEqual(doc.sections.map(s => [s.title, s.mermaid, s.notes, s.start, s.end]), [
    ['主圖（容器）｜x', 'flowchart LR\n  a --> b', ['一點 `a/b.js:1`'], 5, 13],
    ['從哪裡開始讀', null, ['`a/b.js`：入口'], 14, 17],
  ]);
  const sections = diagramSections(markdown);
  assert.deepEqual(sections.map(s => s.title), DIAGRAMS.map(n => DIAGRAM_TITLES[n]));
  assert.ok(sections.every(s => s.notes.length), '每段都有說明');
  assert.ok(!sectionText(sections[0]).includes('`') && !sectionText(sections[0]).includes('<br/>'));
  assert.throws(() => diagramSections('# x\n'), /找不到/);
});
