// 在所統計：點長條看名單第三版（3e）。照 3d 的意見：名單白底、跟 Top 10 分開、名單變短、沒選到的長條看得出高低
const { chromium } = require('playwright');
const out = process.argv[2];
const CSS = `
.head-back { box-shadow: none !important; border: 0 !important; background: none !important; padding-left: 4px !important; }
.a-hero-title .icon, .a-h-icon { display: none !important; }
.a-hero-title { font-size: 20px !important; font-weight: 800 !important; color: var(--ink) !important; }
.a-card h2 { font-size: 18px !important; font-weight: 800 !important; }
.a-dog-name { font-weight: 800 !important; }
#bottomBar, #toast { display: none !important; }
.mk-pick { margin-top: 14px; border-top: 1px solid var(--line); }
.mk-head { position: relative; display: flex; align-items: baseline; gap: 8px; padding: 14px 0 4px; }
.mk-head h3 { margin: 0; font-size: 18px; font-weight: 800; }
.mk-head span { font-size: 15px; font-weight: 700; color: var(--ink-soft); }
.mk-caret { position: absolute; top: -9px; width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-bottom: 8px solid var(--line); }
.mk-caret::after { content: ''; position: absolute; left: -7px; top: 1px; border-left: 7px solid transparent; border-right: 7px solid transparent; border-bottom: 7px solid #fff; }
.mk-row { display: flex; align-items: baseline; gap: 10px; min-height: 44px; padding: 10px 0; border-bottom: 1px solid var(--line); box-sizing: border-box; }
.mk-row b.n { font-size: 17px; font-weight: 800; }
.mk-row .c { font-size: 15px; color: var(--ink-soft); }
.mk-row .y { margin-left: auto; font-size: 15px; color: var(--ink-soft); }
.mk-row .y b { font-size: 18px; font-weight: 800; color: var(--ink); margin-right: 2px; }
.mk-foot { display: flex; justify-content: space-between; }
.mk-foot button { min-height: 44px; border: 0; background: none; color: var(--primary); font: inherit; font-size: 15px; font-weight: 700; text-decoration: underline; text-underline-offset: 4px; padding: 0; }
`;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', timezoneId: 'Asia/Taipei', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); localStorage.setItem('bq-walker-name', '小陳'); localStorage.setItem('bq-walker-codes', JSON.stringify(['abcdef123456'])); });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8795/'); await p.locator('#main .card:not(.skeleton)').first().waitFor();
  await p.locator('#tabs [data-tab="info"]').tap(); await p.waitForTimeout(500);
  await p.locator('#main').getByText('在所統計').first().tap(); await p.waitForTimeout(700);
  await p.addStyleTag({ content: CSS });
  await p.evaluate(() => {
    const v = [4, 6, 9, 22, 6, 2, 1];
    const pick = 3;
    document.querySelectorAll('.a-col').forEach((c, i) => {
      c.querySelector('.a-col-v').textContent = v[i];
      const bar = c.querySelector('.a-col-bar');
      bar.style.height = (v[i] / 22 * 100) + '%';
      // 沒選到的用中間的綠，高低看得出來；選到的用深綠，數字反白
      bar.style.setProperty('background', i === pick ? 'var(--shell)' : '#8FB5A6', 'important');
      if (i === pick) {
        c.querySelector('.a-col-v').style.cssText = 'background:var(--shell);color:#fff;border-radius:2px;padding:0 4px';
        c.querySelector('.a-col-l').style.cssText = 'font-weight:800;color:var(--ink)';
      }
    });
    const yrs = ['6.2', '5.8', '4.1', '3.9', '3.3', '3.0', '2.7', '2.6', '2.5', '2.4'];
    document.querySelectorAll('.a-dog-right b').forEach((x, i) => { x.textContent = yrs[i] || x.textContent; });
    const card = document.querySelectorAll('.a-card')[0];
    card.querySelector('.a-hint').textContent = '點長條看是哪些狗';
    const dogs = [['奶茶', '新3B', '1.9'], ['布丁', '新3C', '1.7'], ['皮皮', '新5B', '1.6'], ['妞妞', '新2C', '1.4'], ['豆豆', '新2B', '1.2']];
    const rows = dogs.map(([n, c, y]) => `<div class="mk-row"><b class="n">${n}</b><span class="c">${c}</span><span class="y"><b>${y}</b>年</span></div>`).join('');
    card.insertAdjacentHTML('beforeend', `<div class="mk-pick"><div class="mk-head"><span class="mk-caret"></span><h3>1–2 年</h3><span>22 隻 · 久的排前面</span></div>${rows}<div class="mk-foot"><button>看全部 22 隻</button><button>收起</button></div></div>`);
    // 箭頭對準選到的長條
    const col = document.querySelectorAll('.a-col')[pick].getBoundingClientRect();
    const pickBox = card.querySelector('.mk-pick').getBoundingClientRect();
    card.querySelector('.mk-caret').style.left = (col.left + col.width / 2 - pickBox.left - 8) + 'px';
  });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/mock-stats-tap3.png`, fullPage: true, clip: { x: 0, y: 0, width: 390, height: 1250 } });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
