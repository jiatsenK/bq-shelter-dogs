// #775 系統自動判斷一筆（資料頁列表與編輯抽屜共用）：時間（台灣時間）和一句話；unmerge 給了就在自動合併那筆放取消合併
import { element } from './dom.js';
import { formatWhen } from './edit-log.js';
import { judgementText } from './judgements.js';
import { unmergeButton } from './unmerge-button.js';

export function judgeItem(e, { onUnmerged } = {}) {
  const item = element('li');
  const time = element('time', formatWhen(e.at));
  time.dateTime = e.at;
  item.append(time, element('div', judgementText(e), 'judge-text'));
  if (onUnmerged && e.kind === 'automerge' && e.dogId) item.append(unmergeButton(e, onUnmerged));
  return item;
}
