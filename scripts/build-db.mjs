import { pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
// 把 repo 裡現有的資料轉成資料庫的內容（第 2 步，K 2026-10-10）：
// data/dogs.json、departures.json、rest.json、walks.json、history/*.json → db/schema.sql 的四張表。
// 每天一整份的快照（data/history）轉成異動紀錄：只記前後兩天有變的欄位。
// 執行：node scripts/build-db.mjs <封存data目錄> > seed.sql（印出 INSERT，交給 wrangler d1 execute 匯入）；不連網路、不改任何檔。
// 這個檔只有純函式和一個印出結果的 main；測試在 scripts/build-db.test.mjs。
import { readFile, readdir } from 'node:fs/promises';

const text = v => (v == null ? '' : String(v).trim());

// 跟網站的 walkKey 一樣：有編號用編號，沒有就「名:犬名」
export function dogKey(d) {
  const id = text(d && d.id);
  return id || `名:${text(d && d.name)}`;
}

// 異動紀錄要比的欄位（上次溜、誰溜的不算：那是溜狗紀錄）
export const TRACKED = ['name', 'cage', 'note', 'sex', 'intro', 'covered'];
const fieldValue = (d, f) => (f === 'covered' ? (d.covered ? '1' : '0') : text(d[f]));

// 現況：dogs.json 的每一列，加上休養設定；已離所的狗用離所紀錄裡最後看到的樣子
export function dogRows(dogsData, departures = [], rest = {}, now = new Date().toISOString()) {
  const rows = [];
  const seen = new Set();
  (dogsData.dogs || []).forEach((d, i) => {
    const key = dogKey(d);
    if (!text(d.name) || seen.has(key)) return;
    seen.add(key);
    const r = rest[text(d.id)];
    rows.push({
      key, id: text(d.id), name: text(d.name), sex: text(d.sex), cage: text(d.cage), note: text(d.note), intro: text(d.intro),
      covered: d.covered ? 1 : 0, walked_date: d.walkedDate || null,
      walkers: JSON.stringify(Array.isArray(d.walkers) ? d.walkers : []),
      status: 'in', departed_date: null, departed_reason: null, departed_source: null,
      rest_until: r ? r.until : null, rest_reason: r ? text(r.reason) : null,
      sort: i, updated_at: now,
    });
  });
  // 離所紀錄新的蓋舊的；同一隻又回來（已經在上面）就不放
  for (const dep of departures) {
    const last = dep.last || dep;
    const key = dogKey(last);
    if (seen.has(key) || !text(last.name)) continue;
    seen.add(key);
    rows.push({
      key, id: text(last.id), name: text(last.name), sex: text(last.sex), cage: text(last.cage), note: text(last.note), intro: text(last.intro),
      covered: 0, walked_date: last.walkedDate || null, walkers: '[]',
      status: 'departed', departed_date: dep.date || null, departed_reason: dep.reason || 'unknown', departed_source: dep.dateSource || null,
      rest_until: null, rest_reason: null, sort: 100000 + rows.length, updated_at: now,
    });
  }
  return rows;
}

// 溜狗紀錄：同一隻同一天留最後一筆（跟網站「我溜過」同一個規則）
export function walkRows(walksData) {
  const map = new Map();
  for (const w of (walksData && walksData.walks) || []) {
    if (!w || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) continue;
    const key = dogKey(w);
    if (key === '名:') continue;
    const old = map.get(`${key}|${w.date}`);
    map.set(`${key}|${w.date}`, {
      dog_key: key, date: w.date, name: text(w.name),
      // 後面那筆沒寫誰溜的（舊紀錄）就留前面那筆的代號
      walkers: JSON.stringify(Array.isArray(w.walkers) ? w.walkers : old ? JSON.parse(old.walkers) : []),
    });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.dog_key.localeCompare(b.dog_key));
}

// 每日快照 → 異動紀錄。snapshots：[{ date, syncedAt, dogs }]，順序不拘。第一天是起點、不記；
// 之後每一天跟前一天比：多出來的狗記「入所」、不見的記「離所」、欄位不一樣的各記一筆。
export function changesFromSnapshots(snapshots) {
  const days = [...snapshots].filter(s => s && Array.isArray(s.dogs)).sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  let prev = null;
  for (const day of days) {
    const cur = new Map();
    for (const d of day.dogs) if (text(d.name) && !cur.has(dogKey(d))) cur.set(dogKey(d), d);
    if (prev) {
      const at = day.syncedAt || `${day.date}T00:00:00+08:00`;
      const row = (key, name, field, old, val) => out.push({ at, dog_key: key, name, field, old, new: val, by: '', source: 'import' });
      for (const [key, d] of cur) {
        const before = prev.get(key);
        if (!before) { row(key, text(d.name), 'status', null, 'in'); continue; }
        for (const f of TRACKED) {
          const a = fieldValue(before, f), b = fieldValue(d, f);
          if (a !== b) row(key, text(d.name), f, a, b);
        }
      }
      for (const [key, d] of prev) if (!cur.has(key)) row(key, text(d.name), 'status', 'in', 'departed');
    }
    prev = cur;
  }
  return out;
}

export function kvRows(dogsData, now = new Date().toISOString()) {
  const rows = [];
  const put = (key, value) => rows.push({ key, value: JSON.stringify(value), updated_at: now });
  put('groups', dogsData.groups || {});
  put('sheetNotes', dogsData.sheetNotes || []);
  if (dogsData.syncedAt) put('syncedAt', dogsData.syncedAt);
  return rows;
}

// ── 印成 SQL ──
export function sqlValue(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
// 一次最多 50 列：D1 單一句子有長度上限。dogs、kv 用 REPLACE（重跑不會重複）；walks 也是；changes 先清掉匯入的再放
export function insertSql(table, rows, { replace = true, chunk = 50 } = {}) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const out = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const values = rows.slice(i, i + chunk).map(r => `(${cols.map(c => sqlValue(r[c])).join(', ')})`).join(',\n  ');
    out.push(`INSERT ${replace ? 'OR REPLACE ' : ''}INTO ${table} (${cols.join(', ')}) VALUES\n  ${values};`);
  }
  return out.join('\n');
}
export function seedSql({ dogs, walks, changes, kv }) {
  return [
    '-- 由 scripts/build-db.mjs 產生：把 repo 裡的資料放進資料庫。可以重跑（dogs、walks、kv 會蓋掉同一筆；舊快照轉的異動紀錄先清掉再放）',
    insertSql('dogs', dogs),
    insertSql('walks', walks),
    "DELETE FROM changes WHERE source = 'import';",
    insertSql('changes', changes, { replace: false }),
    insertSql('kv', kv),
  ].filter(Boolean).join('\n\n') + '\n';
}

