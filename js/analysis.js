// 分析分頁（V5-4，#59）：只用目前 dogs.json 就能算的犬隻統計。
// 統計都寫成純函式（輸入狗清單與今天日期，輸出數字），tests/index.html 直接測；畫面只負責把結果畫成 CSS／SVG 長條圖。
// 會用到 js/app.js 的 makeDate、computeStatus、esc、icon、photoSrc、showDetail、allDogs，所以要在 app.js 之後載入。

// 長期在所＝在所滿 1 年；近期少遛＝超過 7 天沒遛（沿用溜狗表的黃色門檻 AMBER_DAYS）
const LONG_STAY_MONTHS = 12;
// 入所多久分布的區間（以滿幾個月算）
const STAY_BUCKETS = [
  { label: '未滿 3 個月', max: 3 },
  { label: '3–6 個月', max: 6 },
  { label: '6 個月–1 年', max: 12 },
  { label: '1–2 年', max: 24 },
  { label: '2–3 年', max: 36 },
  { label: '3–5 年', max: 60 },
  { label: '5 年以上', max: Infinity },
];

// 入所日期＝編號前 8 碼（例：2024032902 → 2024/03/29）。編號不是 10 碼數字、日期不合理或在未來的回 null
function intakeDate(dog, today) {
  const m = String(dog.id || '').match(/^(\d{4})(\d{2})(\d{2})\d{2}$/);
  if (!m) return null;
  const date = makeDate(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  return date && date <= today ? date : null;
}

// 從入所日到今天滿幾個月（照日曆算：3/29 入所，到 4/28 還是 0 個月，4/29 才滿 1 個月）
function monthsBetween(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) - (to.getDate() < from.getDate() ? 1 : 0);
}

function daysBetween(from, to) {
  return Math.floor((to - from) / 86400000);
}

// 每隻狗整理成分析用的一筆：入所日、在所天數與月數、區、幾天沒遛（沒日期或日期異常是 null）
function analysisRows(dogs, today) {
  return dogs.map(dog => {
    const intake = intakeDate(dog, today);
    const st = computeStatus(dog, today);
    return {
      dog,
      intake,
      stayDays: intake ? daysBetween(intake, today) : null,
      stayMonths: intake ? monthsBetween(intake, today) : null,
      zone: zoneOf(dog.cage),
      walkDays: st.kind === 'dated' && st.days >= 0 ? st.days : null,
    };
  });
}

// 區＝籠位去掉數字（新A01 → 新A、C區12 → C區、住院區 → 住院區）
function zoneOf(cage) {
  return String(cage || '').replace(/\d+/g, '').trim() || '未填籠位';
}

// 在所時間顯示：滿 1 年用「X.X 年」，不到 1 年用「N 個月」，不到 1 個月用「N 天」
function formatStay(days) {
  if (days >= 365) return `${(days / 365.25).toFixed(1)} 年`;
  if (days >= 30) return `${Math.floor(days / 30.44)} 個月`;
  return `${days} 天`;
}

function average(list) {
  return list.length ? list.reduce((s, n) => s + n, 0) / list.length : null;
}

function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const dated = rows => rows.filter(r => r.intake);

// 1. 入所多久分布
function stayDistribution(rows) {
  const counts = STAY_BUCKETS.map(b => ({ label: b.label, count: 0 }));
  for (const r of dated(rows)) counts[STAY_BUCKETS.findIndex(b => r.stayMonths < b.max)].count++;
  return counts;
}

// 2. 在所最久 Top N（同一天入所的照犬名排，結果固定）
function longestStay(rows, n = 10) {
  return dated(rows)
    .sort((a, b) => a.intake - b.intake || a.dog.name.localeCompare(b.dog.name, 'zh-Hant'))
    .slice(0, n);
}

// 3. 入所年度分布：從最早一年到最晚一年，中間沒有狗的年份也列出（0 隻）
function intakeYears(rows) {
  const years = dated(rows).map(r => r.intake.getFullYear());
  if (!years.length) return [];
  const out = [];
  for (let y = Math.min(...years); y <= Math.max(...years); y++) out.push({ label: String(y), count: years.filter(v => v === y).length });
  return out;
}

