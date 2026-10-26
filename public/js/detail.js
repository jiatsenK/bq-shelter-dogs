// 詳細資訊的畫面總控：畫內容、在外框綁一次事件、開關與焦點還原。
// 各編輯器（休養、固定照顧、入所介紹、出入所紀錄（含舊編號，#639））在各自的 detail-*.js；試算表備註在 sheet-append.js
import { canEdit } from './feature-settings.js';
import { BQDates } from './dates.js';
import { BQDetailEditor } from './detail-editor.js';
import { createDetailEditorViewport } from './detail-viewport.js';
import { appState } from './page-state.js';
import { esc, highlightNote, icon, monthDay, ymdText } from './ui-kit.js';
import { specialFlag, walkKey } from './dog-status.js';
import { BQPhoto } from './photo.js';
import { BQWalkUI } from './walk-ui.js';
import { whereKnown, whereOpen } from './find.js';
import { walkHistorySection } from './analysis.js';
import { computeStatus, effectiveWalkDate, openLightbox, photoThumb, render, restOf, searchInput, sexMark, walkedNow, walkedToday, walkerList, warnNote } from './app.js';
import { sheetAppendHtml } from './sheet-append.js';
import { fixedCareHtml, toggleFixedCare } from './detail-fixed-care.js';
import { closeRestEdit, openRestEdit, restAdminHtml, restInput, restNoteHtml, saveRest } from './detail-rest.js';
import { closeIntroEdit, introBarHtml, introInput, introOf, introRowClick, introSectionHtml, openIntroEdit, saveIntro } from './detail-intro.js';
import { closeStaysEdit, openStaysEdit, saveStays, staysInput, staysRowClick, staysTableHtml } from './detail-stays.js';
import { closeOverlay, pushOverlay, registerOverlay } from './overlays.js';

const detailEdits = BQDetailEditor.create(renderDetail);

function statusBadge(dog, today) {
  const s = computeStatus(dog, today);
  if (s.kind === 'dated') {
    if (s.days < 0) return `<span class="badge muted">日期看不懂</span>`;
    const label = s.days === 0 ? '今天' : `${s.days} 天前`;
    return `<span class="badge ${s.level}">${label}</span>`;
  }
  if (s.kind === 'covered') return `<span class="badge sage">有人固定照顧</span>`;
  if (s.kind === 'rest') return `<span class="badge rest">休養中・到 ${monthDay(s.until)}</span>`;
  return `<span class="badge muted">沒有紀錄</span>`;
}

// 詳細資訊：籠位已經在標籤上（#112），這裡只寫編號和出入所表（#639 取代舊編號一行）
function metaLine(dog) {
  return `${dog.id ? `<div class="meta">編號 ${esc(dog.id)}</div>` : ''}${staysTableHtml(dog)}`;
}

// 詳細資訊：備註（志工後續補充，試算表備註欄）／可以一起溜的狗／狗卡資訊（dogs/{編號}.md 的入所原始介紹，同步時已寫進 dogs.json）
// 詳細資訊名字旁的「☆ 常溜」／「★ 我的常溜」
function favButtonHtml(dog) {
  if (!walkKey(dog) || dog.departure) return '';
  const on = appState.favorites.isFav(dog);
  return `<button type="button" class="fav-btn${on ? ' on' : ''}" id="favToggle" aria-pressed="${on}">${on ? '★ 我的常溜' : '☆ 常溜'}</button>`;
}

