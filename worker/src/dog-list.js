// 狗清單有人編輯才同步（#501，ADR 0018 第 5–7 點）：取代每 10 分鐘叫 GitHub Actions 讀整張表（ADR 0012）。
// - GAS 編輯觸發只送受影響的列：主清單、已出所的狗（編號＋那一列）、常遛狗群的一欄、異動紀錄整段；Worker 只改那幾隻、只寫有變的欄。
// - 換籠、離所看狗新出現在哪裡：出現在「已出所」就記離所並從主清單移走；又出現在主清單就不算離所。
// - 每天三次保險掃描：GAS 送每個單位的指紋，Worker 回不一樣的（D1 還沒有指紋就全部要），GAS 再分批只送那幾個。
// - D1 有、試算表沒有的只列出來（v3_sync_state 的 dog_list_extra），不自動刪。
// 指紋只是「上次收過哪一版」，存在 v3_sync_state 一列 JSON；遺失只會讓下一次掃描多送幾列，不影響資料。
import { splitNames } from './sheet-read.js';
import { walkerCode } from './editlog.js';
import { judgeDeparture, nameKey } from './departure-rules.js';
import { taiwanYmd } from './sync-plan.js';
import { SYNCED_AT_KEY } from './compact.js';

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

// 「誰遛的」→ 代號（同 scripts/sync-sheet.mjs 的 walkerCodes）；是不是 K 遛的照 MY_NAME（沒設就都不是）
async function walkersOf(walker, env) {
  const names = splitNames(walker);
  const key = env && env.WALKER_KEY ? String(env.WALKER_KEY) : '';
  const codes = key ? [...new Set((await Promise.all(names.map(n => walkerCode(n, key)))).filter(Boolean))] : [];
  const mine = splitNames(env && env.MY_NAME).map(nameKey);
  return { codes, keyed: !!key, mine: names.some(n => mine.includes(nameKey(n))) };
}

// 溜狗紀錄一隻狗一天一組（同一天以最後一次為準，跟 importCompactProfiles 合併的結果一樣）
function walkDay(db, dogId, date, dog, codes) {
  return [
    db.prepare('DELETE FROM v3_walks WHERE dog_id=? AND walk_date=?').bind(dogId, date),
    ...(codes.length ? codes : [null]).map((code, i) => db.prepare('INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) VALUES(?,?,?,?,?,?)')
      .bind(dogId, date, i, code, dog.id, dog.name)),
  ];
}
const dropMainRow = (db, rowIndex) => ['v3_sheet_main_walkers', 'v3_sheet_former_numbers', 'v3_sheet_main']
  .map(t => db.prepare(`DELETE FROM ${t} WHERE row_index=?`).bind(rowIndex));
const dropDeparture = (db, number) => [db.prepare('DELETE FROM v3_departure_items WHERE number=?').bind(number), db.prepare('DELETE FROM v3_departures WHERE number=?').bind(number)];

