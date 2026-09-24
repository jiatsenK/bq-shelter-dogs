// 從 Google 試算表同步狗狗資料，產生 data/dogs.json（#31）。
// 由 .github/workflows/sync-sheet.yml 定期執行；也可以在本機跑：node scripts/sync-sheet.mjs
//
// 解析邏輯照抄前端（index.html／js/app.js）的 fetchGviz、findHeaderRow、parseMainList、parseCages、
// parseGroups、cellDate，結果必須跟前端直接讀試算表一模一樣；改其中一邊時兩邊一起改，
// scripts/sync-sheet.test.mjs 會拿前端的函式來比對。
//
// 讀取失敗（網路、試算表沒公開、欄位被改掉、讀到 0 隻狗）時直接失敗結束，不寫檔，
// 保留上一次成功的 data/dogs.json。資料跟舊檔一樣時也不寫檔（連同步時間都不動），
// workflow 看到沒有變動就不提交。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 日期一律用台灣時間判斷（沒寫年份的日期、同步時間）
if (!process.env.TZ) process.env.TZ = 'Asia/Taipei';

export const SHEET_ID = '1cxoir8K5-D5hncdQiXhogQXi8Pyk47l5cl-_gNADhqw';
export const OUTPUT = fileURLToPath(new URL('../data/dogs.json', import.meta.url));
export const FORMAT_VERSION = 1;

// headers：前幾列當表頭。0 表示所有列都當資料列回傳
export async function fetchGviz(sheetName, headers = 0, fetchImpl = fetch) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=${headers}&sheet=${encodeURIComponent(sheetName)}`;
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
      walker: cellText(get(c, 'walker')),
      note: cellText(get(c, 'note')),
    });
  }
  return dogs;
}

// 籠位清單：主清單「籠位」欄去重，沒有狗的空籠也列出（例：舊A01）
export function parseCages(table, headerTexts = []) {
  const idx = mainColumnMap(table, headerTexts).cage;
  const set = new Set();
  for (const r of table.rows || []) {
    const cage = cellText((r.c || [])[idx]);
    if (cage && cage.replace(/\s+/g, '') !== MAIN_COLUMNS.cage) set.add(cage);
  }
  return sortCages([...set]);
}

// 籠位排序：英數開頭的在前，中文開頭的集中在後；數字照大小排，A2 排在 A10 前面
const CAGE_COLLATOR = new Intl.Collator('zh-Hant-TW', { numeric: true, sensitivity: 'base' });
export function sortCages(list) {
  const group = c => /^[0-9A-Za-z]/.test(c) ? 0 : 1;
  return list.slice().sort((a, b) => group(a) - group(b) || CAGE_COLLATOR.compare(a, b));
}

// 主清單分兩次讀：先找出表頭在第幾列，再指定表頭列數重讀
export async function loadMainList(fetchImpl = fetch, today = new Date()) {
  const raw = await fetchGviz('主清單', 0, fetchImpl);
  const headerIdx = findHeaderRow(raw);
  if (headerIdx === -1) throw new Error('主清單裡找不到含「犬名」的表頭列，請確認分頁名稱與欄位沒有被改掉。');
  const headerTexts = ((raw.rows[headerIdx] || {}).c || []).map(cellText);
  const table = await fetchGviz('主清單', headerIdx + 1, fetchImpl);
  const dogs = parseMainList(table, headerTexts, today);
  dogs.cages = parseCages(table, headerTexts);
  return dogs;
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

// 讀試算表、整理成 dogs.json 的內容（不含同步時間）。任何一個分頁讀取失敗都丟錯。
export async function buildData(fetchImpl = fetch, today = new Date()) {
  const [dogs, groupTable] = await Promise.all([
    loadMainList(fetchImpl, today),
    fetchGviz('常遛狗群', 0, fetchImpl),
  ]);
  if (!dogs.length) throw new Error('主清單讀到 0 隻狗，可能是試算表被清空或格式變了，這次不更新。');
  const groupMap = parseGroups(groupTable, new Set(dogs.map(d => d.name)));
  // 籠位以主清單籠位欄為準（含空籠）；再併入狗身上的籠位，跟前端一樣
  const cages = sortCages([...new Set([...dogs.cages, ...dogs.map(d => d.cage).filter(Boolean)])]);
  const groups = {};
  for (const [name, set] of Object.entries(groupMap)) groups[name] = [...set];
  return {
    dogs: dogs.map(d => ({ ...d, walkedDate: formatDate(d.walkedDate) })),
    cages,
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
    console.log(`資料沒有變動（${data.dogs.length} 隻狗、${data.cages.length} 個籠位），不更新 data/dogs.json。`);
    return;
  }
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, text);
  console.log(`已更新 data/dogs.json：${data.dogs.length} 隻狗、${data.cages.length} 個籠位、${Object.values(data.groups).filter(g => g.length).length} 隻有可以一起溜的狗。`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => {
    console.error(`同步失敗，保留原本的 data/dogs.json：${e.message}`);
    process.exit(1);
  });
}