function detailHtml(dog, today) {
  if (dog.departure) return departedDetailHtml(dog, today);
  const flag = specialFlag(dog.note);
  const intro = introOf(dog);
  const walked = walkedToday(today);
  // V7（#112）：上面大照片，下面狗名和天數／籠位／入所標籤；關閉、在哪、溜了在底部固定列（在哪裡卡片 V7 小修正拿掉，改用底部「在哪」）
  return `
    <div class="detail-head">
      ${BQPhoto.heroHtml(dog)}
      ${BQPhoto.uploadHtml(dog)}
      <div class="info">
        <div class="name-row"><h2 class="name" id="detailName">${esc(dog.name)}${sexMark(dog)}</h2>${favButtonHtml(dog)}</div>
        <div class="chips">${statusBadge(dog, today)}${detailChips(dog)}</div>
        ${metaLine(dog)}
        ${restNoteHtml(dog, today)}
      </div>
    </div>
    ${lastWalkSection(dog, today)}
    ${appState.detailTrail.length ? `<button type="button" class="detail-back" id="detailBack">${icon('back')}回到 ${esc(appState.detailTrail[appState.detailTrail.length - 1].name)}</button>` : ''}
    <section class="detail-section" data-section="note">
      <h3>${icon('note')}試算表備註</h3>
      ${!dog.note ? `<div class="empty">目前沒有備註</div>`
        : `<div class="content note-text">${flag ? highlightNote(dog.note, flag.terms) : esc(dog.note)}</div>`}
      ${sheetAppendHtml('note', dog)}
    </section>
    ${togetherSection(dog, walked)}
    ${walkHistorySection(dog, today)}
    ${introSectionHtml(dog, intro)}
    ${fixedCareHtml(dog)}
    ${restAdminHtml(dog, today)}
    ${BQPhoto.barHtml(dog) || introBarHtml(dog) || `<div class="detail-bar">
      <button type="button" class="bar-btn" id="detailClose">關閉</button>
      ${typeof whereKnown === 'function' && whereKnown(dog) ? `<button type="button" class="bar-btn" id="detailWhere">${icon('pin')}在哪</button>` : ''}
      ${groupWalkButton(dog, walked)}
    </div>`}
  `;
}

// 離所的狗（#164）：同一個詳細資訊，頂部標離所原因和日期取代天數，多一區離所紀錄；
// 沒有溜了、在哪、☆、換照片，也不放同籠和可以一起溜（那是在所時的事）
function departedDetailHtml(dog, today) {
  const dep = dog.departure;
  const flag = specialFlag(dog.note);
  const back = dep.returned && appState.allDogs.find(d => d.id === dep.returned);
  return `
    <div class="detail-head">
      ${BQPhoto.heroHtml(dog)}
      <div class="info">
        <div class="name-row"><h2 class="name" id="detailName">${esc(dog.name)}${sexMark(dog)}</h2></div>
        <div class="chips">${departureBadge(dep)}${since(dog)}</div>
        ${metaLine(dog)}
      </div>
    </div>
    ${appState.detailTrail.length ? `<button type="button" class="detail-back" id="detailBack">${icon('back')}回到 ${esc(appState.detailTrail[appState.detailTrail.length - 1].name)}</button>` : ''}
    <section class="detail-section departed" data-section="departure">
      <h3>${icon('note')}離所紀錄</h3>
      <div class="lw-row"><span class="lw-k">原因</span><span class="lw-v">${esc(DEPARTURE_LABELS[dep.reason])}</span></div>
      <div class="lw-row"><span class="lw-k">日期</span><span class="lw-v">${esc(ymdText(dep.date))}${dep.dateSource === 'seen' ? '<small>（從試算表消失的那天）</small>' : ''}</span></div>
      <div class="lw-row"><span class="lw-k">依據</span><span class="lw-v">${esc(departureBasis(dep))}</span></div>
      <div class="lw-row"><span class="lw-k">最後籠位</span><span class="lw-v">${esc(dog.cage || '—')}</span></div>
      ${back ? `<button type="button" class="detail-back" data-departed-back="${appState.allDogs.indexOf(back)}">${icon('paw')}已再入所，看現在的 ${esc(back.name)}</button>` : ''}
    </section>
    <section class="detail-section last-walk" data-section="last">
      <div class="lw-row"><span class="lw-k">上次溜</span><span class="lw-v">${esc(dog.walkedDate ? ymdText(dog.walkedDate) : '沒有紀錄')}</span></div>
    </section>
    <section class="detail-section" data-section="note">
      <h3>${icon('note')}試算表備註<span class="sub">離所前最後一次</span></h3>
      ${!dog.note ? `<div class="empty">沒有備註</div>`
        : flag ? warnNote(dog.note, flag)
        : `<div class="content note-text">${esc(dog.note)}</div>`}
    </section>
    ${walkHistorySection(dog, today)}
    ${introSectionHtml(dog, introOf(dog))}
    <div class="detail-bar"><button type="button" class="bar-btn" id="detailClose">關閉</button></div>
  `;
  function since(d) {
    const s = BQDates.firstIntake(d);
    return s ? `<span class="badge plain">入所 ${s.getFullYear()}/${s.getMonth() + 1}</span>` : '';
  }
}

