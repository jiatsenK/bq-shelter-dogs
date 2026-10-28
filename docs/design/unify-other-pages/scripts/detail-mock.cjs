// 詳細資訊：統一樣式＋#645 的版面建議（2026-10-28 討論用）。在 mock-server 上開有警示、沒照片的狗，截「現在」和「改成」。
// 用法：node detail-mock.cjs <輸出資料夾> [port]
const { chromium } = require('playwright');
const out = process.argv[2];
const port = process.argv[3] || '8795';
const CSS = `
#toast { display: none !important; }
.detail, .detail .badge, .detail .thumb, .detail .warn-note, .detail .bar-btn, .detail .group-walk { border-radius: 0 !important; }
.detail-section h3 .icon { display: none !important; }
.detail .photo-wrap.hero .thumb.no-photo { height: 120px !important; aspect-ratio: auto !important; }
.detail .photo-wrap.hero .thumb-fallback svg { display: none !important; }
.detail .mk-nophoto { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; width: 100%; height: 100%; color: var(--ink-soft); font-size: 15px; }
.detail .mk-nophoto u { color: var(--primary); font-weight: 700; text-underline-offset: 4px; }
.detail .mk-warn { margin: 10px 0 0; }
.detail .append-open { border: 0 !important; background: none !important; color: var(--primary) !important; text-decoration: underline; text-underline-offset: 4px; padding: 0 !important; min-height: 44px; font-weight: 700; }
.detail .append-open .icon { display: none !important; }
.detail-bar .bar-btn { background: none !important; color: var(--primary) !important; text-decoration: underline; text-underline-offset: 4px; flex: 0 0 auto !important; padding: 0 14px !important; font-weight: 700 !important; }
.detail-bar .bar-btn .icon { display: none !important; }
.detail-bar .group-walk { flex: 1 !important; }
.mk-tidy { border-top: 1px solid var(--line); padding: 4px 16px 12px; }
.mk-tidy summary { min-height: 44px; display: flex; align-items: center; font-weight: 700; color: var(--ink-soft); cursor: pointer; }
.mk-tidy summary span { font-weight: 400; font-size: 14px; margin-left: 8px; }
`;
(async () => {
  const b = await chromium.launch();
  for (const mode of ['now', 'mock']) {
    for (const [h, tag] of [[844, 'first'], [1900, 'full']]) {
      const ctx = await b.newContext({ viewport: { width: 390, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', timezoneId: 'Asia/Taipei', reducedMotion: 'reduce' });
      await ctx.addInitScript(() => { localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); localStorage.setItem('bq-walker-name', '小陳'); localStorage.setItem('bq-walker-codes', JSON.stringify(['abcdef123456'])); });
      const p = await ctx.newPage();
      await p.goto(`http://localhost:${port}/`); await p.locator('#main .card:not(.skeleton)').first().waitFor();
      await p.addStyleTag({ content: '#toast{display:none!important}' });
      await p.locator('#main .card', { hasText: '皮皮' }).first().locator('.name').tap();
      await p.locator('#detail .name').waitFor(); await p.waitForTimeout(500);
      // 功能開關在假後端是關的：補上「整理資料」會收進去的那幾個控制項，現在版攤開、改成版收起
      await p.evaluate(mode => {
        const d = document.querySelector('#detail');
        const tidy = ['＋補舊編號', '補入所介紹', '有人固定照顧', '設定休養中'];
        if (mode === 'now') {
          d.querySelector('[data-section="walks"]').insertAdjacentHTML('afterend', tidy.map(t => `<section class="detail-section"><button type="button" class="my-note-edit">${t}</button></section>`).join(''));
          return;
        }
        d.querySelector('.thumb-fallback').insertAdjacentHTML('beforeend', '<div class="mk-nophoto">還沒有照片<u>上傳照片</u></div>');
        const warn = [...document.querySelectorAll('#main .warn-note')].find(w => w.textContent.includes('曾咬人'));
        d.querySelector('.detail-head .info .meta').insertAdjacentElement('beforebegin', Object.assign(warn.cloneNode(true), { className: 'warn-note mk-warn' }));
        d.querySelector('[data-section="walks"]').insertAdjacentHTML('afterend', `<details class="mk-tidy"><summary>整理資料<span>補舊編號、入所介紹、固定照顧、休養中</span></summary></details>`);
      }, mode);
      if (mode === 'mock') await p.addStyleTag({ content: CSS });
      await p.waitForTimeout(300);
      await p.screenshot({ path: `${out}/detail-${mode}-${tag}.png` });
      await ctx.close();
    }
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
