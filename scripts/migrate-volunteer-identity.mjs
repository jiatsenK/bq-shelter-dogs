// #267：唯讀分析與可重跑銜接。呼叫者提供 DB 與同一 WALKER_KEY 的代號算法；不自行連正式服務。
import { walkerCode, walkerNameKey } from '../worker/src/editlog.js';
import { linkIdentityName } from '../worker/src/identity.js';

export async function inspectVolunteerIdentity(db, codeFor) {
  const people = (await db.prepare('SELECT volunteer_id,name FROM v3_volunteers ORDER BY volunteer_id').all()).results;
  const groups = new Map();
  for (const p of people) {
    const k = walkerNameKey(p.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const confirmed = [], conflicts = [];
  for (const group of groups.values()) {
    if (group.length !== 1) { conflicts.push(...group.map(p => p.volunteer_id)); continue; }
    const p = group[0];
    const redirect = await db.prepare("SELECT name FROM sqlite_master WHERE name='v3_identity_redirects'").first();
    if (redirect && await db.prepare('SELECT volunteer_id FROM v3_identity_redirects WHERE volunteer_id=?').bind(p.volunteer_id).first()) continue;
    confirmed.push({ volunteerId: p.volunteer_id, name: p.name, code: await codeFor(p.name) });
  }
  const known = new Set(confirmed.map(p => p.code));
  const categories = {};
  const unknown = new Set();
  for (const [label, table] of [['cards','v3_card_opened'],['walkRows','v3_walks']]) { // 舊常溜 v3_favorites 已全部搬完、停用（#557）
    const data = (await db.prepare(`SELECT walker_code FROM ${table}`).all()).results;
    const matched = data.filter(r => known.has(r.walker_code)).length;
    data.forEach(r => { if (r.walker_code && !known.has(r.walker_code)) unknown.add(r.walker_code); });
    categories[label] = { total: data.length, confirmed: matched, pending: data.length - matched };
  }
  return { confirmed, conflicts, unknownCodes: [...unknown].sort(), categories };
}

// 先套用 267-identity.sql。只接確定名字，未知代號與原表完全保留。
export async function migrateVolunteerIdentity(db, keyOrCodeFor) {
  if (!keyOrCodeFor) throw new Error('缺少原本的 WALKER_KEY 或已核對的代號提供者');
  const codeFor = typeof keyOrCodeFor === 'function' ? keyOrCodeFor : name => walkerCode(name, keyOrCodeFor);
  const report = await inspectVolunteerIdentity(db, codeFor);
  if (report.conflicts.length) throw new Error('正規化後有多個志工身分，請先確認，不自動合併');
  for (const person of report.confirmed) {
    const identity = await linkIdentityName(db, person.name, person.code);
    if (identity.volunteerId !== person.volunteerId) throw new Error('既有有效志工身分發生變動');
  }
  return report;
}
