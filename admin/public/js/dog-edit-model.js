// #624 狗資料抽屜的純規則：欄位順序、哪些要先預覽、現值摘要與「待補」、改前→改後文字。
// 後端契約不變（一欄一筆交易＋revision），這裡不碰網路與 DOM，方便 node 測試。
import { BQDates } from '../shared/dates.js';

// 儲存順序也照這個順序，一欄一筆。
export const FIELDS = [
  ['intro', '介紹'],
  ['rest', '休養'],
  ['fixedCare', '固定照顧'],
  ['sex', '性別補正'],
  ['numbers', '編號'],
  ['stays', '出入所紀錄'],
  ['photo', '照片']
];
export const FIELD_LABELS = Object.fromEntries(FIELDS);
// 改錯不容易看出來或影響照片／身分對應的欄位：先預覽改前／改後才能存。其餘改完直接可存，行內標差異。
export const PREVIEW_FIELDS = new Set(['numbers', 'stays', 'photo']);
export const INTRO_MAX = 1000;
export const REST_DAYS = 180;
export const REST_REASON_MAX = 40;

export const sexLabel = (value) => ({ male: '公', female: '母' })[value] || '待確認';

export function restBounds(today = BQDates.taipeiToday()) {
  const [y, m, d] = today.split('-').map(Number);
  const max = new Date(Date.UTC(y, m - 1, d + REST_DAYS)).toISOString().slice(0, 10);
  return { min: today, max };
}

// 抽屜欄名旁的現值；missing＝待補（和狗資料表的缺介紹／缺照片／缺編號／性別待確認同一套）
// photoUrl：狗資料表那一列的照片（舊固定路徑的照片沒有 D1 引用，只能從這裡知道有照片）
export function fieldSummary(field, snapshot, photoUrl = null) {
  if (field === 'intro') {
    const length = [...snapshot.intro.trim()].length;
    return length ? { text: `${length} 字`, missing: false } : { text: '待補', missing: true };
  }
  if (field === 'rest') return { text: snapshot.rest ? `休養至 ${snapshot.rest.until}` : '沒有休養', missing: false };
  if (field === 'fixedCare') return { text: snapshot.fixedCare ? '有' : '沒有', missing: false };
  if (field === 'sex') {
    const known = ['male', 'female'].includes(snapshot.sex);
    return { text: known ? sexLabel(snapshot.sex) : '待確認', missing: !known };
  }
  if (field === 'numbers')
    return snapshot.numbers.length ? { text: snapshot.numbers.join('、'), missing: false } : { text: '待補', missing: true };
  if (field === 'stays') return { text: snapshot.stays.length ? `${snapshot.stays.length} 筆` : '沒有補登', missing: false };
  if (field === 'photo') return snapshot.photo || photoUrl ? { text: '有照片', missing: false } : { text: '待補', missing: true };
  return { text: '', missing: false };
}

export function displayValue(field, value) {
  if (field === 'sex') return sexLabel(value);
  if (field === 'fixedCare') return value ? '有人固定照顧' : '沒有固定照顧';
  if (field === 'rest') return value ? `休養至 ${value.until}${value.reason ? `（${value.reason}）` : ''}` : '沒有休養';
  if (field === 'numbers') return value.join('\n') || '無編號';
  if (field === 'stays')
    return value.map((row) => `入所 ${row.in}／出所 ${row.out || '尚未出所'}／${row.reason || '未填原因'}`).join('\n') || '無補登紀錄';
  if (field === 'intro') return value || '（空白）';
  return String(value ?? '');
}

export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 介紹只標出改動的那一段，前後各留一點上下文，不把全文印兩次。以字（code point）計，跟後端 1000 字同算法。
export function introDiff(before, after, context = 16) {
  const a = [...before],
    b = [...after];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const lead = a.slice(Math.max(0, start - context), start).join('');
  const tail = a.slice(a.length - end, a.length - end + context).join('');
  return {
    lead: (start > context ? '…' : '') + lead,
    removed: a.slice(start, a.length - end).join(''),
    added: b.slice(start, b.length - end).join(''),
    tail: tail + (end > context ? '…' : '')
  };
}

// 休養草稿的檢查；回傳錯誤文字或空字串。後端仍會再驗一次。
export function restProblem(value, today = BQDates.taipeiToday()) {
  if (value === null) return '';
  const { min, max } = restBounds(today);
  if (!value.until) return '請填休養到哪一天，或勾「結束休養」。';
  if (value.until < min || value.until > max) return `休養日期要在 ${min} 到 ${max} 之間。`;
  if ([...value.reason].length > REST_REASON_MAX) return `原因最多 ${REST_REASON_MAX} 字。`;
  return '';
}

// 存檔後把單狗快照的值寫回狗資料表那一列（只更新這一列，不整表重讀）。
export function patchDog(dog, snapshot) {
  const photo = snapshot.photo ? `/${snapshot.photo.thumb || snapshot.photo.key}` : dog.photoUrl;
  return { ...dog, intro: snapshot.intro, sex: snapshot.sex, fixedCare: snapshot.fixedCare, rest: snapshot.rest, photoUrl: photo };
}
