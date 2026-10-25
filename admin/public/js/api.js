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
export const searchEdits = query => call(`/api/manage/edits${query ? `?${query}` : ''}`);
export const readWebsiteUpdates = () => settle(fetch('./shared/website-updates.json', { cache: 'no-cache', redirect: 'error', signal: AbortSignal.timeout(15000) }));
