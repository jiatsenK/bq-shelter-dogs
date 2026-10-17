// 手機鍵盤（#389）：鍵盤彈出時，固定面板跟著「看得到的範圍」走，輸入框只在自己的面板裡捲，不捲整頁。
// 詳細狗卡另有 detail-viewport.js；這裡管全站：標記 html.kb-open、提供 --vv-top／--vv-height。
(function () {
  const viewport = window.visualViewport;
  if (!viewport || !document.documentElement) return;
  const root = document.documentElement;
  const textFields = 'textarea, input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]):not([type="button"])';
  // 面板自己會捲的容器：一起溜的人、開卡名字、第一次使用
  const panels = '.with-sheet, .onboard';
  let frame = 0;
  function sync() {
    frame = 0;
    // 放大閱讀時交給瀏覽器平移
    if (viewport.scale > 1.05) return;
    const open = window.innerHeight - viewport.height > 120;
    root.classList.toggle('kb-open', open);
    root.style.setProperty('--vv-top', `${viewport.offsetTop}px`);
    root.style.setProperty('--vv-height', `${viewport.height}px`);
    if (open) reveal(document.activeElement);
  }
  function reveal(field) {
    if (!field || !field.matches || !field.matches(textFields)) return;
    const panel = field.closest(panels);
    if (!panel) return;
    const box = panel.getBoundingClientRect();
    const top = Math.max(box.top, viewport.offsetTop) + 12;
    const bottom = Math.min(box.bottom, viewport.offsetTop + viewport.height) - 12;
    const rect = field.getBoundingClientRect();
    if (rect.top < top) panel.scrollTop += rect.top - top;
    else if (rect.bottom > bottom) panel.scrollTop += rect.bottom - bottom;
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(sync);
  }
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  sync();
})();
