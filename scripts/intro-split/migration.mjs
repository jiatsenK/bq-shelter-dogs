// 介紹搬家 migration 產生器（#665，ADR 0022）：讀 K 勾完的核對表（一列＝搬完後的一筆出入所紀錄）→ migrations/ 的 SQL。
// 「對」用表上的值，「改」用「改成的…」欄（空的就用表上的值，K 也可能直接改了表上的格子）；編號、入所日、出所日照表上寫的。
// 一隻狗的出入所表＝核對表上那隻狗的全部列（表上沒列到的編號照舊）。檢查照 worker/src/stays.js 的 cleanStayTable，存法照 storedStays。
// 介紹、離所時的介紹改成剩下的字（多半清空）。只寫有變的狗；每隻先記編輯紀錄（改前的原文從 D1 讀，SQL 檔裡不出現原文，地址不會進公開 repo），再寫資料。
// 每句都帶「這隻狗還是核對表那時的樣子」的條件：核對表之後被改過的狗整隻跳過，不會蓋掉別人的修改。
// 觸發器（packs_*、dog_edit_*）會讓資料包版本與每隻狗的編輯版本加 1，網站會重讀，這是要的。
// 用法：node scripts/intro-split/migration.mjs --csv .scratch/intro-split/checklist.csv --out migrations/0010_intro_split.sql [--offline]
//   預設會重讀正式 D1（只送 SELECT）跟 snapshot.json 比，有狗在核對表之後被改過就停；--offline 只用 snapshot.json。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { stayTable, storedStays, cleanStayTable, numberDay } from '../../worker/src/stays.js';
import { splitStatements } from '../compact-schema.mjs';
import { parseCsv, decodeCsv, CHOICES, ID_COLUMN, NO_NUMBER } from './csv.mjs';
import { chars, suggestDog } from './suggest.mjs';
import { readSnapshot } from './snapshot.mjs';
import { DEFAULT_DIR } from './checklist.mjs';

export const taiwanToday = (now = new Date()) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
// Excel 存回來的日期可能是 2017/9/23
export function normalDay(text) {
  const m = String(text || '').trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : String(text || '').trim();
}

// SQL 字串：分號、連續的減號拆開接，scripts/compact-schema.mjs 的 splitStatements（測試）和 wrangler 都切得對
export function sqlText(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''").replace(/;/g, "'||char(59)||'").replace(/-(?=-)/g, "-'||'")}'`;
}