const DEPARTURE_LABELS = { adopt: '認養', death: '離世', other: '其他', unknown: '待確認' };
function departureBadge(dep) {
  const label = dep.reason === 'unknown' ? '待確認' : `已${DEPARTURE_LABELS[dep.reason] === '其他' ? '離所' : DEPARTURE_LABELS[dep.reason]}`;
  return `<span class="badge dep-${dep.reason}">${esc(label)}${dep.date ? ` · ${dep.date.getMonth() + 1}/${dep.date.getDate()}` : ''}</span>`;
}
// 判讀依據：只寫命中的關鍵字，不放已出所分頁的原文（K 2026-10-08）
function departureBasis(dep) {
  if (dep.reason !== 'unknown') return `已出所分頁寫了「${dep.matched}」`;
  if (dep.flags.includes('not-in-sheet')) return '已出所分頁找不到這隻狗';
  if (dep.flags.includes('conflict')) return `已出所分頁同時寫了「${dep.matched}」，看不出是哪一個`;
  if (dep.flags.includes('duplicate')) return '已出所分頁有好幾列，寫的不一樣';
  if (dep.flags.includes('unsure')) return `已出所分頁寫了「${dep.matched}」，還沒定案`;
  return '已出所分頁沒寫原因';
}

// V9（#141 第 9 項）：上次溜的日期和溜狗人，放在照片和名字下面第一個
function lastWalkSection(dog, today) {
  const s = computeStatus(dog, today);
  const d = s.mine ? today : effectiveWalkDate(dog, today);
  const date = d ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）` : (s.kind === 'covered' ? '有人固定照顧' : '沒有紀錄');
  const who = walkerList(dog, today);
  return `<section class="detail-section last-walk" data-section="last">
    <div class="lw-row"><span class="lw-k">上次溜</span><span class="lw-v">${esc(date)}</span></div>
    <div class="lw-row"><span class="lw-k">溜狗人</span><span class="lw-v">${BQWalkUI.walkerChipsHtml(dog, who, today)}</span></div>
    ${BQWalkUI.walkSyncHtml(dog)}
  </section>`;
}

// 詳細資訊狗名下面的標籤：籠位、入所年月（天數標籤是 statusBadge）
function detailChips(dog) {
  const since = BQDates.firstIntake(dog);
  const home = dog.homeCage ? `<small>暫住，原本 ${esc(dog.homeCage)}</small>` : '';
  // K 2026-10-09：詳細資訊的籠位也要能點開平面圖（找得到位置的籠位才做成按鈕）
  const where = typeof whereKnown === 'function' && whereKnown(dog);
  return (dog.cage ? (where
    ? `<button type="button" class="badge plain cage-badge" data-where aria-label="${esc(dog.name)} 在哪：${esc(dog.cage)}">${icon('pin')}${esc(dog.cage)}${home}</button>`
    : `<span class="badge plain">${icon('pin')}${esc(dog.cage)}${home}</span>`) : '')
    + (since ? `<span class="badge plain">入所 ${since.getFullYear()}/${since.getMonth() + 1}</span>` : '');
}

// 可以一起溜的每一隻：輕點照片換看那隻；右上角圓圈勾選，之後用下方按鈕一起記（#35，K 選 C）。
// 今天已溜的不顯示圓圈，改標「今天已溜」
function buddyTile(d, name, walkedNow, mate) {
  const walked = walkedNow.has(d);
  const canPick = walkKey(d) && !walked && appState.allDogs.includes(d);
  const picked = canPick && appState.pickedBuddies.has(walkKey(d));
  return `<div class="buddy-tile">
    <button class="buddy" data-dog="${appState.allDogs.indexOf(d)}"${appState.allDogs.includes(d) ? '' : ' disabled'}>${photoThumb(d, 64)}<span class="bname">${esc(name)}</span></button>
    ${mate ? `<span class="mate-tag">同籠</span>` : ''}
    ${walked ? `<span class="walked-tag">今天已溜</span>` : ''}
    ${canPick ? `<button type="button" class="pick${picked ? ' on' : ''}" data-pick="${esc(walkKey(d))}" aria-pressed="${picked}" aria-label="勾選 ${esc(name)} 一起記">${icon('tick')}</button>` : ''}
  </div>`;
}

// 同籠的狗（K 2026-09-27）：籠位欄位一樣的其他狗，跟「可以一起溜」同一種格子，也能勾選一起記。
// 「○○區」（住院區、C區）是整區不是一籠，不算同籠；母幼區（母幼A…）也是各自一籠（K 2026-10-16）；沒有同籠的狗整段不顯示
function cageMates(dog) {
  const cage = String(dog.cage || '').replace(/\s+/g, '');
  if (!cage || /區$/.test(cage) || /^母幼/.test(cage)) return [];
  return appState.allDogs.filter(d => d !== dog && String(d.cage || '').replace(/\s+/g, '') === cage);
}

// 同籠＋可以一起溜合成一段（K 2026-10-10 減法：兩段常常是同一批狗）：同籠的排前面、標「同籠」，
// 登記可以一起溜又不同籠的接在後面；同一隻只出現一次
function togetherSection(dog, walked) {
  const byName = new Map(appState.allDogs.map(d => [d.name, d]));
  const mates = cageMates(dog);
  const buddies = [...(appState.groupMap[dog.name] || [])].map(n => byName.get(n) || { name: n, id: '' });
  const list = [...mates, ...buddies.filter(d => !mates.includes(d))];
  return `
    <section class="detail-section" data-section="group">
      <h3>${icon('group')}同籠、可以一起溜的狗</h3>
      ${list.length
        ? `<div class="buddies">${list.map(d => buddyTile(d, d.name, walked, mates.includes(d))).join('')}</div>`
        : `<div class="empty">沒有同籠，也沒有登記可以一起溜的狗</div>`}
      <a class="group-page-link" href="groups.html">看全部狗群</a>
    </section>`;
}

// 「可以一起溜」下方的按鈕：把目前這隻連同勾選的狗一次記進今天已溜。
// 目前這隻已溜又沒勾選時，就顯示目前這隻今天已溜，不放按鈕
function groupWalkButton(dog, walked) {
  if (BQWalkUI.walkPendingNow(dog) && !walkedNow(dog)) return `<button type="button" class="group-walk" id="groupWalk" disabled>登記中</button>`;
  const rest = restOf(dog);
  const self = !!walkKey(dog) && !walked.has(dog) && !rest;
  const n = [...appState.pickedBuddies].length;
  if (!self && !n) {
    if (rest) return `<div class="self-walked rest">休養中，暫停帶出</div>`;
    return walked.has(dog) ? `<div class="self-walked">${icon('tick')}今天已溜</div>` : '';
  }
  // 底部列空間小（#112）：只有自己寫「溜了」，有勾選才寫幾隻
  const label = !n ? '溜了'
    : self ? `和勾選的 ${n} 隻都溜了`
    : `勾選的 ${n} 隻都溜了`;
  return `<button type="button" class="group-walk" id="groupWalk">${icon('tick')}${label}</button>`;
}

// 詳細資訊的按鈕（#86）：在外框綁一次，依按下的是哪個按鈕分派，每次重畫內容不用重新綁。
// 由上往下找第一個符合的，所以同一個按鈕只會做一件事
const DETAIL_CLICKS = [
  ['#fixedCareToggle', () => toggleFixedCare(appState.detailDog)],
  ['#detailClose', () => closeDetail()],
  ['[data-zoom]', el => { if (!el.classList.contains('no-photo')) openLightbox(appState.detailDog, el); }],
  ['#photoCrop', () => BQPhoto.cropPreview()],
  ['#photoPick', () => BQPhoto.pick()],
  ['#restEdit', () => openRestEdit(appState.detailDog)],
  ['#introEdit', () => openIntroEdit(appState.detailDog)],
  ['#staysEdit', () => openStaysEdit(appState.detailDog)],
  ['#staysCancel', () => closeStaysEdit()],
  ['#walksToggle', () => { appState.detailWalksOpen = !appState.detailWalksOpen; renderDetail(); const b = document.getElementById('walksToggle'); if (b) b.focus({ preventScroll: true }); }],
  ['#introCancel', () => closeIntroEdit()],
  ['#restEnd', () => saveRest(true)],
  ['#restCancel', () => closeRestEdit()],
  ['#photoConfirm', () => BQPhoto.upload()],
  ['#photoCancel', () => { BQPhoto.clear(); renderDetail(); }],
  ['.buddy', el => { const d = appState.allDogs[el.dataset.dog]; if (d) showDetail(d); }],
  ['#whoAdd', () => BQWalkUI.openWithSheet([appState.detailDog], true)],
  ['[data-who-undo]', () => BQWalkUI.sheetUndoable(appState.detailDog) ? BQWalkUI.setWalked([appState.detailDog], false) : BQWalkUI.undoSheetWalks([appState.detailDog], null, { reveal: true })],
  ['[data-who-remove]', el => {
    const n = el.dataset.whoRemove;
    BQWalkUI.editWalkers(appState.detailDog, walkerList(appState.detailDog).filter(x => x !== n), `已拿掉 ${n}`);
  }],
  ['#favToggle', () => { appState.favorites.toggleFav(appState.detailDog); renderDetail(); render(); }],
  ['#detailBack', () => { const d = appState.detailTrail.pop(); if (d) showDetail(d, false); }],
  ['[data-departed-back]', el => { const d = appState.allDogs[el.dataset.departedBack]; if (d) showDetail(d); }],
  ['#detailWhere', el => whereOpen(appState.detailDog, el)],
  ['[data-where]', el => whereOpen(appState.detailDog, el)],
  ['.pick', el => {
    const id = el.dataset.pick;
    if (appState.pickedBuddies.has(id)) appState.pickedBuddies.delete(id); else appState.pickedBuddies.add(id);
    renderDetail();
  }],
  ['#groupWalk', () => {
    const picked = [...appState.pickedBuddies].map(id => appState.allDogs.find(d => walkKey(d) === id));
    BQWalkUI.setWalked([appState.detailDog, ...picked], true);
  }],
];
// 各表單送出時存哪一種編輯
const DETAIL_FORMS = { introForm: saveIntro, staysForm: saveStays, restForm: () => saveRest() };

function wireDetail(box) {
  if (box.bqWired) return;
  box.bqWired = true;
  box.addEventListener('click', e => staysRowClick(e, box));
  box.addEventListener('click', e => introRowClick(e, box));
  // 打的字記在各自的編輯狀態，重畫不會不見
  box.addEventListener('input', e => {
    if (staysInput(e) || introInput(e, box)) return;
    restInput(e);
  });
  box.addEventListener('submit', e => {
    const save = Object.hasOwn(DETAIL_FORMS, e.target.id) ? DETAIL_FORMS[e.target.id] : null;
    if (!save) return;
    e.preventDefault();
    save();
  });
  box.addEventListener('click', e => {
    if (!appState.detailDog || !e.target.closest) return;
    for (const [sel, run] of DETAIL_CLICKS) {
      const el = e.target.closest(sel);
      if (!el || !box.contains(el)) continue;
      if (!el.disabled) run(el);
      return;
    }
  });
}

// 已經有照片就把相機按鈕叫「更換照片」；照片晚一點才載入完也會改（詳細資訊已關就不管）
function labelPhotoPick(box) {
  const pick = box.querySelector('#photoPick');
  const img = box.querySelector('[data-zoom] img');
  if (!pick || !img) return;
  const dog = appState.detailDog;
  const label = () => {
    if (img.naturalWidth && pick.isConnected) { pick.setAttribute('aria-label', `更換 ${dog.name} 的照片`); pick.title = '更換照片'; }
  };
  label();
  img.addEventListener('load', label);
}

const detailEditorViewport = createDetailEditorViewport(document.getElementById('detailBackdrop'), document.getElementById('detail'));

function renderDetail() {
  for (const [key, field] of [['editIntro','introEdit'],['editRest','restEdit'],['editStays','staysEdit']]) {
    if (!canEdit(key) && appState[field]?.phase !== 'saving') appState[field] = null;
  }
  if (!appState.detailDog) return;
  const box = document.getElementById('detail');
  wireDetail(box);
  const editingFocus = detailEditorViewport.capture();
  const focused = box.contains(document.activeElement) ? document.activeElement : null;
  // 重畫後留在原本捲到的位置（K 2026-10-10：補完資料「整個卡片就會跳掉」）；換看別隻時 showDetail 會自己捲回最上面
  const top = box.scrollTop;
  box.innerHTML = detailHtml(appState.detailDog, new Date());
  box.scrollTop = top;
  labelPhotoPick(box);
  if (focused) {
    const replacement = [...box.querySelectorAll('button, textarea, input:not([hidden])')].find(btn =>
      (focused.id && btn.id === focused.id) ||
      (focused.dataset.pick && btn.dataset.pick === focused.dataset.pick) ||
      (focused.classList.contains('buddy') && btn.classList.contains('buddy') && btn.dataset.dog === focused.dataset.dog) ||
      (focused.dataset.gFile && btn.dataset.gFile === focused.dataset.gFile) ||
      (focused.hasAttribute('data-g-main') && btn.hasAttribute('data-g-main')));
    // 選了照片時底部換成取消／確認上傳（#146），沒有關閉鈕就落到那列第一顆
    const fallback = box.querySelector('#detailClose') || box.querySelector('.photo-bar button');
    if (replacement || fallback) (replacement || fallback).focus({ preventScroll: true });
  }
  detailEditorViewport.restore(editingFocus);
}

// 換看別隻或關掉時收掉這隻的暫時狀態；正在儲存的編輯留著，存完才知道結果
function leaveDetailDog() {
  detailEditorViewport.reset();
  appState.pickedBuddies.clear();
  appState.detailWalksOpen = false;
  for (const field of ['restEdit', 'introEdit', 'staysEdit']) {
    if (!appState[field] || appState[field].phase !== 'saving') appState[field] = null;
  }
  BQPhoto.leaveDetail();
}

// 在詳細資訊裡點「可以一起溜的狗」會直接換成那隻，不多疊一層；換之前的狗記在 detailTrail，可以按「回到 ○○」
function showDetail(dog, remember = true) {
  const wasOpen = !!appState.detailDog;
  if (!wasOpen) appState.detailOpener = { element: document.activeElement, index: appState.allDogs.indexOf(dog) };
  if (wasOpen && remember && dog !== appState.detailDog) appState.detailTrail.push(appState.detailDog);
  if (dog !== appState.detailDog) leaveDetailDog();
  appState.detailDog = dog;
  renderDetail();
  document.getElementById('detailBackdrop').hidden = false;
  detailEditorViewport.sync();
  document.documentElement.classList.add('detail-open');
  document.getElementById('detail').scrollTop = 0;
  // 手機按「返回」時只關掉詳細資訊，不離開網頁
  if (!wasOpen) pushOverlay('detail');
  const first = document.getElementById('detailClose') || document.querySelector('#detail .photo-bar button');
  if (first) first.focus({ preventScroll: true });
}

function hideDetail() {
  if (!appState.detailDog) return;
  appState.detailDog = null;
  appState.detailTrail = [];
  leaveDetailDog();
  document.getElementById('detailBackdrop').hidden = true;
  document.getElementById('detail').innerHTML = '';
  document.documentElement.classList.remove('detail-open');
  if (appState.detailOpener) {
    const card = document.querySelector(`#main .card[data-dog="${appState.detailOpener.index}"]`);
    const opener = appState.detailOpener.element;
    (card || (opener && opener.isConnected && opener !== document.body ? opener : searchInput)).focus({ preventScroll: true });
    appState.detailOpener = null;
  }
}

function closeDetail() {
  closeOverlay('detail');
}
registerOverlay('detail', { isOpen: () => !!appState.detailDog, hide: hideDetail });

export { detailEdits, statusBadge, metaLine, favButtonHtml, detailHtml, departedDetailHtml, DEPARTURE_LABELS, departureBadge, departureBasis, lastWalkSection, detailChips, buddyTile, cageMates, togetherSection, groupWalkButton, DETAIL_CLICKS, wireDetail, labelPhotoPick, detailEditorViewport, renderDetail, showDetail, hideDetail, closeDetail };
