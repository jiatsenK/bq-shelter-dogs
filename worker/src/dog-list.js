// 狗清單有人編輯才同步（#501，ADR 0018 第 5–7 點）：取代每 10 分鐘叫 GitHub Actions 讀整張表（ADR 0012）。
// - GAS 編輯觸發只送受影響的列：主清單、已出所的狗（編號＋那一列）、常遛狗群的一欄、異動紀錄整段；Worker 只改那幾隻、只寫有變的欄。
// - 換籠、離所看狗新出現在哪裡：出現在「已出所」就記離所並從主清單移走；又出現在主清單就不算離所。
// - 每天三次保險掃描：GAS 送每個單位的指紋，Worker 回不一樣的（D1 還沒有指紋就全部要），GAS 再分批只送那幾個。
// - D1 有、試算表沒有的只列出來（v3_sync_state 的 dog_list_extra），不自動刪。
// 指紋只是「上次收過哪一版」，存在 v3_sync_state 一列 JSON；遺失只會讓下一次掃描多送幾列，不影響資料。
import { splitNames } from './sheet-read.js';
import { walkerCode, logEdit } from './editlog.js';
import { judgeDeparture, nameKey } from './departure-rules.js';
import { taiwanYmd } from './sync-plan.js';
import { SYNCED_AT_KEY } from './compact.js';
import { linkIdentityName } from './identity.js';

