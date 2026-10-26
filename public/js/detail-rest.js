import { canEdit } from './feature-settings.js';
import { BQApi } from './api.js';
import { BQDates } from './dates.js';
import { appState } from './page-state.js';
import { esc, icon, isoDay, monthDay } from './ui-kit.js';
import { BQWalkUI } from './walk-ui.js';
import { NEED_EDITOR, editorName, render, restOf } from './app.js';
import { detailEdits, renderDetail } from './detail.js';

// ── 休養中（K 2026-10-09：剛動完手術不能溜，「排到下面、休養中、10/20 前暫停帶出」，不動試算表）──
// 名字下面一行說明；改設定在詳細資訊最下面，志工可不可以改看功能管理的 editRest（ADR 0020），改了記編輯紀錄
function restNoteHtml(dog, today) {
  const r = restOf(dog, today);
  return r ? `<div class="rest-note"><b>休養中</b>，${monthDay(r.until)} 前暫停帶出${r.reason ? `（${esc(r.reason)}）` : ''}</div>` : '';
}
function restAdminHtml(dog, today) {
  if (!canEdit('editRest')) return '';
  if (!dog.id || !appState.UPLOAD_URL) return '';
  const r = restOf(dog, today);
  const e = appState.restEdit && appState.restEdit.dog === dog ? appState.restEdit : null;
  if (!e) {
    // 管理用（K 2026-10-10）：只剩設定休養中；入所介紹直接點那一段就能改。正在改介紹時先收起來
    if (appState.introEdit && appState.introEdit.dog === dog) return '';
    return `<section class="detail-section rest-admin" data-section="rest">
      <h3>${icon('write')}休養設定<span class="sub">會記在編輯紀錄</span></h3>
      <div class="admin-btns">
        <button type="button" class="admin-btn" id="restEdit">${icon('paw')}${r ? '改休養設定' : '設定休養中'}</button>
      </div>
    </section>`;
  }
  const busy = e.phase === 'saving';
  return `<section class="detail-section rest-admin" data-section="rest">
    <form class="rest-form" id="restForm" autocomplete="on">
      <h3>休養中</h3>
      <p class="rest-hint">排到溜狗表最下面、不能按溜了；過了那天自動恢復。</p>
      <label>原因<input type="text" id="restReason" maxlength="40" value="${esc(e.reason)}" placeholder="例：術後休養"${busy ? ' disabled' : ''}></label>
      <label>到哪一天（含那天）<input type="date" id="restUntil" value="${esc(e.until)}" min="${isoDay(today)}" required${busy ? ' disabled' : ''}></label>
      ${e.error ? `<div class="photo-error" role="alert">${esc(e.error)}</div>` : ''}
      <div class="rest-actions">
        <button type="submit" class="rest-save"${busy ? ' disabled' : ''}>${busy ? '儲存中…' : '儲存'}</button>
        ${r && !busy ? `<button type="button" class="rest-end" id="restEnd">結束休養</button>` : ''}
        ${busy ? '' : `<button type="button" class="rest-cancel" id="restCancel">取消</button>`}
      </div>
    </form>
  </section>`;
}
function openRestEdit(dog) {
  const r = restOf(dog);
  const until = r ? r.until : new Date(Date.now() + 10 * 86400000);
  appState.restEdit = detailEdits.open(dog, { until: isoDay(until), reason: r ? r.reason : '術後休養' });
  renderDetail();
  const first = document.getElementById('restReason');
  if (first) {
    first.focus({ preventScroll: true }); // 同上（#389）
  }
}
// 送到 Worker：end＝結束休養。成功後這支手機馬上生效，其他志工重新整理就看得到（#250 存 D1）
async function saveRest(end = false) {
  const e = appState.restEdit;
  if (!e || e.phase === 'saving') return;
  const editor = editorName();
  if (!editor) { detailEdits.fail(e, NEED_EDITOR); return; }
  if (!end && !BQDates.parseYmd(e.until)) { detailEdits.fail(e, '請選到哪一天'); return; }
  detailEdits.saving(e);
  let out = null, error = '';
  const r = await BQApi.saveRest(e.dog.id, end ? { editor, end: true, revision:e.revision } : { editor, until: e.until, reason: e.reason.trim(), revision:e.revision });
  out = r.data;
  if (r.error === 'network') error = '沒有存進去，請確認網路後再試';
  else if (!r.ok || !out || !out.ok) error = (out && out.error) || `沒有存進去（${r.status}），請稍後再試`;
  if (appState.restEdit !== e) return;
  if (error) {
    detailEdits.fail(e, error);
    return;
  }
  // 換成新的物件：讀取中的 loadRest 才知道這裡改過（見 loadRest）
  if(out.revision)e.dog.editRevision=out.revision;
  const next = { ...appState.restMap };
  if (out.rest) next[e.dog.id] = out.rest; else delete next[e.dog.id];
  appState.restMap = next;
  appState.restEdit = null;
  render(); renderDetail();
  BQWalkUI.showToast(out.rest ? `${e.dog.name} 休養到 ${monthDay(BQDates.parseYmd(out.rest.until))}，排到溜狗表最下面` : `${e.dog.name} 結束休養`);
}
function closeRestEdit() {
  appState.restEdit = null;
  renderDetail();
  const b = document.getElementById('restEdit');
  if (b) b.focus({ preventScroll: true });
}

// 休養設定表單：打的字記在 restEdit，重畫不會不見；送出走 saveRest
function restInput(e) {
  if (!appState.restEdit) return false;
  if (e.target.id === 'restReason') detailEdits.draft(appState.restEdit, { reason: e.target.value });
  else if (e.target.id === 'restUntil') detailEdits.draft(appState.restEdit, { until: e.target.value });
  return true;
}

export { restNoteHtml, restAdminHtml, openRestEdit, saveRest, closeRestEdit, restInput };
