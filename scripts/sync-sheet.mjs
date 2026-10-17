// 從 Google 試算表同步狗狗資料（#31）：讀試算表、整理成 dogs.json 的樣子、算溜狗紀錄和離所的函式。
// #251 起同步的入口是 scripts/sync-compact-d1.mjs（只寫 D1）；這支不再寫 data/，下面提到寫檔的段落是當時的做法，
// 函式本身（newWalks、updateDepartures 等）照用。
//
// 試算表 ID 不寫在 repo 裡（repo 是公開的，試算表目前知道連結就能編輯）：
// workflow 從 GitHub 的 Actions Secret「SHEET_ID」帶進來，設定方式見 docs/setup/SHEET_SYNC_SETUP.md。
// 「誰遛的」只輸出有沒有人固定照顧（covered），不把志工名字寫進公開的 dogs.json。
// 「是不是我遛的」（#57）：比對用的名字放 Actions Secret「MY_NAME」，公開檔案只寫 myWalked（true／false）。
// 「誰遛的」代號（#94）：每個名字用 Actions Secret「WALKER_KEY」算成一串亂碼代號（walkers），公開檔案只有代號。
// 網站透過 Worker（同一把 WALKER_KEY，見 worker/src/index.js 的 walkerCode）把志工輸入的名字換成代號，才認得出「我溜過」。
//
// 試算表的解析只在這裡做（#32 起前端只讀 dogs.json）。前端讀 dogs.json 的 parseDogsData 要讀得懂這裡寫出的格式，
// scripts/sync-sheet.test.mjs 會拿前端的函式來比對。
// 狗卡資訊（dogs/{編號}.md）也在這裡整理成純文字和性別一起寫進 dogs.json，網站不用逐隻抓 .md。
//
// 讀取失敗（網路、試算表沒公開、欄位被改掉、讀到 0 隻狗）時直接失敗結束，不寫檔，
// 保留上一次成功的 data/dogs.json。資料跟舊檔一樣時也不寫檔（連同步時間都不動），
// workflow 看到沒有變動就不提交。
//
// 歷史（#56）：試算表每隻狗只有一列、只記最後一次遛狗，所以每次同步另外存：
// - data/history/YYYY-MM-DD.json：當天快照，內容跟 dogs.json 一樣（同一天多次同步覆蓋成最後一次）
// - data/walks.json：遛狗紀錄 { id, name, date }，某隻狗的遛狗日期比上一次同步新就追加一筆；只追加、不改舊紀錄
// 兩者都不含志工名字。同一天兩次同步之間被遛兩次只會記一筆。
// #57 起每筆多一個 mine（是不是我遛的）；同一天從別人換成我（或反過來）也會追加一筆。
// #57 之前的舊紀錄沒有 mine，原樣保留、不回填。
// #94 起每筆多一個 walkers（遛的人的代號）；舊紀錄只補兩種：目前最後一次（試算表還看得到是誰）和標了 mine 的（補我的代號）。
// #60：另存 data/history/index.json（{ dates: [...] }，有哪幾天的快照），網站才知道能選哪些日期（GitHub Pages 不能列資料夾）。

import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';

// 日期一律用台灣時間判斷（沒寫年份的日期、同步時間）
if (!process.env.TZ) process.env.TZ = 'Asia/Taipei';

export const FORMAT_VERSION = 1;

