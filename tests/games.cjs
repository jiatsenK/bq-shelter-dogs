const assert = require('node:assert/strict');
const zlib = require('node:zlib');

// #795 小遊戲：用假的 /api/dogs、假的臉部位置檔和純色照片，實際玩一局
const SIZE = 600;
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}
// 一隻狗一個顏色的 PNG，長相（4×4 色塊）才分得出來
function png([r, g, b]) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(SIZE, 0); head.writeUInt32BE(SIZE, 4); head[8] = 8; head[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: SIZE }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(SIZE).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

const FACE = { le: [0.4, 0.45], re: [0.6, 0.45], nose: [0.5, 0.55], lip: [0.5, 0.6], chin: [0.5, 0.68], top: [0.5, 0.3] };
const PLAYABLE = Array.from({ length: 12 }, (_, i) => ({ id: `20200101${String(i).padStart(2, '0')}`, name: `變裝狗${i + 1}`, cage: 'A1', sex: 'male' }));
const CHANGED = { id: '2021010100', name: '換照片狗', cage: 'B1' };   // 臉部位置是舊照片算的
const PENDING = { id: '2021010101', name: '（暫定）', cage: 'B2' };   // 名字還是暫定
const NO_FACE = { id: '2021010102', name: '沒算位置', cage: 'B3' };   // 臉部位置檔沒有
const DEPARTED = '2021010103';                                        // 臉部位置檔有，但已經不在所
const ALL = [...PLAYABLE, CHANGED, PENDING, NO_FACE];
const dogs = { version: 1, syncedAt: '2026-10-30T00:00:00Z', dogs: ALL, groups: {}, sheetNotes: [],
  photoVersions: Object.fromEntries(ALL.flatMap(d => [[`photos/${d.id}.jpg`, `v${d.id}`], [`photos/thumbs/${d.id}.jpg`, `t${d.id}`]])) };
const faces = Object.fromEntries([...PLAYABLE, PENDING, { id: DEPARTED }].map(d => [d.id, { photoVersion: `v${d.id}`, ...FACE }]));
faces[CHANGED.id] = { photoVersion: 'old', ...FACE };
const NAMES = Object.fromEntries(ALL.map(d => [d.id, d.name]));
const BLOCKED = [CHANGED.id, PENDING.id, NO_FACE.id, DEPARTED];
const KEYS = ['showActivities', 'showQuality', 'showUpdates', 'editIntro', 'editPhoto', 'editRest', 'editActivity', 'editFixedCare', 'editStays', 'showShare'];

