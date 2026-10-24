

// 詳細狗卡編輯：依可見視窗定位欄位，不改資料或表單內容。
function createDetailEditorViewport(backdrop, detail) {
  const fields = 'textarea, select, input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"])';
  let listening = false, frame = 0, lastField = null;
  const viewport = window.visualViewport;
  const hasEditor = () => !backdrop.hidden && !!detail.querySelector(fields);
  const editing = () => hasEditor() && window.innerWidth < 600;
  const activeField = () => detail.contains(document.activeElement) && document.activeElement.matches(fields) ? document.activeElement : null;
  function describe(field) {
    return { id: field.id, row: field.dataset.intakeRow, key: field.dataset.intakeField,
      start: field.selectionStart, end: field.selectionEnd };
  }
  function find(state) {
    return state && [...detail.querySelectorAll(fields)].find(el => state.id ? el.id === state.id : el.dataset.intakeRow === state.row && el.dataset.intakeField === state.key);
  }
  function reveal() {
    frame = 0;
    if (!editing()) return;
    const field = activeField();
    if (!field) return;
    const box = detail.getBoundingClientRect();
    const bar = detail.querySelector('.detail-bar')?.getBoundingClientRect();
    const top = Math.max(box.top, viewport?.offsetTop || 0) + 12;
    const bottom = Math.min(box.bottom, (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight), bar ? bar.top : Infinity) - 12;
    backdrop.style.setProperty('--detail-edit-field-height', `${Math.max(44, bottom - top)}px`);
    const rect = field.getBoundingClientRect();
    if (field.tagName === 'TEXTAREA' && field.selectionEnd === field.value.length) field.scrollTop = field.scrollHeight;
    if (rect.height > bottom - top || rect.top < top) detail.scrollTop += rect.top - top;
    else if (rect.bottom > bottom) detail.scrollTop += rect.bottom - bottom;
  }
  function layout() {
    frame = 0;
    if (!hasEditor()) { reset(); return; }
    if (!editing()) { clearGeometry(); return; }
    // 放大閱讀時交給瀏覽器平移，避免持續拉回焦點。
    if (viewport && viewport.scale > 1.05) return;
    backdrop.style.setProperty('--detail-edit-height', `${viewport?.height || window.innerHeight}px`);
    backdrop.style.setProperty('--detail-edit-top', `${viewport?.offsetTop || 0}px`);
    backdrop.classList.add('detail-editing-viewport');
    frame = requestAnimationFrame(reveal);
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  }
  function rememberSelection() {
    const field = activeField();
    if (field) lastField = describe(field);
  }
  function focusChanged() {
    const field = activeField();
    if (field) { lastField = describe(field); schedule(); }
  }
  function sync() {
    if (!hasEditor()) { reset(); return; }
    if (!listening) {
      viewport?.addEventListener('resize', schedule);
      viewport?.addEventListener('scroll', schedule);
      window.addEventListener('resize', schedule);
      detail.addEventListener('focusin', focusChanged);
      detail.addEventListener('input', rememberSelection);
      detail.addEventListener('select', rememberSelection);
      listening = true;
    }
    schedule();
  }
  function clearGeometry() {
    backdrop.classList.remove('detail-editing-viewport');
    backdrop.style.removeProperty('--detail-edit-height');
    backdrop.style.removeProperty('--detail-edit-top');
    backdrop.style.removeProperty('--detail-edit-field-height');
  }
  function reset() {
    cancelAnimationFrame(frame); frame = 0;
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    detail.removeEventListener('focusin', focusChanged);
    detail.removeEventListener('input', rememberSelection);
    detail.removeEventListener('select', rememberSelection);
    listening = false; lastField = null;
    clearGeometry();
  }
  function capture() {
    const field = activeField();
    if (field) lastField = describe(field);
    return { field: lastField, wasActive: !!field };
  }
  function restore(saved) {
    sync();
    if (!saved?.field || (!saved.wasActive && !detail.querySelector('[role="alert"]'))) return;
    const field = find(saved.field);
    if (!field || field.disabled) return;
    field.focus({ preventScroll: true });
    if (typeof saved.field.start === 'number' && field.setSelectionRange) {
      try { field.setSelectionRange(saved.field.start, saved.field.end); } catch (_) { /* 日期等欄位不支援文字選取 */ }
    }
    lastField = saved.field;
    if (editing()) schedule();
  }
  return { sync, reset, capture, restore };
}

export { createDetailEditorViewport };
