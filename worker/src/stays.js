// 出入所紀錄（#333，ADR 0011）：每次在所一筆 { in, out, reason }，out 還在所就留空；一隻狗一列存在 v3_stays。
export const STAYS_MAX = 30;
export const STAY_REASON_MAX = 40;

function validYmd(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(text + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

// 整理成存檔的樣子（照入所日排）；格式不對回 { error }。today 是台灣日期 YYYY-MM-DD，日期不能比它晚
export function cleanStays(value, today) {
  if (!Array.isArray(value) || value.length > STAYS_MAX) return { error: `出入所紀錄格式不對（最多 ${STAYS_MAX} 筆）` };
  const out = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') return { error: '出入所紀錄格式不對' };
    const stayIn = String(row.in ?? '').trim(), stayOut = String(row.out ?? '').trim();
    const reason = String(row.reason ?? '').replace(/\s+/g, ' ').trim();
    if (!validYmd(stayIn) || (stayOut && !validYmd(stayOut))) return { error: '日期請用 YYYY-MM-DD' };
    if (stayIn > today || stayOut > today) return { error: '日期不能是未來的日子' };
    if (stayOut && stayOut < stayIn) return { error: '出所日不能早於入所日' };
    if ([...reason].length > STAY_REASON_MAX) return { error: `原因最多 ${STAY_REASON_MAX} 字` };
    out.push({ in: stayIn, out: stayOut, reason });
  }
  out.sort((a, b) => a.in.localeCompare(b.in) || a.out.localeCompare(b.out) || a.reason.localeCompare(b.reason));
  return { stays: out };
}

// 同步才補建新表；正式 D1 還沒建表前當成都沒有紀錄。其他資料庫錯誤不能吞掉
// where 有給只讀符合的狗（照主鍵，ADR 0014）
export async function readAllStays(db, where = '') {
  try {
    const { results = [] } = await db.prepare(`SELECT dog_id, stays_json FROM v3_stays${where ? ` WHERE ${where}` : ''}`).all();
    return new Map(results.map(r => [r.dog_id, JSON.parse(r.stays_json)]));
  } catch (e) {
    if (/no such table:\s*(?:main\.)?v3_stays\b/i.test(e.message)) return new Map();
    throw e;
  }
}
