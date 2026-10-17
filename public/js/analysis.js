// 分析頁（V5-4 #59、V5-5 #60）：目前 dogs.json 就能算的犬隻統計，加上 #56 累積的遛狗歷史與每日快照。
// 統計都寫成純函式（輸入狗清單與今天日期，輸出數字），tests/index.html 直接測；畫面只負責把結果畫成 CSS／SVG 資訊圖表（大數字、圓環、直條圖）。
// 頁首右上角的圖示打開（不佔分類：分類只放每天遛狗會用的）。
// 會用到 js/app.js 的 makeDate、idDate、firstIntake、computeStatus、esc、icon、photoSrc、showDetail、allDogs、analysisOpen，所以要在 app.js 之後載入。

// 長期在所＝在所滿 1 年；近期少遛＝超過 AMBER_DAYS 天沒遛（沿用溜狗表的黃色門檻，2026-10-09 起 3 天）
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

// 入所日（ADR 0011）：編號、舊編號、出入所紀錄裡最早的那天（app.js 的 firstIntake）；看不出來或在未來的回 null
function intakeDate(dog, today) {
  const d = firstIntake(dog);
  return d && d <= today ? d : null;
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
    { label: '沒有溜狗日期', dogs: pick(r => !r.dog.walkedDate) },
    { label: '沒有性別', dogs: pick(r => !r.dog.sex) },
    { label: '沒有入所介紹', dogs: pick(r => !r.dog.intro) },
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
    .then(res => state.map.set(id, res.ok ? true : res.status === 404 ? false : null), () => state.map.set(id, null))))
    .then(() => {
      state.done = true;
      if (analysisOpen && photoCheck === state) render();
    });
}

// ── 遛狗歷史（V5-5，#60）：讀溜狗紀錄（#260 起是 Worker 的 api/walks，從 D1 讀） ──
// 試算表每隻狗只記最後一次遛狗，所以歷史從第一份快照那天才開始累積；walks.json 在那之前的紀錄是建立時的「最後一次」，
// 只拿來當第一段間隔的起點，不算進次數。所有人的遛狗都算（不看 mine），畫面不出現志工名字。
// WALKS_URL 在 js/app.js（#58 我溜過也讀同一份）
const dogKey = d => d.id || `名:${d.name}`;

// 溜狗紀錄 → [{ key, id, name, date }]，日期不合理的略過
function parseWalks(data) {
  if (!data || !Array.isArray(data.walks)) return [];
  return data.walks.map(w => ({ id: String(w.id || ''), name: String(w.name || ''), date: parseYmd(w.date) }))
    .filter(w => w.date && (w.id || w.name)).map(w => ({ ...w, key: dogKey(w) }));
}

// 開始記錄日（原本是第一份快照的日期，#260 起 api/walks 的 historyStart）→ [日期字串]；沒有或壞掉就是 []
function historyStartDates(data) {
  return data && parseYmd(data.historyStart) ? [data.historyStart] : [];
}

// 開始累積的日期與目前累積幾天（含今天）
function historySpan(dates, today) {
  const start = dates.length ? parseYmd(dates[0]) : null;
  const t = makeDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
  return { start, days: start ? daysBetween(start, t) + 1 : 0 };
}

// 近期溜狗紀錄的範圍起點：上個月 1 號（ADR 0013；today 已是台灣時間的日期）
function recentStart(today) {
  return new Date(today.getFullYear(), today.getMonth() - 1, 1); // 1 月時自動退到去年 12 月
}