export const DOG_LIST_ROWS_MAX = 10; // 每列最多 3–4 次 D1 往返，守住每次呼叫 50 次查詢
const FP_KEY = 'dog_list_fp', EXTRA_KEY = 'dog_list_extra';
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const dogKey = dog => dog.id || `名:${dog.name}`;
export function unitKey(row) {
  if (row.sheet === 'main' || row.sheet === 'departed') return `${row.sheet}:${dogKey(row.dog)}`;
  if (row.sheet === 'groups') return `groups:${row.column}`;
  if (row.sheet === 'notes') return 'notes';
  return '';
}
const text = v => String(v ?? '').trim();
const cleanDog = dog => ({ id: text(dog && dog.id), name: text(dog && dog.name) });
const state = async (db, key) => (await db.prepare('SELECT value FROM v3_sync_state WHERE key=?').bind(key).first('value')) || '';
const putState = (db, key, value) => db.prepare('INSERT INTO v3_sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, value);
const readFp = async db => { try { return JSON.parse(await state(db, FP_KEY) || '{}'); } catch { return {}; } };
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const findMain = (list, dog) => list.find(m => (dog.id ? m.number === dog.id : m.number === '' && m.name === dog.name));
const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

// 「誰遛的」→ 代號
// 代號是名字單向算出來的：D1 還沒有對照的新名字順便記進志工名單，/walkers 才換得回名字（#519，2026-10-24 實測「123」）
async function walkersOf(walker, env, db) {
  const names = splitNames(walker);
  const key = env && env.WALKER_KEY ? String(env.WALKER_KEY) : '';
  const pairs = key ? await Promise.all(names.map(async n => [n, await walkerCode(n, key)])) : [];
  const codes = [...new Set(pairs.map(p => p[1]).filter(Boolean))];
  if (db && codes.length) {
    const known = new Set((await db.prepare(`SELECT code FROM v3_identity_names WHERE code IN (${codes.map(() => '?').join(',')})`).bind(...codes).all()).results.map(r => r.code));
    for (const [n, c] of pairs) {
      if (!c || known.has(c)) continue;
      known.add(c);
      try { await linkIdentityName(db, n, c); } catch (e) { console.error('v3_identity_names', e); } // 同名多個身分（409）不猜，只是換不回名字
    }
  }
  return { codes, keyed: !!key };
}

// 溜狗紀錄一隻狗一天一組（同一天以最後一次為準，跟 importCompactProfiles 合併的結果一樣）
function walkDay(db, dogId, date, dog, codes) {
  return [
    db.prepare('DELETE FROM v3_walks WHERE dog_id=? AND walk_date=?').bind(dogId, date),
    ...(codes.length ? codes : [null]).map((code, i) => db.prepare('INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) VALUES(?,?,?,?,?,?)')
      .bind(dogId, date, i, code, dog.id, dog.name)),
  ];
}
const dropMainRow = (db, rowIndex) => ['v3_sheet_main_walkers', 'v3_sheet_main']
  .map(t => db.prepare(`DELETE FROM ${t} WHERE row_index=?`).bind(rowIndex));
const dropDeparture = (db, number) => [db.prepare('DELETE FROM v3_departure_items WHERE number=?').bind(number), db.prepare('DELETE FROM v3_departures WHERE number=?').bind(number)];

async function applyMain(db, row, list, env, fp) {
  const dog = cleanDog(row.dog), cage = text(row.cage), note = text(row.note).replace(/\r\n?/g, '\n');
  // 犬隻資料列一定有犬名和籠位；表尾提示文字不算狗（同 parseMainList）
  if (!dog.name || !cage || dog.name === '犬名') return false;
  const date = YMD.test(text(row.date)) ? text(row.date) : null;
  const { codes, keyed } = await walkersOf(row.walker, env, db);
  let old = findMain(list, dog);
  const out = [];
  let returnedLog = null;
  // 新增狗常先打名字、後補編號：主清單上同名沒編號的那隻就是牠，補上編號，不另建一隻（2026-10-24 驗收時多出一隻沒編號的 TEST）
  const unnumbered = !old && dog.id && list.find(m => m.number === '' && m.name === dog.name);
  if (unnumbered && !(await db.prepare('SELECT 1 FROM v3_dog_numbers WHERE number=?').bind(dog.id).first())) {
    old = unnumbered;
    out.push(db.prepare('UPDATE v3_sheet_main SET number=? WHERE row_index=?').bind(dog.id, old.row_index),
      db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(dog.id, old.dog_id),
      db.prepare("UPDATE v3_walks SET dog_number=? WHERE dog_id=? AND dog_number=''").bind(dog.id, old.dog_id));
    old.number = dog.id;
    delete fp[`main:名:${dog.name}`];
  }
  if (old) {
    const oldCodes = (await db.prepare('SELECT walker_code FROM v3_sheet_main_walkers WHERE row_index=? ORDER BY position').bind(old.row_index).all()).results.map(r => r.walker_code);
    const codesChanged = keyed && !sameList(oldCodes, codes);
    const next = { name: dog.name, cage, note, walked_date: date, walker: text(row.walker) };
    const changed = Object.keys(next).filter(c => next[c] !== old[c]);
    if (changed.length) out.push(db.prepare(`UPDATE v3_sheet_main SET ${changed.map(c => `${c}=?`).join(',')} WHERE row_index=?`).bind(...changed.map(c => next[c]), old.row_index));
    if (next.name !== old.name) out.push(db.prepare('UPDATE v3_dogs SET name=? WHERE dog_id=?').bind(dog.name, old.dog_id));
    if (codesChanged) {
      out.push(db.prepare('DELETE FROM v3_sheet_main_walkers WHERE row_index=?').bind(old.row_index));
      codes.forEach((code, i) => out.push(db.prepare('INSERT INTO v3_sheet_main_walkers VALUES(?,?,?)').bind(old.row_index, i, code)));
    }
    // 日期變新、或同一天換人才記一筆；清空不記也不刪（同 newWalks）
    // 改回較早的日子（K 2026-10-24，例如 Ctrl+Z）：那天照表上名單重寫，表上不再寫的較新那天刪掉
    if (date && (!old.walked_date || date > old.walked_date || (date === old.walked_date && codesChanged))) out.push(...walkDay(db, old.dog_id, date, dog, codes));
    else if (date && date < old.walked_date) out.push(db.prepare('DELETE FROM v3_walks WHERE dog_id=? AND walk_date=?').bind(old.dog_id, old.walked_date), ...walkDay(db, old.dog_id, date, dog, codes));
    Object.assign(old, next);
  } else {
    let dogId = dog.id
      ? await db.prepare('SELECT dog_id FROM v3_dog_numbers WHERE number=?').bind(dog.id).first('dog_id')
      : await db.prepare("SELECT dog_id FROM v3_walks WHERE dog_number='' AND dog_name=? LIMIT 1").bind(dog.name).first('dog_id');
    let returned = null;
    if (!dogId && dog.id) returned = await returnedDog(db, dog, list);
    if (returned) {
      dogId = returned.dog_id;
      returnedLog = { editor: { name: '試算表（自動認回所）', code: '' }, kind: 'former', dogId, dogNumber: dog.id, before: { number: returned.number }, after: { number: dog.id, formerNumber: returned.number } };
      out.push(db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(dog.id, dogId));
    } else if (!dogId) {
      dogId = newId();
      out.push(db.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(dogId, dog.name));
      if (dog.id) out.push(db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(dog.id, dogId));
    } else out.push(db.prepare('UPDATE v3_dogs SET name=? WHERE dog_id=? AND name<>?').bind(dog.name, dogId, dog.name));
    const rowIndex = Math.max(-1, ...list.map(m => m.row_index)) + 1;
    out.push(db.prepare('INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage,note,walked_date,walker) VALUES(?,?,?,?,?,?,?,?)')
      .bind(rowIndex, dogId, dog.id, dog.name, cage, note, date, text(row.walker)));
    codes.forEach((code, i) => out.push(db.prepare('INSERT INTO v3_sheet_main_walkers VALUES(?,?,?)').bind(rowIndex, i, code)));
    // 又回到主清單（例：誤移、退養回來）不算離所；換了新編號回來的，舊離所註明用哪個編號回所
    if (dog.id) out.push(...dropDeparture(db, dog.id),
      db.prepare("UPDATE v3_departures SET returned_number=? WHERE dog_id=? AND number<>? AND COALESCE(returned_number,'')<>?").bind(dog.id, dogId, dog.id, dog.id));
    if (date && !(await db.prepare('SELECT 1 FROM v3_walks WHERE dog_id=? AND walk_date=? LIMIT 1').bind(dogId, date).first())) out.push(...walkDay(db, dogId, date, dog, codes));
    list.push({ row_index: rowIndex, dog_id: dogId, number: dog.id, name: dog.name, cage, note, walked_date: date });
  }
  if (out.length) await db.batch(out);
  if (returnedLog) await logEdit(db, returnedLog);
  return out.length > 0;
}

// 狗回所會拿新編號，沒人會在網站上連舊編號（K 2026-10-24）：離所紀錄裡剛好一筆同名、主清單上沒別的同名，就是同一隻。
// 認錯可在網站「舊編號」拆開（編輯紀錄記為系統自動）。同名多筆不猜，當新狗。
async function returnedDog(db, dog, list) {
  if (list.some(m => m.name === dog.name)) return null;
  const found = (await db.prepare('SELECT number,dog_id FROM v3_departures WHERE name=? LIMIT 2').bind(dog.name).all()).results;
  return found.length === 1 ? found[0] : null;
}

async function applyDeparted(db, row, list, now, fp) {
  const dog = cleanDog(row.dog);
  if (!dog.name && !dog.id) return false;
  const todayYmd = taiwanYmd(now), today = new Date(`${todayYmd}T00:00:00`);
  const texts = (Array.isArray(row.texts) ? row.texts : []).map(text).filter(Boolean);
  const dates = (Array.isArray(row.dates) ? row.dates : []).map(text).filter(d => YMD.test(d) && d <= todayYmd);
  const departDate = dates.length ? new Date(`${dates[dates.length - 1]}T00:00:00`) : null;
  const judged = judgeDeparture(dog, [{ texts, departDate }], today);
  // 沒編號的狗記不了離所（v3_departures 以編號為主鍵）：不從主清單移走，免得資料不見；保險掃描照常列出
  if (!dog.id) return false;
  const old = findMain(list, dog);
  const out = [];
  if (old) {
    {
      const former = (await db.prepare('SELECT number FROM v3_dog_numbers WHERE dog_id=? AND number<>? ORDER BY number').bind(old.dog_id, dog.id).all()).results.map(r => r.number);
      const groups = (await db.prepare('SELECT DISTINCT b.name FROM v3_sheet_groups a JOIN v3_sheet_groups b ON a.column_index=b.column_index WHERE a.name=? AND b.name<>? ORDER BY b.column_index,b.row_index').bind(old.name, old.name).all()).results.map(r => r.name);
      // 性別在 v3_dogs、入所介紹在 v3_intros（#250）；主清單不再存這兩欄（#557）
      const extra = await db.prepare('SELECT d.sex, i.intro FROM v3_dogs d LEFT JOIN v3_intros i USING(dog_id) WHERE d.dog_id=?').bind(old.dog_id).first();
      out.push(...dropDeparture(db, dog.id));
      out.push(db.prepare(`INSERT INTO v3_departures(number,dog_id,name,departed_date,date_source,seen_date,reason,matched,last_number,last_name,last_cage,last_walked_date,last_note,last_sex,last_intro)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(dog.id, old.dog_id, old.name, judged.date || todayYmd, judged.date ? judged.dateSource : 'seen', todayYmd,
        judged.reason, judged.matched || '', dog.id, old.name, old.cage, old.walked_date, old.note, extra?.sex || '', extra?.intro || ''));
      const items = (kind, values) => values.forEach((v, i) => out.push(db.prepare('INSERT INTO v3_departure_items(number,kind,position,value) VALUES(?,?,?,?)').bind(dog.id, kind, i, v)));
      items('flag', judged.flags || []); items('former', former); items('group', groups);
    }
    out.push(...dropMainRow(db, old.row_index));
    list.splice(list.indexOf(old), 1);
    delete fp[`main:${dogKey(dog)}`];
  } else {
    // 已經記過離所：志工之後補上原因或日期就改過來
    const prev = await db.prepare('SELECT reason,matched,departed_date,date_source FROM v3_departures WHERE number=?').bind(dog.id).first();
    if (!prev) return false;
    const flags = (await db.prepare("SELECT value FROM v3_departure_items WHERE number=? AND kind='flag' ORDER BY position").bind(dog.id).all()).results.map(r => r.value);
    const date = judged.date || prev.departed_date, source = judged.date ? judged.dateSource : prev.date_source;
    if (prev.reason !== judged.reason || prev.matched !== (judged.matched || '') || prev.departed_date !== date || prev.date_source !== source)
      out.push(db.prepare('UPDATE v3_departures SET reason=?,matched=?,departed_date=?,date_source=? WHERE number=?').bind(judged.reason, judged.matched || '', date, source, dog.id));
    if (!sameList(flags, judged.flags || [])) {
      out.push(db.prepare("DELETE FROM v3_departure_items WHERE number=? AND kind='flag'").bind(dog.id));
      (judged.flags || []).forEach((v, i) => out.push(db.prepare("INSERT INTO v3_departure_items(number,kind,position,value) VALUES(?,'flag',?,?)").bind(dog.id, i, v)));
    }
  }
  if (out.length) await db.batch(out);
  return out.length > 0;
}

// 常遛狗群一欄：只留主清單上有的犬名、用主清單的寫法（英文不分大小寫，同 parseGroupColumns）；群名不能是數字或犬名
async function applyGroup(db, row, list) {
  const column = Number(row.column);
  if (!Number.isInteger(column) || column < 0 || column > 200) throw Object.assign(new Error('狗群欄位不對'), { status: 400 });
  const groupKey = n => nameKey(n).toLowerCase();
  const known = new Map(list.map(m => [groupKey(m.name), m.name]));
  const names = [...new Set((Array.isArray(row.names) ? row.names : []).map(text).filter(n => n && !/^\d+$/.test(n)).map(n => known.get(groupKey(n))).filter(Boolean))];
  const label = text(row.label) && !/^\d+$/.test(text(row.label)) && !known.has(groupKey(row.label)) ? text(row.label) : '';
  const [had, hadLabel] = await db.batch([
    db.prepare('SELECT name FROM v3_sheet_groups WHERE column_index=? ORDER BY row_index').bind(column),
    db.prepare('SELECT label FROM v3_sheet_group_labels WHERE column_index=?').bind(column)]);
  const out = [];
  if (!sameList(had.results.map(r => r.name), names)) {
    out.push(db.prepare('DELETE FROM v3_sheet_groups WHERE column_index=?').bind(column));
    names.forEach((n, i) => out.push(db.prepare('INSERT INTO v3_sheet_groups(column_index,row_index,name) VALUES(?,?,?)').bind(column, i, n)));
  }
  if ((hadLabel.results[0]?.label || '') !== label) out.push(label
    ? db.prepare('INSERT INTO v3_sheet_group_labels(column_index,label) VALUES(?,?) ON CONFLICT(column_index) DO UPDATE SET label=excluded.label').bind(column, label)
    : db.prepare('DELETE FROM v3_sheet_group_labels WHERE column_index=?').bind(column));
  if (out.length) await db.batch(out);
  return out.length > 0;
}

// 異動紀錄（主清單下方「備註」那段）：GAS 每次送整段，只寫有變的那幾段（#554，原本整段刪掉重寫，改一格約 84 列寫入）
async function applyNotes(db, row) {
  const items = (Array.isArray(row.items) ? row.items : []).slice(0, 400)
    .map(n => ({ label: text(n && n.label), text: text(n && n.text).replace(/\r\n?/g, '\n') })).filter(n => n.text);
  const had = new Map((await db.prepare('SELECT row_index,label,text FROM v3_sheet_changes').all()).results.map(h => [h.row_index, h]));
  const out = [];
  items.forEach((n, i) => {
    const h = had.get(i);
    if (h && h.label === n.label && h.text === n.text) return;
    out.push(h ? db.prepare('UPDATE v3_sheet_changes SET label=?,text=? WHERE row_index=?').bind(n.label, n.text, i)
      : db.prepare('INSERT INTO v3_sheet_changes(row_index,label,text) VALUES(?,?,?)').bind(i, n.label, n.text));
  });
  if ([...had.keys()].some(i => !(i >= 0 && i < items.length))) out.push(db.prepare('DELETE FROM v3_sheet_changes WHERE NOT (row_index BETWEEN 0 AND ?)').bind(items.length - 1));
  if (out.length) await db.batch(out);
  return out.length > 0;
}

// ack：Worker 已接手（更新或無差異）；D1 失敗回 false，GAS 保留待通知下次補送。
export async function applyDogListRows(db, rows, env, now = Date.now()) {
  const fp = await readFp(db);
  const before = JSON.stringify(fp);
  // 主清單約 300 列，每批讀一次換來逐列不必各查一次（每次呼叫 50 次查詢上限）
  const list = (await db.prepare('SELECT row_index,dog_id,number,name,cage,note,walked_date,walker FROM v3_sheet_main').all()).results;
  const results = [];
  for (const row of rows) {
    const key = row && unitKey(row);
    if (!key) { results.push({ ok: false, ack: true, error: '看不懂的列' }); continue; }
    try {
      const changed = row.sheet === 'main' ? await applyMain(db, row, list, env, fp)
        : row.sheet === 'departed' ? await applyDeparted(db, row, list, now, fp)
        : row.sheet === 'groups' ? await applyGroup(db, row, list)
        : await applyNotes(db, row);
      if (typeof row.hash === 'string' && row.hash) fp[key] = row.hash;
      results.push({ ok: true, ack: true, key, changed });
    } catch (error) {
      results.push({ ok: false, ack: !!error.status, key, error: error.status ? error.message : '狗清單更新失敗，保留待處理' });
    }
  }
  // 有改到資料才更新「資料更新」時間（ADR 0014 的 synced_at，網站頁首與手機待確認的溜狗都看它）；台灣時間，格式同舊同步
  const touched = results.some(r => r.changed);
  const writes = [
    ...(JSON.stringify(fp) !== before ? [putState(db, FP_KEY, JSON.stringify(fp))] : []),
    ...(touched ? [putState(db, SYNCED_AT_KEY, `${new Date(now + 8 * 3600000).toISOString().slice(0, 19)}+08:00`)] : []),
  ];
  if (writes.length) await db.batch(writes).catch(e => console.warn('dog-list state:', e.message));
  return results;
}

// 保險掃描：fingerprints { 單位: 指紋 }。回 want（要 GAS 送的）、extra（D1 有、試算表沒有，只列出來）
export async function scanDogList(db, fingerprints, now = Date.now()) {
  const fp = await readFp(db);
  // #519 補填「誰遛的」原文：主清單 walker 還是 NULL 的狗指紋一樣也要，補好就不再要
  const unfilled = new Set((await db.prepare("SELECT number, name FROM v3_sheet_main WHERE walker IS NULL").all()).results.map(r => `main:${r.number || `名:${r.name}`}`));
  const want = Object.keys(fingerprints).filter(k => fp[k] !== fingerprints[k] || unfilled.has(k));
  // #528 舊指紋：回所的狗（同一隻 main: 這次有送）、D1 已經沒有這隻狗的資料，只刪指紋，不算 D1 有、試算表沒有
  const missing = Object.keys(fp).filter(k => !(k in fingerprints));
  const stale = new Set(missing.filter(k => k.startsWith('departed:') && `main:${k.slice(9)}` in fingerprints));
  for (const [sheet, table] of [['main', 'v3_sheet_main'], ['departed', 'v3_departures']]) {
    const keys = missing.filter(k => k.startsWith(`${sheet}:`) && !stale.has(k)).map(k => k.slice(sheet.length + 1));
    if (!keys.length) continue;
    const numbers = keys.filter(k => !k.startsWith('名:')), names = keys.filter(k => k.startsWith('名:')).map(k => k.slice(2));
    const marks = list => list.map(() => '?').join(',') || "''";
    const found = new Set((await db.prepare(`SELECT number, name FROM ${table} WHERE number IN (${marks(numbers)}) OR (number = '' AND name IN (${marks(names)}))`)
      .bind(...numbers, ...names).all()).results.map(r => r.number || `名:${r.name}`));
    keys.filter(k => !found.has(k)).forEach(k => stale.add(`${sheet}:${k}`));
  }
  if (stale.size) {
    for (const k of stale) delete fp[k];
    await putState(db, FP_KEY, JSON.stringify(fp)).run();
  }
  const extra = missing.filter(k => !stale.has(k)).sort();
  let prev = [];
  try { prev = JSON.parse(await state(db, EXTRA_KEY) || '{}').keys || []; } catch { /* 讀不懂就重記 */ }
  if (!sameList(prev, extra)) await putState(db, EXTRA_KEY, JSON.stringify({ at: new Date(now).toISOString(), keys: extra })).run();
  return { want, extra };
}
