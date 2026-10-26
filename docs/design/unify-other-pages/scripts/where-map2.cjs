// 點分布長條 → 跳出整個園區平面圖，這段時間入所的狗所在籠位亮橘點（示意）
const { chromium } = require('C:/Users/User/projects/bq-shelter-dogs/node_modules/playwright');
const out = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8795/'); await p.locator('#main .card:not(.skeleton)').first().waitFor();
  await p.addStyleTag({ content: '#toast{display:none!important}' });
  await p.locator('#tabs [data-tab="info"]').tap(); await p.waitForTimeout(400);
  await p.locator('#main').getByText('在所統計').first().tap(); await p.waitForTimeout(600);
  await p.evaluate(() => { const v = [4, 6, 9, 22, 6, 2, 1]; document.querySelectorAll('.a-col').forEach((c, i) => { c.querySelector('.a-col-v').textContent = v[i]; const bar = c.querySelector('.a-col-bar'); bar.style.height = (v[i] / 22 * 100) + '%'; bar.style.setProperty('background', i === 3 ? 'var(--shell)' : 'var(--primary-soft)', 'important'); }); });
  await p.evaluate(() => { window.__stats = document.querySelector('#main').innerHTML; window.scrollTo(0, 0); });
  // 借「在哪」面板的平面圖
  await p.locator('#tabs [data-tab="walk"]').tap(); await p.waitForTimeout(400);
  await p.locator('#main .cage-pill').nth(1).tap(); await p.waitForTimeout(900);
  await p.evaluate(() => {
    document.querySelector('#main').innerHTML = window.__stats; window.scrollTo(0, 0);
    document.head.insertAdjacentHTML('beforeend', '<style>#whereSheet .fm-zone, #whereSheet .fm-zone * { opacity: 1 !important; }</style>');
    const svg = document.querySelector('#whereSheet .find-map');
    svg.setAttribute('viewBox', '-14 -14 628 410');
    svg.querySelectorAll('.fm-cage.sel, .sel .fm-cage').forEach(x => x.classList.remove('sel'));
    svg.querySelectorAll('.fm-zone.sel').forEach(z => z.classList.remove('sel'));
    const NS = "http://www.w3.org/2000/svg";
    const ring = (x, y, w, h, fill) => { const r = document.createElementNS(NS, "rect"); r.setAttribute("x", x - 2); r.setAttribute("y", y - 2); r.setAttribute("width", w + 4); r.setAttribute("height", h + 4); r.setAttribute("rx", 3); r.setAttribute("class", "where-ring"); r.style.fill = fill || "rgba(232,115,12,.22)"; r.style.stroke = "#E8730C"; svg.appendChild(r); };
    const cages = [...svg.querySelectorAll(".fm-cg")].filter(g => !/^新/.test(g.dataset.findCage || ""));
    [1, 4, 7, 9, 12, 15].forEach(i => { const r = cages[i] && cages[i].querySelector("rect"); if (r) ring(+r.getAttribute("x"), +r.getAttribute("y"), +r.getAttribute("width"), +r.getAttribute("height")); });
    const nz = svg.querySelector("[data-find-zone=new] > rect");
    if (nz) { ring(+nz.getAttribute("x"), +nz.getAttribute("y"), +nz.getAttribute("width"), +nz.getAttribute("height"), "rgba(232,115,12,.12)"); }
    [...svg.querySelectorAll("[data-find-zone=new] text")].filter(t => /新犬舍區/.test(t.textContent)).forEach(t => { t.innerHTML = "新犬舍區 <tspan fill=\"#B4560A\" font-weight=\"900\">13</tspan>／28 隻"; });
    const sheet = document.querySelector('#whereSheet');
    sheet.querySelector('#whereTitle').innerHTML = '入所 1–2 年 <span style="color:var(--ink-soft);font-size:16px;font-weight:700">22 隻</span>';
    [...sheet.children].forEach(c => { if (!c.matches('.where-grab, .where-head, .where-map')) c.style.display = 'none'; });
    sheet.insertAdjacentHTML('beforeend', `<p style="margin:12px 4px 4px;font-size:15px;color:var(--ink)">橘框是這段時間入所的狗住的籠子（跟「在哪」同一種會呼吸的橘框）。新犬舍不分籠，整區框起來寫幾隻。點橘框看是哪幾隻。</p>
      <div style="display:flex;gap:8px;margin:10px 0 4px;align-items:center"><span style="font-size:15px;font-weight:800">舊犬舍 A7</span><span style="color:var(--ink-soft);font-size:14px">2 隻：奶茶、布丁</span></div>
      <button style="min-height:44px;border:0;background:none;color:var(--primary);font:inherit;font-size:15px;font-weight:700;text-decoration:underline;text-underline-offset:4px;padding:0">改看名單</button>`);
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/mock-stats-map2.png` });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
