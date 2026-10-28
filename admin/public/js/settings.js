import { readSettings, saveSettings } from './settings-api.js';
const groups = [
 ['功能顯示', '關閉後隱藏志工入口，舊連結顯示未開放。', [['showActivities','活動紀錄'],['showQuality','資料檢查'],['showUpdates','更新紀錄（資料編輯）']]],
 ['志工可編輯', '關閉後拒絕新的志工修改，已接受的操作繼續完成。', [['editIntro','介紹'],['editPhoto','照片'],['editRest','休養'],['editActivity','活動'],['editFixedCare','固定照顧'],['editStays','出入所紀錄']]],
];
const form = document.getElementById('settings-form'), status = document.getElementById('settings-status');
const save = document.getElementById('save-settings'), reload = document.getElementById('reload-settings');
let snapshot = null, busy = false, conflict = false;
for (const [title, help, entries] of groups) {
 const field = document.createElement('fieldset'); field.className = 'settings-group';
 const legend = document.createElement('legend'); legend.textContent = title;
 const hint = document.createElement('p'); hint.textContent = help; field.append(legend, hint);
 for (const [key, label] of entries) {
  const row = document.createElement('label'); row.className = 'form-check form-switch settings-row';
  const input = document.createElement('input'); input.type = 'checkbox'; input.name = key; input.className = 'form-check-input'; input.disabled = true;
  const text = document.createElement('span'); text.textContent = label; text.className = 'form-check-label'; row.append(input, text); field.append(row);
 }
 form.insertBefore(field, save);
}
const inputs = () => [...form.querySelectorAll('input')];
const draft = () => Object.fromEntries(inputs().map(input => [input.name, input.checked]));
function controls() {
 inputs().forEach(input => input.disabled = busy || !snapshot);
 reload.disabled = busy;
 save.disabled = busy || !snapshot || conflict || inputs().every(input => input.checked === snapshot.values[input.name]);
}
async function load() {
 busy = true; controls(); status.textContent = '正在讀取功能設定…';
 const result = await readSettings();
 const data = result.data;
 if (result.ok && Number.isSafeInteger(data?.revision) && inputs().every(input => typeof data.values?.[input.name] === 'boolean')) {
  snapshot = data; conflict = false;
  inputs().forEach(input => input.checked = data.values[input.name]);
  status.textContent = `已讀取版本 ${data.revision}。調整後按儲存。`;
 } else { snapshot = null; status.textContent = data?.error || '設定讀取失敗，請重新讀取。'; }
 busy = false; controls();
}
form.addEventListener('change', controls);
form.addEventListener('submit', async event => {
 event.preventDefault(); if (save.disabled) return;
 busy = true; controls(); status.textContent = '正在儲存…';
 const result = await saveSettings({ revision: snapshot.revision, values: draft() });
 if (result.ok && result.data?.revision) { snapshot = result.data; status.textContent = `已儲存，版本 ${snapshot.revision}。志工下次更新資料後會看到變更。`; }
 else { conflict = result.status === 409; status.textContent = result.data?.error || '儲存失敗，草稿已保留，請重試。'; }
 busy = false; controls();
});
reload.addEventListener('click', load);
load();
