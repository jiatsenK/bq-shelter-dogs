// 已出所狗卡（#271，docs/adr/0002-activity-records.md）：圖鑑的「已出所」名單，每個人都直接收藏，不用開卡。
// 離所的狗從離所資料包讀（ADR 0014，不讀離所表）；溜過幾天用各年摘要（同 /walks/mine，不整表讀 v3_walks）；
// 出席活動次數從活動紀錄算；網站開始記錄前就離所的，是 K 建的只有名字的卡（v3_departed_cards）。
import { readSmall, readDogWalkDays } from './packs.js';

const REASONS = new Set(['adopt', 'death', 'other', 'unknown']);

// 回 [{ id, number, dogId, name, formerIds, stays, departed, reason, walkDays, activities, nameOnly }]，離所日新到舊
export async function readDepartedCards(db, today) {
  const departures = await readSmall(db, 'departures');
  const walkDays = await readDogWalkDays(db, today);
  const [byNumber, manual] = await db.batch([
    db.prepare('SELECT d.number, COUNT(DISTINCT a.activity_id) AS n FROM v3_activity_dogs a JOIN v3_departures d USING(dog_id) GROUP BY d.number'),
    db.prepare(`SELECT c.dog_id, g.name, c.departed_date, c.reason, (SELECT COUNT(DISTINCT a.activity_id) FROM v3_activity_dogs a WHERE a.dog_id=c.dog_id) AS n
      FROM v3_departed_cards c JOIN v3_dogs g USING(dog_id)`),
  ]);
  const acts = new Map((byNumber.results || []).map(r => [r.number, r.n]));
  const out = [];
  // 再入所（現在又在主清單上）的不算；同一隻離所兩次（舊編號在較新那筆的 formerIds 裡）只留最新那筆
  const covered = new Set();
  for (const e of departures) {
    const formerIds = (e.last && e.last.formerIds) || [];
    if (covered.has(e.id)) continue;
    [e.id, ...formerIds].forEach(n => covered.add(n));
    if (e.returned) continue;
    const name = String((e.last && e.last.name) || '').trim() || e.name;
    out.push({
      id: e.id, number: e.id, dogId: null, name, formerIds, stays: e.stays || [],
      departed: e.date || '', reason: REASONS.has(e.reason) ? e.reason : 'unknown',
      walkDays: [e.id, ...formerIds].reduce((n, id) => n + (walkDays[id] || 0), 0),
      activities: acts.get(e.id) || 0, nameOnly: false,
    });
  }
  for (const r of manual.results || []) {
    out.push({
      id: r.dog_id, number: '', dogId: r.dog_id, name: r.name, formerIds: [], stays: [],
      departed: r.departed_date || '', reason: REASONS.has(r.reason) ? r.reason : 'unknown',
      walkDays: 0, activities: r.n || 0, nameOnly: true,
    });
  }
  return out.sort((a, b) => b.departed.localeCompare(a.departed) || a.name.localeCompare(b.name));
}
