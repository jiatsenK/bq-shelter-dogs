import { BQDates } from '../shared/dates.js';

const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
export const sexLabel = sex => ({ male: '公', female: '母' })[sex] || '待確認';
export function maintenance(dog, today = BQDates.taipeiToday()) {
  const labels = [];
  if (!dog.number) labels.push('缺編號');
  if (!dog.photoUrl) labels.push('缺照片');
  if (!dog.intro.trim()) labels.push('缺介紹');
  if (!['male', 'female'].includes(dog.sex)) labels.push('性別待確認');
  if (dog.sexMismatch) labels.push('性別資料不一致');
  if (dog.rest && dog.rest.until >= today) labels.push('休養中');
  if (dog.fixedCare) labels.push('固定照顧');
  return labels;
}
export function parseManageDogs(data) {
  if (!data || !Array.isArray(data.dogs)) throw Error('管理資料格式不正確');
  const ids = new Set();
  return data.dogs.map(dog => {
    if (!dog || typeof dog.dogId !== 'string' || !dog.dogId || ids.has(dog.dogId)) throw Error('狗的永久身分缺漏或重複');
    ids.add(dog.dogId);
    for (const field of ['number', 'name', 'cage', 'note', 'intro', 'sex']) {
      if (typeof dog[field] !== 'string') throw Error('管理資料格式不正確');
    }
    if (typeof dog.onMain !== 'boolean' || typeof dog.fixedCare !== 'boolean' || typeof dog.sexMismatch !== 'boolean') throw Error('管理狀態格式不正確');
    if (dog.photoUrl !== null && (typeof dog.photoUrl !== 'string' || !/^\/photos\/(?:thumbs\/)?[0-9A-Za-z]{1,32}\.jpg$/.test(dog.photoUrl))) throw Error('照片網址格式不正確');
    if (dog.rest !== null && (!dog.rest || !BQDates.parseYmd(dog.rest.until) || typeof dog.rest.reason !== 'string')) throw Error('休養資料格式不正確');
    return dog;
  });
}
export function selectDogs(dogs, { query = '', presence = 'all', sex = '', care = '', sort = 'number', direction = 'asc', page = 1, pageSize = 25 } = {}) {
  const today = BQDates.taipeiToday();
  const search = query.trim().toLocaleLowerCase('zh-Hant');
  const filtered = dogs.filter(dog => {
    if (presence === 'main' && !dog.onMain || presence === 'other' && dog.onMain) return false;
    if (sex && (sex === 'unknown' ? ['male', 'female'].includes(dog.sex) : dog.sex !== sex)) return false;
    const labels = maintenance(dog, today);
    if (care === 'rest' && !labels.includes('休養中') || care === 'fixed' && !dog.fixedCare) return false;
    if (care === 'missing' && !labels.some(label => label.startsWith('缺') || label.includes('性別'))) return false;
    return !search || [dog.dogId, dog.number, dog.name, dog.cage, dog.note, dog.intro].some(value => value.toLocaleLowerCase('zh-Hant').includes(search));
  });
  const key = ['number', 'name', 'cage', 'sex', 'dogId'].includes(sort) ? sort : 'number';
  filtered.sort((a, b) => {
    // Blank values stay last in either direction, with permanent identity as stable tie-breaker.
    if (!a[key] !== !b[key]) return a[key] ? -1 : 1;
    return collator.compare(a[key], b[key]) * (direction === 'desc' ? -1 : 1) || collator.compare(a.dogId, b.dogId);
  });
  const size = [25, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 25;
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.max(1, Math.min(pages, Math.floor(Number(page)) || 1));
  return { rows: filtered.slice((current - 1) * size, current * size), total: filtered.length, pages, page: current, pageSize: size };
}
