// 拋棄式 UI 原型：既有首頁 ?prototype=walk-column&variant=A，僅供手機比較左欄排列。
// 留在 prototype 分支，不合併正式版；只讀狗資料，所有範例狀態在記憶體。
if (new URLSearchParams(location.search).get('prototype') === 'walk-column') {
  window.__BQ_TEST__ = true;
  document.documentElement.classList.add('prototype-column');
  document.addEventListener('DOMContentLoaded', async () => {
    const names = { A: 'A・上下排列', B: 'B・整句閱讀', C: 'C・數字單位並排' };
    const descriptions = {
      A: '昨天／今天縮為 20px，保留數字與「天前」上下排列。',
      B: '日期整句統一為 16px：「2 天前」、「昨天」、「今天」。',
      C: '數字與「天前」並排、整欄靠左；昨天／今天 20px。',
    };
    const style = document.createElement('style');
    style.textContent = `
      .prototype-column header.app { top: 0; }
      .prototype-column #bottomBar { display: none; }
      .prototype-column #main { padding-bottom: 150px; }
      .prototype-column .prototype-note { margin: 12px 14px; color: var(--ink-soft); font-size: 14px; line-height: 1.5; }
      .prototype-column .prototype-note strong { display: block; color: var(--ink); }
      .prototype-column .prototype-switcher { position: fixed; z-index: 90; bottom: 0; left: 0; right: 0; padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); background: var(--surface); border-top: 1px solid var(--line); }
      .prototype-column .prototype-switcher nav { max-width: 600px; margin: auto; display: grid; grid-template-columns: 48px minmax(0, 1fr) 48px; align-items: center; gap: 8px; }
      .prototype-column .prototype-switcher button { min-height: 48px; padding: 0 8px; border: 1px solid var(--line); background: var(--surface-soft); color: var(--primary); font: inherit; font-weight: 700; border-radius: 3px; }
      .prototype-column .prototype-current { text-align: center; font-size: 16px; font-weight: 700; }
      .prototype-column .prototype-switcher p { max-width: 600px; margin: 8px auto 0; color: var(--ink-soft); font-size: 13px; line-height: 1.4; text-align: center; }
      .prototype-column .card .last[data-days="0"] .val b,
      .prototype-column .card .last[data-days="1"] .val b { font-size: 20px; font-weight: 700; }
      .prototype-column[data-variant="B"] .card .last .val:not(.small) { display: flex; align-items: flex-start; justify-content: center; font-size: 16px; font-weight: 700; }
      .prototype-column[data-variant="B"] .prototype-date-phrase { display: block; line-height: 32px; }
      .prototype-column[data-variant="C"] .card .last { text-align: left; align-items: flex-start; }
      .prototype-column[data-variant="C"] .card .last .val:not(.small) { display: flex; align-items: flex-start; justify-content: flex-start; gap: 2px; width: 100%; }
      .prototype-column[data-variant="C"] .card .last .val b { font-size: 24px; font-weight: 800; }
      .prototype-column[data-variant="C"] .card .last[data-days="0"] .val b,
      .prototype-column[data-variant="C"] .card .last[data-days="1"] .val b { font-size: 20px; font-weight: 700; }
      .prototype-column[data-variant="C"] .card .last .last-unit { line-height: 32px; font-size: 13px; }
      .prototype-column[data-variant="C"] .card .last .val.small { align-items: flex-start; }
    `;
    document.head.append(style);
    const parsed = parseDogsData(await fetch('data/dogs.json', { cache: 'no-cache' }).then(r => r.json()));
    photoVersions = parsed.photoVersions;
    walkedStorage = { getItem: () => null };
    walkedMemory = null; walkedCache = null; sheetWriteState = 'off';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cases = [
      { name: '阿湯', days: 2 }, { name: '方吉', days: 1 }, { name: '黑狗兄', days: 0 },
      { name: '老哥', days: 0, note: '不親狗、護食' },
      { name: '滿滿', covered: true }, { name: '泰森', rest: true },
      { name: '寶弟', days: 3, note: '對狗曾經攻擊（志工乙）' }, { name: '昆布', days: 5 },
    ];
    allDogs = cases.map((sample, i) => ({ ...(parsed.dogs.find(d => d.name === sample.name) || parsed.dogs[i]),
      walkedDate: sample.days == null ? null : new Date(today.getFullYear(), today.getMonth(), today.getDate() - sample.days),
      covered: !!sample.covered, note: sample.note || '',
    }));
    restMap = {}; restMap[allDogs[5].id] = { until: localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7)) };
    groupMap = {};
    document.getElementById('dateLabel').textContent = '左欄排版原型';
    document.getElementById('updatedLabel').textContent = '';
    document.getElementById('searchInput').readOnly = true;
    const note = document.createElement('div'); note.className = 'prototype-note';
    document.getElementById('main').before(note);
    const switcher = document.createElement('section'); switcher.className = 'prototype-switcher';
    switcher.innerHTML = `<nav aria-label="切換原型"><button type="button" data-prototype-step="-1" aria-label="上一個方案">${icon('back')}</button><span class="prototype-current" aria-live="polite"></span><button type="button" data-prototype-step="1" aria-label="下一個方案"><span style="display:inline-flex;transform:scaleX(-1)">${icon('back')}</span></button></nav><p>僅供比較・範例日期・不登記遛狗</p>`;
    document.body.append(switcher);
    function showVariant(key) {
      const variant = names[key] ? key : 'A';
      document.documentElement.dataset.variant = variant;
      const url = new URL(location.href); url.searchParams.set('variant', variant); history.replaceState(null, '', url);
      document.querySelector('.prototype-current').textContent = names[variant];
      note.innerHTML = `<strong>${names[variant]}</strong>${descriptions[variant]}`;
      document.getElementById('main').innerHTML = allDogs.map(d => dogCard(d, today, true)).join('');
      if (variant === 'B') for (const last of document.querySelectorAll('#main .last[data-days]')) {
        const days = +last.dataset.days;
        last.querySelector('.val').innerHTML = `<span class="prototype-date-phrase">${days === 0 ? '今天' : days === 1 ? '昨天' : `${days} 天前`}</span>`;
      }
    }
    document.addEventListener('click', e => {
      if (!e.target.closest('.prototype-switcher') && e.target.closest('button, [role="button"], a')) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    switcher.addEventListener('click', e => {
      const button = e.target.closest('[data-prototype-step]'); if (!button) return;
      const keys = Object.keys(names), current = keys.indexOf(document.documentElement.dataset.variant);
      showVariant(keys[(current + +button.dataset.prototypeStep + keys.length) % keys.length]);
    });
    window.render = () => showVariant(document.documentElement.dataset.variant || 'A');
    showVariant(new URLSearchParams(location.search).get('variant'));
  });
}
