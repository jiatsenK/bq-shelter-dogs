import { settle } from '../shared/api-response.js';
const request = (method, body) => settle(fetch('/api/manage/settings', {
  method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}));
export const readSettings = () => request('GET');
export const saveSettings = body => request('PUT', body);
