import { canEdit } from './feature-settings.js';
import { BQApi } from './api.js';
import { BQDates } from './dates.js';
import { appState } from './page-state.js';
import { esc, isoDay, ymdText } from './ui-kit.js';
import { BQWalkUI } from './walk-ui.js';
import { NEED_EDITOR, editorName, render } from './app.js';
import { detailEdits, renderDetail } from './detail.js';

// 出入所紀錄（#333、#639，ADR 0011、0021）：一個編號一列，查不到編號的那次編號空著。編號下面列成一張表，取代原本的「舊編號」一行。
// 有編號那列的入所日就是編號前 8 碼；出所日、原因有離所紀錄就照它（不能改）。補舊編號＝新增一列填編號，刪掉那一列＝刪掉那個舊編號；
// 目前編號、有離所紀錄的編號不能刪。誰都能改（要先選名字，ADR 0004），離所的狗也可以改（ADR 0011）。
// 整張表一次存（Worker 的 /stays），連同打開時看到的表一起送，別人剛改過會被擋下來
const STAYS_MAX = 100;
const canStays = dog => canEdit('editStays') && !!(dog.id && appState.UPLOAD_URL);
// 這一列不能刪：主清單上的目前編號（離所的狗沒有目前編號）、有離所紀錄的編號
const kept = (dog, row) => !!row.number && (row.departed || (!dog.departure && row.number === dog.id));
// 只有編號、沒有其他紀錄時表上沒什麼好看，只留「補」的入口
const plain = rows => rows.every(r => r.number && !r.out && !r.reason) && rows.length <= 1;
const dayText = day => (day ? ymdText(BQDates.parseYmd(day)) : '—');

