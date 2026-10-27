// 介紹搬家核對表的建議值（#665，ADR 0022）：每隻狗的介紹原文 → 建議放哪一筆出入所紀錄、入所原因寫什麼、剩下的介紹。
// 只是建議：不從文字自動決定日期（ADR 0011），每一列都要 K 勾過才寫（migration.mjs）。
// 搬法（甲）：那次入所整句去掉日期；「捕獲地址是…」「拾獲地點是…」那句整句拿掉；句中地區名稱照留。
import { numberDay, stayTable, STAY_REASON_MAX } from '../../worker/src/stays.js';

export const KINDS = { reason: '入所原因', outReason: '離所原因', intro: '介紹', lastIntro: '離所時的介紹' };
export const NEW_STAY = '新增沒編號';
// 舊資料寫「整修移所」的那三天（#651：墨西哥、黑森林 2017-09-05，蘇打 2017-12-25，錢錢 2018-01-29）
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

// 一段裡的日期：[{ day（完整才有）, partial, at }]；只有月日的接前一個年份
export function datesIn(text) {
  const out = [];
  let year = '';
  for (const m of String(text).matchAll(DATE)) {
    if (m[1]) { year = m[1]; out.push({ day: validDay(ymd(m[1], m[2], m[3])) ? ymd(m[1], m[2], m[3]) : '', partial: false, at: m.index }); }
    else if (m[4]) { year = m[4]; out.push({ day: '', partial: true, at: m.index }); }
    else if (m[6]) { year = m[6]; out.push({ day: '', partial: true, at: m.index }); }
    else out.push({ day: year && validDay(ymd(year, m[7], m[8])) ? ymd(year, m[7], m[8]) : '', partial: !year, at: m.index });
  }
  return out;
}

// 一段文字 → 入所原因：去掉日期、去掉地址那句、收掉多的標點
export function cleanReason(text) {
  const clauses = String(text).replace(DATE, '').split(/[，,]/).map(c => c.trim().replace(/^[、\s]+/, ''));
  return clauses.filter(c => c && !ADDRESS_CLAUSE.test(c)).join('，').replace(/[。．.\s]+$/, '').trim();
}
export const hasAddress = text => String(text).split(/[，,]/).some(c => ADDRESS_CLAUSE.test(c.trim()));
// 拿掉地址句之後還像地址（路、街、號）的，要 K 特別看
const looksLikeAddress = text => /\d+\s*(號|巷|弄)|[路街]\s*\d/.test(text);

// 介紹 → 段落（分號分開的每件事）；只有日期、沒有經過的段落不算
export function segmentsOf(intro) {
  return String(intro || '').split(/[；;]/).map(s => s.trim()).filter(Boolean).map((text, i) => {
    const dates = datesIn(text);
    const lead = dates.find(d => d.at <= 1) || null;
    return { i, text, lead, dates, intake: INTAKE_WORDS.test(text), reason: cleanReason(text), address: hasAddress(text) };
  });
}

const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
// 日期接近某個編號（差一年同月日、或差 3 天內）：多半是打錯（ADR 0011 的百吉、土撥鼠）
function nearNumber(day, numbers) {
  return numbers.find(n => numberDay(n) && (Math.abs(dayDiff(day, numberDay(n))) <= 3
    || (day.slice(5) === numberDay(n).slice(5) && Math.abs(Number(day.slice(0, 4)) - Number(numberDay(n).slice(0, 4))) === 1)));
}

