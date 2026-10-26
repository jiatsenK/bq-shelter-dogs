import { canEdit } from './feature-settings.js';
import { BQApi } from './api.js';
import { BQDates } from './dates.js';
import { appState } from './page-state.js';
import { esc, icon, isoDay } from './ui-kit.js';
import { BQWalkUI } from './walk-ui.js';
import { NEED_EDITOR, editorName, render } from './app.js';
import { detailEdits, renderDetail } from './detail.js';
import { staysSectionHtml } from './detail-stays.js';

// ── 入所介紹（K 2026-10-10）：志工可不可以改看功能管理的 editIntro（ADR 0020），記編輯紀錄（ADR 0004）；存 D1，不寫試算表 ──
const INTRO_MAX = 1000;
const introOverrides = {}; // 編號 → 剛存好的介紹：這台電腦不用重新讀就看到（#250 起存 D1，其他人重新整理就看得到）
function intakeEventsOf(dog) {
  return dog.intakeEvents || [];
}
function intakeDraft(dog) {
  return intakeEventsOf(dog).map(row => ({ ...row }));
}
// #390：僅整理閱讀畫面，不修改原介紹、stays 或入所日算法。
function intakePresentation(dog, intro) {
  const events = intakeEventsOf(dog).map(e => ({ date: e.date, event: e.event }));
  let supplement = intro || '';
  // 只排版開頭明寫完整日期的句子；沒有年份、不合理日期與其餘文字照原樣保留。
  const datedSentence = /^(\d{4})年(\d{1,2})月(\d{1,2})日([^。\n]+)(?:[。\n]+|$)/;
  for (;;) {
    const match = supplement.match(datedSentence);
    if (!match) break;
    const date = BQDates.makeDate(+match[1], +match[2], +match[3]);
    if (!date) break;
    events.push({ date: isoDay(date), event: match[4] });
    supplement = supplement.slice(match[0].length);
  }
  const sameText = value => String(value || '').replace(/[\s。]+/g, '');
  const add = row => {
    if (!events.some(e => e.date === row.date && sameText(e.event) === sameText(row.event))) events.push(row);
  };
  // 出入所表（ADR 0021）只拿手填的那幾筆：只有編號的列、離所紀錄帶的出所日，改之前不在這裡（#639 刻意不改閱讀畫面）
  const typed = (dog.stays || []).map(s => (s.departed ? { ...s, out: '' } : s)).filter(s => !s.number || s.out || s.reason);
  for (const stay of typed) {
    // #392 盤點的舊資料：這兩種原因記的是該段怎麼結束，不能改標成入所原因。
    const ending = stay.out && ['整修移所', '領養後退養'].includes(stay.reason);
    const reason = ending ? '' : stay.reason;
    const arrival = reason ? (/入所$/.test(reason) ? reason : `${reason}入所`) : '入所';
    const hasArrival = events.some(e => e.date === stay.in && (sameText(e.event) === sameText(arrival) || (!reason && /入所|轉來|退回/.test(e.event))));
    if (!hasArrival) add({ date: stay.in, event: arrival });
    if (stay.out) add({ date: stay.out, event: ending ? stay.reason : '出所' });
  }
  const unique = [];
  const covers = (longer, shorter) => {
    const a = sameText(longer), b = sameText(shorter);
    return a === b || (b && ['，', ',', '；', ';'].some(mark => a.startsWith(b + mark)));
  };
  for (const row of events) {
    if (unique.some(e => e.date === row.date && covers(e.event, row.event))) continue;
    for (let i = unique.length - 1; i >= 0; i--) {
      if (unique[i].date === row.date && covers(row.event, unique[i].event)) unique.splice(i, 1);
    }
    unique.push(row);
  }
  unique.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  return { events: unique, supplement };
}
function intakeListHtml(events) {
  if (!events.length) return '';
  return `<ul class="intake-list">${events.map(e => `<li>${e.date ? `<time datetime="${esc(e.date)}">${esc(e.date.replace(/-/g, '/'))}</time>` : '<span class="intake-date-empty">日期未確認</span>'}<span class="intake-event">${esc(e.event || '原因未填')}</span></li>`).join('')}</ul>`;
}
function intakeEditorHtml(dog, e, busy) {
  const numbers = [...new Set([...(dog.formerIds || []), dog.id, ...e.events.map(row => row.number)].filter(Boolean))].sort();
  return `<p class="rest-hint">一次入所、退回或轉所一列。日期依確認的資料填寫，不確定就留空，不以編號推定。原因可留空。</p>
    <div class="intake-rows">${e.events.map((row, i) => `<fieldset class="intake-row"><legend>第 ${i + 1} 筆</legend>
      <label>日期<input type="date" data-intake-row="${i}" data-intake-field="date" value="${esc(row.date)}"${busy ? ' disabled' : ''}></label>
      <label>原因<input type="text" maxlength="1000" data-intake-row="${i}" data-intake-field="event" value="${esc(row.event)}" placeholder="例：迷路入所、認養後退回"${busy ? ' disabled' : ''}></label>
      <label>對應編號<select data-intake-row="${i}" data-intake-field="number"${busy ? ' disabled' : ''}><option value="">尚未確認</option>${numbers.map(n => `<option value="${esc(n)}"${n === row.number ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <button type="button" class="intake-remove" data-intake-remove="${i}"${busy ? ' disabled' : ''}>移除第 ${i + 1} 筆</button>
    </fieldset>`).join('')}</div>
    <button type="button" id="intakeAdd"${busy || e.events.length >= 30 ? ' disabled' : ''}>新增一筆</button>`;
}
function introOf(dog) {
  return dog.id && Object.prototype.hasOwnProperty.call(introOverrides, dog.id) ? introOverrides[dog.id] : dog.intro;
}
function introSectionHtml(dog, intro) {
  if (appState.staysEdit && appState.staysEdit.dog === dog) return staysSectionHtml(dog);
  const e = appState.introEdit && appState.introEdit.dog === dog ? appState.introEdit : null;
  if (!e) {
    // 出入所紀錄的入口在編號下面的出入所表（#639）
    const can = canEdit('editIntro') && !!(dog.id && appState.UPLOAD_URL) && !dog.departure;
    const { events, supplement } = intakePresentation(dog, intro);
    if (!events.length && !supplement && !can) return '';
    return `<section class="detail-section" data-section="intro">
      <h3 class="intro-heading">${icon('card')}入所介紹${can ? `<button type="button" class="intro-heading-edit" id="introEdit" aria-label="${events.length || supplement ? '改' : '補'}入所介紹">${icon('write')}</button>` : ''}</h3>
      ${intakeListHtml(events)}
      ${supplement ? `<div class="content">${esc(supplement)}</div>` : ''}
    </section>`;
  }
  const busy = e.phase === 'saving';
  const n = [...e.text].length;
  return `<section class="detail-section" data-section="intro">
    <form class="rest-form intro-form" id="introForm" autocomplete="on">
      <h3>${icon('card')}入所介紹</h3>
      ${intakeEditorHtml(dog, e, busy)}
      <p class="rest-hint">存好後這台馬上看到，其他人幾分鐘後（下次更新資料）看到。只存在網站，不寫試算表。</p>
      <label>補充介紹（保留原文）<textarea id="introText" rows="7" maxlength="${INTRO_MAX}" placeholder="例：親人、喜歡散步，怕機車聲"${busy ? ' disabled' : ''}>${esc(e.text)}</textarea><small class="intro-count${n > INTRO_MAX ? ' over' : ''}">${n} / ${INTRO_MAX} 字</small></label>
      ${e.error ? `<div class="photo-error" role="alert">${esc(e.error)}</div>` : ''}
    </form>
  </section>`;
}
// 介紹表單打開時的底部列：取消＋儲存介紹（送出 #introForm）；溜了先收起來，跟換照片同一個做法（#146）
function introBarHtml(dog) {
  if (appState.staysEdit && appState.staysEdit.dog === dog) return '';
  const e = appState.introEdit && appState.introEdit.dog === dog ? appState.introEdit : null;
  if (!e) return '';
  const busy = e.phase === 'saving';
  return `<div class="detail-bar photo-bar">${busy ? '' : '<button type="button" class="bar-btn" id="introCancel">取消</button>'}<button type="submit" form="introForm" class="bar-confirm"${busy ? ' disabled' : ''}>${busy ? '儲存中…' : '儲存介紹'}</button></div>`;
}
function openIntroEdit(dog) {
  if (!dog || !dog.id || !appState.UPLOAD_URL) return;
  appState.introEdit = detailEdits.open(dog, { text: introOf(dog) || '', events: intakeDraft(dog) });
  renderDetail();
  const box = document.querySelector('#introForm [data-intake-field="date"]') || document.getElementById('introText');
  if (box) {
    box.focus({ preventScroll: true }); // 捲到看得見交給 detail-viewport.js，只捲狗卡不捲整頁（#389）
  }
}
async function saveIntro() {
  const e = appState.introEdit;
  if (!e || e.phase === 'saving') return;
  const editor = editorName();
  if (!editor) { detailEdits.fail(e, NEED_EDITOR); return; }
  const text = e.text.replace(/\r\n?/g, '\n').trim();
  if ([...text].length > INTRO_MAX) { detailEdits.fail(e, `最多 ${INTRO_MAX} 字`); return; }
  if (e.events.reduce((n, row) => n + [...row.event].length, 0) > INTRO_MAX) { detailEdits.fail(e, '原因合計最多 1000 字'); return; }
  detailEdits.saving(e);
  let out = null, error = '';
  const r = await BQApi.saveIntro(e.dog.id, { editor, text, events: e.events, revision:e.revision });
  out = r.data;
  if (r.error === 'network') error = '沒有存進去，請確認網路後再試';
  else if (!r.ok || !out || !out.ok) error = (out && out.error) || `沒有存進去（${r.status}），請稍後再試`;
  else if (!Array.isArray(out.intakeEvents) && (e.events.length || intakeEventsOf(e.dog).length)) error = '伺服器尚未確認逐次紀錄已儲存，請稍後再試';
  if (appState.introEdit !== e) return;
  if (error) {
    detailEdits.fail(e, error);
    return;
  }
  if(out.revision)e.dog.editRevision=out.revision;
  introOverrides[e.dog.id] = typeof out.intro === 'string' ? out.intro : text;
  e.dog.intakeEvents = Array.isArray(out.intakeEvents) ? out.intakeEvents : e.events;
  appState.introEdit = null;
  render(); renderDetail();
  const b = document.getElementById('introEdit');
  if (b) b.focus({ preventScroll: true });
  BQWalkUI.showToast(`${e.dog.name} 的介紹已存好（其他人重新整理就看得到）`);
}


function closeIntroEdit() {
  appState.introEdit = null;
  renderDetail();
  const b = document.getElementById('introEdit');
  if (b) b.focus({ preventScroll: true });
}

// 逐次紀錄新增／移除一筆：重畫後焦點落在新的那筆或「新增一筆」
function introRowClick(e, box) {
  if (!appState.introEdit || appState.introEdit.phase === 'saving') return;
  if (e.target.closest('#intakeAdd') && appState.introEdit.events.length < 30) {
    appState.introEdit.events.push({ number: appState.introEdit.dog.id, date: '', event: '' });
    renderDetail(); box.querySelector('.intake-row:last-child input')?.focus({ preventScroll: true });
  }
  const remove = e.target.closest('[data-intake-remove]');
  if (remove) {
    appState.introEdit.events.splice(Number(remove.dataset.intakeRemove), 1);
    renderDetail(); box.querySelector('#intakeAdd')?.focus({ preventScroll: true });
  }
}

function introInput(e, box) {
  if (!appState.introEdit) return false;
  if (e.target.dataset.intakeField) {
    const row = appState.introEdit.events[Number(e.target.dataset.intakeRow)];
    if (row) detailEdits.draft(row, { [e.target.dataset.intakeField]: e.target.value });
    return true;
  }
  if (e.target.id !== 'introText') return false;
  detailEdits.draft(appState.introEdit, { text: e.target.value });
  const c = box.querySelector('.intro-count');
  if (c) { const n = [...appState.introEdit.text].length; c.textContent = `${n} / ${INTRO_MAX} 字`; c.classList.toggle('over', n > INTRO_MAX); }
  return true;
}

export { INTRO_MAX, introOverrides, intakeEventsOf, intakeDraft, intakePresentation, intakeListHtml, intakeEditorHtml, introOf, introSectionHtml, introBarHtml, openIntroEdit, saveIntro, closeIntroEdit, introRowClick, introInput };
