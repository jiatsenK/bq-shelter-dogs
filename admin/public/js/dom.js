// #567 管理頁共用的小 DOM 工具（main.js 是更早寫的，保留原樣）。
export const byId = id => document.getElementById(id);
export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
