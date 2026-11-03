// 讀架構圖正本 docs/ARCHITECTURE.md，事實核對和 PR 提醒共用。畫法照 agent-hub docs/rules/architecture-diagrams.md，總覽頁在 agent-hub 產生。
export const DOC = 'docs/ARCHITECTURE.md';
// 代號 → 段落標題（「## 」後面整行）。順序：整體 → 資料與排程 → 上線 → 兩條同步流程 → 程式模組
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

// ARCHITECTURE.md → { sections: [{ title, mermaid, notes[], start, end }] }；start／end 是段落的行號（從 1 算）
export function parseDoc(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
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
  return { sections };
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
