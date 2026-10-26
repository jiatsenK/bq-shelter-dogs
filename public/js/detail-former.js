import { canEdit } from './feature-settings.js';
import { BQApi } from './api.js';
import { BQDates } from './dates.js';
import { appState } from './page-state.js';
import { esc, ymdText } from './ui-kit.js';
import { BQWalkUI } from './walk-ui.js';
import { NEED_EDITOR, editorName, render } from './app.js';
import { detailEdits, renderDetail } from './detail.js';

// 舊編號（#75、#289）：編號下面一行「舊編號 …・最早入所 YYYY/M/D」，每個舊編號旁邊一個 ✕ 可以刪；
// 換新編號就是再入所（GLOSSARY），但畫面不標第幾次入所（K 2026-10-16）。
// 最後一個「補舊編號」，點了原地變輸入框。誰都能補、都能刪（ADR 0005），要先選好名字（ADR 0004），離所的狗只看不改
function reentryLine(dog) {
  const former = dog.formerIds || [];
  const can = canEdit('editFormer') && !!(dog.id && appState.UPLOAD_URL) && !dog.departure;
  const first = BQDates.firstIntake(dog);
  const list = former.map(f => `<span class="former-num">${esc(f)}${can ? `<button type="button" class="former-del" data-former-del="${esc(f)}" aria-label="刪掉舊編號 ${esc(f)}">✕</button>` : ''}</span>`).join('');
  const e = appState.formerEdit && appState.formerEdit.dog === dog ? appState.formerEdit : null;
  if (e) {
    const busy = e.phase === 'saving';
    return `<div class="reentry">${former.length ? `<span>舊編號</span>${list}` : ''}
      <form class="former-form" id="formerForm" autocomplete="off">
        <label for="formerText">補舊編號</label>
        <input id="formerText" inputmode="numeric" maxlength="12" placeholder="例：2015081801" value="${esc(e.text)}"${busy ? ' disabled' : ''}>
        <button type="submit" class="former-save"${busy ? ' disabled' : ''}>${busy ? '儲存中…' : '儲存'}</button>
        ${busy ? '' : '<button type="button" class="former-cancel" id="formerCancel">取消</button>'}
        <small class="former-hint">轉所、退回或換號前的編號，前 8 碼是入所日期。誰都能補，補錯了按 ✕ 刪掉。</small>
        ${e.error ? `<div class="photo-error" role="alert">${esc(e.error)}</div>` : ''}
      </form></div>`;
  }
  if (!former.length && !can) return '';
  return `<div class="reentry">${former.length ? `<span>舊編號</span>${list}${first ? `<span>・最早入所 ${ymdText(first)}</span>` : ''}` : ''}${can ? `<button type="button" class="former-add" id="formerAdd">＋補舊編號</button>` : ''}</div>`;
}

function openFormerEdit(dog) {
  if (!dog || !dog.id || !appState.UPLOAD_URL) return;
  appState.formerEdit = detailEdits.open(dog, { text: '' });
  renderDetail();
  const box = document.getElementById('formerText');
  if (box) box.focus({ preventScroll: true });
}

// 補或刪舊編號（method 由呼叫的人給）；回空字串是成功，不然是要給人看的原因
async function sendFormer(dog, former, method) {
  const r = await BQApi.saveFormer(dog.id, method, { editor: editorName(), former, revision:appState.formerEdit?.dog===dog?appState.formerEdit.revision:dog.editRevision });
  if (r.error === 'network') return '沒有存進去，請確認網路後再試';
  const out = r.data;
  if (!r.ok || !out || !out.ok) return (out && out.error) || `沒有存進去（${r.status}），請稍後再試`;
  if(out.revision)dog.editRevision=out.revision;
  return '';
}

// 存好就改這台的狗資料，天數、排序馬上重算
async function saveFormer() {
  const e = appState.formerEdit;
  if (!e || e.phase === 'saving') return;
  const former = e.text.replace(/\s+/g, '');
  if (!/^\d{10}$/.test(former) || !BQDates.idDate(former)) { detailEdits.fail(e, '舊編號要是 10 碼數字，前 8 碼是入所日期'); return; }
  if (!editorName()) { detailEdits.fail(e, NEED_EDITOR); return; }
  detailEdits.saving(e);
  const error = await sendFormer(e.dog, former, 'POST');
  if (appState.formerEdit !== e) return;
  if (error) {
    detailEdits.fail(e, error);
    const b = document.getElementById('formerText');
    if (b) b.focus({ preventScroll: true });
    return;
  }
  e.dog.formerIds = [...(e.dog.formerIds || []), former].sort();
  appState.formerEdit = null;
  render(); renderDetail();
  BQWalkUI.showToast(`${e.dog.name} 補上舊編號 ${former}，入所日改從 ${ymdText(BQDates.firstIntake(e.dog))} 算`);
}

async function removeFormer(dog, former) {
  if (!editorName()) { BQWalkUI.showToast(NEED_EDITOR); return; }
  if (!confirm(`刪掉 ${dog.name} 的舊編號 ${former}？`)) return;
  const error = await sendFormer(dog, former, 'DELETE');
  if (error) { BQWalkUI.showToast(error); return; }
  dog.formerIds = (dog.formerIds || []).filter(f => f !== former);
  render(); if (appState.detailDog === dog) renderDetail();
  BQWalkUI.showToast(`已刪掉 ${dog.name} 的舊編號 ${former}`);
}
function closeFormerEdit() {
  appState.formerEdit = null;
  renderDetail();
  const b = document.getElementById('formerAdd');
  if (b) b.focus({ preventScroll: true });
}

function formerInput(e) {
  if (!appState.formerEdit || e.target.id !== 'formerText') return false;
  detailEdits.draft(appState.formerEdit, { text: e.target.value });
  return true;
}

export { reentryLine, openFormerEdit, sendFormer, saveFormer, removeFormer, closeFormerEdit, formerInput };