// headers：前幾列當表頭。0 表示所有列都當資料列回傳
// range（例：A145:Z450）只讀那一段；gviz 照每欄多數的型別判斷，只讀一段時那一段自己算，不會被上面的編號（數字）帶走
export async function fetchGviz(sheetName, headers = 0, fetchImpl = fetch, range = '') {
  const sheetId = (process.env.SHEET_ID || '').trim();
  if (!sheetId) throw new Error('沒有設定試算表 ID：請到 GitHub repo 的 Settings → Secrets and variables → Actions 新增 Secret「SHEET_ID」。');
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:json&headers=${headers}&sheet=${encodeURIComponent(sheetName)}${range ? `&range=${encodeURIComponent(range)}` : ''}`;
  let res;
  try {
    res = await fetchImpl(url);
  } catch (e) {
    throw new Error(`連不到「${sheetName}」分頁：${e.message}`);
  }
  if (!res.ok) throw new Error(`讀取「${sheetName}」分頁失敗（HTTP ${res.status}），請確認試算表已設定「知道連結的人可檢視」。`);
  const text = await res.text();
  const match = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) throw new Error(`「${sheetName}」分頁回應格式異常，請確認試算表已設定「知道連結的人可檢視」。`);
  const data = JSON.parse(match[1]);
  if (data.status === 'error') {
    const detail = (data.errors || []).map(e => e.detailed_message || e.message).filter(Boolean).join('；');
    throw new Error(`讀取「${sheetName}」分頁失敗${detail ? `：${detail}` : ''}`);
  }
  return data.table || { cols: [], rows: [] };
}

export function cellText(cell) {
  if (!cell || cell.v == null) return '';
  if (typeof cell.v === 'string' && cell.v.startsWith('Date(')) return cell.f || '';
  return String(cell.v).trim();
}

// 把年月日組成日期；不合理的日期（例：2/30）回傳 null
function makeDate(y, m, d) {
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

// 文字日期：2026/9/1、2026-09-01、2026.9.1、2026年9月1日、民國 115/9/1、9/1（沒寫年份）
function parseDateText(text, today = new Date()) {
  const s = String(text).trim();
  if (!s) return null;
  let m = s.match(/(?<!\d)(\d{3,4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})(?!\d)/);
  if (m) {
    let y = parseInt(m[1], 10);
    if (y < 1000) y += 1911; // 民國年
    return makeDate(y, parseInt(m[2], 10), parseInt(m[3], 10));
  }
  m = s.match(/(?<!\d)(\d{1,2})\s*[\/月]\s*(\d{1,2})(?!\d)/);
  if (m) {
    const month = parseInt(m[1], 10), day = parseInt(m[2], 10);
    let date = makeDate(today.getFullYear(), month, day);
    // 沒寫年份又落在未來，就是去年（例：一月看到 12/28）
    if (date && date > today) date = makeDate(today.getFullYear() - 1, month, day);
    return date;
  }
  return null;
}

// 「遛狗日期」不論存成日期格式或文字都能讀
export function cellDate(cell, today = new Date()) {
  if (!cell || cell.v == null) return null;
  const v = cell.v;
  if (typeof v === 'string') {
    const m = v.match(/^Date\((\d+),(\d+),(\d+)/);
    if (m) return makeDate(parseInt(m[1], 10), parseInt(m[2], 10) + 1, parseInt(m[3], 10));
    return parseDateText(v, today);
  }
  if (typeof v === 'number') {
    // 欄位被當成數字時，先看顯示文字；否則視為試算表日期序號（1899/12/30 起算）
    if (cell.f) {
      const fromText = parseDateText(cell.f, today);
      if (fromText) return fromText;
    }
    if (v > 30000 && v < 80000) {
      const base = new Date(1899, 11, 30);
      return new Date(base.getFullYear(), base.getMonth(), base.getDate() + Math.floor(v));
    }
  }
  return null;
}

const MAIN_COLUMNS = {
  cage: '籠位',
  id: '編號',
  name: '犬名',
  walkedDate: '遛狗日期',
  walker: '誰遛的',
  note: '備註',
};

// 表頭文字去空白後比對：先找完全相同，再找包含（例：「備註 」、「犬名(暱稱)」）
function findColumns(headerTexts) {
  const norm = headerTexts.map(t => t.replace(/\s+/g, ''));
  const colMap = {};
  for (const [key, label] of Object.entries(MAIN_COLUMNS)) {
    let idx = norm.indexOf(label);
    if (idx === -1) idx = norm.findIndex(t => t.endsWith(label));
    if (idx === -1) idx = norm.findIndex(t => t.includes(label));
    if (idx !== -1) colMap[key] = idx;
  }
  return colMap;
}

// 在「所有列都當資料」的回應裡找含「犬名」的表頭列，回傳第幾列（從 0 起算）
export function findHeaderRow(table) {
  const rows = table.rows || [];
  for (let i = 0; i < rows.length; i++) {
    if (findColumns((rows[i].c || []).map(cellText)).name != null) return i;
  }
  return -1;
}

// table 是用 headers=表頭列數 重讀的結果；headerTexts 是第一次讀到的表頭列文字，欄位標題缺漏時拿來補
function mainColumnMap(table, headerTexts = []) {
  const labels = (table.cols || []).map(c => String((c && c.label) || '').trim());
  const colMap = findColumns(labels);
  const fallback = findColumns(headerTexts);
  for (const key of Object.keys(MAIN_COLUMNS)) {
    if (colMap[key] == null && fallback[key] != null) colMap[key] = fallback[key];
  }
  const missing = Object.keys(MAIN_COLUMNS).filter(k => colMap[k] == null).map(k => `「${MAIN_COLUMNS[k]}」`);
  if (missing.length) throw new Error(`主清單找不到${missing.join('')}欄，請確認表頭沒有被改掉。`);
  return colMap;
}

// 「誰遛的」格子裡有沒有我的名字。MY_NAME 可以寫好幾種寫法，用逗號或頓號隔開（例：本名、暱稱）；
// 格子裡有好幾個人時（例：「甲、乙」「甲。乙」「甲;乙」）逐一比對，要整個名字相同才算，不算部分符合
// 志工手打時常用句號、分號、冒號隔開，也都當分隔（2026-10-04 K 回報「志工甲。K」抓不到K）
const NAME_SEP = /[、,，\/／&＆+＋。｡．.;；:：|｜·・\s]+/;
export function myNames(env = process.env.MY_NAME) {
  return String(env || '').split(NAME_SEP).map(nameKey).filter(Boolean);
}
export function isMine(walkerText, names = myNames()) {
  if (!names.length) return false;
  return String(walkerText || '').split(NAME_SEP).map(nameKey).some(n => n && names.includes(n));
}

// ── 誰遛的代號（#94）──
// 名字 → 代號：HMAC-SHA256(WALKER_KEY, 整理過的名字) 的前 12 碼十六進位。
// 名字整理：全形半形統一（NFKC）、去掉所有空白、英文轉小寫。Worker 的 walkerCode 要用完全一樣的算法，
// 兩邊用同一組測試向量（scripts/sync-sheet.test.mjs、worker/test/worker.test.mjs 的 WALKER_VECTORS）確認一致。
// WALKER_KEY 一旦開始用就不要換：換了以後舊紀錄的代號就對不上了。
export const WALKER_CODE_LENGTH = 12;
export function walkerNameKey(name) {
  return String(name || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}
export function walkerCode(name, key = process.env.WALKER_KEY) {
  const k = walkerNameKey(name);
  if (!k || !key) return '';
  return createHmac('sha256', String(key)).update(k, 'utf8').digest('hex').slice(0, WALKER_CODE_LENGTH);
}
// 「誰遛的」格子（可能好幾個人）→ 代號清單，不重複、照格子裡的順序；沒設定 WALKER_KEY 時是空的
export function walkerCodes(walkerText, key = process.env.WALKER_KEY) {
  if (!key) return [];
  const codes = String(walkerText || '').split(NAME_SEP).map(n => walkerCode(n, key)).filter(Boolean);
  return [...new Set(codes)];
}

export function parseMainList(table, headerTexts = [], today = new Date(), names = myNames(), key = process.env.WALKER_KEY) {
  const colMap = mainColumnMap(table, headerTexts);
  const get = (c, key) => c[colMap[key]];
  const dogs = [];
  for (const r of table.rows || []) {
    const c = r.c || [];
    const name = cellText(get(c, 'name'));
    const cage = cellText(get(c, 'cage'));
    // 犬隻資料列一定有犬名和籠位；表尾的提示文字（例：「今天週四」）沒有籠位，不算狗
    if (!name || !cage || name === MAIN_COLUMNS.name) continue;
    dogs.push({
      cage,
      id: cellText(get(c, 'id')),
      name,
      walkedDate: cellDate(get(c, 'walkedDate'), today),
      // 只記有沒有人固定照顧，志工名字不寫進公開的 dogs.json
      covered: cellText(get(c, 'walker')) !== '',
      // 最後一次是不是我遛的；名字本身不寫出去
      myWalked: isMine(cellText(get(c, 'walker')), names),
      // 最後一次是誰遛的（代號）；名字本身不寫出去
      walkers: walkerCodes(cellText(get(c, 'walker')), key),
      note: cellText(get(c, 'note')),
    });
  }
  return dogs;
}

// 主清單分兩次讀：先找出表頭在第幾列，再指定表頭列數重讀
export async function loadMainList(fetchImpl = fetch, today = new Date()) {
  return (await loadMainSheet(fetchImpl, today)).dogs;
}
export async function loadMainSheet(fetchImpl = fetch, today = new Date()) {
  const raw = await fetchGviz('主清單', 0, fetchImpl);
  const headerIdx = findHeaderRow(raw);
  if (headerIdx === -1) throw new Error('主清單裡找不到含「犬名」的表頭列，請確認分頁名稱與欄位沒有被改掉。');
  const headerTexts = ((raw.rows[headerIdx] || {}).c || []).map(cellText);
  const table = await fetchGviz('主清單', headerIdx + 1, fetchImpl);
  return { dogs: parseMainList(table, headerTexts, today), notes: await loadSheetNotes(raw, headerTexts, fetchImpl) };
}

// ── 異動紀錄（K 2026-10-10）：主清單狗的下面那段，籠位欄寫「備註1」「備註2」…（之後的空白），編號欄寫內容 ──
// 例：「1/7新獨10奈威肛門腺破裂移至新B03休養」。沒有排版、會一直往下加，所以從第一個「備註」那列讀到底。
// 只讀不寫；讀失敗回 null，同步沿用上一次的（不擋狗的資料）
export const NOTES_MAX_ROWS = 400;
export function sheetNotesStart(raw, headerTexts) {
  const cage = findColumns(headerTexts).cage;
  if (cage == null) return -1;
  return (raw.rows || []).findIndex(r => /^備註/.test(cellText((r.c || [])[cage])));
}
export function parseSheetNotes(table, headerTexts) {
  const { cage, id } = findColumns(headerTexts);
  const out = [];
  for (const r of table.rows || []) {
    const c = r.c || [];
    const text = cellText(c[id]).replace(/\r\n?/g, '\n');
    if (!text) continue;
    out.push({ label: cellText(c[cage]), text });
  }
  return out;
}
async function loadSheetNotes(raw, headerTexts, fetchImpl) {
  const start = sheetNotesStart(raw, headerTexts);
  if (start === -1) return [];
  // headers=0 讀到的第 0 列是試算表第 1 列
  const row = start + 1;
  try {
    const table = await fetchGviz('主清單', 0, fetchImpl, `A${row}:Z${row + NOTES_MAX_ROWS}`);
    return parseSheetNotes(table, headerTexts);
  } catch (e) {
    console.warn(`讀不到主清單下方的異動紀錄，這次沿用上一次：${e.message}`);
    return null;
  }
}

// 犬名比對時忽略空白（含全形空白）
function nameKey(name) {
  return String(name).replace(/\s+/g, '');
}

// 常遛狗群：每一欄是一組可同籠的狗。只保留主清單上有的犬名，回傳的名單一律用主清單的寫法。
// parseGroupColumns 回傳每一欄的名單（D1 的 v3_sheet_groups 照欄存，#251），parseGroups 再合成每隻狗 → 同群的狗
export function parseGroupColumns(table, knownNames) {
  const rows = table.rows || [];
  const colCount = Math.max((table.cols || []).length, ...rows.map(r => (r.c || []).length), 0);
  // 英文名不分大小寫（試算表寫 Mini、主清單寫 MINI，K 2026-10-16）
  const groupKey = n => nameKey(n).toLowerCase();
  const known = knownNames ? new Map([...knownNames].map(n => [groupKey(n), n])) : null;
  const columns = [];
  for (let col = 0; col < colCount; col++) {
    const names = [];
    for (let i = 0; i < rows.length; i++) {
      let t = cellText((rows[i].c || [])[col]);
      if (!t || /^\d+$/.test(t)) continue;
      if (known) {
        t = known.get(groupKey(t));
        if (!t) continue;
      }
      if (!names.includes(t)) names.push(t);
    }
    columns.push(names);
  }
  return columns;
}

// 群名（K 2026-10-16）：分頁最下面有字的那一列是每群的名字（新十、舊八大…）；沒寫的欄是 ''，主清單的犬名不當群名
export function parseGroupLabels(table, knownNames) {
  const rows = table.rows || [];
  const colCount = Math.max((table.cols || []).length, ...rows.map(r => (r.c || []).length), 0);
  let last = rows.length - 1;
  while (last > 0 && !(rows[last].c || []).some(c => cellText(c))) last--;
  const known = new Set([...(knownNames || [])].map(n => nameKey(n).toLowerCase()));
  const labels = [];
  for (let col = 0; col < colCount; col++) {
    const t = last > 0 ? cellText((rows[last].c || [])[col]) : '';
    labels.push(t && !/^\d+$/.test(t) && !known.has(nameKey(t).toLowerCase()) ? t : '');
  }
  return labels;
}

export function parseGroups(table, knownNames) {
  const map = {};
  for (const names of parseGroupColumns(table, knownNames)) {
    names.forEach(n => {
      if (!map[n]) map[n] = new Set();
      names.forEach(m => { if (m !== n) map[n].add(m); });
    });
  }
  return map;
}

const pad = n => String(n).padStart(2, '0');
// 日期寫成本地（台灣）日期 YYYY-MM-DD，不帶時區，前端用 new Date(y, m - 1, d) 還原
export function formatDate(d) {
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null;
}
// 同步時間：台灣時間的 ISO 字串，例：2026-09-24T16:30:00+08:00
export function formatTimestamp(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${formatDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

// ── 狗卡資訊（dogs/{編號}.md，#9）：原本在前端做，改成同步時整理好寫進 dogs.json ──

// 去掉開頭的 YAML frontmatter（--- 到 ---），沒有就原樣回傳
export function parseFrontmatterBody(text) {
  const m = text.replace(/^\uFEFF/, '').match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  return (m ? m[1] : text).trim();
}

// 狗卡 frontmatter 的性別：male／female，其他都當作沒寫
export function parseFrontmatterSex(text) {
  const m = text.replace(/^\uFEFF/, '').match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return '';
  const sex = ((m[1].match(/^sex:\s*(male|female)\s*$/mi) || [])[1] || '').toLowerCase();
  return sex;
}

// 狗卡 frontmatter 的舊編號（#75）：同一隻狗再次入所會拿到新編號，舊的寫在 formerIds，多個用逗號／頓號／空白分開。
// 只收英數字，跟檔名的編號規則一樣
export function parseFrontmatterFormerIds(text) {
  const m = text.replace(/^\uFEFF/, '').match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return [];
  const line = (m[1].match(/^formerIds:[ \t]*(.*)$/mi) || [])[1] || '';
  return [...new Set(line.replace(/[\[\]"']/g, '').split(/[\s,，、]+/).filter(id => /^[0-9A-Za-z]+$/.test(id)))];
}

// 把 Markdown 轉成純文字，網站上不要露出 **、#、[]() 這些符號
export function markdownToText(md) {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/%%[\s\S]*?%%/g, '')                            // Obsidian 註解
    .split(/\r?\n/)
    .map(line => line
      .replace(/^\s*(```|~~~).*$/, '')                        // 程式碼區塊的框線
      .replace(/^\s*([-*_])(\s*\1){2,}\s*$/, '')              // 分隔線
      .replace(/^\s{0,3}#{1,6}\s+/, '')                       // 標題
      .replace(/^\s*(>\s*)+/, '')                             // 引用
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')                // 待辦清單
      .replace(/^\s*([-*+]|\d+[.)])\s+/, '')                  // 清單符號
      .replace(/^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*$/, '')    // 表格分隔列
      .replace(/!\[\[[^\]]*\]\]/g, '')                        // Obsidian 嵌入圖片
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')                  // 圖片
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')           // [[頁面|顯示文字]]
      .replace(/\[\[([^\]]*)\]\]/g, '$1')                      // [[頁面]]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')                 // [文字](網址)
      .replace(/<[^>]+>/g, '')                                // HTML 標籤
      .replace(/(\*\*|__)(.+?)\1/g, '$2')                      // 粗體
      .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')     // 斜體 *
      .replace(/(^|[^_\w])_(?!\s)(.+?)_(?![\w])/g, '$1$2')      // 斜體 _
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/==(.+?)==/g, '$1')
      .replace(/`+([^`]*)`+/g, '$1')
      .replace(/^\s*\||\|\s*$/g, '')                          // 表格左右框線
      .replace(/\s*\|\s*/g, ' ')
      .trim())
    .filter(Boolean)
    .join(' ');
}

// 讀 dogs/{編號}.md；沒有這個檔回空字串。編號只接受英數字，擋掉 ../ 之類的路徑
const CARD_ID = /^[0-9A-Za-z]+$/;
export async function readDogCardFile(id, dir) {
  if (!dir) throw new Error('舊狗卡讀取需明確提供封存目錄');
  if (!CARD_ID.test(id)) return '';
  try {
    return await readFile(new URL(`${id}.md`, dir), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

// 每隻狗加上 sex（male／female／空白）和 intro（狗卡資訊純文字）。沒有編號的狗不讀，也不改用犬名配對。
// 狗卡有寫舊編號才多一個 formerIds（#75），其他狗的 dogs.json 不變
export async function attachDogCards(dogs, readCard = async () => '') {
  const cards = new Map();
  for (const id of new Set(dogs.map(d => d.id).filter(Boolean))) {
    const raw = await readCard(id);
    if (!raw) { cards.set(id, null); continue; }
    const card = { sex: parseFrontmatterSex(raw), intro: markdownToText(parseFrontmatterBody(raw)) };
    const formerIds = parseFrontmatterFormerIds(raw).filter(f => f !== id);
    if (formerIds.length) card.formerIds = formerIds;
    cards.set(id, card);
  }
  return dogs.map(d => ({ ...d, sex: '', intro: '', ...(cards.get(d.id) || {}) }));
}

// 讀試算表、整理成 dogs.json 的內容（不含同步時間）。任何一個分頁讀取失敗都丟錯。
export async function buildData(fetchImpl = fetch, today = new Date(), readCard = readDogCardFile) {
  const [{ dogs: sheetDogs, notes: sheetNotes }, groupTable] = await Promise.all([
    loadMainSheet(fetchImpl, today),
    fetchGviz('常遛狗群', 0, fetchImpl),
  ]);
  if (!sheetDogs.length) throw new Error('主清單讀到 0 隻狗，可能是試算表被清空或格式變了，這次不更新。');
  const groupMap = parseGroups(groupTable, new Set(sheetDogs.map(d => d.name)));
  const groups = {};
  for (const [name, set] of Object.entries(groupMap)) groups[name] = [...set];
  const dogs = await attachDogCards(sheetDogs, readCard);
  return {
    dogs: dogs.map(d => ({ ...d, walkedDate: formatDate(d.walkedDate) })),
    groups,
    // 異動紀錄讀失敗是 null，main() 沿用上一次的
    sheetNotes,
  };
}

// 組成完整檔案內容；資料跟舊檔相同時回傳 null（不需要寫檔）
export function renderFile(data, oldText, now = new Date()) {
  if (oldText) {
    try {
      const old = JSON.parse(oldText);
      const { version, syncedAt, ...oldData } = old;
      if (version === FORMAT_VERSION && JSON.stringify(oldData) === JSON.stringify(data)) return null;
    } catch { /* 舊檔壞掉就直接覆蓋 */ }
  }
  return JSON.stringify({ version: FORMAT_VERSION, syncedAt: formatTimestamp(now), ...data }, null, 2) + '\n';
}

// ── 歷史（#56）──

export const WALKS_VERSION = 1;

// 比對同一隻狗：有編號用編號，沒編號才用犬名
export const dogKey = d => d.id ? `id:${d.id}` : `name:${nameKey(d.name)}`;
const walkersKey = list => [...(list || [])].sort().join(',');
const walkKey = (d, date, mine, walkers) => `${dogKey(d)}|${date}|${mine === true}|${walkersKey(walkers)}`;

// 從舊檔讀出遛狗紀錄；沒有或壞掉回傳 null（當作第一次建立）
export function parseWalks(text) {
  if (!text) return null;
  try {
    const old = JSON.parse(text);
    return Array.isArray(old.walks) ? old.walks : null;
  } catch { return null; }
}

// 算出這次要追加的紀錄。
// - 已經有紀錄檔：遛狗日期比上一次同步（prevDogs）新的狗才記；日期被改早、被清空都不記，也不刪舊紀錄
// - 同一天換人：日期沒變但「是不是我遛的」或遛的人（代號，#94）跟上一次不同，也記一筆（上一次沒有 myWalked 欄位時當作不是我）
//   上一次同步還沒有 walkers 欄位（#94 剛上線）時只看 mine，免得每隻狗都多記一筆；那一次的代號由 upgradeWalks 補進原本那筆
// - 第一次建立（walks 為 null）：每隻有遛狗日期的狗都記目前的最後一次，當作起點
// 同一隻狗同一天、同樣是不是我遛的，已經記過就不重複記。
// 例外：同一天的最後一筆跟現在不一樣（甲 → 甲、乙 → 甲，例如有人按錯又拿掉），再記一筆現在的，
// 「我溜過」以同一天最後一筆為準（K 2026-10-05 阿湯）。這條也會補回之前漏記的。
// 沒設定 WALKER_KEY 時新紀錄不加 walkers（不知道是誰，不是「沒人」），之後設定了還能由 upgradeWalks 補上
export function newWalks(dogs, prevDogs, walks, walkerKey = process.env.WALKER_KEY) {
  const seen = new Set((walks || []).map(w => walkKey(w, w.date, w.mine, w.walkers)));
  const lastOfDay = new Map((walks || []).map(w => [`${dogKey(w)}|${w.date}`, w]));
  const prev = new Map((prevDogs || []).map(d => [dogKey(d), d]));
  const added = [];
  for (const d of dogs) {
    if (!d.walkedDate) continue;
    const mine = d.myWalked === true;
    const walkers = d.walkers || [];
    const last = lastOfDay.get(`${dogKey(d)}|${d.walkedDate}`);
    if (last && walkerKey && 'walkers' in last && ((last.mine === true) !== mine || walkersKey(last.walkers) !== walkersKey(walkers))) {
      added.push({ id: d.id, name: d.name, date: d.walkedDate, mine, walkers });
      continue;
    }
    if (walks) {
      const before = prev.get(dogKey(d));
      if (before && before.walkedDate) {
        if (before.walkedDate > d.walkedDate) continue;
        const sameWalkers = !('walkers' in before) || walkersKey(before.walkers) === walkersKey(walkers);
        if (before.walkedDate === d.walkedDate && (before.myWalked === true) === mine && sameWalkers) continue;
      }
    }
    const key = walkKey(d, d.walkedDate, mine, walkers);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({ id: d.id, name: d.name, date: d.walkedDate, mine, ...(walkerKey ? { walkers } : {}) });
  }
  return added;
}

// 舊紀錄補上代號（#94），每次同步都跑、跑過的不會再改：
// 1. 還沒有 walkers 的紀錄，如果就是這隻狗目前的最後一次（同一天、是不是我遛的也一樣），補上試算表現在寫的人
// 2. 其他還沒有 walkers、但標了 mine 的舊紀錄，補上我的代號（MY_NAME 的第一個寫法），「我溜過」才不會掉
// 別人的舊紀錄當時沒存名字，補不回來，維持沒有 walkers。沒設定 WALKER_KEY 時什麼都不改。
export function upgradeWalks(walks, dogs, { key = process.env.WALKER_KEY, names = myNames() } = {}) {
  if (!key || !walks) return { walks, changed: false };
  const myCode = names.length ? walkerCode(names[0], key) : '';
  const current = new Map(dogs.filter(d => d.walkedDate).map(d => [dogKey(d), d]));
  // 每隻狗最後一筆還沒有代號的紀錄（後記的在後面）
  const lastIndex = new Map();
  walks.forEach((w, i) => { if (!('walkers' in w)) lastIndex.set(dogKey(w), i); });
  let changed = false;
  const out = walks.map((w, i) => {
    if ('walkers' in w) return w;
    const d = current.get(dogKey(w));
    if (d && lastIndex.get(dogKey(w)) === i && d.walkedDate === w.date && (d.myWalked === true) === (w.mine === true) && d.walkers.length) {
      changed = true;
      return { ...w, walkers: d.walkers };
    }
    if (w.mine === true && myCode) {
      changed = true;
      return { ...w, walkers: [myCode] };
    }
    return w;
  });
  return { walks: out, changed };
}

// 每隻狗我最後一次遛的日期：遛狗紀錄裡 mine 的最新日期；目前最後一次是我遛的也算
export function attachMyWalkedDate(dogs, walks) {
  const lastOfDay = new Map((walks || []).map(w => [`${dogKey(w)}|${w.date}`, w])); // 同一天以最後一筆為準
  const latest = new Map();
  for (const w of lastOfDay.values()) {
    if (w.mine !== true || !w.date) continue;
    const k = dogKey(w);
    if (!latest.has(k) || latest.get(k) < w.date) latest.set(k, w.date);
  }
  return dogs.map(d => {
    let date = latest.get(dogKey(d)) || null;
    if (d.myWalked && d.walkedDate && (!date || date < d.walkedDate)) date = d.walkedDate;
    return { ...d, myWalkedDate: date };
  });
}

// 一筆紀錄一行，檔案變大後 git 的差異也只有新增的那幾行
export function renderWalks(walks) {
  // #57 之前的舊紀錄沒有 mine、#94 之前的沒有 walkers，照原樣寫回
  const lines = walks.map(w => '    ' + JSON.stringify({
    id: w.id, name: w.name, date: w.date,
    ...('mine' in w ? { mine: w.mine === true } : {}),
    ...('walkers' in w ? { walkers: w.walkers } : {}),
  }));
  return `{\n  "version": ${WALKS_VERSION},\n  "walks": [\n${lines.join(',\n')}${lines.length ? '\n' : ''}  ]\n}\n`;
}

// 同步一次要寫哪些檔：回傳 { 相對 data/ 的路徑: 內容 }，沒變的檔不列。
// oldDogsText／oldWalksText／oldSnapshotText／oldIndexText 是 dogs.json、walks.json、今天快照、快照目錄的舊內容（沒有就空字串）；
// historyDates 是 data/history/ 裡已經有的快照日期
export function planWrites(data, { oldDogsText = '', oldWalksText = '', oldSnapshotText = '', oldIndexText = '', historyDates = [] } = {}, now = new Date()) {
  const writes = {};
  let prevDogs = null;
  try { prevDogs = JSON.parse(oldDogsText).dogs; } catch { /* 沒有舊檔：只能靠 walks.json 去重 */ }
  const { walks, changed } = upgradeWalks(parseWalks(oldWalksText), data.dogs);
  const added = newWalks(data.dogs, prevDogs, walks);
  const allWalks = [...(walks || []), ...added];
  if (added.length || changed || !walks) writes['walks.json'] = renderWalks(allWalks);

  // dogs.json 的 myWalkedDate 要看整份遛狗紀錄，所以先算紀錄再寫 dogs.json
  data = { ...data, dogs: attachMyWalkedDate(data.dogs, allWalks) };
  const dogsText = renderFile(data, oldDogsText, now);
  if (dogsText) writes['dogs.json'] = dogsText;
  const current = dogsText || oldDogsText;
  if (current !== oldSnapshotText) writes[`history/${formatDate(now)}.json`] = current;
  const indexText = renderHistoryIndex([...historyDates, formatDate(now)]);
  if (indexText !== oldIndexText) writes['history/index.json'] = indexText;
  return { writes, added };
}

// 快照目錄：日期由舊到新、不重複
export function renderHistoryIndex(dates) {
  const list = [...new Set(dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  return `{\n  "version": 1,\n  "dates": [${list.map(d => JSON.stringify(d)).join(', ')}]\n}\n`;
}

// ── 離所（#162）──
// 狗從主清單消失就記一筆離所，寫進 data/departures.json。原因只讀試算表「已出所」分頁（只讀，不寫入）：
// 用編號找到那隻狗的那一列，整列文字套下面的關鍵字規則。判不出來、互相矛盾、找不到那一列都標「待確認」（unknown），
// 不從別的線索推測（K 2026-10-08）。每次同步都重查，志工之後補上原因就會改過來。
// 公開檔只存分類和命中的關鍵字，不存已出所分頁的原文（認養人、病況等都不會進 repo）。

export const DEPARTURES_VERSION = 1;
export const DEPARTED_SHEET = '已出所';

// 關鍵字表：同一類寫長的在前，命中時記下是哪個字
export const DEPARTURE_KEYWORDS = {
  adopt: ['被認養', '被領養', '認養', '領養', '送養', '出養'],
  death: ['安樂死', '死亡', '過世', '離世', '往生', '病逝', '去世', '安樂', '當天使', '小天使'],
  other: ['原主領回', '飼主領回', '主人領回', '領回', '轉送', '轉所', '移送', '逃脫', '走失'],
};
// 關鍵字前面接這些字就不算（「未認養」「想認養」「待認養」都不是真的認養了）
const NOT_BEFORE = /(未|沒|沒有|不|取消|想|想要|有意|詢問|考慮|預計|準備|等待|待|申請|試)$/;
// 關鍵字後面接這些字也不算（「認養未成」「認養失敗」「領養人」）
const NOT_AFTER = /^(未|沒|不|失敗|取消|人|者|資格|條件|申請|中)/;
// 出現這些字整筆都標待確認（認養後被退回、試養還沒定案）
const UNSURE_WORDS = ['退養', '退回', '試養'];

// 一段文字 → { reason, matched, flags }。reason：adopt／death／other／unknown
export function classifyDeparture(text) {
  const s = String(text || '').replace(/\s+/g, '');
  const hits = {};
  for (const [reason, words] of Object.entries(DEPARTURE_KEYWORDS)) {
    for (const w of words) {
      let i = s.indexOf(w);
      while (i !== -1) {
        // 已經被同一類更長的字命中的位置（例：被認養裡的認養）不重算
        const covered = (hits[reason] || []).some(h => i >= h.at && i < h.at + h.word.length);
        if (!covered && !NOT_BEFORE.test(s.slice(Math.max(0, i - 3), i)) && !NOT_AFTER.test(s.slice(i + w.length))) {
          (hits[reason] = hits[reason] || []).push({ word: w, at: i });
        }
        i = s.indexOf(w, i + 1);
      }
    }
  }
  const reasons = Object.keys(hits);
  const unsure = UNSURE_WORDS.find(w => s.includes(w));
  if (unsure) return { reason: 'unknown', matched: unsure, flags: ['unsure'] };
  if (reasons.length > 1) return { reason: 'unknown', matched: reasons.map(r => hits[r][0].word).join('、'), flags: ['conflict'] };
  if (!reasons.length) return { reason: 'unknown', matched: '', flags: [] };
  // 同一類命中好幾次：取最後一次（通常是最新補上的那句）
  const last = hits[reasons[0]].reduce((a, b) => (b.at > a.at ? b : a));
  return { reason: reasons[0], matched: last.word, flags: [], at: last.at, text: s }; // at、text 給 dateBeforeMatch 找日期用，不寫出去
}

// 關鍵字前面緊接的日期（例：「2026/10/1被認養」）
export function dateBeforeMatch(text, at, today = new Date()) {
  if (at == null) return null;
  const before = text.slice(Math.max(0, at - 16), at);
  const m = before.match(/((?:\d{3,4}\s*[\/\-.年]\s*)?\d{1,2}\s*[\/\-.月]\s*\d{1,2}日?)\s*$/);
  return m ? parseDateText(m[1], today) : null;
}

// 已出所分頁裡跟出所日期有關的欄（表頭有出所／離所／認養／死亡，又不是遛狗日期）
const DEPART_DATE_HEADER = /(出所|離所|認養|領養|死亡)/;

// 已出所分頁 → 每列的 { texts（每格文字）, departDate（出所日期欄） }。
// table 是指定表頭列數重讀的結果（跟主清單一樣，headers=0 讀時數字、日期欄的表頭會被當成 null，見 loadDepartedRows）
export function departedRows(table, today = new Date()) {
  const labels = ((table && table.cols) || []).map(c => String((c && c.label) || '').replace(/\s+/g, ''));
  const dateCols = labels.map((h, i) => (DEPART_DATE_HEADER.test(h) && !/遛|溜/.test(h) ? i : -1)).filter(i => i !== -1);
  return ((table && table.rows) || []).map(r => {
    const c = r.c || [];
    let departDate = null;
    for (const ci of dateCols) departDate = cellDate(c[ci], today) || departDate;
    return { texts: c.map(cellText).filter(Boolean), departDate: departDate && departDate <= today ? departDate : null };
  });
}

// 一隻狗在已出所分頁的判讀結果：用編號找，沒編號才用犬名（犬名要剛好一列才算）
export function judgeDeparture(dog, rows, today = new Date()) {
  if (!rows) return null; // 讀不到分頁：沿用上一次
  let found = dog.id ? rows.filter(r => r.texts.includes(dog.id)) : [];
  if (!found.length && !dog.id) {
    const byName = rows.filter(r => r.texts.some(t => nameKey(t) === nameKey(dog.name)));
    if (byName.length === 1) found = byName;
  }
  if (!found.length) return { reason: 'unknown', matched: '', flags: ['not-in-sheet'], date: null };
  const results = found.map(r => {
    const c = classifyDeparture(r.texts.join(' '));
    // 關鍵字前面緊接的日期只在同一格裡找，免得抓到隔壁的遛狗日期
    const cell = c.reason !== 'unknown' ? [...r.texts].reverse().map(t => t.replace(/\s+/g, '')).find(t => t.includes(c.matched)) : null;
    const date = r.departDate || (cell ? dateBeforeMatch(cell, cell.lastIndexOf(c.matched), today) : null);
    return { ...c, date: date ? formatDate(date) : null, dateSource: r.departDate ? 'sheet' : date ? 'note' : null };
  });
  const reasons = [...new Set(results.map(r => r.reason))];
  if (reasons.length > 1) return { reason: 'unknown', matched: results.map(r => r.matched).filter(Boolean).join('、'), flags: ['duplicate'], date: null };
  const best = results[results.length - 1];
  return { reason: best.reason, matched: best.matched, flags: [...new Set(results.flatMap(r => r.flags))], date: best.date, dateSource: best.dateSource };
}

// 找出從主清單消失的狗：snapshots 依日期由舊到新 [{ date, dogs }]；回傳 Map 編號 → { dog, seen（第一次不在的那天） }
// 沒有編號的狗不追（犬名不唯一）。中間消失又回來的不算
export function findDisappeared(snapshots) {
  const gone = new Map();
  for (let i = 1; i < snapshots.length; i++) {
    const now = new Set(snapshots[i].dogs.map(d => d.id).filter(Boolean));
    for (const id of now) gone.delete(id);
    for (const d of snapshots[i - 1].dogs) {
      if (d.id && !now.has(d.id) && !gone.has(d.id)) gone.set(d.id, { dog: d, seen: snapshots[i].date });
    }
  }
  return gone;
}

// 離開主清單前最後一次的樣子：給離所名冊開詳細資訊用。不含誰遛的代號
function lastSeenDog(d, groups) {
  const out = { cage: d.cage || '', id: d.id, name: d.name, walkedDate: d.walkedDate || null, note: d.note || '', sex: d.sex || '', intro: d.intro || '' };
  if (d.formerIds && d.formerIds.length) out.formerIds = d.formerIds;
  const g = groups && groups[d.name];
  if (g && g.length) out.groups = g;
  return out;
}

export function parseDepartures(text) {
  if (!text) return null;
  try {
    const old = JSON.parse(text);
    return Array.isArray(old.departures) ? old.departures : null;
  } catch { return null; }
}

// 算出新的離所清單。
// - old：上一次的 departures（null＝第一次，從 snapshots 補）
// - snapshots：[{ date, dogs, groups }] 由舊到新，最後一個是這次同步；第一次用全部快照，之後只要上一次和這次
// - rows：departedRows() 的結果；null＝這次讀不到已出所分頁，原因沿用上一次
export function updateDepartures(old, snapshots, rows, today = new Date()) {
  const current = snapshots[snapshots.length - 1].dogs;
  const currentIds = new Set(current.map(d => d.id).filter(Boolean));
  const reentered = new Map();
  for (const d of current) for (const f of d.formerIds || []) reentered.set(f, d.id);
  const byId = new Map((old || []).map(e => [e.id, e]));
  for (const [id, { dog, seen }] of findDisappeared(snapshots)) {
    if (byId.has(id)) continue;
    const groups = (snapshots.find(s => s.dogs.includes(dog)) || {}).groups;
    byId.set(id, { id, name: dog.name, seen, last: lastSeenDog(dog, groups) });
  }
  const out = [];
  for (const e of byId.values()) {
    if (currentIds.has(e.id)) continue; // 又回到主清單（例：誤刪），不算離所
    let j = judgeDeparture(e.last || e, rows, today);
    // 已出所分頁那一列後來不見了（例：整理分頁）：已經判出來的原因不丟掉
    if (j && j.flags.includes('not-in-sheet') && e.reason && e.reason !== 'unknown') j = null;
    const keep = j || { reason: e.reason || 'unknown', matched: e.matched || '', flags: e.flags || [], date: e.dateSource && e.dateSource !== 'seen' ? e.date : null, dateSource: e.dateSource };
    const date = keep.date || e.seen;
    const entry = {
      id: e.id, name: e.name,
      date, dateSource: keep.date ? keep.dateSource : 'seen', seen: e.seen,
      reason: keep.reason, matched: keep.matched, flags: keep.flags,
    };
    if (reentered.has(e.id)) entry.returned = reentered.get(e.id);
    entry.last = e.last;
    out.push(entry);
  }
  return out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));
}

export function renderDepartures(list) {
  const lines = list.map(e => '    ' + JSON.stringify(e));
  return `{\n  "version": ${DEPARTURES_VERSION},\n  "departures": [\n${lines.join(',\n')}${lines.length ? '\n' : ''}  ]\n}\n`;
}

// 讀已出所分頁；失敗回 null（不擋主清單同步）
export async function loadDepartedRows(fetchImpl = fetch, today = new Date()) {
  try {
    const raw = await fetchGviz(DEPARTED_SHEET, 0, fetchImpl);
    const headerIdx = findHeaderRow(raw);
    return departedRows(headerIdx === -1 ? raw : await fetchGviz(DEPARTED_SHEET, headerIdx + 1, fetchImpl), today);
  } catch (e) {
    console.warn(`讀不到「${DEPARTED_SHEET}」分頁，離所原因這次沿用上一次：${e.message}`);
    return null;
  }
}

// 這次要不要寫 departures.json：回傳新內容，沒變回 null
export function planDepartures({ oldText = '', snapshots, rows, today = new Date() }) {
  const list = updateDepartures(parseDepartures(oldText), snapshots, rows, today);
  const text = renderDepartures(list);
  return text === oldText ? null : text;
}
