// 量測：Worker 收到 /sheet-changed 或 Cron 時，解析主清單 gviz 回應＋和 D1 今日紀錄比差異的 CPU 時間（ADR 0017 草稿）。
// 用法：node scripts/bench/sheet-diff-cpu.mjs [列數=300] [欄數=25]。網路等待不算 CPU，這裡只量 JS 處理。
import { gvizTable, walkersHeaderRow, parseWalkers } from '../../worker/src/index.js';
const ROWS = +process.argv[2] || 300, COLS = +process.argv[3] || 25;
const heads = ['籠位', '編號', '犬名', '誰遛的', '遛狗日期'];
const cell = v => (v == null ? null : { v, f: undefined });
function gviz(headerRows, cols) {
  const label = i => (headerRows ? heads[i] || `欄${i}` : '');
  const rows = [];
  if (!headerRows) rows.push({ c: Array.from({ length: cols }, (_, i) => cell(heads[i] || `欄${i}`)) });
  for (let r = 0; r < ROWS; r++) rows.push({ c: Array.from({ length: cols }, (_, i) => cell(
    i === 0 ? `A${r}` : i === 1 ? `11${String(r).padStart(4, '0')}` : i === 2 ? `狗狗${r}` : i === 3 ? (r % 3 ? '小明、小華' : null)
      : i === 4 ? 'Date(2026,9,20)' : i === 5 ? ';2026/10/15很親人，會暴衝（志工甲）;2026/10/16腳傷（乙）' : `內容${r}-${i}`)) });
  const t = { cols: Array.from({ length: cols }, (_, i) => ({ id: String(i), label: label(i), type: 'string' })), rows };
  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ version: '0.6', status: 'ok', table: t })});`;
}
const raw0 = gviz(0, COLS), raw1 = gviz(1, COLS);
const d1Rows = Array.from({ length: ROWS }, (_, r) => ({ dog: `11${String(r).padStart(4, '0')}`, walker: r % 5 ? '小明、小華' : '小明', date: '2026-10-20' }));
function work() {
  const h = walkersHeaderRow(gvizTable(raw0));
  const { walkers, dates } = parseWalkers(gvizTable(raw1), heads);
  const have = new Map(d1Rows.map(x => [x.dog, x]));
  const diff = [];
  for (const [k, w] of Object.entries(walkers)) { const o = have.get(k); if (!o || o.walker !== w || o.date !== dates[k]) diff.push(k); }
  return h + diff.length;
}
const ms = () => performance.now();
let t = ms(); work(); const cold = ms() - t;
const N = 200; t = ms(); for (let i = 0; i < N; i++) work(); const warm = (ms() - t) / N;
console.log(JSON.stringify({ rows: ROWS, cols: COLS, payloadKB: Math.round((raw0.length + raw1.length) / 1024), coldMs: +cold.toFixed(2), warmMs: +warm.toFixed(2) }));