// 4. 各區平均在所時間（由久到短）；count 是有入所日期的隻數
function zoneAverages(rows) {
  const map = new Map();
  for (const r of dated(rows)) {
    if (!map.has(r.zone)) map.set(r.zone, []);
    map.get(r.zone).push(r.stayDays);
  }
  return [...map].map(([zone, list]) => ({ zone, count: list.length, avgDays: average(list) }))
    .sort((a, b) => b.avgDays - a.avgDays || a.zone.localeCompare(b.zone, 'zh-Hant'));
}

// 5. 長期在所犬比例（分母是有入所日期的狗）
function longStayShare(rows) {
  const d = dated(rows);
  const long = d.filter(r => r.stayMonths >= LONG_STAY_MONTHS).length;
  return { long, total: d.length, pct: d.length ? long / d.length * 100 : 0 };
}

// 6. 入所時間 × 最近未遛天數：每隻狗一個點；另外比較滿 1 年與未滿 1 年的平均未遛天數
function stayVsWalk(rows) {
  const points = dated(rows).filter(r => r.walkDays != null);
  const avgOf = list => average(list.map(r => r.walkDays));
  const long = points.filter(r => r.stayMonths >= LONG_STAY_MONTHS);
  const short = points.filter(r => r.stayMonths < LONG_STAY_MONTHS);
  return {
    points,
    skipped: dated(rows).length - points.length, // 有入所日期但沒遛狗日期
    long: { count: long.length, avgWalkDays: avgOf(long) },
    short: { count: short.length, avgWalkDays: avgOf(short) },
  };
}

// 7. 長期在所＋近期少遛：在所滿 1 年，而且超過 7 天沒遛（或沒有遛狗紀錄、也沒人固定照顧），最久沒遛的排前面
function longStayNeglected(rows) {
  return dated(rows)
    .filter(r => r.stayMonths >= LONG_STAY_MONTHS &&
      (r.walkDays != null ? r.walkDays > AMBER_DAYS : !r.dog.walkedDate && !r.dog.covered))
    .sort((a, b) => (b.walkDays ?? Infinity) - (a.walkDays ?? Infinity) || a.intake - b.intake);
}

// 8. 公母在所時間差異：只算有性別資料、也有入所日期的狗；missing 是沒有性別資料的隻數
function sexComparison(rows) {
  const stats = sex => {
    const group = dated(rows).filter(r => r.dog.sex === sex);
    const list = group.map(r => r.stayDays);
    return { count: list.length, avgDays: average(list), medianDays: median(list),
      long: group.filter(r => r.stayMonths >= LONG_STAY_MONTHS).length };
  };
  return { male: stats('♂'), female: stats('♀'), missing: rows.filter(r => !r.dog.sex).length };
}

// 9. 資料完整度：每一項缺的狗；hasPhoto 是「這個編號有沒有照片」（網站用 HEAD 查 photos/，還沒查完是 null）
function dataCompleteness(rows, hasPhoto) {
  const pick = fn => rows.filter(fn).map(r => r.dog);
  const items = [
    { label: '沒有編號', dogs: pick(r => !r.dog.id) },
    { label: '編號看不出入所日期', dogs: pick(r => r.dog.id && !r.intake) },
    { label: '沒有遛狗日期', dogs: pick(r => !r.dog.walkedDate) },
    { label: '沒有性別', dogs: pick(r => !r.dog.sex) },
    { label: '沒有狗卡資訊', dogs: pick(r => !r.dog.intro) },
  ];
  if (hasPhoto) items.push({ label: '沒有照片', dogs: pick(r => !r.dog.id || hasPhoto.get(r.dog.id) === false) });
  return { total: rows.length, items };
}

// ── 照片檢查：用 HEAD 只問 photos/{編號}.jpg 在不在，不下載圖片；一次開網頁只查一遍 ──
let photoCheck = null; // null：還沒開始；{ done, map: Map(編號 → true/false) }
function checkPhotos(dogs) {
  if (photoCheck) return;
  photoCheck = { done: false, map: new Map() };
  const state = photoCheck;
  const ids = [...new Set(dogs.map(d => d.id).filter(Boolean))];
  Promise.all(ids.map(id => fetch(photoSrc({ id }), { method: 'HEAD', cache: 'no-cache' })
    .then(res => state.map.set(id, res.ok), () => state.map.set(id, false))))
    .then(() => {
      state.done = true;
      if (activeTab === 'analysis' && photoCheck === state) render();
    });
}

// ── 畫面 ──

