// 核對表 CSV：寫的時候加 UTF-8 BOM、CRLF，Excel 直接開不會亂碼；讀的時候也認 Excel 另存的 Big5（「CSV（逗號分隔）」）。
export const ID_COLUMN = '（程式用，不用看）';
export const NO_NUMBER = '（沒有編號）';
export const COLUMNS = ['狗名', '原本的介紹', '編號', '入所日', '入所原因', '出所日', '離所原因', '說明', '對嗎', '改成的入所原因', '改成的離所原因', ID_COLUMN];
// 「對」照表上寫；「不對」「改」有填改成的就用改成的；「重複的狗」那筆不寫（刪掉）；空白＝這隻先不寫
export const CHOICES = ['對', '不對', '改', '重複的狗'];
// K 可能刪欄、移欄：用欄名找；這幾欄一定要在（少了入所原因、離所原因，「對」會把原因寫成空的）
export const REQUIRED = ['編號', '入所日', '入所原因', '出所日', '離所原因', '對嗎', ID_COLUMN];

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
  const names = head.map(h => (h.trim() === 'dog_id' ? ID_COLUMN : h.trim()));
  const missing = REQUIRED.filter(c => !names.includes(c));
  if (missing.length) throw new Error(`核對表少了欄位：${missing.join('、')}`);
  return body.map((r, i) => ({ ...Object.fromEntries(COLUMNS.map(c => [c, ''])), ...Object.fromEntries(names.map((h, j) => [h, (r[j] ?? '').trim()])), line: i + 2 }));
}
