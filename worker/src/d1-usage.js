// 查整個帳號今天（UTC，額度在 UTC 午夜重置＝台灣早上 8:00）的 D1 寫入列數（ADR 0008 寫入預算）。
// #512 從舊同步程式 scripts/sync-diff.mjs 搬來，溜狗寫入預算（walk-accept.js）用。
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