function barChart(items, { unit = '隻', value = it => it.count, text } = {}) {
  const max = Math.max(1, ...items.map(value));
  return `<div class="a-bars">${items.map(it => {
    const v = value(it);
    const label = text ? text(it) : `${v} ${unit}`;
    return `<div class="a-bar-row" title="${esc(it.label)}：${esc(label)}">
      <span class="a-bar-label">${esc(it.label)}</span>
      <span class="a-bar-track"><span class="a-bar-fill" style="width:${v ? Math.max(2, v / max * 100) : 0}%"></span></span>
      <span class="a-bar-value">${esc(label)}</span>
    </div>`;
  }).join('')}</div>`;
}

// 狗的一列：點了開詳細資訊（data-adog 是 allDogs 的索引）
function dogRow(r, right) {
  return `<button type="button" class="a-dog" data-adog="${allDogs.indexOf(r.dog)}">
    <span class="a-dog-name">${esc(r.dog.name)}</span>
    <span class="a-dog-meta">${esc(r.dog.cage || '')}${r.intake ? `｜${r.intake.getFullYear()}/${r.intake.getMonth() + 1}/${r.intake.getDate()} 入所` : ''}</span>
    <span class="a-dog-right">${right}</span>
  </button>`;
}

function section(title, hint, body) {
  return `<section class="a-card"><h2>${esc(title)}</h2>${hint ? `<p class="a-hint">${hint}</p>` : ''}${body}</section>`;
}

