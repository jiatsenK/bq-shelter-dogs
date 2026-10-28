// 我溜過：排版不動，只統一按鈕、圖示、字。現在和改成都先放同樣的假資料（12、19 號有溜、上個月可按）
const { chromium } = require('playwright');
const out = process.argv[2];
const CSS = `
.who-hint > .icon:first-child { display: none; }
.who-hint .who-name { font-size: 20px; font-weight: 800; }
.who-hint .who-edit, .who-edit { box-shadow: none !important; background: none !important; color: var(--primary) !important; font-size: 15px; font-weight: 700 !important; text-decoration: underline; text-underline-offset: 4px; padding: 0 8px !important; }
.who-hint .who-edit .icon { display: none; }
.mc-nav { background: none; color: var(--ink); }
.mc-nav:disabled { opacity: .25; }
.walk-date { font-size: 18px; font-weight: 800; }
.walk-date .n { font-size: 15px; font-weight: 700; }
.mine-dog .bname { font-weight: 800; }
`;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', timezoneId: 'Asia/Taipei', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); localStorage.setItem('bq-walker-name', '小陳'); localStorage.setItem('bq-walker-codes', JSON.stringify(['abcdef123456'])); });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8795/'); await p.locator('#main .card:not(.skeleton)').first().waitFor();
  for (const i of [1, 2]) { await p.locator('#main .card:not(.skeleton) button', { hasText: '溜了' }).nth(i).tap(); await p.waitForTimeout(1200); }
  await p.addStyleTag({ content: '#toast{display:none!important}' });
  await p.locator('#tabs [data-tab="mine"]').tap(); await p.waitForTimeout(700);
  await p.evaluate(() => {
    document.querySelector('.mc-nav').disabled = false;
    document.querySelectorAll('.mc-grid .mc-cell b').forEach(bb => { if (['12', '19'].includes(bb.textContent)) { const c = bb.parentElement; c.classList.add('on'); c.insertAdjacentHTML('beforeend', `<small>${bb.textContent === '12' ? 2 : 3} 隻</small>`); } });
  });
  await p.screenshot({ path: `${out}/now-mine2.png` });
  await p.addStyleTag({ content: CSS }); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/mock-mine3.png` });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