// 一隻狗的遛狗紀錄（K 2026-09-25：遛狗歷史要看每隻狗才有意義，放在詳細資訊）：
// 最近 N 天每天有沒有遛（開始記錄前的日子標「未記錄」）、這段期間遛幾次、平均與最久隔幾天。
// 間隔只用近期溜狗紀錄（上個月 1 號到今天，#345）算；範圍內一次都沒溜（範圍開始前就有紀錄）→ maxGap 是 'over'（超過 62 天）
function dogWalkHistory(dog, walks, start, today, n = 30) {
  const key = dogKey(dog);
  const dates = [...new Set(walks.filter(w => w.key === key).map(w => +w.date))].sort((a, b) => a - b);
  const t = makeDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const set = new Set(dates);
  const cells = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - i);
    cells.push({ date: d, walked: set.has(+d), recorded: !!start && d >= start });
  }
  const from = Math.max(+recentStart(today), start ? +start : Infinity);
  const recent = dates.filter(d => d >= +recentStart(today) && d <= +t);
  const gaps = [];
  for (let i = 1; i < recent.length; i++) if (recent[i] >= from) gaps.push(Math.round((recent[i] - recent[i - 1]) / 86400000));
  const over = !!start && +start < +recentStart(today) && !recent.length;
  return {
    cells,
    count: cells.filter(c => c.walked).length, // 開始記錄前的那筆「最後遛狗日」也是真的，一起算
    avgGap: average(gaps),
    maxGap: over ? 'over' : gaps.length ? Math.max(...gaps) : null,
  };
}

