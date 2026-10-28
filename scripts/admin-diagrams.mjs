import { execFileSync } from 'node:child_process';

// 管理網站「系統架構圖」頁：正本是 docs/diagrams/*.html，建置時抽出圖、說明與 git 版本資訊，不另存一份。
// 管理網站 CSP 是 style-src 'self'，所以圖裡的 <style> 拆成外部 CSS（每張圖各自加範圍，避免同名 class 互相蓋）；
// 字型也不能連 Google Fonts，改用 admin/public/vendor/fonts/ 自架的拉丁字型，中文用電腦內建字型。
// 順序：先看整體，再看兩條資料路線，最後看排程與環境（K 2026-10-28）。
export const DIAGRAMS = ['architecture', 'data-flows', 'writeback-sequence', 'sheet-sync-sequence', 'daily-schedule', 'environments'];

const FONT_FACES = [
  ['Geist', 400, 'normal', 'geist-sans-latin-400-normal'],
  ['Geist', 500, 'normal', 'geist-sans-latin-500-normal'],
  ['Geist', 600, 'normal', 'geist-sans-latin-600-normal'],
  ['Geist Mono', 400, 'normal', 'geist-mono-latin-400-normal'],
  ['Instrument Serif', 400, 'italic', 'instrument-serif-latin-400-italic'],
].map(([family, weight, style, file]) => `@font-face { font-family: '${family}'; font-weight: ${weight}; font-style: ${style}; font-display: swap; src: url('../vendor/fonts/${file}.woff2') format('woff2'); }`).join('\n');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const text = html => html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e]).replace(/\s+/g, ' ').trim();
const one = (html, re, what, name) => {
  const match = html.match(re);
  if (!match) throw new Error(`${name}.html 找不到${what}`);
  return match[1];
};

// 每張圖的 id 都加上圖名，六張放同一頁時 #arrow、#dots 才不會指到別張圖的
export function prefixIds(svg, name) {
  return svg
    .replace(/\bid="([^"]+)"/g, (_, id) => `id="${name}--${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${name}--${id})`)
    .replace(/\bhref="#([^"]+)"/g, (_, id) => `href="#${name}--${id}"`)
    .replace(/\baria-labelledby="([^"]+)"/g, (_, ids) => `aria-labelledby="${ids.split(/\s+/).map(id => `${name}--${id}`).join(' ')}"`);
}

// 圖裡的 CSS 只有「選擇器 { 宣告 }」，每個選擇器前面加上這張圖的範圍
export function scopeCss(css, scope) {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) =>
    `${selectors.split(',').map(s => `${scope} ${s.trim()}`).join(', ')} { ${body.trim()} }`).join('\n');
}

export function extractDiagram(html, name) {
  const svgFull = one(html, /(<svg[\s\S]*<\/svg>)/, ' <svg>', name);
  const css = one(svgFull, /<style>([\s\S]*?)<\/style>/, '圖裡的 <style>', name);
  const svg = prefixIds(svgFull.replace(/\s*<style>[\s\S]*?<\/style>/, ''), name);
  if (/\sstyle="/.test(svg)) throw new Error(`${name}.html 的圖有 style 屬性，管理網站 CSP 會擋；改用 class`);
  return {
    name,
    title: text(one(html, /<h1[^>]*>([\s\S]*?)<\/h1>/, '標題 <h1>', name)),
    note: text(one(html, /<p class="note">([\s\S]*?)<\/p>/, '說明 <p class="note">', name)),
    svg,
    css: scopeCss(css, `#diagram-${name}`),
  };
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

export function diagramsCss(diagrams) {
  return `/* 由 scripts/admin-diagrams.mjs 從 docs/diagrams/*.html 產出，不要手動改 */\n${FONT_FACES}\n${diagrams.map(d => d.css).join('\n')}\n`;
}
