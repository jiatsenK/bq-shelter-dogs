import { BQDates } from '../shared/dates.js';

const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
export const sexLabel = sex => ({ male: '公', female: '母' })[sex] || '待確認';
// 狀態（K 2026-10-26）：在主清單＝在所；有離所紀錄＝已出所（同試算表分頁名）；兩邊都沒有＝待核對（不叫待確認，那是離所原因與性別用的詞）
export const STATUS_LABELS = { main: '在所', departed: '已出所', unknown: '待核對' };
export const STATUS_TABS = ['main', 'departed', 'unknown', 'all'];
const reasonLabels = { adopt: '認養', death: '離世', other: '其他' };
export const departureLabel = departure => departure ? `${departure.date || '日期待確認'} 離所（${reasonLabels[departure.reason] || '待確認'}）` : '';
// 不在所的狗狗名下那一行：離所日期與原因，或「待核對」
export const statusText = dog => (dog.departure ? departureLabel(dog.departure) : STATUS_LABELS[dog.status]);
// 不在所的狗沒有目前編號，用最新的舊編號顯示、排序
export const shownNumber = dog => dog.number || dog.formerNumber;
const maintenanceLabels = { missingNumber: '缺編號', missingPhoto: '缺照片', missingIntro: '缺介紹',
  unknownSex: '性別待確認', resting: '休養中', fixedCare: '固定照顧' };
function maintenanceState(dog, today) {
  return { missingNumber: !shownNumber(dog), missingPhoto: !dog.photoUrl, missingIntro: !dog.intro.trim(),
    unknownSex: !['male', 'female'].includes(dog.sex),
    resting: Boolean(dog.rest && dog.rest.until >= today), fixedCare: dog.fixedCare,
    // #624 待補清單連過來用；這兩項來自試算表，管理網站不能改，所以不算進「有待補資料」
    badNumberDate: Boolean(dog.number) && !BQDates.idDate(dog.number), missingWalk: !dog.walkedDate };
}
// #624 維護狀態篩選：待補清單各項連到這裡（index.html?care=...），用語跟表格標籤一致
export const CARE_FILTERS = { missing: '有待補資料', missingIntro: '缺介紹', missingPhoto: '缺照片', missingNumber: '缺編號',
  unknownSex: '性別待確認', badNumberDate: '編號看不出入所日期', missingWalk: '缺溜狗日期', rest: '休養中', fixed: '固定照顧' };
const careFlag = { rest: 'resting', fixed: 'fixedCare' };
export function maintenance(dog, today = BQDates.taipeiToday()) {
  const flags = maintenanceState(dog, today);
  return Object.keys(maintenanceLabels).filter(key => flags[key]).map(key => maintenanceLabels[key]);
}
export function parseManageDogs(data) {
  if (!data || !Array.isArray(data.dogs)) throw Error('管理資料格式不正確');
  const ids = new Set();
  return data.dogs.map(dog => {
    if (!dog || typeof dog.dogId !== 'string' || !dog.dogId || ids.has(dog.dogId)) throw Error('狗的永久身分缺漏或重複');
    ids.add(dog.dogId);
    for (const field of ['number', 'formerNumber', 'name', 'cage', 'note', 'intro', 'sex']) {
      if (typeof dog[field] !== 'string') throw Error('管理資料格式不正確');
    }
    if (typeof dog.onMain !== 'boolean' || typeof dog.fixedCare !== 'boolean' || !Object.hasOwn(STATUS_LABELS, dog.status)) throw Error('管理狀態格式不正確');
    if (dog.departure !== null && (!dog.departure || typeof dog.departure.date !== 'string' || typeof dog.departure.reason !== 'string')) throw Error('離所資料格式不正確');
    if (dog.photoUrl !== null && (typeof dog.photoUrl !== 'string' || !/^\/photos\/(?:thumbs\/)?[0-9A-Za-z]{1,32}\.jpg$/.test(dog.photoUrl))) throw Error('照片網址格式不正確');
    if (dog.rest !== null && (!dog.rest || !BQDates.parseYmd(dog.rest.until) || typeof dog.rest.reason !== 'string')) throw Error('休養資料格式不正確');
    return dog;
  });
}
// 狀態分頁上的數量：不受搜尋與其他篩選影響
export function statusCounts(dogs) {
  const counts = { main: 0, departed: 0, unknown: 0, all: dogs.length };
  for (const dog of dogs) counts[dog.status]++;
  return counts;
}
// 篩選＋排序後的完整清單（不分頁）；「存並開下一隻」照這個順序找下一隻
export function orderDogs(dogs, { query = '', status = 'all', sex = '', care = '', sort = 'number', direction = 'asc' } = {}) {
  const today = BQDates.taipeiToday();
  const search = query.trim().toLocaleLowerCase('zh-Hant');
  const filtered = dogs.filter(dog => {
    if (status !== 'all' && dog.status !== status) return false;
    if (sex && (sex === 'unknown' ? ['male', 'female'].includes(dog.sex) : dog.sex !== sex)) return false;
    const flags = maintenanceState(dog, today);
    if (care === 'missing' && !(flags.missingNumber || flags.missingPhoto || flags.missingIntro || flags.unknownSex)) return false;
    if (care && care !== 'missing' && Object.hasOwn(CARE_FILTERS, care) && !flags[careFlag[care] || care]) return false;
    return !search || [dog.dogId, dog.number, dog.formerNumber, dog.name, dog.cage, dog.note, dog.intro].some(value => value.toLocaleLowerCase('zh-Hant').includes(search));
  });
  const key = ['number', 'name', 'cage', 'sex', 'dogId'].includes(sort) ? sort : 'number';
  const value = dog => (key === 'number' ? shownNumber(dog) : dog[key]);
  filtered.sort((a, b) => {
    // Blank values stay last in either direction, with permanent identity as stable tie-breaker.
    if (!value(a) !== !value(b)) return value(a) ? -1 : 1;
    return collator.compare(value(a), value(b)) * (direction === 'desc' ? -1 : 1) || collator.compare(a.dogId, b.dogId);
  });
  return filtered;
}
export function selectDogs(dogs, options = {}) {
  const { page = 1, pageSize = 25 } = options;
  const filtered = orderDogs(dogs, options);
  const size = [25, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 25;
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.max(1, Math.min(pages, Math.floor(Number(page)) || 1));
  return { rows: filtered.slice((current - 1) * size, current * size), total: filtered.length, pages, page: current, pageSize: size };
}
