// 從 Google 試算表同步狗狗資料，產生 data/dogs.json（#31）。
// 由 .github/workflows/sync-sheet.yml 定期執行；也可以在本機跑：SHEET_ID=試算表ID node scripts/sync-sheet.mjs
//
// 試算表 ID 不寫在 repo 裡（repo 是公開的，試算表目前知道連結就能編輯）：
// workflow 從 GitHub 的 Actions Secret「SHEET_ID」帶進來，設定方式見 docs/SHEET_SYNC_SETUP.md。
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

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 日期一律用台灣時間判斷（沒寫年份的日期、同步時間）
if (!process.env.TZ) process.env.TZ = 'Asia/Taipei';

export const OUTPUT = fileURLToPath(new URL('../data/dogs.json', import.meta.url));
export const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
export const DOGS_DIR = fileURLToPath(new URL('../dogs/', import.meta.url));
export const FORMAT_VERSION = 1;

// headers：前幾列當表頭。0 表示所有列都當資料列回傳
export async function fetchGviz(sheetName, headers = 0, fetchImpl = fetch) {
  const sheetId = (process.env.SHEET_ID || '').trim();
  if (!sheetId) throw new Error('沒有設定試算表 ID：請到 GitHub repo 的 Settings → Secrets and variables → Actions 新增 Secret「SHEET_ID」。');
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:json&headers=${headers}&sheet=${encodeURIComponent(sheetName)}`;
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
// 格子裡有好幾個人時（例：「甲、乙」）逐一比對，要整個名字相同才算，不算部分符合
const NAME_SEP = /[、,，\/／&＆+＋\s]+/;
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
  const raw = await fetchGviz('主清單', 0, fetchImpl);
  const headerIdx = findHeaderRow(raw);
  if (headerIdx === -1) throw new Error('主清單裡找不到含「犬名」的表頭列，請確認分頁名稱與欄位沒有被改掉。');
  const headerTexts = ((raw.rows[headerIdx] || {}).c || []).map(cellText);
  const table = await fetchGviz('主清單', headerIdx + 1, fetchImpl);
  return parseMainList(table, headerTexts, today);
}

// 犬名比對時忽略空白（含全形空白）
function nameKey(name) {
  return String(name).replace(/\s+/g, '');
}

// 常遛狗群：每一欄是一組可同籠的狗。只保留主清單上有的犬名，回傳的名單一律用主清單的寫法。
export function parseGroups(table, knownNames) {
  const rows = table.rows || [];
  const colCount = Math.max((table.cols || []).length, ...rows.map(r => (r.c || []).length), 0);
  const known = knownNames ? new Map([...knownNames].map(n => [nameKey(n), n])) : null;
  const map = {};
  for (let col = 0; col < colCount; col++) {
    const names = [];
    for (let i = 0; i < rows.length; i++) {
      let t = cellText((rows[i].c || [])[col]);
      if (!t || /^\d+$/.test(t)) continue;
      if (known) {
        t = known.get(nameKey(t));
        if (!t) continue;
      }
      if (!names.includes(t)) names.push(t);
    }
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
export async function readDogCardFile(id) {
  if (!CARD_ID.test(id)) return '';
  try {
    return await readFile(`${DOGS_DIR}${id}.md`, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

// 每隻狗加上 sex（male／female／空白）和 intro（狗卡資訊純文字）。沒有編號的狗不讀，也不改用犬名配對。
// 狗卡有寫舊編號才多一個 formerIds（#75），其他狗的 dogs.json 不變
export async function attachDogCards(dogs, readCard = readDogCardFile) {
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
  const [sheetDogs, groupTable] = await Promise.all([
    loadMainList(fetchImpl, today),
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
const dogKey = d => d.id ? `id:${d.id}` : `name:${nameKey(d.name)}`;
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
// 沒設定 WALKER_KEY 時新紀錄不加 walkers（不知道是誰，不是「沒人」），之後設定了還能由 upgradeWalks 補上
export function newWalks(dogs, prevDogs, walks, walkerKey = process.env.WALKER_KEY) {
  const seen = new Set((walks || []).map(w => walkKey(w, w.date, w.mine, w.walkers)));
  const prev = new Map((prevDogs || []).map(d => [dogKey(d), d]));
  const added = [];
  for (const d of dogs) {
    if (!d.walkedDate) continue;
    const mine = d.myWalked === true;
    const walkers = d.walkers || [];
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
  const latest = new Map();
  for (const w of walks || []) {
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

async function main() {
  const data = await buildData();
  const now = new Date();
  const read = path => readFile(`${DATA_DIR}${path}`, 'utf8').catch(() => '');
  const { writes, added } = planWrites(data, {
    oldDogsText: await read('dogs.json'),
    oldWalksText: await read('walks.json'),
    oldSnapshotText: await read(`history/${formatDate(now)}.json`),
    oldIndexText: await read('history/index.json'),
    historyDates: (await readdir(`${DATA_DIR}history`).catch(() => [])).map(f => f.replace(/\.json$/, '')),
  }, now);
  for (const [path, text] of Object.entries(writes)) {
    await mkdir(dirname(`${DATA_DIR}${path}`), { recursive: true });
    await writeFile(`${DATA_DIR}${path}`, text);
  }
  if (writes['dogs.json']) {
    console.log(`已更新 data/dogs.json：${data.dogs.length} 隻狗、${data.dogs.filter(d => d.intro).length} 隻有狗卡資訊、${Object.values(data.groups).filter(g => g.length).length} 隻有可以一起溜的狗。`);
  } else {
    console.log(`資料沒有變動（${data.dogs.length} 隻狗），不更新 data/dogs.json。`);
  }
  const snapshot = Object.keys(writes).find(p => p.startsWith('history/'));
  if (snapshot) console.log(`已存當天快照 data/${snapshot}。`);
  if (writes['walks.json']) console.log(`data/walks.json 追加 ${added.length} 筆遛狗紀錄。`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => {
    console.error(`同步失敗，保留原本的 data/dogs.json、歷史與遛狗紀錄：${e.message}`);
    process.exit(1);
  });
}
