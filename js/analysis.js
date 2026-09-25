// 分析分頁（V5-4，#59）：只用目前 dogs.json 就能算的犬隻統計。
// 統計都寫成純函式（輸入狗清單與今天日期，輸出數字），tests/index.html 直接測；畫面只負責把結果畫成 CSS／SVG 資訊圖表（大數字、圓環、直條圖）。
// 頁首右上角的圖示打開（不佔分類：分類只放每天遛狗會用的）。
// 會用到 js/app.js 的 makeDate、computeStatus、esc、icon、photoSrc、showDetail、allDogs、analysisOpen，所以要在 app.js 之後載入。

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
      if (analysisOpen && photoCheck === state) render();
    });
}

// ── 畫面（資訊圖表風格：大數字、圓環、直條圖；顏色只用 css/app.css 的色票）──

// 在所越久顏色越深（同一個藍色由淺到深），入所多久分布用
const STAY_SHADES = ['#CFE0FA', '#A9C8F6', '#80AEF1', '#5794EC', '#2F7BEA', '#2262C7', '#184A9C'];
const STAY_SHORT = ['<3月', '3–6月', '6–12月', '1–2年', '2–3年', '3–5年', '5年+'];

function yearsText(days) {
  return (days / 365.25).toFixed(1);
}

// 直條圖：每根柱子上方標數字，下方標名稱；hi 是要特別標出的柱子（例：最多的那年）
function columnChart(items, { color = () => 'var(--primary)', hi = -1 } = {}) {
  const max = Math.max(1, ...items.map(it => it.count));
  return `<div class="a-cols" style="--n:${items.length}">${items.map((it, i) => `
    <div class="a-col${i === hi ? ' hi' : ''}" title="${esc(it.label)}：${it.count} 隻">
      <span class="a-col-v">${it.count}</span>
      <span class="a-col-bar" style="height:${it.count ? Math.max(3, it.count / max * 100) : 0}%;background:${color(i)}"></span>
      <span class="a-col-l">${esc(it.short || it.label)}</span>
    </div>`).join('')}</div>`;
}

