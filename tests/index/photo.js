// #46 照片燈箱：會開關燈箱、動到瀏覽器上一頁紀錄，所以也一項一項跑
// 照片測試走檔案選擇、預覽與確認按鈕，不讀取編輯器內部狀態。
const previewUrl = () => document.querySelector('#detail .photo-preview')?.getAttribute('src') || null;
const previewBlob = async () => (await fetch(previewUrl())).blob();
const cropIsOpen = () => !!document.getElementById('cropper') && !document.getElementById('cropper').hidden;
async function photoUntil(ok, what) {
  for (let i = 0; i < 200; i++) { if (ok()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('等不到' + what);
}
async function selectPhoto(file) {
  BQWalkUI.hideToast();
  document.getElementById('photoPick').click();
  const input = document.getElementById('photoFile');
  const files = new DataTransfer(); files.items.add(file); input.files = files.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await photoUntil(() => previewUrl() || !document.getElementById('toast').hidden, '照片預覽或錯誤');
}
async function confirmPhoto() {
  document.getElementById('photoConfirm').click();
  await photoUntil(() => !document.getElementById('photoConfirm')?.disabled, '上傳結果');
}
function cancelPhoto() { document.getElementById('photoCancel')?.click(); }

async function runPhotoTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords];
  const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const box = document.getElementById('main').parentElement;
  const lb = () => document.getElementById('lightbox');
  const isOpen = () => !!lb() && !lb().hidden;
  // 關燈箱走「上一頁」，等 popstate 處理完
  const popped = () => new Promise(r => window.addEventListener('popstate', () => setTimeout(r, 0), { once: true }));
  const cardOf = i => document.querySelector(`#main .card[data-dog="${i}"]`);
  try {
    box.classList.remove('hidden'); // 真瀏覽器裡 display:none 的元素不能拿到焦點
    allDogs = [
      { id: '9101', name: '照片甲', cage: 'A01', note: '', covered: false, walkedDate: null },
      { id: '9102', name: '照片乙', cage: 'A02', note: '', covered: false, walkedDate: null },
      { id: '', name: '照片丙', cage: 'A03', note: '', covered: false, walkedDate: null },
    ];
    photoOverrides['9101'] = PX; photoOverrides['9102'] = PX;
    groupMap = {}; activeTab = 'walk'; searchQuery = '';
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
    render();
    await check('#46 點狗卡照片開燈箱、不開詳細資訊；點關閉按鈕關掉；點卡片其他地方照舊開詳細資訊', async () => {
      cardOf(0).querySelector('.thumb img').click();
      eq(isOpen(), true, '燈箱打開：');
      eq(detailDog, null, '不開詳細資訊：');
      eq(lb().querySelector('img').getAttribute('src'), PX, '大圖：');
      eq(document.activeElement === lb().querySelector('.lightbox-close'), true, '焦點在關閉按鈕：');
      const p = popped(); lb().querySelector('.lightbox-close').click(); await p;
      eq(isOpen(), false, '按關閉後：');
      cardOf(0).querySelector('.name').click();
      eq(detailDog === allDogs[0], true, '點犬名開詳細資訊：');
      hideDetail();
    });
    await check('#46 點背景關燈箱，點大圖本身不關；Esc 也能關', async () => {
      cardOf(1).querySelector('.thumb img').click();
      const big = lb().querySelector('img');
      if (!big.complete) await new Promise(r => big.addEventListener('load', r, { once: true }));
      const r = big.getBoundingClientRect();
      const at = (x, y) => big.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      at(r.left + r.width / 2, r.top + r.height / 2); // 正方形照片畫在正中間
      eq(isOpen(), true, '點大圖不關：');
      if (Math.abs(r.width - r.height) > 20) { // 畫面不是正方形時，照片旁邊的留白算背景
        const p0 = popped();
        r.width > r.height ? at(r.left + 5, r.top + r.height / 2) : at(r.left + r.width / 2, r.top + 5);
        await p0;
        eq(isOpen(), false, '點照片旁留白關：');
        cardOf(1).querySelector('.thumb img').click();
      }
      let p = popped(); lb().click(); await p;
      eq(isOpen(), false, '點背景關：');
      cardOf(1).querySelector('.thumb img').click();
      p = popped(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await p;
      eq(isOpen(), false, 'Esc 關：');
    });
    await check('#46 詳細資訊上方照片可放大；Esc、返回只關燈箱，詳細資訊還在', async () => {
      showDetail(allDogs[0]);
      const zoom = document.querySelector('#detail [data-zoom]');
      eq(zoom && zoom.tagName, 'BUTTON', '照片是按鈕：');
      zoom.click();
      eq(isOpen(), true, '燈箱打開：');
      let p = popped(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await p;
      eq([isOpen(), detailDog === allDogs[0]], [false, true], 'Esc 後燈箱關、詳細資訊在：');
      eq(document.activeElement === document.querySelector('#detail [data-zoom]'), true, '焦點回到照片：');
      zoom.click();
      p = popped(); history.back(); await p;
      eq([isOpen(), detailDog === allDogs[0]], [false, true], '返回後燈箱關、詳細資訊在：');
      hideDetail();
    });
    await check('#46 沒照片（沒編號或照片讀不到）點照片位置照舊開詳細資訊', async () => {
      cardOf(2).querySelector('.thumb').click();
      eq([isOpen(), detailDog === allDogs[2]], [false, true], '沒編號：');
      hideDetail();
      delete photoOverrides['9102'];
      render();
      const img = cardOf(1).querySelector('.thumb img');
      img.dispatchEvent(new Event('error')); // 模擬縮圖、原圖 photos/9102.jpg 都不存在
      img.dispatchEvent(new Event('error'));
      img.parentElement.click();
      eq([isOpen(), detailDog === allDogs[1]], [false, true], '照片讀不到：');
      const zoom = document.querySelector('#detail [data-zoom]');
      zoom.querySelector('img').dispatchEvent(new Event('error'));
      zoom.querySelector('img').dispatchEvent(new Event('error'));
      eq(zoom.disabled, true, '詳細資訊照片讀不到就不能按：');
      hideDetail();
    });
    // ── #48 上傳／更換照片 ──
    const savedUrl = UPLOAD_URL;
    const tick = () => new Promise(r => setTimeout(r, 0));
    // 做一張測試用照片檔（寬 w、高 h）
    const makeFile = (w, h, type = 'image/png') => new Promise(r => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#3a7'; ctx.fillRect(0, 0, w, h);
      c.toBlob(b => r(new File([b], 'dog.png', { type })), type);
    });
    const blobSize = blob => new Promise((r, j) => { const img = new Image(); img.onload = () => r([img.naturalWidth, img.naturalHeight]); img.onerror = j; img.src = URL.createObjectURL(blob); });
    const toastText = () => { const t = document.getElementById('toast'); return t && !t.hidden ? t.querySelector('.toast-text').textContent : ''; };
    try {
      await check('#48 上傳服務沒設定網址時不顯示上傳按鈕；設定後有編號的狗才有', async () => {
        UPLOAD_URL = '';
        showDetail(allDogs[0]);
        eq(document.getElementById('photoPick'), null, '沒網址：');
        hideDetail();
        UPLOAD_URL = 'https://upload.test';
        showDetail(allDogs[2]);
        eq(document.getElementById('photoPick'), null, '沒編號：');
        hideDetail();
        photoOverrides['9101'] = PX;
        showDetail(allDogs[0]);
        const pick = document.getElementById('photoPick');
        if (!pick) throw new Error('有編號要有上傳按鈕');
        const img = document.querySelector('#detail [data-zoom] img');
        if (!img.complete) await new Promise(r => img.addEventListener('load', r, { once: true }));
        await tick();
        eq(pick.title, '更換照片', '已有照片：');
        eq(pick.parentElement.classList.contains('photo-wrap'), true, '相機在照片角落：');
        eq(document.querySelector('#detail .photo-upload'), null, '還沒選照片時照片下方沒有多一行：');
        hideDetail();
        delete photoOverrides['9102'];
        showDetail(allDogs[1]);
        eq(document.getElementById('photoPick').title, '上傳照片', '還沒照片：');
        hideDetail();
      });
      await check('#48 選照片後壓成 JPEG（長邊 1280）並預覽，只有「裁切」「確認上傳」與取消；取消回到原狀', async () => {
        showDetail(allDogs[0]);
        await selectPhoto(await makeFile(3000, 1500));
        eq((await previewBlob()).type, 'image/jpeg', '格式：');
        eq(await blobSize(await previewBlob()), [1280, 640], '尺寸：');
        const preview = document.querySelector('#detail .photo-preview');
        eq(preview && preview.getAttribute('src'), previewUrl(), '預覽：');
        // 相簿批次上傳那次起多了「裁切」（相簿 K 2026-10-09 拿掉，主照片的裁切留著）
        eq([...document.querySelectorAll('#detail .photo-upload button')].map(b => b.textContent.trim()), ['裁切'], '照片下方：');
        // #146：確認上傳、取消在底部那列（溜了先收起來）
        eq([...document.querySelectorAll('#detail .detail-bar button')].map(b => b.textContent.trim()), ['取消換照片', '確認上傳'], '底部：');
        eq(document.activeElement.id, 'photoConfirm', '焦點在確認上傳：');
        document.getElementById('photoCancel').click();
        eq([previewUrl(), !!document.getElementById('photoPick')], [null, true], '取消後：');
        await selectPhoto(await makeFile(200, 300));
        eq(await blobSize(await previewBlob()), [200, 300], '小照片不放大：');
        hideDetail();
        eq(previewUrl(), null, '關掉詳細資訊就丟掉預覽：');
      });
      await check('2026-10-04 主照片預覽就在大照片的位置、用一樣的框裁切，下面附狗卡上的小照片；取消後換回原照片', async () => {
        showDetail(allDogs[0]);
        await selectPhoto(await makeFile(1200, 400));
        const hero = document.querySelector('#detail .detail-head .photo-wrap.hero');
        eq([hero.classList.contains('pending'), hero.querySelector('.photo-preview').getAttribute('src'), hero.querySelector('.hero-tag').textContent], [true, previewUrl(), '預覽'], '大照片位置換成預覽：');
        eq([hero.querySelector('#photoPick'), hero.querySelector('[data-zoom]')], [null, null], '預覽時沒有相機鈕、不開燈箱：');
        // 測試頁沒載入樣式，改檢查用的是同一組樣式：大照片用 .detail-head .photo-wrap.hero .thumb（正方形、置中），小照片跟狗卡一樣 64×64
        eq(hero.querySelector('img').matches('.detail-head .photo-wrap.hero .thumb img'), true, '大照片跟上傳後同一個框：');
        const small = document.querySelector('#detail .photo-upload .card-thumb');
        eq([small.classList.contains('thumb'), small.querySelector('img').getAttribute('src')], [true, previewUrl()], '狗卡小照片：');
        const css = await fetch('../public/css/app.css').then(r => r.text());
        const size = sel => (css.match(new RegExp(sel.replace(/[.]/g, '\\.') + ' \\{ width: (\\d+px); height: (\\d+px)')) || []).slice(1);
        eq(size('.photo-preview-row .card-thumb'), size('.card .thumb'), '小照片跟狗卡一樣大：');
        if (!size('.card .thumb').length) throw new Error('找不到狗卡照片大小');
        eq(hero.nextElementSibling.classList.contains('photo-upload'), true, '按鈕緊接在大照片下面：');
        document.getElementById('photoCancel').click();
        const back = document.querySelector('#detail .photo-wrap.hero');
        eq([back.classList.contains('pending'), !!back.querySelector('[data-zoom]'), !!document.getElementById('photoPick')], [false, true, true], '取消後換回原照片：');
        hideDetail();
      });
      await check('#48 不是圖片的檔案：顯示錯誤、不出現預覽', async () => {
        showDetail(allDogs[0]);
        await selectPhoto(new File(['hello'], 'a.txt', { type: 'text/plain' }));
        eq(previewUrl(), null, '沒有預覽：');
        if (!toastText().includes('請選擇照片檔')) throw new Error(`提示：${toastText()}`);
        BQWalkUI.hideToast(); hideDetail();
      });
      await check('#48 確認上傳：用編號送到上傳服務，成功後狗卡、詳細資訊、燈箱立刻換新照片', async () => {
        photoOverrides['9101'] = PX;
        render();
        showDetail(allDogs[0]);
        await selectPhoto(await makeFile(800, 600));
        const url = previewUrl(), blob = await previewBlob();
        let release;
        const calls = fakeApi(() => new Promise(r => { release = () => r(apiJson({ ok: true, id: '9101', replaced: true })); }));
        document.getElementById('photoConfirm').click();
        await photoUntil(()=>calls.length===1,'原圖與縮圖準備完成並開始上傳');
        const btn = document.getElementById('photoConfirm');
        btn.click(); document.getElementById('photoConfirm').click();
        eq(calls.length, 1, '上傳中重按仍只送一張：');
        eq([btn.disabled, btn.textContent.trim(), document.getElementById('photoCancel')], [true, '上傳中…', null], '上傳中：');
        release(); await tick(); await tick();
        eq(calls.length, 1, '呼叫次數：');
        eq([calls[0][0], calls[0][1], calls[0][2] instanceof FormData && calls[0][2].get('photo').type === 'image/jpeg' && calls[0][2].get('thumb').type === 'image/jpeg'], ['uploadPhoto', '9101', true], '用編號送照片：');
        eq(photoOverrides['9101'], url, '記下新照片：');
        eq(cardOf(0).querySelector('.thumb img').getAttribute('src'), url, '狗卡：');
        eq(document.querySelector('#detail [data-zoom] img').getAttribute('src'), url, '詳細資訊：');
        if (!toastText().includes('照片已更新')) throw new Error(`提示：${toastText()}`);
        document.querySelector('#detail [data-zoom]').click();
        eq(lb().querySelector('img').getAttribute('src'), url, '燈箱：');
        const p = popped(); closeLightbox(); await p;
        BQWalkUI.hideToast(); hideDetail();
      });
      await check('#48 上傳失敗：顯示錯誤，原本的照片不變，可以再按確認上傳重試', async () => {
        photoOverrides['9101'] = PX;
        render();
        showDetail(allDogs[0]);
        await selectPhoto(await makeFile(400, 300));
        fakeApi(() => apiJson({ ok: false, error: '找不到這個編號的狗狗' }, 404));
        await confirmPhoto();
        eq(document.querySelector('#detail .photo-error').textContent.trim(), '找不到這個編號的狗狗', '服務回的錯誤：');
        eq(photoOverrides['9101'], PX, '原照片不變：');
        eq(cardOf(0).querySelector('.thumb img').getAttribute('src'), PX, '狗卡照片不變：');
        fakeApi(() => { throw new TypeError('Failed to fetch'); });
        document.getElementById('photoConfirm').click();
        await photoUntil(()=>!!document.querySelector('#detail .photo-error'),'網路錯誤');
        if (!document.querySelector('#detail .photo-error').textContent.includes('請確認網路')) throw new Error('網路錯誤要提示');
        fakeApi(() => new Response('<html>502</html>', { status: 502 }));
        await confirmPhoto();
        if (!document.querySelector('#detail .photo-error').textContent.includes('原本的照片不受影響')) throw new Error('非 JSON 錯誤也要說原照片沒事');
        eq(photoOverrides['9101'], PX, '原照片仍不變：');
        hideDetail();
      });
    } finally {
      restoreApi();
      UPLOAD_URL = savedUrl;
      cancelPhoto(); BQWalkUI.hideToast();
    }
  } finally {
    hideLightbox(); hideDetail();
    delete photoOverrides['9101']; delete photoOverrides['9102'];
    box.classList.add('hidden');
    history.replaceState(null, '');
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords] = saved;
    render();
  }
}