// K 勾的結果 → 每隻狗要改成什麼。
// 回 { plans: [{ dog, intro?, stays?, lasts }], errors（有就整份不產生）, skipped（「對嗎」有空白、先不寫的狗）, cantChange（K 改了但這裡改不了的，要另外處理）}
export function planChanges(snapshot, csvRows, today) {
  const errors = [], skipped = [], cantChange = [], byDog = new Map();
  const dogs = new Map(snapshot.dogs.map(d => [d.dogId, d]));
  for (const r of csvRows) {
    const id = r[ID_COLUMN];
    const at = `第 ${r.line} 列（${r.狗名 || dogs.get(id)?.name || id}${r.編號 && r.編號 !== NO_NUMBER ? ` ${r.編號}` : ''}）`;
    if (!dogs.has(id)) { errors.push(`${at}：最右邊那欄被改過，找不到這隻狗`); continue; }
    if (r.對嗎 && !CHOICES.includes(r.對嗎)) { errors.push(`${at}：「對嗎」要填 ${CHOICES.join('、')}，或空著（這隻先不寫）`); continue; }
    const fix = r.對嗎 === '不對' || r.對嗎 === '改';
    const pick = (fixed, own) => (fix && fixed ? fixed : own).replace(/\s+/g, ' ').trim();
    const row = { choice: r.對嗎, number: r.編號 === NO_NUMBER ? '' : r.編號.replace(/\s+/g, ''), in: normalDay(r.入所日), out: normalDay(r.出所日),
      reason: pick(r.改成的入所原因, r.入所原因), outReason: pick(r.改成的離所原因, r.離所原因), at };
    if (!byDog.has(id)) byDog.set(id, []);
    byDog.get(id).push(row);
  }
  const plans = [];
  for (const [dogId, list] of byDog) {
    const dog = dogs.get(dogId), problems = [];
    if (list.some(r => !r.choice)) { skipped.push(dog.name); continue; }
    const numbers = [...dog.numbers].sort();
    const departures = dog.departures.filter(d => d.number).map(d => ({ number: d.number, date: d.date, reason: d.reason }));
    const stored = dog.stays ? JSON.parse(dog.stays) : [];
    const before = stayTable(stored, numbers, departures);
    const rows = [];
    for (const r of list) {
      if (r.number && !numbers.includes(r.number)) { problems.push(`${r.at}：這隻狗沒有這個編號（沒有編號的請寫「${NO_NUMBER}」）`); continue; }
      // 重複的狗：這筆不寫。編號那筆刪不掉（編號由主清單管），照舊留著
      if (r.choice === '重複的狗') { if (r.number) cantChange.push(`${r.at}：有編號的那筆不能在這裡刪，照舊留著（重複的狗請在管理網站合併）`); continue; }
      if (r.number && r.in !== numberDay(r.number)) { problems.push(`${r.at}：有編號的入所日就是編號前 8 碼（${numberDay(r.number)}），不能改`); continue; }
      const left = before.find(b => b.departed && b.number === r.number);
      if (left) {
        // 有離所紀錄那筆：離所日、離所原因照離所紀錄（ADR 0021），這裡只寫入所原因
        if (r.out !== left.out) cantChange.push(`${r.at}：離所日照離所紀錄（${left.out || '空白'}），這裡改不了；要改請到管理網站出入所表（表上寫 ${r.out || '空白'}）`);
        if (r.outReason !== left.departure) cantChange.push(`${r.at}：離所原因照離所紀錄（「${left.departure}」），這裡改不了（表上寫「${r.outReason}」）`);
        rows.push({ number: r.number, in: r.in, out: left.out, reason: r.reason, departed: true, departure: left.departure });
      } else rows.push({ number: r.number, in: r.in, out: r.out, reason: r.reason, outReason: r.outReason });
    }
    // 表上沒列到的編號照舊（編號不能刪）
    for (const b of before.filter(b => b.number && !rows.some(r => r.number === b.number))) rows.push(b);
    const clean = problems.length ? null : cleanStayTable(rows, { numbers, currentNumbers: dog.mainNumber ? [dog.mainNumber] : [], departures }, today);
    if (clean?.error) problems.push(`${dog.name}：${clean.error}`);
    if (problems.length) { errors.push(...problems); continue; }
    const plan = { dog, lasts: [] };
    const canon = s => storedStays(stayTable(s, numbers, departures));
    const next = canon(storedStays(clean.rows));
    if (JSON.stringify(next) !== JSON.stringify(canon(stored))) plan.stays = { before: stored.length ? before : null, after: stayTable(next, numbers, departures), json: JSON.stringify(next) };
    const left = suggestDog(dog);
    if (dog.intro && left.intro !== dog.intro) plan.intro = left.intro;
    for (const l of left.lasts) if (l.text !== (dog.departures.find(p => p.number === l.number).lastIntro || '')) plan.lasts.push(l);
    if (plan.intro !== undefined || plan.stays || plan.lasts.length) plans.push(plan);
  }
  return { plans, errors, skipped, cantChange };
}

// 原文的條件：有地址那句時只比前面那段＋總字數，SQL 檔裡不出現地址
const ADDRESS = /[，,]\s*(捕獲地址|拾獲地點|拾獲地址|捕獲地點)/;
function textIs(table, column, where, text) {
  if (text === null || text === undefined) return `NOT EXISTS(SELECT 1 FROM ${table} WHERE ${where})`;
  const cut = String(text).search(ADDRESS);
  if (cut < 0) return `EXISTS(SELECT 1 FROM ${table} WHERE ${where} AND ${column}=${sqlText(text)})`;
  const head = String(text).slice(0, cut);
  return `EXISTS(SELECT 1 FROM ${table} WHERE ${where} AND length(${column})=${chars(text)} AND substr(${column},1,${chars(head)})=${sqlText(head)})`;
}

const AT = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const LOG = 'INSERT INTO v3_edit_log(at,editor_code,editor_name,kind,dog_id,dog_number,before_json,after_json)';
const LAST_LABEL = '（離所時的介紹）';

