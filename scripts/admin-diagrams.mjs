import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// 架構圖（K 2026-10-28 改成跟其他專案同一套）：正本是 docs/ARCHITECTURE.md，用 Mermaid 畫，畫法照 agent-hub docs/rules/architecture-diagrams.md。
// 這支負責：讀段落（事實核對、PR 提醒、管理網站共用）、建置時把 Mermaid 畫成 SVG 給管理網站「系統架構圖」頁。
// 管理網站 CSP 是 style-src 'self'：Mermaid 在瀏覽器畫圖會插 <style> 和 style 屬性，會被擋，
// 所以建置時用無頭瀏覽器先畫好，<style> 拆成外部 CSS（加這張圖的範圍）、style 屬性換成 class。
export const DOC = 'docs/ARCHITECTURE.md';
export const DOC_URL = 'https://github.com/jiatsenK/bq-shelter-dogs/blob/main/docs/ARCHITECTURE.md';
// 代號 → 段落標題（「## 」後面整行）。順序就是管理網站上的順序：整體 → 資料與排程 → 上線 → 兩條同步流程 → 程式模組
export const DIAGRAM_TITLES = {
  'architecture': '主圖（容器）｜志工溜狗表｜正式環境',
  'data-flows': '各類資料的流向',
  'daily-schedule': '一天裡的排程',
  'environments': '上線圖｜志工溜狗表',
  'writeback-sequence': '流程｜網站登記寫回試算表',
  'sheet-sync-sequence': '流程｜試算表改動回到 D1',
  'code-architecture': '元件｜志工溜狗表｜程式架構',
};
export const DIAGRAMS = Object.keys(DIAGRAM_TITLES);

const MERMAID_FILE = new URL('./vendor/mermaid/mermaid.min.js', import.meta.url);
const FONT_FILE = new URL('../admin/public/vendor/fonts/geist-sans-latin-400-normal.woff2', import.meta.url);
// 圖上的字：拉丁字用自架的 Geist（建置時量字寬、管理網站顯示用同一個字型，框才不會太窄），中文用電腦內建字型
const FONT_FAMILY = "Geist, 'Microsoft JhengHei', 'PingFang TC', 'Noto Sans CJK TC', 'WenQuanYi Zen Hei', sans-serif";
const FONT_FACE = "@font-face { font-family: 'Geist'; font-weight: 400; font-style: normal; font-display: swap; src: url('../vendor/fonts/geist-sans-latin-400-normal.woff2') format('woff2'); }";
// 畫法有改（這支的轉換規則、Mermaid 版本、字型）就加一，舊的快取作廢
const RENDER_REV = 2;

