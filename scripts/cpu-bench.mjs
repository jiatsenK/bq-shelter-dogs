// #460 CPU 驗收：產生測試 D1 的準備／清除 SQL，並讀 Cloudflare 分析的 CPU P99。
// node scripts/cpu-bench.mjs sql seed|reset|cleanup   → 印出 SQL（給 wrangler d1 execute --file）
// node scripts/cpu-bench.mjs p99 <since ISO> <次數> [Worker 名稱] → 等分析資料到齊，印出 JSON { requests, errors, p50, p99 }（微秒）
//   預設量 Cron 那一輪（bq-shelter-dogs-cpu）；回呼另外量 bq-shelter-dogs-cpu-cb
import { BENCH_DOGS, BENCH_VALUE, benchDog } from '../worker/cpu-bench/fake-gas.js';

const q = s => `'${String(s).replace(/'/g, "''")}'`;
const dogs = Array.from({ length: BENCH_DOGS }, (_, i) => ({ ...benchDog(i + 1), dogId: `cpu-dog-${i + 1}`, row: 900001 + i }));
const at = '2026-10-21T00:00:00Z';

export function benchSql(kind) {
  if (kind === 'seed') return [
    ...dogs.flatMap(d => [
      `INSERT INTO v3_dogs(dog_id,name) VALUES(${q(d.dogId)},${q(d.name)});`,
      `INSERT INTO v3_dog_numbers(number,dog_id) VALUES(${q(d.id)},${q(d.dogId)});`,
      `INSERT INTO v3_sheet_main(row_index,dog_id,number,name,walked_date,synced_at) VALUES(${d.row},${q(d.dogId)},${q(d.id)},${q(d.name)},${q(BENCH_VALUE.date)},${q(at)});`,
      `INSERT INTO v3_walk_state(dog_key,dog_id,number,name,version,effective_date,walker,members_json,base_date,base_walker,previous_date,previous_walker,updated_at) VALUES(${q(d.id)},${q(d.dogId)},${q(d.id)},${q(d.name)},1,${q(BENCH_VALUE.date)},${q(BENCH_VALUE.walker)},'[]',${q(BENCH_VALUE.date)},${q(BENCH_VALUE.walker)},'','',${q(at)});`,
      `INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) VALUES(${q(d.id)},1,${q(BENCH_VALUE.date)},${q(BENCH_VALUE.date)},${q(BENCH_VALUE.walker)},'synced',${q(at)});`,
    ]),
  ].join('\n');
  // 一批：200 隻都變成待派送，每輪派十隻，20 輪剛好派完
  if (kind === 'reset') return [
    "DELETE FROM v3_walk_write_budget;",
    "DELETE FROM v3_walk_delivery WHERE dog_key LIKE 'CPU%';",
    "UPDATE v3_walk_outbox SET status='superseded' WHERE dog_key LIKE 'CPU%' AND status NOT IN ('synced','superseded');",
    "UPDATE v3_walk_state SET version=version+1 WHERE dog_key LIKE 'CPU%';",
    `INSERT INTO v3_walk_outbox(dog_key,version,operation_date,target_date,target_walker,status,next_attempt_at) SELECT dog_key,version,${q(BENCH_VALUE.date)},${q(BENCH_VALUE.date)},${q(BENCH_VALUE.walker)},'pending','2000-01-01T00:00:00Z' FROM v3_walk_state WHERE dog_key LIKE 'CPU%';`,
  ].join('\n');
  if (kind === 'cleanup') return [
    ...['v3_walk_conflicts', 'v3_walk_retry', 'v3_walk_delivery', 'v3_walk_baselines', 'v3_walk_requests', 'v3_walk_outbox', 'v3_walk_state'].map(t => `DELETE FROM ${t} WHERE dog_key LIKE 'CPU%';`),
    "DELETE FROM v3_walk_write_budget;",
    "UPDATE v3_walk_pack SET version=version+1,payload=COALESCE((SELECT json_group_object(key,json(value)) FROM json_each(payload) WHERE key NOT LIKE 'CPU%'),'{}') WHERE id=1;",
    `DELETE FROM v3_sheet_main WHERE row_index BETWEEN 900001 AND ${900000 + BENCH_DOGS};`,
    "DELETE FROM v3_dog_numbers WHERE number LIKE 'CPU%';",
    "DELETE FROM v3_dogs WHERE dog_id LIKE 'cpu-dog-%';",
  ].join('\n');
  throw new Error(`不認得 ${kind}`);
}

async function p99(since, expected, script = 'bq-shelter-dogs-cpu', { token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID, wait = 15 * 60000 } = {}) {
  const query = `query($a:String!,$n:String!,$s:Time!,$u:Time!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:10,filter:{scriptName:$n,datetime_geq:$s,datetime_leq:$u}){sum{requests errors} quantiles{cpuTimeP50 cpuTimeP99}}}}}`;
  const end = Date.now() + wait;
  for (;;) {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { a: account, n: script, s: since, u: new Date().toISOString() } }) });
    const out = await res.json();
    if (!res.ok || out.errors?.length) throw new Error(`讀不到分析資料（權杖可能沒有 Account Analytics 讀取權限）：${JSON.stringify(out.errors || res.status)}`);
    const rows = out.data.viewer.accounts[0]?.workersInvocationsAdaptive || [];
    const requests = rows.reduce((n, r) => n + r.sum.requests, 0), errors = rows.reduce((n, r) => n + r.sum.errors, 0);
    // 只有一組維度時直接用；分組時取最大 P99（保守）
    const p = rows.length ? { p50: Math.max(...rows.map(r => r.quantiles.cpuTimeP50)), p99: Math.max(...rows.map(r => r.quantiles.cpuTimeP99)) } : {};
    if (requests >= expected || Date.now() > end) return { requests, errors, ...p };
    await new Promise(r => setTimeout(r, 30000));
  }
}

if (process.argv[1]?.endsWith('cpu-bench.mjs')) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'sql') process.stdout.write(benchSql(a) + '\n');
  else if (cmd === 'p99') console.log(JSON.stringify(await p99(a, Number(b), c)));
}
