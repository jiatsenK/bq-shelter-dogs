// 今日溜狗介面只公開 BQWalkUI；提示、同行人及編輯中的狀態留在模組內。
// 執行時使用 app 的資料與重畫函式；排隊、核對與資料寫入仍交給 BQWalks。
const BQWalkUI = (() => {
  // 按「溜了」、一起記、移回：記下後重畫，底部跳提示條，可以按「復原」。
  // #138：溜了同時寫進試算表；復原、放回就把試算表改回原本的樣子
  // K 2026-10-17：會寫試算表時，按了溜了立刻變「已溜」，背景寫試算表（取代 2026-10-08 先等回應的做法，Apps Script 要好幾秒）；
  // 沒寫進去就退回未溜，提示條給「再試一次」。不寫試算表（還沒設定名字、Worker 沒設定）照舊直接記在手機
  function setWalked(dogs, on) {
    pinWalkOrder(dogs); // 按的狗留在原地，下一隻不會滑到手指下
    if (on && needNameToWalk()) return askNameThenWalk(dogs); // 還沒設定名字（先看看）：先問名字，設好再登記
    // #460：D1 模式所有入口（單狗、整群、一起溜）都等 D1 接受，不先記在手機
    if (!on && SITE.d1WalkAccept) return undoSheetWalks(dogs, null, { revert: true });
    if (on && (SITE.d1WalkAccept || sheetWillWrite())) walkThenRecord(dogs);
    else setWalkedLocal(dogs, on);
  }
  function sheetWillWrite() {
    return !!UPLOAD_URL && sheetWriteState !== 'off' && !!loadWalkerName();
  }
  const walkPending = new Set(); // 按了溜了、還在等試算表回應的狗（walkKey）
  const undoPending = new Set(); // 復原送出、還在等回應的狗（walkKey）
  function walkPendingNow(dog) {
    const key = walkKey(dog);
    return !!key && (walkPending.has(key) || walkRegistration.pending(dog));
  }
  function walkThenRecord(dogs, retry = null) {
    const todo = walkRegistration.walkCandidates(dogs);
    if (!todo.length) return;
    const acceptsD1 = SITE.d1WalkAccept;
    pickedBuddies.clear();
    const text = `${todo.map(d => d.name).join('、')} 今天溜了`;
    let confirmed = null;
    const write = walkRegistration.startWalk(todo, retry);
    const undoFn = () => sheetQueue = write.then(result => undoSheetWalks(result.successful));
    if (!acceptsD1) showToast(text, undoFn, { label: '＋一起溜的人', fn: () => {
      const open = result => { if (result.successful.length) openWithSheet(result.successful); };
      if (confirmed) open(confirmed); else write.then(open);
    } });
    render(); renderDetail();
    sheetQueue = write.then(result => {
      confirmed = result;
      if (result.off) return result; // 舊有僅記手機的備援
      render(); renderDetail();
      if (result.failed.length) {
        const again = result.retryDogs;
        showToast(result.message, null, again.length ? { label: '再試一次', fn: () => walkThenRecord(again, result) } : null);
      } else if (!acceptsD1) addToToast(text, undoFn, '，已寫進試算表');
      return result;
    }).catch(e => console.error(e));
  }
  function registrationText(result) { return BQWalks.registrationText(result); }
  function setWalkedLocal(dogs, on) {
    const { changed, undo } = recordWalked(dogs, on);
    if (!changed.length) return;
    pickedBuddies.clear();
    render();
    renderDetail();
    const names = changed.map(d => d.name).join('、');
    const text = on ? `${names} 今天溜了` : `${names} 取消今天溜了`;
    const undoFn = () => {
      undo();
      if (on) clearWalkWith(changed);
      render();
      renderDetail();
      queueSheetWrite(changed, !on);
    };
    const extra = on && loadWalkerName() ? { label: '＋一起溜的人', fn: () => openWithSheet(changed) } : null;
    showToast(text, undoFn, extra);
    queueSheetWrite(changed, on, text, undoFn);
  }

  // ── 誤觸復原：這支手機今天寫進試算表的溜了，事後也能從狗群頁的「已溜」撤銷 ──
  // 只認這支手機記下的 prev／wrote（sheetWrite 存的）；試算表那格已被別人改過（current 不是我們寫的）就不提供，
  // 撤銷時 Apps Script 也會再核對一次，不蓋掉別人後來改的
  function sheetUndoable(dog, today = new Date()) {
    const day = BQDates.localDateKey(today);
    return walkRegistration.canUndo(dog, day) || (SITE.d1WalkAccept && walkRegistration.canRevert(dog, day));
  }
  let sheetUndoBusy = false;
  async function undoSheetWalks(dogs, retry = null, options = {}) {
    pinWalkOrder(dogs); // 復原的狗也留在原地
    if (sheetUndoBusy || !dogs.length) return '';
    sheetUndoBusy = true; dogs.forEach(d => undoPending.add(walkKey(d))); hideToast(); render();
    try {
      const pending = retry ? walkRegistration.retry(retry) : walkRegistration.undo(dogs, options);
      sheetQueue = pending;
      const result = await pending;
      const { text, show } = BQWalks.undoFeedback(result);
      if (show) showToast(text, null, result.retryDogs.length ? { label: '再試一次', fn: () => undoSheetWalks(result.retryDogs, result, options) } : null);
      return text;
    } finally { sheetUndoBusy = false; undoPending.clear(); render(); renderDetail(); }
  }

  let withSheet = null; // { dogs, picked: Set, text, add }
  // add：詳細資訊溜狗人旁的「＋」，選好的人接在目前名單後面（#141）；不是 add 就是溜了之後提示條的「＋一起溜的人」
  function openWithSheet(dogs, add = false) {
    if (!dogs.length) return;
    const withMap = loadWalkWith();
    const already = add ? new Set(walkerList(dogs[0]).map(canonicalWalker)) : new Set(
      (withMap[walkKey(dogs[0])] || []).filter(n => dogs.every(d => (withMap[walkKey(d)] || []).includes(n))));
    withSheet = { dogs, picked: new Set(), text: '', already, add, phase: 'edit', error: '' };
    renderWithSheet();
  }
  function withSheetHtml() {
    const w = withSheet;
    const me = loadWalkerName();
    const names = [...new Set([...walkerNameList, ...loadCompanions(), ...w.picked])].filter(n => (w.add || n !== me) && !w.already.has(n));
    return `<div class="with-sheet" role="dialog" aria-modal="true" aria-labelledby="withTitle">
      <h3 id="withTitle">${w.add ? '加入溜狗人：' : '誰跟你一起溜 ' }${esc(w.dogs.map(d => d.name).join('、'))}${w.add ? '' : '？'}</h3>
      ${names.length ? `<div class="with-names">${names.map(n => `<button type="button" class="with-name${w.picked.has(n) ? ' on' : ''}" data-with="${esc(n)}" aria-pressed="${w.picked.has(n)}">${w.picked.has(n) ? icon('tick') : ''}${esc(n)}</button>`).join('')}</div>` : ''}
      <form class="with-add" id="withAdd" autocomplete="off">
        <input type="text" id="withInput" maxlength="20" placeholder="${names.length ? '其他人：輸入名字' : '輸入名字，例：嘉文'}" value="${esc(w.text)}" enterkeyhint="done">
        <button type="submit">加入</button>
      </form>
      ${w.error ? `<p role="alert">${esc(w.error)}</p>` : ''}
      <div class="with-bar">
        <button type="button" class="bar-btn" data-with-cancel>取消</button>
        <button type="button" class="with-ok" data-with-ok${w.phase === 'saving' ? ' disabled' : ''}>${w.phase === 'saving' ? '儲存中…' : '寫進試算表'}${w.picked.size ? `（${w.picked.size} 人）` : ''}</button>
      </div>
    </div>`;
  }
  function renderWithSheet() {
    let box = document.getElementById('withBackdrop');
    if (!withSheet) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'withBackdrop';
      box.className = 'with-backdrop';
      document.body.appendChild(box);
      box.addEventListener('click', e => {
        if (withSheet.phase === 'saving') return;
        if (e.target === box || e.target.closest('[data-with-cancel]')) { withSheet = null; renderWithSheet(); return; }
        const nameBtn = e.target.closest('[data-with]');
        if (nameBtn) {
          const n = nameBtn.dataset.with;
          if (withSheet.picked.has(n)) withSheet.picked.delete(n); else withSheet.picked.add(n);
          renderWithSheet();
          return;
        }
        if (e.target.closest('[data-with-ok]')) finishWithSheet();
      });
      box.addEventListener('input', e => { if (withSheet.phase !== 'saving' && e.target.id === 'withInput') withSheet.text = e.target.value; });
      box.addEventListener('submit', e => {
        e.preventDefault();
        if (withSheet.phase === 'saving') return;
        splitWalkers(withSheet.text).forEach(n => withSheet.picked.add(n));
        withSheet.text = '';
        renderWithSheet();
      });
    }
    box.innerHTML = withSheetHtml();
  }
  async function finishWithSheet() {
    const w = withSheet;
    splitWalkers(w.text).forEach(n => w.picked.add(n));
    const names = [...w.picked];
    if (w.add) {
      withSheet = null;
      renderWithSheet();
      const dog = w.dogs[0];
      const now = walkerList(dog);
      const added = names.filter(n => !now.map(canonicalWalker).includes(canonicalWalker(n)));
      if (added.length) editWalkers(dog, [...now, ...added], `已加入 ${added.join('、')}`);
      return;
    }
    withSheet = null;
    renderWithSheet();
    if (!names.length) return;
    await submitCompanions(w.dogs, names);
  }
  async function submitCompanions(dogs, names, retry = null) {
    const pending = walkRegistration.addCompanions(dogs, names, retry);
    sheetQueue = pending;
    const result = await pending;
    render(); renderDetail();
    showToast(result.message, null, result.retryDogs.length ? { label: '再試一次', fn: () => submitCompanions(result.retryDogs, names, result) } : null);
  }

  // 一個一個送，按了溜了馬上復原時，復原會等溜了寫完才送（才知道要改回什麼）
  function queueSheetWrite(dogs, on, toastText, toastUndo, walker, expected) {
    return sheetQueue = sheetWrite(dogs, on, toastText, toastUndo, walker, expected);
  }

  // 提示條還是剛剛那則（使用者還沒按別的）才在後面補一句，不蓋掉「復原」
  function addToToast(text, undo, extra) {
    const el = document.getElementById('toast');
    if (!el || el.hidden || toastUndo !== undo) return false;
    el.querySelector('.toast-text').textContent = `${text}${extra}`;
    return true;
  }

  // 舊的編輯入口仍回傳布林值；新登記入口直接使用模組逐狗結果。
  async function sheetWrite(dogs, on, toastText, toastUndo, walker = null, expected = undefined) {
    const outcome = await walkRegistration.write(dogs, on, walker, expected);
    if (outcome.value === null) return null;
    if (outcome.failure) showToast(outcome.message);
    else if (on && toastText) addToToast(toastText, toastUndo, '，已寫進試算表');
    render(); renderDetail();
    return outcome.value;
  }

  let toastTimer = null;
  let toastUndo = null;
  let toastExtra = null;
  // extra：{ label, fn } 提示條上多一顆按鈕（例：溜了之後「＋一起溜的人」）

  function showToast(text, undo, extra) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.innerHTML = `<span class="toast-text"></span><button type="button" class="toast-extra" hidden></button><button type="button" class="toast-undo">復原</button>`;
      el.querySelector('.toast-extra').addEventListener('click', () => {
        const fn = toastExtra;
        hideToast();
        if (fn) fn();
      });
      // 介面評估第三輪：提示條會蓋住下面那張狗卡，點文字就收起
      el.querySelector('.toast-text').addEventListener('click', hideToast);
      el.querySelector('.toast-undo').addEventListener('click', () => {
        const fn = toastUndo;
        hideToast();
        if (fn) fn();
      });
      document.body.appendChild(el);
    }
    el.querySelector('.toast-text').textContent = text;
    toastUndo = undo || null;
    el.querySelector('.toast-undo').hidden = !undo;
    toastExtra = extra ? extra.fn : null;
    const ex = el.querySelector('.toast-extra');
    ex.hidden = !extra;
    ex.textContent = extra ? extra.label : '';
    el.hidden = false;
    document.body.classList.add('toast-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toastUndo = null;
    toastExtra = null;
    const el = document.getElementById('toast');
    if (el) el.hidden = true;
    document.body.classList.remove('toast-on');
  }

  // 狗卡右側的「已遛」（溜狗表）／「移回」（今天已溜）按鈕；連犬名都沒有的狗記不了，照舊顯示箭頭
  // V9（#141）拿掉今天已溜：按過的狗留在原地，按鈕變成「已溜」，再按一次復原
  function walkButton(dog) {
    if (!walkKey(dog)) return `<span class="more">${icon('chevron')}</span>`;
    if (restOf(dog)) return ''; // 休養中暫停帶出：不放溜了，免得順手按到
    if (walkPendingNow(dog) && !walkedNow(dog)) return `<button type="button" class="walk-btn pending" disabled aria-label="${esc(dog.name)} 正在登記">登記中</button>`;
    // #498：復原按下後到伺服器回應前也要有回饋，不能看起來沒反應又被重按
    if (undoPending.has(walkKey(dog))) return `<button type="button" class="walk-btn pending" disabled aria-label="${esc(dog.name)} 正在取消今天溜了">取消中</button>`;
    const state = walkRegistration.state(dog);
    const disabled = sheetWillWrite() && !state.canUndo && !state.canRevert && !walkPendingNow(dog) ? ' disabled' : '';
    return state.mine
      ? `<button type="button" class="walk-btn done" data-walk="back" aria-label="${esc(dog.name)} 今天已溜，按一下取消"${disabled}>${icon('tick')}已溜</button>`
      : `<button type="button" class="walk-btn" data-walk="add" aria-label="${esc(dog.name)} 溜了">溜了</button>`;
  }
  function walkSyncHtml(dog) {
    const status = walkRegistration.state(dog).syncStatus;
    if (!status || status === 'synced') return '';
    return `<small class="walk-sync">${status === 'retry' || status === 'unconfirmed' ? '試算表尚未同步，會自動重試' : '試算表同步中'}</small>`;
  }

  // ── 溜狗人旁的＋／×（#141，K 2026-10-04 確認）──
  // 這隻狗試算表上是今天溜的，就能在名字旁直接加人（＋）、拿掉人（×），按了直接寫進試算表，提示條可以復原。
  // 寫的是整格新名單（Worker／Apps Script 的 edit），帶著目前那格的原文比對，別人先改過就不蓋掉。
  // 只剩一個人不給 ×（那格至少留一人，整筆取消用提示條的復原）；列表模式不放
  let walkerEditBusy = ''; // 正在寫的狗的 key，寫完前＋／×都不能按
  function walkerEditBase(dog, today = new Date()) {
    if (!UPLOAD_URL || sheetWriteState === 'off' || dog.departure) return null;
    if (!loadWalkerName() || isOffline() || walkPendingNow(dog)) return null;
    const key = walkKey(dog);
    if (!key) return null;
    const state = walkRegistration.state(dog, BQDates.localDateKey(today));
    return state.today && state.walker ? state.walker : null;
  }
  // 只剩一個人時，那個 × 是取消這次登記：日期和名字改回登記前（K 2026-10-05）。
  // 這支手機登記的用本機記下的登記前；其他人、其他裝置由 Worker 從溜狗紀錄找上一次（ADR 0016，任何人都能撤銷）
  function walkerUndoable(dog, who, today = new Date()) {
    const state = walkRegistration.state(dog, BQDates.localDateKey(today));
    return who.length === 1 && (state.mine && state.canUndo || state.canRevert);
  }

  function walkerChipsHtml(dog, who, today) {
    if (!who.length) return isOffline() ? '<span class="lw-none">讀不到（沒網路）</span>' : '<span class="lw-none">—</span>';
    if (!walkerEditBase(dog, today)) {
      const reason = isOffline() ? '沒網路，連線後才能編輯' : !loadWalkerName() ? '請先在「我溜過」選好你的名字再編輯'
        : walkPendingNow(dog) ? '正在寫進試算表，請稍候' : !UPLOAD_URL || sheetWriteState === 'off' ? '目前無法寫入試算表'
          : '';
      return who.map(n => `<span class="who-chip">${esc(n)}</span>`).join('') + (reason ? `<small class="lw-none">${reason}</small>` : '');
    }
    const busy = walkerEditBusy === walkKey(dog);
    const dis = busy ? ' disabled' : '';
    const undoable = walkerUndoable(dog, who, today);
    const x = n => who.length > 1 ? `<button type="button" class="who-x" data-who-remove="${esc(n)}" aria-label="拿掉 ${esc(n)}"${dis}>×</button>`
      : undoable ? `<button type="button" class="who-x" data-who-undo aria-label="取消這次登記（${esc(n)}）"${dis}>×</button>` : '';
    return who.map(n => `<span class="who-chip${x(n) ? ' editable' : ''}">${esc(n)}${x(n)}</span>`).join('')
      + `<button type="button" class="who-plus" id="whoAdd" aria-label="加入溜狗人"${dis}>${busy ? '…' : '＋'}</button>`;
  }
  async function editWalkers(dog, names, text) {
    const expected = walkerEditBase(dog);
    const key = walkKey(dog);
    if (!expected || walkerEditBusy) return;
    walkerEditBusy = key;
    renderDetail();
    if (SITE.d1WalkAccept) {
      try {
        const result = await walkRegistration.register([dog], { walker: [...new Set(names)].join('、'), expected });
        if (!result.successful.length) showToast(registrationText(result), null,
          result.retryDogs.length ? { label: '再試一次', fn: () => retryWalkerEdit(result) } : null);
      } finally { walkerEditBusy = ''; render(); renderDetail(); }
      return;
    }
    const ok = await queueSheetWrite([dog], true, null, null, [...new Set(names)].join('、'), expected);
    walkerEditBusy = '';
    renderDetail();
    if (!ok) return; // 失敗、別人改過的提示 sheetWrite 已經跳了
    const undo = () => queueSheetWrite([dog], false);
    showToast(`${text}，已寫進試算表`, undo);
  }
  async function retryWalkerEdit(previous) {
    const result = await walkRegistration.retry(previous);
    if (!result.successful.length) showToast(registrationText(result), null,
      result.retryDogs.length ? { label: '再試一次', fn: () => retryWalkerEdit(result) } : null);
    else hideToast();
    render(); renderDetail();
  }

  function closeWithSheet() { withSheet = null; renderWithSheet(); }

  return {
    setWalked, walkPendingNow, sheetUndoable, undoSheetWalks,
    openWithSheet, closeWithSheet, walkerChipsHtml, walkerEditBase, editWalkers,
    sheetWillWrite, sheetWrite, queueSheetWrite, registrationText,
    walkButton, walkSyncHtml, showToast, hideToast
  };
})();