async function applyMain(db, row, list, env) {
  const dog = cleanDog(row.dog), cage = text(row.cage), note = text(row.note).replace(/\r\n?/g, '\n');
  // 犬隻資料列一定有犬名和籠位；表尾提示文字不算狗（同 parseMainList）
  if (!dog.name || !cage || dog.name === '犬名') return false;
  const date = YMD.test(text(row.date)) ? text(row.date) : null;
  const { codes, keyed, mine } = await walkersOf(row.walker, env);
  const covered = text(row.walker) ? 1 : 0;
  const old = findMain(list, dog);
  const out = [];
  if (old) {
    const oldCodes = (await db.prepare('SELECT walker_code FROM v3_sheet_main_walkers WHERE row_index=? ORDER BY position').bind(old.row_index).all()).results.map(r => r.walker_code);
    const codesChanged = keyed && !sameList(oldCodes, codes);
    const next = { name: dog.name, cage, note, walked_date: date, covered, my_walked: mine ? 1 : 0 };
    if (mine && date && !(old.my_walked_date >= date)) next.my_walked_date = date;
    const changed = Object.keys(next).filter(c => next[c] !== old[c]);
    if (changed.length) out.push(db.prepare(`UPDATE v3_sheet_main SET ${changed.map(c => `${c}=?`).join(',')} WHERE row_index=?`).bind(...changed.map(c => next[c]), old.row_index));
    if (next.name !== old.name) out.push(db.prepare('UPDATE v3_dogs SET name=? WHERE dog_id=?').bind(dog.name, old.dog_id));
    if (codesChanged) {
      out.push(db.prepare('DELETE FROM v3_sheet_main_walkers WHERE row_index=?').bind(old.row_index));
      codes.forEach((code, i) => out.push(db.prepare('INSERT INTO v3_sheet_main_walkers VALUES(?,?,?)').bind(old.row_index, i, code)));
    }
    // 日期變新、或同一天換人才記一筆；改早、清空不記也不刪（同 newWalks）
    if (date && (!old.walked_date || date > old.walked_date || (date === old.walked_date && codesChanged))) out.push(...walkDay(db, old.dog_id, date, dog, codes));
    Object.assign(old, next);
  } else {
    let dogId = dog.id
      ? await db.prepare('SELECT dog_id FROM v3_dog_numbers WHERE number=?').bind(dog.id).first('dog_id')
      : await db.prepare("SELECT dog_id FROM v3_walks WHERE dog_number='' AND dog_name=? LIMIT 1").bind(dog.name).first('dog_id');
    if (!dogId) {
      dogId = newId();
      out.push(db.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(dogId, dog.name));
      if (dog.id) out.push(db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(dog.id, dogId));
    } else out.push(db.prepare('UPDATE v3_dogs SET name=? WHERE dog_id=? AND name<>?').bind(dog.name, dogId, dog.name));
    const rowIndex = Math.max(-1, ...list.map(m => m.row_index)) + 1;
    out.push(db.prepare(`INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage,note,covered,walked_date,my_walked,my_walked_date,synced_at,sex)
      VALUES(?,?,?,?,?,?,?,?,?,?,'',COALESCE((SELECT sex FROM v3_dogs WHERE dog_id=?),''))`)
      .bind(rowIndex, dogId, dog.id, dog.name, cage, note, covered, date, mine ? 1 : 0, mine ? date : null, dogId));
    out.push(db.prepare('INSERT INTO v3_sheet_former_numbers SELECT ?,ROW_NUMBER() OVER (ORDER BY number)-1,number FROM v3_dog_numbers WHERE dog_id=? AND number<>?').bind(rowIndex, dogId, dog.id));
    codes.forEach((code, i) => out.push(db.prepare('INSERT INTO v3_sheet_main_walkers VALUES(?,?,?)').bind(rowIndex, i, code)));
    // 又回到主清單（例：誤移、退養回來）不算離所
    if (dog.id) out.push(...dropDeparture(db, dog.id));
    if (date && !(await db.prepare('SELECT 1 FROM v3_walks WHERE dog_id=? AND walk_date=? LIMIT 1').bind(dogId, date).first())) out.push(...walkDay(db, dogId, date, dog, codes));
    list.push({ row_index: rowIndex, dog_id: dogId, number: dog.id, name: dog.name, cage, note, walked_date: date, covered, my_walked: mine ? 1 : 0, my_walked_date: mine ? date : null });
  }
  if (out.length) await db.batch(out);
  return out.length > 0;
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
      const former = (await db.prepare('SELECT number FROM v3_sheet_former_numbers WHERE row_index=? ORDER BY position').bind(old.row_index).all()).results.map(r => r.number);
      const groups = (await db.prepare('SELECT DISTINCT b.name FROM v3_sheet_groups a JOIN v3_sheet_groups b ON a.column_index=b.column_index WHERE a.name=? AND b.name<>? ORDER BY b.column_index,b.row_index').bind(old.name, old.name).all()).results.map(r => r.name);
      const extra = await db.prepare('SELECT sex,intro FROM v3_sheet_main WHERE row_index=?').bind(old.row_index).first();
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

// 異動紀錄（主清單下方「備註」那段）整段換；跟上次一樣就不寫
async function applyNotes(db, row) {
  const items = (Array.isArray(row.items) ? row.items : []).slice(0, 400)
    .map(n => ({ label: text(n && n.label), text: text(n && n.text).replace(/\r\n?/g, '\n') })).filter(n => n.text);
  const had = (await db.prepare('SELECT label,text FROM v3_sheet_changes ORDER BY row_index').all()).results;
  if (had.length === items.length && had.every((h, i) => h.label === items[i].label && h.text === items[i].text)) return false;
  await db.batch([db.prepare('DELETE FROM v3_sheet_changes'), ...items.map((n, i) => db.prepare('INSERT INTO v3_sheet_changes(row_index,label,text) VALUES(?,?,?)').bind(i, n.label, n.text))]);
  return true;
}

// ack：Worker 已接手（更新或無差異）；D1 失敗回 false，GAS 保留待通知下次補送。
export async function applyDogListRows(db, rows, env, now = Date.now()) {
  const fp = await readFp(db);
  const before = JSON.stringify(fp);
  // 主清單約 300 列，每批讀一次換來逐列不必各查一次（每次呼叫 50 次查詢上限）
  const list = (await db.prepare('SELECT row_index,dog_id,number,name,cage,note,walked_date,covered,my_walked,my_walked_date FROM v3_sheet_main').all()).results;
  const results = [];
  for (const row of rows) {
    const key = row && unitKey(row);
    if (!key) { results.push({ ok: false, ack: true, error: '看不懂的列' }); continue; }
    try {
      const changed = row.sheet === 'main' ? await applyMain(db, row, list, env)
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
  const want = Object.keys(fingerprints).filter(k => fp[k] !== fingerprints[k]);
  const extra = Object.keys(fp).filter(k => !(k in fingerprints)).sort();
  let prev = [];
  try { prev = JSON.parse(await state(db, EXTRA_KEY) || '{}').keys || []; } catch { /* 讀不懂就重記 */ }
  if (!sameList(prev, extra)) await putState(db, EXTRA_KEY, JSON.stringify({ at: new Date(now).toISOString(), keys: extra })).run();
  return { want, extra };
}
