// 一次性匯入舊的活動名單（#270，ADR 0002）：K 提供表格（日期、活動類型、狗名），一列一隻狗。
// 名字跟 D1 的狗完全相同、而且只有一隻就接上永久 ID；同名好幾隻、找不到的先只存名字，列成清單給 K 處理。
// 同一天同類型合成一場；D1 已經有那場（例如重跑）就整場跳過，不重複匯入。每場記一筆編輯紀錄。
// 只能手動執行，部署、同步都不會跑（scripts/import-activities.test.mjs 檢查 workflow 沒有用到它）：
//   node scripts/import-activities.mjs 舊名單.csv            ← 預演：只讀 D1，印出會匯入什麼、哪些對不上
//   node scripts/import-activities.mjs 舊名單.csv --write    ← 真的寫進正式 D1
//   加 --editor 名字 指定編輯紀錄上的名字（預設「舊名單匯入」）
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const KINDS = { 動保小小兵: 'kids', 小小兵: 'kids', kids: 'kids', 認養會: 'adoption', adoption: 'adoption' };
export const KIND_LABELS = { kids: '動保小小兵', adoption: '認養會' };
const DEFAULT_EDITOR = '舊名單匯入';

// 一格一格切開（支援雙引號包住、裡面有逗號的格子）
function csvCells(line) {
  const cells = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === '\t') { cells.push(cur); cur = ''; } else cur += c;
  }
  cells.push(cur);
  return cells.map(s => s.trim());
}

// 2026-10-11、2026/10/11、2026.10.11 → 2026-10-11；看不懂回 ''
function cleanDate(text) {
  const m = String(text).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return '';
  const s = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : '';
}

// 表格文字 → { rows: [{ line, date, kind, name }], errors: [{ line, text, reason }] }；第一列是標題（日期、活動類型、狗名）就略過
export function parseActivityCsv(text) {
  const rows = [], errors = [];
  String(text).replace(/^﻿/, '').split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const [dateText = '', kindText = '', nameText = ''] = csvCells(raw);
    if (i === 0 && /日期/.test(dateText)) return;
    const date = cleanDate(dateText), kind = KINDS[kindText], name = nameText.replace(/\s+/g, ' ');
    const reason = !date ? '日期看不懂' : !kind ? '活動類型只能是動保小小兵或認養會' : !name ? '沒有狗名' : [...name].length > 20 ? '狗名超過 20 字' : '';
    if (reason) errors.push({ line, text: raw, reason });
    else rows.push({ line, date, kind, name });
  });
  return { rows, errors };
}

const sqlValue = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const inList = list => list.map(sqlValue).join(',') || "''";

// query(sql) → 列。只送 SELECT。回傳 { activities: [{ date, kind, dogs: [{ dogId, name }] }], unmatched, skipped }
export async function planImport(query, rows) {
  const names = [...new Set(rows.map(r => r.name))];
  const found = new Map();
  for (const r of await query(`SELECT name, dog_id FROM v3_dogs WHERE name IN (${inList(names)}) ORDER BY dog_id`)) {
    if (!found.has(r.name)) found.set(r.name, []);
    found.get(r.name).push(r.dog_id);
  }
  const dates = [...new Set(rows.map(r => r.date))];
  const existing = new Set((await query(`SELECT activity_date, kind FROM v3_activities WHERE activity_date IN (${inList(dates)})`)).map(r => `${r.activity_date}|${r.kind}`));
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.date}|${r.kind}`;
    if (!groups.has(key)) groups.set(key, { date: r.date, kind: r.kind, rows: [] });
    groups.get(key).rows.push(r);
  }
  const activities = [], unmatched = [], skipped = [];
  for (const [key, g] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (existing.has(key)) { skipped.push({ date: g.date, kind: g.kind, dogs: g.rows.length, reason: 'D1 已經有這場' }); continue; }
    const dogs = [], seen = new Set();
    for (const r of g.rows) {
      const ids = found.get(r.name) || [];
      const dog = { dogId: ids.length === 1 ? ids[0] : null, name: r.name };
      const k = dog.dogId || `名:${dog.name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      dogs.push(dog);
      if (!dog.dogId) unmatched.push({ line: r.line, date: g.date, kind: g.kind, name: r.name, reason: ids.length ? `同名 ${ids.length} 隻` : 'D1 找不到這個名字' });
    }
    activities.push({ date: g.date, kind: g.kind, dogs });
  }
  return { activities, unmatched, skipped };
}

