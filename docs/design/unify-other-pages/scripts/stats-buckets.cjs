// 在所統計：入所多久改分組（K 2026-10-28：大部分 5 年以上，現在的分組太短）。
// 用正式資料 2026-10-28 的分布（編號＋出入所紀錄取最早，115 隻，滿幾年 0→4 隻 … 11→2 隻），出三版：
// 每年一格到最久那年（會一直變多）、0–9 每年一格＋10+（根數固定）、兩年一格。名單沿用 3e 的白底短名單。
const { chromium } = require('playwright');
const out = process.argv[2];
const BY_YEAR = [4, 11, 10, 11, 11, 18, 11, 14, 15, 6, 2, 2];
const OLD = [['小白', '新1B', '11.6'], ['小黑', '新1A', '11.2'], ['毛毛', '新6B', '10.8'], ['奶茶', '新3B', '10.3']];
const MID = [['布丁', '新3C', '8.9'], ['皮皮', '新5B', '8.8'], ['妞妞', '新2C', '8.6'], ['豆豆', '新2B', '8.4'], ['咖啡', '新5C', '8.1']];
const VARIANTS = [
  { file: 'mock-stats-year.png', labels: BY_YEAR.map((_, i) => String(i)), counts: BY_YEAR, pick: 8, title: '滿 8 年', unit: '單位：滿幾年（0＝未滿 1 年）', dogs: MID },
  { file: 'mock-stats-fixed.png', labels: [...BY_YEAR.slice(0, 10).map((_, i) => String(i)), '10+'], counts: [...BY_YEAR.slice(0, 10), 4], pick: 10, title: '10 年以上', unit: '單位：滿幾年（0＝未滿 1 年）', dogs: OLD },
  { file: 'mock-stats-2year.png', labels: ['<1年', '1–3年', '3–5年', '5–7年', '7–9年', '9年+'], counts: [4, 21, 22, 29, 29, 10], pick: 5, title: '9 年以上', unit: '', dogs: [...OLD, ['布丁', '新3C', '9.6']] },
];
const CSS = `
.head-back { box-shadow: none !important; border: 0 !important; background: none !important; padding-left: 4px !important; }
.a-hero-title .icon, .a-h-icon { display: none !important; }
.a-hero-title { font-size: 20px !important; font-weight: 800 !important; color: var(--ink) !important; }
.a-card h2 { font-size: 18px !important; font-weight: 800 !important; }
.a-dog-name { font-weight: 800 !important; }
#bottomBar, #toast { display: none !important; }
.mk-unit { font-size: 13px; color: var(--ink-soft); text-align: right; margin-top: 4px; }
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
  for (const v of VARIANTS) {
    const p = await ctx.newPage();
    await p.goto('http://localhost:8795/'); await p.locator('#main .card:not(.skeleton)').first().waitFor();
    await p.locator('#tabs [data-tab="info"]').tap(); await p.waitForTimeout(500);
    await p.locator('#main').getByText('在所統計').first().tap(); await p.waitForTimeout(700);
    await p.addStyleTag({ content: CSS });
    await p.evaluate(v => {
      // 上面大數字換成正式資料的量級（115 隻；平均用每年中點估 5.5 年）
      const kpis = document.querySelectorAll('.a-hero .a-kpi-v');
      if (kpis[0]) kpis[0].firstChild.textContent = '115';
      if (kpis[1]) kpis[1].firstChild.textContent = '5.5';
      const card = document.querySelectorAll('.a-card')[0];
      const cols = card.querySelector('.a-cols');
      const tpl = cols.querySelector('.a-col');
      const max = Math.max(...v.counts);
      cols.style.setProperty('--n', v.counts.length);
      cols.innerHTML = '';
      v.counts.forEach((n, i) => {
        const c = tpl.cloneNode(true);
        c.querySelector('.a-col-v').textContent = n;
        c.querySelector('.a-col-l').textContent = v.labels[i];
        const bar = c.querySelector('.a-col-bar');
        bar.style.height = (n / max * 100) + '%';
        bar.style.setProperty('background', i === v.pick ? 'var(--shell)' : '#8FB5A6', 'important');
        c.querySelector('.a-col-v').style.cssText = i === v.pick ? 'background:var(--shell);color:#fff;border-radius:2px;padding:0 3px;justify-self:center' : '';
        c.querySelector('.a-col-l').style.cssText = i === v.pick ? 'font-weight:800;color:var(--ink)' : '';
        cols.appendChild(c);
      });
      if (v.unit) cols.insertAdjacentHTML('afterend', `<div class="mk-unit">${v.unit}</div>`);
      card.querySelector('.a-hint').textContent = '點長條看是哪些狗';
      const yrs = ['11.6', '11.2', '10.8', '10.3', '9.8', '9.6', '9.5', '9.3', '9.1', '8.9'];
      document.querySelectorAll('.a-dog-right b').forEach((x, i) => { x.textContent = yrs[i] || x.textContent; });
      const dogs = v.dogs;
      const total = v.counts[v.pick];
      const rows = dogs.slice(0, 5).map(([n, c, y]) => `<div class="mk-row"><b class="n">${n}</b><span class="c">${c}</span><span class="y"><b>${y}</b>年</span></div>`).join('');
      card.insertAdjacentHTML('beforeend', `<div class="mk-pick"><div class="mk-head"><span class="mk-caret"></span><h3>${v.title}</h3><span>${total} 隻 · 久的排前面</span></div>${rows}<div class="mk-foot"><button>${total > 5 ? `看全部 ${total} 隻` : ""}</button><button>收起</button></div></div>`);
      const col = cols.querySelectorAll('.a-col')[v.pick].getBoundingClientRect();
      const pickBox = card.querySelector('.mk-pick').getBoundingClientRect();
      card.querySelector('.mk-caret').style.left = (col.left + col.width / 2 - pickBox.left - 8) + 'px';
    }, v);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${v.file}`, clip: { x: 0, y: 0, width: 390, height: 1000 } });
    await p.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
