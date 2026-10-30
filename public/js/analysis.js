import { canShow, settingsNotice, shareUrl } from './feature-settings.js';
import { BQDates } from './dates.js';
import { apiData, computeStatus, photoSrc, photoThumb, render, sexMark, switchTab } from './app.js';
import { DEPARTURE_LABELS, renderDetail, showDetail } from './detail.js';
import { esc, icon, searchKey, ymdText } from './ui-kit.js';
import { activitiesState, analysisState, appState } from './page-state.js';
import { BQApi } from './api.js';
import { SITE } from './site-config.js';
import { activitySectionHtml, loadActivities } from './activities.js';
import { parseDogsData } from './dog-data.js';
import { backFrom, pushPage, replacePage } from './overlays.js';
import { shareSite } from './share.js';
import { BQWalkUI } from './walk-ui.js';
import { deskOn } from './desk.js';
import { pageHash, routeControl } from './routes.js';

// 分析頁（V5-4 #59、V5-5 #60）：目前 dogs.json 就能算的犬隻統計，加上 #56 累積的遛狗歷史與每日快照。
// 統計都寫成純函式（輸入狗清單與今天日期，輸出數字），tests/index.html 直接測；畫面只負責把結果畫成 CSS／SVG 資訊圖表（大數字、圓環、直條圖）。
// 頁首右上角的圖示打開（不佔分類：分類只放每天遛狗會用的）。
// 會用到 js/dates.js 的日期工具及 js/app.js 的 computeStatus、esc、icon、photoSrc、showDetail、allDogs、analysisOpen，透過具名 import 使用。

// 長期在所＝在所滿 1 年；近期少遛＝超過 AMBER_DAYS 天沒遛（沿用溜狗表的黃色門檻，2026-10-09 起 3 天）
const LONG_STAY_MONTHS = 12;
// 入所多久分布的區間（以滿幾個月算）：#739 K 定 3h，滿 0～9 年每年一格＋「10+」，固定 11 根
// （狗多半住到過世，年數只會變多；以後「10+」的狗變多再把最後一根往後拉，根數不變）
// label 是螢幕閱讀器念的完整說法，short 是長條下面的數字，head 是名單標題
const STAY_BUCKETS = [
  ...Array.from({ length: 10 }, (_, y) => ({ label: `滿 ${y} 年`, short: String(y), head: `滿 ${y} 年`, max: (y + 1) * 12 })),
  { label: '滿 10 年以上', short: '10+', head: '10 年以上', max: Infinity },
];
// 點長條列名單：先列幾隻，其他收進「看全部 N 隻」
const STAY_PICK_FIRST = 5;

// 入所日（ADR 0011）：編號、舊編號、出入所紀錄裡最早的那天（BQDates.firstIntake）；看不出來或在未來的回 null
function intakeDate(dog, today) {
  const d = BQDates.firstIntake(dog);
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

// 久的排前面（同一天入所的照犬名排，結果固定）
const byLongest = (a, b) => a.intake - b.intake || a.dog.name.localeCompare(b.dog.name, 'zh-Hant');

// 1. 入所多久分布：每格的隻數和狗（久的排前面，點長條列名單用）
function stayDistribution(rows) {
  const buckets = STAY_BUCKETS.map(b => ({ label: b.label, short: b.short, head: b.head, rows: [] }));
  for (const r of dated(rows).sort(byLongest)) buckets[STAY_BUCKETS.findIndex(b => r.stayMonths < b.max)].rows.push(r);
  return buckets.map(b => ({ ...b, count: b.rows.length }));
}

// 2. 在所最久 Top N
function longestStay(rows, n = 10) {
  return dated(rows).sort(byLongest).slice(0, n);
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
    { label: '沒有介紹', dogs: pick(r => !r.dog.intro) },
  ];
  if (hasPhoto) items.push({ label: '沒有照片', dogs: pick(r => !r.dog.id || hasPhoto.get(r.dog.id) === false) });
  return { total: rows.length, items };
}

// ── 照片檢查：用 HEAD 只問 photos/{編號}.jpg 在不在，不下載圖片；一次開網頁只查一遍 ──
analysisState.photoCheck = null; // null：還沒開始；{ done, map: Map(編號 → true/false) }
function checkPhotos(dogs) {
  if (analysisState.photoCheck) return;
  analysisState.photoCheck = { done: false, map: new Map() };
  const state = analysisState.photoCheck;
  const ids = [...new Set(dogs.map(d => d.id).filter(Boolean))];
  Promise.all(ids.map(id => fetch(photoSrc({ id }), { method: 'HEAD', cache: 'no-cache' })
    .then(res => state.map.set(id, res.ok ? true : res.status === 404 ? false : null), () => state.map.set(id, null))))
    .then(() => {
      state.done = true;
      if (appState.analysisOpen && analysisState.photoCheck === state) render();
    });
}

