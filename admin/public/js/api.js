import { settle } from '../shared/api-response.js';

const call = (path, method = 'GET', body) => settle(fetch(path, {
  method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}));
export const readDogs = () => call('/api/manage/dogs');
// #567 活動、資料檢查、資料編輯紀錄
export const readActivities = () => call('/api/manage/activities');
export const createActivity = body => call('/api/manage/activities', 'POST', body);
export const updateActivity = (id, body) => call(`/api/manage/activities/${id}`, 'PUT', body);
export const deleteActivity = (id, revision) => call(`/api/manage/activities/${id}`, 'DELETE', { revision });
export const readDataChecks = () => call('/api/manage/data-checks');
export const readCronStatus = () => call('/api/manage/cron-status');
// 取消合併狗：先讀留下那隻的版本再送（K 2026-10-26）
export const readDog = dogId => call(`/api/manage/dogs/${encodeURIComponent(dogId)}`);
export const unmergeDog = (dogId, body) => call(`/api/manage/dogs/${encodeURIComponent(dogId)}/unmerge`, 'POST', body);
export const searchEdits = query => call(`/api/manage/edits${query ? `?${query}` : ''}`);
export const readSiteLinks = () => call('/api/manage/links');
// 網站更新：公開 repo 的 GitHub Releases，不帶登入（每個 IP 每小時 60 次，管理者手動開頁夠用）
export const RELEASES_URL = 'https://api.github.com/repos/jiatsenK/bq-shelter-dogs/releases?per_page=30';
export const readReleases = () => settle(fetch(RELEASES_URL, { cache: 'no-cache', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) }));
export const readDiagrams = () => settle(fetch('./shared/diagrams.json', { cache: 'no-cache', redirect: 'error', signal: AbortSignal.timeout(15000) }));