module.exports = async (browser, base) => {
  async function open({ colorScheme = 'light', width = 390, brokenPhotos = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      localStorage.setItem('bq-onboarded', '1');
      localStorage.setItem('bq-name-later', '1');
      window.__BQ_FEATURE_TEST__ = true;
    });
    const photos = [];
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin !== base) return route.abort();
      assert.equal(route.request().method() === 'GET' || route.request().method() === 'HEAD', true, '小遊戲不寫入');
      const photo = u.pathname.match(/\/photos\/(?:thumbs\/)?(\d+)\.jpg$/);
      if (photo) {
        photos.push(photo[1]);
        if (brokenPhotos && !u.pathname.includes('/thumbs/')) return route.fulfill({ status: 404, body: '' });
        const i = Number(photo[1].slice(-2));
        return route.fulfill({ contentType: 'image/png', body: png([(i * 53) % 256, (i * 97) % 256, (i * 151) % 256]) });
      }
      if (u.pathname.endsWith('/data/dog-faces.json')) return route.fulfill({ json: faces });
      if (!u.pathname.includes('/api/')) return route.continue();
      const endpoint = u.pathname.split('/api/')[1];
      if (endpoint === 'feature-settings') return route.fulfill({ json: { ok: true, revision: 1, shareUrl: 'https://share.example', values: Object.fromEntries(KEYS.map(k => [k, true])) } });
      const json = endpoint === 'dogs' ? dogs : endpoint === 'departures/index' ? { departures: [], years: {} } : endpoint === 'activities' ? { ok: true, activities: [] } : { rest: {}, walkers: [], walks: [] };
      return route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
    return { context, page, photos, errors };
  }

  const answerOf = async page => NAMES[(await page.locator('#gPic').getAttribute('src')).match(/photos\/(\d+)\.jpg/)[1]];
  const visible = async (page, id) => page.locator('#' + id).isVisible();
  // 單手操作（DESIGN_GUIDE）：看得到的按鈕、連結至少 44×44、相鄰至少隔 8px；授權標註是內文裡的連結，不算
  const touchTargets = async (page, screen) => {
    const bad = await page.evaluate(id => {
      const els = [...document.querySelectorAll(`#${id} :is(button, a)`)].filter(e => e.offsetParent && !e.closest('.g-credit'));
      const r = els.map(e => e.getBoundingClientRect()), name = e => e.id || e.textContent.trim();
      const out = r.flatMap((b, i) => (Math.min(b.width, b.height) < 44 ? [`${name(els[i])} ${Math.round(b.width)}×${Math.round(b.height)}`] : []));
      for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
        const gap = Math.max(r[j].left - r[i].right, r[i].left - r[j].right, r[j].top - r[i].bottom, r[i].top - r[j].bottom);
        if (gap < 8) out.push(`${name(els[i])} ↔ ${name(els[j])} 隔 ${Math.round(gap)}px`);
      }
      return out;
    }, screen);
    assert.deepEqual(bad, [], `${screen} 點擊目標`);
  };

  // 資訊頁 → 小遊戲選單 → 玩一局 → 結算 → 分享 → 返回
  {
    const { context, page, photos, errors } = await open();
    await page.goto(base + '/public/index.html');
    await page.locator('#main .card').first().waitFor();
    await page.locator('[data-tab="info"]').click();
    const entry = page.locator('.info-home [data-games]');
    assert.equal((await entry.innerText()).split('\n')[0], '小遊戲');
    assert.deepEqual((await page.locator('.info-home strong').allTextContents()).slice(-3), ['小遊戲', '分享網站連結', '使用說明']);
    await entry.click();
    await page.waitForURL(/games\.html$/);
    await page.locator('#gDressUp:not([disabled])').waitFor();
    assert.equal(await page.locator('#gDressUp').innerText(), '開始玩');
    assert.equal(await page.locator('.g-feature h2').innerText(), '狗狗變裝秀');
    assert.equal(await page.locator('.g-intro').innerText(), '考驗乾爹乾媽們，在狗狗們變裝後，還能認出幾成？');
    assert.equal(await page.locator('#gHubBest').isVisible(), false, '還沒玩過不顯示最高分');
    await page.waitForFunction(() => document.querySelectorAll('#gCoverDeco svg').length > 0); // 封面是一隻變裝狗
    assert.equal((await page.locator('.g-soon').innerText()).replace(/\s+/g, ''), '更多遊戲準備中');
    await touchTargets(page, 'gHub');
    assert.equal(await page.locator('.g-credit a[href*="creativecommons.org/licenses/by-nc/4.0"]').count(), 1, '模型授權標註');
    assert.equal(await visible(page, 'gPlay'), false, '藏起來的畫面真的不顯示');
    assert.equal(await visible(page, 'gEnd'), false);

    await page.locator('#gDressUp').click();
    assert.equal(new URL(page.url()).hash, '#dressup');
    const missed = [];
    const seen = new Set();
    for (let i = 1; i <= 10; i++) {
      await page.locator('#gNo', { hasText: new RegExp(`^${i}$`) }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('#gDeco svg').length > 0);
      const decos = await page.locator('#gDeco svg').count();
      assert(decos >= 1 && decos <= 3, `裝飾 1 到 3 個：${decos}`);
      const answer = await answerOf(page);
      assert(!seen.has(answer), '題目不重複');
      seen.add(answer);
      const opts = await page.locator('#gOpts button').allTextContents();
      assert.equal(opts.length, 4);
      assert(opts.includes(answer), '答案在選項裡');
      assert.equal(new Set(opts).size, 4, '選項名字不重複');
      for (const name of opts) assert(!['換照片狗', '（暫定）', '沒算位置'].includes(name), `不能出題的狗不當選項：${name}`);
      if (i === 1) await touchTargets(page, 'gPlay');
      const pick = i <= 7 ? answer : opts.find(n => n !== answer);
      if (pick !== answer) missed.push(answer);
      await page.locator('#gOpts').getByRole('button', { name: pick, exact: true }).click();
      await page.locator('#gSay', { hasText: new RegExp(`^${pick === answer ? '答對了！' : `牠是${answer}`}$`) }).waitFor();
      assert.equal(await page.locator('#gPhoto').getAttribute('class'), 'g-photo revealed', '答完卸妝');
      assert.equal(await page.locator(`#gSteps li:nth-child(${i})`).getAttribute('class'), pick === answer ? 'ok' : 'no', '10 格記答對答錯');
    }
    await page.locator('#gEnd').waitFor();
    assert.equal(await visible(page, 'gPlay'), false);
    assert.equal(await page.locator('#gEndLine').innerText(), '認出 7 / 10 隻');
    const score = Number(await page.locator('#gEndScore').innerText());
    assert(score >= 700 && score <= 1400, `分數：${score}`);
    assert.equal(await page.locator('#gBest').innerText(), '新紀錄！');
    assert.equal(await page.locator('#gEndSteps li.ok').count(), 7);
    assert.equal(await page.locator('#gEndSteps li.no').count(), 3);
    await touchTargets(page, 'gEnd');
    assert.equal(await page.evaluate(() => localStorage.getItem('bq-game-dressup-best')), String(score));
    assert.deepEqual(await page.locator('#gMissed figcaption').allTextContents(), missed);
    assert.equal(await page.locator('#gMissed img').count(), 3);
    for (const id of BLOCKED) assert(!photos.includes(id), `不能出題的狗不讀照片：${id}`);

    const line = new URL(await page.locator('#gLine').getAttribute('href'));
    assert.equal(line.origin + line.pathname, 'https://line.me/R/share');
    assert.equal(line.searchParams.get('text'), `我在「狗狗變裝秀」認出 7 / 10 隻變裝的板收狗狗，拿到 ${score} 分！換你來試試 ${base}/public/games.html#dressup`);

    await page.locator('#gShot').click();
    await page.locator('#gSheet').waitFor();
    await page.waitForFunction(() => document.getElementById('gSheetImg').naturalWidth > 0);
    assert.deepEqual(await page.evaluate(() => [document.getElementById('gSheetImg').naturalWidth, document.getElementById('gSheetImg').naturalHeight]), [1080, 1440]);
    await page.goBack(); // 手機返回鍵先關截圖
    await page.locator('#gSheet').waitFor({ state: 'hidden' });
    assert.equal(await visible(page, 'gEnd'), true);

    // 再玩一次，遊戲中按左上角返回：回選單，之後不再跳題
    await page.locator('#gAgain').click();
    await page.locator('#gNo', { hasText: /^1$/ }).waitFor();
    await page.locator('#gOpts button').first().click();
    await page.locator('#gBack').click();
    await page.locator('#gHub').waitFor();
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.locator('#gHubBest').innerText(), `你的最高分 ${score}`, '選單顯示最高分');
    await page.waitForTimeout(2000);
    assert.equal(await visible(page, 'gPlay'), false, '返回後不會再跳題');
    assert.equal(await visible(page, 'gEnd'), false);

    // 手機返回鍵：遊戲中回選單，選單再返回回資訊頁
    await page.locator('#gDressUp').click();
    await page.locator('#gPlay').waitFor();
    await page.goBack();
    await page.locator('#gHub').waitFor();
    assert.equal(await visible(page, 'gPlay'), false);
    await page.locator('#gBack').click();
    await page.waitForURL(/index\.html#info$/);
    await page.locator('.info-home [data-games]').waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 分享連結直接打開：馬上開始，返回回選單；選單的返回去資訊頁
  {
    const { context, page, errors } = await open();
    await page.goto(base + '/public/games.html#dressup');
    await page.locator('#gPlay').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#gDeco svg').length > 0);
    await page.locator('#gBack').click();
    await page.locator('#gHub').waitFor();
    await page.locator('#gBack').click();
    await page.waitForURL(/index\.html#info$/);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 照片讀不到：顯示提示，不卡在空白畫面
  {
    const { context, page } = await open({ brokenPhotos: true });
    await page.goto(base + '/public/games.html');
    await page.locator('#gDressUp:not([disabled])').click();
    await page.locator('#gPicErr').waitFor();
    assert.equal(await page.locator('#gOpts button').count(), 4);
    await context.close();
  }

  // 深色模式和電腦版：照樣是淺色、看得清楚；電腦版照片在左、選項在右；電腦版資訊頁也有入口
  {
    const { context, page } = await open({ colorScheme: 'dark', width: 1440 });
    await page.goto(base + '/public/games.html');
    await page.locator('#gDressUp:not([disabled])').waitFor();
    const look = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.body).color, main: document.querySelector('.g-main').getBoundingClientRect().width }));
    assert.equal(look.bg, 'rgb(227, 233, 229)');
    assert.equal(look.ink, 'rgb(22, 33, 29)');
    assert(look.main > 480 && look.main <= 1040, `遊戲寬度：${look.main}`);
    const line = await page.evaluate(() => ({ head: document.querySelector('.g-head').getBoundingClientRect().height,
      back: document.getElementById('gBack').getBoundingClientRect().left + 10, content: document.querySelector('.g-feature').getBoundingClientRect().left }));
    assert.equal(line.head, 64, '頁首 64px');
    assert(Math.abs(line.back - line.content) <= 1, `返回鍵與內容同一條左邊線：${line.back}、${line.content}`);
    await page.locator('#gDressUp').click();
    await page.waitForFunction(() => document.querySelectorAll('#gDeco svg').length > 0);
    const [photo, opts] = await page.evaluate(() => ['.g-photo', '#gOpts'].map(s => document.querySelector('#gPlay ' + s).getBoundingClientRect().toJSON()));
    assert(opts.left >= photo.right && opts.top < photo.bottom, '電腦版選項在照片右邊');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '沒有橫向捲動');
    await page.goto(base + '/public/index.html#info');
    await page.locator('.info-nav [data-games]').waitFor();
    assert.equal(await page.locator('.info-nav [data-games]').getAttribute('href'), 'games.html');
    await context.close();
  }
};
