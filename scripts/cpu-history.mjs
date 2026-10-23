// #460 唯讀：讀 Cloudflare 分析裡正式 Worker 過去幾天的 CPU 紀錄，判斷新流程 Cron 一輪的固定花費。
// node scripts/cpu-history.mjs [天數=7] → 印出 Markdown 表格。只查詢，不部署、不改設定。
// 需要 CLOUDFLARE_API_TOKEN（Account Analytics 讀取）與 CLOUDFLARE_ACCOUNT_ID。
const days = Number(process.argv[2] || 7), script = 'bq-shelter-dogs';
const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
const until = new Date(), since = new Date(until - days * 86400000);

async function gql(query, variables) {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const out = await res.json();
  if (!res.ok || out.errors?.length) throw new Error(JSON.stringify(out.errors || res.status));
  return out.data.viewer.accounts[0];
}
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : NaN; };
const ms = us => (us / 1000).toFixed(2);
const v = { a: account, n: script, s: since.toISOString(), u: until.toISOString() };
const lines = [`正式 Worker \`${script}\`，${since.toISOString().slice(0, 16)}Z 到 ${until.toISOString().slice(0, 16)}Z（${days} 天）。CPU 單位 ms。`, ''];

// Cron（目前每 10 分鐘一次的試算表同步）：逐次紀錄自己算分位數
try {
  const a = await gql(`query($a:String!,$n:String!,$s:Time!,$u:Time!){viewer{accounts(filter:{accountTag:$a}){
    workersInvocationsScheduled(limit:10000,filter:{scriptName:$n,datetime_geq:$s,datetime_leq:$u}){cron status cpuTimeUs datetime}}}}`, v);
  const rows = a.workersInvocationsScheduled || [];
  const cpu = rows.map(r => r.cpuTimeUs);
  lines.push('**Cron（試算表同步）**', '', '| 次數 | 非成功 | P50 | P90 | P99 | 最大 | 最小 |', '|---|---|---|---|---|---|---|',
    `| ${rows.length} | ${rows.filter(r => r.status !== 'success').length} | ${ms(pct(cpu, .5))} | ${ms(pct(cpu, .9))} | ${ms(pct(cpu, .99))} | ${ms(Math.max(...cpu))} | ${ms(Math.min(...cpu))} |`, '');
} catch (e) { lines.push(`Cron 紀錄讀取失敗：${e.message}`, ''); }

// 一般請求：每天的分位數（最小值附近可看出每次呼叫的固定花費）
try {
  const a = await gql(`query($a:String!,$n:String!,$s:Time!,$u:Time!){viewer{accounts(filter:{accountTag:$a}){
    workersInvocationsAdaptive(limit:100,orderBy:[date_ASC],filter:{scriptName:$n,datetime_geq:$s,datetime_leq:$u}){
      dimensions{date} sum{requests errors} quantiles{cpuTimeP25 cpuTimeP50 cpuTimeP99}}}}}`, v);
  lines.push('**所有呼叫（含網頁 API）每天**', '', '| 日期 | 次數 | 錯誤 | P25 | P50 | P99 |', '|---|---|---|---|---|---|',
    ...(a.workersInvocationsAdaptive || []).map(r => `| ${r.dimensions.date} | ${r.sum.requests} | ${r.sum.errors} | ${ms(r.quantiles.cpuTimeP25)} | ${ms(r.quantiles.cpuTimeP50)} | ${ms(r.quantiles.cpuTimeP99)} |`), '');
} catch (e) { lines.push(`每日紀錄讀取失敗：${e.message}`, ''); }
console.log(lines.join('\n'));