// ── 遛狗歷史（V5-5，#60）：讀溜狗紀錄（#260 起是 Worker 的 api/walks，從 D1 讀） ──
// 試算表每隻狗只記最後一次遛狗，所以歷史從第一份快照那天才開始累積；walks.json 在那之前的紀錄是建立時的「最後一次」，
// 只拿來當第一段間隔的起點，不算進次數。所有人的遛狗都算（不看 mine），畫面不出現志工名字。
// 溜狗紀錄經 BQApi.walks 讀（#58 我溜過也讀同一份）
const dogKey = d => d.id || `名:${d.name}`;

// 溜狗紀錄 → [{ key, id, name, date }]，日期不合理的略過
function parseWalks(data) {
  if (!data || !Array.isArray(data.walks)) return [];
  return data.walks.map(w => ({ id: String(w.id || ''), name: String(w.name || ''), date: BQDates.parseYmd(w.date) }))
    .filter(w => w.date && (w.id || w.name)).map(w => ({ ...w, key: dogKey(w) }));
}

// 開始記錄日（原本是第一份快照的日期，#260 起 api/walks 的 historyStart）→ [日期字串]；沒有或壞掉就是 []
function historyStartDates(data) {
  return data && BQDates.parseYmd(data.historyStart) ? [data.historyStart] : [];
}

