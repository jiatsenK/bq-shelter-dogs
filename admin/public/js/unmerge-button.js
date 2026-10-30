// 取消合併按鈕（K 2026-10-26）：修改紀錄頁與資料頁「系統自動判斷」（#775）共用。按兩次才送；
// 伺服器照這筆的快照拆回來，已取消過或之後又合併過會說明原因。onDone：拆回來之後重讀
import { readDog, unmergeDog } from './api.js';
import { element } from './dom.js';

export function unmergeButton(e, onDone) {
  const wrap = element('div', undefined, 'unmerge-actions');
  const button = element('button', '取消合併', 'btn btn-outline-danger');
  button.type = 'button';
  const note = element('span');
  note.setAttribute('role', 'status');
  let armed = false;
  const disarm = () => { armed = false; button.textContent = '取消合併'; button.className = 'btn btn-outline-danger'; };
  button.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      button.textContent = `確定取消：拆回「${e.before?.name || '未命名'}」`;
      button.className = 'btn btn-danger';
      return;
    }
    button.disabled = true;
    note.textContent = '正在取消合併…';
    const dog = await readDog(e.dogId);
    const result = dog.ok ? await unmergeDog(e.dogId, { logId: e.id, revision: dog.data.revision }) : dog;
    button.disabled = false;
    if (!result.ok) {
      disarm();
      note.textContent = result.data?.error || '未能取消合併，資料沒有改；請重新讀取再試';
      return;
    }
    note.textContent = '已取消合併。';
    onDone();
  });
  wrap.append(button, note);
  return wrap;
}
