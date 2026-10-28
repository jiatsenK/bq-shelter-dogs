// 分享次數（ADR 0023）：每天、每種方式一列，只累加次數，不記是誰
import { taiwanYmd } from './sync-plan.js';

export const SHARE_METHODS = Object.freeze(['share', 'copy']);
const RECENT_DAYS = 30;

export async function countShare(db, method, now = Date.now()) {
  if (!SHARE_METHODS.includes(method)) throw Object.assign(new Error('分享方式不對'), { status: 400 });
  // 當天那列和總數那列一起加 1，固定寫 2 列
  await db.batch([
    db.prepare('INSERT INTO v3_share_counts(day,method,count) VALUES(?,?,1) ON CONFLICT(day,method) DO UPDATE SET count=count+1').bind(taiwanYmd(now), method),
    db.prepare('INSERT INTO v3_share_totals(method,count) VALUES(?,1) ON CONFLICT(method) DO UPDATE SET count=count+1').bind(method),
  ]);
}

// 管理網站設定頁：總數，加上最近 30 天有分享的日子（新的在前）
export async function readShareCounts(db, now = Date.now()) {
  const since = taiwanYmd(now - (RECENT_DAYS - 1) * 86400000);
  const [totals, recent] = await db.batch([
    db.prepare("SELECT method, count FROM v3_share_totals WHERE method IN ('share','copy')"),
    db.prepare('SELECT day, method, count FROM v3_share_counts WHERE day>=? ORDER BY day DESC').bind(since),
  ]);
  const total = { share: 0, copy: 0 };
  for (const row of totals.results) total[row.method] = row.count;
  const days = new Map();
  for (const row of recent.results) {
    if (!days.has(row.day)) days.set(row.day, { day: row.day, share: 0, copy: 0 });
    days.get(row.day)[row.method] = row.count;
  }
  return { total, days: [...days.values()] };
}
