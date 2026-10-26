const assert = require('node:assert/strict');

// 單手操作規範（docs/DESIGN_GUIDE.md）：手機 390、360 寬時，志工版主要畫面的可點元素至少 44×44px、相鄰兩個至少隔 8px。
// 有效範圍含 ::before／::after 擴大的點擊範圍。既有違規列在 KNOWN，at 是現在量到的值（尺寸取短邊、間距取距離；
// 靠字型行高撐高度的取 CI 的 Linux 字型量到的較小值）：
// 比 at 更差算新違規；修好後要從 KNOWN 拿掉，否則測試失敗。
const MIN = 44, GAP = 8;
const KNOWN = [
  { kind: 'size', match: /^#formerAdd$/, at: 32, ticket: '#647', note: '詳細資訊「＋補舊編號」32px 高' },
  { kind: 'size', match: /^button\.my-note-edit\.append-open$/, at: 36, ticket: '#647', note: '詳細資訊「加備註」36～38px 高（依字型）' },
  { kind: 'size', match: /^a\.group-page-link$/, at: 30, ticket: '#647', note: '詳細資訊「看全部狗群」30～32px 高（依字型）' },
  { kind: 'size', match: /^#whereClose$/, at: 40, ticket: '#647', note: '「在哪」關閉 40×40' },
  { kind: 'gap', match: /^button\.chip ↔ button\.chip\.on$/, at: 4, ticket: '#647', note: '全部／我的常溜相距 4px' },
  { kind: 'gap', match: /^button(\.on)?\[data-walk-view=(list|photo)\] ↔ button(\.on)?\[data-walk-view=(list|photo)\]$/, at: 2, ticket: '#647', note: '照片／列表切換相距 2px' },
  { kind: 'gap', match: /^button(\.active)?\[data-tab=\w+\] ↔ button(\.active)?\[data-tab=\w+\]$/, at: 6, ticket: '#647', note: '底部分頁相距 6px' },
  { kind: 'gap', match: /^button\.ob-later ↔ button\.ob-next$/, at: 6, ticket: '#647', note: '開頭畫面「先看看」與「下一步」相距 6px' },
  { kind: 'gap', match: /^button(\.r-cage)?\.cage-pill ↔ div\.(card|row-dog)(\.flagged)?$/, at: 0, ticket: '#644', note: '籠位擴大範圍貼到隔壁狗卡（360 寬照片模式 0px）' },
  { kind: 'gap', match: /^button\.r-cage\.cage-pill ↔ button\.r-cage\.cage-pill$/, at: 7.5, ticket: '#644', note: '列表上下兩列籠位擴大範圍相距 7.5px' },
  { kind: 'gap', match: /^button\.walk-btn(\.done)? ↔ div\.row-dog(\.flagged)?$/, at: 7, ticket: '#647', note: '列表「溜了」「已溜」離隔壁列 7～7.5px' },
  { kind: 'gap', match: /^#photoPick ↔ button\.thumb\.zoom$/, at: -60, ticket: '#647', note: '詳細資訊相機鈕疊在照片上' },
  { kind: 'gap', match: /^button\.buddy ↔ button\.pick$/, at: -31, ticket: '#647', note: '同行狗勾選框疊在狗名格上' },
  { kind: 'gap', match: /^button\.gw-dog ↔ button\.gw-dog$/, at: 5, ticket: '#647', note: '常遛狗群狗卡相距 5px' },
];

module.exports = async (browser, base) => {
  const data = structuredClone(require('./fixtures/dogs.json'));
  const today = '2026-10-20', cages = ['新5B', '新7A', '舊3-1', 'C1', '新2C', '舊5-2'];
  data.dogs.forEach((d, i) => { d.walkedDate = `2026-10-${String(20 - (i % 8) - 1).padStart(2, '0')}`; d.covered = false; d.cage = cages[i % cages.length]; });
  data.dogs[0].note = '不親狗，要單獨溜';
  data.groupColumns = [{ column: 1, label: '測試群', names: data.dogs.slice(0, 6).map(d => d.name) }];
  const found = [];
  for (const [width, height] of [[390, 844], [360, 740]]) {
    for (const firstVisit of [true, false]) {
      let pack = { ok: true, source: 'd1', date: today, version: 0, walks: [] };
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce', timezoneId: 'Asia/Taipei', serviceWorkers: 'block' });
      await ctx.addInitScript(firstVisit ? () => {} : () => { localStorage.setItem('bq-onboarded', '1'); localStorage.setItem('bq-name-later', '1'); localStorage.setItem('bq-walker-name', '甲'); });
      await ctx.route('**/*', route => {
        const req = route.request(), u = new URL(req.url());
        if (u.origin !== base) return route.abort();
        if (u.pathname.includes('/photos/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#DDE9E3"/></svg>' });
        if (!u.pathname.includes('/api/')) return route.continue();
        const endpoint = u.pathname.split('/api/')[1];
        if (endpoint === 'walk') { // D1 直接接受，讓提示條和「一起溜的人」出現
          const sent = req.postDataJSON(), at = `${today}T04:00:00Z`;
          const rows = sent.dogs.map(d => ({ key: d.id, version: pack.version + 1, walkedDate: today, walker: '甲', syncStatus: 'pending', at }));
          pack = { ...pack, version: pack.version + 1, walks: [...pack.walks, ...rows] };
          return route.fulfill({ json: { ok: true, source: 'd1', today, snapshot: pack, results: sent.dogs.map((d, i) => ({ ...d, status: 'written', accepted: true, requestId: sent.requestId, operationDate: today, version: rows[i].version, current: { date: today, walker: '甲' }, syncStatus: 'pending', at })) } });
        }
        return route.fulfill({ json: endpoint === 'dogs' ? data : endpoint === 'today' ? pack : endpoint === 'rest' ? { rest: {} } : endpoint === 'walkers' ? { walkers: {}, dates: {}, names: ['甲'] } : { ok: true, source: 'd1', walks: [], departures: [] } });
      });
      const page = await ctx.newPage();
      const check = async (screen, root = 'body') => {
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        for (const v of await page.evaluate(measure, { root, MIN, GAP })) found.push({ ...v, where: `${width}px ${screen}` });
      };
      const walkFirst = async (screen, card) => {
        await page.locator(`${card} .walk-btn:not(.done)`).first().tap();
        await page.locator('#toast:not([hidden]) .toast-extra:not([hidden])').waitFor();
        await check(screen);
      };
      try {
        await page.clock.install({ time: new Date(`${today}T04:00:00Z`) });
        await page.goto(base + '/public/index.html');
        if (firstVisit) {
          await page.locator('#obInput').waitFor();
          await check('開頭畫面');
          continue;
        }
        await page.locator('#main .card:not(.skeleton)').first().waitFor();
        await check('溜狗表照片');
        await walkFirst('照片按溜了後', '#main .card:not(.skeleton)');
        await page.locator('#toast .toast-extra').tap();
        await page.locator('.with-sheet').waitFor();
        await check('一起溜的人', '.with-sheet');
        await page.locator('[data-with-cancel]').tap();
        await page.locator('.with-sheet').waitFor({ state: 'detached' });
        await page.locator('[data-walk-view="list"]').tap();
        await page.locator('#main .row-dog').first().waitFor();
        await check('溜狗表列表');
        await walkFirst('列表按溜了後', '#main .row-dog');
        await page.locator('[data-walk-view="photo"]').tap();
        await page.locator('#main .card:not(.skeleton) .last').first().tap(); // 點照片開大圖、點狗名在 390 寬會開成「在哪」（#644），點天數欄開詳細資訊
        await page.locator('#detail .detail-bar').waitFor();
        await check('詳細資訊', '#detail');
        await page.keyboard.press('Escape');
        await page.locator('#detail').waitFor({ state: 'hidden' });
        await page.locator('#main .card:not(.skeleton) .cage-pill').first().tap();
        await page.locator('#whereSheet').waitFor();
        await check('在哪', '#whereSheet');
        await page.keyboard.press('Escape');
        await page.locator('#whereSheet').waitFor({ state: 'hidden' });
        for (const [tab, name, ready] of [['groups', '常遛狗群', '#groupStage'], ['mine', '我溜過', '#main'], ['info', '資訊', '#main .a-card']]) {
          await page.locator(`#tabs [data-tab="${tab}"]`).tap();
          await page.locator(ready).first().waitFor();
          await check(name);
        }
      } finally { await ctx.close(); }
    }
  }
  const listed = v => KNOWN.find(k => k.kind === v.kind && k.match.test(v.key) && v.value >= k.at - 0.5);
  const newViolations = [...new Set(found.filter(v => !listed(v)).map(v => `${v.where}：${v.text}`))];
  const fixed = KNOWN.filter(k => !found.some(v => listed(v) === k)).map(k => `${k.kind} ${k.match}（${k.ticket}）`);
  assert.deepEqual(newViolations, [], `手機點擊目標小於 ${MIN}px 或間距小於 ${GAP}px（或比 KNOWN 記的更差）：\n${newViolations.join('\n')}`);
  assert.deepEqual(fixed, [], `已修好，請從 tests/touch-targets.cjs 的 KNOWN 拿掉：\n${fixed.join('\n')}`);
  console.log('手機點擊目標 44px、間距 8px 通過');
};

// 在頁面裡執行：回傳 root 底下可見可點元素的尺寸與間距違規。
function measure({ root, MIN, GAP }) {
  const scope = document.querySelector(root);
  const selector = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [tabindex]:not([tabindex="-1"])';
  // 所在的捲動層：固定在畫面上的都算同一層；黏住的容器、可捲動區各自一層。不同層的距離會隨捲動改變，不互相比較
  const layerOf = el => {
    for (let e = el.parentElement; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.position === 'fixed') return 'viewport';
      if (s.position === 'sticky' || (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight)) return e;
    }
    return null;
  };
  const px = v => (/^-?[\d.]+px$/.test(v) ? parseFloat(v) : null);
  // 偽元素的 inset 從宿主的 padding box 算；宿主沒定位時偽元素不在它身上，不採用
  const area = el => {
    const r = el.getBoundingClientRect();
    let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    if (getComputedStyle(el).position === 'static') return box;
    const pad = { left: r.left + el.clientLeft, top: r.top + el.clientTop, right: r.left + el.clientLeft + el.clientWidth, bottom: r.top + el.clientTop + el.clientHeight };
    for (const pseudo of ['::before', '::after']) {
      const s = getComputedStyle(el, pseudo);
      if (s.content === 'none' || s.position !== 'absolute' || s.pointerEvents === 'none') continue;
      const [t, rt, b, l] = [s.top, s.right, s.bottom, s.left].map(px);
      if ([t, rt, b, l].some(v => v === null)) continue;
      box = { left: Math.min(box.left, pad.left + l), top: Math.min(box.top, pad.top + t), right: Math.max(box.right, pad.right - rt), bottom: Math.max(box.bottom, pad.bottom - b) };
    }
    return box;
  };
  const keyOf = el => el.id ? `#${el.id}` : el.tagName.toLowerCase() + [...el.classList].slice(0, 2).map(c => '.' + c).join('')
    + (el.dataset.tab ? `[data-tab=${el.dataset.tab}]` : '') + (el.dataset.walkView ? `[data-walk-view=${el.dataset.walkView}]` : '');
  const labelOf = el => (el.getAttribute('aria-label') || el.textContent || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 16);
  const targets = [...scope.querySelectorAll(selector)]
    // 整張可點的卡片裡、鍵盤到不了的按鈕（狗卡的狗名，#644）跟卡片做同一件事，算卡片的一部分，不另外量
    .filter(el => !(el.tabIndex === -1 && el.parentElement.closest('[role=button]')))
    .filter(el => !el.closest('[hidden], [inert]') && el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && getComputedStyle(el).pointerEvents !== 'none')
    .map(el => ({ el, box: area(el), layer: layerOf(el), key: keyOf(el), label: labelOf(el) }))
    .filter(t => t.box.right - t.box.left > 0 && t.box.bottom - t.box.top > 0);
  const out = [];
  for (const t of targets) {
    const w = t.box.right - t.box.left, h = t.box.bottom - t.box.top;
    if (w < MIN - 0.05 || h < MIN - 0.05) out.push({ kind: 'size', key: t.key, value: Math.min(w, h), text: `${t.key}「${t.label}」${w.toFixed(1)}×${h.toFixed(1)}` });
  }
  for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
    const a = targets[i], b = targets[j];
    if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const dx = Math.max(b.box.left - a.box.right, a.box.left - b.box.right), dy = Math.max(b.box.top - a.box.bottom, a.box.top - b.box.bottom);
    // 同一種整列項目（狗卡、資訊頁選單）上下相連、只有分隔線，是一般列表排法，不比間距
    const listRows = [a, b].every(t => t.box.right - t.box.left >= innerWidth * 0.8) && a.el.tagName === b.el.tagName
      && a.el.classList[0] === b.el.classList[0] && dx < 0 && dy >= -0.5;
    const gap = Math.max(dx, dy);
    if (!listRows && gap < GAP - 0.05) {
      const [x, y] = [a, b].sort((p, q) => (p.key < q.key ? -1 : 1));
      out.push({ kind: 'gap', key: `${x.key} ↔ ${y.key}`, value: gap, text: `${x.key}「${x.label}」↔ ${y.key}「${y.label}」相距 ${gap.toFixed(1)}px` });
    }
  }
  return out;
}
