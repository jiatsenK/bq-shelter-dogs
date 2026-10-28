const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 管理網站系統架構圖頁（K 2026-10-28）：docs/ARCHITECTURE.md 每一段照順序顯示，Mermaid 圖在正式 CSP 下有樣式、字沒有超出框；
// 建置沒畫出圖時改顯示 GitHub 連結；讀不到就說讀取失敗。
module.exports = async (browser, base) => {
  const { ADMIN_CSP } = await import('../worker/src/admin/index.js');
  const { DIAGRAMS, DIAGRAM_TITLES } = await import('../scripts/admin-diagrams.mjs');
  const built = JSON.parse(fs.readFileSync(path.join(__dirname, '../admin/public/shared/diagrams.json'), 'utf8'));
  const withDiagram = built.sections.filter(s => s.hasDiagram).map(s => s.name);
  assert.ok(withDiagram.length >= 4, '主圖、上線圖、兩個流程、元件圖都要有 Mermaid');
  assert.deepEqual(built.sections.filter(s => s.hasDiagram && !s.svg).map(s => s.name), [], '跑網頁測試時有無頭瀏覽器，每張圖都要畫成 SVG');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(`${event.effectiveDirective}: ${event.blockedURI}`));
  });
  let json = null, jsonCode = 200;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    const headers = type => ({ 'Content-Type': type, 'Content-Security-Policy': ADMIN_CSP });
    if (url.pathname === '/admin/public/diagrams.html') return route.fulfill({ body: fs.readFileSync(path.join(__dirname, '../admin/public/diagrams.html')), headers: headers('text/html') });
    if (url.pathname === '/admin/public/shared/diagrams.json' && jsonCode !== 200) return route.fulfill({ status: jsonCode, body: '' });
    if (url.pathname === '/admin/public/shared/diagrams.json' && json) return route.fulfill({ body: JSON.stringify(json), headers: headers('application/json') });
    return route.continue();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/admin/public/diagrams.html`);
    await page.waitForFunction(n => document.querySelectorAll('#diagrams svg').length === n, withDiagram.length);
    assert.deepEqual(await page.locator('#diagrams section').evaluateAll(s => s.map(x => x.id)), DIAGRAMS.map(n => `diagram-${n}`), '順序照 docs/ARCHITECTURE.md');
    assert.deepEqual(await page.locator('#diagrams h2').allTextContents(), DIAGRAMS.map(n => DIAGRAM_TITLES[n]));
    assert.deepEqual(await page.locator('#diagram-jump a').evaluateAll(a => a.map(x => x.getAttribute('href'))), DIAGRAMS.map(n => `#diagram-${n}`));
    assert.match(await page.locator('#diagram-status').textContent(), new RegExp(`共 ${DIAGRAMS.length} 段`));
    assert.match(await page.locator('#diagram-version').textContent(), /^(第 \d+ 版 · \d{4}\/\d{2}\/\d{2} 更新|版本與日期要正式部署後才看得到) · 核對日 \d{4}\/\d{2}\/\d{2}（依據 main [0-9a-f]{7,}）$/);
    assert.equal(await page.locator('#diagram-source a').getAttribute('href'), built.doc.url);
    assert.equal(await page.locator('.diagram-missing').count(), 0);
    // 說明的 `路徑:行號` 顯示成 <code>
    assert.ok(await page.locator('#diagram-architecture .diagram-notes code').count() > 5);

    // 拆出去的 CSS 有套上（Mermaid 的框線、classDef 顏色）、自架字型有載入
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('#diagram-architecture g.node rect').first().evaluate(r => getComputedStyle(r).fill), 'rgb(236, 236, 255)');
    assert.ok(await page.evaluate(() => document.fonts.check('16px Geist')), '字型載入');
    // 每個方塊的字都在方塊裡（字寬是建置時量的，字型不同會超出框）
    const overflow = await page.evaluate(() => [...document.querySelectorAll('#diagrams g.node')].flatMap(node => {
      const shape = node.querySelector('rect, path, polygon, circle'), label = node.querySelector('g.label');
      if (!shape || !label) return [];
      const a = shape.getBoundingClientRect(), b = label.getBoundingClientRect();
      return b.left < a.left - 1 || b.right > a.right + 1 || b.top < a.top - 1 || b.bottom > a.bottom + 1 ? [node.closest('section').id + ' ' + label.textContent.slice(0, 20)] : [];
    }));
    assert.deepEqual(overflow, [], '方塊的字超出框');
    // marker 都指到同一張圖裡的
    const broken = await page.evaluate(() => [...document.querySelectorAll('#diagrams [marker-end]')].filter(el => {
      const id = (el.getAttribute('marker-end').match(/url\(#(.+)\)/) || [])[1];
      return !id || !el.closest('section').querySelector(`marker[id="${id}"]`);
    }).length);
    assert.equal(broken, 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '1440px 不溢出');
    assert.deepEqual(await page.evaluate(() => window.cspViolations), [], '圖的樣式不能被 CSP 擋');
    const shots = path.join(__dirname, '../.impeccable/review');
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'diagrams-1440.png'), fullPage: true });

    // 建置時沒畫出圖：每張改顯示 GitHub 連結，說明照樣顯示
    json = { ...built, sections: built.sections.map(s => ({ ...s, svg: null })) };
    await page.reload();
    await page.waitForFunction(n => document.querySelectorAll('.diagram-missing').length === n, withDiagram.length);
    assert.equal(await page.locator('#diagrams svg').count(), 0);
    assert.equal(await page.locator('.diagram-missing a').first().getAttribute('href'), built.doc.url);
    assert.match(await page.locator('#diagram-status').textContent(), new RegExp(`${withDiagram.length} 張圖這次沒畫出來`));
    assert.equal(await page.locator('#diagrams .diagram-notes').count(), DIAGRAMS.length);

    // 讀不到就說讀取失敗
    json = null; jsonCode = 500;
    await page.reload();
    await page.waitForFunction(() => document.getElementById('diagram-status').dataset.error === 'true');
    assert.equal(await page.locator('#diagrams section').count(), 0);

    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    assert.deepEqual(errors, []);
    console.log('系統架構圖：每段照順序、正式 CSP 下 Mermaid 圖樣式與字型生效、字不超出框、沒畫出圖時給 GitHub 連結、讀取失敗提示');
  } finally {
    await context.close();
  }
};
