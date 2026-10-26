import { BQApi } from './api.js';
import { BQDates } from './dates.js';
import { appState } from './page-state.js';
import { esc, icon, isoDay, ymdText } from './ui-kit.js';
import { BQWalkUI } from './walk-ui.js';
import { NEED_EDITOR, editorName, render } from './app.js';
import { detailEdits, renderDetail } from './detail.js';

// 出入所紀錄（#333，ADR 0011）：照時間列出每一次在所；誰都能補、改、刪（要先選名字），離所的狗也可以改（ADR 0011）。
// 整隻狗一次存（Worker 的 /stays），連同打開時看到的內容一起送，別人剛改過會被擋下來
const STAYS_MAX = 30;
function staysSectionHtml(dog) {
  const e = appState.staysEdit && appState.staysEdit.dog === dog ? appState.staysEdit : null;
  if (!e) return '';
  const busy = e.phase === 'saving';
  const today = isoDay(new Date());
  return `<section class="detail-section" data-section="intro">
    <form class="rest-form stays-form" id="staysForm" autocomplete="off">
      <h3>${icon('card')}入所介紹</h3>
      <p class="rest-hint">每次在所一筆，還在所就不填出所日。入所日從現在的編號、舊編號和這裡最早的那天算。</p>
      <div class="intake-rows">${e.rows.map((row, i) => `<fieldset class="intake-row"><legend>第 ${i + 1} 筆</legend>
        <label>入所日<input type="date" max="${today}" data-stay-row="${i}" data-stay-field="in" value="${esc(row.in)}"${busy ? ' disabled' : ''}></label>
        <label>出所日<input type="date" max="${today}" data-stay-row="${i}" data-stay-field="out" value="${esc(row.out)}"${busy ? ' disabled' : ''}></label>
        <label>原因<input type="text" maxlength="40" data-stay-row="${i}" data-stay-field="reason" value="${esc(row.reason)}" placeholder="例：迷路、退養、整修移所"${busy ? ' disabled' : ''}></label>
        <button type="button" class="intake-remove" data-stay-remove="${i}"${busy ? ' disabled' : ''}>刪掉第 ${i + 1} 筆</button>
      </fieldset>`).join('')}</div>
      <button type="button" id="staysAdd"${busy || e.rows.length >= STAYS_MAX ? ' disabled' : ''}>新增一筆</button>
      ${e.error ? `<div class="photo-error" role="alert">${esc(e.error)}</div>` : ''}
      <div class="stays-actions">${busy ? '' : '<button type="button" class="former-cancel" id="staysCancel">取消</button>'}<button type="submit" class="former-save"${busy ? ' disabled' : ''}>${busy ? '儲存中…' : '儲存'}</button></div>
    </form>
  </section>`;
}
function openStaysEdit(dog) {
  if (!dog || !dog.id || !appState.UPLOAD_URL) return;
  const before = (dog.stays || []).map(r => ({ ...r }));
  appState.staysEdit = detailEdits.open(dog, { before, rows: before.length ? before.map(r => ({ ...r })) : [{ in: '', out: '', reason: '' }] });
  renderDetail();
  const box = document.querySelector('#staysForm [data-stay-field="in"]');
  if (box) {
    box.focus({ preventScroll: true }); // 捲到看得見交給 detail-viewport.js，只捲狗卡不捲整頁（#389）
  }
}
// 先在這台檢查一次（伺服器也會檢查）；回空字串是沒問題
function staysProblem(rows) {
  const today = isoDay(new Date());
  for (const r of rows) {
    if (!BQDates.parseYmd(r.in)) return '每一筆都要填入所日';
    if (r.in > today || (r.out && r.out > today)) return '日期不能是未來的日子';
    if (r.out && r.out < r.in) return '出所日不能早於入所日';
  }
  return '';
}
async function saveStays() {
  const e = appState.staysEdit;
  if (!e || e.phase === 'saving') return;
  const editor = editorName();
  if (!editor) { detailEdits.fail(e, NEED_EDITOR); return; }
  // 整列都空白的當成沒填
  const rows = e.rows.map(r => ({ in: r.in.trim(), out: r.out.trim(), reason: r.reason.trim() })).filter(r => r.in || r.out || r.reason);
  const problem = staysProblem(rows);
  if (problem) { detailEdits.fail(e, problem); return; }
  detailEdits.saving(e);
  let out = null, error = '';
  const r = await BQApi.saveStays(e.dog.id, { editor, before: e.before, stays: rows, revision:e.revision });
  out = r.data;
  if (r.error === 'network') error = '沒有存進去，請確認網路後再試';
  else if (r.status === 409) error = '別人剛改過，請重新整理再改';
  else if (!r.ok || !out || !out.ok) error = (out && out.error) || `沒有存進去（${r.status}），請稍後再試`;
  if (appState.staysEdit !== e) return;
  if (error) { detailEdits.fail(e, error); return; }
  if(out.revision)e.dog.editRevision=out.revision;
  e.dog.stays = Array.isArray(out.stays) ? out.stays : rows;
  appState.staysEdit = null;
  render(); renderDetail();
  const b = document.getElementById('staysEdit') || document.getElementById('introEdit');
  if (b) b.focus({ preventScroll: true });
  const first = BQDates.firstIntake(e.dog);
  BQWalkUI.showToast(`${e.dog.name} 的出入所紀錄已存好${first ? `，入所日從 ${ymdText(first)} 算` : ''}`);
}

function closeStaysEdit() {
  appState.staysEdit = null;
  renderDetail();
  const b = document.getElementById('staysEdit') || document.getElementById('introEdit');
  if (b) b.focus({ preventScroll: true });
}

// 新增／刪掉一筆：重畫後焦點落在新的那筆或「新增一筆」
function staysRowClick(e, box) {
  if (!appState.staysEdit || appState.staysEdit.phase === 'saving') return;
  if (e.target.closest('#staysAdd') && appState.staysEdit.rows.length < STAYS_MAX) {
    appState.staysEdit.rows.push({ in: '', out: '', reason: '' });
    renderDetail(); box.querySelector('.stays-form .intake-row:last-child input')?.focus({ preventScroll: true });
  }
  const remove = e.target.closest('[data-stay-remove]');
  if (remove) {
    appState.staysEdit.rows.splice(Number(remove.dataset.stayRemove), 1);
    renderDetail(); box.querySelector('#staysAdd')?.focus({ preventScroll: true });
  }
}

function staysInput(e) {
  if (!appState.staysEdit || !e.target.dataset.stayField) return false;
  const row = appState.staysEdit.rows[Number(e.target.dataset.stayRow)];
  if (row) detailEdits.draft(row, { [e.target.dataset.stayField]: e.target.value });
  return true;
}

export { STAYS_MAX, staysSectionHtml, openStaysEdit, staysProblem, saveStays, closeStaysEdit, staysRowClick, staysInput };
