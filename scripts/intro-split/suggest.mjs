// 介紹搬家核對表的建議值（#665，ADR 0022）：每隻狗的介紹 → 搬完後的出入所紀錄（每筆的入所原因、離所原因）＋給 K 看的白話說明。
// 只是建議：不從文字自動決定日期（ADR 0011），每一筆都要 K 勾過才寫（migration.mjs）。
// 搬法（甲）：那次入所整句去掉日期；「捕獲地址是…」「拾獲地點是…」那句整句拿掉；句中地區名稱照留。
import { numberDay, stayTable, STAY_REASON_MAX } from '../../worker/src/stays.js';

// 舊資料寫「整修移所」的那三天（墨西哥、黑森林 2017-09-05，蘇打 2017-12-25，錢錢 2018-01-29）
const MOVE_DAYS = new Set(['2017-09-05', '2017-12-25', '2018-01-29']);
const MOVE_REASON = '整修移所';
// 一句裡有這些字才算入所經過（搬走）；都沒有的留在介紹
const INTAKE_WORDS = /入所|轉來|轉所|拾獲|通報|棄養|退回|退養|迷路|流浪|捕捉|收容所|認養|沒入/;
const RETURN_WORDS = /退回|退養/;
const ADDRESS_CLAUSE = /^(捕獲地址|拾獲地點|拾獲地址|捕獲地點)/;
const DATE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日|(\d{4})\s*年\s*(\d{1,2})\s*月|(\d{4})\s*年|(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;

const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const validDay = s => { const t = new Date(s + 'T00:00:00Z'); return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === s; };
export const chars = s => [...String(s || '')].length;
// 2017-09-23 → 2017/9/23（給人看）
export const showDay = day => (day ? day.split('-').map((x, i) => (i ? String(Number(x)) : x)).join('/') : '');

// 一段裡的日期：[{ day（完整才有）, at }]；只有月日的接前一個年份
export function datesIn(text) {
  const out = [];
  let year = '';
  for (const m of String(text).matchAll(DATE)) {
    if (m[1]) { year = m[1]; out.push({ day: validDay(ymd(m[1], m[2], m[3])) ? ymd(m[1], m[2], m[3]) : '', at: m.index }); }
    else if (m[4] || m[6]) { year = m[4] || m[6]; out.push({ day: '', year, at: m.index }); }
    else out.push({ day: year && validDay(ymd(year, m[7], m[8])) ? ymd(year, m[7], m[8]) : '', at: m.index });
  }
  return out;
}

// 一段文字 → 入所原因：去掉日期、去掉地址那句、收掉多的標點
export function cleanReason(text) {
  const clauses = String(text).replace(DATE, '').split(/[，,]/).map(c => c.trim().replace(/^[、\s]+/, ''));
  return clauses.filter(c => c && !ADDRESS_CLAUSE.test(c)).join('，').replace(/[。．.\s]+$/, '').trim();
}
const addressKind = text => String(text).split(/[，,]/).map(c => c.trim().match(ADDRESS_CLAUSE)?.[1]).find(Boolean) || '';
// 拿掉地址句之後還像地址（路、街、號）的，要 K 特別看
const looksLikeAddress = text => /\d+\s*(號|巷|弄)|[路街]\s*\d/.test(text);

// 介紹 → 段落（分號分開的每件事）
export function segmentsOf(intro) {
  return String(intro || '').split(/[；;]/).map(s => s.trim()).filter(Boolean).map((text, i) => {
    const dates = datesIn(text);
    return { i, text, lead: dates.find(d => d.at <= 1) || null, dates, intake: INTAKE_WORDS.test(text), reason: cleanReason(text) };
  });
}
// 搬走經過後介紹剩下的字（甲：入所時的狀況整句搬走，所以多半是空的）
export const introLeft = intro => segmentsOf(intro).filter(s => !s.intake).map(s => s.text).join('；');

const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
// 日期接近某個編號（差一年同月日、或差 3 天內）：多半是打錯（ADR 0011 的百吉、土撥鼠）。回 [編號, 說明]
function nearNumber(day, numbers) {
  for (const n of numbers) {
    const nd = numberDay(n);
    if (!nd) continue;
    if (Math.abs(dayDiff(day, nd)) <= 3) return [n, `差 ${Math.abs(dayDiff(day, nd))} 天`];
    if (day.slice(5) === nd.slice(5) && Math.abs(Number(day.slice(0, 4)) - Number(nd.slice(0, 4))) === 1) return [n, '差一年'];
  }
  return [];
}

// dog：{ dogId, name, intro, numbers, stays（v3_stays 的 JSON 字串或 null）, onMain, departures: [{ number, date, reason, lastIntro }], events: [{ number, date, event }] }
// 回 { records: 搬完後的出入所表（stayTable 的樣子，多帶 notes）, notes: 整隻狗的說明, intro: 剩下的介紹, lasts: [{ number, text }] }
export function suggestDog(dog) {
  const numbers = [...dog.numbers].sort();
  const stored = dog.stays ? JSON.parse(dog.stays) : [];
  const departures = dog.departures.filter(d => d.number).map(d => ({ number: d.number, date: d.date, reason: d.reason }));
  const records = stayTable(stored, numbers, departures).map(r => ({ ...r, notes: [] }));
  const notes = [];
  const used = new Set(); // 已經放了原因的編號
  const loose = day => records.find(r => !r.number && r.in === day);
  const record = (number, day) => {
    if (number) return records.find(r => r.number === number);
    const had = day && loose(day);
    if (had) return had;
    const r = { number: '', in: day, out: '', reason: '', notes: [] };
    records.push(r);
    return r;
  };
  // 放入所原因；已經手填過不一樣的就保留原本的（replace 是舊資料重放，原本填錯地方）
  const putReason = (r, value, { replace = false } = {}) => {
    if (r.reason && r.reason !== value && !replace) r.notes.push(`原本填的是「${r.reason}」，先保留；介紹寫的是「${value}」，要用介紹的請填「改」`);
    else {
      if (r.reason && r.reason !== value) r.notes.push(`原本填的是「${r.reason}」，改成介紹寫的「${value}」`);
      r.reason = value;
    }
  };

  const address = addressKind(dog.intro);
  if (address) notes.push(`拿掉了${address}`);

  const segments = segmentsOf(dog.intro).filter(s => s.intake);
  const latestFree = () => [...numbers].reverse().find(n => !used.has(n));
  for (const seg of segments) {
    const free = numbers.filter(n => !used.has(n));
    // 第二件以後寫退回的，看退回那天（最後一個日期），不是被認養那天
    const when = seg.i > 0 && RETURN_WORDS.test(seg.text) && seg.dates.at(-1)?.day ? seg.dates.at(-1) : seg.lead;
    let r;
    if (when?.day) {
      const exact = free.find(n => numberDay(n) === when.day);
      const [near, how] = exact ? [] : nearNumber(when.day, free);
      if (exact) r = record(exact);
      else if (near) { r = record(near); r.notes.push(`介紹寫 ${showDay(when.day)}，跟編號${how}，可能打錯，先放在這個編號`); }
      else {
        const had = loose(when.day);
        r = record('', when.day);
        if (!had) r.notes.push(`介紹寫 ${showDay(when.day)} 入所，但沒有這天的編號，所以多一筆沒有編號的`);
      }
    } else if (when) {
      const year = seg.dates.find(d => d.year)?.year || seg.text.match(/\d{4}/)?.[0];
      const sameYear = free.find(n => numberDay(n).startsWith(year + '-'));
      if (sameYear) { r = record(sameYear); r.notes.push(`介紹只寫 ${year} 年，先放在同一年的這個編號`); }
      else { r = record('', ''); r.notes.push(`${dog.name}只寫 ${year} 年，請填入所日`); }
    } else {
      const n = latestFree();
      r = record(n || '', '');
      r.notes.push(n ? (seg.i === 0 ? '介紹沒寫日期，先放在目前的編號' : '介紹沒寫這件事的日期，先放在最新的編號') : '介紹沒寫日期，請填入所日');
    }
    if (r.number) used.add(r.number);
    if (segments.length > 1) r.notes.push('介紹一段寫了好幾件事，拆成好幾筆，請看拆得對不對');
    else if (RETURN_WORDS.test(seg.text) && /入所/.test(seg.text)) r.notes.push('介紹同一句寫了入所和退回，請看要不要拆成兩筆');
    if (seg.dates.length > 1) r.notes.push('句子中間的日期拿掉了');
    r.fromIntro = seg.reason;
    r.seg = true;
  }

  // 舊資料：舊格式沒編號那筆的出所日剛好是某個編號的日期，原因欄其實是那次的離所原因，也是那個編號的入所原因
  const replayed = new Set();
  for (const s of stored.filter(s => !Object.hasOwn(s, 'number'))) {
    const n = numbers.find(x => numberDay(x) && numberDay(x) === s.out);
    const r = loose(s.in);
    if (!n || !r || !s.reason) continue;
    replayed.add(r);
    r.outReason = s.reason;
    r.notes.push(`「${s.reason}」改放到離所原因`);
    const next = record(n);
    if (!used.has(n)) { used.add(n); putReason(next, s.reason); next.notes.push(`「${s.reason}」是從 ${showDay(s.in)} 那筆搬過來的`); }
    else next.notes.push(`舊資料在 ${showDay(s.in)} 那筆寫的是「${s.reason}」`);
  }
  for (const r of records.filter(r => r.seg)) putReason(r, r.fromIntro, { replace: replayed.has(r) });

  // 整修移所（推測）：介紹日期比編號早、編號是整修移所那三天
  for (const r of records.filter(r => r.seg && !r.number && r.in && !r.out)) {
    const n = numbers.find(x => MOVE_DAYS.has(numberDay(x)) && numberDay(x) > r.in && !used.has(x));
    if (!n) continue;
    used.add(n);
    r.out = numberDay(n);
    r.outReason = MOVE_REASON;
    r.notes.push(`離所日和「${MOVE_REASON}」是推測的（${showDay(r.out)} 這天的舊資料都寫${MOVE_REASON}）`);
    putReason(record(n), MOVE_REASON);
    record(n).notes.push(`「${MOVE_REASON}」是推測的（${showDay(r.out)} 這天的舊資料都寫${MOVE_REASON}）`);
  }

  // 以前介紹表單的入所事件（正式庫只剩哈囉一筆）
  for (const e of dog.events.filter(e => e.event)) {
    const n = numbers.includes(e.number) ? e.number : numbers.find(x => e.date && numberDay(x) === e.date);
    const r = n ? record(n) : record('', e.date || '');
    if (r.reason && r.reason !== e.event) { r.notes.push(`以前介紹表單還記了「${e.event}」`); continue; }
    putReason(r, e.event);
    r.notes.push(`「${e.event}」來自以前介紹表單的入所事件`);
  }

  for (const r of records) {
    if (chars(r.reason) > STAY_REASON_MAX || chars(r.outReason) > STAY_REASON_MAX) r.notes.unshift(`超過 ${STAY_REASON_MAX} 字，請改短`);
    if (looksLikeAddress(r.reason)) r.notes.unshift('可能還有地址，請看一下');
    if (r.number && !r.reason && !r.departed) r.notes.push('介紹沒寫這次為什麼入所，入所原因空著');
    delete r.seg; delete r.fromIntro;
  }

  const intro = introLeft(dog.intro);
  if (intro) notes.push(`介紹還會留下：「${intro}」`);
  const lasts = [];
  for (const d of dog.departures.filter(d => d.lastIntro)) {
    const same = d.lastIntro === dog.intro;
    if (!same) notes.push('離所時存的介紹不一樣（像改寫前的原文），一起清空');
    lasts.push({ number: d.number, text: same ? intro : '' });
  }
  const order = (a, b) => (a.in || '9999').localeCompare(b.in || '9999') || (a.number || '').localeCompare(b.number || '');
  return { records: records.sort(order), notes, intro, lasts };
}