// 入所時間 × 最近未遛天數的散布圖：x 在所年數、y 幾天沒遛，點的顏色沿用天數色標
function scatterSvg(points) {
  const W = 340, H = 220, L = 34, R = 10, T = 10, B = 28;
  const maxYears = Math.max(1, Math.ceil(Math.max(...points.map(p => p.stayDays / 365.25), 1)));
  const maxWalk = Math.max(10, ...points.map(p => p.walkDays));
  const yTop = Math.ceil(maxWalk / 10) * 10;
  const x = d => L + (d / 365.25) / maxYears * (W - L - R);
  const y = d => T + (1 - d / yTop) * (H - T - B);
  const xTicks = []; for (let i = 0; i <= maxYears; i++) xTicks.push(i);
  const yTicks = [0, AMBER_DAYS, ...[10, 20, 30, 40, 50, 60, 80, 100, 150, 200].filter(v => v < yTop && v > AMBER_DAYS && (yTop <= 60 || v % 20 === 0 || v >= 100)), yTop];
  const level = d => d >= RED_DAYS ? 'red' : d >= AMBER_DAYS ? 'amber' : 'sage';
  return `<svg class="a-scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="入所年數與幾天沒遛的散布圖">
    ${yTicks.map(v => `<line class="${v === AMBER_DAYS ? 'a-ref' : 'a-grid'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="a-axis" x="${L - 5}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    <line class="a-ref" x1="${x(365.25)}" x2="${x(365.25)}" y1="${T}" y2="${H - B}"/>
    ${xTicks.map(v => `<text class="a-axis" x="${x(v * 365.25)}" y="${H - B + 16}" text-anchor="middle">${v}年</text>`).join('')}
    ${points.map(p => `<circle class="a-dot ${level(p.walkDays)}" cx="${x(p.stayDays).toFixed(1)}" cy="${y(p.walkDays).toFixed(1)}" r="4.5"><title>${esc(p.dog.name)}：在所 ${formatStay(p.stayDays)}，${p.walkDays} 天沒遛</title></circle>`).join('')}
  </svg>`;
}

function dogNames(dogs) {
  return dogs.map(d => esc(d.name)).join('、');
}

function analysisHtml(dogs, today) {
  if (!dogs.length) return `<div class="status-msg">目前沒有狗狗資料</div>`;
  checkPhotos(dogs);
  const rows = analysisRows(dogs, today);
  const noIntake = rows.filter(r => !r.intake);
  const skipNote = noIntake.length ? `（${noIntake.length} 隻編號看不出入所日期，不列入：${dogNames(noIntake.map(r => r.dog))}）` : '';
  const out = [];

  out.push(`<div class="section-hint">${icon('pin')}共 ${rows.length} 隻；入所日期取編號前 8 碼${skipNote}</div>`);

  const share = longStayShare(rows);
  out.push(section('長期在所犬比例', '在所滿 1 年的狗',
    `<div class="a-big"><b>${share.pct.toFixed(0)}%</b><span>${share.long} / ${share.total} 隻</span></div>
     <div class="a-bar-track a-share"><span class="a-bar-fill" style="width:${share.pct}%"></span></div>`));

  out.push(section('入所多久分布', '', barChart(stayDistribution(rows))));

  out.push(section('在所最久 Top 10', '點狗名看詳細資訊',
    `<div class="a-list">${longestStay(rows).map((r, i) => dogRow(r, `<b>${formatStay(r.stayDays)}</b>`).replace('<span class="a-dog-name">', `<span class="a-rank">${i + 1}</span><span class="a-dog-name">`)).join('')}</div>`));

  out.push(section('入所年度分布', '', barChart(intakeYears(rows))));

  out.push(section('各區平均在所時間', '區＝籠位去掉數字',
    barChart(zoneAverages(rows).map(z => ({ ...z, label: z.zone })), { value: z => z.avgDays, text: z => `${formatStay(Math.round(z.avgDays))}（${z.count} 隻）` })));

  const sv = stayVsWalk(rows);
  const avgText = g => g.count ? `平均 ${g.avgWalkDays.toFixed(1)} 天沒遛（${g.count} 隻）` : '沒有資料';
  out.push(section('入所時間 × 最近未遛天數', `每個點是一隻狗；虛線是 1 年與 7 天${sv.skipped ? `。${sv.skipped} 隻沒有遛狗日期，不畫` : ''}`,
    `${sv.points.length ? scatterSvg(sv.points) : '<p class="a-empty">沒有資料</p>'}
     <div class="a-legend"><span><i class="a-key sage"></i>0–6 天</span><span><i class="a-key amber"></i>7–29 天</span><span><i class="a-key red"></i>30 天以上</span></div>
     <dl class="a-pair"><dt>在所滿 1 年</dt><dd>${avgText(sv.long)}</dd><dt>未滿 1 年</dt><dd>${avgText(sv.short)}</dd></dl>`));

  const neglected = longStayNeglected(rows);
  out.push(section('長期在所＋近期少遛', `在所滿 1 年，而且超過 ${AMBER_DAYS} 天沒遛：${neglected.length} 隻`,
    neglected.length
      ? `<div class="a-list">${neglected.map(r => dogRow(r, r.walkDays != null ? `<b class="${r.walkDays >= RED_DAYS ? 'red' : 'amber'}">${r.walkDays} 天沒遛</b>` : '<b class="muted">沒有紀錄</b>')).join('')}</div>`
      : '<p class="a-empty">目前沒有</p>'));

  const sex = sexComparison(rows);
  const sexCol = (mark, cls, g) => `<div class="a-sex"><div class="a-sex-head"><span class="sex ${cls}">${mark}</span>${g.count} 隻</div>
    ${g.count ? `<div>平均 <b>${formatStay(Math.round(g.avgDays))}</b></div><div>中位數 ${formatStay(Math.round(g.medianDays))}</div><div>滿 1 年 ${g.long} 隻</div>` : '<div>沒有資料</div>'}</div>`;
  out.push(section('公母在所時間差異', `只算有性別資料的狗；${sex.missing} 隻沒有性別資料`,
    `<div class="a-sex-grid">${sexCol('♂', 'male', sex.male)}${sexCol('♀', 'female', sex.female)}</div>`));

  const comp = dataCompleteness(rows, photoCheck && photoCheck.done ? photoCheck.map : null);
  const compRows = comp.items.map(it => it.dogs.length
    ? `<details class="a-miss"><summary><span>${esc(it.label)}</span><b>${it.dogs.length} 隻</b></summary><p>${dogNames(it.dogs)}</p></details>`
    : `<div class="a-miss ok"><span>${esc(it.label)}</span><b>0 隻</b></div>`).join('');
  out.push(section('犬隻資料完整度', `共 ${comp.total} 隻；點項目看是哪幾隻`,
    compRows + (photoCheck && photoCheck.done ? '' : '<div class="a-miss"><span>沒有照片</span><b class="muted">檢查中…</b></div>')));

  return out.join('');
}

// 分析頁的狗名列：點了開詳細資訊（事件委派，renderMain 重畫也不用重綁）
document.getElementById('main').addEventListener('click', e => {
  const row = e.target.closest('#main .a-dog[data-adog]');
  const dog = row && allDogs[row.dataset.adog];
  if (dog) showDetail(dog);
});