// 要寫的 SQL（一句一列）；activity_id 照 Worker 一樣是 32 碼十六進位
export function importSql(plan, { editor = DEFAULT_EDITOR, at = new Date().toISOString(), newId = () => crypto.randomUUID().replace(/-/g, '') } = {}) {
  const out = [];
  for (const a of plan.activities) {
    const id = newId();
    out.push(`INSERT INTO v3_activities(activity_id,activity_date,kind) VALUES(${sqlValue(id)},${sqlValue(a.date)},${sqlValue(a.kind)})`);
    a.dogs.forEach((d, i) => out.push(`INSERT INTO v3_activity_dogs(activity_id,position,dog_id,name) VALUES(${sqlValue(id)},${i},${sqlValue(d.dogId)},${sqlValue(d.name)})`));
    const after = JSON.stringify({ date: a.date, kind: a.kind, dogs: a.dogs.map(d => d.name), dogIds: a.dogs.map(d => d.dogId) });
    out.push(`INSERT INTO v3_edit_log(at,editor_code,editor_name,kind,dog_id,dog_number,before_json,after_json) VALUES(${sqlValue(at)},'',${sqlValue(editor)},'activity',NULL,'','null',${sqlValue(after)})`);
  }
  return out;
}

export function reportText(plan, errors = []) {
  const lines = [`會匯入 ${plan.activities.length} 場、${plan.activities.reduce((n, a) => n + a.dogs.length, 0)} 隻次出席；${plan.unmatched.length} 筆只存名字、${plan.skipped.length} 場已經有了跳過、${errors.length} 列看不懂`];
  for (const a of plan.activities) lines.push(`  ${a.date} ${KIND_LABELS[a.kind]}：${a.dogs.map(d => d.dogId ? d.name : `${d.name}（只有名字）`).join('、')}`);
  if (plan.unmatched.length) lines.push('', '對不上的（先只存名字，之後補建狗卡或指定再接上）：', ...plan.unmatched.map(u => `  第 ${u.line} 列 ${u.date} ${KIND_LABELS[u.kind]} ${u.name}：${u.reason}`));
  if (plan.skipped.length) lines.push('', '跳過的場次：', ...plan.skipped.map(s => `  ${s.date} ${KIND_LABELS[s.kind]}（${s.dogs} 列）：${s.reason}`));
  if (errors.length) lines.push('', '看不懂的列（沒有匯入）：', ...errors.map(e => `  第 ${e.line} 列「${e.text}」：${e.reason}`));
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--editor');
  if (!file) {
    console.error('用法：node scripts/import-activities.mjs 舊名單.csv [--write] [--editor 名字]');
    process.exit(1);
  }
  const write = args.includes('--write');
  const editor = args.includes('--editor') ? args[args.indexOf('--editor') + 1] : DEFAULT_EDITOR;
  const d1 = extra => JSON.parse(execFileSync('npx', ['--yes', 'wrangler@4', 'd1', 'execute', 'bq-shelter-dogs', '--remote', '--json', ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 16 * 1024 * 1024 }));
  const query = async sql => {
    if (!/^SELECT /.test(sql)) throw new Error('預演只能送 SELECT');
    return d1(['--command', sql])[0].results;
  };
  const { rows, errors } = parseActivityCsv(await readFile(file, 'utf8'));
  const plan = await planImport(query, rows);
  console.log(reportText(plan, errors));
  if (!write) console.log('\n這是預演，沒有寫入。確認沒問題再加 --write。');
  else if (plan.activities.length) {
    const sqlFile = `${file}.import.sql`;
    await writeFile(sqlFile, importSql(plan, { editor }).map(s => `${s};`).join('\n') + '\n');
    d1(['--file', sqlFile]);
    console.log(`\n已寫進正式 D1（SQL 留在 ${sqlFile}）`);
  }
}