// ── 讀 repo 的檔案 ──
export async function loadRepoData(dir) {
  if (!dir) throw new Error('請提供封存 data 目錄');
  const json = async (name, fallback) => {
    try { return JSON.parse(await readFile(new URL(name, dir), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  };
  const dogsData = await json('dogs.json', { dogs: [] });
  const departures = (await json('departures.json', { departures: [] })).departures || [];
  const rest = await json('rest.json', {});
  const walksData = await json('walks.json', { walks: [] });
  const files = (await readdir(new URL('history/', dir)).catch(() => [])).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const snapshots = [];
  for (const f of files) {
    const s = await json(`history/${f}`, null);
    if (s) snapshots.push({ date: f.slice(0, 10), syncedAt: s.syncedAt, dogs: s.dogs });
  }
  return { dogsData, departures, rest, walksData, snapshots };
}
export function buildAll({ dogsData, departures, rest, walksData, snapshots }, now = new Date().toISOString()) {
  return { dogs: dogRows(dogsData, departures, rest, now), walks: walkRows(walksData), changes: changesFromSnapshots(snapshots), kv: kvRows(dogsData, now) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const all = buildAll(await loadRepoData(process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + sep) : undefined));
  process.stdout.write(seedSql(all));
  console.error(`狗 ${all.dogs.length}（在所 ${all.dogs.filter(d => d.status === 'in').length}）、溜狗紀錄 ${all.walks.length}、異動紀錄 ${all.changes.length}、其他 ${all.kv.length}`);
}
