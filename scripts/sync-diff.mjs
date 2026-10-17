// 差異同步（#302）：照主鍵比對 D1 現況和同步後該有的樣子，只寫有變的列。比對方式來自 #301 原型。
// 寫入預算（ADR 0008）：寫之前先算這次要寫幾列，異常就整次不寫。

// 同步會動到的表與主鍵，父表在前（新增照這個順序，刪除反過來）
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

const keyOf = (table, row) => JSON.stringify(SYNC_TABLES[table].map(c => row[c]));

// before、after：{ 表名: 列 }。回傳要寫的 [{ sql, values }]：先照父→子新增／更新，再照子→父刪除。
// 同步時間改存 v3_sync_state（ADR 0014，#361），主清單的 synced_at 欄不再用，不同也不算變動（改了會讓 small 失效）。
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
      const changed = cols.filter(c => !pk.includes(c) && row[c] !== prev[c] && !(table === 'v3_sheet_main' && c === 'synced_at'));
      if (changed.length) writes.push({ sql: `UPDATE ${table} SET ${changed.map(c => `${c}=?`).join(',')} WHERE ${pk.map(c => `${c}=?`).join(' AND ')}`, values: [...changed.map(c => row[c]), ...pk.map(c => row[c])] });
    }
    for (const [key, row] of old) if (!seen.has(key)) deletes.unshift({ sql: `DELETE FROM ${table} WHERE ${pk.map(c => `${c}=?`).join(' AND ')}`, values: pk.map(c => row[c]) });
  }
  return [...writes, ...deletes];
}

// 預設門檻（ADR 0008）。平常一次只寫幾列到幾十列；量到正常的量後可以用 Actions 變數調整
export const MAX_ROWS_PER_SYNC = 500;
// 免費方案每天 10 萬列，整個 Cloudflare 帳號一起算；預算抓 20%
export const DAILY_BUDGET = 20000;

// planned：這次要寫幾句（一句改一列）；todayWritten：帳號今天已經寫了幾列，null 表示查不到。
// 回傳停寫的原因，沒問題回 null
export function budgetProblem(planned, todayWritten, { maxRows = MAX_ROWS_PER_SYNC, dailyBudget = DAILY_BUDGET } = {}) {
  if (planned > maxRows) return `這次要寫 ${planned} 列，超過單次門檻 ${maxRows} 列`;
  if (todayWritten !== null && todayWritten + planned > dailyBudget) return `今天已寫 ${todayWritten} 列，加上這次 ${planned} 列，超過每天的寫入預算 ${dailyBudget} 列`;
  return null;
}

// 查整個帳號今天（UTC，額度在 UTC 午夜重置＝台灣早上 8:00）的 D1 寫入列數。
// API token 要有 Account Analytics 讀取權限；查不到回 null，由呼叫的人決定怎麼處理
export async function todayRowsWritten({ token, accountId, now = new Date(), fetchImpl = fetch }) {
  const date = now.toISOString().slice(0, 10);
  const query = `query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){d1AnalyticsAdaptiveGroups(limit:10000,filter:{date:$d}){sum{rowsWritten}}}}}`;
  try {
    const res = await fetchImpl('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { a: accountId, d: date } }),
    });
    const body = await res.json();
    const groups = body?.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups;
    if (!res.ok || body.errors?.length || !Array.isArray(groups)) return null;
    return groups.reduce((n, g) => n + (g.sum?.rowsWritten || 0), 0);
  } catch { return null; }
}
