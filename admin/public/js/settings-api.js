import { settle } from '../shared/api-response.js';
const request = (method, body, path = '/api/manage/settings') => settle(fetch(path, {
  method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}));
export const readSettings = () => request('GET');
export const saveSettings = body => request('PUT', body);
// ADR 0023 分享次數：總數和最近 30 天，只讀
export const readShareCounts = () => request('GET', null, '/api/manage/share-counts');