// 主照片裁切；相簿 K 2026-10-09 拿掉（怕 Cloudflare 用量爆掉），只留主照片
async function runCropTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL];
  const box = document.getElementById('main').parentElement;
  const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const lb = () => document.getElementById('lightbox');
  const isOpen = () => !!lb() && !lb().hidden;
  const popped = () => new Promise(r => window.addEventListener('popstate', () => setTimeout(r, 0), { once: true }));
  // 做一張有顏色的照片（寬 w、高 h），裁切測試用
  const colorPhoto = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#c33'; ctx.fillRect(0, 0, w / 2, h); ctx.fillStyle = '#33c'; ctx.fillRect(w / 2, 0, w / 2, h); return c.toDataURL('image/png'); };
  const blobSize = blob => new Promise((r, j) => { const img = new Image(); img.onload = () => r([img.naturalWidth, img.naturalHeight]); img.onerror = j; img.src = URL.createObjectURL(blob); });
  const cropEl = () => document.getElementById('cropper');
  // 開裁切要先等照片 decode 完才出現（CI 慢時超過 50ms）；還沒出現就按 Esc 會關掉詳細資訊、清掉照片預覽
  const until = async (ok, what) => { for (let i = 0; i < 200; i++) { if (ok()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error(`等不到${what}`); };
  const openCrop = async () => { document.getElementById('photoCrop').click(); await until(() => cropIsOpen() && document.querySelector('#cropper .crop-frame').style.width, '裁切畫面出現'); };
  const doneCrop = async old => { const p = popped(); document.getElementById('cropDone').click(); await p; await until(() => previewUrl() && previewUrl() !== old, '預覽換成裁好的'); };
  // 測試頁沒有載 css/app.css；沒有 .crop* 規則時裁切區高度只看照片當下撐開多少，載入時序一變就壓扁（#533）
  const cropCss = new CSSStyleSheet(); cropCss.replaceSync(await fetch('../public/css/app.css').then(r => r.text()));
  const cropStyle = document.createElement('style');
  cropStyle.textContent = [...cropCss.cssRules].filter(r => /^\.crop/.test(r.selectorText || '')).map(r => r.cssText).join('\n');
  try {
    document.head.append(cropStyle);
    box.classList.remove('hidden');
    UPLOAD_URL = 'https://worker.test';
    allDogs = [
      { id: '9301', name: '裁切甲', cage: 'A01', note: '', covered: false, walkedDate: null },
    ];
    groupMap = {}; activeTab = 'walk'; searchQuery = '';
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
    photoOverrides['9301'] = PX;
    render();
    await check('K 2026-10-09 相簿拿掉：詳細資訊沒有相簿段落，燈箱只有主照片、沒有換張箭頭和張數', async () => {
      showDetail(allDogs[0]);
      eq([document.querySelector('#detail [data-section="gallery"]'), document.getElementById('galleryAdd')], [null, null], '沒有相簿：');
      document.querySelector('#detail [data-zoom]').click();
      eq([isOpen(), lb().querySelectorAll('.lightbox-nav, .lightbox-count').length, lb().querySelector('img').getAttribute('src')], [true, 0, PX], '燈箱：');
      const p = popped(); closeLightbox(); await p;
      hideDetail();
    });
    await check('裁切：主照片預覽按「裁切」預設正方形，放大、拖曳不會露出空白，完成後預覽換成裁好的', async () => {
      showDetail(allDogs[0]);
      const file = await (await fetch(colorPhoto(800, 400))).blob();
      await selectPhoto(new File([file], 'a.png', { type: 'image/png' }));
      const old = previewUrl();
      await openCrop();
      eq([cropIsOpen(), cropEl().querySelector('[aria-pressed="true"]').textContent], [true, '正方形'], '開裁切：');
      const stage = cropEl().querySelector('.crop-stage');
      stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, clientX: 100, clientY: 100, bubbles: true, cancelable: true }));
      // 合成 PointerEvent 沒有瀏覽器的活躍指標，僅略過 capture；移動仍走實際事件處理。
      const capture = stage.setPointerCapture;
      try {
        stage.setPointerCapture = () => {};
        stage.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
        stage.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 5100, clientY: 100, bubbles: true }));
        stage.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
      } finally { stage.setPointerCapture = capture; }
      const frame = cropEl().querySelector('.crop-frame');
      const image = stage.querySelector('img');
      const transform = new DOMMatrix(image.style.transform);
      // DOMMatrix 讀回的是瀏覽器浮點座標，例如 613.440002 與 CSS 的 613.44；容許百分之一像素的捨入。
      const rounding = 0.01;
      eq(transform.m41 <= parseFloat(frame.style.left) + rounding && transform.m41 + parseFloat(image.style.width) + rounding >= parseFloat(frame.style.left) + parseFloat(frame.style.width), true, '放大、拖曳後不露空白：');
      await doneCrop(old);
      eq([cropIsOpen(), previewUrl() !== old], [false, true], '完成：');
      const [w, h] = await blobSize(await previewBlob());
      eq(Math.abs(w - h) <= 1, true, `正方形（${w}×${h}）：`);
      cancelPhoto();
      hideDetail();
    });
    await check('裁切：可換比例；Esc 取消不改照片', async () => {
      showDetail(allDogs[0]);
      const file = await (await fetch(colorPhoto(600, 600))).blob();
      await selectPhoto(new File([file], 'a.png', { type: 'image/png' }));
      const oldUrl = previewUrl();
      await openCrop();
      const p = popped(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await p;
      eq([cropIsOpen(), previewUrl()], [false, oldUrl], 'Esc 取消：');
      await openCrop();
      cropEl().querySelector('[data-aspect="landscape"]').click();
      await doneCrop(oldUrl);
      const [w, h] = await blobSize(await previewBlob());
      eq([previewUrl() !== oldUrl, Math.abs(w / h - 4 / 3) < 0.02], [true, true], `換成橫式（${w}×${h}）：`);
      cancelPhoto();
      hideDetail();
    });
  } finally {
    if (cropIsOpen()) { const p = popped(); document.getElementById('cropCancel').click(); await p; }
    hideLightbox(); hideDetail(); cancelPhoto(); BQWalkUI.hideToast();
    delete photoOverrides['9301'];
    cropStyle.remove();
    box.classList.add('hidden');
    history.replaceState(null, '');
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL] = saved;
    render();
  }
}

