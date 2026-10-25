// 只有名字的已出所狗卡（#271，ADR 0002）：網站開始記錄前就離所、D1 沒有的狗，由 K 確認後建一張卡，
// 活動紀錄裡同名、還沒對上的出席一起接到這張卡。也可以用 --to 把還沒對上的名字接到 D1 已經有的狗（同名好幾隻時由 K 指定）。
// 只能手動執行，部署、同步都不會跑：
//   node scripts/departed-card.mjs --name 老黃                         ← 預演：只讀 D1，印出會做什麼
//   node scripts/departed-card.mjs --name 老黃 --left 2024-05-01 --reason adopt --write
//   node scripts/departed-card.mjs --name 小黑 --to 2020010101 --write  ← 接到編號 2020010101 那隻
//   --reason 是 adopt（認養）／death（死亡）／other（其他）／unknown（待確認，預設）；--editor 名字（預設 K）
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REASONS = ['adopt', 'death', 'other', 'unknown'];
const sqlValue = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

export function cardOptions(args) {
  const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] || '' : '');
  const o = { name: opt('--name').trim(), to: opt('--to').trim(), left: opt('--left'), reason: opt('--reason') || 'unknown', editor: opt('--editor') || 'K', write: args.includes('--write') };
  if (!o.name || [...o.name].length > 20) throw new Error('--name 要 1–20 個字');
  if (o.left && !(/^\d{4}-\d{2}-\d{2}$/.test(o.left) && new Date(`${o.left}T00:00:00Z`).toISOString().startsWith(o.left))) throw new Error('--left 要是 YYYY-MM-DD');
  if (!REASONS.includes(o.reason)) throw new Error(`--reason 只能是 ${REASONS.join('／')}`);
  if (o.to && (o.left || args.includes('--reason'))) throw new Error('--to 是接到已經有的狗，不用 --left、--reason');
  return o;
}

// query(sql) → 列，只送 SELECT。回 { o, target（--to 的狗）, unmatched（會接上的出席筆數）, warnings }
export async function planCard(query, o) {
  const warnings = [];
  const unmatched = (await query(`SELECT COUNT(*) AS n FROM v3_activity_dogs WHERE dog_id IS NULL AND name=${sqlValue(o.name)}`))[0].n;
  let target = null;
  if (o.to) {
    target = (await query(`SELECT d.dog_id, d.name FROM v3_dog_numbers n JOIN v3_dogs d USING(dog_id) WHERE n.number=${sqlValue(o.to)}`))[0] || null;
    if (!target) throw new Error(`D1 沒有編號 ${o.to} 的狗`);
    if (!unmatched) throw new Error(`活動紀錄沒有還沒對上的「${o.name}」`);
  } else {
    const same = await query(`SELECT d.dog_id, (SELECT MAX(number) FROM v3_dog_numbers n WHERE n.dog_id=d.dog_id) AS number,
      EXISTS(SELECT 1 FROM v3_dog_departures c WHERE c.dog_id=d.dog_id AND c.number='') AS card FROM v3_dogs d WHERE d.name=${sqlValue(o.name)}`);
    if (same.some(r => r.card)) throw new Error(`已經有「${o.name}」的已出所狗卡`);
    if (same.length) warnings.push(`D1 已經有 ${same.length} 隻叫「${o.name}」的狗（編號 ${same.map(r => r.number || '沒有').join('、')}）；如果是同一隻，改用 --to 編號`);
  }
  return { o, target, unmatched, warnings };
}

export function cardSql(plan, { at = new Date().toISOString(), newId = () => crypto.randomUUID().replace(/-/g, '') } = {}) {
  const { o, target } = plan;
  const dogId = target ? target.dog_id : newId();
  const out = [];
  if (!target) {
    out.push(`INSERT INTO v3_dogs(dog_id,name) VALUES(${sqlValue(dogId)},${sqlValue(o.name)})`);
    // 只有名字的已出所狗卡是沒有編號的離所（#560）；seen_date 記建卡那天
    out.push(`INSERT INTO v3_dog_departures(dog_id,number,name,departed_date,seen_date,reason) VALUES(${sqlValue(dogId)},'',${sqlValue(o.name)},${sqlValue(o.left)},${sqlValue(at.slice(0, 10))},${sqlValue(o.reason)})`);
  }
  out.push(`UPDATE v3_activity_dogs SET dog_id=${sqlValue(dogId)} WHERE dog_id IS NULL AND name=${sqlValue(o.name)}`);
  const after = target ? { name: o.name, linkedTo: o.to, attendances: plan.unmatched } : { name: o.name, departed: o.left, reason: o.reason, attendances: plan.unmatched };
  out.push(`INSERT INTO v3_edit_log(at,editor_code,editor_name,kind,dog_id,dog_number,before_json,after_json) VALUES(${sqlValue(at)},'',${sqlValue(o.editor)},'departed-card',${sqlValue(dogId)},${sqlValue(o.to)},'null',${sqlValue(JSON.stringify(after))})`);
  return out;
}

export function planText(plan) {
  const { o, target, unmatched } = plan;
  const head = target ? `把活動紀錄裡還沒對上的「${o.name}」接到編號 ${o.to}（${target.name}）` : `建「${o.name}」的已出所狗卡（離所日 ${o.left || '不知道'}、原因 ${o.reason}）`;
  return [`${head}；會接上 ${unmatched} 筆出席`, ...plan.warnings.map(w => `注意：${w}`)].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const o = cardOptions(process.argv.slice(2));
    const d1 = extra => JSON.parse(execFileSync('npx', ['--yes', 'wrangler@4', 'd1', 'execute', 'bq-shelter-dogs', '--remote', '--json', ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 16 * 1024 * 1024 }));
    const query = async sql => {
      if (!/^SELECT /.test(sql)) throw new Error('預演只能送 SELECT');
      return d1(['--command', sql])[0].results;
    };
    const plan = await planCard(query, o);
    console.log(planText(plan));
    if (!o.write) console.log('\n這是預演，沒有寫入。確認沒問題再加 --write。');
    else {
      const file = `departed-card-${Date.now()}.sql`;
      await writeFile(file, cardSql(plan).map(s => `${s};`).join('\n') + '\n');
      d1(['--file', file]);
      console.log(`\n已寫進正式 D1（SQL 留在 ${file}）`);
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
