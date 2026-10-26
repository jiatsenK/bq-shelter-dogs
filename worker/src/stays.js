// 出入所紀錄（#333，ADR 0011、0021）：一個編號就是一筆，查不到編號的那次編號空著。
// 原因＝入所原因（K 2026-10-19 #390、2026-10-26 確認），一律手填；離所原因是另一件事，跟出所日一起放在 departure。
// 存在 v3_stays（一隻狗一列）的只有手填的部分：沒編號的 { number: '', in, out, reason }，有編號的 { number, in, out, reason }（有離所紀錄時 out 不存）。
// 沒有 number 這個鍵的是 #639 以前（或還沒部署新版的管理網站）寫的舊格式。
// 畫面上的出入所表＝這隻狗的每個編號（入所日是前 8 碼，有離所紀錄就帶出所日與離所原因）＋沒編號的那幾筆，照入所日排（stayTable）。
// 有編號的那筆也存 in（就是編號日期），舊版程式讀到還是一筆完整的出入所紀錄。
export const STAYS_MAX = 100;
export const STAY_REASON_MAX = 40;
// 離所原因（GLOSSARY）
export const DEPARTURE_REASON_TEXT = { adopt: '認養', death: '死亡', other: '其他', unknown: '待確認' };

function validYmd(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(text + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}
// 編號前 8 碼的日期；看不出日期回 ''
export function numberDay(number) {
  const m = String(number).match(/^(\d{4})(\d{2})(\d{2})\d{2}$/);
  return m && validYmd(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
const byIn = (a, b) => (a.in || '9999').localeCompare(b.in || '9999') || (a.number || '').localeCompare(b.number || '')
  || a.out.localeCompare(b.out) || a.reason.localeCompare(b.reason);

// stored：v3_stays 存的陣列；numbers：這隻狗的所有編號；departures：[{ number, date, reason }]（這隻狗有編號的離所紀錄）
// 舊資料（ADR 0021）：舊格式（沒有 number 鍵）、入所日跟某個編號的日期一樣的，接到那個編號。
// 新格式的沒編號紀錄就算同一天也照樣是沒編號那列（ADR「其他筆維持沒有編號」）
export function stayTable(stored, numbers, departures) {
  const own = new Set(numbers), manual = new Map(), loose = [];
  for (const s of stored || []) (own.has(s.number) && !manual.has(s.number) ? manual.set(s.number, s) : loose.push(s));
  const rows = [];
  for (const s of loose) {
    const match = !Object.hasOwn(s, 'number') && numbers.find(n => !manual.has(n) && numberDay(n) && numberDay(n) === s.in);
    if (match) manual.set(match, s);
    else rows.push({ number: '', in: s.in, out: s.out || '', reason: s.reason || '' });
  }
  for (const number of numbers) {
    const left = departures.find(d => d.number === number), typed = manual.get(number);
    rows.push(left
      ? { number, in: numberDay(number), out: left.date || '', reason: typed?.reason || '', departed: true, departure: DEPARTURE_REASON_TEXT[left.reason] || DEPARTURE_REASON_TEXT.unknown }
      : { number, in: numberDay(number), out: typed?.out || '', reason: typed?.reason || '' });
  }
  return rows.sort(byIn);
}

// 出入所表 → v3_stays 要存的陣列（空陣列＝刪掉那一列）。有離所紀錄的那列只存入所原因，出所日照離所紀錄
export function storedStays(rows) {
  return rows.filter(r => !r.number || r.reason || (!r.departed && r.out))
    .map(r => ({ number: r.number || '', in: r.in, out: r.departed ? '' : r.out, reason: r.reason }));
}

// 整理送來的出入所表；before 是 { numbers, currentNumbers, departures }，today 是台灣日期。
// 回 { rows（跟 stayTable 同樣子）, numbers（存檔後這隻狗的編號）} 或 { error }；刪了不能刪的編號另帶 conflict: true（409）
export function cleanStayTable(value, before, today) {
  if (!Array.isArray(value) || value.length > STAYS_MAX) return { error: `出入所紀錄格式不對（最多 ${STAYS_MAX} 筆）` };
  const current = before.currentNumbers.filter(n => numberDay(n)).sort().at(-1);
  const stored = [], numbers = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Object.keys(row).some(k => !['number', 'in', 'out', 'reason', 'departed', 'departure'].includes(k))) return { error: '出入所欄位不對' };
    const number = String(row.number ?? '').replace(/\s+/g, '');
    const out = String(row.out ?? '').trim(), reason = String(row.reason ?? '').replace(/\s+/g, ' ').trim();
    const stayIn = number ? numberDay(number) : String(row.in ?? '').trim();
    if (number) {
      if (numbers.includes(number)) return { error: '編號重複了' };
      if (!before.numbers.includes(number)) {
        if (!stayIn || stayIn > today) return { error: '編號要是 10 碼數字，前 8 碼是入所日期' };
        if (current && number > current) return { error: '舊編號不能晚於目前編號' };
      }
      numbers.push(number);
      // 有離所紀錄的那筆：出所日照離所紀錄，送來的不看；入所原因照樣手填
      if (before.departures.some(d => d.number === number)) {
        if ([...reason].length > STAY_REASON_MAX) return { error: `原因最多 ${STAY_REASON_MAX} 字` };
        stored.push({ number, in: stayIn, out: '', reason });
        continue;
      }
    } else if (!validYmd(stayIn)) return { error: '日期請用 YYYY-MM-DD' };
    if (out && !validYmd(out)) return { error: '日期請用 YYYY-MM-DD' };
    if (stayIn > today || out > today) return { error: '日期不能是未來的日子' };
    if (out && stayIn && out < stayIn) return { error: '出所日不能早於入所日' };
    if ([...reason].length > STAY_REASON_MAX) return { error: `原因最多 ${STAY_REASON_MAX} 字` };
    stored.push({ number, in: stayIn, out, reason });
  }
  if (before.currentNumbers.some(n => !numbers.includes(n))) return { error: '目前編號不能刪', conflict: true };
  // 離所紀錄（試算表「已出所」）用這個編號記，刪了出入所表就對不到那次離所
  if (before.departures.some(d => before.numbers.includes(d.number) && !numbers.includes(d.number))) return { error: '有離所紀錄的編號不能刪', conflict: true };
  return { rows: stayTable(stored, numbers, before.departures), numbers: numbers.sort() };
}

// 合併重複的狗：兩邊存的手填紀錄接在一起（一模一樣的只留一筆），照入所日排
export function joinStays(mine, theirs) {
  const seen = new Set(), out = [];
  for (const s of [...JSON.parse(mine), ...JSON.parse(theirs)]) {
    const key = JSON.stringify(s);
    if (!seen.has(key)) { seen.add(key); out.push(s); }
  }
  return JSON.stringify(out.sort((a, b) => byIn({ ...a, out: a.out || '', reason: a.reason || '' }, { ...b, out: b.out || '', reason: b.reason || '' })));
}

// 取消合併、合併後留下那隻又改過出入所表時：拿掉被併那隻的手填紀錄（一模一樣的）和牠的編號那幾筆，剩下的算留下那隻自己的。
// 回 JSON 字串，沒剩東西回 null（刪掉那一列）
export function withoutStays(mine, theirs, numbers) {
  // 只比內容：存過一次後舊格式會變成帶空 number 的新格式
  const key = s => JSON.stringify([s.number || '', s.in || '', s.out || '', s.reason || '']);
  const gone = new Set(JSON.parse(theirs).map(key));
  const left = JSON.parse(mine).filter(s => !gone.has(key(s)) && !(s.number && numbers.includes(s.number)));
  return left.length ? JSON.stringify(left) : null;
}

// 一批狗的出入所表：Map(狗 ID → 表)。where 是篩狗的條件（照 dog_id 走索引，ADR 0014）；
// 只有手填過紀錄或有離所紀錄的狗才放，只有編號的狗畫面自己用編號排出來（跟改之前的資料包一樣小）
export async function readStayTables(db, where) {
  const filter = where ? ` AND ${where}` : '';
  const [stays, numbers, departures] = await db.batch([
    db.prepare(`SELECT dog_id, stays_json FROM v3_stays WHERE 1=1${filter}`),
    db.prepare(`SELECT dog_id, number FROM v3_dog_numbers WHERE 1=1${filter}`),
    db.prepare(`SELECT dog_id, number, departed_date, reason FROM v3_dog_departures WHERE number<>''${filter}`),
  ]);
  const group = (res, map) => {
    const out = new Map();
    for (const r of res.results || []) {
      if (!out.has(r.dog_id)) out.set(r.dog_id, []);
      out.get(r.dog_id).push(map(r));
    }
    return out;
  };
  const storedOf = new Map((stays.results || []).map(r => [r.dog_id, JSON.parse(r.stays_json)]));
  const numbersOf = group(numbers, r => r.number), departuresOf = group(departures, r => ({ number: r.number, date: r.departed_date, reason: r.reason }));
  const out = new Map();
  for (const dogId of new Set([...storedOf.keys(), ...departuresOf.keys()])) {
    const table = stayTable(storedOf.get(dogId) || [], (numbersOf.get(dogId) || []).sort(), departuresOf.get(dogId) || []);
    if (table.length) out.set(dogId, table);
  }
  return out;
}

// 兩張出入所表內容一樣（送出的人改之前看到的 vs D1 現在的）；不比 departed、departure（後端照離所紀錄算的）
export function sameStays(a, b) {
  const plain = rows => (Array.isArray(rows) ? JSON.stringify(rows.map(r => [r?.number || '', r?.in ?? '', r?.out ?? '', r?.reason ?? ''])) : null);
  return plain(a) !== null && plain(a) === plain(b);
}