// #83 照片縮圖：清單讀 photos/thumbs/，燈箱讀原圖；縮圖讀不到先換原圖
async function runThumbTests() {
  const dog = { name: '縮圖狗', id: '9401' };
  const saved = [photoOverrides['9401']];
  try {
    await check('#83 清單用縮圖、燈箱用原圖；剛上傳的照片直接用本機圖片', () => {
      const box = document.createElement('div');
      box.innerHTML = photoThumb(dog);
      eq([box.querySelector('img').getAttribute('src'), box.querySelector('img').dataset.full], ['photos/thumbs/9401.jpg', 'photos/9401.jpg'], '縮圖、備用原圖：');
      box.innerHTML = photoThumb(dog, 56, true, false, true);
      eq([box.querySelector('img').getAttribute('src'), box.querySelector('img').dataset.sharp], ['photos/thumbs/9401.jpg', 'photos/9401.jpg'], '詳細資訊大照片原圖還沒到，先用縮圖（#791）：');
      photoOverrides['9401'] = 'blob:local-photo';
      box.innerHTML = photoThumb(dog);
      eq([box.querySelector('img').getAttribute('src'), box.querySelector('img').dataset.full], ['blob:local-photo', undefined], '剛上傳：');
    });
    await check('#83 縮圖還沒產生：第一次讀不到改讀原圖、不顯示腳掌；原圖也讀不到才顯示腳掌', () => {
      delete photoOverrides['9401'];
      const box = document.createElement('div');
      document.body.appendChild(box);
      box.innerHTML = photoThumb(dog);
      const img = box.querySelector('img');
      img.dispatchEvent(new Event('error'));
      eq([img.getAttribute('src'), img.dataset.full, img.style.display], ['photos/9401.jpg', undefined, ''], '換原圖：');
      img.dispatchEvent(new Event('error'));
      eq([img.style.display, box.querySelector('.thumb').classList.contains('no-photo')], ['none', true], '都讀不到：');
      box.remove();
    });
    await check('#791 大照片：原圖在快取直接用；還沒到先放縮圖，原圖載好才換上', async () => {
      delete photoOverrides['9401'];
      const RealImage = window.Image;
      const cached = new Set(), pending = [];
      // 假的 Image：cached 裡的網址當作已在快取；其他的等測試呼叫 load() 才算下載完
      window.Image = class {
        set src(url) { this.url = url; this.complete = cached.has(url); this.naturalWidth = this.complete ? 1280 : 0; if (!this.complete) pending.push(this); }
        load() { cached.add(this.url); this.onload && this.onload(); }
      };
      const box = document.createElement('div');
      document.body.appendChild(box);
      try {
        box.innerHTML = photoThumb(dog, 480, true, true, true);
        sharpenPhotos(box);
        const img = box.querySelector('img');
        eq([img.getAttribute('src'), img.hasAttribute('data-sharp')], ['photos/thumbs/9401.jpg', false], '原圖還沒到：');
        pending.filter(p => p.onload).forEach(p => p.load());
        eq([img.getAttribute('src'), img.hasAttribute('data-full')], ['photos/9401.jpg', false], '原圖載好換上：');
        box.innerHTML = photoThumb(dog, 480, true, true, true);
        eq([box.querySelector('img').getAttribute('src'), box.querySelector('img').hasAttribute('data-sharp')], ['photos/9401.jpg', false], '重畫時原圖已在快取，直接用原圖：');
        openLightbox({ name: '放大狗', id: '9402' });
        const big = document.querySelector('#lightbox img');
        eq(big.getAttribute('src'), 'photos/thumbs/9402.jpg', '放大照片原圖還沒到：');
        pending.filter(p => p.url === 'photos/9402.jpg' && p.onload).forEach(p => p.load());
        eq(big.getAttribute('src'), 'photos/9402.jpg', '放大照片原圖載好換上：');
        closeLightbox();
        openLightbox({ name: '沒縮圖狗', id: '9403' });
        big.dispatchEvent(new Event('error'));
        eq(big.getAttribute('src'), 'photos/9403.jpg', '放大照片縮圖讀不到改用原圖：');
        closeLightbox();
      } finally {
        window.Image = RealImage;
        box.remove();
      }
    });
  } finally {
    [photoOverrides['9401']] = saved;
    if (!saved[0]) delete photoOverrides['9401'];
  }
}

