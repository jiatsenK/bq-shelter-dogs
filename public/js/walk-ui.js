import { canonicalWalker, esc, icon, isOffline, loadCompanions, loadWalkWith, loadWalkerName, render, renderDetail, restOf, splitWalkers, walkKey, walkRegistration, walkedNow, walkerList } from './app.js';
import { BQWelcome } from './welcome.js';
import { appState } from './page-state.js';
import { BQWalks } from './walk-flow.js';
import { BQDates } from './dates.js';

// 今日溜狗介面只公開 BQWalkUI；提示、同行人及編輯中的狀態留在模組內。
// 執行時使用 app 的資料與重畫函式；排隊、核對與資料寫入仍交給 BQWalks。
const BQWalkUI = (() => {
  // 按「溜了」、復原：送 D1 後重畫，底部跳提示條，可以按「復原」。
  function setWalked(dogs, on) {
    if (on && BQWelcome.needNameToWalk()) return BQWelcome.askNameThenWalk(dogs); // 還沒設定名字（先看看）：先問名字，設好再登記
    // #460：所有入口（單狗、整群、一起溜）都等 D1 接受，不先記在手機
    if (!on) return undoSheetWalks(dogs, null, { reveal: true });
    walkThenRecord(dogs);
  }
  function sheetWillWrite() {
    return !!appState.UPLOAD_URL && appState.sheetWriteState !== 'off' && !!loadWalkerName();
  }
  const undoPending = new Set(); // 復原送出、還在等回應的狗（walkKey）
  function walkPendingNow(dog) {
    const key = walkKey(dog);
    return !!key && walkRegistration.pending(dog);
  }
  function walkThenRecord(dogs, retry = null) {
    const todo = walkRegistration.walkCandidates(dogs);
    if (!todo.length) return;
    appState.pickedBuddies.clear();
    const text = `${todo.map(d => d.name).join('、')} 今天溜了`;
    const write = walkRegistration.startWalk(todo, retry);
    render(); renderDetail();
    appState.sheetQueue = write.then(result => {
      render(); renderDetail();
      if (result.failed.length) {
        const again = result.retryDogs;
        showToast(result.message, null, again.length ? { label: '再試一次', fn: () => walkThenRecord(again, result) } : null);
      }
      // K 2026-10-24：D1 接受後提示條照舊給「＋一起溜的人」；K 2026-10-26（#445）：狗會往下排，旁邊也給「復原」讓按錯的人不用找
      else if (result.successful.length && loadWalkerName()) showToast(text,
        () => undoSheetWalks(result.successful.filter(d => walkedNow(d)), null, { reveal: true }),
        { label: '＋一起溜的人', fn: () => openWithSheet(result.successful) });
      return result;
    }).catch(e => console.error(e));
  }
  function registrationText(result) { return BQWalks.registrationText(result); }
  // 今天只剩一個名字的登記，任何人都能請 Worker 改回上一次（ADR 0016）
  function sheetUndoable(dog, today = new Date()) {
    return walkRegistration.canRevert(dog, BQDates.localDateKey(today));
  }
  // #445：D1 復原畫面立刻恢復（walkRegistration 先顯示登記前的樣子），D1 失敗才改回並給再試一次。
  // options.reveal：單狗入口（狗卡「已溜」、溜狗人旁的 ×）用提示條說明進度，並捲到那隻狗
  async function undoSheetWalks(dogs, retry = null, options = {}) {
    dogs = dogs.filter(d => !undoPending.has(walkKey(d))); // 連按：同一隻還在等回應就不再送
    if (!dogs.length) return '';
    dogs.forEach(d => undoPending.add(walkKey(d)));
    try {
      const pending = retry ? walkRegistration.retry(retry) : walkRegistration.undo(dogs);
      appState.sheetQueue = pending;
      const done = `已取消 ${dogs.map(d => d.name).join('、')} 今天溜了`, progress = `${done}，正在確認`;
      if (options.reveal) showToast(progress); else hideToast();
      render(); renderDetail();
      if (options.reveal) revealDog(dogs[0]);
      const result = await pending;
      dogs.forEach(d => undoPending.delete(walkKey(d)));
      render(); renderDetail();
      const { text, show } = BQWalks.undoFeedback(result);
      if (show) showToast(text, null, result.retryDogs.length ? { label: '再試一次', fn: () => undoSheetWalks(result.retryDogs, result, options) } : null);
      else replaceToast(progress, done);
      // 沒復原的狗改回已溜、排回後面，再捲過去讓人看得到
      const left = dogs.find(d => !result.successful.includes(d));
      if (options.reveal && left) revealDog(left);
      return text;
    } finally { dogs.forEach(d => undoPending.delete(walkKey(d))); render(); renderDetail(); }
  }
  // 溜狗表上那隻狗不在頁首與提示條之間就捲到中間
  function revealDog(dog) {
    // 背景重讀會換掉 allDogs，用 walkKey 找現在那一張
    const i = appState.allDogs.findIndex(d => walkKey(d) === walkKey(dog));
    const el = i >= 0 && document.querySelector(`#main [data-dog="${i}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect(), top = document.querySelector('header')?.getBoundingClientRect().bottom || 0;
    const bottom = document.querySelector('#toast:not([hidden])')?.getBoundingClientRect().top ?? innerHeight;
    if (r.top < top || r.bottom > Math.min(innerHeight, bottom)) el.scrollIntoView({ block: 'center' });
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
    const names = [...new Set([...appState.walkerNameList, ...loadCompanions(), ...w.picked])].filter(n => (w.add || n !== me) && !w.already.has(n));
    return `<div class="with-sheet" role="dialog" aria-modal="true" aria-labelledby="withTitle">
      <h3 id="withTitle">${w.add ? '加入溜狗人：' : '誰跟你一起溜 ' }${esc(w.dogs.map(d => d.name).join('、'))}${w.add ? '' : '？'}</h3>
      ${names.length ? `<div class="with-names">${names.map(n => `<button type="button" class="with-name${w.picked.has(n) ? ' on' : ''}" data-with="${esc(n)}" aria-pressed="${w.picked.has(n)}">${w.picked.has(n) ? icon('tick') : ''}${esc(n)}</button>`).join('')}</div>` : ''}
      <form class="with-add" id="withAdd" autocomplete="off">
        <input type="text" id="withInput" maxlength="20" placeholder="${names.length ? '其他人：輸入名字' : '輸入名字，例：志工乙'}" value="${esc(w.text)}" enterkeyhint="done">
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
      if (added.length) editWalkers(dog, [...now, ...added]);
      return;
    }
    withSheet = null;
    renderWithSheet();
    if (!names.length) return;
    await submitCompanions(w.dogs, names);
  }
  async function submitCompanions(dogs, names, retry = null) {
    const pending = walkRegistration.addCompanions(dogs, names, retry);
    appState.sheetQueue = pending;
    const result = await pending;
    render(); renderDetail();
    showToast(result.message, null, result.retryDogs.length ? { label: '再試一次', fn: () => submitCompanions(result.retryDogs, names, result) } : null);
  }

  // 提示條還是剛剛那則（使用者還沒按別的）才換成確認後的說法
  function replaceToast(from, to) {
    const el = document.getElementById('toast');
    if (el && !el.hidden && el.querySelector('.toast-text').textContent === from) el.querySelector('.toast-text').textContent = to;
  }

  // #445（K 2026-10-21）：有按鈕（復原、再試一次、＋一起溜的人）的提示條要來得及按，顯示久一點
  const TOAST_MS = 5000, TOAST_ACTION_MS = 8000;
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
    toastTimer = setTimeout(hideToast, undo || extra ? TOAST_ACTION_MS : TOAST_MS);
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
  // V9（#141）拿掉今天已溜：按過的狗按鈕變成「已溜」，再按一次復原（#445 起照天數排到後面）
  function walkButton(dog) {
    if (!walkKey(dog)) return `<span class="more">${icon('chevron')}</span>`;
    if (restOf(dog)) return ''; // 休養中暫停帶出：不放溜了，免得順手按到
    // #445：D1 復原已先顯示成沒溜，等確認期間不能再按
    if (undoPending.has(walkKey(dog)) && !walkedNow(dog)) return `<button type="button" class="walk-btn" disabled aria-label="${esc(dog.name)} 正在確認取消今天溜了">溜了</button>`;
    // #498：復原按下後到伺服器回應前也要有回饋，不能看起來沒反應又被重按（沒有登記前資料可先顯示時）
    if (undoPending.has(walkKey(dog))) return `<button type="button" class="walk-btn pending" disabled aria-label="${esc(dog.name)} 正在取消今天溜了">取消中</button>`;
    if (walkPendingNow(dog) && !walkedNow(dog)) return `<button type="button" class="walk-btn pending" disabled aria-label="${esc(dog.name)} 正在登記">登記中</button>`;
    const state = walkRegistration.state(dog);
    const disabled = sheetWillWrite() && !state.canRevert && !walkPendingNow(dog) ? ' disabled' : '';
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
    if (!appState.UPLOAD_URL || appState.sheetWriteState === 'off' || dog.departure) return null;
    if (!loadWalkerName() || isOffline() || walkPendingNow(dog)) return null;
    const key = walkKey(dog);
    if (!key) return null;
    const state = walkRegistration.state(dog, BQDates.localDateKey(today));
    return state.today && state.walker ? state.walker : null;
  }
  // 只剩一個人時，那個 × 是取消這次登記：日期和名字改回登記前（K 2026-10-05），由 Worker 從溜狗紀錄找上一次（ADR 0016，任何人都能撤銷）
  function walkerUndoable(dog, who, today = new Date()) {
    return who.length === 1 && walkRegistration.state(dog, BQDates.localDateKey(today)).canRevert;
  }

  function walkerChipsHtml(dog, who, today) {
    if (!who.length) return isOffline() ? '<span class="lw-none">讀不到（沒網路）</span>' : '<span class="lw-none">—</span>';
    if (!walkerEditBase(dog, today)) {
      const reason = isOffline() ? '沒網路，連線後才能編輯' : !loadWalkerName() ? '請先在「我溜過」選好你的名字再編輯'
        : walkPendingNow(dog) ? '正在寫進試算表，請稍候' : !appState.UPLOAD_URL || appState.sheetWriteState === 'off' ? '目前無法寫入試算表'
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
  async function editWalkers(dog, names) {
    const expected = walkerEditBase(dog);
    const key = walkKey(dog);
    if (!expected || walkerEditBusy) return;
    walkerEditBusy = key;
    renderDetail();
    try {
      const result = await walkRegistration.register([dog], { walker: [...new Set(names)].join('、'), expected });
      if (!result.successful.length) showToast(registrationText(result), null,
        result.retryDogs.length ? { label: '再試一次', fn: () => retryWalkerEdit(result) } : null);
    } finally { walkerEditBusy = ''; render(); renderDetail(); }
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
    sheetWillWrite, registrationText,
    walkButton, walkSyncHtml, showToast, hideToast
  };
})();

export { BQWalkUI };
