// #270 舊活動名單一次性匯入（ADR 0002）。不會在部署或同步時執行，K 手動跑：
//   node scripts/import-activities.mjs 名單.csv            → 讀正式 D1 的狗名（只讀），寫出 activities-import.sql 與對不上清單
//   npx wrangler d1 execute bq-shelter-dogs --remote --file activities-import.sql   → K 確認清單後自己執行
// CSV 三欄：日期（2026-03-08 或 2026/3/8）、活動類型（動保小小兵／認養會）、狗名；第一列是標題可留可不留。
// 狗名跟 D1 的狗完全相同且只有一隻才自動接上；同名多隻、找不到的先只存名字，列在清單給 K 處理。
// D1 已經有同一天同類型的場次就跳過（重跑不會重複）。
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ACTIVITY_KINDS } from '../worker/src/activities.js';

const KIND_BY_LABEL = Object.fromEntries(Object.entries(ACTIVITY_KINDS).map(([k, v]) => [v, k]));
const sql = v => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

export function parseCsv(text) {
  const rows = [];
  for (const [i, line] of String(text).replace(/^﻿/, '').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    // 欄位可以用雙引號包（裡面可以有逗號，"" 是一個引號）
    const cells = [...line.matchAll(/\s*(?:"((?:[^"]|"")*)"|([^,]*))\s*(?:,|$)/g)].map(m => (m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2]).trim());
    const [date = '', kind = '', name = ''] = cells;
    if (i === 0 && !/\d/.test(date)) continue; // 標題列
    rows.push({ line: i + 1, date, kind, name });
  }
  return rows;
}

function normDate(s) {
  const m = String(s).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}

// rows：parseCsv 的結果；dogs：[{ dog_id, name }]；existing：[{ activity_date, kind }]
// 回傳 { activities: [{ date, kind, dogs: [{ dogId, name }] }], unmatched: [{ date, kind, name, reason }], skipped, errors }
export function planActivityImport(rows, dogs, existing = []) {
  const byName = new Map();
  for (const d of dogs) byName.set(d.name, [...(byName.get(d.name) || []), d.dog_id]);
  const have = new Set(existing.map(e => `${e.activity_date}|${e.kind}`));
  const groups = new Map(), unmatched = [], errors = [], skipped = new Set();
  for (const r of rows) {
    const date = normDate(r.date), kind = KIND_BY_LABEL[r.kind] || (ACTIVITY_KINDS[r.kind] ? r.kind : '');
    if (!date || !kind || !r.name) { errors.push(`第 ${r.line} 列看不懂：${[r.date, r.kind, r.name].join(',')}`); continue; }
    const key = `${date}|${kind}`;
    if (have.has(key)) { skipped.add(key); continue; }
    const act = groups.get(key) || { date, kind, dogs: [] };
    groups.set(key, act);
    if (act.dogs.some(d => d.name === r.name)) continue;
    const ids = byName.get(r.name) || [];
    act.dogs.push({ dogId: ids.length === 1 ? ids[0] : null, name: r.name });
    if (ids.length !== 1) unmatched.push({ date, kind, name: r.name, reason: ids.length ? `同名 ${ids.length} 隻` : '找不到' });
  }
  return { activities: [...groups.values()], unmatched, skipped: [...skipped], errors };
}

// 一場一個 id（匯入時先算好，出席列才能指到它）
export function importSql(activities, newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)) {
  const out = [];
  for (const a of activities) {
    const id = newId();
    out.push(`INSERT INTO v3_activities(id,activity_date,kind) VALUES(${sql(id)},${sql(a.date)},${sql(a.kind)});`);
    a.dogs.forEach((d, i) => out.push(`INSERT INTO v3_activity_dogs(activity_id,position,dog_id,name) VALUES(${sql(id)},${i},${sql(d.dogId)},${sql(d.name)});`));
  }
  return out.join('\n') + '\n';
}

export function reportText(plan) {
  const label = k => ACTIVITY_KINDS[k];
  const lines = [`會新增 ${plan.activities.length} 場、${plan.activities.reduce((n, a) => n + a.dogs.length, 0)} 筆出席；對不上 ${plan.unmatched.length} 筆（先只存名字）`];
  for (const s of plan.skipped) lines.push(`跳過（D1 已有）：${s.split('|')[0]} ${label(s.split('|')[1])}`);
  for (const u of plan.unmatched) lines.push(`對不上：${u.date} ${label(u.kind)} ${u.name}（${u.reason}）`);
  for (const e of plan.errors) lines.push(`錯誤：${e}`);
  return lines.join('\n');
}

const query = command => {
  const out = execFileSync('npx', ['--yes', 'wrangler@4', 'd1', 'execute', 'bq-shelter-dogs', '--remote', '--json', '--command', command], { encoding: 'utf8', shell: process.platform === 'win32' });
  return JSON.parse(out.slice(out.search(/^\[/m)))[0].results;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('用法：node scripts/import-activities.mjs 名單.csv'); process.exit(1); }
  const plan = planActivityImport(parseCsv(await readFile(file, 'utf8')), query('SELECT dog_id,name FROM v3_dogs'), query('SELECT activity_date,kind FROM v3_activities'));
  console.log(reportText(plan));
  if (plan.errors.length) { console.error('有看不懂的列，先修正名單再跑'); process.exit(1); }
  await writeFile('activities-import.sql', importSql(plan.activities));
  console.log('已寫出 activities-import.sql；確認上面的清單後，自己用 wrangler d1 execute --file 執行');
}