// 手機開啟加速：dogs.json 提早抓、畫面外的卡不排版、等全部 js 載入完才開始
// #127 照片網址加版本號：有版本就加 ?v=，沒有（舊網址、剛上傳）照舊；照片快取 30 天只套在 photos/
async function runPhotoVersionTests() {
  const saved = photoVersions;
  await check('#127 dogs.json 的 photoVersions：只收路徑 → 英數雜湊，格式不對的丟掉；沒有就是空的', () => {
    const got = parseDogsData({ dogs: [], photoVersions: { 'photos/1.jpg': 'ab12cd34', 'photos/2.jpg': 5, 'photos/3.jpg': '<x>' } });
    eq(got.photoVersions, { 'photos/1.jpg': 'ab12cd34' }, '版本：');
    eq(parseDogsData({ dogs: [] }).photoVersions, {}, '沒有：');
    eq(parseDogsData({ dogs: [], photoVersions: ['x'] }).photoVersions, {}, '格式不對：');
  });
  await check('#127 主照片、縮圖都加版本號；沒有版本的不加；剛上傳的本機圖片不受影響', () => {
    const dog = { id: '9901' };
    photoVersions = {
      'photos/9901.jpg': 'aaaa1111',
      'photos/thumbs/9901.jpg': 'bbbb2222',
    };
    eq(photoSrc(dog), 'photos/9901.jpg?v=aaaa1111', '主照片：');
    eq(photoThumbSrc(dog), 'photos/thumbs/9901.jpg?v=bbbb2222', '縮圖：');
    eq(photoSrc({ id: '9902' }), 'photos/9902.jpg', '沒有版本：');
    photoOverrides['9901'] = 'blob:local';
    eq(photoSrc(dog), 'blob:local', '剛上傳：');
    delete photoOverrides['9901'];
  });
  photoVersions = saved;
  const headers = await fetch('../public/_headers').then(r => r.ok ? r.text() : '');
  await check('#127 _headers：照片快取 30 天，其他檔案不設長快取', () => {
    // 部署到 Cloudflare 後 _headers 不公開，讀不到就跳過（本機和 GitHub Pages 讀得到）
    if (!headers) return;
    const rules = headers.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    eq(rules.map(l => l.trim()), ['/photos/*', 'Cache-Control: public, max-age=2592000, immutable'], '規則：');
  });
}

