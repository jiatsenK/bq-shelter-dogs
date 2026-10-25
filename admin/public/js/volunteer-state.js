// #567 各管理頁顯示志工網站目前的開關狀態；管理者本身不受開關限制。讀不到只提示，不擋管理功能。
import { readSettings } from './settings-api.js';

export async function showVolunteerState(node, entries) {
  node.textContent = '正在讀取志工網站開關…';
  const result = await readSettings();
  const values = result.ok && result.data?.values;
  if (!values || entries.some(([key]) => typeof values[key] !== 'boolean')) {
    node.textContent = '志工網站開關暫時讀不到；管理功能照常可用。';
    return;
  }
  node.textContent = `志工網站目前：${entries.map(([key, on, off]) => (values[key] ? on : off)).join('、')}。管理者不受這些開關限制，可在「功能管理」調整。`;
}
