// #301 原型：Worker 自己讀試算表、只把「有變的列」寫進 D1（不再刪光重寫）。
// 做法：先讀 D1 現況，讓腳本用的同一套匯入程式（scripts/sync-plan.mjs 的 applySource）跑在記憶體的假 D1 上，
// 跑完跟現況照主鍵比對：多的新增、變的更新、少的刪除，一個 batch 寫回。
// 需要 nodejs_compat（匯入程式用 node:crypto、node:util；試算表 ID、WALKER_KEY 從 process.env 讀）。
import { buildData, fetchGviz, parseGroupColumns, parseGroupLabels, loadDepartedRows } from '../../scripts/sync-sheet.mjs';
import { planSync, readPrevious, applySource } from '../../scripts/sync-plan.mjs';

// 同步會動到的表，父表在前（新增照這個順序，刪除反過來）
export const SYNC_TABLES = {
  v3_dogs: ['dog_id'],
  v3_dog_numbers: ['number'],
  v3_sheet_main: ['row_index'],
  v3_sheet_main_walkers: ['row_index', 'position'],
  v3_sheet_former_numbers: ['row_index', 'position'],
  v3_sheet_groups: ['column_index', 'row_index'],
  v3_sheet_group_labels: ['column_index'],
  v3_sheet_changes: ['row_index'],
  v3_walks: ['dog_id', 'walk_date', 'position'],
  v3_departures: ['number'],
  v3_departure_items: ['number', 'kind', 'position'],
};
// 匯入程式裡沒寫欄位名的 INSERT
const POSITIONAL = {
  v3_sheet_main_walkers: ['row_index', 'position', 'walker_code'],
  v3_sheet_former_numbers: ['row_index', 'position', 'number'],
};
// 匯入程式會下的查詢；其他查詢一律丟錯，避免假 D1 默默回錯的東西
const SELECTS = {
  'SELECT number,dog_id FROM v3_dog_numbers': t => t.v3_dog_numbers.map(r => ({ number: r.number, dog_id: r.dog_id })),
  "SELECT name,dog_id FROM v3_sheet_main WHERE number=''": t => t.v3_sheet_main.filter(r => r.number === '').map(r => ({ name: r.name, dog_id: r.dog_id })),
  "SELECT dog_name AS name,dog_id FROM v3_walks WHERE dog_number=''": t => t.v3_walks.filter(r => r.dog_number === '').map(r => ({ name: r.dog_name, dog_id: r.dog_id })),
  "SELECT number FROM v3_sheet_main WHERE number<>''": t => t.v3_sheet_main.filter(r => r.number !== '').map(r => ({ number: r.number })),
};

const keyOf = (table, row) => JSON.stringify(SYNC_TABLES[table].map(c => row[c]));

// 記憶體假 D1：只懂匯入程式用到的 SELECT、DELETE FROM 表、INSERT（含 ON CONFLICT）。
// 每張表用主鍵當索引（Map），正式資料上千筆溜狗紀錄才不會每新增一列就整張表掃一遍
const parsed = new Map();
function parse(sql) {
  if (parsed.has(sql)) return parsed.get(sql);
  const s = sql.replace(/\s+/g, ' ').trim();
  let out;
  let m = s.match(/^DELETE FROM (\w+)$/);
  if (SELECTS[s]) out = { select: SELECTS[s] };
  else if (m && SYNC_TABLES[m[1]]) out = { clear: m[1] };
  else if ((m = s.match(/^INSERT INTO (\w+) ?(?:\(([^)]*)\))? VALUES ?\(([?A-Z, ]*)\)(?: ON CONFLICT\((\w+)\) DO (NOTHING|UPDATE SET (.*)))?$/)) && SYNC_TABLES[m[1]]) {
    const [, table, cols, slots, , action, sets] = m;
    const names = cols ? cols.split(',').map(c => c.trim()) : POSITIONAL[table];
    // VALUES 裡可能直接寫 NULL（溜狗紀錄的 walker_name）
    const slotList = slots.split(',').map(v => v.trim());
    if (!names || names.length !== slotList.length || slotList.some(v => v !== '?' && v !== 'NULL')) throw new Error(`假 D1 不支援：${s}`);
    out = { table, names, slotList, action, updates: sets ? sets.split(',').map(x => x.split('=')[0].trim()) : [] };
  } else throw new Error(`假 D1 不支援：${s}`);
  parsed.set(sql, out);
  return out;
}

const asMaps = rowsByTable => Object.fromEntries(Object.keys(SYNC_TABLES).map(t => [t, new Map((rowsByTable[t] || []).map(r => [keyOf(t, r), r]))]));