// 一隻狗的 SQL：先記編輯紀錄，再照「出入所紀錄 → 離所時的介紹 → 介紹」寫；每句的條件是「寫過的已經是新的、還沒寫的還是原本的」
export function dogStatements({ dog, intro, stays, lasts }) {
  const id = sqlText(dog.dogId), num = sqlText(dog.mainNumber || dog.numbers.at(-1) || '');
  const parts = [];
  if (stays) parts.push({
    orig: dog.stays === null ? `NOT EXISTS(SELECT 1 FROM v3_stays WHERE dog_id=${id})` : `EXISTS(SELECT 1 FROM v3_stays WHERE dog_id=${id} AND stays_json=${sqlText(dog.stays)})`,
    next: `EXISTS(SELECT 1 FROM v3_stays WHERE dog_id=${id} AND stays_json=${sqlText(stays.json)})`,
    write: g => `INSERT INTO v3_stays(dog_id,stays_json) SELECT ${id},${sqlText(stays.json)} WHERE ${g} ON CONFLICT(dog_id) DO UPDATE SET stays_json=excluded.stays_json`,
  });
  for (const l of lasts) {
    const where = `dog_id=${id} AND number=${sqlText(l.number)}`;
    parts.push({
      orig: textIs('v3_dog_departures', 'last_intro', where, dog.departures.find(p => p.number === l.number).lastIntro),
      next: `EXISTS(SELECT 1 FROM v3_dog_departures WHERE ${where} AND COALESCE(last_intro,'')=${sqlText(l.text)})`,
      write: g => `UPDATE v3_dog_departures SET last_intro=${sqlText(l.text)} WHERE ${where} AND ${g}`,
    });
  }
  if (intro !== undefined) parts.push({
    orig: textIs('v3_intros', 'intro', `dog_id=${id}`, dog.intro),
    next: intro ? `EXISTS(SELECT 1 FROM v3_intros WHERE dog_id=${id} AND intro=${sqlText(intro)})` : `NOT EXISTS(SELECT 1 FROM v3_intros WHERE dog_id=${id})`,
    write: g => (intro ? `UPDATE v3_intros SET intro=${sqlText(intro)} WHERE dog_id=${id} AND ${g}` : `DELETE FROM v3_intros WHERE dog_id=${id} AND ${g}`),
  });
  const guard = done => [`EXISTS(SELECT 1 FROM v3_dogs WHERE dog_id=${id})`, ...parts.map((p, i) => (i < done ? p.next : p.orig))].join(' AND ');
  const g0 = guard(0), out = [];
  const json = v => (v === null || v === '' ? 'NULL' : sqlText(JSON.stringify(v)));
  if (intro !== undefined) out.push(`${LOG} SELECT ${AT},'','管理者','intro',${id},${num},(SELECT json_quote(intro) FROM v3_intros WHERE dog_id=${id}),${json(intro)} WHERE ${g0}`);
  for (const l of lasts) {
    const dep = dog.departures.find(p => p.number === l.number);
    // 跟介紹一樣、一起改成一樣的，介紹那筆紀錄就夠了
    if (intro !== undefined && dep.lastIntro === dog.intro && l.text === intro) continue;
    out.push(`${LOG} SELECT ${AT},'','管理者','intro',${id},${sqlText(l.number)},(SELECT json_quote(${sqlText(LAST_LABEL)}||last_intro) FROM v3_dog_departures WHERE dog_id=${id} AND number=${sqlText(l.number)}),${l.text ? sqlText(JSON.stringify(LAST_LABEL + l.text)) : 'NULL'} WHERE ${g0}`);
  }
  if (stays) out.push(`${LOG} SELECT ${AT},'','管理者','stays',${id},${num},${json(stays.before)},${json(stays.after)} WHERE ${g0}`);
  parts.forEach((p, i) => out.push(p.write(guard(i))));
  return out;
}

export function buildMigration(plans, { takenAt = '' } = {}) {
  const head = [
    '-- 介紹搬家（#665，ADR 0022）：K 勾完的核對表 → 出入所紀錄的入所原因；介紹、離所時的介紹改成剩下的（只寫狗自己）。',
    '-- 由 scripts/intro-split/migration.mjs 產生，不要手改；原文不寫在這裡，改前的內容在編輯紀錄（v3_edit_log，編輯者「管理者」）。',
    `-- 核對表資料時間：${takenAt}。核對表之後被改過的狗，每句的條件不成立就整隻跳過。`,
    `-- ${plans.length} 隻狗：出入所紀錄 ${plans.filter(p => p.stays).length}、介紹 ${plans.filter(p => p.intro !== undefined).length}、離所時的介紹 ${plans.reduce((n, p) => n + p.lasts.length, 0)}。`,
  ];
  const body = plans.flatMap(p => [`-- ${p.dog.name.replace(/[\r\n]/g, ' ')}`, ...dogStatements(p).map(s => s + ';')]);
  return [...head, ...body, ''].join('\n');
}

