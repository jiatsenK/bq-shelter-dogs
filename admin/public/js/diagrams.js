import { readDiagrams } from './api.js';
import { byId, element } from './dom.js';

// 系統架構圖頁：圖的正本是 docs/diagrams/，建置時抽成 shared/diagrams.json（scripts/admin-diagrams.mjs），唯讀。
const dateText = iso => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
export const versionText = d => (d.version ? `第 ${d.version} 版 · ${dateText(d.updatedAt)} 更新` : '版本與日期要正式部署後才看得到');

function svgNode(markup) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.documentElement.nodeName !== 'svg') throw new Error('圖的格式不對');
  return document.importNode(doc.documentElement, true);
}

async function loadDiagrams() {
  const status = byId('diagram-status');
  const result = await readDiagrams();
  const diagrams = result.ok && Array.isArray(result.data) && result.data.every(d => d && typeof d.name === 'string' && typeof d.svg === 'string') ? result.data : null;
  if (!diagrams) { status.dataset.error = 'true'; status.textContent = '架構圖讀取失敗，請重新整理。'; return; }
  try {
    byId('diagrams').replaceChildren(...diagrams.map(d => {
      const section = element('section', undefined, 'card check-card diagram-card');
      section.id = `diagram-${d.name}`;
      section.setAttribute('aria-labelledby', `diagram-${d.name}-title`);
      const title = element('h2', d.title);
      title.id = `diagram-${d.name}-title`;
      const frame = element('div', undefined, 'diagram-frame');
      frame.append(svgNode(d.svg));
      section.append(title, element('p', versionText(d), 'diagram-version'), frame, element('p', d.note, 'data-note'));
      return section;
    }));
  } catch {
    status.dataset.error = 'true'; status.textContent = '架構圖讀取失敗，請重新整理。'; return;
  }
  byId('diagram-jump').replaceChildren(...diagrams.map(d => {
    const link = element('a', d.title);
    link.href = `#diagram-${d.name}`;
    return link;
  }));
  status.removeAttribute('data-error');
  status.textContent = `共 ${diagrams.length} 張，由上往下是從整體到細節。`;
}

loadDiagrams();
