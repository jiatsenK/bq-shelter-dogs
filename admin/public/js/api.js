import { settle } from '../shared/api-response.js';

export const readDogs = () => settle(fetch('/api/manage/dogs', {
  credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
}));
