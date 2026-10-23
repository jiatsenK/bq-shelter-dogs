// 離所判讀與日期解析（#162、#501）：從 scripts/sync-sheet.mjs 抽出的純函式，不連網路、不依賴 Node。
// Worker 收「已出所」的列（worker/src/dog-list.js）和舊同步腳本共用同一份規則。日期用執行環境的本地時間。

// 把年月日組成日期；不合理的日期（例：2/30）回傳 null
export function makeDate(y, m, d) {
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

// 文字日期：2026/9/1、2026-09-01、2026.9.1、2026年9月1日、民國 115/9/1、9/1（沒寫年份）
export function parseDateText(text, today = new Date()) {
  const s = String(text).trim();
  if (!s) return null;
  let m = s.match(/(?<!\d)(\d{3,4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})(?!\d)/);
  if (m) {
    let y = parseInt(m[1], 10);
    if (y < 1000) y += 1911; // 民國年
    return makeDate(y, parseInt(m[2], 10), parseInt(m[3], 10));
  }
  m = s.match(/(?<!\d)(\d{1,2})\s*[\/月]\s*(\d{1,2})(?!\d)/);
  if (m) {
    const month = parseInt(m[1], 10), day = parseInt(m[2], 10);
    let date = makeDate(today.getFullYear(), month, day);
    // 沒寫年份又落在未來，就是去年（例：一月看到 12/28）
    if (date && date > today) date = makeDate(today.getFullYear() - 1, month, day);
    return date;
  }
  return null;
}

// 犬名比對時忽略空白（含全形空白）
export function nameKey(name) {
  return String(name).replace(/\s+/g, '');
}

export const pad = n => String(n).padStart(2, '0');
// 日期寫成本地（台灣）日期 YYYY-MM-DD，不帶時區，前端用 new Date(y, m - 1, d) 還原
export function formatDate(d) {
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null;
}

// 關鍵字表：同一類寫長的在前，命中時記下是哪個字
export const DEPARTURE_KEYWORDS = {
  adopt: ['被認養', '被領養', '認養', '領養', '送養', '出養'],
  death: ['安樂死', '死亡', '過世', '離世', '往生', '病逝', '去世', '安樂', '當天使', '小天使'],
  other: ['原主領回', '飼主領回', '主人領回', '領回', '轉送', '轉所', '移送', '逃脫', '走失'],
};
// 關鍵字前面接這些字就不算（「未認養」「想認養」「待認養」都不是真的認養了）
const NOT_BEFORE = /(未|沒|沒有|不|取消|想|想要|有意|詢問|考慮|預計|準備|等待|待|申請|試)$/;
// 關鍵字後面接這些字也不算（「認養未成」「認養失敗」「領養人」）
const NOT_AFTER = /^(未|沒|不|失敗|取消|人|者|資格|條件|申請|中)/;
// 出現這些字整筆都標待確認（認養後被退回、試養還沒定案）
const UNSURE_WORDS = ['退養', '退回', '試養'];

// 一段文字 → { reason, matched, flags }。reason：adopt／death／other／unknown
export function classifyDeparture(text) {
  const s = String(text || '').replace(/\s+/g, '');
  const hits = {};
  for (const [reason, words] of Object.entries(DEPARTURE_KEYWORDS)) {
    for (const w of words) {
      let i = s.indexOf(w);
      while (i !== -1) {
        // 已經被同一類更長的字命中的位置（例：被認養裡的認養）不重算
        const covered = (hits[reason] || []).some(h => i >= h.at && i < h.at + h.word.length);
        if (!covered && !NOT_BEFORE.test(s.slice(Math.max(0, i - 3), i)) && !NOT_AFTER.test(s.slice(i + w.length))) {
          (hits[reason] = hits[reason] || []).push({ word: w, at: i });
        }
        i = s.indexOf(w, i + 1);
      }
    }
  }
  const reasons = Object.keys(hits);
  const unsure = UNSURE_WORDS.find(w => s.includes(w));
  if (unsure) return { reason: 'unknown', matched: unsure, flags: ['unsure'] };
  if (reasons.length > 1) return { reason: 'unknown', matched: reasons.map(r => hits[r][0].word).join('、'), flags: ['conflict'] };
  if (!reasons.length) return { reason: 'unknown', matched: '', flags: [] };
  // 同一類命中好幾次：取最後一次（通常是最新補上的那句）
  const last = hits[reasons[0]].reduce((a, b) => (b.at > a.at ? b : a));
  return { reason: reasons[0], matched: last.word, flags: [], at: last.at, text: s }; // at、text 給 dateBeforeMatch 找日期用，不寫出去
}

// 關鍵字前面緊接的日期（例：「2026/10/1被認養」）
export function dateBeforeMatch(text, at, today = new Date()) {
  if (at == null) return null;
  const before = text.slice(Math.max(0, at - 16), at);
  const m = before.match(/((?:\d{3,4}\s*[\/\-.年]\s*)?\d{1,2}\s*[\/\-.月]\s*\d{1,2}日?)\s*$/);
  return m ? parseDateText(m[1], today) : null;
}

// 一隻狗在已出所分頁的判讀結果：用編號找，沒編號才用犬名（犬名要剛好一列才算）
export function judgeDeparture(dog, rows, today = new Date()) {
  if (!rows) return null; // 讀不到分頁：沿用上一次
  let found = dog.id ? rows.filter(r => r.texts.includes(dog.id)) : [];
  if (!found.length && !dog.id) {
    const byName = rows.filter(r => r.texts.some(t => nameKey(t) === nameKey(dog.name)));
    if (byName.length === 1) found = byName;
  }
  if (!found.length) return { reason: 'unknown', matched: '', flags: ['not-in-sheet'], date: null };
  const results = found.map(r => {
    const c = classifyDeparture(r.texts.join(' '));
    // 關鍵字前面緊接的日期只在同一格裡找，免得抓到隔壁的遛狗日期
    const cell = c.reason !== 'unknown' ? [...r.texts].reverse().map(t => t.replace(/\s+/g, '')).find(t => t.includes(c.matched)) : null;
    const date = r.departDate || (cell ? dateBeforeMatch(cell, cell.lastIndexOf(c.matched), today) : null);
    return { ...c, date: date ? formatDate(date) : null, dateSource: r.departDate ? 'sheet' : date ? 'note' : null };
  });
  const reasons = [...new Set(results.map(r => r.reason))];
  if (reasons.length > 1) return { reason: 'unknown', matched: results.map(r => r.matched).filter(Boolean).join('、'), flags: ['duplicate'], date: null };
  const best = results[results.length - 1];
  return { reason: best.reason, matched: best.matched, flags: [...new Set(results.flatMap(r => r.flags))], date: best.date, dateSource: best.dateSource };
}