function staysTableHtml(dog) {
  const rows = BQDates.stayRows(dog);
  const can = canStays(dog);
  const button = can ? `<button type="button" class="former-add" id="staysEdit">${plain(rows) ? '＋補出入所紀錄' : '改出入所紀錄'}</button>` : '';
  if (plain(rows)) return button ? `<div class="reentry">${button}</div>` : '';
  return `<div class="reentry stays-table"><table>
    <caption>出入所紀錄${button}</caption>
    <thead><tr><th scope="col">編號</th><th scope="col">入所</th><th scope="col">出所</th><th scope="col">原因</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${r.number ? esc(r.number) : '查不到'}</td><td>${dayText(r.in)}</td><td>${r.out ? dayText(r.out) : r.number === dog.id && !dog.departure ? '在所' : '—'}</td><td>${esc(r.reason) || '—'}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function staysSectionHtml(dog) {
  const e = appState.staysEdit && appState.staysEdit.dog === dog ? appState.staysEdit : null;
  if (!e) return '';
  const busy = e.phase === 'saving';
  const today = isoDay(new Date());
  const off = busy ? ' disabled' : '';
  return `<section class="detail-section" data-section="intro">
    <form class="rest-form stays-form" id="staysForm" autocomplete="off">
      <h3>出入所紀錄</h3>
      <p class="rest-hint">每次在所一列，還在所就不填出所日。有編號的入所日就是編號前 8 碼；查不到編號的那次，編號留空、自己填入所日。補舊編號就新增一列填編號，刪掉那一列就刪掉那個舊編號。入所日從最早那一列算。</p>
      <div class="intake-rows">${e.rows.map((row, i) => {
        const locked = kept(dog, row);
        const left = row.departed ? ' readonly' : '';
        return `<fieldset class="intake-row"><legend>第 ${i + 1} 列${row.number ? `（編號 ${esc(row.number)}）` : ''}</legend>
        <label>編號（查不到留空）<input inputmode="numeric" maxlength="12" data-stay-row="${i}" data-stay-field="number" value="${esc(row.number)}" placeholder="例：2015081801"${locked ? ' readonly' : ''}${off}></label>
        <label>入所日<input type="date" max="${today}" data-stay-row="${i}" data-stay-field="in" value="${esc(row.number ? BQDates.idDay(row.number) : row.in)}"${row.number ? ' readonly' : ''}${off}></label>
        <label>出所日<input type="date" max="${today}" data-stay-row="${i}" data-stay-field="out" value="${esc(row.out)}"${left}${off}></label>
        <label>原因<input type="text" maxlength="40" data-stay-row="${i}" data-stay-field="reason" value="${esc(row.reason)}" placeholder="例：迷路、退養、整修移所"${left}${off}></label>
        ${row.departed ? '<small class="rest-hint">出所日、原因照離所紀錄。</small>' : ''}
        ${locked ? '' : `<button type="button" class="intake-remove" data-stay-remove="${i}"${off}>刪掉第 ${i + 1} 列</button>`}
      </fieldset>`;
      }).join('')}</div>
      <button type="button" id="staysAdd"${busy || e.rows.length >= STAYS_MAX ? ' disabled' : ''}>新增一列</button>
      ${e.error ? `<div class="photo-error" role="alert">${esc(e.error)}</div>` : ''}
      <div class="stays-actions">${busy ? '' : '<button type="button" class="former-cancel" id="staysCancel">取消</button>'}<button type="submit" class="former-save"${busy ? ' disabled' : ''}>${busy ? '儲存中…' : '儲存'}</button></div>
    </form>
  </section>`;
}
function openStaysEdit(dog) {
  if (!dog || !dog.id || !appState.UPLOAD_URL) return;
  const before = BQDates.stayRows(dog).map(r => ({ ...r }));
  const rows = before.length ? before.map(r => ({ ...r })) : [{ number: '', in: '', out: '', reason: '' }];
  appState.staysEdit = detailEdits.open(dog, { before, rows });
  renderDetail();
  const box = document.querySelector('#staysForm input:not([readonly])');
  if (box) {
    box.focus({ preventScroll: true }); // 捲到看得見交給 detail-viewport.js，只捲狗卡不捲整頁（#389）
  }
}
// 先在這台檢查一次（伺服器也會檢查）；回空字串是沒問題。known 是打開時就有的編號
function staysProblem(rows, known = []) {
  const today = isoDay(new Date());
  const seen = new Set();
  for (const r of rows) {
    if (r.number) {
      if (seen.has(r.number)) return `編號 ${r.number} 重複了`;
      seen.add(r.number);
      if (!known.includes(r.number) && (!/^\d{10}$/.test(r.number) || !BQDates.idDate(r.number))) return '編號要是 10 碼數字，前 8 碼是入所日期';
    } else if (!BQDates.parseYmd(r.in)) return '查不到編號的那次要填入所日';
    if (r.in > today || (r.out && r.out > today)) return '日期不能是未來的日子';
    if (r.out && r.in && r.out < r.in) return '出所日不能早於入所日';
  }
  return '';
}
async function saveStays() {
  const e = appState.staysEdit;
  if (!e || e.phase === 'saving') return;
  const editor = editorName();
  if (!editor) { detailEdits.fail(e, NEED_EDITOR); return; }
  // 整列都空白的當成沒填；有編號的入所日跟著編號
  const rows = e.rows.map(r => {
    const number = r.number.replace(/\s+/g, '');
    return { number, in: number ? BQDates.idDay(number) : r.in.trim(), out: r.out.trim(), reason: r.reason.trim() };
  }).filter(r => r.number || r.in || r.out || r.reason);
  const problem = staysProblem(rows, e.before.map(r => r.number).filter(Boolean));
  if (problem) { detailEdits.fail(e, problem); return; }
  detailEdits.saving(e);
  let out = null, error = '';
  const r = await BQApi.saveStays(e.dog.id, { editor, before: e.before, stays: rows, revision: e.revision });
  out = r.data;
  if (r.error === 'network') error = '沒有存進去，請確認網路後再試';
  else if (r.status === 409) error = (out && out.error) || '別人剛改過，請重新整理再改';
  else if (!r.ok || !out || !out.ok) error = (out && out.error) || `沒有存進去（${r.status}），請稍後再試`;
  if (appState.staysEdit !== e) return;
  if (error) { detailEdits.fail(e, error); return; }
  if (out.revision) e.dog.editRevision = out.revision;
  const saved = Array.isArray(out.stays) ? out.stays : rows;
  e.dog.stays = saved;
  // 舊編號跟著表走：天數、排序、搜尋馬上用新的
  e.dog.formerIds = saved.map(s => s.number).filter(n => n && n !== e.dog.id).sort();
  appState.staysEdit = null;
  render(); renderDetail();
  const b = document.getElementById('staysEdit');
  if (b) b.focus({ preventScroll: true });
  const first = BQDates.firstIntake(e.dog);
  BQWalkUI.showToast(`${e.dog.name} 的出入所紀錄已存好${first ? `，入所日從 ${ymdText(first)} 算` : ''}`);
}

function closeStaysEdit() {
  appState.staysEdit = null;
  renderDetail();
  const b = document.getElementById('staysEdit');
  if (b) b.focus({ preventScroll: true });
}

// 新增／刪掉一列：重畫後焦點落在新的那列或「新增一列」
function staysRowClick(e, box) {
  if (!appState.staysEdit || appState.staysEdit.phase === 'saving') return;
  if (e.target.closest('#staysAdd') && appState.staysEdit.rows.length < STAYS_MAX) {
    appState.staysEdit.rows.push({ number: '', in: '', out: '', reason: '' });
    renderDetail(); box.querySelector('.stays-form .intake-row:last-child input')?.focus({ preventScroll: true });
  }
  const remove = e.target.closest('[data-stay-remove]');
  if (remove) {
    appState.staysEdit.rows.splice(Number(remove.dataset.stayRemove), 1);
    renderDetail(); box.querySelector('#staysAdd')?.focus({ preventScroll: true });
  }
}

// 打字記在草稿；改編號時入所日跟著換（不重畫，焦點留在編號框）
function staysInput(e) {
  if (!appState.staysEdit || !e.target.dataset.stayField) return false;
  const i = e.target.dataset.stayRow, row = appState.staysEdit.rows[Number(i)];
  if (!row) return true;
  detailEdits.draft(row, { [e.target.dataset.stayField]: e.target.value });
  if (e.target.dataset.stayField === 'number') {
    const day = e.target.closest('form')?.querySelector(`[data-stay-row="${i}"][data-stay-field="in"]`);
    const number = e.target.value.replace(/\s+/g, '');
    if (day) { day.readOnly = !!number; if (number) day.value = BQDates.idDay(number); }
  }
  return true;
}

export { STAYS_MAX, staysTableHtml, staysSectionHtml, openStaysEdit, staysProblem, saveStays, closeStaysEdit, staysRowClick, staysInput };
