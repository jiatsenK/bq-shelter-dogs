// 主頁共用的小工具：HTML 跳脫、圖示、日期文字、搜尋比對。純函式，不讀頁面狀態，Node 也能匯入。

export function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function icon(id) {
  return `<svg class="icon"><use href="#i-${id}"/></svg>`;
}

// 把備註原文裡所有命中的字眼標成紅色粗體；其餘文字照樣跳脫
export function highlightNote(note, terms) {
  if (!terms || !terms.length) return esc(note);
  const sorted = [...new Set(terms)].sort((a, b) => b.length - a.length);
  const re = new RegExp(sorted.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  let html = '', last = 0;
  for (const m of note.matchAll(re)) {
    html += esc(note.slice(last, m.index)) + `<mark>${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return html + esc(note.slice(last));
}

export const monthDay = d => `${d.getMonth() + 1}/${d.getDate()}`;

export function pad2(n) {
  return String(n).padStart(2, '0');
}

// 日期 → YYYY-MM-DD（日期輸入框、送給 Worker 用）
export function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ymdText(d) {
  return d ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` : '日期不明';
}

// 搜尋比對用：去掉空白、全形轉半形、英文不分大小寫
export function searchKey(text) {
  return String(text || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

// 犬名部分符合即算；沒輸入（或只有空白）時每隻都符合
export function matchesSearch(dog, query) {
  const q = searchKey(query);
  return !q || searchKey(dog.name).includes(q);
}