// ── #146 選了照片時底部換成取消／確認上傳（K 2026-10-04 選方案一）──
async function runPhotoBarTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL];
  const barTexts = () => [...document.querySelectorAll('#detail .detail-bar button')].map(b => b.textContent.trim());
  try {
    allDogs = [{ id: '9951', name: '換照甲', cage: 'A01', note: '', covered: false, walkedDate: null, formerIds: [] }];
    groupMap = {}; activeTab = 'walk'; searchQuery = '';
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords(); UPLOAD_URL = 'https://worker.test';
    render();
    showDetail(allDogs[0]);
    await check('#146 平常底部是關閉／溜了；選了主照片：底部換成取消換照片／確認上傳（綠色），沒有溜了', async () => {
      if (!document.getElementById('groupWalk')) throw new Error('平常要有溜了');
      const file = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')).blob();
      await selectPhoto(new File([file], 'dog.png', { type: 'image/png' }));
      eq(barTexts(), ['取消換照片', '確認上傳'], '底部：');
      if (document.getElementById('groupWalk') || document.getElementById('detailClose')) throw new Error('溜了／關閉要收起來');
      if (!document.querySelector('#detail .detail-bar #photoConfirm.bar-confirm')) throw new Error('確認上傳要用綠色按鈕');
      let release;
      fakeApi(() => new Promise(r => { release = () => r(apiJson({ ok: false, error: '測試取消上傳' }, 400)); }));
      document.getElementById('photoConfirm').click();
      eq([barTexts(), document.getElementById('photoConfirm').disabled], [['上傳中…'], true], '上傳中：');
      await photoUntil(()=>typeof release==='function','開始上傳');
      release(); await photoUntil(() => !!document.querySelector('#detail .photo-error'), '上傳結果');
      cancelPhoto();
      if (!document.getElementById('groupWalk')) throw new Error('取消後溜了回來');
    });
  } finally {
    hideDetail();
    restoreApi(); BQWalkUI.hideToast();
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL] = saved;
    render();
  }
}

