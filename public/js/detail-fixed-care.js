// 詳細資訊的「有人固定照顧」開關（志工可不可以改看功能管理的 editFixedCare，ADR 0020）
import { canEdit } from './feature-settings.js';
import { BQApi } from './api.js';
import { appState } from './page-state.js';
import { esc } from './ui-kit.js';
import { BQWalkUI } from './walk-ui.js';
import { NEED_EDITOR, editorName, render } from './app.js';
import { renderDetail } from './detail.js';

const fixedCareEdits = new Map(); // 每隻狗各自的儲存狀態，關閉詳細資訊不會取消已送出的設定。
function fixedCareHtml(dog) {
  if (!canEdit('editFixedCare') || !(dog.id || dog.dogId) || dog.departure || !appState.UPLOAD_URL) return '';
  const state = fixedCareEdits.get(dog.id || dog.dogId);
  const busy = state?.busy;
  return `<section class="detail-section fixed-care" data-section="fixed-care">
    <div class="fixed-care-row">
      <span id="fixedCareLabel">有人固定照顧</span>
      <button type="button" id="fixedCareToggle" class="care-switch" role="switch" aria-labelledby="fixedCareLabel" aria-describedby="fixedCareHint" aria-checked="${dog.covered ? 'true' : 'false'}"${busy ? ' disabled aria-busy="true"' : ''}>
        <span class="care-switch-state" aria-hidden="true">${dog.covered ? '開啟' : '關閉'}</span><span class="care-switch-track" aria-hidden="true"></span>
      </button>
    </div>
    <p class="rest-hint" id="fixedCareHint">所有人共用。開啟後排在一般待溜狗之後、不計入天數統計，仍可溜。</p>
    ${busy ? '<p class="rest-hint" role="status">儲存中…</p>' : ''}
    ${state?.error ? `<p class="photo-error" role="alert">${esc(state.error)}</p>` : ''}
  </section>`;
}

async function toggleFixedCare(dog) {
  const key = dog?.id || dog?.dogId;
  if (!key || fixedCareEdits.get(key)?.busy) return;
  const editor = editorName();
  if (!editor) {
    fixedCareEdits.set(key, { error: NEED_EDITOR });
    renderDetail();
    return;
  }
  const enabled = !dog.covered;
  const state = { busy: true, error: '' };
  fixedCareEdits.set(key, state);
  renderDetail();
  try {
    const r = await BQApi.saveFixedCare(key, { editor, enabled, revision:dog.editRevision });
    if (r.error === 'network') throw new Error(r.message);
    const out = r.data;
    if (!r.ok || !out?.ok || out.enabled !== enabled) throw new Error(out?.error || '沒有存進去，請稍後再試');
    dog.covered = enabled;
    if(out.revision)dog.editRevision=out.revision;
    for (const current of appState.allDogs) if ((current.id || current.dogId) === key) current.covered = enabled;
    if (appState.detailDog && (appState.detailDog.id || appState.detailDog.dogId) === key) appState.detailDog.covered = enabled;
    BQWalkUI.showToast(`${dog.name} 的固定照顧已${enabled ? '開啟' : '關閉'}`);
    render();
  } catch (e) {
    state.error = e.message === 'Failed to fetch' ? '沒有存進去，請確認網路後再試' : e.message;
  } finally {
    state.busy = false;
    if (appState.detailDog && (appState.detailDog.id || appState.detailDog.dogId) === key) {
      renderDetail();
      document.getElementById('fixedCareToggle')?.focus({ preventScroll: true });
    }
  }
}


export { fixedCareEdits, fixedCareHtml, toggleFixedCare };