// 預演：照 db/compact-schema.sql 建記憶體庫、放進快照，跑一次 migration，算寫了幾列（含觸發器；D1 另計索引，實際會再多一點）
export function preview(snapshot, sql) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const s of splitStatements(readFileSync(fileURLToPath(new URL('../../db/compact-schema.sql', import.meta.url)), 'utf8'))) db.exec(s);
    const ins = (sql, ...v) => db.prepare(sql).run(...v);
    snapshot.dogs.forEach((d, i) => {
      ins('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)', d.dogId, d.name);
      for (const n of d.numbers) ins('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)', n, d.dogId);
      if (d.onMain) ins('INSERT INTO v3_sheet_main(row_index,dog_id,number,name) VALUES(?,?,?,?)', i + 2, d.dogId, d.mainNumber, d.name);
      if (d.intro !== null) ins('INSERT INTO v3_intros(dog_id,intro) VALUES(?,?)', d.dogId, d.intro);
      if (d.stays !== null) ins('INSERT INTO v3_stays(dog_id,stays_json) VALUES(?,?)', d.dogId, d.stays);
      for (const p of d.departures) ins('INSERT INTO v3_dog_departures(dog_id,number,name,departed_date,reason,last_intro) VALUES(?,?,?,?,?,?)', d.dogId, p.number, p.name, p.date || null, p.reason, p.lastIntro);
    });
    const total = () => Number(db.prepare('SELECT total_changes() n').get().n);
    const start = total();
    let statements = 0, skipped = 0;
    for (const s of splitStatements(sql)) {
      statements++;
      if (!Number(db.prepare(s).run().changes)) skipped++;
    }
    const count = t => Number(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
    return { statements, skipped, rowsWritten: total() - start, editLog: count('v3_edit_log'), db };
  } catch (e) { db.close(); throw e; }
}

// 正式 D1 現在的樣子跟核對表那時不一樣的狗（名字）
export function changedDogs(then, now, dogIds) {
  const pick = d => d && JSON.stringify([d.intro, d.stays, d.numbers, d.departures.map(p => [p.number, p.lastIntro, p.date]), d.events]);
  const nowById = new Map(now.dogs.map(d => [d.dogId, d]));
  return then.dogs.filter(d => dogIds.has(d.dogId) && pick(d) !== pick(nowById.get(d.dogId))).map(d => d.name);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ''; };
  const csvPath = arg('--csv') || join(DEFAULT_DIR, 'checklist.csv');
  const snapshot = JSON.parse(readFileSync(arg('--snapshot') || join(DEFAULT_DIR, 'snapshot.json'), 'utf8'));
  const csvRows = parseCsv(decodeCsv(readFileSync(csvPath)));
  const { plans, errors, skipped, cantChange } = planChanges(snapshot, csvRows, taiwanToday());
  if (errors.length) { console.error(`核對表有 ${errors.length} 個問題，沒有產生 migration：\n${errors.join('\n')}`); process.exit(1); }
  if (!process.argv.includes('--offline')) {
    const changed = changedDogs(snapshot, readSnapshot(), new Set(plans.map(p => p.dog.dogId)));
    if (changed.length) { console.error(`這些狗在核對表之後被改過，請重產核對表再勾：${changed.join('、')}`); process.exit(1); }
  }
  const sql = buildMigration(plans, { takenAt: snapshot.takenAt });
  const result = preview(snapshot, sql);
  result.db.close();
  console.log(`預演：${plans.length} 隻狗、${result.statements} 句，會寫 ${result.rowsWritten} 列（含觸發器的版本號；跳過 ${result.skipped} 句）`);
  if (skipped.length) console.log(`「對嗎」有空白、這次不寫的狗（${skipped.length} 隻）：${skipped.join('、')}`);
  if (cantChange.length) console.log(`這些改不了（${cantChange.length} 筆，要另外處理）：\n${cantChange.join('\n')}`);
  const out = arg('--out');
  if (out) { writeFileSync(out, sql); console.log(`寫好 ${out}`); }
  else console.log('沒給 --out，只預演不寫檔');
}
