import { canEdit } from './feature-settings.js';
import { BQApi } from './api.js';
import { appState } from './page-state.js';
import { esc, icon } from './ui-kit.js';
import { BQWalkUI } from './walk-ui.js';
import { NEED_EDITOR, editorName, render } from './app.js';
import { detailEdits, renderDetail } from './detail.js';
import { staysSectionHtml, staysView } from './detail-stays.js';

// ── 入所介紹（K 2026-10-10）：志工可不可以改看功能管理的 editIntro（ADR 0020），記編輯紀錄（ADR 0004）；存 D1，不寫試算表 ──
const INTRO_MAX = 1000;
const introOverrides = {}; // 編號 → 剛存好的介紹：這台電腦不用重新讀就看到（#250 起存 D1，其他人重新整理就看得到）
function introOf(dog) {
  return dog.id && Object.prototype.hasOwnProperty.call(introOverrides, dog.id) ? introOverrides[dog.id] : dog.intro;
}
function introSectionHtml(dog, intro) {
  if (appState.staysEdit && appState.staysEdit.dog === dog) return staysSectionHtml(dog);
  const e = appState.introEdit && appState.introEdit.dog === dog ? appState.introEdit : null;
  if (!e) {
    // 一段兩部分（K 2026-10-26）：出入所紀錄一行一件事，下面是介紹；介紹只寫狗自己，原文照顯示（ADR 0022）
    const can = canEdit('editIntro') && !!(dog.id && appState.UPLOAD_URL) && !dog.departure;
    const stays = staysView(dog);
    if (!stays.list && !stays.button && !intro && !can) return '';
    return `<section class="detail-section" data-section="intro">
      ${stays.list || stays.button ? `<h3 class="intro-heading">${icon('card')}出入所紀錄${stays.button}</h3>${stays.list}` : ''}
      ${intro || can ? `<h3 class="intro-heading">${icon('card')}介紹${can ? `<button type="button" class="intro-heading-edit" id="introEdit" aria-label="${intro ? '改' : '補'}介紹">${icon('write')}</button>` : ''}</h3>` : ''}
      ${intro ? `<div class="content">${esc(intro)}</div>` : ''}
    </section>`;
  }
  const busy = e.phase === 'saving';
  const n = [...e.text].length;
  return `<section class="detail-section" data-section="intro">
    <form class="rest-form intro-form" id="introForm" autocomplete="on">
      <h3>${icon('card')}介紹</h3>
      <p class="rest-hint">存好後這台馬上看到，其他人幾分鐘後（下次更新資料）看到。只存在網站，不寫試算表。</p>
      <label>介紹<textarea id="introText" rows="7" maxlength="${INTRO_MAX}" placeholder="例：親人、喜歡散步，怕機車聲"${busy ? ' disabled' : ''}>${esc(e.text)}</textarea><small class="intro-count${n > INTRO_MAX ? ' over' : ''}">${n} / ${INTRO_MAX} 字</small></label>
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
  appState.introEdit = detailEdits.open(dog, { text: introOf(dog) || '' });
  renderDetail();
  const box = document.getElementById('introText');
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
  detailEdits.saving(e);
  let out = null, error = '';
  const r = await BQApi.saveIntro(e.dog.id, { editor, text, revision:e.revision });
  out = r.data;
  if (r.error === 'network') error = '沒有存進去，請確認網路後再試';
  else if (!r.ok || !out || !out.ok) error = (out && out.error) || `沒有存進去（${r.status}），請稍後再試`;
  if (appState.introEdit !== e) return;
  if (error) {
    detailEdits.fail(e, error);
    return;
  }
  if(out.revision)e.dog.editRevision=out.revision;
  introOverrides[e.dog.id] = typeof out.intro === 'string' ? out.intro : text;
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

function introInput(e, box) {
  if (!appState.introEdit) return false;
  if (e.target.id !== 'introText') return false;
  detailEdits.draft(appState.introEdit, { text: e.target.value });
  const c = box.querySelector('.intro-count');
  if (c) { const n = [...appState.introEdit.text].length; c.textContent = `${n} / ${INTRO_MAX} 字`; c.classList.toggle('over', n > INTRO_MAX); }
  return true;
}

export { INTRO_MAX, introOverrides, introOf, introSectionHtml, introBarHtml, openIntroEdit, saveIntro, closeIntroEdit, introInput };
