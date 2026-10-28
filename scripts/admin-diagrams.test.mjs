import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DIAGRAMS, extractDiagram, prefixIds, scopeCss, gitHistory, diagramsCss } from './admin-diagrams.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = name => readFile(new URL(`../docs/diagrams/${name}.html`, import.meta.url), 'utf8');

test('id 加圖名前綴：url(#)、href、aria-labelledby 一起改', () => {
  assert.equal(prefixIds('<svg aria-labelledby="a b"><marker id="arrow"/><use href="#arrow"/><path marker-end="url(#arrow)"/></svg>', 'x'),
    '<svg aria-labelledby="x--a x--b"><marker id="x--arrow"/><use href="#x--arrow"/><path marker-end="url(#x--arrow)"/></svg>');
});

test('CSS 每個選擇器都加範圍', () => {
  assert.equal(scopeCss('/* 註解 */\n .n { fill: red; }\n.a, .b{fill:blue}', '#d'), '#d .n { fill: red; }\n#d .a, #d .b { fill:blue }');
});

test('六張圖都抽得出來：沒有 <style>、沒有 style 屬性、id 不撞', async () => {
  const ids = new Set();
  const diagrams = [];
  for (const name of DIAGRAMS) {
    const d = extractDiagram(await source(name), name);
    diagrams.push(d);
    assert.ok(d.title && d.note, name);
    assert.match(d.svg, /^<svg[\s\S]*<\/svg>$/, name);
    assert.ok(!d.svg.includes('<style'), name + ' 的 <style> 要拆出去，管理網站 CSP 會擋');
    for (const [, id] of d.svg.matchAll(/\bid="([^"]+)"/g)) {
      assert.ok(id.startsWith(`${name}--`), id);
      assert.ok(!ids.has(id), `${id} 重複`);
      ids.add(id);
    }
    for (const [, ref] of d.svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.has(ref), `${name} 指到不存在的 #${ref}`);
    assert.ok(d.css.split('\n').every(line => line.startsWith(`#diagram-${name} `)), name);
  }
  const css = diagramsCss(diagrams);
  assert.ok(!/https?:/.test(css), '字型不能連外部，管理網站 CSP font-src self');
  for (const [, file] of css.matchAll(/url\('\.\.\/vendor\/fonts\/([^']+)'\)/g)) await readFile(new URL(`../admin/public/vendor/fonts/${file}`, import.meta.url));
});

test('版本資訊：數不出來就不顯示', () => {
  assert.deepEqual(gitHistory('docs/diagrams/沒有這張圖.html', root), { version: null, updatedAt: null });
  const real = gitHistory('docs/diagrams/architecture.html', root);
  if (real.version !== null) {
    assert.ok(Number.isInteger(real.version) && real.version > 0);
    assert.ok(!Number.isNaN(Date.parse(real.updatedAt)));
  }
});
