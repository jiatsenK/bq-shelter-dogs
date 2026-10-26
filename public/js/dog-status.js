import { BQDates } from './dates.js';
import { SITE } from './site-config.js';

// 狗的天數色標、溜狗表排序與警示關鍵字：純函式，不讀頁面狀態。
// 今天的登記狀態（walkRegistration.state）與休養設定由呼叫端帶入，Node 可直接匯入測試。

// 天數色標：0～AMBER_DAYS-1 天綠、AMBER_DAYS 天起黃、RED_DAYS 天起紅
export const AMBER_DAYS = SITE.days.amber;
export const RED_DAYS = SITE.days.red;
// 警示關鍵字（#28）：備註含任一個，就把備註原文直接顯示在卡片第一層，字眼標紅；
// 只用來判斷要不要顯示，不改寫原文、不另外產生標籤。狗照樣留在待巡房，由志工自己判斷。
export const SPECIAL_KEYWORDS = SITE.warnKeywords;

// 今天已溜用編號記；新來還沒有編號的狗改用犬名記（K 說不會有同名的狗）
export function walkKey(dog) {
  if (dog.id) return dog.id;
  return dog.name ? `名:${dog.name}` : '';
}

// 回傳備註命中的關鍵字（顯示用）與實際出現的寫法（標示用）；沒命中回 null
export function specialFlag(note) {
  const keywords = [], terms = [];
  for (const [label, ...variants] of SPECIAL_KEYWORDS) {
    const hit = [label, ...variants].filter(t => (note || '').includes(t));
    if (!hit.length) continue;
    keywords.push(label);
    terms.push(...hit);
  }
  return keywords.length ? { keywords, terms } : null;
}

// 休養中：今天還在設定的日期以內（含那一天）才算；過了自動恢復。restMap：{ 編號: { until, reason } }
export function restFrom(dog, today, restMap) {
  const r = dog && dog.id && restMap[dog.id];
  const until = r && BQDates.parseYmd(r.until);
  if (!until) return null;
  const day = BQDates.makeDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
  return day <= until ? { until, reason: r.reason || '' } : null;
}

// rest：restFrom 的結果；walk：今天的登記狀態 { mine, date }（date 是 YYYY-MM-DD）
export function dogStatus(dog, today, { rest = null, walk = {} } = {}) {
  if (rest) return { kind: 'rest', ...rest };
  if (dog.covered) return { kind: 'covered' };
  // V9（#141）拿掉今天已溜分類：自己今天登記過的狗直接當作今天溜的
  if (walk.mine) return { kind: 'dated', days: 0, level: 'sage', mine: true };
  const date = BQDates.parseYmd(walk.date);
  if (date) {
    const days = Math.floor((today - date) / 86400000);
    let level = 'sage';
    if (days >= RED_DAYS) level = 'red';
    else if (days >= AMBER_DAYS) level = 'amber';
    return { kind: 'dated', days, level };
  }
  return { kind: 'unknown' };
}

// 溜狗表（沿用原待巡房）：所有狗依幾天沒遛由久到近；沒有遛狗紀錄的排最前，有人固定照顧的排最後
// 休養中排最下面（K 2026-10-09），有人固定照顧在它上面。statusOf(dog) 回傳 dogStatus 的結果
export function sortDue(dogs, statusOf) {
  const key = s => s.kind === 'unknown' ? Infinity : s.kind === 'dated' ? Math.max(0, s.days) : s.kind === 'covered' ? -1 : -2;
  return dogs
    .map(d => ({ d, k: key(statusOf(d)) }))
    .sort((a, b) => (b.k === a.k ? 0 : b.k > a.k ? 1 : -1))
    .map(x => x.d);
}
