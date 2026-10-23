// 照片裁切與上傳只公開 BQPhoto；預覽、裁切與非同步上傳狀態留在模組內。
const BQPhoto = (() => {
  // 上傳前先在手機上壓成 JPEG：長邊最多 1280px，避免 repo 堆滿手機原圖；上限要跟 Worker 的 MAX_BYTES 一致
  const PHOTO_MAX_EDGE = 1280;
  const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
  let photoUpload = null; // 詳細資訊正在上傳的主照片：{ dog, blob, url, phase: 'preview'|'uploading'|'error', error }

  // ── 上傳／更換照片（#48）：選照片 → 預覽 → 確認上傳 → 畫面立刻換新照片 ──

  // 詳細資訊照片右下角的相機圖示（K 2026-09-25 問業界做法，比照大頭貼）：點照片看大圖、點相機換照片。
  // 沒有編號（照片檔名要用編號）或上傳服務還沒設定就不顯示
  function photoPickButton(dog) {
    if (dog.departure) return ''; // 離所的狗（#164）不能換照片
    if (!UPLOAD_URL || !dog.id) return '';
    return `<button type="button" class="photo-pick" id="photoPick" aria-label="上傳 ${esc(dog.name)} 的照片" title="上傳照片">${icon('camera')}</button>`;
  }

  // 詳細資訊最上面的大照片。選好新照片還沒上傳時，直接在這個位置換成新照片預覽（2026-10-04 K：要像社群網站，出現在按的地方），
  // 裁切方式跟上傳後一模一樣（同一個 .thumb 框）；下面再放一張狗卡上的小照片，兩個地方的樣子都看得到
  function photoPending(dog) {
    return UPLOAD_URL && dog.id && photoUpload && photoUpload.dog === dog ? photoUpload : null;
  }
  function photoHeroHtml(dog) {
    const up = photoPending(dog);
    if (!up) return `<div class="photo-wrap hero">${photoThumb(dog, 480, true, true, true)}${photoPickButton(dog)}</div>`;
    return `
      <div class="photo-wrap hero pending">
        <div class="thumb"><img class="photo-preview" src="${esc(up.url)}" alt="${esc(dog.name)} 的新照片預覽"></div>
        <span class="hero-tag">預覽</span>
      </div>`;
  }

  // 選好照片後，大照片下面的「裁切」「確認上傳」「取消」
  function photoUploadHtml(dog) {
    const up = photoPending(dog);
    if (!up) return '';
    const busy = up.phase === 'uploading';
    return `
      <div class="photo-upload preview">
        <div class="photo-preview-row">
          <div class="thumb card-thumb"><img src="${esc(up.url)}" alt=""></div>
          <div class="photo-preview-hint">上面是詳細資訊、左邊是狗卡上的樣子，按下面「確認上傳」才會換（${esc(dog.name)}，編號 ${esc(dog.id)}）</div>
        </div>
        ${up.phase === 'error' ? `<div class="photo-error" role="alert">${icon('alert')}<span>${esc(up.error)}</span></div>` : ''}
        ${busy ? '' : `<button type="button" class="photo-crop" id="photoCrop">${icon('crop')}裁切</button>`}
      </div>`;
  }

  // #146：選了照片還沒上傳時，底部那列換成「取消／確認上傳（綠色）」，溜了先收起來，
  // 照片的確認跟溜了不會再是兩顆一樣的藍色大按鈕（K 2026-10-04 選方案一）。上傳中只剩確認那顆（顯示進度）
  function photoBarHtml(dog) {
    const up = photoPending(dog);
    if (!up) return '';
    const busy = up.phase === 'uploading';
    const cancel = `<button type="button" class="bar-btn" id="photoCancel">取消換照片</button>`;
    const confirm = `<button type="button" class="bar-confirm" id="photoConfirm"${busy ? ' disabled' : ''}>${busy ? '上傳中…' : '確認上傳'}</button>`;
    return `<div class="detail-bar photo-bar">${busy ? '' : cancel}${confirm}</div>`;
  }

  // ── 裁切：照片放在固定的框後面，拖曳移動、兩指（或滑桿、滑鼠滾輪）放大，框裡的部分就是裁好的照片 ──
  // 主照片預設正方形（清單上的小照片是正方形）；也可以換直式、橫式
  const CROP_ASPECTS = [
    { id: 'square', label: '正方形', ratio: 1 },
    { id: 'portrait', label: '直式 3:4', ratio: 3 / 4 },
    { id: 'landscape', label: '橫式 4:3', ratio: 4 / 3 },
    { id: 'original', label: '原比例', ratio: 0 },
  ];
  let cropView = null; // { img, aspect, scale, minScale, tx, ty, frame: { x, y, w, h }, resolve, pointers: Map }

  function cropOpen() {
    const el = document.getElementById('cropper');
    return !!el && !el.hidden;
  }

  // 開裁切畫面；完成回傳裁好的 JPEG（長邊最多 PHOTO_MAX_EDGE），取消回傳 null
  async function openCropper(src, aspect = 'square') {
    const img = new Image();
    img.src = src;
    try { await img.decode(); } catch (e) { showToast('這張照片讀不到，沒辦法裁切'); return null; }
    let el = document.getElementById('cropper');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cropper';
      el.className = 'cropper';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', '裁切照片');
      el.innerHTML = `
        <div class="crop-stage"><img alt="要裁切的照片" draggable="false"><div class="crop-frame"></div></div>
        <div class="crop-panel">
          <div class="crop-aspects">${CROP_ASPECTS.map(a => `<button type="button" data-aspect="${a.id}">${a.label}</button>`).join('')}</div>
          <label class="crop-zoom">${icon('search')}<input type="range" id="cropZoom" min="1" max="4" step="0.01" value="1" aria-label="放大"></label>
          <div class="crop-actions">
            <button type="button" class="crop-cancel" id="cropCancel">取消</button>
            <button type="button" class="crop-done" id="cropDone">完成</button>
          </div>
        </div>`;
      const stage = el.querySelector('.crop-stage');
      stage.addEventListener('pointerdown', e => {
        if (!cropView) return;
        stage.setPointerCapture(e.pointerId);
        cropView.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      });
      stage.addEventListener('pointermove', e => {
        const v = cropView;
        if (!v || !v.pointers.has(e.pointerId)) return;
        const prev = v.pointers.get(e.pointerId);
        const pts = [...v.pointers.values()];
        if (pts.length === 1) {
          v.tx += e.clientX - prev.x;
          v.ty += e.clientY - prev.y;
        } else if (pts.length === 2) {
          const other = pts.find(p => p !== prev);
          const before = Math.hypot(prev.x - other.x, prev.y - other.y);
          const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
          const box = stage.getBoundingClientRect();
          if (before > 0) zoomCropAt(v.scale * after / before, (e.clientX + other.x) / 2 - box.left, (e.clientY + other.y) / 2 - box.top);
        }
        v.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        drawCrop();
      });
      const up = e => { if (cropView) cropView.pointers.delete(e.pointerId); };
      stage.addEventListener('pointerup', up);
      stage.addEventListener('pointercancel', up);
      stage.addEventListener('wheel', e => {
        if (!cropView) return;
        e.preventDefault();
        const box = stage.getBoundingClientRect();
        zoomCropAt(cropView.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - box.left, e.clientY - box.top);
        drawCrop();
      }, { passive: false });
      el.querySelector('#cropZoom').addEventListener('input', e => {
        const v = cropView;
        if (!v) return;
        zoomCropAt(v.minScale * Number(e.target.value), v.frame.x + v.frame.w / 2, v.frame.y + v.frame.h / 2);
        drawCrop();
      });
      el.querySelectorAll('[data-aspect]').forEach(b => b.addEventListener('click', () => { setCropAspect(b.dataset.aspect); }));
      el.querySelector('#cropCancel').addEventListener('click', () => closeCropper(null));
      el.querySelector('#cropDone').addEventListener('click', finishCrop);
      window.addEventListener('resize', () => { if (cropOpen()) setCropAspect(cropView.aspect); });
      document.body.appendChild(el);
    }
    if (cropView) cropView.resolve(null);
    el.querySelector('img').src = src;
    el.hidden = false;
    document.documentElement.classList.add('lightbox-open');
    history.pushState({ bqCrop: true }, '');
    return new Promise(resolve => {
      cropView = { img, aspect, scale: 1, minScale: 1, tx: 0, ty: 0, frame: null, resolve, pointers: new Map(), opener: document.activeElement };
      setCropAspect(aspect);
      el.querySelector('#cropDone').focus({ preventScroll: true });
    });
  }

  // 換比例：框重新置中，照片縮到剛好蓋滿框
  function setCropAspect(aspect) {
    const v = cropView;
    const el = document.getElementById('cropper');
    if (!v || !el) return;
    const a = CROP_ASPECTS.find(x => x.id === aspect) || CROP_ASPECTS[0];
    v.aspect = a.id;
    const ratio = a.ratio || v.img.naturalWidth / v.img.naturalHeight;
    const stage = el.querySelector('.crop-stage');
    const W = stage.clientWidth || 360, H = stage.clientHeight || 360;
    let w = W * 0.88, h = w / ratio;
    if (h > H * 0.88) { h = H * 0.88; w = h * ratio; }
    v.frame = { x: (W - w) / 2, y: (H - h) / 2, w, h };
    v.minScale = Math.max(w / v.img.naturalWidth, h / v.img.naturalHeight);
    v.scale = v.minScale;
    v.tx = v.frame.x + (w - v.img.naturalWidth * v.scale) / 2;
    v.ty = v.frame.y + (h - v.img.naturalHeight * v.scale) / 2;
    el.querySelectorAll('[data-aspect]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.aspect === a.id)));
    drawCrop();
  }

  // 以畫面上的 (cx, cy) 為中心放大縮小；最小剛好蓋滿框，最大 4 倍
  function zoomCropAt(scale, cx, cy) {
    const v = cropView;
    const next = Math.min(v.minScale * 4, Math.max(v.minScale, scale));
    v.tx = cx - (cx - v.tx) * next / v.scale;
    v.ty = cy - (cy - v.ty) * next / v.scale;
    v.scale = next;
  }

  // 照片不能拖到露出框外的空白
  function drawCrop() {
    const v = cropView;
    const el = document.getElementById('cropper');
    if (!v || !el) return;
    const { frame: f } = v;
    const w = v.img.naturalWidth * v.scale, h = v.img.naturalHeight * v.scale;
    v.tx = Math.min(f.x, Math.max(f.x + f.w - w, v.tx));
    v.ty = Math.min(f.y, Math.max(f.y + f.h - h, v.ty));
    const img = el.querySelector('.crop-stage img');
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    img.style.transform = `translate(${v.tx}px, ${v.ty}px)`;
    Object.assign(el.querySelector('.crop-frame').style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
    el.querySelector('#cropZoom').value = String(v.scale / v.minScale);
  }

  // 框裡的範圍畫成 JPEG；太大就再降一點畫質
  async function cropToBlob(v) {
    const { frame: f } = v;
    const sx = (f.x - v.tx) / v.scale, sy = (f.y - v.ty) / v.scale, sw = f.w / v.scale, sh = f.h / v.scale;
    const k = Math.min(1, PHOTO_MAX_EDGE / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * k));
    canvas.height = Math.max(1, Math.round(sh * k));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(v.img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
      if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
    }
    return null;
  }

  async function finishCrop() {
    const v = cropView;
    if (!v) return;
    const blob = await cropToBlob(v);
    if (!blob) { showToast('裁好的照片太大，請再放大一點'); return; }
    closeCropper(blob);
  }

  function hideCropper() {
    const el = document.getElementById('cropper');
    if (!el || el.hidden) return;
    el.hidden = true;
    el.querySelector('.crop-stage img').removeAttribute('src');
    if (!lightboxOpen()) document.documentElement.classList.remove('lightbox-open');
    const v = cropView;
    cropView = null;
    if (v) {
      v.resolve(v.result || null);
      if (v.opener && v.opener.isConnected && v.opener !== document.body) v.opener.focus({ preventScroll: true });
    }
  }

  // 關掉走「上一頁」，手機返回鍵也等於取消
  function closeCropper(result) {
    if (cropView) cropView.result = result;
    if (history.state && history.state.bqCrop) history.back(); // popstate 會接著 hideCropper
    else hideCropper();
  }

  // 主照片預覽的「裁切」：裁好的換掉預覽
  async function cropPhotoUpload() {
    const up = photoUpload;
    if (!up || up.phase === 'uploading') return;
    const blob = await openCropper(up.url, 'square');
    if (!blob || photoUpload !== up || up.phase === 'uploading') return;
    URL.revokeObjectURL(up.url);
    up.blob = blob;
    up.url = URL.createObjectURL(blob);
    detailEdits.refresh(up, { phase: 'preview', error: '' });
    const btn = document.getElementById('photoConfirm');
    if (btn) btn.focus({ preventScroll: true });
  }

  // 燈箱裡主照片的「裁切」：裁好後跟換主照片一樣先預覽、再按確認上傳
  async function cropMainPhoto(dog) {
    const src = photoSrc(dog);
    closeLightbox();
    const blob = await openCropper(src, 'square');
    if (!blob || detailDog !== dog) return;
    if (photoUpload && photoUpload.phase === 'uploading') { showToast('上一張照片還在上傳，請稍等一下'); return; }
    clearPhotoUpload();
    photoUpload = detailEdits.open(dog, { blob, url: URL.createObjectURL(blob) }, 'preview');
    renderDetail();
    const btn = document.getElementById('photoConfirm');
    if (btn) {
      btn.focus({ preventScroll: true });
      if (btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest' });
    }
  }

  // 手機或電腦選照片：隱藏的檔案選擇框，按「上傳照片」時才打開
  function pickPhotoFile() {
    let input = document.getElementById('photoFile');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.id = 'photoFile';
      input.hidden = true;
      input.addEventListener('change', () => {
        const files = [...(input.files || [])];
        input.value = ''; // 同一張再選一次也會觸發
        if (!files.length || !detailDog) return;
        preparePhoto(detailDog, files[0]);
      });
      document.body.appendChild(input);
    }
    input.click();
  }

  // 壓成 JPEG；太大就再降一點畫質。讀不了的格式（例：電腦上的 HEIC）丟錯
  async function compressPhoto(file) {
    // 有些手機相簿給的檔案沒有類型，就交給下面實際讀讀看
    if (file.type && !/^image\//.test(file.type)) throw new Error('請選擇照片檔（JPG、PNG 等圖片）');
    const src = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = src;
      try { await img.decode(); } catch (e) { throw new Error('這張照片的格式無法讀取，請改選 JPG 或 PNG'); }
      const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // 透明背景的 PNG 轉 JPEG 時補白底
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.7, 0.55]) {
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
        if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
      }
      throw new Error('照片太大，請換一張');
    } finally {
      URL.revokeObjectURL(src);
    }
  }

  async function preparePhoto(dog, file) {
    if (photoUpload && photoUpload.phase === 'uploading') {
      showToast('上一張照片還在上傳，請稍等一下');
      return;
    }
    let blob;
    try {
      blob = await compressPhoto(file);
    } catch (e) {
      showToast(e.message);
      return;
    }
    if (detailDog !== dog) return; // 壓縮途中換看別隻或關掉了
    clearPhotoUpload();
    photoUpload = detailEdits.open(dog, { blob, url: URL.createObjectURL(blob) }, 'preview');
    renderDetail();
    const confirm = document.getElementById('photoConfirm');
    if (confirm) {
      confirm.focus({ preventScroll: true });
      if (confirm.scrollIntoView) confirm.scrollIntoView({ block: 'nearest' });
    }
  }

  // 取消預覽（或換看別隻）時丟掉還沒上傳的照片
  function clearPhotoUpload() {
    if (photoUpload && photoUpload.phase !== 'done') URL.revokeObjectURL(photoUpload.url);
    photoUpload = null;
  }

  // 送到 Worker；成功後這支手機馬上改顯示新照片（GitHub Pages 要幾分鐘才更新），失敗時原本照片不動
  async function uploadPhoto() {
    const up = photoUpload;
    if (!up || up.phase === 'uploading') return;
    detailEdits.saving(up, 'uploading');
    let error = '';
    const r = await BQApi.uploadPhoto(up.dog.id, up.blob, editorHeaders());
    const out = r.data;
    if (r.error === 'network') error = '上傳失敗，請確認網路後再試；原本的照片不受影響';
    else if (!r.ok || !out || !out.ok) error = (out && out.error) || `網站暫時收不到照片（${r.status}），請稍後再試；原本的照片不受影響`;
    if (photoUpload !== up) return; // 保險：上傳中不會被清掉（見 preparePhoto、hideDetail）
    if (error) {
      if (detailDog !== up.dog) { // 上傳途中關掉或換看別隻：用提示條告訴結果
        clearPhotoUpload();
        showToast(`${up.dog.name} 的照片沒有上傳成功：${error}`);
        return;
      }
      detailEdits.fail(up, error);
      showPhotoError();
      return;
    }
    up.phase = 'done';
    photoUpload = null;
    photoOverrides[up.dog.id] = up.url;
    render();
    renderDetail();
    showToast(`${up.dog.name} 的照片已更新（其他志工重新整理就會看到）`);
  }

  // 介面評估第三輪（K 2026-10-08）：上傳失敗的說明可能在底部按鈕列後面，捲到看得到的地方
  function showPhotoError() {
    const el = document.querySelector('#detail .photo-error') || document.querySelector('.photo-error');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  }

  // 關閉詳細資訊或換狗時保留已送出的上傳，其他預覽照舊釋放。
  function leaveDetail() {
    if (!photoUpload || photoUpload.phase !== 'uploading') clearPhotoUpload();
  }

  return {
    heroHtml: photoHeroHtml, uploadHtml: photoUploadHtml, barHtml: photoBarHtml,
    pick: pickPhotoFile, upload: uploadPhoto, clear: clearPhotoUpload, leaveDetail,
    cropPreview: cropPhotoUpload, cropMain: cropMainPhoto,
    cropOpen, hideCropper, closeCropper, compress: compressPhoto,
  };
})();
