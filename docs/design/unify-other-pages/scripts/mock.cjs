// 其他頁統一成溜狗表樣子的示意圖：在真的網頁上換掉 #main 內容（頁首、底部列、狗卡都是真的）。
// 用法：node mock.cjs <outDir>（假資料伺服器要先開在 8795）
const { chromium } = require('playwright');
const out = process.argv[2];

const CSS = `
.mk-head { display: flex; align-items: baseline; gap: 8px; padding: 14px 2px 2px; }
.mk-head h2 { margin: 0; font-size: 20px; font-weight: 800; color: var(--ink); }
.mk-head small { font-size: 15px; font-weight: 700; color: var(--ink-soft); }
.mk-head .mk-link { margin-left: auto; }
.mk-hint { margin: 2px 2px 10px; font-size: 13px; color: var(--ink-soft); }
.mk-link { min-height: 44px; padding: 0 4px; border: 0; background: none; font: inherit; font-size: 15px; font-weight: 700;
  color: var(--primary); text-decoration: underline; text-underline-offset: 4px; }
.mk-frame { min-height: 44px; min-width: 44px; padding: 0 14px; border: 2px solid var(--primary); border-radius: 3px; background: #fff;
  color: var(--primary); font: inherit; font-size: 16px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.mk-sheet { background: #fff; border-top: 1px solid var(--line); }
.mk-section { padding: 14px 14px 12px; border-bottom: 1px solid var(--line); background: #fff; }
.mk-section h3 { margin: 0 0 8px; font-size: 16px; font-weight: 800; color: var(--ink); }
.mk-section .mk-sub { font-size: 13px; color: var(--ink-soft); font-weight: 600; margin-left: 6px; }
/* 狗卡沿用溜狗表那一列，只拿掉右邊按鈕或換成文字 */
.mk-rows .card .walk-btn { display: none; }
.mk-rows .card .mk-right { margin-left: auto; padding-right: 10px; font-size: 15px; font-weight: 800; color: var(--ink); white-space: nowrap; }
/* 批次操作：跟按溜了後的提示條同一條深色浮條 */
.mk-bar { position: fixed; left: 14px; right: 14px; bottom: calc(80px + env(safe-area-inset-bottom, 0px)); z-index: 30;
  display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--ink); border-radius: 3px;
  box-shadow: 0 6px 24px rgba(0,0,0,.25); }
.mk-bar .mk-arrow { width: 44px; height: 44px; border: 0; background: none; color: #fff; font-size: 26px; font-weight: 700; }
.mk-bar .mk-go { flex: 1; min-height: 48px; border: 2px solid #fff; border-radius: 3px; background: none; color: #fff; font: inherit; font-size: 17px; font-weight: 800; }
.mk-bar .mk-except { min-height: 44px; border: 0; background: none; color: var(--tab-amber); font: inherit; font-size: 15px; font-weight: 800; padding: 0 4px; }
/* 我溜過月曆 */
.mk-month { display: flex; align-items: center; gap: 8px; padding: 12px 14px 4px; background: #fff; }
.mk-month .mk-title { flex: 1; text-align: center; }
.mk-month .mk-title b { display: block; font-size: 18px; font-weight: 800; }
.mk-month .mk-title span { font-size: 13px; color: var(--ink-soft); font-weight: 600; }
.mk-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; padding: 6px 10px 12px; background: #fff; border-bottom: 1px solid var(--line); }
.mk-cal .wd { text-align: center; font-size: 13px; color: var(--ink-soft); padding: 4px 0; }
.mk-cal .d { height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 16px; color: var(--ink); border-radius: 2px; }
.mk-cal .d.w { background: var(--tab-green); color: #fff; font-weight: 800; }
.mk-cal .d.w small { font-size: 11px; font-weight: 700; line-height: 1; }
.mk-cal .d.sel { outline: 2px solid var(--ink); outline-offset: 1px; }
/* 統計：數字一排、長條用檔案綠 */
.mk-nums { display: flex; gap: 28px; padding: 6px 14px 14px; background: #fff; border-bottom: 1px solid var(--line); }
.mk-nums b { font-size: 34px; font-weight: 900; color: var(--ink); }
.mk-nums b small { font-size: 15px; margin-left: 2px; }
.mk-nums div span { display: block; font-size: 13px; color: var(--ink-soft); font-weight: 600; }
.mk-bars { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; align-items: end; height: 110px; margin-top: 8px; border-bottom: 1px solid var(--line); }
.mk-bars i { display: block; background: var(--primary); }
.mk-bars-x { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; font-size: 11px; color: var(--ink-soft); text-align: center; padding-top: 4px; }
.mk-rank { width: 44px; text-align: center; font-size: 18px; font-weight: 900; color: var(--ink-soft); flex: none; }
/* 詳細資訊：直角、按鈕跟溜狗表同一套 */
.detail { border-radius: 3px 3px 0 0 !important; }
.detail-section h3 .icon { display: none; }
.detail .thumb-fallback .icon { display: none; }
.detail .thumb-fallback::after { content: '還沒有照片'; color: var(--ink-soft); font-size: 15px; font-weight: 700; }
.detail .my-note-edit { border: 2px solid var(--primary) !important; color: var(--primary) !important; background: #fff !important; border-radius: 3px !important; }
.detail .my-note-edit .icon { display: none; }
.detail-bar { gap: 8px !important; }
.detail-bar #detailClose { background: none !important; border: 0 !important; color: var(--primary) !important; text-decoration: underline; text-underline-offset: 4px; flex: 0 0 auto !important; padding: 0 10px !important; }
.detail-bar #detailWhere { background: #fff !important; border: 2px solid var(--primary) !important; color: var(--primary) !important; border-radius: 3px !important; }
.detail-bar #groupWalk { background: #fff !important; border: 2px solid var(--primary) !important; color: var(--primary) !important; border-radius: 3px !important; font-weight: 900 !important; }
.detail-bar #groupWalk .icon { display: none; }
`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', timezoneId: 'Asia/Taipei', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); localStorage.setItem('bq-walker-name', '小陳'); localStorage.setItem('bq-walker-codes', JSON.stringify(['abcdef123456'])); });
  const p = await ctx.newPage();
  const shot = async n => { await p.waitForTimeout(600); await p.screenshot({ path: `${out}/${n}.png` }); };
  const tab = async t => { await p.locator(`#tabs [data-tab="${t}"]`).tap(); await p.waitForTimeout(500); await p.evaluate(() => window.scrollTo(0, 0)); };
  await p.goto('http://localhost:8795/'); await p.locator('#main .card:not(.skeleton)').first().waitFor();
  await p.addStyleTag({ content: '#toast{display:none!important}' }); // 假資料下常溜同步失敗的提示條，跟畫面無關
  // 先存溜狗表的狗卡 HTML，示意圖直接拿來用
  await p.evaluate(() => { window.__cards = {}; document.querySelectorAll('#main .card').forEach(c => { const n = c.querySelector('.name')?.firstChild?.textContent; if (n) window.__cards[n] = c.outerHTML; }); });

  // 現在的樣子
  await p.locator('#main .card .last').first().tap(); await p.locator('#detail').waitFor(); await shot('now-detail');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await tab('groups'); await shot('now-groups');
  await tab('mine'); await shot('now-mine');
  await tab('info'); await p.locator('#main').getByText('在所統計').first().tap(); await p.waitForTimeout(500); await shot('now-stats');
  await p.goBack().catch(() => {}); await p.waitForTimeout(400);

  await p.addStyleTag({ content: CSS });
  const rows = (names, right) => `<div class="mk-rows">${names.map((n, i) => {
    const r = typeof right === 'function' ? right(n, i) : right;
    return (window => '')() + `__CARD__${n}__${r || ''}__`; }).join('')}</div>`;
  const fill = async html => p.evaluate(h => {
    h = h.replace(/__CARD__(.+?)__(.*?)__/g, (_, n, r) => {
      const d = document.createElement('div'); d.innerHTML = window.__cards[n] || '';
      const c = d.firstElementChild; if (!c) return '';
      if (r) { const s = document.createElement('span'); s.className = 'mk-right'; s.textContent = r; c.querySelector('.row').append(s); }
      return c.outerHTML; });
    document.querySelector('#main').innerHTML = h;
  }, html);

  // 常溜狗群
  await tab('groups');
  await fill(`<div class="mk-head"><h2>新犬舍好朋友</h2><small>5 隻 · 第 1／2 群</small></div>
    <p class="mk-hint">要改請到試算表「常遛狗群」分頁</p>
    ${rows(['小黑', '小白', '阿福', '豆豆', '妞妞'])}
    <div style="height:90px"></div>
    <div class="mk-bar"><button class="mk-arrow" aria-label="上一群">‹</button><button class="mk-go">整群溜了 · 5 隻</button><button class="mk-except">有狗沒溜</button><button class="mk-arrow" aria-label="下一群">›</button></div>`);
  await shot('mock-groups');

  // 我溜過
  await tab('mine');
  const days = ['日', '一', '二', '三', '四', '五', '六'].map(d => `<div class="wd">${d}</div>`).join('')
    + '<div></div><div></div><div></div><div></div>'
    + Array.from({ length: 31 }, (_, i) => {
      const d = i + 1, n = { 12: 2, 19: 3, 26: 2 }[d];
      return `<div class="d${n ? ' w' : ''}${d === 26 ? ' sel' : ''}">${d}${n ? `<small>${n} 隻</small>` : ''}</div>`; }).join('');
  await fill(`<div class="mk-head"><h2>小陳 溜過的狗</h2><button class="mk-link">改名字</button></div>
    <div class="walk-tools"><div class="chips"><button class="chip on">月曆</button><button class="chip">統計</button></div></div>
    <div class="mk-month"><button class="mk-frame" aria-label="上個月">‹</button><div class="mk-title"><b>2026 年 10 月</b><span>來 3 天 · 溜 7 隻次</span></div><button class="mk-frame" aria-label="下個月">›</button></div>
    <div class="mk-cal">${days}</div>
    <div class="mk-head"><h2>10/26（一）</h2><small>2 隻</small></div>
    ${rows(['小黑', '小白'], (n, i) => ['08:40', '09:15'][i])}
    <div style="height:20px"></div>`);
  await shot('mock-mine');

  // 在所統計
  await tab('info'); await p.locator('#main').getByText('在所統計').first().tap(); await p.waitForTimeout(500);
  await fill(`<div class="mk-head"><h2>板收在所的狗</h2></div>
    <div class="mk-nums" style="margin-top:8px;border-top:1px solid var(--line)"><div><b>50<small>隻</small></b><span>目前在所</span></div><div><b>1.8<small>年</small></b><span>平均在所</span></div></div>
    <div class="mk-section"><h3>入所多久<span class="mk-sub">最多的是 1–2 年，共 31 隻</span></h3>
      <div class="mk-bars">${[4, 6, 9, 31, 0, 0, 0].map(v => `<i style="height:${v ? Math.max(4, v / 31 * 100) : 0}%"></i>`).join('')}</div>
      <div class="mk-bars-x"><span>&lt;3月</span><span>3–6月</span><span>6–12月</span><span>1–2年</span><span>2–3年</span><span>3–5年</span><span>5年+</span></div></div>
    <div class="mk-head"><h2>在所最久</h2><small>前 10 隻</small></div>
    ${rows(['小黑', '小白', '阿福', '豆豆'], '1.8 年')}`);
  await p.evaluate(() => document.querySelectorAll('#main .mk-rows .card').forEach((c, i) => { const l = c.querySelector('.last'); if (l) l.outerHTML = `<div class="mk-rank">${i + 1}</div>`; }));
  await shot('mock-stats');

  // 詳細資訊
  await tab('walk');
  await p.locator('#main .card .last').first().tap(); await p.locator('#detail').waitFor(); await shot('mock-detail');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
