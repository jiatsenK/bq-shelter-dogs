// 從 Google 試算表同步狗狗資料，產生 data/dogs.json（#31）。
// 由 .github/workflows/sync-sheet.yml 定期執行；也可以在本機跑：SHEET_ID=試算表ID node scripts/sync-sheet.mjs
//
// 試算表 ID 不寫在 repo 裡（repo 是公開的，試算表目前知道連結就能編輯）：
// workflow 從 GitHub 的 Actions Secret「SHEET_ID」帶進來，設定方式見 docs/SHEET_SYNC_SETUP.md。
// 「誰遛的」只輸出有沒有人固定照顧（covered），不把志工名字寫進公開的 dogs.json。
//
// 試算表的解析只在這裡做（#32 起前端只讀 dogs.json）。前端讀 dogs.json 的 parseDogsData 要讀得懂這裡寫出的格式，
// scripts/sync-sheet.test.mjs 會拿前端的函式來比對。
// 狗卡資訊（dogs/{編號}.md）也在這裡整理成純文字和性別一起寫進 dogs.json，網站不用逐隻抓 .md。
//
// 讀取失敗（網路、試算表沒公開、欄位被改掉、讀到 0 隻狗）時直接失敗結束，不寫檔，
// 保留上一次成功的 data/dogs.json。資料跟舊檔一樣時也不寫檔（連同步時間都不動），
// workflow 看到沒有變動就不提交。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 日期一律用台灣時間判斷（沒寫年份的日期、同步時間）
if (!process.env.TZ) process.env.TZ = 'Asia/Taipei';

export const OUTPUT = fileURLToPath(new URL('../data/dogs.json', import.meta.url));
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

export function parseMainList(table, headerTexts = [], today = new Date()) {
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

// 每隻狗加上 sex（male／female／空白）和 intro（狗卡資訊純文字）。沒有編號的狗不讀，也不改用犬名配對
export async function attachDogCards(dogs, readCard = readDogCardFile) {
  const cards = new Map();
  for (const id of new Set(dogs.map(d => d.id).filter(Boolean))) {
    const raw = await readCard(id);
    cards.set(id, raw ? { sex: parseFrontmatterSex(raw), intro: markdownToText(parseFrontmatterBody(raw)) } : null);
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

async function main() {
  const data = await buildData();
  const oldText = await readFile(OUTPUT, 'utf8').catch(() => '');
  const text = renderFile(data, oldText);
  if (!text) {
    console.log(`資料沒有變動（${data.dogs.length} 隻狗），不更新 data/dogs.json。`);
    return;
  }
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, text);
  console.log(`已更新 data/dogs.json：${data.dogs.length} 隻狗、${data.dogs.filter(d => d.intro).length} 隻有狗卡資訊、${Object.values(data.groups).filter(g => g.length).length} 隻有可以一起溜的狗。`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => {
    console.error(`同步失敗，保留原本的 data/dogs.json：${e.message}`);
    process.exit(1);
  });
}
