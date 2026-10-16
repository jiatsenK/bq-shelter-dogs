// #285：日期是人工確認的事件日期，不從編號推定；編號可以未確認。
export function cleanIntakeEvents(value) {
  if (!Array.isArray(value) || value.length > 30) return null;
  const out = [];
  let length = 0;
  for (const row of value) {
    if (!row || typeof row.number !== 'string' || typeof row.date !== 'string' || typeof row.event !== 'string') return null;
    const number = row.number.trim(), date = row.date.trim(), event = row.event.replace(/\r\n?/g, '\n').trim();
    if (number && !/^[0-9A-Za-z]{1,32}$/.test(number)) return null;
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const parsed = new Date(date + 'T00:00:00Z');
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
    }
    length += [...event].length;
    if (length > 1000) return null;
    out.push({ number, date, event });
  }
  return out;
}

export async function readIntakeEvents(db, dogId) {
  const { results = [] } = await db.prepare('SELECT number,event_date,event FROM v3_intake_events WHERE dog_id=? ORDER BY position').bind(dogId).all();
  return results.map(r => ({ number: r.number, date: r.event_date, event: r.event }));
}

// 同步才補建新表；初次上線前仍可讀原介紹。其他資料庫錯誤不能吞掉。
export async function readAllIntakeEvents(db) {
  try {
    return await db.prepare('SELECT dog_id,number,event_date,event FROM v3_intake_events ORDER BY dog_id,position').all();
  } catch (e) {
    if (/no such table:\s*(?:main\.)?v3_intake_events\b/i.test(e.message)) return { results: [] };
    throw e;
  }
}
