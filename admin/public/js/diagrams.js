import { readDiagrams } from './api.js';
import { byId, element } from './dom.js';

// 系統架構圖頁：正本是 docs/ARCHITECTURE.md（Mermaid），建置時畫成 SVG 抽成 shared/diagrams.json（scripts/admin-diagrams.mjs），唯讀。
// 建置環境沒有無頭瀏覽器時沒有 SVG，該張圖改顯示 GitHub 連結（GitHub 會直接畫 Mermaid）。
const dateText = iso => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
export function versionText(doc) {
  const checked = doc.checked && doc.commit ? `核對日 ${doc.checked.replace(/-/g, '/')}（依據 main ${doc.commit}）` : '';
  const version = doc.version ? `第 ${doc.version} 版 · ${dateText(doc.updatedAt)} 更新` : '版本與日期要正式部署後才看得到';
  return checked ? `${version} · ${checked}` : version;
}

const validSection = s => s && typeof s.name === 'string' && typeof s.title === 'string' && typeof s.hasDiagram === 'boolean'
  && (s.svg === null || typeof s.svg === 'string') && Array.isArray(s.notes) && s.notes.every(n => typeof n === 'string');
export const parseDiagrams = data => (data && data.doc && typeof data.doc.url === 'string' && Array.isArray(data.sections) && data.sections.every(validSection) ? data : null);

function svgNode(markup) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.documentElement.nodeName !== 'svg') throw new Error('圖的格式不對');
  return document.importNode(doc.documentElement, true);
}

// 說明裡的 `程式碼` 顯示成 <code>，其餘是純文字（不用 innerHTML）
function noteItem(text) {
  const li = element('li');
  text.split(/(`[^`]*`)/).forEach(part => {
    if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) li.append(element('code', part.slice(1, -1)));
    else if (part) li.append(document.createTextNode(part));
  });
  return li;
}

function githubLink(url, text) {
  const link = element('a', text);
  link.href = url; link.target = '_blank'; link.rel = 'noopener';
  return link;
}

function sectionCard(s, url) {
  const section = element('section', undefined, 'card check-card diagram-card');
  section.id = `diagram-${s.name}`;
  section.setAttribute('aria-labelledby', `diagram-${s.name}-title`);
  const title = element('h2', s.title);
  title.id = `diagram-${s.name}-title`;
  section.append(title);
  if (s.hasDiagram && s.svg) {
    const frame = element('div', undefined, 'diagram-frame');
    frame.append(svgNode(s.svg));
    section.append(frame);
  } else if (s.hasDiagram) {
    const missing = element('p', '這張圖這次建置沒有畫出來（建置的電腦沒有無頭瀏覽器）。到 GitHub 看：', 'diagram-missing');
    missing.append(githubLink(url, 'docs/ARCHITECTURE.md'));
    section.append(missing);
  }
  const notes = element('ul', undefined, 'diagram-notes');
  notes.append(...s.notes.map(noteItem));
  section.append(notes);
  return section;
}

async function loadDiagrams() {
  const status = byId('diagram-status');
  const result = await readDiagrams();
  const data = result.ok ? parseDiagrams(result.data) : null;
  try {
    if (!data) throw new Error('架構圖格式不對');
    byId('diagrams').replaceChildren(...data.sections.map(s => sectionCard(s, data.doc.url)));
  } catch {
    status.dataset.error = 'true'; status.textContent = '架構圖讀取失敗，請重新整理。';
    return;
  }
  byId('diagram-version').textContent = versionText(data.doc);
  byId('diagram-source').replaceChildren(document.createTextNode('正本：'), githubLink(data.doc.url, 'GitHub 上的 docs/ARCHITECTURE.md'));
  byId('diagram-jump').replaceChildren(...data.sections.map(s => {
    const link = element('a', s.title);
    link.href = `#diagram-${s.name}`;
    return link;
  }));
  const missing = data.sections.filter(s => s.hasDiagram && !s.svg).length;
  status.removeAttribute('data-error');
  status.textContent = `共 ${data.sections.length} 段，由上往下是從整體到細節。` + (missing ? `其中 ${missing} 張圖這次沒畫出來，請到 GitHub 看。` : '');
}

loadDiagrams();
