import { readWebsiteUpdates } from './api.js';
import { showVolunteerState } from './volunteer-state.js';
import { byId, element } from './dom.js';

// #624 網站更新頁（從原更新紀錄頁拆出）：讀志工網站同一份版本紀錄檔，唯讀。
async function loadReleases() {
  const status = byId('release-status'), list = byId('releases');
  const result = await readWebsiteUpdates();
  const entries = result.ok && Array.isArray(result.data) && result.data.every(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.text === 'string') ? result.data : null;
  if (!entries) { status.dataset.error = 'true'; status.textContent = '網站更新讀取失敗，請重新讀取。'; return; }
  status.removeAttribute('data-error');
  status.textContent = entries.length ? `共 ${entries.length} 則，新到舊。` : '還沒有網站更新紀錄。';
  list.replaceChildren(...entries.map(e => {
    const item = element('li');
    item.append(element('time', e.version ? `${e.version} · ${e.date}` : e.date), element('p', e.text));
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
