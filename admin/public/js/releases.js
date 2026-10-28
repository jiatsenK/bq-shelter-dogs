import { readReleases } from './api.js';
import { toReleaseEntries } from './release-notes.js';
import { showVolunteerState } from './volunteer-state.js';
import { byId, element } from './dom.js';

// #624 網站更新頁（從原更新紀錄頁拆出），唯讀。改讀 GitHub Releases：發版就有，不用重新部署管理網站。
// 志工網站的「網站更新」仍讀人工寫的 public/website-updates.json（docs/website-updates.md）。
async function loadReleases() {
  const status = byId('release-status'), list = byId('releases');
  const result = await readReleases();
  const entries = result.ok ? toReleaseEntries(result.data) : null;
  if (!entries) {
    status.dataset.error = 'true';
    status.textContent = result.status === 403 || result.status === 429 ? 'GitHub 暫時限制讀取次數，請過一陣子再重新讀取。' : '網站更新讀取失敗，請重新讀取。';
    return;
  }
  status.removeAttribute('data-error');
  status.textContent = entries.length ? `共 ${entries.length} 版，新到舊。` : '還沒有發布過的版本。';
  list.replaceChildren(...entries.map(e => {
    const item = element('li'), link = element('a', e.version);
    Object.assign(link, { href: e.url, target: '_blank', rel: 'noopener noreferrer' });
    const time = element('time', ` · ${e.date}`);
    time.prepend(link);
    item.append(time);
    if (!e.sections.length) item.append(element('p', '這版沒有列出改動。'));
    for (const s of e.sections) {
      if (s.title) item.append(element('p', s.title, 'release-section'));
      const ul = element('ul');
      ul.append(...s.items.map(text => element('li', text)));
      item.append(ul);
    }
    return item;
  }));
}

byId('reload').addEventListener('click', async () => {
  byId('reload').disabled = true;
  await loadReleases();
  byId('reload').disabled = false;
});
showVolunteerState(byId('volunteer-state'), [['showUpdates', '更新紀錄顯示中', '更新紀錄已隱藏']]);
loadReleases();
