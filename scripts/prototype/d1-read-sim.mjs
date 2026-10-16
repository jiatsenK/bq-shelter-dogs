// 丟棄式原型：模擬一天的 API 請求，加總每個請求 D1 回傳的 rows_read。
// 用法：先 wrangler dev --remote --config wrangler.d1read.jsonc --port 8799，再 node scripts/prototype/d1-read-sim.mjs
const B = process.env.BASE || 'http://127.0.0.1:8799';
const DAY = process.env.DAY || '2026-10-17';
const MIX = { dogs: 450, walks: 450, rest: 450, departures: 50 }; // 1,400 次；首頁一次讀 dogs+walks+rest
const WALKS = 30;
const start = Date.parse(`${DAY}T07:00:00+08:00`), span = 14 * 3600e3; // 早上 7 點到晚上 9 點

let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const events = [];
for (const [what, n] of Object.entries(MIX)) for (let i = 0; i < n; i++) events.push({ t: start + Math.floor(rnd() * span), what });
for (let i = 0; i < WALKS; i++) events.push({ t: start + Math.floor(rnd() * span), what: 'walk', row: 1 + (i * 7) % 110, pos: 0 });
events.sort((a, b) => a.t - b.t);

const get = async p => { const r = await fetch(B + p); const j = await r.json(); if (j.error) throw new Error(p + ' ' + j.error); return j; };
const tot = { old: {}, warm: {}, cold: {}, walk: { rows_read: 0, rows_written: 0 } };
const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
// 前一天晚上同步過：資料包切在「今天」之前（昨天以前的歷史），版本號 +1
console.log('build', (await get(`/build?now=${start - 3600e3}&cutoff=${DAY}`)).rows_read);
let i = 0;
for (const e of events) {
  if (e.what === 'walk') { const j = await get(`/walk?now=${e.t}&row=${e.row}&pos=${e.pos}`); tot.walk.rows_read += j.rows_read; tot.walk.rows_written += j.rows_written; continue; }
  add(tot.old, e.what, (await get(`/old/${e.what}`)).rows_read);
  add(tot.warm, e.what, (await get(`/new/${e.what}?now=${e.t}`)).rows_read);
  add(tot.cold, e.what, (await get(`/new/${e.what}?now=${e.t}&cold=1`)).rows_read);
  if (++i % 100 === 0) console.error(i, JSON.stringify(tot));
}
const s = o => Object.values(o).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ tot, sums: { old: s(tot.old), warm: s(tot.warm), cold: s(tot.cold) } }, null, 1));
console.log('compare at end of day', JSON.stringify(await get(`/compare?now=${start + span}`)));
