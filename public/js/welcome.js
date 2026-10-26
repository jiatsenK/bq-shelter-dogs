import { BQApi } from './api.js';
import { allWalkerNames, canonicalWalker, fetchWalks, isOffline, loadMyCodes, loadWalkerName, mainEl, render, saveMyCodes, saveWalkerName, splitWalkers, walkerCodesFor } from './app.js';
import { esc, icon } from './ui-kit.js';
import { appState } from './page-state.js';
import { BQStore } from './store.js';
import { SITE } from './site-config.js';
import { BQTour } from './tour.js';
import { BQWalkUI } from './walk-ui.js';

// 開頭畫面與我是誰設定；只公開 BQWelcome，頁面資料於互動時取用。
const BQWelcome = (() => {
  let walkerSetup = null; // 正在設定我是誰：{ text, phase, error }
  async function identityRequest(action, body) {
    const r = await BQApi.identity(action, body);
    if (r.error === 'network' || !r.data) throw new Error(r.message);
    const out = r.data;
    if (!r.ok || !out.ok) { const e = new Error(out.error || '身分設定失敗，請稍後再試'); e.targetCode = out.targetCode; throw e; }
    return out;
  }
  async function renameWalker() {
    const edit = walkerSetup;
    if (!edit || edit.phase === 'saving') return;
    const originalCodes = loadMyCodes().join(',');
    edit.phase = 'saving'; render();
    try {
      const out = await identityRequest('/rename', { code: loadMyCodes()[0], name: edit.text.trim(), operationId: edit.operationId || (edit.operationId = crypto.randomUUID()) });
      if (walkerSetup !== edit || loadMyCodes().join(',') !== originalCodes) return;
      saveWalkerName(out.identity.name); saveMyCodes(out.identity.codes); walkerSetup = null;
    } catch (e) {
      edit.phase = 'error'; edit.error = e.message;
      if (e.targetCode) {
        try { edit.merge = await identityRequest('/merge-preview', { code: loadMyCodes()[0], targetCode: e.targetCode }); edit.targetCode = e.targetCode; }
        catch (previewError) { edit.error = previewError.message; }
      }
    }
    render();
  }
  async function confirmWalkerMerge() {
    const edit = walkerSetup;
    if (!edit?.merge || edit.phase === 'saving') return;
    const originalCodes = loadMyCodes().join(',');
    edit.phase = 'saving'; render();
    try {
      const out = await identityRequest('/merge', { code: loadMyCodes()[0], targetCode: edit.targetCode, token: edit.merge.token, confirm: true, operationId: edit.mergeOperationId || (edit.mergeOperationId = crypto.randomUUID()) });
      if (walkerSetup !== edit || loadMyCodes().join(',') !== originalCodes) return;
      saveWalkerName(out.identity.name); saveMyCodes(out.identity.codes); walkerSetup = null;
    } catch (e) { edit.phase = 'error'; edit.error = e.message; edit.merge = null; }
    render();
  }

  function walkerSetupHtml() {
    const edit = walkerSetup || { text: '', phase: 'edit', error: '' };
    const busy = edit.phase === 'saving';
    const has = loadMyCodes().length > 0;
    if (edit.merge) {
      const summary = p => esc(p.name) + '：常溜 ' + p.favorites + '、開卡 ' + p.cards + '、溜狗來源紀錄 ' + p.walkRows;
      return '<div class="who-box"><h3>確認身分合併</h3><p role="alert">' + esc(edit.error || '') + '</p><p>' + summary(edit.merge.source) + '</p><p>' + summary(edit.merge.target) + '</p><p>合併後顯示「' + esc(edit.merge.target.name) + '」，兩邊資料都保留。</p><div class="my-note-actions"><button type="button" class="my-note-save" id="whoMerge"' + (busy ? ' disabled' : '') + '>這兩個身分都是我</button><button type="button" class="photo-cancel" id="whoCancel">取消</button></div></div>';
    }
    // 清除前確認一次（2026-10-08 介面評估第二輪：一按就清掉名字和代號，按錯就不能按溜了）
    if (edit.confirmClear) {
      return `<div class="who-box">
        <h3>${icon('alert')}確定清除？</h3>
        <p>清除後要重新輸入名字，才能按「溜了」寫進試算表。</p>
        <div class="my-note-actions">
          <button type="button" class="who-clear-ok" id="whoClearOk">清除</button>
          <button type="button" class="photo-cancel" id="whoClearNo">不要清除</button>
        </div>
      </div>`;
    }
    return `<form class="who-box" id="whoForm" autocomplete="off">
      <h3>${icon('paw')}你是誰？</h3>
      <p>輸入你在試算表上登記的名字，打一個字就會出現推薦。</p>
      <input type="text" id="whoInput" maxlength="60" placeholder="例：小明" aria-label="你在試算表登記的名字" value="${esc(edit.text)}"${busy ? ' disabled' : ''}>
      ${obNamesHtml(edit, busy, 'who')}
      <p class="who-note">按「溜了」時會把這個名字寫進試算表「誰遛的」。名字設定存在這支手機，換手機或換瀏覽器要重新設定。</p>
      ${nameConfirmHtml(edit)}
      ${edit.phase === 'error' ? `<div class="photo-error" role="alert">${icon('alert')}<span>${esc(edit.error)}</span></div>` : ''}
      <div class="my-note-actions">
        <button type="submit" class="my-note-save" id="whoSave"${busy ? ' disabled' : ''}>${busy ? '設定中…' : edit.phase === 'confirm' ? '確定用這個名字' : '設定'}</button>
        ${has && !busy ? `<button type="button" class="photo-cancel" id="whoRename">更改登記名字</button><button type="button" class="photo-cancel" id="whoCancel">取消</button>` : ''}
      </div>
      ${has && !busy ? `<button type="button" class="who-clear" id="whoClear">清除這支手機的設定</button>` : ''}
    </form>`;
  }

  // 送名字到 Worker 換代號；成功就記住代號、顯示我溜過，失敗保留輸入的名字並顯示原因
  async function saveWalkerSetup() {
    const edit = walkerSetup;
    if (!edit || edit.phase === 'saving') return;
    const failWith = msg => { edit.phase = 'error'; edit.error = msg; render(); };
    const confirmed = edit.phase === 'confirm';
    edit.phase = 'saving';
    render();
    if (!confirmed) {
      const unknown = await namesToConfirm(edit.text);
      if (walkerSetup !== edit) return;
      if (unknown.length) { edit.phase = 'confirm'; edit.unknown = unknown; render(); return; }
    }
    const error = await setWalkerName(edit.text);
    if (walkerSetup !== edit) return;
    if (error) return failWith(error);
    setNameLater(false);
    if (walkerSetup === edit) walkerSetup = null;
    render();
  }

  // 名字送 Worker 換代號，成功就記在這支手機；失敗回傳原因（開頭畫面和我溜過的「修改」共用）
  async function setWalkerName(raw) {
    const text = String(raw || '').trim();
    if (!text) return '請輸入你在試算表上寫的名字';
    if (!appState.UPLOAD_URL) return '暫時不能設定，網站這邊還沒準備好';
    const oldName = loadWalkerName(), oldCodes = loadMyCodes().join(',');
    try {
      const out = await identityRequest('', { name: text });
      if (loadWalkerName() !== oldName || loadMyCodes().join(',') !== oldCodes) return '身分設定已變動，請重新設定';
      saveWalkerName(out.identity.name);
      saveMyCodes(out.identity.codes);
    } catch (e) { return e.message; }
    return '';
  }

  // 自己打的名字要不要再確認一次（K 2026-10-12）：名字清單只有最近溜過的人，清單上沒有的再去查遛狗紀錄
  // （溜狗紀錄只有代號，所以先跟 Worker 換代號再對），紀錄裡有就是本人、不用問；查不到或連不上才問
  async function namesToConfirm(text) {
    const unknown = unknownWalkerNames(text);
    if (!unknown.length || !appState.UPLOAD_URL) return unknown;
    if (!appState.walksData) {
      try { appState.walksData = await fetchWalks(); } catch (e) { console.error(e); }
    }
    const walks = appState.walksData && Array.isArray(appState.walksData.walks) ? appState.walksData.walks : null;
    if (!walks) return unknown;
    const left = [];
    for (const n of unknown) {
      const { codes } = await walkerCodesFor([n]);
      if (!codes.some(c => walks.some(w => w && Array.isArray(w.walkers) && w.walkers.includes(c)))) left.push(n);
    }
    return left;
  }

  // ── 開頭畫面（#141 第 2 項）──
  // 第一次打開：先問你在試算表上的名字，接著幾頁說明（像新網站上線的導覽），按「開始使用」就不再出現。
  // 已經有名字（以前在我溜過設定過）只看說明；說明看過、名字被清掉了，只問名字
  // 介面評估第四輪（K 2026-10-08）：名字可以「先看看，等一下再設定」（現場沒訊號也進得去），
  // 沒名字的人按「溜了」時再問，設好直接幫他登記那隻；說明可以從資訊的「使用說明」再打開（#447 從我溜過搬過去）
  const ONBOARD_KEY = BQStore.keys.onboarded;
  const NAME_LATER_KEY = BQStore.keys.nameLater;
  // { step: 0 名字／1… 說明, text, phase: edit／saving／error／confirm, error, unknown: 表上沒有的名字,
  //   walk: 名字設好後要登記的狗（按溜了才問名字）, again: 從資訊再打開說明 }
  let onboard = null;
  function onboardDone() {
    try { return appState.phoneStore && appState.phoneStore.get(ONBOARD_KEY) === '1'; } catch (e) { return false; }
  }
  function nameLater() {
    try { return appState.phoneStore && appState.phoneStore.get(NAME_LATER_KEY) === '1'; } catch (e) { return false; }
  }
  function setNameLater(on) {
    try { if (appState.phoneStore) on ? appState.phoneStore.set(NAME_LATER_KEY, '1') : appState.phoneStore.remove(NAME_LATER_KEY); } catch (e) { /* 存不了下次再問一次 */ }
  }
  function needOnboard() {
    return !onboardDone() || (!nameLater() && (!loadWalkerName() || !loadMyCodes().length));
  }
  // 按溜了要寫進試算表、卻還沒有名字：先問名字
  function needNameToWalk() {
    return !!appState.UPLOAD_URL && appState.sheetWriteState !== 'off' && !loadWalkerName();
  }
  // 自己打的名字裡，名字清單上沒有的（打錯字會寫進大家共用的試算表，送出前問一次）。
  // 清單只看主清單「誰遛的」現在寫的名字（每隻狗最後一個溜的人），最近沒溜的人不在上面，所以還要查遛狗紀錄（namesToConfirm）
  function unknownWalkerNames(text) {
    if (!appState.walkerNameList.length) return [];
    const known = new Set(allWalkerNames());
    return splitWalkers(text).map(canonicalWalker).filter(n => n && !known.has(n));
  }
  // 自己打的名字清單上沒有：送出前確認一次
  function nameConfirmHtml(o) {
    return o.phase === 'confirm' ? `<div class="ob-confirm" role="alert">${icon('alert')}<span>溜狗紀錄裡還沒有「${esc(o.unknown.join('、'))}」，沒打錯就按「確定用這個名字」。</span></div>` : '';
  }
  function onboardHtml() {
    const o = onboard;
    if (o.step === 0) {
      const busy = o.phase === 'saving';
      const names = appState.walkerNameList.length > 0;
      const head = o.walk
        ? `<h1 class="ob-ask">先告訴我們你是誰</h1>
        <p class="ob-lead">「溜了」會把你的名字寫進試算表「誰遛的」。設好就幫你登記 ${esc(o.walk.map(d => d.name).join('、'))}。</p>`
        : `<div class="ob-hero">${icon('paw')}</div>
        <h1>${esc(SITE.name)}</h1>
        <p class="ob-lead">歡迎！先告訴我們你是誰。</p>`;
      const label = `<label class="ob-label" for="obInput">輸入你在試算表上登記的名字</label>${!names && isOffline() ? '<p class="ob-label-note">沒網路，不會出現推薦，請打完整的名字。</p>' : ''}`;
      const submit = busy ? '設定中…' : o.phase === 'confirm' ? '確定用這個名字' : o.walk ? '設定並登記' : '下一步';
      return `<form class="ob-page ob-name" id="obForm" autocomplete="off">
        ${head}
        ${label}
        <input type="text" id="obInput" maxlength="60" placeholder="例：小明" value="${esc(o.text)}"${busy ? ' disabled' : ''} enterkeyhint="done">
        ${obNamesHtml(o, busy)}
        <div class="ob-foot">
          ${nameConfirmHtml(o)}
          ${o.phase === 'error' ? `<div class="photo-error" role="alert">${icon('alert')}<span>${esc(o.error)}${o.walk ? '' : '。可以先按「先看看」進網站，有訊號時再設定。'}</span></div>` : ''}
          ${o.walk ? '' : '<p class="ob-small">按「溜了」時，會把這個名字寫進試算表「誰遛的」。</p>'}
          <button type="submit" class="ob-next"${busy ? ' disabled' : ''}>${submit}</button>
          <button type="button" class="ob-later" data-ob="${o.walk ? 'cancel' : 'later'}"${busy ? ' disabled' : ''}>${o.walk ? '取消' : '先看看，等一下再設定'}</button>
        </div>
      </form>`;
    }
    return '';
  }
  // 開頭畫面的名字按鈕（K 2026-10-04：入口的名字要能從表上已有的人選）：一人選一個（K 2026-10-08），點了填進輸入框，再點一次拿掉
  // 我溜過的「修改」也用同一排（kind 'who'）。選了用框線＋右上角勾勾（不是實心藍），跟「一起溜的人」分得出來，按鈕也不會變寬
  // 打字時只留符合的名字（K 2026-10-12：打第一個字就出現推薦）：開頭一樣的排前面，再來是中間有這個字的；
  // 沒打字不列（K 2026-10-12：說明只留一句，打一個字才出現推薦），最近溜過的和以前溜過的（walkerOlderNames）一起找
  function namesMatching(text) {
    const q = canonicalWalker(text);
    const all = allWalkerNames();
    if (!q) return [];
    return [...all.filter(n => n.startsWith(q)), ...all.filter(n => !n.startsWith(q) && n.includes(q))];
  }
  function obNamesHtml(o, busy, kind = 'ob') {
    if (!appState.walkerNameList.length) return '';
    const picked = new Set([canonicalWalker(o.text)]);
    return `<div class="ob-names" data-names="${kind}">${namesMatching(o.text).map(n =>
      `<button type="button" class="with-name me-name${picked.has(n) ? ' on' : ''}" data-${kind}-name="${esc(n)}" aria-pressed="${picked.has(n)}"${busy ? ' disabled' : ''}>${esc(n)}${picked.has(n) ? icon('tick') : ''}</button>`).join('')}</div>`;
  }
  // 打字時只換名字那一排（整個重畫會打斷注音選字）；選字途中不換，選好字（compositionend）再換
  function refreshNames(scope, o, kind, e) {
    if (e && e.isComposing) return;
    const row = scope && scope.querySelector(`[data-names="${kind}"]`);
    if (row) row.outerHTML = obNamesHtml(o, false, kind);
  }
  // 開頭畫面蓋住整個網站：後面的東西設成不能點、Tab 也跑不過去（inert）
  function setOnboardInert(box) {
    for (const el of document.body.children) {
      if (box && el !== box && !el.inert && el.tagName !== 'SCRIPT') { el.inert = true; el.dataset.obInert = '1'; }
      if (!box && el.dataset.obInert) { el.inert = false; delete el.dataset.obInert; }
    }
  }
  function closeOnboard() {
    onboard = null;
    renderOnboard();
  }
  function renderOnboard() {
    let box = document.getElementById('onboard');
    if (!onboard) {
      if (box) box.remove();
      setOnboardInert(null);
      document.documentElement.classList.remove('onboard-open');
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.id = 'onboard';
      box.className = 'onboard';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', '開始使用');
      document.body.appendChild(box);
      box.addEventListener('click', e => {
        const nameBtn = e.target.closest('[data-ob-name]');
        if (nameBtn) {
          const n = nameBtn.dataset.obName;
          onboard.text = canonicalWalker(onboard.text) === n ? '' : n;
          if (onboard.phase === 'error' || onboard.phase === 'confirm') onboard.phase = 'edit';
          renderOnboard();
          return;
        }
        const b = e.target.closest('[data-ob]');
        if (!b) return;
        const act = b.dataset.ob;
        if (act === 'cancel') return closeOnboard();
        if (act === 'later') {
          setNameLater(true);
          if (onboardDone()) { closeOnboard(); render(); } else BQTour.start();
        }
      });
      box.addEventListener('input', e => {
        if (!onboard || onboard.phase === 'saving' || e.target.id !== 'obInput') return;
        onboard.text = e.target.value;
        // 改了名字，之前的錯誤和「確定用這個名字」就不算了（重畫時游標留在原處）
        if (onboard.phase === 'error' || onboard.phase === 'confirm') { onboard.phase = 'edit'; renderOnboard(); }
        else refreshNames(box, onboard, 'ob', e);
      });
      box.addEventListener('compositionend', e => {
        if (onboard && e.target.id === 'obInput') { onboard.text = e.target.value; refreshNames(box, onboard, 'ob'); }
      });
      box.addEventListener('keydown', e => {
        e.stopPropagation(); // 開頭畫面蓋在最上面，後面網頁（在哪面板、裁切）的按鍵處理不要接到
        if (e.key !== 'Escape' || !onboard) return;
        if (onboard.walk) closeOnboard();
      });
      box.addEventListener('submit', async e => {
        e.preventDefault();
        if (onboard.phase === 'saving') return;
        const confirmed = onboard.phase === 'confirm';
        onboard.phase = 'saving';
        renderOnboard();
        if (!confirmed) {
          const o = onboard, unknown = await namesToConfirm(o.text);
          if (onboard !== o) return;
          if (unknown.length) { o.phase = 'confirm'; o.unknown = unknown; renderOnboard(); return; }
        }
        const error = await setWalkerName(onboard.text);
        if (error) { onboard.phase = 'error'; onboard.error = error; renderOnboard(); return; }
        setNameLater(false);
        const walk = onboard.walk;
        onboard = null;
        renderOnboard();
        render();
        if (walk) BQWalkUI.setWalked(walk, true);
        else if (!onboardDone()) BQTour.start();
      });
    }
    // 重畫時正在打字的人游標不要掉（名字清單比畫面晚到也會重畫）
    const typing = document.activeElement && document.activeElement.id === 'obInput' && box.contains(document.activeElement)
      ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    document.documentElement.classList.add('onboard-open');
    setOnboardInert(box);
    const stepChanged = box.dataset.step !== String(onboard.step);
    box.dataset.step = String(onboard.step);
    box.innerHTML = onboardHtml();
    const input = box.querySelector('#obInput');
    if (input && typing && !input.disabled) {
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(typing[0], typing[1]); } catch (e) { /* 有些輸入法不給設 */ }
    } else if (input && onboard.phase === 'edit' && stepChanged) {
      input.focus({ preventScroll: true }); // 名字頁只有輸入框，直接叫出鍵盤
    } else if (!box.contains(document.activeElement)) {
      (box.querySelector('h1, h2') || box).setAttribute('tabindex', '-1');
      (box.querySelector('h1, h2') || box).focus({ preventScroll: true });
    }
  }
  function startOnboard() {
    if (onboard || !needOnboard()) return;
    if ((loadWalkerName() && loadMyCodes().length) || nameLater()) return BQTour.start();
    onboard = { step: 0, text: '', phase: 'edit', error: '' };
    renderOnboard();
  }
  // 按溜了才問名字（先看看的人）：設好直接登記這幾隻
  function askNameThenWalk(dogs) {
    onboard = { step: 0, text: '', phase: 'edit', error: '', walk: dogs };
    renderOnboard();
  }

  function bindSetup() {
    mainEl.addEventListener('click', e => {
      if (e.target.closest('[data-who-name]')) {
        const n = e.target.closest('[data-who-name]').dataset.whoName;
        walkerSetup = { ...(walkerSetup || { error: '' }), phase: 'edit', text: canonicalWalker(walkerSetup ? walkerSetup.text : '') === n ? '' : n };
        render();
      } else if (e.target.closest('#whoEdit')) {
        walkerSetup = { text: loadWalkerName(), phase: 'edit', error: '' }; // 先填目前的名字，不用重打
        render();
        const input = document.getElementById('whoInput');
        if (input) input.focus();
      } else if (e.target.closest('#whoRename')) {
        renameWalker();
      } else if (e.target.closest('#whoMerge')) {
        confirmWalkerMerge();
      } else if (e.target.closest('#whoCancel')) {
        walkerSetup = null;
        render();
      } else if (e.target.closest('#whoClear')) {
        walkerSetup = { ...(walkerSetup || { text: '', phase: 'edit', error: '' }), confirmClear: true };
        render();
      } else if (e.target.closest('#whoClearNo')) {
        walkerSetup = { ...walkerSetup, confirmClear: false };
        render();
      } else if (e.target.closest('#whoClearOk')) {
        saveMyCodes([]);
        saveWalkerName('');
        walkerSetup = null;
        render();
      }
    });
    // 我是誰：輸入的名字先記著（別的資料讀好重畫時才不會被清掉），送出換代號
    mainEl.addEventListener('input', e => {
      if (e.target.id !== 'whoInput') return;
      if (!walkerSetup) walkerSetup = { text: '', phase: 'edit', error: '' };
      if (walkerSetup.text !== e.target.value) { delete walkerSetup.operationId; delete walkerSetup.mergeOperationId; delete walkerSetup.merge; }
      walkerSetup.text = e.target.value;
      refreshNames(mainEl, walkerSetup, 'who', e);
    });
    mainEl.addEventListener('compositionend', e => {
      if (e.target.id !== 'whoInput' || !walkerSetup) return;
      walkerSetup.text = e.target.value;
      refreshNames(mainEl, walkerSetup, 'who');
    });
    mainEl.addEventListener('submit', e => {
      if (e.target.id !== 'whoForm') return;
      e.preventDefault();
      const input = document.getElementById('whoInput');
      const text = input ? input.value : '';
      // 問過「表上還沒有這個名字」、名字沒改又按一次：就是確定要用
      const confirmed = walkerSetup && walkerSetup.phase === 'confirm' && walkerSetup.text === text;
      walkerSetup = { ...(walkerSetup || {}), text, phase: confirmed ? 'confirm' : 'edit', error: '' };
      saveWalkerSetup();
    });

  }
  function needsSetup() { return !!walkerSetup || !loadMyCodes().length; }
  function refresh() { if (onboard && onboard.step === 0 && onboard.phase !== 'saving') renderOnboard(); }
  return { start: startOnboard, close: closeOnboard, refresh, needsSetup, setupHtml: walkerSetupHtml,
    bindSetup, request: identityRequest, needNameToWalk, askNameThenWalk, setInert: setOnboardInert };
})();

export { BQWelcome };
