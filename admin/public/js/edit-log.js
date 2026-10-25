// #567 資料編輯紀錄的純規則：查詢字串（只送白名單、省略預設值，分頁用伺服器給的游標）、回應驗證與顯示文字。
import { editsValue } from '../shared/edit-values.js';

export const FILTERS = ['q', 'kind', 'dog', 'actor', 'source', 'from', 'to', 'order'];
export function editQuery(filters) {
  const params = new URLSearchParams();
  for (const key of FILTERS) {
    const v = String(filters[key] ?? '').trim();
    if (v && !(key === 'order' && v === 'newest')) params.set(key, v);
  }
  if (filters.cursor) params.set('cursor', String(filters.cursor));
  if ([50, 100].includes(Number(filters.size))) params.set('size', String(filters.size));
  return params.toString();
}

export function parseEditPage(data) {
  if (!data || !(data.next === null || Number.isSafeInteger(data.next)) || !Number.isSafeInteger(data.pageSize) || !Array.isArray(data.edits) || !Array.isArray(data.kinds)) throw Error('編輯紀錄格式不正確');
  for (const e of data.edits) {
    if (!e || !Number.isSafeInteger(e.id) || typeof e.at !== 'string' || typeof e.kind !== 'string' || typeof e.editorName !== 'string') throw Error('編輯紀錄格式不正確');
  }
  return data;
}

export function formatWhen(iso) {
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  const d = new Date(t + 8 * 3600000), p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export const sourceLabel = source => ({ access: '管理網站', volunteer: '志工網站' })[source] || '舊紀錄';
export { editsValue as valueText };
