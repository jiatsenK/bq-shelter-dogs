import { BQApi } from './api.js';
import { BQDates } from './dates.js';
import { appState } from './page-state.js';
import { esc, icon } from './ui-kit.js';
import { BQWalkUI } from './walk-ui.js';
import { loadWalkerName, render } from './app.js';
import { renderDetail } from './detail.js';

// ── 加備註、新增異動紀錄（#239、#281）：只追加，寫進試算表前先預覽；日期用台灣時間、名字用「我是誰」 ──
// 狗卡在「試算表備註」下面，異動紀錄只在電腦版右欄（K 2026-10-16）
const APPEND_MAX = 200;
appState.sheetAppend = null; // { kind: 'note'|'log', dog, text, phase: 'edit'|'preview'|'busy', error }
function appendEntry(text, who) { return `${BQDates.taipeiStamp()}${text.trim()}（${who}）`; }
function nextLogLabel() {
  const nums = (typeof appState.sheetNotes !== 'undefined' ? appState.sheetNotes : []).map(n => Number((String(n.label).match(/^備註\s*(\d+)/) || [])[1]) || 0);
  return `備註${Math.max(0, ...nums) + 1}`;
}
function appendPreview(a, who) {
  const entry = appendEntry(a.text, who);
  if (a.kind === 'log') return `<div class="append-preview"><span class="append-label">${esc(nextLogLabel())}</span>${esc(entry)}</div>`;
  const now = a.dog.note || '';
  return `<div class="append-preview note-text">${now.trim() ? `${esc(now)};` : ''}<mark>${esc(entry)}</mark></div>`;
}
function sheetAppendHtml(kind, dog = null) {
  if (!appState.UPLOAD_URL || appState.sheetWriteState === 'off' || (dog && dog.departure)) return '';
  const a = appState.sheetAppend && appState.sheetAppend.kind === kind && appState.sheetAppend.dog === dog ? appState.sheetAppend : null;
  const label = kind === 'note' ? '加備註' : '新增一筆';
  if (!a) return `<button type="button" class="my-note-edit append-open" data-append-open="${kind}">${icon('note')}${label}</button>`;
  const who = loadWalkerName();
  const busy = a.phase === 'busy';
  const err = a.error ? `<p class="append-error" role="alert">${esc(a.error)}</p>` : '';
  if (!who) return `<div class="my-note-form append-form"><p class="append-hint">要先在「我溜過」設定名字，才能寫進試算表。</p>
    <div class="my-note-actions"><button type="button" class="photo-cancel" data-append-cancel>取消</button></div></div>`;
  if (a.phase === 'edit') return `<form class="my-note-form append-form" data-append-form>
    <label class="my-note-pass-label" for="appendText">${kind === 'note' ? '要接在備註後面的內容' : '要加在異動紀錄最下面的內容'}</label>
    <input type="text" id="appendText" maxlength="${APPEND_MAX}" value="${esc(a.text)}" autocomplete="off">
    <p class="append-hint">日期和名字（${esc(who)}）會自動加上；已經寫在試算表的字不會被改。</p>${err}
    <div class="my-note-actions"><button type="submit" class="my-note-save"${a.text.trim() ? '' : ' disabled'}>預覽</button>
      <button type="button" class="photo-cancel" data-append-cancel>取消</button></div></form>`;
  return `<div class="my-note-form append-form">
    <p class="my-note-pass-label">${kind === 'note' ? '送出後這格會變成：' : '送出後會在最下面新增：'}</p>
    ${appendPreview(a, who)}${err}
    <div class="my-note-actions"><button type="button" class="my-note-save" data-append-send${busy ? ' disabled' : ''}>${busy ? '寫入中…' : '送出'}</button>
      ${busy ? '' : '<button type="button" class="photo-cancel" data-append-back>改一下</button>'}</div></div>`;
}
function rerenderAppend(kind, focusSel) {
  if (kind === 'note') renderDetail(); else render();
  const el = focusSel && document.querySelector(focusSel);
  if (el) el.focus({ preventScroll: true });
}
async function sendAppend() {
  const a = appState.sheetAppend;
  const who = loadWalkerName();
  if (!a || a.phase !== 'preview' || !who) return;
  a.phase = 'busy'; a.error = '';
  rerenderAppend(a.kind);
  const payload = { action: a.kind, walker: who, editor: who, text: a.text.trim(), dogs: a.kind === 'note' ? [{ id: a.dog.id || '', name: a.dog.name }] : [] };
  const res = await BQApi.walk(payload);
  const out = res.data;
  if (appState.sheetAppend !== a) return;
  const r = out && out.ok && Array.isArray(out.results) ? out.results[0] : null;
  if (!r || r.status !== 'written') {
    a.phase = 'preview';
    a.error = res.error === 'network' ? '網路不通，沒寫進試算表，請稍後再試' : r && r.status === 'notFound' ? '試算表找不到這隻狗，沒寫進去' : `沒寫進試算表：${(out && out.error) || `HTTP ${res.status}`}`;
    rerenderAppend(a.kind);
    return;
  }
  appState.sheetAppend = null;
  if (a.kind === 'note') a.dog.note = r.wrote.note;
  else if (typeof appState.sheetNotes !== 'undefined') appState.sheetNotes.push({ label: r.wrote.label, text: r.wrote.text });
  rerenderAppend(a.kind);
  BQWalkUI.showToast(a.kind === 'note' ? `已加進 ${a.dog.name} 的試算表備註` : '已加進異動紀錄');
}

// 打開、取消、改一下、送出都在整頁委派：狗卡（note）和電腦版右欄（log）共用
function bindSheetAppend() {
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const open = t.closest('[data-append-open]');
    if (open) {
      const kind = open.dataset.appendOpen;
      appState.sheetAppend = { kind, dog: kind === 'note' ? appState.detailDog : null, text: '', phase: 'edit', error: '' };
      rerenderAppend(kind, '#appendText');
      return;
    }
    if (!appState.sheetAppend) return;
    const kind = appState.sheetAppend.kind;
    if (t.closest('[data-append-cancel]')) { appState.sheetAppend = null; rerenderAppend(kind, `[data-append-open="${kind}"]`); return; }
    if (t.closest('[data-append-back]')) { appState.sheetAppend.phase = 'edit'; appState.sheetAppend.error = ''; rerenderAppend(kind, '#appendText'); return; }
    if (t.closest('[data-append-send]')) sendAppend();
  });
  document.addEventListener('input', e => {
    if (!appState.sheetAppend || !e.target || e.target.id !== 'appendText') return;
    appState.sheetAppend.text = e.target.value;
    const btn = e.target.form && e.target.form.querySelector('.my-note-save');
    if (btn) btn.disabled = !e.target.value.trim();
  });
  document.addEventListener('submit', e => {
    if (!appState.sheetAppend || !e.target.matches || !e.target.matches('[data-append-form]')) return;
    e.preventDefault();
    if (!appState.sheetAppend.text.trim()) return;
    appState.sheetAppend.phase = 'preview'; appState.sheetAppend.error = '';
    rerenderAppend(appState.sheetAppend.kind, '[data-append-send]');
  });
}

export { APPEND_MAX, appendEntry, nextLogLabel, appendPreview, sheetAppendHtml, rerenderAppend, sendAppend, bindSheetAppend };
