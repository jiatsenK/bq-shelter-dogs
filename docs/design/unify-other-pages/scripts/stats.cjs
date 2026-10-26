// 在所統計：排版不動，只統一樣式。現在和改成都先把分布改成像真的資料（假資料全部 1.8 年）
const { chromium } = require('C:/Users/User/projects/bq-shelter-dogs/node_modules/playwright');
const out = process.argv[2];
const CSS = `
.head-back { box-shadow: none !important; border: 0 !important; background: none !important; padding-left: 4px !important; }
.a-hero-title .icon, .a-h-icon { display: none !important; }
.a-hero-title { font-size: 20px !important; font-weight: 800 !important; color: var(--ink) !important; }
.a-card h2 { font-size: 18px !important; font-weight: 800 !important; }
.a-col-bar { background: var(--primary) !important; }
.a-dog-name { font-weight: 800 !important; }
`;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', timezoneId: 'Asia/Taipei', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); localStorage.setItem('bq-walker-name', '小陳'); localStorage.setItem('bq-walker-codes', JSON.stringify(['abcdef123456'])); });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8795/'); await p.locator('#main .card:not(.skeleton)').first().waitFor();
  await p.addStyleTag({ content: '#toast{display:none!important}' });
  await p.locator('#tabs [data-tab="info"]').tap(); await p.waitForTimeout(500);
  await p.locator('#main').getByText('在所統計').first().tap(); await p.waitForTimeout(700);
  await p.evaluate(() => {
    const v = [4, 6, 9, 22, 6, 2, 1];
    document.querySelectorAll('.a-col').forEach((c, i) => { c.querySelector('.a-col-v').textContent = v[i]; c.querySelector('.a-col-bar').style.height = (v[i] / 22 * 100) + '%'; });
    const h = document.querySelector('.a-card .a-hint'); if (h) h.textContent = '滿 1 年的 31 隻（62%）；最多的是「1–2 年」，共 22 隻';
    const yrs = ['6.2', '5.8', '4.1', '3.9', '3.3', '3.0', '2.7', '2.6', '2.5', '2.4'];
    document.querySelectorAll('.a-dog-right b').forEach((x, i) => { x.textContent = yrs[i] || x.textContent; });
  });
  await p.addStyleTag({ content: '#bottomBar{display:none!important}' });
  await p.screenshot({ path: `${out}/now-stats2.png`, fullPage: true });
  await p.addStyleTag({ content: CSS }); await p.evaluate(() => document.querySelectorAll('.a-col-bar').forEach(x => x.style.setProperty('background', 'var(--primary)', 'important'))); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/mock-stats2.png`, fullPage: true });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
