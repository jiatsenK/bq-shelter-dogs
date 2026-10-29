import { appState } from './page-state.js';
import { currentMyWalks, dogOfWalk, loadWalkerName, myCalendarState, myVisitCard, myWalkGroups, photoThumb, walkYears } from './app.js';
import { BQDates } from './dates.js';
import { BQWelcome } from './welcome.js';
import { esc, icon, pad2 } from './ui-kit.js';

// 電腦版我溜過（critique 2026-10-28，K 2026-10-29 解除「其他分頁 480 單欄」）：寬螢幕時月曆撐寬、每格寫當天溜的狗名，
// 右欄 300px 放選中那天的明細和這個月的統計；名字列變成頁面標題列。手機照舊是 js/app.js 的 myWalksHtml。
// 統計在右欄一直看得到，電腦版不放「統計」開關。紀錄只有日期、沒有時間，明細不寫幾點。

const DAY_NAMES = 2; // 月曆一格最多寫幾個狗名，多的寫「＋N」

// 標題列：名字＋修改（沒記名字的舊設定照手機請他按修改再輸入一次）；還沒設定是誰時只寫「我溜過」
function deskMineHead(setup = false) {
  const name = setup ? '' : loadWalkerName();
  return `<div class="mine-head">
    <h2 class="mine-who">${name ? `${esc(name)}<span class="sr-only">溜過的紀錄</span>` : '我溜過'}</h2>
    ${setup ? '' : `${name ? '' : '<span class="mine-ask">再按「修改」輸入一次名字</span>'}<button type="button" class="who-edit" id="whoEdit">修改</button>`}
  </div>`;
}

// 月曆：格子寫當天溜的狗名，點了右欄換成那天
function deskMineCalendar(cal, today) {
  const { month, first, nowMonth, inMonth, day } = cal;
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const byDay = new Map(inMonth.map(g => [g.ymd, g]));
  const lead = new Date(y, m - 1, 1).getDay(), total = new Date(y, m, 0).getDate();
  const todayKey = BQDates.localDateKey(today);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="mc-cell blank"></span>');
  for (let d = 1; d <= total; d++) {
    const key = `${month}-${pad2(d)}`;
    const g = byDay.get(key);
    const isToday = key === todayKey;
    const cls = `mc-cell${g ? ' on' : ''}${key === day ? ' sel' : ''}${isToday ? ' today' : ''}`;
    if (!g) {
      cells.push(`<span class="${cls}"${isToday ? ' aria-current="date"' : ''}><b>${d}</b>${isToday ? '<span class="mc-today">今天</span>' : ''}</span>`);
      continue;
    }
    const names = g.walks.map(w => w.name);
    const more = names.length - DAY_NAMES;
    // 第 DAY_NAMES 個名字以後收成「＋N」
    cells.push(`<button type="button" class="${cls}" data-mine-day="${key}" aria-pressed="${key === day}"${isToday ? ' aria-current="date"' : ''} aria-label="${isToday ? '今天，' : ''}${m}月${d}日，溜 ${names.length} 隻：${esc(names.join('、'))}">
      <b>${d}</b>${isToday ? '<span class="mc-today" aria-hidden="true">今天</span>' : ''}
      <span class="mc-names" aria-hidden="true">${names.slice(0, DAY_NAMES).map(n => `<i>${esc(n)}</i>`).join('')}${more > 0 ? `<i class="more">＋${more}</i>` : ''}</span>
    </button>`);
  }
  const shift = n => { const t = new Date(y, m - 1 + n, 1); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}`; };
  const state = walkYears[y] === 'loading' ? '讀取中…' : walkYears[y] === 'error' ? '這一年的紀錄讀不到' : inMonth.length ? '' : '這個月還沒有紀錄';
  return `<section class="mine-cal" aria-label="${y} 年 ${m} 月的溜狗月曆">
    <div class="mc-head">
      <h3 class="mc-title">${y} 年 ${m} 月${state ? `<span>${state}</span>` : ''}</h3>
      <button type="button" class="mc-nav" data-mine-month="${shift(-1)}" aria-label="上個月"${month <= first ? ' disabled' : ''}>${icon('back')}</button>
      <button type="button" class="mc-nav next" data-mine-month="${shift(1)}" aria-label="下個月"${month >= nowMonth ? ' disabled' : ''}>${icon('back')}</button>
    </div>
    <div class="mc-week" aria-hidden="true">${[...'日一二三四五六'].map(w => `<span>${w}</span>`).join('')}</div>
    <div class="mc-grid">${cells.join('')}</div>
  </section>`;
}

// 右欄上半：選中那天溜的狗，一列一隻（狗名、籠位、你總共溜過牠幾次）；點狗名開詳細資訊
function deskMineDay(g, walks) {
  if (!g) return '<section class="ds-panel mine-day"><h3>這天溜的狗</h3><p class="ds-empty">點月曆上有綠底的日子，這裡會列出那天溜的狗。</p></section>';
  const date = g.date;
  const timesOf = w => walks.filter(x => (w.id ? x.id === w.id : !x.id && x.name === w.name)).length;
  const rows = g.walks.map(w => {
    const dog = dogOfWalk(w);
    const inner = `${photoThumb(dog || { name: w.name, id: '' }, 36)}<span class="md-name">${esc(w.name)}</span><span class="md-cage">${dog ? esc(dog.cage || '') : '不在溜狗表'}</span><span class="md-times num">共 ${timesOf(w)} 次</span>`;
    return dog
      ? `<li><button type="button" class="md-row" data-mine-dog="${appState.allDogs.indexOf(dog)}" aria-label="${esc(w.name)}，${esc(dog.cage || '')}，你溜過 ${timesOf(w)} 次：看詳細資訊">${inner}</button></li>`
      : `<li><div class="md-row gone" title="已不在目前的溜狗表">${inner}</div></li>`;
  }).join('');
  return `<section class="ds-panel mine-day" aria-labelledby="mineDayTitle">
    <h3 id="mineDayTitle"><span class="num">${date.getMonth() + 1}/${date.getDate()}（${'日一二三四五六'[date.getDay()]}）</span><small>溜了 ${g.walks.length} 隻</small></h3>
    <ul class="md-list">${rows}</ul>
  </section>`;
}

// 右欄下半：月曆正在看的那個月（來幾天、溜幾隻次、溜過幾隻、最常溜），加上在所的狗你溜過幾隻
function deskMineStats(cal, walks) {
  const { month, inMonth } = cal;
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const now = inMonth.flatMap(g => g.walks);
  const prev = (() => { const t = new Date(y, m - 2, 1); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}`; })();
  const prevDays = new Set(walks.filter(w => w.ymd.startsWith(prev)).map(w => w.ymd)).size;
  const count = new Map();
  for (const w of now) { const k = w.id || w.name; count.set(k, { name: w.name, n: (count.get(k)?.n || 0) + 1 }); }
  const top = Math.max(0, ...[...count.values()].map(c => c.n));
  const favs = [...count.values()].filter(c => c.n === top);
  const fav = top < 2 ? '每隻各 1 次' : `${favs.slice(0, 3).map(c => esc(c.name)).join('、')}${favs.length > 3 ? ` 等 ${favs.length} 隻` : ''}<small>${top} 次</small>`;
  const seen = new Set(walks.map(dogOfWalk).filter(Boolean)).size;
  return `<section class="ds-panel mine-sum" aria-labelledby="mineSumTitle">
    <h3 id="mineSumTitle">${m} 月統計</h3>
    ${now.length ? `<dl class="ms-list">
      <div><dt>來了</dt><dd><b class="num">${inMonth.length}</b> 天<small>上個月 ${prevDays} 天</small></dd></div>
      <div><dt>溜了</dt><dd><b class="num">${now.length}</b> 隻次</dd></div>
      <div><dt>溜過</dt><dd><b class="num">${count.size}</b> 隻</dd></div>
      <div><dt>最常溜</dt><dd class="ms-fav">${fav}</dd></div>
    </dl>` : '<p class="ds-empty">這個月還沒有紀錄。</p>'}
    <p class="ms-all">在所的狗你溜過 <b class="num">${seen}</b> / ${appState.allDogs.length} 隻</p>
  </section>`;
}

