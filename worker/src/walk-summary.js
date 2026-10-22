// 我溜過的狗、每隻狗溜過幾天的計算規則（ADR 0013，#344）：純函式，不碰 D1。
// worker/src/packs.js 用它算各年摘要（存進 v3_walk_summaries）和今天的紀錄。
// 跟 public/js/cards.js 的 bqMyDogs 同一個規則（worker/test/walks-mine.test.mjs 逐筆比對）：
// 同一隻狗（編號）同一天以最後一筆有登記人的為準。
// 摘要：{ codes: { 代號: { 編號: [幾天, 第一次, 最近一次] } }, multi: { '編號|日期': [代號…] }, dogs: { 編號: 幾天 } }；
// multi 只記同一天有兩個以上代號的，加總時一個人的幾個代號同一天都在只算一天。
// dogs 是每隻狗（編號）溜過幾天，沒記人的舊紀錄也算（#271 已出所狗卡）
export function summarize(list) {
  const last = new Map(), dogDays = new Set();
  for (const w of list) {
    const id = String(w.id ?? '').trim();
    if (id) dogDays.add(`${id}|${w.date}`);
    if (Array.isArray(w.walkers) && id) last.set(`${id}|${w.date}`, w);
  }
  const dogs = {};
  for (const key of dogDays) { const id = key.slice(0, key.lastIndexOf('|')); dogs[id] = (dogs[id] || 0) + 1; }
  const codes = {}, multi = {};
  for (const [key, w] of last) {
    const id = key.slice(0, key.lastIndexOf('|'));
    const who = [...new Set(w.walkers)];
    for (const c of who) {
      const dogs = codes[c] ||= {};
      const m = dogs[id];
      if (!m) dogs[id] = [1, w.date, w.date];
      else { m[0]++; if (w.date < m[1]) m[1] = w.date; if (w.date > m[2]) m[2] = w.date; }
    }
    if (who.length > 1) multi[key] = who;
  }
  return { codes, multi, dogs };
}

// 把一份摘要裡這個人（codes：全部代號，含舊代號）的狗加進 out（{ 編號: { times, first, last } }）
export function addMine(out, summary, codes) {
  const want = new Set(codes);
  for (const c of want) {
    for (const [id, [times, first, last]] of Object.entries(summary.codes[c] || {})) {
      const m = out[id];
      if (!m) out[id] = { times, first, last };
      else { m.times += times; if (first < m.first) m.first = first; if (last > m.last) m.last = last; }
    }
  }
  for (const [key, who] of Object.entries(summary.multi)) {
    const k = who.filter(c => want.has(c)).length;
    if (k > 1) out[key.slice(0, key.lastIndexOf('|'))].times -= k - 1;
  }
}
