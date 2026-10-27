// 已出所狗卡（#271，docs/adr/0002-activity-records.md）：圖鑑的「已出所」名單，每個人都直接收藏，不用開卡。
// 離所的狗從離所資料包讀（ADR 0014，不讀離所表）；溜過幾天用各年摘要（同 /walks/mine，不整表讀 v3_walks）；
// 出席活動次數從活動紀錄算；網站開始記錄前就離所的，是 K 建的只有名字的卡（#560 起是離所資料包的 cards，跟離所同一個版本號）。
import { readDeparted, readDogWalkDays } from './packs.js';

const REASONS = new Set(['adopt', 'death', 'other', 'unknown']);

// 出席次數：跟活動同一個版本號（v3_activity_versions），沒變只讀那 1 列；變了才讀出席名單
// （一年約幾百列）和這些狗的編號（照 v3_numbers_dog 索引），不讀離所表
let attendCache = null; // { db, ver, byDog: Map(狗 ID → 次數), byNumber: Map(編號 → 次數) }
async function attendance(db) {
  const ver = await db.prepare('SELECT ver FROM v3_activity_versions WHERE id=1').first('ver');
  if (ver !== null && attendCache && attendCache.db === db && attendCache.ver === ver) return attendCache;
  const [counts, numbers] = await db.batch([
    db.prepare('SELECT dog_id, COUNT(DISTINCT activity_id) AS n FROM v3_activity_dogs WHERE dog_id IS NOT NULL GROUP BY dog_id'),
    db.prepare('SELECT number, dog_id FROM v3_dog_numbers WHERE dog_id IN (SELECT dog_id FROM v3_activity_dogs WHERE dog_id IS NOT NULL)'),
  ]);
  const byDog = new Map((counts.results || []).map(r => [r.dog_id, r.n]));
  const out = {
    db, ver, byDog,
    byNumber: new Map((numbers.results || []).map(r => [r.number, byDog.get(r.dog_id) || 0])),
  };
  attendCache = ver === null ? null : out;
  return out;
}

// 回 [{ id, number, dogId, name, formerIds, stays, departed, reason, walkDays, activities, nameOnly }]，離所日新到舊
export async function readDepartedCards(db, today) {
  const { departures, cards } = await readDeparted(db);
  const walkDays = await readDogWalkDays(db, today);
  const { byDog, byNumber } = await attendance(db);
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
      activities: byNumber.get(e.id) || 0, nameOnly: false,
    });
  }
  for (const c of cards) {
    out.push({
      id: c.dogId, number: '', dogId: c.dogId, name: c.name, formerIds: [], stays: [],
      departed: c.date, reason: REASONS.has(c.reason) ? c.reason : 'unknown',
      walkDays: 0, activities: byDog.get(c.dogId) || 0, nameOnly: true,
    });
  }
  return out.sort((a, b) => b.departed.localeCompare(a.departed) || a.name.localeCompare(b.name));
}