async function runSquarePhotoTests() {
  const css = await fetch('../public/css/app.css').then(r => r.text());
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;left:-9999px;width:390px;height:844px;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><style>${css}</style><body>
    <div class="card"><div class="thumb" id="cardThumb"><img alt=""></div><div class="body"></div></div>
    <div class="detail-head"><div class="photo-wrap hero"><div class="thumb" id="heroThumb"><img alt=""></div></div></div>
    <div class="photo-preview-row"><div class="thumb card-thumb" id="previewThumb"><img alt=""></div></div>
    <div class="sk sk-thumb" id="skThumb"></div></body>`);
  doc.close();
  const size = id => { const r = doc.getElementById(id).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
  try {
    await check('2026-10-08 狗卡照片是正方形', () => { const [w, h] = size('cardThumb'); eq(w, h, '寬高：'); });
    await check('2026-10-08 詳細資訊大照片是正方形、置中裁切', () => {
      const [w, h] = size('heroThumb');
      eq(w > 200, true, '大照片要佔滿寬度：');
      eq(w, h, '寬高：');
      const cs = frame.contentWindow.getComputedStyle(doc.querySelector('#heroThumb img'));
      eq([cs.objectFit, cs.objectPosition], ['cover', '50% 50%']);
    });
    await check('2026-10-08 新照片預覽的狗卡小圖、載入中骨架也跟狗卡一樣大', () => {
      eq(size('previewThumb'), size('cardThumb'), '預覽小圖：');
      eq(size('skThumb'), size('cardThumb'), '骨架：');
    });
  } finally {
    frame.remove();
  }
}