export function memoryD1(snapshot) {
  let tables = asMaps(snapshot);
  const rowsOf = state => new Proxy({}, { get: (_, t) => [...state[t].values()] });
  const exec = (state, sql, values) => {
    const p = parse(sql);
    if (p.select) return p.select(rowsOf(state));
    if (p.clear) { state[p.clear] = new Map(); return []; }
    let next = 0;
    const row = {};
    p.names.forEach((c, i) => { row[c] = p.slotList[i] === '?' ? values[next++] ?? null : null; });
    if (next !== values.length) throw new Error(`假 D1 欄位數不對：${sql}`);
    const map = state[p.table], key = keyOf(p.table, row), had = map.get(key);
    if (!had) map.set(key, row);
    else if (p.action === 'NOTHING') {}
    else if (p.action) map.set(key, { ...had, ...Object.fromEntries(p.updates.map(c => [c, row[c]])) });
    else throw new Error(`主鍵重複：${p.table} ${key}`);
    return [];
  };
  const prepare = (sql, values = []) => ({
    bind: (...args) => prepare(sql, args),
    async all() { return { success: true, results: exec(tables, sql, values) }; },
    async run() { exec(tables, sql, values); return { success: true, results: [], meta: {} }; },
    async first(column) { const r = exec(tables, sql, values)[0]; return r ? (column ? r[column] : r) : null; },
    sql, values,
  });
  return {
    prepare,
    // 跟 D1 一樣：整批成功才算，失敗保留原本的內容（列在更新時換成新物件，所以只要複製 Map）
    async batch(statements) {
      const copy = Object.fromEntries(Object.entries(tables).map(([t, map]) => [t, new Map(map)]));
      const results = statements.map(st => ({ success: true, results: exec(copy, st.sql, st.values) }));
      tables = copy;
      return results;
    },
    get tables() { return Object.fromEntries(Object.entries(tables).map(([t, map]) => [t, [...map.values()]])); },
  };
}

// 比對現況和該有的樣子，回傳要寫回的 [{ sql, values }]：先照父→子新增／更新，再照子→父刪除。
// 主清單每列都存同步時間，網站只讀第 0 列（worker/src/compact.js），其他列的同步時間不同不算變動。
export function diffTables(before, after) {
  const writes = [], deletes = [];
  for (const [table, pk] of Object.entries(SYNC_TABLES)) {
    const old = new Map((before[table] || []).map(r => [keyOf(table, r), r]));
    const seen = new Set();
    for (const row of after[table] || []) {
      const key = keyOf(table, row);
      seen.add(key);
      const prev = old.get(key);
      const cols = Object.keys(row);
      if (!prev) {
        writes.push({ sql: `INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, values: cols.map(c => row[c]) });
        continue;
      }
      const changed = cols.filter(c => !pk.includes(c) && row[c] !== prev[c] && !(table === 'v3_sheet_main' && c === 'synced_at' && row.row_index !== 0));
      if (changed.length) writes.push({ sql: `UPDATE ${table} SET ${changed.map(c => `${c}=?`).join(',')} WHERE ${pk.map(c => `${c}=?`).join(' AND ')}`, values: [...changed.map(c => row[c]), ...pk.map(c => row[c])] });
    }
    for (const [key, row] of old) if (!seen.has(key)) deletes.unshift({ sql: `DELETE FROM ${table} WHERE ${pk.map(c => `${c}=?`).join(' AND ')}`, values: pk.map(c => row[c]) });
  }
  return [...writes, ...deletes];
}

// 讀 D1 現況（同步會動到的表）
export async function readSnapshot(db) {
  const names = Object.keys(SYNC_TABLES);
  const results = await db.batch(names.map(t => db.prepare(`SELECT * FROM ${t}`)));
  return Object.fromEntries(names.map((t, i) => [t, results[i].results || []]));
}

// source：planSync 的結果＋groupColumns、groupLabels。回傳要寫回的語句（還沒寫）
export async function planDiff(db, source) {
  const snapshot = await readSnapshot(db);
  const mem = memoryD1(snapshot);
  await applySource(mem, source);
  return diffTables(snapshot, mem.tables);
}

// 整段同步：讀試算表 → 算 → 只寫差異。回傳量測用的數字
export async function syncSheetToD1(db, { fetchImpl = fetch, now = new Date() } = {}) {
  if (!process.env.WALKER_KEY) throw new Error('沒有設定 WALKER_KEY，無法比對溜狗紀錄');
  let fetches = 0;
  const counted = (...args) => { fetches++; return fetchImpl(...args); };
  const sheet = await buildData(counted, now, async () => '');
  const groupTable = await fetchGviz('常遛狗群', 0, counted);
  const dogNames = new Set(sheet.dogs.map(d => d.name));
  const rows = await loadDepartedRows(counted, now);
  const plan = planSync(await readPrevious(db), sheet, rows, now);
  const diff = await planDiff(db, { ...plan, groupColumns: parseGroupColumns(groupTable, dogNames), groupLabels: parseGroupLabels(groupTable, dogNames) });
  const results = diff.length ? await db.batch(diff.map(s => db.prepare(s.sql).bind(...s.values))) : [];
  const meta = results.map(r => r.meta || {});
  return {
    fetches, statements: diff.length,
    rowsWritten: meta.reduce((n, m) => n + (m.rows_written || 0), 0),
    rowsRead: meta.reduce((n, m) => n + (m.rows_read || 0), 0),
  };
}