// dog：{ dogId, name, intro, numbers, stays（v3_stays 的 JSON 字串或 null）, onMain, departures: [{ number, date, reason, lastIntro }], events: [{ number, date, event }] }
// 回核對表的列：{ dogId, name, place, kind, target（編號或 NEW_STAY）, in, out, original, current, suggest, note }
export function suggestRows(dog) {
  const numbers = [...dog.numbers].sort();
  const stored = dog.stays ? JSON.parse(dog.stays) : [];
  const departures = dog.departures.filter(d => d.number).map(d => ({ number: d.number, date: d.date, reason: d.reason }));
  const table = stayTable(stored, numbers, departures);
  const legacy = stored.filter(s => !Object.hasOwn(s, 'number'));
  const place = dog.onMain ? '在所' : '離所';
  const rows = [];
  const base = { dogId: dog.dogId, name: dog.name, place, original: dog.intro || '' };
  const used = new Set(); // 已經有建議的出入所紀錄：編號或「沒編號:入所日」
  const keyOf = (target, day) => (target === NEW_STAY ? `${NEW_STAY}:${day}` : target);
  const rowOf = (target, day) => table.find(r => (target === NEW_STAY ? !r.number && r.in === day : r.number === target));
  const latestFree = () => [...numbers].reverse().find(n => !used.has(n));

  const segments = segmentsOf(dog.intro).filter(s => s.intake);
  for (const seg of segments) {
    const notes = [];
    let target, day = '', out = '';
    // 第二件以後寫退回的，看退回那天（最後一個日期），不是被認養那天
    const when = seg.i > 0 && RETURN_WORDS.test(seg.text) && seg.dates.at(-1)?.day ? seg.dates.at(-1) : seg.lead;
    const free = numbers.filter(n => !used.has(n));
    if (when?.day) {
      const exact = free.find(n => numberDay(n) === when.day);
      const near = !exact && nearNumber(when.day, free);
      if (exact) target = exact;
      else if (near) { target = near; notes.push(`介紹日期 ${when.day} 跟編號 ${near} 差一點，建議當成打錯、放進編號那筆`); }
      else {
        target = NEW_STAY; day = when.day;
        notes.push(rowOf(NEW_STAY, day) ? '已有這天的沒編號紀錄' : `介紹日期 ${day} 跟編號對不上，建議新增一筆沒編號的`);
      }
    } else if (when) {
      const year = seg.text.match(/(\d{4})/)?.[1];
      target = free.find(n => numberDay(n).startsWith(year + '-')) || NEW_STAY;
      notes.push(target === NEW_STAY ? '介紹日期不完整，要 K 填入所日（或改放某個編號）' : `介紹只寫 ${year} 年，建議放同一年的編號`);
    } else {
      target = latestFree() || NEW_STAY;
      notes.push(seg.i === 0 ? '沒寫日期，建議放目前編號' : '這段沒寫日期，建議放還沒用到的最新編號');
    }
    if (segments.length > 1) notes.push('介紹寫了好幾件事，要 K 看');
    else if (RETURN_WORDS.test(seg.text) && /入所/.test(seg.text)) notes.push('一段裡寫了入所和退回，要 K 看');
    if (seg.dates.length > 1 || (seg.lead === null && seg.dates.length)) notes.push('句中還有日期，已去掉，要 K 看');
    used.add(keyOf(target, day));
    rows.push({ ...base, kind: KINDS.reason, target, in: target === NEW_STAY ? day : numberDay(target), out, current: rowOf(target, day)?.reason || '', suggest: seg.reason, notes, address: seg.address });
  }

  // 舊資料重放（#651）：舊格式沒編號那筆的出所日剛好是某個編號的日期，原因欄其實是離所原因，也是那個編號的入所原因
  for (const s of legacy) {
    const n = numbers.find(x => numberDay(x) && numberDay(x) === s.out);
    const loose = table.find(r => !r.number && r.in === s.in);
    if (!n || !loose || !s.reason) continue;
    const note = `舊資料重放（#651）：原因「${s.reason}」看起來是 ${s.in} 那次的離所原因、${n} 的入所原因`;
    const mine = rows.find(r => r.kind === KINDS.reason && r.target === NEW_STAY && r.in === s.in);
    if (mine) { mine.replay = true; mine.notes.push(note + '；這筆入所原因改用介紹的寫法'); }
    rows.push({ ...base, kind: KINDS.outReason, target: NEW_STAY, in: s.in, out: s.out, current: loose.outReason || '', suggest: s.reason, notes: [note] });
    const onNumber = rows.find(r => r.kind === KINDS.reason && r.target === n);
    if (onNumber) onNumber.notes.push(note);
    else { used.add(n); rows.push({ ...base, kind: KINDS.reason, target: n, in: numberDay(n), out: '', current: rowOf(n)?.reason || '', suggest: s.reason, notes: [note] }); }
  }

  // 整修移所（推測）：介紹日期比編號早、編號是整修移所那三天，編號那筆的入所原因與沒編號那筆的離所原因建議寫整修移所
  for (const r of rows.filter(r => r.kind === KINDS.reason && r.target === NEW_STAY && r.in)) {
    const n = numbers.find(x => MOVE_DAYS.has(numberDay(x)) && numberDay(x) > r.in && !used.has(x));
    if (!n) continue;
    used.add(n);
    const note = `推測：${numberDay(n)} 是整修移所那天（舊資料同一天的都寫整修移所），出所日也建議填這天`;
    r.out = numberDay(n);
    rows.push({ ...base, kind: KINDS.outReason, target: NEW_STAY, in: r.in, out: r.out, current: '', suggest: MOVE_REASON, notes: [note] });
    rows.push({ ...base, kind: KINDS.reason, target: n, in: numberDay(n), out: '', current: rowOf(n)?.reason || '', suggest: MOVE_REASON, notes: [note] });
  }

  // 介紹表單的入所事件（#285，正式庫只剩哈囉一筆）
  for (const e of dog.events.filter(e => e.event)) {
    const target = numbers.includes(e.number) ? e.number : numbers.find(n => e.date && numberDay(n) === e.date) || NEW_STAY;
    const day = target === NEW_STAY ? e.date : numberDay(target);
    const note = `來自介紹表單的入所事件（${e.date || '日期未確認'}）`;
    const same = rows.find(r => r.kind === KINDS.reason && r.target === target && (target !== NEW_STAY || r.in === day));
    if (same) { same.notes.push(`${note}：「${e.event}」`); continue; }
    used.add(keyOf(target, day));
    rows.push({ ...base, kind: KINDS.reason, target, in: day, out: '', current: rowOf(target, day)?.reason || '', suggest: e.event, notes: [note] });
  }

  // 已手填過的入所原因不覆蓋：建議值改成保留原本的，介紹的寫法放在注意，K 要換再填改成
  for (const r of rows) {
    if (r.current && r.current !== r.suggest && !r.replay) {
      r.notes.unshift(`已手填「${r.current}」，建議保留；要換成「${r.suggest}」請勾改成`);
      r.suggest = r.current;
    }
    if (chars(r.suggest) > STAY_REASON_MAX) r.notes.unshift(`超過 ${STAY_REASON_MAX} 字，要 K 改短`);
    if (looksLikeAddress(r.suggest)) r.notes.unshift('可能還有地址，要 K 看');
  }

  // 剩下的介紹：沒有入所經過的段落留著（甲：入所時的狀況整句搬走，所以多半是空的）
  const left = segmentsOf(dog.intro).filter(s => !s.intake).map(s => s.text).join('；');
  if (dog.intro) rows.push({ ...base, kind: KINDS.intro, target: '', in: '', out: '', current: dog.intro, suggest: left, notes: left ? ['這段沒有入所經過，建議留在介紹'] : [] });
  for (const d of dog.departures.filter(d => d.lastIntro)) {
    const same = d.lastIntro === dog.intro;
    const lastLeft = same ? left : segmentsOf(d.lastIntro).filter(s => !s.intake).map(s => s.text).join('；');
    rows.push({ ...base, original: d.lastIntro, kind: KINDS.lastIntro, target: d.number, in: '', out: '', current: d.lastIntro, suggest: lastLeft,
      notes: same ? ['跟介紹一樣'] : ['離所時的介紹跟現在的介紹不一樣（可能是改寫前的原文，有狗自己的描述），要留什麼請勾改成'] });
  }
  return rows.map(({ notes, replay, ...r }) => ({ ...r, note: notes.join('；') }));
}

// 要 K 特別看的列（摘要用）
export const needsLook = r => /要 K|超過|對不上|不完整|差一點|舊資料重放|推測|不一樣|已手填|入所事件/.test(r.note);