// 讀遛狗紀錄：打開詳細資訊才讀，一次開網頁只讀一遍
let historyData = null; // { state: 'loading'|'ready'|'error', walks, dates }
function loadHistory() {
  if (historyData) return;
  const state = historyData = { state: 'loading', walks: [], dates: [] };
  const get = url => fetch(url, { cache: 'no-cache' }).then(res => { if (!res.ok) throw new Error(res.status); return res.json(); });
  get(WALKS_URL).then(w => {
    state.walks = parseWalks(w);
    state.dates = historyStartDates(w);
    state.state = 'ready';
  }, () => { state.state = 'error'; }).then(() => {
    if (historyData !== state) return;
    if (detailDog) renderDetail();
    if (analysisOpen) render();
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

// 狗的一列：點了開詳細資訊（data-adog 是 allDogs 的索引）
function dogRow(r, right, { rank } = {}) {
  return `<button type="button" class="a-dog" data-adog="${allDogs.indexOf(r.dog)}">
    ${rank ? `<span class="a-rank r${rank}">${rank}</span>` : ''}
    <span class="a-dog-name">${esc(r.dog.name)}</span>
    <span class="a-dog-meta">${esc(r.dog.cage || '')}${r.intake ? `｜${r.intake.getFullYear()}/${r.intake.getMonth() + 1}/${r.intake.getDate()} 入所` : ''}</span>
    <span class="a-dog-right">${right}</span>
  </button>`;
}

function section(title, hint, body, iconId) {
  return `<section class="a-card"><h2>${iconId ? `<span class="a-h-icon">${icon(iconId)}</span>` : ''}${esc(title)}</h2>${hint ? `<p class="a-hint">${hint}</p>` : ''}${body}</section>`;
}

function dogNames(dogs) {
  return dogs.map(d => esc(d.name)).join('、');
}

function kpi(value, unit, label, tone = '') {
  return `<div class="a-kpi ${tone}"><div class="a-kpi-v">${value}<small>${unit}</small></div><div class="a-kpi-l">${label}</div></div>`;
}

// ── 本月溜狗（K 2026-10-09「分析頁可以有個本月報表」：溜狗總計、每天溜狗次數）──
function analysisHtml(dogs, today, page = 'stay') {
  if (!dogs.length) return `<div class="status-msg">目前沒有狗</div>`;
  checkPhotos(dogs);
  const rows = analysisRows(dogs, today);
  if (page === 'quality') return dataChecksHtml(rows);
  const noIntake = rows.filter(r => !r.intake);
  const share = longStayShare(rows);
  const avgStay = average(rows.filter(r => r.intake).map(r => r.stayDays));
  const out = [];

  // 最上面三格大數字（V7 #114 白底；2026-10-08 拿掉「在所滿 1 年 %」，下面圓環已經有）
  out.push(`<section class="a-hero">
    <div class="a-hero-title">${icon('paw')}${esc(SITE.shelterShort)}在所的狗</div>
    <div class="a-kpis">
      ${kpi(rows.length, '隻', '目前在所')}
      ${kpi(avgStay == null ? '–' : yearsText(avgStay), '年', '平均在所')}
    </div>
    <div class="a-hero-note">入所日期取編號（含舊編號）前 8 碼和出入所紀錄裡最早的那天${noIntake.length ? `；${noIntake.length} 隻編號看不出入所日期，不列入時間統計（${dogNames(noIntake.map(r => r.dog))}）` : ''}</div>
  </section>`);

  const dist = stayDistribution(rows).map((b, i) => ({ ...b, short: STAY_SHORT[i] }));
  const topBucket = dist.reduce((m, b, i) => (b.count > dist[m].count ? i : m), 0);
  // 2026-10-08 distill：「在所滿 1 年的比例」圓環和「入所年度分布」跟這張是同一份資料，併成這一張的說明
  out.push(section('入所多久分布', `滿 1 年的 ${share.long} 隻（${share.pct.toFixed(0)}%）；最多的是「${dist[topBucket].label}」，共 ${dist[topBucket].count} 隻`,
    columnChart(dist, { color: i => STAY_SHADES[i] }), 'pin'));

  const top = longestStay(rows);
  out.push(section('在所最久 Top 10', '點狗名看詳細資訊',
    `<div class="a-list">${top.map((r, i) => dogRow(r, `<b>${yearsText(r.stayDays)}</b><small> 年</small>`, { rank: i + 1 })).join('')}</div>`, 'paw'));

  const zones = zoneAverages(rows);
  const zMax = Math.max(1, ...zones.map(z => z.avgDays));
  out.push(section('各區平均在所時間', '區＝籠位去掉數字',
    `<div class="a-hbars">${zones.map(z => `
      <div class="a-hbar" title="${esc(z.zone)}：平均 ${formatStay(Math.round(z.avgDays))}，${z.count} 隻">
        <span class="a-hbar-l">${esc(z.zone)}</span>
        <span class="a-hbar-track"><span class="a-hbar-fill" style="width:${Math.max(8, z.avgDays / zMax * 100)}%"><b>${yearsText(z.avgDays)} 年</b></span></span>
        <span class="a-hbar-n">${z.count} 隻</span>
      </div>`).join('')}</div>`, 'pin'));

  const sex = sexComparison(rows);
  const known = sex.male.count + sex.female.count;
  const mPct = known ? sex.male.count / known * 100 : 50;
  // 2026-10-08 distill：兩張數字卡改成一行平均（中位數、滿 1 年隻數拿掉）
  const sexAvg = (mark, cls, g) => `<span class="${cls}">${mark}</span> ${g.count ? `<b>${yearsText(g.avgDays)}</b> 年` : '沒有資料'}`;
  out.push(section('公母在所時間差異', `只算有性別資料的狗；${sex.missing} 隻沒有性別資料`,
    `<div class="a-split" title="公 ${sex.male.count} 隻、母 ${sex.female.count} 隻">
       <span class="male" style="width:${mPct}%">♂ ${sex.male.count}</span><span class="female" style="width:${100 - mPct}%">♀ ${sex.female.count}</span>
     </div>
     <p class="a-sex-line">平均在所　${sexAvg('♂', 'male', sex.male)}　${sexAvg('♀', 'female', sex.female)}</p>`, 'group'));

  return out.join('');
}

function dataChecksHtml(rows) {
  const photosDone = photoCheck && photoCheck.done;
  const comp = dataCompleteness(rows, photosDone ? photoCheck.map : null);
  const compRows = comp.items.map(it => it.dogs.length
    ? `<details class="a-miss"><summary><span>${esc(it.label)}</span><b>${it.dogs.length} 隻</b></summary><p>${dogNames(it.dogs)}</p></details>`
    : `<div class="a-miss ok"><span>${esc(it.label)}</span><b>0 隻</b></div>`).join('');
  // 2026-10-08 distill：拿掉跟下面清單重複的圓環
  return section('狗的資料完整度', `共 ${comp.total} 隻；點項目看缺哪幾隻`,
    compRows +
    (photosDone ? ([...photoCheck.map.values()].some(v => v === null) ? '<p role="alert">部分照片讀取失敗，未列入缺照片名單；請確認網路後重新整理。</p>' : '') : '<div class="a-miss"><span>沒有照片</span><b class="muted">檢查中…</b></div>'), 'note');
}

// ── 詳細資訊的遛狗紀錄 ──
function mdText(d) {
  return d ? `${d.getMonth() + 1}/${d.getDate()}` : '沒有紀錄';
}

// 詳細資訊的「遛狗紀錄」：一行字（最近 30 天溜幾次、平均、最久）；按「看每一天」才展開 30 天的格子
// （K 2026-10-10 減法：格子很棒但讓人眼花，預設收起來）
// 離所的狗（#164）只畫到離所那天，之後的日子不算「沒溜」
function walkHistorySection(dog, today) {
  const end = dog.departure && dog.departure.date && dog.departure.date < today ? dog.departure.date : null;
  if (end) today = end;
  loadHistory();
  const head = `<h3>${icon('tick')}溜狗紀錄<span class="sub">所有人溜的都算</span></h3>`;
  const wrap = body => `<section class="detail-section" data-section="walks">${head}${body}</section>`;
  if (!historyData || historyData.state === 'loading') return wrap('<div class="empty">讀取中…</div>');
  if (historyData.state === 'error') return wrap('<div class="empty">溜狗紀錄讀不到</div>');
  const { start } = historySpan(historyData.dates, today);
  const h = dogWalkHistory(dog, historyData.walks, start, today);
  const first = h.cells[0].date, last = h.cells[h.cells.length - 1].date;
  const cell = c => `<span class="${c.walked ? 'on' : c.recorded ? 'off' : 'none'}" title="${mdText(c.date)}${c.walked ? ' 有溜' : c.recorded ? ' 沒溜' : ' 還沒開始記錄'}"></span>`;
  // critique 2026-10-09 少一點格子：三格統計卡改成一行字；沒有間隔可算（不到兩次）就不寫平均、最久
  const sum = [`最近 30 天溜 <b>${h.count}</b> 次`];
  if (h.avgGap != null) sum.push(`平均 <b>${h.avgGap.toFixed(1)}</b> 天溜一次`);
  if (h.maxGap === 'over') sum.push('最久 <b>超過 62</b> 天沒溜');
  else if (h.maxGap != null) sum.push(`最久 <b>${h.maxGap}</b> 天沒溜`);
  const open = typeof detailWalksOpen !== 'undefined' && detailWalksOpen;
  // 一項一塊、塊裡不斷行：手機放不下就整項換到下一行，不會剩一個點在行尾
  const toggle = `<button type="button" class="w-toggle" id="walksToggle" aria-expanded="${open}"><span class="w-sum">${sum.map(t => `<span class="w-it">${t}</span>`).join('')}</span><span class="w-more">${open ? '收起' : '看每一天'}</span></button>`;
  if (!open) return wrap(toggle);
  return wrap(`${toggle}
    <div class="w-grid">${h.cells.map(cell).join('')}</div>
    <div class="w-axis"><span>${mdText(first)}</span><span>${end ? `${mdText(end)} 離所` : '今天'}</span></div>
    <div class="w-legend"><span><i class="on"></i>有溜</span><span><i class="off"></i>沒溜</span>${h.cells.some(c => !c.recorded) ? '<span><i class="none"></i>還沒開始記錄</span>' : ''}</div>
    <div class="w-note">從 ${start ? `${start.getFullYear()}/${mdText(start)}` : '同步'} 開始記錄，同一天溜幾次都算一格。</div>`);
}

// 分析頁整頁：「← 分析」在頁首（index.html 的 .head-back、.head-title，K 2026-10-09）；資料還沒好時顯示讀取中或失敗
function analysisPageHtml(today) {
  if (!infoPage) return infoHomeHtml();
  if (infoPage === 'departures') return departureSectionHtml(today);
  // #270 尚未提供活動核心，不以空名單冒充零場，不另建資料契約。
  if (infoPage === 'activities') return section('活動紀錄', '', '<p>活動紀錄尚未開放</p><p class="a-hint">活動查看與編輯準備好後，會在這裡提供。</p>');
  if (infoPage === 'updates') return infoUpdatesHtml();
  if (loadState === 'ready') return analysisHtml(allDogs, today, infoPage);
  return `<div class="status-msg">${loadState === 'error' ? '狗的資料讀不到，請確認網路後重新整理。' : '讀取中…'}</div>`;
}

// 打開分析頁：手機按「返回」會回到原本的分類（跟詳細資訊一樣用 history）
function showAnalysis() {
  if (analysisOpen) return;
  switchTab('info');
}

function hideAnalysis() {
  if (!analysisOpen) return;
  switchTab(activeTab, false);
}

function closeAnalysis() {
  if (history.state && (history.state.bqAnalysis || history.state.bqNavigation)) history.back();
  else hideAnalysis();
}

const analysisBtn = document.getElementById('analysisBtn');
if (analysisBtn) analysisBtn.addEventListener('click', () => (analysisOpen ? closeAnalysis() : showAnalysis()));

// 分析頁的狗名列：點了開詳細資訊（事件委派，renderMain 重畫也不用重綁）
const analysisBack = document.getElementById('analysisBack');
if (analysisBack) analysisBack.addEventListener('click', () => {
  if (analysisOpen && infoPage) {
    if (history.state?.infoPage) history.back();
    else restoreInfoPage('');
  } else if (analysisOpen) closeAnalysis();
  else if (activeTab === 'groups') {
    if (history.state && history.state.bqNavigation) history.back();
    else switchTab(groupsReturnTab, false);
  }
});
document.getElementById('main').addEventListener('click', e => {
  const row = e.target.closest('#main .a-dog[data-adog]');
  const dog = row && allDogs[row.dataset.adog];
  if (dog) showDetail(dog);
});

// ── 離所（#163 年度統計、#164 離所名冊）──
// 離所紀錄（api/departures，存在 D1）由同步產生（scripts/sync-sheet.mjs 的 updateDepartures）：狗從主清單消失就記一筆，
// 原因只讀試算表「已出所」分頁判讀，判不出來是待確認。打開分析頁才讀，不拖慢溜狗表。
// #363 ADR 0014：長條圖、名冊搜尋（全部年份）用名冊索引（每隻只有編號、狗名、舊編號、出所日、原因）；
// 點一隻狗才拿那一年的詳細資料（最後籠位、介紹、旗標、出入所），網址帶版本號，瀏覽器快取
const DEPARTURES_URL = 'api/departures/index';
const DEPARTURE_YEAR_URL = 'api/departures'; // ?year=YYYY|none&v=版本號，形狀跟原本的 data/departures.json 一樣
const DEPARTURE_ORDER = ['adopt', 'death', 'other', 'unknown'];
const DEPARTURE_COLORS = { adopt: 'var(--green-text)', death: '#8E8E93', other: 'var(--primary)', unknown: '#F0A030' };
let departuresData = null; // { state: 'loading' | 'ready' | 'error', list, years: { 年: 版本號 } }
const departureDetails = new Map(); // 年 → Promise<Map<編號, 離所的狗（詳細）>>
let depRoster = { open: false, query: '', year: 'all', reason: 'all' };

// departures.json（或名冊索引的 dogs）→ 離所的狗：跟在所的狗同一個樣子（parseDogsData），多一個 departure；
// 索引沒有 last，舊編號放在 formerIds
function parseDeparturesData(data) {
  const entries = data && (Array.isArray(data.departures) ? data.departures : data.dogs);
  if (!Array.isArray(entries)) throw new Error('departures.json 格式不對');
  const text = v => (v == null ? '' : String(v).trim());
  return entries.filter(e => e && text(e.id) && text(e.name)).map(e => {
    const last = e.last && typeof e.last === 'object' ? e.last : { formerIds: e.formerIds };
    const dog = parseDogsData({ dogs: [{ ...last, id: text(e.id), name: text(last.name) || text(e.name), stays: e.stays }] }).dogs[0];
    dog.depYear = text(e.date).slice(0, 4) || 'none';
    dog.departure = {
      reason: DEPARTURE_ORDER.includes(e.reason) ? e.reason : 'unknown',
      matched: text(e.matched),
      date: parseYmd(e.date),
      dateSource: text(e.dateSource),
      flags: Array.isArray(e.flags) ? e.flags.map(text) : [],
      returned: text(e.returned),
    };
    return dog;
  });
}

function loadDepartures() {
  if (departuresData) return;
  departuresData = { state: 'loading', list: [] };
  fetch(DEPARTURES_URL, { cache: 'no-cache' })
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then(data => { departuresData = { state: 'ready', list: parseDeparturesData(data), years: (data && data.years) || {} }; })
    .catch(() => { departuresData = { state: 'error', list: [] }; })
    .then(() => { if (analysisOpen) render(); });
}

// 名冊點一隻狗：拿那一年的詳細資料再開；拿不到就用索引那一筆開（只少了籠位、介紹等）
function departureDetail(dog) {
  const year = dog.depYear;
  if (!departureDetails.has(year)) {
    const ver = (departuresData && departuresData.years[year]) || '';
    const url = `${DEPARTURE_YEAR_URL}?year=${encodeURIComponent(year)}&v=${encodeURIComponent(ver)}`;
    departureDetails.set(year, fetch(url)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(data => new Map(parseDeparturesData(data).map(d => [d.id, d])))
      .catch(e => { departureDetails.delete(year); throw e; }));
  }
  return departureDetails.get(year).then(map => map.get(dog.id) || dog, () => dog);
}

// 每年各類幾隻（年份由舊到新）；沒有日期的另外算
function departureYears(list) {
  const years = new Map();
  let noDate = 0;
  for (const d of list) {
    const dt = d.departure.date;
    if (!dt) { noDate++; continue; }
    const y = dt.getFullYear();
    if (!years.has(y)) years.set(y, { year: y, total: 0, adopt: 0, death: 0, other: 0, unknown: 0 });
    const row = years.get(y);
    row[d.departure.reason]++;
    row.total++;
  }
  return { years: [...years.values()].sort((a, b) => a.year - b.year), noDate };
}

// 名冊篩選：狗名、編號、舊編號（部分符合）＋年份＋原因
function filterDepartures(list, { query = '', year = 'all', reason = 'all' } = {}) {
  const q = searchKey(query);
  return list.filter(d => {
    if (reason !== 'all' && d.departure.reason !== reason) return false;
    if (year !== 'all' && (!d.departure.date || String(d.departure.date.getFullYear()) !== String(year))) return false;
    return !q || [d.name, d.id, ...(d.formerIds || [])].some(v => searchKey(v).includes(q));
  }).sort((a, b) => (b.departure.date || 0) - (a.departure.date || 0) || a.name.localeCompare(b.name, 'zh-Hant'));
}

// 堆疊直條：每年一根，四類疊在一起
function stackedYears(years) {
  const max = Math.max(1, ...years.map(y => y.total));
  return `<div class="a-cols dep-cols" style="--n:${Math.max(years.length, 3)}">${years.map(y => `
    <button type="button" class="a-col dep-col${String(depRoster.year) === String(y.year) && depRoster.open ? ' hi' : ''}" data-dep-year="${y.year}"
      title="${y.year}：${DEPARTURE_ORDER.map(r => `${DEPARTURE_LABELS[r]} ${y[r]}`).join('、')}">
      <span class="a-col-v">${y.total}</span>
      <span class="dep-stack" style="height:${Math.max(3, y.total / max * 100)}%">${DEPARTURE_ORDER.filter(r => y[r]).map(r =>
        `<i style="flex:${y[r]};background:${DEPARTURE_COLORS[r]}"></i>`).join('')}</span>
      <span class="a-col-l">${y.year}</span>
    </button>`).join('')}</div>
    <div class="dep-legend">${DEPARTURE_ORDER.map(r => `<span><i class="a-key" style="background:${DEPARTURE_COLORS[r]}"></i>${DEPARTURE_LABELS[r]}</span>`).join('')}</div>`;
}

function departureRow(d) {
  const dep = d.departure;
  return `<button type="button" class="a-dog dep-row" data-dep-dog="${departuresData.list.indexOf(d)}">
    ${photoThumb(d, 40)}
    <span class="a-dog-name">${esc(d.name)}${dep.returned ? '<small class="dep-back">已再入所</small>' : ''}</span>
    <span class="a-dog-meta">${esc(ymdText(dep.date))}${dep.dateSource === 'seen' ? '（推估）' : ''}｜${esc(d.id)}</span>
    <span class="a-dog-right"><span class="badge dep-${dep.reason}">${esc(DEPARTURE_LABELS[dep.reason])}</span></span>
  </button>`;
}

function departureListHtml() {
  const rows = filterDepartures(departuresData.list, depRoster);
  return rows.length ? rows.map(departureRow).join('') : '<p class="a-empty">沒有符合的狗</p>';
}

function departureRosterHtml(years) {
  const opt = (v, label, cur) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${label}</option>`;
  return `<div class="dep-roster">
    <div class="dep-filters">
      <input type="search" id="depSearch" class="dep-search" placeholder="狗名或編號" value="${esc(depRoster.query)}" autocomplete="off" aria-label="搜尋離所的狗">
      <select id="depYear" aria-label="年份">${opt('all', '全部年份', depRoster.year)}${[...years].reverse().map(y => opt(y.year, `${y.year}`, depRoster.year)).join('')}</select>
      <select id="depReason" aria-label="原因">${opt('all', '全部原因', depRoster.reason)}${DEPARTURE_ORDER.map(r => opt(r, DEPARTURE_LABELS[r], depRoster.reason)).join('')}</select>
    </div>
    <div class="a-list" id="depList">${departureListHtml()}</div>
  </div>`;
}

function departureSectionHtml(today) {
  loadDepartures();
  const title = '離所';
  if (departuresData.state === 'loading') return section(title, '', '<p class="a-empty">讀取中…</p>', 'paw');
  if (departuresData.state === 'error') return section(title, '', '<p class="a-empty">離所紀錄讀不到</p>', 'paw');
  const list = departuresData.list;
  if (!list.length) return section(title, '狗從試算表移走後會記在這裡', '<p class="a-empty">還沒有離所紀錄</p>', 'paw');
  const { years, noDate } = departureYears(list);
  const thisYear = years.find(y => y.year === today.getFullYear()) || { total: 0, adopt: 0, death: 0 };
  return `<section class="a-card dep-card">
    <h2><span class="a-h-icon">${icon('paw')}</span>離所</h2>
    <p class="a-hint">從 2026 年 9 月開始記錄；原因看試算表「已出所」分頁${noDate ? `；${noDate} 隻日期不明，沒算進年份` : ''}</p>
    <p class="dep-line"><b>${today.getFullYear()} 年離所 ${thisYear.total} 隻</b>${thisYear.total ? `（${DEPARTURE_ORDER.filter(r => thisYear[r]).map(r => `${DEPARTURE_LABELS[r]} ${thisYear[r]}`).join('、')}）` : ''}</p>
    ${years.length > 1 ? stackedYears(years) : ''}
    <button type="button" class="dep-open" id="depToggle" aria-expanded="${depRoster.open}">${depRoster.open ? '收起離所名冊' : `看離所名冊（${list.length} 隻）`}</button>
    ${depRoster.open ? departureRosterHtml(years) : ''}
  </section>`;
}

// 名冊的搜尋、篩選只重畫清單，輸入框不會失去焦點
function refreshDepartureList() {
  const box = document.getElementById('depList');
  if (box && departuresData) box.innerHTML = departureListHtml();
}
document.getElementById('main').addEventListener('click', e => {
  if (!analysisOpen || !e.target.closest) return;
  if (e.target.closest('#depToggle')) { depRoster.open = !depRoster.open; render(); return; }
  const col = e.target.closest('[data-dep-year]');
  if (col) { depRoster = { ...depRoster, open: true, year: col.dataset.depYear }; render(); return; }
  const row = e.target.closest('[data-dep-dog]');
  const dog = row && departuresData && departuresData.list[row.dataset.depDog];
  if (dog) departureDetail(dog).then(full => { if (analysisOpen) showDetail(full); });
});
document.getElementById('main').addEventListener('input', e => {
  if (e.target.id === 'depSearch') { depRoster.query = e.target.value; refreshDepartureList(); }
});
document.getElementById('main').addEventListener('change', e => {
  if (e.target.id === 'depYear') { depRoster.year = e.target.value; refreshDepartureList(); }
  if (e.target.id === 'depReason') { depRoster.reason = e.target.value; refreshDepartureList(); }
});
// #273 分類狀態只跟著當前 history entry，不跨裝置儲存。
const INFO_PAGES = { stay: '在所統計', departures: '離所紀錄', quality: '資料檢查', updates: '更新紀錄' };
let infoPage = '';
let infoUpdateTab = 'website';
let websiteUpdates = null;

function loadWebsiteUpdates() {
  if (websiteUpdates) return;
  websiteUpdates = { state: 'loading', entries: [] };
  fetch('website-updates.json', { cache: 'no-cache' })
    .then(async res => {
      if (!res.ok) throw new Error('讀取失敗');
      const entries = await res.json();
      if (!Array.isArray(entries) || entries.some(e => !e || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || typeof e.text !== 'string')) throw new Error('格式不對');
      websiteUpdates = { state: 'ready', entries };
    })
    .catch(() => { websiteUpdates = { state: 'error', entries: [] }; })
    .then(() => { if (analysisOpen && infoPage === 'updates') render(); });
}

function infoHomeHtml() {
  loadDepartures();
  const dogs = loadState === 'ready' ? `目前在所 ${allDogs.length} 隻` : loadState === 'error' ? '在所資料讀取失敗' : '在所資料讀取中…';
  const dep = !departuresData || departuresData.state === 'loading' ? '離所紀錄讀取中…' : departuresData.state === 'error' ? '離所紀錄讀取失敗' : departuresData.list.length ? `共 ${departuresData.list.length} 筆離所紀錄` : '還沒有離所紀錄';
  const summary = { stay: dogs, departures: dep, quality: '查看缺照片、介紹及其他資料', updates: '網站更新與資料編輯' };
  return `<section class="a-card info-home" aria-label="資訊分類">${Object.entries(INFO_PAGES).map(([id, title]) => `<button type="button" data-info-page="${id}"><strong>${title}</strong><span>${esc(summary[id])}</span></button>`).join('')}</section>`;
}

function infoUpdatesHtml() {
  const tabs = `<div class="info-update-tabs" aria-label="更新紀錄種類"><button type="button" data-update-tab="website" aria-pressed="${infoUpdateTab === 'website'}">網站更新</button><button type="button" data-update-tab="edits" aria-pressed="${infoUpdateTab === 'edits'}">資料編輯</button></div>`;
  if (infoUpdateTab === 'edits') return tabs + '<iframe id="infoEdits" class="info-edits" title="資料編輯紀錄" src="edits.html?embedded=1" data-navigation-scope></iframe>';
  loadWebsiteUpdates();
  const data = websiteUpdates;
  const body = data.state === 'loading' ? '<p role="status">讀取中…</p>' : data.state === 'error' ? '<p role="alert">網站更新讀取失敗，請重試。</p><button type="button" id="retryUpdates">重新讀取</button>' : data.entries.length ? `<ol class="info-releases">${data.entries.map(e => `<li><time>${esc(e.date)}</time><p>${esc(e.text)}</p></li>`).join('')}</ol>` : '<p>還沒有網站更新紀錄</p>';
  return tabs + section('網站更新', '只列已正式上線的變更', body);
}

function openInfoPage(page) {
  if (!Object.hasOwn(INFO_PAGES, page)) return;
  history.replaceState({ ...history.state, infoPage: '' }, '');
  infoPage = page;
  history.pushState({ ...history.state, infoPage: page }, '');
  render();
  window.scrollTo(0, 0);
  document.getElementById('analysisBack').focus();
}

function restoreInfoPage(page) {
  const previous = infoPage;
  infoPage = Object.hasOwn(INFO_PAGES, page) ? page : '';
  render();
  if (!infoPage && previous) document.querySelector(`[data-info-page="${previous}"]`)?.focus();
}

document.getElementById('main').addEventListener('click', e => {
  const entry = e.target.closest('[data-info-page]');
  if (entry) openInfoPage(entry.dataset.infoPage);
  const tab = e.target.closest('[data-update-tab]');
  if (tab) {
    infoUpdateTab = tab.dataset.updateTab;
    render();
    document.querySelector(`[data-update-tab="${infoUpdateTab}"]`).focus();
  }
  if (e.target.closest('#retryUpdates')) { websiteUpdates = null; render(); }
});
