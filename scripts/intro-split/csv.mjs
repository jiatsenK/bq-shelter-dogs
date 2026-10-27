// 核對表 CSV：寫的時候加 UTF-8 BOM、CRLF，Excel 直接開不會亂碼；讀的時候也認 Excel 另存的 Big5（「CSV（逗號分隔）」）。
export const COLUMNS = ['狗名', 'dog_id', '在所', '項目', '放哪一筆', '入所日', '出所日', '介紹原文', '現有的值', '建議值', '建議字數', '注意', 'K勾選', 'K改成'];
export const CHOICES = ['同意', '改成', '不改'];

const cell = v => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows) {
  return '﻿' + [COLUMNS, ...rows.map(r => COLUMNS.map(c => r[c]))].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function decodeCsv(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); }
  catch { return new TextDecoder('big5').decode(bytes); }
}

// 回 [{ 欄名: 值 }]，每列多帶 line（試算表的列號，表頭是第 1 列）
export function parseCsv(text) {
  const records = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); records.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); records.push(row); }
  const [head, ...body] = records.filter(r => r.some(v => v.trim()));
  if (!head) return [];
  const missing = COLUMNS.filter(c => !head.includes(c));
  if (missing.length) throw new Error(`核對表少了欄位：${missing.join('、')}`);
  return body.map((r, i) => ({ ...Object.fromEntries(head.map((h, j) => [h, (r[j] ?? '').trim()])), line: i + 2 }));
}
