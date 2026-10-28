import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DOC, DIAGRAMS, DIAGRAM_TITLES, parseDoc, diagramSections, sectionText, scopeCss, cspSafe, renderMermaid, renderKey, gitHistory, diagramsCss } from './admin-diagrams.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const markdown = await readFile(new URL(`../${DOC}`, import.meta.url), 'utf8');

test('讀 ARCHITECTURE.md：核對日、依據 commit、每段的 Mermaid 與說明', () => {
  const doc = parseDoc('# 架構圖：x\n\n> 核對日：2026-10-28｜依據 commit：`abc1234`\n\n## 主圖（容器）｜x\n\n```mermaid\nflowchart LR\n  a --> b\n```\n\n- 一點 `a/b.js:1`\n\n## 從哪裡開始讀\n\n- `a/b.js`：入口\n');
  assert.equal(doc.checked, '2026-10-28');
  assert.equal(doc.commit, 'abc1234');
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

test('CSS 每個選擇器都加範圍；有 @ 規則就停', () => {
  assert.equal(scopeCss('/* 註解 */\n #m .n { fill: red; }\n.a, .b{fill:blue}', '#d'), '#d #m .n { fill: red; }\n#d .a, #d .b { fill:blue }');
  assert.throws(() => scopeCss('@keyframes x { to { opacity: 0 } }', '#d'), /@ 規則/);
});

test('Mermaid 的 SVG 轉成 CSP 擋不到的寫法：沒有 <style>、沒有 style 屬性，樣式變成加範圍的 class', () => {
  const svg = '<svg id="mmd-x" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: 812.5px;" viewBox="0 0 812 300"><style>#mmd-x{font-size:16px;}#mmd-x .node rect{fill:#ececff;}</style>'
    + '<g class="node code"><rect style="stroke:#d9822b !important;stroke-width:2px !important" class="basic"/><path style=""/><text font-style="normal">a</text></g><rect style="stroke:#d9822b !important;stroke-width:2px !important"/></svg>';
  const { svg: out, css } = cspSafe(svg, 'x');
  assert.ok(!/\sstyle="|<style/.test(out), out);
  assert.ok(!out.includes('width="100%"'));
  assert.equal((out.match(/class="basic m1"|class="m1"/g) || []).length, 2, '同樣的 style 用同一個 class');
  assert.ok(out.includes('font-style="normal"'), '不是 style 的屬性不動');
  assert.ok(css.split('\n').every(line => line.startsWith('#diagram-x ')), css);
  assert.ok(css.includes('#diagram-x .m1 { stroke:#d9822b !important;stroke-width:2px !important; }'));
  assert.ok(css.includes('max-width: 813px') && css.includes('min-width: 813px'), '窄的圖照原寸');
  assert.throws(() => cspSafe('<svg style="max-width: 10px;"><foreignObject/><style>a{}</style></svg>', 'y'), /foreignObject/);
});

test('快取鍵：圖或畫法變了就換', () => {
  assert.equal(renderKey('a'), renderKey('a'));
  assert.notEqual(renderKey('a'), renderKey('b'));
});

test('樣式表：字型自架，不連外部', async () => {
  const css = diagramsCss([{ css: '#diagram-x .a { fill: red; }' }, { css: null }]);
  assert.ok(!/https?:/.test(css), '管理網站 CSP font-src self');
  for (const [, file] of css.matchAll(/url\('\.\.\/vendor\/fonts\/([^']+)'\)/g)) await readFile(new URL(`../admin/public/vendor/fonts/${file}`, import.meta.url));
  assert.ok(css.endsWith('#diagram-x .a { fill: red; }\n'));
});

test('版本資訊：數不出來就不顯示', () => {
  assert.deepEqual(gitHistory('docs/沒有這個檔.md', root), { version: null, updatedAt: null });
  const real = gitHistory(DOC, root);
  if (real.version !== null) {
    assert.ok(Number.isInteger(real.version) && real.version > 0);
    assert.ok(!Number.isNaN(Date.parse(real.updatedAt)));
  }
});

// CI 的 node 測試階段還沒裝 Playwright，略過；網頁測試（tests/admin-diagrams.cjs）會再用真的 CSP 檢查畫好的圖
let hasPlaywright = true;
try { createRequire(import.meta.url).resolve('playwright'); } catch { hasPlaywright = false; }
test('真的畫一張：每張 Mermaid 都畫得出來，轉換後沒有內嵌樣式', { skip: !hasPlaywright && '沒有 Playwright' }, async () => {
  const sections = diagramSections(markdown).filter(s => s.mermaid);
  const drawn = await renderMermaid(sections.map(s => ({ name: s.name, source: s.mermaid })));
  for (const s of sections) {
    const { svg, css } = cspSafe(drawn.get(s.name), s.name);
    assert.match(svg, /^<svg[\s\S]*<\/svg>$/, s.name);
    assert.ok(css.length > 1000, s.name);
  }
});
