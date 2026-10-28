import { BQApi } from './api.js';
let current = null;
// 跟 worker/src/feature-settings.js 的 SETTING_KEYS 同一份清單，鍵數不同就整份拒收（scripts/feature-setting-keys.test.mjs 比對）
export const SETTING_KEYS = Object.freeze(['showActivities','showQuality','showUpdates','editIntro','editPhoto','editRest','editActivity','editFixedCare','editStays','showShare']);
export function acceptSettings(data) {
  current = data && Number.isSafeInteger(data.revision) && data.revision >= 1 && data.values && Object.keys(data.values).length === SETTING_KEYS.length && SETTING_KEYS.every(k => typeof data.values[k] === 'boolean') ? data : null;
}
export const canEdit = key => current?.values[key] === true;
export const canShow = page => {
  const key = { activities: 'showActivities', quality: 'showQuality', updates: 'showUpdates', share: 'showShare' }[page];
  return !key || current?.values[key] === true;
};
// ADR 0023：Worker 給的分享網址（正式網址不進 repo），跟設定一起在載入時拿好
export const shareUrl = () => typeof current?.shareUrl === 'string' && /^https?:\/\//.test(current.shareUrl) ? current.shareUrl : '';
export const settingsNotice = () => current ? '這項功能目前未開放' : '功能設定暫時無法確認，請按更新後再試';
export async function loadSettings() {
  const result = await BQApi.featureSettings();
  acceptSettings(result.ok ? result.data : null);
  if (typeof document !== 'undefined') for (const link of document.querySelectorAll('a[href^="edits.html"]')) link.hidden = !canShow('updates');
}
