// #567 活動紀錄的純規則：格式驗證、搜尋、草稿差異、送出內容。DOM 在 activities.js。
export const KIND_LABELS = { kids: '動保小小兵', adoption: '認養會' };
const ID = /^[a-f0-9]{32}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function parseActivities(data) {
  if (!data || !Array.isArray(data.activities)) throw Error('活動資料格式不正確');
  return data.activities.map(a => {
    if (!a || !ID.test(a.id) || !YMD.test(a.date) || !Object.hasOwn(KIND_LABELS, a.kind) || !Number.isSafeInteger(a.revision) || !Array.isArray(a.dogs)) throw Error('活動資料格式不正確');
    for (const d of a.dogs) {
      if (!d || (d.dogId !== null && typeof d.dogId !== 'string') || typeof d.name !== 'string' || typeof d.number !== 'string') throw Error('出席狗格式不正確');
    }
    return a;
  });
}

export function filterActivities(list, { kind = '', query = '' } = {}) {
  const q = query.trim().toLocaleLowerCase('zh-Hant');
  return list.filter(a => (!kind || a.kind === kind) &&
    (!q || [a.date, KIND_LABELS[a.kind], ...a.dogs.flatMap(d => [d.name, d.number])].some(v => v.toLocaleLowerCase('zh-Hant').includes(q))));
}

const entryKey = d => (d.dogId ? `id:${d.dogId}` : `名:${d.name}`);
export function sameActivity(saved, draft) {
  return saved.date === draft.date && saved.kind === draft.kind &&
    saved.dogs.length === draft.dogs.length && saved.dogs.every((d, i) => entryKey(d) === entryKey(draft.dogs[i]));
}

// 已對上的狗送永久 ID；只有名字的舊紀錄原樣送名字，伺服器不猜同名的狗
export function activityPayload(draft, revision) {
  return { ...(revision === undefined ? {} : { revision }), date: draft.date, kind: draft.kind,
    dogs: draft.dogs.map(d => (d.dogId ? { dogId: d.dogId } : { name: d.name })) };
}

export function describeActivity(a) {
  const dogs = a.dogs.map(d => (d.dogId ? d.name : `${d.name}（未對應）`)).join('、') || '（沒有狗）';
  return `${a.date} ${KIND_LABELS[a.kind] || a.kind}：${dogs}`;
}

export const dogLabel = dog => (dog.number ? `${dog.number} ${dog.name}` : `${dog.name}（無編號）`);
// 輸入框的字 → 一隻狗：選單上的完整標籤、編號，或只有一隻同名的狗名；對不上回 null
export function matchDog(dogs, text) {
  const t = text.trim();
  if (!t) return null;
  const exact = dogs.find(d => dogLabel(d) === t || (d.number && d.number === t));
  if (exact) return exact;
  const named = dogs.filter(d => d.name === t);
  return named.length === 1 ? named[0] : null;
}
