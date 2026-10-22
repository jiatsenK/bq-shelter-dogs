// 讀試算表（gviz）共用的部分：Worker（GET /walkers）和同步（scripts/sync-sheet.mjs）都 import 這一份，
// 欄位名稱、分隔符號只改這裡。只有純函式，不連網路。
//
// 主清單要分兩次讀：gviz 會照多數決猜欄位型別，表頭文字在數字欄會變空的，
// 所以先 headers=0 找表頭在第幾列（findHeaderRow），再指定表頭列數重讀、用欄位標題對欄（columnMap，標題缺的用第一次讀到的表頭文字補）。

// 主清單的欄位：key → 表頭文字
export const MAIN_COLUMNS = {
  cage: '籠位',
  id: '編號',
  name: '犬名',
  walkedDate: '遛狗日期',
  walker: '誰遛的',
  note: '備註',
};

// 「誰遛的」一格寫好幾個名字時用這些符號或空白隔開。志工手打時常用句號、分號、冒號隔開，也都當分隔
// （2026-10-04 K 回報「維芬。佳岑」抓不到佳岑）。apps-script/sheet-write.gs 的 NAME_SEP 要跟這裡一樣（測試會比對）
export const NAME_SEP = /[、,，\/／&＆+＋。｡．.;；:：|｜·・\s]+/;

// gviz 回應文字 → table；格式不對丟錯（訊息不含試算表內容），分頁讀取錯誤的細節放在 error.detail
export function gvizTable(text) {
  const m = String(text).match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!m) throw new Error('試算表回應格式不對');
  const data = JSON.parse(m[1]);
  if (data.status === 'error') {
    const error = new Error('試算表回應錯誤');
    error.detail = (data.errors || []).map(e => e.detailed_message || e.message).filter(Boolean).join('；');
    throw error;
  }
  return data.table || { cols: [], rows: [] };
}

// 一格的文字：日期格式用顯示文字
export function cellText(cell) {
  if (!cell || cell.v == null) return '';
  if (typeof cell.v === 'string' && cell.v.startsWith('Date(')) return cell.f || '';
  return String(cell.v).trim();
}

// 表頭文字去空白後比對：先找完全相同，再找結尾相同、包含（例：「備註 」、「犬名(暱稱)」）。回 { key: 第幾欄 }
export function findColumns(headerTexts, columns = MAIN_COLUMNS) {
  const norm = headerTexts.map(t => String(t || '').replace(/\s+/g, ''));
  const colMap = {};
  for (const [key, label] of Object.entries(columns)) {
    let idx = norm.indexOf(label);
    if (idx === -1) idx = norm.findIndex(t => t.endsWith(label));
    if (idx === -1) idx = norm.findIndex(t => t.includes(label));
    if (idx !== -1) colMap[key] = idx;
  }
  return colMap;
}

// 在「所有列都當資料」（headers=0）的回應裡找含「犬名」的表頭列，回傳第幾列（從 0 起算），找不到回 -1
export function findHeaderRow(table, columns = MAIN_COLUMNS) {
  return (table.rows || []).findIndex(r => findColumns((r.c || []).map(cellText), columns).name != null);
}

// table 是用 headers=表頭列數 重讀的結果；headerTexts 是第一次讀到的表頭列文字，欄位標題缺漏時拿來補
export function columnMap(table, headerTexts = [], columns = MAIN_COLUMNS) {
  const colMap = findColumns((table.cols || []).map(c => (c && c.label) || ''), columns);
  const fallback = findColumns(headerTexts, columns);
  for (const key of Object.keys(columns)) if (colMap[key] == null && fallback[key] != null) colMap[key] = fallback[key];
  return colMap;
}

// 「誰遛的」一格 → 名字清單（照格子裡的順序、去頭尾空白，不去重）
export const splitNames = text => String(text || '').split(NAME_SEP).map(n => n.trim()).filter(Boolean);