// ARCHITECTURE.md → { checked, commit, sections: [{ title, mermaid, notes[], start, end }] }；start／end 是段落的行號（從 1 算）
export function parseDoc(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const meta = (markdown.match(/核對日：(\d{4}-\d{2}-\d{2})｜依據 commit：`([0-9a-f]+)`/) || []).slice(1);
  const sections = [];
  let section = null, fence = null, block = [];
  lines.forEach((line, i) => {
    if (fence !== null) {
      if (line.trim() === '```') { if (fence === 'mermaid' && section) section.mermaid = block.join('\n'); fence = null; block = []; }
      else block.push(line);
      return;
    }
    const open = line.match(/^```(\w*)\s*$/);
    if (open) { fence = open[1]; return; }
    if (line.startsWith('## ')) {
      if (section) section.end = i;
      section = { title: line.slice(3).trim(), mermaid: null, notes: [], start: i + 1, end: lines.length };
      sections.push(section);
      return;
    }
    const item = section && line.match(/^\s*[-*] (.*)$/);
    if (item) section.notes.push(item[1]);
  });
  return { checked: meta[0] || null, commit: meta[1] || null, sections };
}

// 依 DIAGRAM_TITLES 取出各段，找不到就丟錯（標題改了要一起改上面的表）
export function diagramSections(markdown) {
  const doc = parseDoc(markdown);
  return DIAGRAMS.map(name => {
    const found = doc.sections.find(s => s.title === DIAGRAM_TITLES[name]);
    if (!found) throw new Error(`${DOC} 找不到「## ${DIAGRAM_TITLES[name]}」段落`);
    return { name, ...found };
  });
}

// 給事實核對比對的純文字：標題、Mermaid 原始碼（<br/> 換成空白）、說明，去掉反引號
export const sectionText = s => [s.title, (s.mermaid || '').replace(/<br\s*\/?>/g, ' '), ...s.notes].join('\n').replace(/`/g, '');

// 圖裡的 CSS 只有「選擇器 { 宣告 }」，每個選擇器前面加上這張圖的範圍
export function scopeCss(css, scope) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (clean.includes('@')) throw new Error('圖的 CSS 有 @ 規則，加範圍的方式處理不了，請改 scripts/admin-diagrams.mjs');
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) =>
    `${selectors.split(',').map(s => `${scope} ${s.trim()}`).join(', ')} { ${body.trim()} }`).join('\n');
}

// Mermaid 畫好的 SVG → { svg, css }：拿掉 <style>、style 屬性換成 class，CSS 都加上 #diagram-<代號> 範圍
export function cspSafe(svg, name) {
  const styleMatch = svg.match(/<style>([\s\S]*?)<\/style>/);
  if (!styleMatch) throw new Error(`${name} 的圖沒有 <style>，Mermaid 輸出格式變了`);
  let out = svg.replace(/<style>[\s\S]*?<\/style>/g, '');
  const width = Number((out.match(/^<svg[^>]*\sstyle="max-width:\s*([\d.]+)px;?"/) || [])[1]);
  if (!width) throw new Error(`${name} 的圖讀不到寬度`);
  const classes = new Map();
  out = out.replace(/<([a-zA-Z][\w:-]*)((?:\s[^<>]*?)?)(\/?)>/g, (tag, el, attrs, close) => {
    const style = attrs.match(/\sstyle="([^"]*)"/);
    if (!style) return tag;
    let rest = attrs.replace(style[0], '');
    const value = style[1].trim();
    // 最外層 svg 的寬度另外處理：放得下就照原寸，放不下就縮小
    if (!value || (el === 'svg' && /^max-width:/.test(value))) return `<${el}${rest}${close}>`;
    if (!classes.has(value)) classes.set(value, `m${classes.size + 1}`);
    const cls = classes.get(value);
    rest = /\sclass="/.test(rest) ? rest.replace(/\sclass="([^"]*)"/, (_, c) => ` class="${c} ${cls}"`) : `${rest} class="${cls}"`;
    return `<${el}${rest}${close}>`;
  });
  out = out.replace(/^<svg([^>]*?)\swidth="100%"/, '<svg$1');
  if (/\sstyle="/.test(out) || /<style/.test(out)) throw new Error(`${name} 的圖還有內嵌樣式，管理網站 CSP 會擋`);
  if (/<foreignObject/.test(out)) throw new Error(`${name} 的圖有 foreignObject（HTML 標籤），請維持 htmlLabels: false`);
  const scope = `#diagram-${name}`;
  const css = [
    scopeCss(styleMatch[1], scope),
    // 寬的圖最多縮到原寸八成（字才看得清楚），再寬就在框內左右捲
    `${scope} .diagram-frame > svg { width: 100%; max-width: ${Math.ceil(width)}px; min-width: ${Math.ceil(Math.min(width, Math.max(960, width * 0.8)))}px; }`,
    ...[...classes].map(([value, cls]) => `${scope} .${cls} { ${value.replace(/;?\s*$/, ';')} }`),
  ].join('\n');
  return { svg: out, css };
}

export const renderKey = source => createHash('sha256').update(`${RENDER_REV}\n${FONT_FAMILY}\n${source}`).digest('hex').slice(0, 16);

// 用無頭瀏覽器（Playwright 的 Chromium，跟網頁測試同一套）把每張 Mermaid 畫成 SVG。
// 沒裝 Playwright 或開不了瀏覽器就丟錯，由呼叫的一方決定要不要退回「到 GitHub 看圖」。
export async function renderMermaid(items) {
  if (!items.length) return new Map();
  // createRequire 才會照 NODE_PATH 找（worktree 沿用主工作目錄的 node_modules，docs/agents/local-checks.md）
  const { chromium } = createRequire(import.meta.url)('playwright');
  const [script, font] = await Promise.all([readFile(MERMAID_FILE, 'utf8'), readFile(FONT_FILE)]);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>@font-face { font-family: 'Geist'; font-weight: 400; src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2'); }</style></head><body></body></html>`);
    await page.addScriptTag({ content: script });
    return new Map(await page.evaluate(async ({ items, fontFamily }) => {
      await document.fonts.load("16px Geist");
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', fontFamily, htmlLabels: false, flowchart: { htmlLabels: false, wrappingWidth: 400 } });
      const out = [];
      for (const { name, source } of items) out.push([name, (await window.mermaid.render(`mmd-${name}`, source)).svg]);
      return out;
    }, { items, fontFamily: FONT_FAMILY }));
  } finally {
    await browser.close();
  }
}

// 第幾版＝main 上改過這個檔的 commit 數（一張 PR squash 成一個 commit），日期＝最後一次的 commit 時間。
// 淺層 clone（CI 測試預設只抓 1 個 commit）數不出來，寧可不顯示也不顯示錯的；部署管理網站的 workflow 抓完整歷史。
export function gitHistory(file, cwd) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    if (git('rev-parse', '--is-shallow-repository') !== 'false') return { version: null, updatedAt: null };
    const version = Number(git('rev-list', '--count', 'HEAD', '--', file));
    const updatedAt = git('log', '-1', '--format=%cI', '--', file);
    return version > 0 && updatedAt ? { version, updatedAt } : { version: null, updatedAt: null };
  } catch {
    return { version: null, updatedAt: null };
  }
}

export function diagramsCss(sections) {
  return `/* 由 scripts/admin-diagrams.mjs 從 ${DOC} 產出，不要手動改 */\n${FONT_FACE}\n${sections.map(s => s.css || '').filter(Boolean).join('\n')}\n`;
}
