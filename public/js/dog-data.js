import { BQDates } from './dates.js';

// 狗清單格式不對就丟錯；可以一起溜缺少時回 null，保留既有資料讀取規則。
export function parseDogsData(data) {
  if (!data || !Array.isArray(data.dogs)) throw new Error('dogs.json 格式不對');
  const text = v => (v == null ? '' : String(v).trim());
  const dogs = data.dogs.filter(d => d && text(d.name)).map(d => ({
    cage: text(d.cage),
    ...(Number.isSafeInteger(d.editRevision)?{editRevision:d.editRevision}:{}),
    id: text(d.id),
    ...(d.dogId ? { dogId: text(d.dogId) } : {}),
    name: text(d.name),
    walkedDate: BQDates.parseYmd(d.walkedDate),
    // #460：主清單「誰遛的」代號，D1 模式未接管的狗用它換名字
    walkers: Array.isArray(d.walkers) ? d.walkers.map(text).filter(Boolean) : [],
    // #399：API 的 covered 只來自網站設定，不再由志工名字推定。
    covered: d.covered === true,
    note: text(d.note),
    // 性別、介紹由 D1 帶（api/dogs）
    sex: d.sex === 'male' ? '♂' : d.sex === 'female' ? '♀' : '',
    intro: text(d.intro),
    // 再次入所的舊編號（#75，狗卡 frontmatter 的 formerIds）
    formerIds: Array.isArray(d.formerIds) ? d.formerIds.map(text).filter(Boolean) : [],
    // 出入所表（#333、#639，ADR 0011、0021）：每次在所一列，number 查不到編號是空字串、out 還在所是空字串；
    // reason＝入所原因；departed＝離所日照離所紀錄（不能在網站改），departure 是離所原因；沒有離所紀錄的離所原因手填在 outReason。沒給的狗用 BQDates.stayRows 從編號排出來
    ...(Array.isArray(d.stays) ? { stays: d.stays.filter(r => r && typeof r === 'object').map(r => ({ number: text(r.number), in: text(r.in), out: text(r.out), reason: text(r.reason), ...(r.departed === true ? { departed: true, departure: text(r.departure) } : r.outReason ? { outReason: text(r.outReason) } : {}) })) } : {}),
  }));
  let groups = null;
  if (data.groups && typeof data.groups === 'object' && !Array.isArray(data.groups)) {
    groups = {};
    for (const [name, list] of Object.entries(data.groups)) {
      if (Array.isArray(list)) groups[name] = new Set(list.map(text).filter(n => n && n !== name));
    }
  }
  const synced = data.syncedAt ? new Date(data.syncedAt) : null;
  // 照片版本（#127）：Worker 的 /api/dogs 回傳時帶上，照片路徑 → 內容雜湊；repo 裡的 dogs.json 沒有
  const versions = {};
  if (data.photoVersions && typeof data.photoVersions === 'object' && !Array.isArray(data.photoVersions)) {
    for (const [path, v] of Object.entries(data.photoVersions)) {
      if (typeof v === 'string' && /^[0-9a-f]{1,32}$/.test(v)) versions[path] = v;
    }
  }
  // 異動紀錄（K 2026-10-10）：試算表狗清單下面那段，電腦版右欄（js/desk.js）；沒有或格式不對就是空的
  const sheetNotes = Array.isArray(data.sheetNotes) ? data.sheetNotes.filter(n => n && text(n.text)).map(n => ({ label: text(n.label), text: text(n.text) })) : [];
  return { dogs, groups, syncedAt: synced && !isNaN(synced) ? synced : null, photoVersions: versions, sheetNotes,
    ...(Object.hasOwn(data, 'groupColumns') ? { groupColumns: data.groupColumns } : {}),
    // 今日溜狗紀錄（ADR 0018）：Worker 跟狗清單一起帶，形狀同 /today?source=d1；交給 walkRegistration 檢查
    ...(data.today && typeof data.today === 'object' ? { today: data.today } : {}) };
}
