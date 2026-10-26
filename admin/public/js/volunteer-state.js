// #567 各管理頁顯示志工網站目前的開關狀態；管理者本身不受開關限制。讀不到只提示，不擋管理功能。
// #624 改成頁首右側的小標記，連到志工網站設定，和頁面說明（.source-note）分開。
import { readSettings } from './settings-api.js';

export async function showVolunteerState(node, entries) {
  node.textContent = '志工網站開關讀取中…';
  node.title = '管理者不受這些開關限制；點這裡到志工網站設定調整。';
  delete node.dataset.state;
  const result = await readSettings();
  const values = result.ok && result.data?.values;
  if (!values || entries.some(([key]) => typeof values[key] !== 'boolean')) {
    node.textContent = '志工網站開關讀不到';
    node.dataset.state = 'unknown';
    return;
  }
  node.textContent = `志工網站：${entries.map(([key, on, off]) => (values[key] ? on : off)).join('・')}`;
  node.dataset.state = entries.every(([key]) => values[key]) ? 'on' : 'off';
}
