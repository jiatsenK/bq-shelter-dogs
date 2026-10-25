import { BQApi } from './api.js';
let current = null;
const keys = ['showActivities','showQuality','showUpdates','editIntro','editPhoto','editRest','editActivity','editFixedCare','editStays','editFormer'];
export function acceptSettings(data) {
  current = data && Number.isSafeInteger(data.revision) && data.values && keys.every(k => typeof data.values[k] === 'boolean') ? data : null;
}
export const canEdit = key => current?.values[key] === true;
export const canShow = page => {
  const key = { activities: 'showActivities', quality: 'showQuality', updates: 'showUpdates' }[page];
  return !key || current?.values[key] === true;
};
export const settingsNotice = () => current ? '這項功能目前未開放' : '功能設定暫時無法確認，請按更新後再試';
export async function loadSettings() {
  const result = await BQApi.featureSettings();
  acceptSettings(result.ok ? result.data : null);
  if (typeof document !== 'undefined') for (const link of document.querySelectorAll('a[href^="edits.html"]')) link.hidden = !canShow('updates');
}