// 開始累積的日期與目前累積幾天（含今天）
function historySpan(dates, today) {
  const start = dates.length ? BQDates.parseYmd(dates[0]) : null;
  const t = BQDates.makeDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
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
  const t = BQDates.makeDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
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
analysisState.historyData = null; // { state: 'loading'|'ready'|'error', walks, dates }
function loadHistory() {
  if (analysisState.historyData) return;
  const state = analysisState.historyData = { state: 'loading', walks: [], dates: [] };
  BQApi.walks().then(apiData).then(w => {
    state.walks = parseWalks(w);
    state.dates = historyStartDates(w);
    state.state = 'ready';
  }, () => { state.state = 'error'; }).then(() => {
    if (analysisState.historyData !== state) return;
    if (appState.detailDog) renderDetail();
    if (appState.analysisOpen) render();
  });
}

// ── 畫面（資訊圖表風格：大數字、圓環、直條圖；顏色只用 css/app.css 的色票）──

function yearsText(days) {
  return (days / 365.25).toFixed(1);
}

// 狗那一列右邊的在所年數（Top 10、點長條的名單共用）
const stayYears = r => `<b>${yearsText(r.stayDays)}</b><small> 年</small>`;

// 直條圖（入所多久分布，#739）：整欄（上方數字、長條、下方標籤）是一顆按鈕，點了在下面列那一格的狗；
// 數字和標籤對螢幕閱讀器隱藏、按鈕名稱念完整句，免得念兩次；0 隻的不能選。sel 是選中的那根
function columnChart(items, sel = -1) {
  const max = Math.max(1, ...items.map(it => it.count));
  return `<div class="a-cols a-stay${sel >= 0 ? ' picked' : ''}" style="--n:${items.length}">${items.map((it, i) => `
    <button type="button" class="a-col${i === sel ? ' on' : ''}" data-stay-bucket="${i}" aria-pressed="${i === sel}" aria-label="${esc(it.label)}，${it.count} 隻"${it.count ? '' : ' disabled'}>
      <span class="a-col-v" aria-hidden="true">${it.count}</span>
      <span class="a-col-bar" style="height:${it.count ? Math.max(3, it.count / max * 100) : 0}%"></span>
      <span class="a-col-l" aria-hidden="true">${esc(it.short)}</span>
    </button>`).join('')}</div>`;
}

// 點長條列的名單（3e）：同一張白卡、細線加指向長條的小箭頭；先列 STAY_PICK_FIRST 隻，一隻一行（狗名、籠位、年數）
function stayPickHtml(dist, pick) {
  const b = dist[pick.bucket];
  const shown = pick.all ? b.rows : b.rows.slice(0, STAY_PICK_FIRST);
  return `<div class="a-pick" style="--at:${pick.bucket};--n:${dist.length}">
    <h3><b>${esc(b.head)}</b> <span>${b.count} 隻 · 久的排前面</span></h3>
    <div class="a-list">${shown.map(r => dogRow(r, stayYears(r), { line: true })).join('')}</div>
    <div class="a-pick-foot">${shown.length < b.count ? `<button type="button" class="a-link" data-stay-all>看全部 ${b.count} 隻</button>` : ''}<button type="button" class="a-link" data-stay-close>收起</button></div>
  </div>`;
}

// 狗的一列：點了開詳細資訊（data-adog 是 allDogs 的索引）；line 是一行版（不寫入所日，點長條的名單用）
function dogRow(r, right, { rank, line } = {}) {
  return `<button type="button" class="a-dog${line ? ' a-dog-line' : ''}" data-adog="${appState.allDogs.indexOf(r.dog)}">
    ${rank ? `<span class="a-rank r${rank}">${rank}</span>` : ''}
    <span class="a-dog-name">${esc(r.dog.name)}</span>
    <span class="a-dog-meta">${esc(r.dog.cage || '')}${r.intake && !line ? `｜${r.intake.getFullYear()}/${r.intake.getMonth() + 1}/${r.intake.getDate()} 入所` : ''}</span>
    <span class="a-dog-right">${right}</span>
  </button>`;
}

function section(title, hint, body, iconId, cls = '') {
  return `<section class="a-card${cls ? ` ${cls}` : ''}"><h2>${iconId ? `<span class="a-h-icon">${icon(iconId)}</span>` : ''}${esc(title)}</h2>${hint ? `<p class="a-hint">${hint}</p>` : ''}${body}</section>`;
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
  const avgStay = average(rows.filter(r => r.intake).map(r => r.stayDays));
  // 電腦版（K 2026-10-29）：同樣的區塊排成兩欄；看不出入所日期的狗名收起來，Top 10 改成表格
  const wide = deskOn();
  const out = [];

  // 最上面三格大數字（V7 #114 白底；2026-10-08 拿掉「在所滿 1 年 %」，下面圓環已經有）
  out.push(`<section class="a-hero">
    <div class="a-hero-title">${esc(SITE.shelterShort)}在所的狗</div>
    <div class="a-kpis">
      ${kpi(rows.length, '隻', '目前在所')}
      ${kpi(avgStay == null ? '–' : yearsText(avgStay), '年', '平均在所')}
    </div>
    <div class="a-hero-note">入所日期取編號（含舊編號）前 8 碼和出入所紀錄裡最早的那天${noIntake.length && !wide ? `；${noIntake.length} 隻編號看不出入所日期，不列入時間統計（${dogNames(noIntake.map(r => r.dog))}）` : ''}</div>
    ${noIntake.length && wide ? `<details class="a-noin"><summary>${noIntake.length} 隻編號看不出入所日期，不列入時間統計<span class="a-noin-more"></span></summary><p>${dogNames(noIntake.map(r => r.dog))}</p></details>` : ''}
  </section>`);

  // #739 點長條在下面同一張白卡列那一格的狗（analysisState.stayPick：{ bucket, all }，換子頁時清掉）
  const dist = stayDistribution(rows);
  const pick = analysisState.stayPick && dist[analysisState.stayPick.bucket]?.count ? analysisState.stayPick : null;
  out.push(section('入所多久分布', '點長條看是哪些狗',
    columnChart(dist, pick ? pick.bucket : -1) + '<p class="a-unit">單位：滿幾年（0＝未滿 1 年）</p>' +
    (pick ? stayPickHtml(dist, pick) : ''), '', 'a-dist'));

  const top = longestStay(rows);
  out.push(section('在所最久 Top 10', '點狗名看詳細資訊',
    wide ? topTableHtml(top) : `<div class="a-list">${top.map((r, i) => dogRow(r, stayYears(r), { rank: i + 1 })).join('')}</div>`, '', 'a-top'));

  const zones = zoneAverages(rows);
  const zMax = Math.max(1, ...zones.map(z => z.avgDays));
  out.push(section('各區平均在所時間', '區＝籠位去掉數字',
    `<div class="a-hbars">${zones.map(z => `
      <div class="a-hbar" title="${esc(z.zone)}：平均 ${formatStay(Math.round(z.avgDays))}，${z.count} 隻">
        <span class="a-hbar-l">${esc(z.zone)}</span>
        <span class="a-hbar-track"><span class="a-hbar-fill" style="width:${Math.max(8, z.avgDays / zMax * 100)}%"><b>${yearsText(z.avgDays)} 年</b></span></span>
        <span class="a-hbar-n">${z.count} 隻</span>
      </div>`).join('')}</div>`));

  const sex = sexComparison(rows);
  const known = sex.male.count + sex.female.count;
  const mPct = known ? sex.male.count / known * 100 : 50;
  // 2026-10-08 distill：兩張數字卡改成一行平均（中位數、滿 1 年隻數拿掉）
  // ♂♀ 用 sexMark 的內嵌圖示，不寫文字符號：iPhone 內建字型沒有 ♂♀，會換字型而下沉（#93）
  const sexAvg = (mark, g) => `${sexMark({ sex: mark })} ${g.count ? `<b>${yearsText(g.avgDays)}</b> 年` : '沒有資料'}`;
  out.push(section('公母在所時間差異', `只算有性別資料的狗；${sex.missing} 隻沒有性別資料`,
    `<div class="a-split" title="公 ${sex.male.count} 隻、母 ${sex.female.count} 隻">
       <span class="male" style="width:${mPct}%">${sexMark({ sex: '♂' })}${sex.male.count}</span><span class="female" style="width:${100 - mPct}%">${sexMark({ sex: '♀' })}${sex.female.count}</span>
     </div>
     <p class="a-sex-line">平均在所　${sexAvg('♂', sex.male)}　${sexAvg('♀', sex.female)}</p>`));

  return wide ? `<div class="a-wide">${out.join('')}</div>` : out.join('');
}

// 電腦版 Top 10：名次、狗名、籠位、入所日、在所年數各一欄；狗名是按鈕，點了開詳細資訊
function topTableHtml(top) {
  return `<table class="a-table">
    <thead><tr><th scope="col">名次</th><th scope="col">狗名</th><th scope="col">籠位</th><th scope="col">入所</th><th scope="col" class="num">在所</th></tr></thead>
    <tbody>${top.map((r, i) => `<tr>
      <td><span class="a-rank r${i + 1}">${i + 1}</span></td>
      <td><button type="button" class="a-t-dog" data-adog="${appState.allDogs.indexOf(r.dog)}">${esc(r.dog.name)}</button></td>
      <td>${esc(r.dog.cage || '')}</td>
      <td>${r.intake.getFullYear()}/${r.intake.getMonth() + 1}/${r.intake.getDate()}</td>
      <td class="num">${stayYears(r)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function dataChecksHtml(rows) {
  const photosDone = analysisState.photoCheck && analysisState.photoCheck.done;
  const comp = dataCompleteness(rows, photosDone ? analysisState.photoCheck.map : null);
  const compRows = comp.items.map(it => it.dogs.length
    ? `<details class="a-miss"><summary><span>${esc(it.label)}</span><b>${it.dogs.length} 隻</b></summary><p>${dogNames(it.dogs)}</p></details>`
    : `<div class="a-miss ok"><span>${esc(it.label)}</span><b>0 隻</b></div>`).join('');
  // 2026-10-08 distill：拿掉跟下面清單重複的圓環
  return section('狗的資料完整度', `共 ${comp.total} 隻；點項目看缺哪幾隻`,
    compRows +
    (photosDone ? ([...analysisState.photoCheck.map.values()].some(v => v === null) ? '<p role="alert">部分照片讀取失敗，未列入缺照片名單；請確認網路後重新整理。</p>' : '') : '<div class="a-miss"><span>沒有照片</span><b class="muted">檢查中…</b></div>'), 'note');
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
  if (!analysisState.historyData || analysisState.historyData.state === 'loading') return wrap('<div class="empty">讀取中…</div>');
  if (analysisState.historyData.state === 'error') return wrap('<div class="empty">溜狗紀錄讀不到</div>');
  const { start } = historySpan(analysisState.historyData.dates, today);
  const h = dogWalkHistory(dog, analysisState.historyData.walks, start, today);
  const first = h.cells[0].date, last = h.cells[h.cells.length - 1].date;
  const cell = c => `<span class="${c.walked ? 'on' : c.recorded ? 'off' : 'none'}" title="${mdText(c.date)}${c.walked ? ' 有溜' : c.recorded ? ' 沒溜' : ' 還沒開始記錄'}"></span>`;
  // critique 2026-10-09 少一點格子：三格統計卡改成一行字；沒有間隔可算（不到兩次）就不寫平均、最久
  const sum = [`最近 30 天溜 <b>${h.count}</b> 次`];
  if (h.avgGap != null) sum.push(`平均 <b>${h.avgGap.toFixed(1)}</b> 天溜一次`);
  if (h.maxGap === 'over') sum.push('最久 <b>超過 62</b> 天沒溜');
  else if (h.maxGap != null) sum.push(`最久 <b>${h.maxGap}</b> 天沒溜`);
  const open = typeof appState.detailWalksOpen !== 'undefined' && appState.detailWalksOpen;
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
  if (deskOn()) return infoDeskHtml(today);
  if (!canShow(analysisState.infoPage)) return `<p role="status">${settingsNotice()}</p>`;
  if (!analysisState.infoPage) return infoHomeHtml();
  return infoSubPageHtml(today, analysisState.infoPage);
}
function infoSubPageHtml(today, page) {
  if (page === 'departures') return departureSectionHtml(today);
  if (page === 'activities') return activitySectionHtml();
  if (page === 'updates') return infoUpdatesHtml();
  if (appState.loadState === 'ready') return analysisHtml(appState.allDogs, today, page);
  return `<div class="status-msg">${appState.loadState === 'error' ? '狗的資料讀不到，請確認網路後重新整理。' : '讀取中…'}</div>`;
}

// 電腦版資訊（K 2026-10-29）：設定頁式，左邊子頁清單、右邊內容；頁首每頁一樣，不需要「回資訊」。
// 還沒選子頁（剛進資訊）就打開第一個，不先出一頁大卡片；手機照舊是分類清單（infoHomeHtml）＋頁首的「回資訊」
function infoDeskPage() {
  return analysisState.infoPage || Object.keys(INFO_PAGES).find(id => canShow(id)) || '';
}
// 資訊整頁畫進內容區。電腦版左邊清單跟內容一起重畫（資料讀完、背景更新），焦點原本在清單上就放回同一項
function renderInfoPage(main, today) {
  const nav = document.activeElement?.closest?.('#main .info-nav :is(a, button)');
  const key = nav && (nav.dataset.infoPage ? `[data-info-page="${nav.dataset.infoPage}"]` : nav.matches('[data-games]') ? '[data-games]' : '[data-open-guide]');
  main.innerHTML = analysisPageHtml(today);
  if (key) main.querySelector(`.info-nav ${key}`)?.focus({ preventScroll: true });
}
function infoDeskHtml(today) {
  const page = infoDeskPage();
  const nav = Object.entries(INFO_PAGES).filter(([id]) => canShow(id))
    .map(([id, title]) => routeControl(true, pageHash('info', id), `data-info-page="${id}"${id === page ? ' aria-current="page"' : ''}`, title)).join(''); // 電腦版子頁清單是真連結（ADR 0024）
  const body = page && canShow(page) ? `<h2 class="info-title">${esc(INFO_PAGES[page])}</h2>${infoSubPageHtml(today, page)}` : `<p role="status">${settingsNotice()}</p>`;
  return `<div class="info-desk"><nav class="info-nav" aria-label="資訊分類">${nav}${gamesLink(false)}<button type="button" data-open-guide>使用說明</button></nav><div class="info-body">${body}</div></div>`;
}

// 打開分析頁：手機按「返回」會回到原本的分類（跟詳細資訊一樣用 history）
function showAnalysis() {
  if (appState.analysisOpen) return;
  switchTab('info');
}

function hideAnalysis() {
  if (!appState.analysisOpen) return;
  switchTab(appState.activeTab, false);
}

function closeAnalysis() {
  backFrom(s => s && (s.bqAnalysis || s.bqNavigation), hideAnalysis);
}

const analysisBtn = document.getElementById('analysisBtn');

// 分析頁的狗名列：點了開詳細資訊（事件委派，renderMain 重畫也不用重綁）
const analysisBack = document.getElementById('analysisBack');

// ── 離所（#163 年度統計、#164 離所名冊）──
// 離所紀錄（api/departures，存在 D1）由 Worker 收狗清單時產生（worker/src/dog-list.js）：狗從主清單消失就記一筆，
// 原因只讀試算表「已出所」分頁判讀，判不出來是待確認。打開分析頁才讀，不拖慢溜狗表。
// #363 ADR 0014：長條圖、名冊搜尋（全部年份）用名冊索引（每隻只有編號、狗名、舊編號、出所日、原因）；
// 點一隻狗才拿那一年的詳細資料（最後籠位、介紹、旗標、出入所），網址帶版本號，瀏覽器快取
// 名冊索引是 api/departures/index；每年詳細是 api/departures?year=YYYY|none&v=版本號，形狀跟原本的 data/departures.json 一樣（BQApi）
const DEPARTURE_ORDER = ['adopt', 'death', 'other', 'unknown'];
const DEPARTURE_COLORS = { adopt: 'var(--green-text)', death: '#8E8E93', other: 'var(--primary)', unknown: '#F0A030' };
analysisState.departuresData = null; // { state: 'loading' | 'ready' | 'error', list, years: { 年: 版本號 } }
const departureDetails = new Map(); // 年 → Promise<Map<編號, 離所的狗（詳細）>>
// #446 離所統計是專屬頁面，名冊預設展開（仍可收起）
const depRosterDefault = () => ({ open: true, query: '', year: 'all', reason: 'all' });

// departures.json（或名冊索引的 dogs）→ 離所的狗：跟在所的狗同一個樣子（parseDogsData），多一個 departure；
// 索引沒有 last，舊編號放在 formerIds
analysisState.depRoster = depRosterDefault();
function parseDeparturesData(data) {
  const entries = data && (Array.isArray(data.departures) ? data.departures : data.dogs);
  if (!Array.isArray(entries)) throw new Error('departures.json 格式不對');
  const text = v => (v == null ? '' : String(v).trim());
  return entries.filter(e => e && text(e.id) && text(e.name)).map(e => {
    const last = e.last && typeof e.last === 'object' ? e.last : { formerIds: e.formerIds };
    const dog = parseDogsData({ dogs: [{ ...last, editRevision:e.editRevision, sex:e.sex||'', id: text(e.id), name: text(last.name) || text(e.name), stays: e.stays }] }).dogs[0];
    if(e.photoVersion){appState.photoVersions['photos/'+dog.id+'.jpg']=e.photoVersion;appState.photoVersions['photos/thumbs/'+dog.id+'.jpg']=e.photoVersion;}
    dog.depYear = text(e.date).slice(0, 4) || 'none';
    dog.departure = {
      reason: DEPARTURE_ORDER.includes(e.reason) ? e.reason : 'unknown',
      matched: text(e.matched),
      date: BQDates.parseYmd(e.date),
      dateSource: text(e.dateSource),
      flags: Array.isArray(e.flags) ? e.flags.map(text) : [],
      returned: text(e.returned),
    };
    return dog;
  });
}

function loadDepartures() {
  if (analysisState.departuresData) return;
  analysisState.departuresData = { state: 'loading', list: [] };
  BQApi.departures()
    .then(apiData)
    .then(data => { analysisState.departuresData = { state: 'ready', list: parseDeparturesData(data), years: (data && data.years) || {} }; })
    .catch(() => { analysisState.departuresData = { state: 'error', list: [] }; })
    .then(() => { if (appState.analysisOpen) render(); });
}

// 名冊點一隻狗：拿那一年的詳細資料再開；拿不到就用索引那一筆開（只少了籠位、介紹等）
function departureDetail(dog) {
  const year = dog.depYear;
  if (!departureDetails.has(year)) {
    const ver = (analysisState.departuresData && analysisState.departuresData.years[year]) || '';
    departureDetails.set(year, BQApi.departureYear(year, ver)
      .then(apiData)
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
    <button type="button" class="a-col dep-col${String(analysisState.depRoster.year) === String(y.year) && analysisState.depRoster.open ? ' hi' : ''}" data-dep-year="${y.year}"
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
  return `<button type="button" class="a-dog dep-row" data-dep-dog="${analysisState.departuresData.list.indexOf(d)}">
    ${photoThumb(d, 40)}
    <span class="a-dog-name">${esc(d.name)}${dep.returned ? '<small class="dep-back">已再入所</small>' : ''}</span>
    <span class="a-dog-meta">${esc(ymdText(dep.date))}${dep.dateSource === 'seen' ? '（推估）' : ''}｜${esc(d.id)}</span>
    <span class="a-dog-right"><span class="badge dep-${dep.reason}">${esc(DEPARTURE_LABELS[dep.reason])}</span></span>
  </button>`;
}

function departureListHtml() {
  const rows = filterDepartures(analysisState.departuresData.list, analysisState.depRoster);
  return rows.length ? rows.map(departureRow).join('') : '<p class="a-empty">沒有符合的狗</p>';
}

function departureRosterHtml(years) {
  const opt = (v, label, cur) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${label}</option>`;
  return `<div class="dep-roster">
    <div class="dep-filters">
      <input type="search" id="depSearch" class="dep-search" placeholder="狗名或編號" value="${esc(analysisState.depRoster.query)}" autocomplete="off" aria-label="搜尋離所的狗">
      <select id="depYear" aria-label="年份">${opt('all', '全部年份', analysisState.depRoster.year)}${[...years].reverse().map(y => opt(y.year, `${y.year}`, analysisState.depRoster.year)).join('')}</select>
      <select id="depReason" aria-label="原因">${opt('all', '全部原因', analysisState.depRoster.reason)}${DEPARTURE_ORDER.map(r => opt(r, DEPARTURE_LABELS[r], analysisState.depRoster.reason)).join('')}</select>
    </div>
    <div class="a-list" id="depList">${departureListHtml()}</div>
  </div>`;
}

function departureSectionHtml(today) {
  loadDepartures();
  const title = '離所';
  if (analysisState.departuresData.state === 'loading') return section(title, '', '<p class="a-empty">讀取中…</p>', 'paw');
  if (analysisState.departuresData.state === 'error') return section(title, '', '<p class="a-empty">離所紀錄讀不到</p>', 'paw');
  const list = analysisState.departuresData.list;
  if (!list.length) return section(title, '狗從試算表移走後會記在這裡', '<p class="a-empty">還沒有離所紀錄</p>', 'paw');
  const { years, noDate } = departureYears(list);
  const thisYear = years.find(y => y.year === today.getFullYear()) || { total: 0, adopt: 0, death: 0 };
  return `<section class="a-card dep-card">
    <h2><span class="a-h-icon">${icon('paw')}</span>離所</h2>
    <p class="a-hint">從 2026 年 9 月開始記錄；原因看試算表「已出所」分頁${noDate ? `；${noDate} 隻日期不明，沒算進年份` : ''}</p>
    <p class="dep-line"><b>${today.getFullYear()} 年離所 ${thisYear.total} 隻</b>${thisYear.total ? `（${DEPARTURE_ORDER.filter(r => thisYear[r]).map(r => `${DEPARTURE_LABELS[r]} ${thisYear[r]}`).join('、')}）` : ''}</p>
    ${years.length > 1 ? stackedYears(years) : ''}
    <button type="button" class="dep-open" id="depToggle" aria-expanded="${analysisState.depRoster.open}">${analysisState.depRoster.open ? '收起離所名冊' : `看離所名冊（${list.length} 隻）`}</button>
    ${analysisState.depRoster.open ? departureRosterHtml(years) : ''}
  </section>`;
}

// 名冊的搜尋、篩選只重畫清單，輸入框不會失去焦點
function refreshDepartureList() {
  const box = document.getElementById('depList');
  if (box && analysisState.departuresData) box.innerHTML = departureListHtml();
}

// #273 分類狀態只跟著當前 history entry，不跨裝置儲存。
const INFO_PAGES = { stay: '在所統計', departures: '離所紀錄', activities: '活動紀錄', quality: '資料檢查', updates: '更新紀錄' };

analysisState.infoPage = '';

// #447 使用說明從我溜過搬來：不是子頁，按了直接開溜狗表上的導覽（文字沿用 #171 的 TOUR_STEPS）
function infoHomeHtml() {
  loadDepartures();
  loadActivities();
  const dogs = appState.loadState === 'ready' ? `目前在所 ${appState.allDogs.length} 隻` : appState.loadState === 'error' ? '在所資料讀取失敗' : '在所資料讀取中…';
  const dep = !analysisState.departuresData || analysisState.departuresData.state === 'loading' ? '離所紀錄讀取中…' : analysisState.departuresData.state === 'error' ? '離所紀錄讀取失敗' : analysisState.departuresData.list.length ? `共 ${analysisState.departuresData.list.length} 筆離所紀錄` : '還沒有離所紀錄';
  const act = activitiesState.activitiesData.state === 'loading' ? '活動紀錄讀取中…' : activitiesState.activitiesData.state === 'error' ? '活動紀錄讀取失敗' : activitiesState.activitiesData.list.length ? `共 ${activitiesState.activitiesData.list.length} 場活動` : '還沒有活動紀錄';
  const summary = { stay: dogs, departures: dep, activities: act, quality: '查看缺照片、介紹及其他資料', updates: '誰、什麼時候改了哪些資料' };
  return `<section class="a-card info-home" aria-label="資訊分類">${Object.entries(INFO_PAGES).filter(([id]) => canShow(id)).map(([id, title]) => routeControl(deskOn(), pageHash('info', id), `data-info-page="${id}"`, `<strong>${title}</strong><span>${esc(summary[id])}</span>`)).join('')}${gamesLink(true)}${shareSiteHtml()}<button type="button" data-open-guide><strong>使用說明</strong><span>回到溜狗表，從第一步再看一次</span></button></section>`;
}

// #795 小遊戲：不是資訊子頁，是另一頁（games.html）。跟其他入口一樣，電腦版是真連結、手機是按鈕（ADR 0024）
function gamesLink(withSummary) {
  return routeControl(deskOn(), 'games.html', 'data-games', withSummary ? '<strong>小遊戲</strong><span>認認看變裝後的狗是誰，更多遊戲準備中</span>' : '小遊戲');
}

// ADR 0023 分享網站：只在手機版（電腦版由 CSS 藏起來）；分享和複製都不行時把網址放進可選取的欄位
function shareSiteHtml() {
  const url = shareUrl();
  if (!url || !canShow('share')) return '';
  const manual = analysisState.shareManual ? `<label class="share-manual"><span>長按下面的網址複製</span><input type="text" readonly value="${esc(url)}" data-share-url></label>` : '';
  return `<div class="share-site"><button type="button" data-share-site><strong>分享網站連結</strong><span>把網站傳到 LINE 或其他 App</span></button>${manual}</div>`;
}

let sharing = false;
async function shareFromInfo() {
  // 分享選單還開著時再按一次，瀏覽器會拒絕、變成複製；等上一次結束
  if (sharing) return;
  sharing = true;
  const result = await shareSite(shareUrl(), navigator).finally(() => { sharing = false; });
  // 只記成功的分享和複製；記不下來不打擾志工
  if (result === 'share' || result === 'copy') BQApi.countShare(result);
  if (result === 'copy') BQWalkUI.showToast('已複製，貼給其他志工就好');
  if (result !== 'manual') return;
  analysisState.shareManual = true;
  render();
  document.querySelector('[data-share-url]')?.select();
}

// K 2026-10-28：拿掉人工寫的網站更新，更新紀錄只剩資料編輯（網站版本改在管理網站看 GitHub Releases）
function infoUpdatesHtml() {
  return '<iframe id="infoEdits" class="info-edits" title="資料編輯紀錄" src="edits.html?embedded=1" data-navigation-scope></iframe>';
}

function openInfoPage(page) {
  if (!Object.hasOwn(INFO_PAGES, page) || (deskOn() && page === infoDeskPage())) return;
  // 手機從分類清單進子頁；電腦版從另一個子頁換過來，返回要回到那個子頁。
  // infoChain：這一筆是電腦版換子頁留下的，上一筆是另一個子頁、不是分類清單（infoBack 用）
  const desk = deskOn();
  // 直接打開 #info/<子頁> 時目前這筆還不是頁籤紀錄（ADR 0024 的 landing）：補成資訊頁籤，返回才會換回子頁、不會關掉資訊
  const current = { bqNavigation: true, tab: 'info', base: appState.activeTab, ...history.state, infoPage: desk ? analysisState.infoPage : '', infoChain: desk && !!history.state?.infoChain };
  analysisState.infoPage = page;
  analysisState.stayPick = null;
  pushPage(current, { ...current, infoPage: page, infoChain: desk });
  render();
  window.scrollTo(0, 0);
  // 手機焦點到頁首的「回資訊」；電腦版沒有回資訊，留在左邊清單剛按的那一項
  (deskOn() ? document.querySelector(`#main [data-info-page="${page}"]`) : document.getElementById('analysisBack'))?.focus();
}

function restoreInfoPage(page) {
  const previous = analysisState.infoPage;
  analysisState.infoPage = Object.hasOwn(INFO_PAGES, page) ? page : '';
  render();
  // 電腦版回到預設的第一個子頁，焦點放在清單上目前那一項
  if (!analysisState.infoPage && previous) document.querySelector(deskOn() ? '#main [data-info-page][aria-current]' : `[data-info-page="${previous}"]`)?.focus();
}

export { LONG_STAY_MONTHS, STAY_BUCKETS, intakeDate, monthsBetween, daysBetween, analysisRows, zoneOf, formatStay, average, median, dated, stayDistribution, longestStay, zoneAverages, longStayShare, sexComparison, dataCompleteness, checkPhotos, dogKey, parseWalks, historyStartDates, historySpan, recentStart, dogWalkHistory, loadHistory, STAY_PICK_FIRST, yearsText, columnChart, stayPickHtml, dogRow, section, dogNames, kpi, analysisHtml, dataChecksHtml, mdText, walkHistorySection, analysisPageHtml, showAnalysis, hideAnalysis, closeAnalysis, analysisBtn, analysisBack, DEPARTURE_ORDER, DEPARTURE_COLORS, departureDetails, depRosterDefault, parseDeparturesData, loadDepartures, departureDetail, departureYears, filterDepartures, stackedYears, departureRow, departureListHtml, departureRosterHtml, departureSectionHtml, refreshDepartureList, INFO_PAGES, infoDeskPage, renderInfoPage, infoDeskHtml, topTableHtml, infoHomeHtml, shareFromInfo, infoUpdatesHtml, openInfoPage, restoreInfoPage };
export { analysisState } from './page-state.js';

// 頁首「回資訊／回溜狗表」：子頁回資訊首頁、資訊首頁回原本的分頁、常溜狗群回進來前的分頁
function infoBack() {
  if (appState.analysisOpen && analysisState.infoPage) {
    // 電腦版換子頁留下的紀錄（iPad 橫放換過子頁再轉直）：上一筆是另一個子頁，直接回分類清單
    if (history.state?.infoChain) {
      replacePage({ ...history.state, infoPage: '', infoChain: false });
      restoreInfoPage('');
    } else backFrom(s => s?.infoPage, () => restoreInfoPage(''));
  } else if (appState.analysisOpen) closeAnalysis();
  else if (appState.activeTab === 'groups') {
    backFrom(s => s && s.bqNavigation, () => switchTab(appState.groupsReturnTab, false));
  }
}

export function bindAnalysis() {
  if (analysisBtn) analysisBtn.addEventListener('click', () => (appState.analysisOpen ? closeAnalysis() : showAnalysis()));
  if (analysisBack) analysisBack.addEventListener('click', infoBack);
  // #739 入所多久分布：點長條列名單、再點同一根或「收起」收回；重畫後焦點留在剛按的地方
  document.getElementById('main').addEventListener('click', e => {
    if (!appState.analysisOpen || !e.target.closest) return;
    const bar = e.target.closest('[data-stay-bucket]');
    const all = e.target.closest('[data-stay-all]');
    const close = e.target.closest('[data-stay-close]');
    if (!bar && !all && !close) return;
    const current = analysisState.stayPick;
    const bucket = bar ? Number(bar.dataset.stayBucket) : current?.bucket;
    if (bar) analysisState.stayPick = current?.bucket === bucket ? null : { bucket, all: false };
    else if (all) analysisState.stayPick = { ...current, all: true };
    else analysisState.stayPick = null;
    render();
    const target = all ? document.querySelectorAll('#main .a-pick .a-dog')[STAY_PICK_FIRST] : document.querySelector(`#main [data-stay-bucket="${bucket}"]`);
    target?.focus();
  });
  document.getElementById('main').addEventListener('click', e => {
    const row = e.target.closest('#main [data-adog]');
    const dog = row && appState.allDogs[row.dataset.adog];
    if (dog) showDetail(dog);
  });

  document.getElementById('main').addEventListener('click', e => {
    if (!appState.analysisOpen || !e.target.closest) return;
    if (e.target.closest('#depToggle')) { analysisState.depRoster.open = !analysisState.depRoster.open; render(); return; }
    const col = e.target.closest('[data-dep-year]');
    if (col) { analysisState.depRoster = { ...analysisState.depRoster, open: true, year: col.dataset.depYear }; render(); return; }
    const row = e.target.closest('[data-dep-dog]');
    const dog = row && analysisState.departuresData && analysisState.departuresData.list[row.dataset.depDog];
    if (dog) departureDetail(dog).then(full => { if (appState.analysisOpen) showDetail(full); });
  });
  document.getElementById('main').addEventListener('input', e => {
    if (e.target.id === 'depSearch') { analysisState.depRoster.query = e.target.value; refreshDepartureList(); }
  });
  document.getElementById('main').addEventListener('change', e => {
    if (e.target.id === 'depYear') { analysisState.depRoster.year = e.target.value; refreshDepartureList(); }
    if (e.target.id === 'depReason') { analysisState.depRoster.reason = e.target.value; refreshDepartureList(); }
  });

  document.getElementById('main').addEventListener('click', e => {
    const entry = e.target.closest('[data-info-page]');
    if (entry) openInfoPage(entry.dataset.infoPage);
  });
}