// 圓環：pct 0–100，中間放大數字
function ringSvg(pct, { size = 120, stroke = 14, color = 'var(--primary)', label = '', sub = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const len = Math.max(0, Math.min(100, pct)) / 100 * c;
  return `<svg class="a-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(label)} ${esc(sub)}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--primary-soft)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${len.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="${sub ? '47%' : '53%'}" text-anchor="middle" dominant-baseline="middle" class="a-ring-v">${esc(label)}</text>
    ${sub ? `<text x="50%" y="66%" text-anchor="middle" class="a-ring-s">${esc(sub)}</text>` : ''}
  </svg>`;
}

// 狗的一列：點了開詳細資訊（data-adog 是 allDogs 的索引）；bar 是這隻在清單裡的相對長度（0–100）
function dogRow(r, right, { rank, bar } = {}) {
  return `<button type="button" class="a-dog" data-adog="${allDogs.indexOf(r.dog)}">
    ${rank ? `<span class="a-rank r${rank}">${rank}</span>` : ''}
    <span class="a-dog-name">${esc(r.dog.name)}</span>
    <span class="a-dog-meta">${esc(r.dog.cage || '')}${r.intake ? `｜${r.intake.getFullYear()}/${r.intake.getMonth() + 1}/${r.intake.getDate()} 入所` : ''}</span>
    <span class="a-dog-right">${right}</span>
    ${bar != null ? `<span class="a-dog-bar"><i style="width:${bar}%"></i></span>` : ''}
  </button>`;
}

function section(title, hint, body, iconId) {
  return `<section class="a-card"><h2>${iconId ? `<span class="a-h-icon">${icon(iconId)}</span>` : ''}${esc(title)}</h2>${hint ? `<p class="a-hint">${hint}</p>` : ''}${body}</section>`;
}

// 入所時間 × 最近未遛天數的散布圖：x 在所年數、y 幾天沒遛，點的顏色沿用天數色標；
// 右上角（滿 1 年又超過 7 天沒遛）塗淡紅底，就是「長期在所＋近期少遛」那一區
function scatterSvg(points) {
  const W = 340, H = 220, L = 30, R = 10, T = 12, B = 26;
  const maxYears = Math.max(1, Math.ceil(Math.max(...points.map(p => p.stayDays / 365.25), 1)));
  const yTop = Math.ceil(Math.max(10, ...points.map(p => p.walkDays)) / 10) * 10;
  const x = d => L + (d / 365.25) / maxYears * (W - L - R);
  const y = d => T + (1 - d / yTop) * (H - T - B);
  const xTicks = []; for (let i = 0; i <= maxYears; i += maxYears > 6 ? 2 : 1) xTicks.push(i);
  const step = yTop <= 20 ? 5 : yTop <= 60 ? 10 : 30;
  const yTicks = []; for (let v = 0; v <= yTop; v += step) yTicks.push(v);
  const level = d => d >= RED_DAYS ? 'red' : d >= AMBER_DAYS ? 'amber' : 'sage';
  return `<svg class="a-scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="入所年數與幾天沒遛的散布圖">
    <rect class="a-zone" x="${x(365.25)}" y="${T}" width="${W - R - x(365.25)}" height="${y(AMBER_DAYS) - T}" rx="6"/>
    <text class="a-zone-t" x="${W - R - 6}" y="${T + 14}" text-anchor="end">需要多關心</text>
    ${yTicks.map(v => `<line class="a-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="a-axis" x="${L - 5}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    <line class="a-ref" x1="${L}" x2="${W - R}" y1="${y(AMBER_DAYS)}" y2="${y(AMBER_DAYS)}"/>
    <line class="a-ref" x1="${x(365.25)}" x2="${x(365.25)}" y1="${T}" y2="${H - B}"/>
    ${xTicks.map(v => `<text class="a-axis" x="${x(v * 365.25)}" y="${H - B + 16}" text-anchor="middle">${v}年</text>`).join('')}
    ${points.map(p => `<circle class="a-dot ${level(p.walkDays)}" cx="${x(p.stayDays).toFixed(1)}" cy="${y(p.walkDays).toFixed(1)}" r="5"><title>${esc(p.dog.name)}：在所 ${formatStay(p.stayDays)}，${p.walkDays} 天沒遛</title></circle>`).join('')}
  </svg>`;
}

function dogNames(dogs) {
  return dogs.map(d => esc(d.name)).join('、');
}

function kpi(value, unit, label, tone = '') {
  return `<div class="a-kpi ${tone}"><div class="a-kpi-v">${value}<small>${unit}</small></div><div class="a-kpi-l">${label}</div></div>`;
}

function analysisHtml(dogs, today) {
  if (!dogs.length) return `<div class="status-msg">目前沒有狗狗資料</div>`;
  checkPhotos(dogs);
  const rows = analysisRows(dogs, today);
  const noIntake = rows.filter(r => !r.intake);
  const share = longStayShare(rows);
  const neglected = longStayNeglected(rows);
  const avgStay = average(rows.filter(r => r.intake).map(r => r.stayDays));
  const out = [];

  // 最上面一張藍色總覽：四個大數字
  out.push(`<section class="a-hero">
    <div class="a-hero-title">${icon('paw')}板收犬隻總覽</div>
    <div class="a-kpis">
      ${kpi(rows.length, '隻', '目前在所')}
      ${kpi(avgStay == null ? '–' : yearsText(avgStay), '年', '平均在所')}
      ${kpi(share.pct.toFixed(0), '%', '在所滿 1 年')}
      ${kpi(neglected.length, '隻', '長期在所又少遛', neglected.length ? 'warn' : '')}
    </div>
    <div class="a-hero-note">入所日期取編號前 8 碼${noIntake.length ? `；${noIntake.length} 隻編號看不出入所日期，不列入時間統計（${dogNames(noIntake.map(r => r.dog))}）` : ''}</div>
  </section>`);

  out.push(section('長期在所犬比例', '',
    `<div class="a-ring-row">${ringSvg(share.pct, { label: `${share.pct.toFixed(0)}%`, sub: '滿 1 年' })}
      <div class="a-ring-legend">
        <div><i class="a-key primary"></i>在所滿 1 年<b>${share.long} 隻</b></div>
        <div><i class="a-key soft"></i>未滿 1 年<b>${share.total - share.long} 隻</b></div>
        <p>每 10 隻狗裡，約有 ${Math.round(share.pct / 10)} 隻已經在收容所住超過一年。</p>
      </div></div>`, 'alert'));

  const dist = stayDistribution(rows).map((b, i) => ({ ...b, short: STAY_SHORT[i] }));
  const topBucket = dist.reduce((m, b, i) => (b.count > dist[m].count ? i : m), 0);
  out.push(section('入所多久分布', `最多的是「${dist[topBucket].label}」，共 ${dist[topBucket].count} 隻`,
    columnChart(dist, { color: i => STAY_SHADES[i] }), 'pin'));

  const top = longestStay(rows);
  const topMax = top.length ? top[0].stayDays : 1;
  out.push(section('在所最久 Top 10', '點狗名看詳細資訊',
    `<div class="a-list">${top.map((r, i) => dogRow(r, `<b>${yearsText(r.stayDays)}</b><small> 年</small>`, { rank: i + 1, bar: r.stayDays / topMax * 100 })).join('')}</div>`, 'paw'));

  const years = intakeYears(rows);
  const peak = years.reduce((m, y, i) => (y.count > years[m].count ? i : m), 0);
  out.push(section('入所年度分布', years.length ? `${years[peak].label} 年入所最多，共 ${years[peak].count} 隻` : '',
    columnChart(years.map(y => ({ ...y, short: `'${y.label.slice(2)}` })), { hi: peak }), 'card'));

  const zones = zoneAverages(rows);
  const zMax = Math.max(1, ...zones.map(z => z.avgDays));
  out.push(section('各區平均在所時間', '區＝籠位去掉數字',
    `<div class="a-hbars">${zones.map(z => `
      <div class="a-hbar" title="${esc(z.zone)}：平均 ${formatStay(Math.round(z.avgDays))}，${z.count} 隻">
        <span class="a-hbar-l">${esc(z.zone)}</span>
        <span class="a-hbar-track"><span class="a-hbar-fill" style="width:${Math.max(8, z.avgDays / zMax * 100)}%"><b>${yearsText(z.avgDays)} 年</b></span></span>
        <span class="a-hbar-n">${z.count} 隻</span>
      </div>`).join('')}</div>`, 'pin'));

  const sv = stayVsWalk(rows);
  const avgTile = (label, g) => `<div class="a-mini"><div class="a-mini-l">${label}</div>${g.count
    ? `<div class="a-mini-v">${g.avgWalkDays.toFixed(1)}<small> 天</small></div><div class="a-mini-s">平均沒遛・${g.count} 隻</div>`
    : '<div class="a-mini-s">沒有資料</div>'}</div>`;
  out.push(section('入所時間 × 最近未遛天數', `每個點是一隻狗${sv.skipped ? `；${sv.skipped} 隻沒有遛狗日期，不畫` : ''}`,
    `${sv.points.length ? scatterSvg(sv.points) : '<p class="a-empty">沒有資料</p>'}
     <div class="a-legend"><span><i class="a-key sage"></i>0–6 天</span><span><i class="a-key amber"></i>7–29 天</span><span><i class="a-key red"></i>30 天以上</span></div>
     <div class="a-minis">${avgTile('在所滿 1 年', sv.long)}${avgTile('未滿 1 年', sv.short)}</div>`, 'search'));

  out.push(section('長期在所＋近期少遛', `在所滿 1 年，而且超過 ${AMBER_DAYS} 天沒遛：${neglected.length} 隻`,
    neglected.length
      ? `<div class="a-list">${neglected.map(r => dogRow(r, r.walkDays != null ? `<span class="a-pill ${r.walkDays >= RED_DAYS ? 'red' : 'amber'}">${r.walkDays} 天沒遛</span>` : '<span class="a-pill muted">沒有紀錄</span>')).join('')}</div>`
      : `<p class="a-empty ok">${icon('tick')}目前沒有，大家都有照顧到</p>`, 'warn'));

  const sex = sexComparison(rows);
  const known = sex.male.count + sex.female.count;
  const mPct = known ? sex.male.count / known * 100 : 50;
  const sexCol = (mark, cls, g) => `<div class="a-sex ${cls}"><div class="a-sex-mark">${mark}</div>
    ${g.count ? `<div class="a-sex-v">${yearsText(g.avgDays)}<small> 年</small></div><div class="a-sex-s">平均在所</div>
      <div class="a-sex-row"><span>中位數</span><b>${yearsText(g.medianDays)} 年</b></div><div class="a-sex-row"><span>滿 1 年</span><b>${g.long} 隻</b></div>` : '<div class="a-sex-s">沒有資料</div>'}</div>`;
  out.push(section('公母在所時間差異', `只算有性別資料的狗；${sex.missing} 隻沒有性別資料`,
    `<div class="a-split" title="公 ${sex.male.count} 隻、母 ${sex.female.count} 隻">
       <span class="male" style="width:${mPct}%">♂ ${sex.male.count}</span><span class="female" style="width:${100 - mPct}%">♀ ${sex.female.count}</span>
     </div>
     <div class="a-sex-grid">${sexCol('♂', 'male', sex.male)}${sexCol('♀', 'female', sex.female)}</div>`, 'group'));

  const photosDone = photoCheck && photoCheck.done;
  const comp = dataCompleteness(rows, photosDone ? photoCheck.map : null);
  const ringItems = comp.items.filter(it => it.label !== '編號看不出入所日期');
  const rings = ringItems.map(it => {
    const pct = (comp.total - it.dogs.length) / comp.total * 100;
    return `<div class="a-comp">${ringSvg(pct, { size: 78, stroke: 9, color: pct >= 95 ? 'var(--green-text)' : 'var(--primary)', label: `${Math.floor(pct)}%` })}<span>${esc(it.label.replace('沒有', ''))}</span></div>`;
  }).join('') + (photosDone ? '' : `<div class="a-comp">${ringSvg(0, { size: 78, stroke: 9, label: '…' })}<span>照片</span></div>`);
  const compRows = comp.items.map(it => it.dogs.length
    ? `<details class="a-miss"><summary><span>${esc(it.label)}</span><b>${it.dogs.length} 隻</b></summary><p>${dogNames(it.dogs)}</p></details>`
    : `<div class="a-miss ok"><span>${esc(it.label)}</span><b>0 隻</b></div>`).join('');
  out.push(section('犬隻資料完整度', `共 ${comp.total} 隻；圓環是資料齊全的比例，點下面項目看缺哪幾隻`,
    `<div class="a-comps">${rings}</div>` + compRows +
    (photosDone ? '' : '<div class="a-miss"><span>沒有照片</span><b class="muted">檢查中…</b></div>'), 'note'));

  return out.join('');
}

// 分析頁整頁：上方「‹ 返回」＋標題；資料還沒好時顯示讀取中或失敗
function analysisPageHtml(today) {
  const top = `<div class="a-top"><button type="button" class="a-back" id="analysisBack">${icon('back')}返回</button><h2>犬隻分析</h2></div>`;
  if (loadState === 'ready') return top + analysisHtml(allDogs, today);
  return top + `<div class="status-msg">${loadState === 'error' ? '資料載入失敗，請稍後重新整理。' : '讀取狗狗資料中…'}</div>`;
}

// 打開分析頁：手機按「返回」會回到原本的分類（跟詳細資訊一樣用 history）
function showAnalysis() {
  if (analysisOpen) return;
  analysisOpen = true;
  document.documentElement.classList.add('analysis-open');
  history.pushState({ bqAnalysis: true }, '');
  render();
  window.scrollTo(0, 0);
}

function hideAnalysis() {
  if (!analysisOpen) return;
  analysisOpen = false;
  document.documentElement.classList.remove('analysis-open');
  render();
  window.scrollTo(0, 0);
}

function closeAnalysis() {
  if (history.state && history.state.bqAnalysis) history.back(); // popstate 會接著 hideAnalysis
  else hideAnalysis();
}

const analysisBtn = document.getElementById('analysisBtn');
if (analysisBtn) analysisBtn.addEventListener('click', () => (analysisOpen ? closeAnalysis() : showAnalysis()));

// 分析頁的狗名列：點了開詳細資訊（事件委派，renderMain 重畫也不用重綁）
document.getElementById('main').addEventListener('click', e => {
  if (e.target.closest('#analysisBack')) { closeAnalysis(); return; }
  const row = e.target.closest('#main .a-dog[data-adog]');
  const dog = row && allDogs[row.dataset.adog];
  if (dog) showDetail(dog);
});
