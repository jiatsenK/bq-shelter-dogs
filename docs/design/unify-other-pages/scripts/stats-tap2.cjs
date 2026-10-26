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
  await p.evaluate(() => {
    const cols = [...document.querySelectorAll(".a-col")];
    cols.forEach((c, i) => { const bar = c.querySelector(".a-col-bar"); bar.style.setProperty("background", i === 3 ? "var(--shell)" : "var(--primary-soft)", "important"); c.style.cursor = "pointer"; if (i === 3) { c.querySelector(".a-col-v").style.cssText = "background:var(--shell);color:#fff;border-radius:2px;padding:0 4px"; c.querySelector(".a-col-l").style.cssText = "font-weight:800;color:var(--ink)"; } });
    const card = document.querySelectorAll(".a-card")[0];
    card.querySelector(".a-hint").textContent = "點長條看是哪些狗";
    const src = [...document.querySelectorAll(".a-dog")].slice(3, 9);
    const years = ["1.9", "1.7", "1.6", "1.4", "1.2", "1.1"];
    const list = src.map((d, i) => { const c = d.cloneNode(true); c.querySelector(".a-rank").remove(); c.querySelector(".a-dog-right b").textContent = years[i]; return c.outerHTML; }).join("");
    card.insertAdjacentHTML("beforeend", `<div style="position:relative;margin:16px -14px -14px;background:var(--primary-soft);border-top:3px solid var(--shell);padding:12px 14px 6px"><span style="position:absolute;top:-12px;left:calc(14px + (100% - 28px) * 3.5 / 7 - 9px);width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:9px solid var(--shell)"></span><div style="display:flex;align-items:baseline;gap:8px"><h3 style="margin:0;font-size:18px;font-weight:800">1–2 年</h3><span style="font-size:15px;font-weight:700;color:var(--ink-soft)">22 隻 · 久的排前面</span></div><div class="a-list mk-pick">${list}</div><div style="display:flex;justify-content:space-between"><button style="min-height:44px;border:0;background:none;color:var(--primary);font:inherit;font-size:15px;font-weight:700;text-decoration:underline;text-underline-offset:4px;padding:0">看全部 22 隻</button><button style="min-height:44px;border:0;background:none;color:var(--primary);font:inherit;font-size:15px;font-weight:700;text-decoration:underline;text-underline-offset:4px;padding:0">收起</button></div></div>`);
  });
  await p.addStyleTag({ content: ".mk-pick .a-dog { background: transparent !important; border-color: rgba(31,92,77,.25) !important; }" });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/mock-stats-tap2.png`, fullPage: true, clip: { x: 0, y: 0, width: 390, height: 1500 } });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