// js/app.js 的 myWalksHtml 在寬螢幕叫這個（讀取中、讀不到照手機）；回 null 表示這個狀態照手機畫
function deskMineHtml(today, query) {
  if (BQWelcome.needsSetup()) {
    return `<div class="desk mine-desk solo">${deskMineHead(true)}<div class="mine-setup">${BQWelcome.setupHtml()}</div></div>`;
  }
  const walks = currentMyWalks(today);
  if (!walks.length) {
    return `<div class="desk mine-desk solo">${deskMineHead()}<div class="status-msg">還沒有你的溜狗紀錄。<br>試算表「誰遛的」寫上你設定的名字，同步後就會出現在這裡。</div></div>`;
  }
  const groups = myWalkGroups(walks, query);
  // 搜尋：照手機一天一張卡，排成好幾欄
  if (query) {
    return `<h2 class="sr-only">我溜過的紀錄</h2><div class="desk mine-desk solo">${groups.length
      ? `<div class="mine-found">${groups.map(g => myVisitCard(g)).join('')}</div>`
      : `<div class="status-msg">找不到「${esc(query)}」</div>`}</div>`;
  }
  const cal = myCalendarState(groups, today);
  const sel = cal.day && cal.inMonth.find(g => g.ymd === cal.day);
  return `<div class="desk mine-desk">
    <div class="desk-main">${deskMineHead()}${deskMineCalendar(cal, today)}</div>
    <aside class="desk-side mine-side">${deskMineDay(sel, walks)}${deskMineStats(cal, walks)}</aside>
  </div>`;
}

export { DAY_NAMES, deskMineHead, deskMineCalendar, deskMineDay, deskMineStats, deskMineHtml };
