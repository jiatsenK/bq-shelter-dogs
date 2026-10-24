import { BQDates } from './dates.js';

// 狗清單格式不對就丟錯；可以一起溜缺少時回 null，保留既有資料讀取規則。
export function parseDogsData(data) {
  if (!data || !Array.isArray(data.dogs)) throw new Error('dogs.json 格式不對');
  const text = v => (v == null ? '' : String(v).trim());
  const dogs = data.dogs.filter(d => d && text(d.name)).map(d => ({
    cage: text(d.cage),
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
    // 出入所紀錄（#333，ADR 0011）：每次在所一筆，out 還在所就是空字串
    ...(Array.isArray(d.stays) ? { stays: d.stays.filter(r => r && typeof r === 'object').map(r => ({ in: text(r.in), out: text(r.out), reason: text(r.reason) })) } : {}),
    ...(Array.isArray(d.intakeEvents) ? { intakeEvents: d.intakeEvents.map(e => ({ number: text(e.number), date: text(e.date), event: text(e.event) })) } : {}),
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
      if (typeof v === 'string' && /^[0-9a-f]{1,16}$/.test(v)) versions[path] = v;
    }
  }
  // 異動紀錄（K 2026-10-10）：試算表狗清單下面那段，電腦版右欄（js/desk.js）；沒有或格式不對就是空的
  const sheetNotes = Array.isArray(data.sheetNotes) ? data.sheetNotes.filter(n => n && text(n.text)).map(n => ({ label: text(n.label), text: text(n.text) })) : [];
  return { dogs, groups, syncedAt: synced && !isNaN(synced) ? synced : null, photoVersions: versions, sheetNotes,
    ...(Object.hasOwn(data, 'groupColumns') ? { groupColumns: data.groupColumns } : {}) };
}
