import { guardedDogBatch } from './dog-edit.js';
// 狗清單有人編輯才同步（#501，ADR 0018 第 5–7 點）：取代每 10 分鐘叫 GitHub Actions 讀整張表（ADR 0012）。
// - GAS 編輯觸發只送受影響的列：主清單、已出所的狗（編號＋那一列）、常遛狗群的一欄、異動紀錄整段；Worker 只改那幾隻、只寫有變的欄。
// - 換籠、離所看狗新出現在哪裡：出現在「已出所」就記離所並從主清單移走；又出現在主清單就不算離所。
// - 每天三次保險掃描：GAS 送每個單位的指紋，Worker 回不一樣的（D1 還沒有指紋就全部要），GAS 再分批只送那幾個。
// - D1 有、試算表沒有的列出來（v3_sync_state 的 dog_list_extra，含每次掃描時間）；管理網站資料檢查顯示（#567）。
// - 主清單的列消失（#771，ADR 0025）：GAS 每次送狗清單、保險掃描送指紋都帶著表上主清單的全部單位 key，
//   複本有、表上沒有的列先當候選，確認後才移出主清單複本（狗的資料不刪，變成待核對），見 reconcileMissing。
// 指紋只是「上次收過哪一版」，存在 v3_sync_state 一列 JSON；遺失只會讓下一次掃描多送幾列，不影響資料。
// - 溜狗欄（日期、誰遛的）只更新主清單複本；有變就先當成一筆觀測值交給今日溜狗紀錄 module，溜狗紀錄、溜狗修改紀錄都由 module 寫（#747）。
import { splitNames } from './sheet-read.js';
import { walkerCode, editLogWrites } from './editlog.js';
import { judgeDeparture, nameKey } from './departure-rules.js';
import { taiwanYmd } from './sync-plan.js';
import { SYNCED_AT_KEY } from './compact.js';
import { linkIdentityName } from './identity.js';
import { todayWalks } from './today-walks/index.js';

// 每列 3–4 次 D1 往返；溜狗欄有變另外交給今日溜狗紀錄比對（改表通知通常先到，這裡比對到一樣只多 1 次往返；
// 狗清單先到時比對收下約 10 次往返，超過每次呼叫 50 次查詢的那幾列 D1 失敗、不 ack，GAS 補送時前面收過的就一樣了）
export const DOG_LIST_ROWS_MAX = 10;
const FP_KEY = 'dog_list_fp';
export const EXTRA_KEY = 'dog_list_extra';
// 候選第一次不見後至少隔這麼久，再收到清單還是不見才確認。GAS 一次執行最多 6 分鐘，所以確認用的一定是另一次執行讀的表；
// 每 10 分鐘補送會在還有候選時再送一次清單，實際約 10～20 分鐘確認
export const MISSING_CONFIRM_MS = 10 * 60000;
// 一次請求最多處理幾個消失（標候選、取消、確認合計，同一個 batch），其餘留給下一次清單；守住每次呼叫 50 次查詢
export const MISSING_MAX = 10;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const dogKey = dog => dog.id || `名:${dog.name}`;
const rowKey = m => `main:${m.number || `名:${m.name}`}`;
// 「資料更新」時間（ADR 0014 的 synced_at）：台灣時間，格式同舊同步
const syncedAt = now => `${new Date(now + 8 * 3600000).toISOString().slice(0, 19)}+08:00`;
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

// 溜狗欄有變（#747）：在更新主清單複本之前，把表上的值當成一筆改表觀測值交給今日溜狗紀錄。
// 沒有溜狗狀態的狗，今日溜狗紀錄的基準值取自主清單複本；先更新複本就看不出有改。
// 改表通知同一次編輯也會送同一筆，晚到的看到一樣就不動；被 version guard 擋下（同時到）或 D1 失敗就不 ack，GAS 補送時再比。
// 已記進今日溜狗紀錄的待處理（ack）照常更新複本，其他欄不卡在這裡。
async function handOverWalk(env, db, dog, current) {
  const [result] = await todayWalks({ ...env, DB: db }).observe([{ dog, current }]);
  if (!result.ok && !result.ack) throw new Error(result.error);
}
const dropMainRow = (db, rowIndex) => [db.prepare('DELETE FROM v3_sheet_main WHERE row_index=?').bind(rowIndex)];
// 離所用狗 ID 記（#560，v3_dog_departures）；同步只處理有編號的離所，沒編號的是只有名字的已出所狗卡，不動
const dropDeparture = (db, number) => db.prepare('DELETE FROM v3_dog_departures WHERE number=?').bind(number);

async function applyMain(db, row, list, env, fp) {
  const dog = cleanDog(row.dog), cage = text(row.cage), note = text(row.note).replace(/\r\n?/g, '\n');
  // 犬隻資料列一定有犬名和籠位；表尾提示文字不算狗（同 parseMainList）
  if (!dog.name || !cage || dog.name === '犬名') return false;
  const date = YMD.test(text(row.date)) ? text(row.date) : null;
  const { codes, keyed } = await walkersOf(row.walker, env, db);
  let old = findMain(list, dog);
  const out = [];
  let returnedLog = null, listed = { conditions: [], statements: [] };
  let expected=null,targetDogId=null;
  // 新增狗常先打名字、後補編號：主清單上同名沒編號的那隻就是牠，補上編號，不另建一隻（2026-10-24 驗收時多出一隻沒編號的 TEST）
  const unnumbered = !old && dog.id && list.find(m => m.number === '' && m.name === dog.name);
  if (unnumbered && !(await db.prepare('SELECT 1 FROM v3_dog_numbers WHERE number=?').bind(dog.id).first())) {
    old = unnumbered;
    out.push(db.prepare('UPDATE v3_sheet_main SET number=? WHERE row_index=?').bind(dog.id, old.row_index),
      db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(dog.id, old.dog_id),
      ...todayWalks({ ...env, DB: db }).numbered(old.dog_id, dog.id));
    old.number = dog.id;
    delete fp[`main:名:${dog.name}`];
  }
  if (old) {
    expected=old;targetDogId=old.dog_id;
    // 代號存在同一列的 JSON（#559）：跟其他欄同一句 UPDATE；沒有 WALKER_KEY 算不出代號就不動
    const next = { name: dog.name, cage, note, walked_date: date, walker: text(row.walker), ...(keyed ? { walker_codes: JSON.stringify(codes) } : {}) };
    const changed = Object.keys(next).filter(c => next[c] !== old[c]);
    const codesChanged = changed.includes('walker_codes');
    if (changed.length) out.push(db.prepare(`UPDATE v3_sheet_main SET ${changed.map(c => `${c}=?`).join(',')} WHERE row_index=?`).bind(...changed.map(c => next[c]), old.row_index));
    if (next.name !== old.name) out.push(db.prepare('UPDATE v3_dogs SET name=? WHERE dog_id=?').bind(dog.name, old.dog_id));
    // 日期或溜狗人（照代號比，#519 補填原文不算）改了：先交給今日溜狗紀錄，再更新複本。
    // 同一次才補上編號的狗，主清單複本還找不到這個編號、交不了觀測值，照新建的狗處理（那天還沒有才寫）
    const current = { date: date || '', walker: next.walker };
    if (changed.includes('walked_date') || (keyed ? codesChanged : changed.includes('walker'))) {
      if (unnumbered === old) listed = await todayWalks({ ...env, DB: db }).listed(old.dog_id, dog, current);
      else await handOverWalk(env, db, dog, current);
    }
    Object.assign(old, next);
  } else {
    const identified=dog.id?await db.prepare('SELECT n.dog_id,s.revision FROM v3_dog_numbers n JOIN v3_dog_edit_state s USING(dog_id) WHERE number=?').bind(dog.id).first():await db.prepare("SELECT w.dog_id,s.revision FROM v3_walks w JOIN v3_dog_edit_state s USING(dog_id) WHERE dog_number='' AND dog_name=? LIMIT 1").bind(dog.name).first();
    let dogId=identified?.dog_id;expected=identified;
    let returned = null;
    if (!dogId && dog.id) returned = await returnedDog(db, dog, list);
    if (returned) {
      dogId = returned.dog_id;expected=returned;
      returnedLog = { editor: { name: '試算表（自動認回所）', code: '' }, kind: 'former', dogId, dogNumber: dog.id, before: { number: returned.number }, after: { number: dog.id, formerNumber: returned.number } };
      out.push(db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(dog.id, dogId));
    } else if (!dogId) {
      dogId = newId();
      out.push(db.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(dogId, dog.name));
      if (dog.id) out.push(db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(dog.id, dogId));
    } else out.push(db.prepare('UPDATE v3_dogs SET name=? WHERE dog_id=? AND name<>?').bind(dog.name, dogId, dog.name));
    targetDogId=dogId;
    const rowIndex = Math.max(-1, ...list.map(m => m.row_index)) + 1;
    out.push(db.prepare('INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage,note,walked_date,walker,walker_codes) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(rowIndex, dogId, dog.id, dog.name, cage, note, date, text(row.walker), JSON.stringify(codes)));
    // 又回到主清單（例：誤移、退養回來）不算離所；換了新編號回來的，舊離所註明用哪個編號回所
    if (dog.id) out.push(dropDeparture(db, dog.id),
      db.prepare("UPDATE v3_dog_departures SET returned_number=? WHERE dog_id=? AND number NOT IN (?,'') AND COALESCE(returned_number,'')<>?").bind(dog.id, dogId, dog.id, dog.id));
    // 表上那天溜狗紀錄還沒有才寫（今日溜狗紀錄給的敘述，跟建狗同一批；主清單複本還沒有這隻，沒有基準值可交觀測值）
    listed = await todayWalks({ ...env, DB: db }).listed(dogId, dog, { date: date || '', walker: text(row.walker) });
    list.push({ row_index: rowIndex, dog_id: dogId, number: dog.id, name: dog.name, cage, note, walked_date: date, walker: text(row.walker), walker_codes: JSON.stringify(codes) });
  }
  if(returnedLog)out.push(...editLogWrites(db,{at:new Date().toISOString(),name:returnedLog.editor.name,kind:returnedLog.kind,dogId:returnedLog.dogId,number:returnedLog.dogNumber,before:returnedLog.before,after:returnedLog.after,source:'sheet'}));
  out.push(...listed.statements);
  if(out.length){const result=await guardedDogBatch(db,expected,[...out,db.prepare('SELECT revision FROM v3_dog_edit_state WHERE dog_id=?').bind(targetDogId)],listed.conditions);const revision=result.at(-1).results[0]?.revision;for(const item of list)if(item.dog_id===targetDogId)item.revision=revision;}
  return out.length > 0;
}

// 狗回所會拿新編號，沒人會在網站上連舊編號（K 2026-10-24）：離所紀錄裡剛好一筆同名、主清單上沒別的同名，就是同一隻。
// 認錯可在網站「舊編號」拆開（編輯紀錄記為系統自動）。同名多筆不猜，當新狗。
async function returnedDog(db, dog, list) {
  if (list.some(m => m.name === dog.name)) return null;
  const found = (await db.prepare("SELECT d.number,d.dog_id,s.revision FROM v3_dog_departures d JOIN v3_dog_edit_state s USING(dog_id) WHERE name=? AND number<>'' LIMIT 2").bind(dog.name).all()).results;
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
  // 沒編號的狗先不記離所、不從主清單移走（#560 第一步只換表；之後才開放），保險掃描照常列出
  if (!dog.id) return false;
  const old = findMain(list, dog);
  const out = [];
  if (old) {
    {
      const former = (await db.prepare('SELECT number FROM v3_dog_numbers WHERE dog_id=? AND number<>? ORDER BY number').bind(old.dog_id, dog.id).all()).results.map(r => r.number);
      const groups = (await db.prepare('SELECT DISTINCT b.value AS name FROM v3_sheet_group_columns g, json_each(g.names) a, json_each(g.names) b WHERE a.value=? AND b.value<>? ORDER BY g.column_index,b.key').bind(old.name, old.name).all()).results.map(r => r.name);
      // 性別在 v3_dogs、入所介紹在 v3_intros（#250）；主清單不再存這兩欄（#557）
      const extra = await db.prepare('SELECT d.sex, i.intro FROM v3_dogs d LEFT JOIN v3_intros i USING(dog_id) WHERE d.dog_id=?').bind(old.dog_id).first();
      out.push(dropDeparture(db, dog.id));
      out.push(db.prepare(`INSERT INTO v3_dog_departures(dog_id,number,name,departed_date,date_source,seen_date,reason,matched,flags_json,last_number,last_name,last_cage,last_walked_date,last_note,last_sex,last_intro,former_json,groups_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(old.dog_id, dog.id, old.name, judged.date || todayYmd, judged.date ? judged.dateSource : 'seen', todayYmd,
        judged.reason, judged.matched || '', JSON.stringify(judged.flags || []), dog.id, old.name, old.cage, old.walked_date, old.note, extra?.sex || '', extra?.intro || '',
        JSON.stringify(former), JSON.stringify(groups)));
    }
    out.push(...dropMainRow(db, old.row_index));

  } else {
    // 已經記過離所：志工之後補上原因或日期就改過來
    const prev = await db.prepare('SELECT reason,matched,departed_date,date_source,flags_json FROM v3_dog_departures WHERE number=?').bind(dog.id).first();
    if (!prev) return false;
    // 管理者手動修正過的離所日（#663，date_source='manual'）不再跟著試算表改
    const keep = !judged.date || prev.date_source === 'manual';
    const date = keep ? prev.departed_date : judged.date, source = keep ? prev.date_source : judged.dateSource;
    const flags = judged.flags || [];
    // 旗標跟其他欄同一列：有變就一句 UPDATE（觸發器只跑一次）
    if (prev.reason !== judged.reason || prev.matched !== (judged.matched || '') || prev.departed_date !== date || prev.date_source !== source || !sameList(JSON.parse(prev.flags_json), flags))
      out.push(db.prepare('UPDATE v3_dog_departures SET reason=?,matched=?,departed_date=?,date_source=?,flags_json=? WHERE number=?').bind(judged.reason, judged.matched || '', date, source, JSON.stringify(flags), dog.id));
  }
  if(out.length)await guardedDogBatch(db,old,out);
  if(old&&out.length){list.splice(list.indexOf(old),1);delete fp[`main:${dogKey(dog)}`];}
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
  // 一欄一列（#559）：群名、狗名有變就寫這一列（改一群約 2 列寫入，原本一隻狗一列整欄刪掉重寫約 54 列）；群名和狗都空就刪掉
  const had = await db.prepare('SELECT label, names FROM v3_sheet_group_columns WHERE column_index=?').bind(column).first();
  const json = JSON.stringify(names);
  if ((had?.label || '') === label && (had?.names || '[]') === json) return false;
  await (label || names.length
    ? db.prepare('INSERT INTO v3_sheet_group_columns(column_index,label,names) VALUES(?,?,?) ON CONFLICT(column_index) DO UPDATE SET label=excluded.label,names=excluded.names').bind(column, label, json)
    : db.prepare('DELETE FROM v3_sheet_group_columns WHERE column_index=?').bind(column)).run();
  return true;
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

// 主清單的列消失（#771，ADR 0025）。mainKeys：GAS 讀表那一刻主清單的全部單位 key；list：已套用這次送來的列之後的主清單複本。
// - 複本有、表上沒有：標成候選（missing_at 記第一次不見的時間），網站照常顯示，資料都不動。
// - 候選又出現在表上：清掉 missing_at，不記紀錄（先清空犬名再打回、改到一半的暫時狀態）。
// - 候選隔 MISSING_CONFIRM_MS 以上還是不見：確認，整列移出主清單複本（同離所的 dropMainRow），狗的資料不刪，管理網站顯示待核對。
// 表上沒有任何主清單 key（讀不到表頭）或一次少了一半以上的狗，多半是讀錯表或整張清空重貼，不當成消失。
// 每句都帶讀到時的 missing_at 當條件：同時有別的請求改過這一列就不動，下一次清單再看。
// 回傳還有沒有候選（GAS 有就在下一次 10 分鐘補送再送一次清單）。
async function reconcileMissing(db, list, mainKeys, now, fp) {
  if (!Array.isArray(mainKeys) || !mainKeys.length) return false;
  const present = new Set(mainKeys);
  const gone = list.filter(m => !present.has(rowKey(m)));
  const suspicious = gone.length * 2 > list.length;
  const due = m => now - Date.parse(m.missing_at) >= MISSING_CONFIRM_MS;
  // 取消排最前面：沒處理到的仍在表上，只是晚一點清，不會被確認（確認只看這次不在表上的列）
  const work = [
    ...list.filter(m => m.missing_at && present.has(rowKey(m))).map(m => ['back', m]),
    ...(suspicious ? [] : gone.filter(m => m.missing_at && due(m)).map(m => ['confirm', m])),
    ...(suspicious ? [] : gone.filter(m => !m.missing_at).map(m => ['mark', m])),
  ];
  if (suspicious && gone.length) console.warn(`dog-list: 表上少了 ${gone.length}/${list.length} 隻，不當成消失`);
  const doing = work.slice(0, MISSING_MAX), at = new Date(now).toISOString();
  const same = 'row_index=? AND dog_id=? AND missing_at IS ?';
  const done = doing.length ? await db.batch(doing.map(([what, m]) => what === 'confirm'
    ? db.prepare(`DELETE FROM v3_sheet_main WHERE ${same}`).bind(m.row_index, m.dog_id, m.missing_at)
    : db.prepare(`UPDATE v3_sheet_main SET missing_at=? WHERE ${same}`).bind(what === 'mark' ? at : null, m.row_index, m.dog_id, m.missing_at ?? null))) : [];
  let skipped = false;
  doing.forEach(([what, m], i) => {
    // 條件沒對上（別的請求改過這一列）就沒寫到，複本照讀到的樣子，下一次清單再看
    if (!done[i]?.meta?.changes) { skipped = true; return; }
    if (what === 'confirm') { list.splice(list.indexOf(m), 1); delete fp[rowKey(m)]; } else m.missing_at = what === 'mark' ? at : null;
  });
  // 被當成讀錯表時不叫 GAS 一直重送；下一次有人改表或保險掃描再看
  return !suspicious && (skipped || work.length > doing.length || list.some(m => m.missing_at));
}

// ack：Worker 已接手（更新或無差異）；D1 失敗回 false，GAS 保留待通知下次補送。
// mainKeys（#771）：GAS 讀表那一刻主清單的全部單位 key，套用完這批列之後拿來找消失的列；candidates＝還有候選。
export async function syncDogList(db, rows, mainKeys, env, now = Date.now()) {
  let fp = await readFp(db);
  const before = JSON.stringify(fp);
  // 主清單約 300 列，每批讀一次換來逐列不必各查一次（每次呼叫 50 次查詢上限）
  let list = await readMain(db);
  const results = [];
  for (const row of rows) {
    const key = row && unitKey(row);
    if (!key) { results.push({ ok: false, ack: true, error: '看不懂的列' }); continue; }
    try {
      const nextList=list.map(item=>({...item})),nextFp={...fp};
      const changed = row.sheet === 'main' ? await applyMain(db, row, nextList, env, nextFp)
        : row.sheet === 'departed' ? await applyDeparted(db, row, nextList, now, nextFp)
        : row.sheet === 'groups' ? await applyGroup(db, row, nextList)
        : await applyNotes(db, row);
      list=nextList;fp=nextFp;
      if (typeof row.hash === 'string' && row.hash) fp[key] = row.hash;
      results.push({ ok: true, ack: true, key, changed });
    } catch (error) {
      results.push({ ok: false, ack: !!error.status, key, error: error.status ? error.message : '狗清單更新失敗，保留待處理' });
    }
  }
  const { candidates, confirmed } = await missingOf(db, list, mainKeys, now, fp);
  // 有改到資料才更新「資料更新」時間（ADR 0014 的 synced_at，網站頁首與手機待確認的溜狗都看它）；台灣時間，格式同舊同步
  const touched = confirmed || results.some(r => r.changed);
  const writes = [
    ...(JSON.stringify(fp) !== before ? [putState(db, FP_KEY, JSON.stringify(fp))] : []),
    ...(touched ? [putState(db, SYNCED_AT_KEY, syncedAt(now))] : []),
  ];
  if (writes.length) await db.batch(writes).catch(e => console.warn('dog-list state:', e.message));
  return { results, candidates };
}
export const applyDogListRows = async (db, rows, env, now) => (await syncDogList(db, rows, null, env, now)).results;

const readMain = async db => (await db.prepare('SELECT m.row_index,m.dog_id,m.number,m.name,m.cage,m.note,m.walked_date,m.walker,m.walker_codes,m.missing_at,s.revision FROM v3_sheet_main m JOIN v3_dog_edit_state s USING(dog_id)').all()).results;
// 消失的處理出錯不影響已收下的列：當成還有候選，GAS 下一次補送再送清單
async function missingOf(db, list, mainKeys, now, fp) {
  const count = list.length;
  try {
    const candidates = await reconcileMissing(db, list, mainKeys, now, fp);
    return { candidates, confirmed: list.length < count };
  } catch (e) {
    console.warn('dog-list missing:', e.message);
    return { candidates: true, confirmed: false };
  }
}

// 保險掃描：fingerprints { 單位: 指紋 }。回 want（要 GAS 送的）、extra（D1 有、試算表沒有）、candidates（還有候選，#771）
// 指紋表的 main: 就是表上主清單的全部單位 key，跟狗清單同步一樣拿來找消失的列（GAS 在 script lock 內核對變動記號後才送）
export async function scanDogList(db, fingerprints, now = Date.now()) {
  const fp = await readFp(db);
  const before = JSON.stringify(fp);
  const { candidates, confirmed } = await missingOf(db, await readMain(db), Object.keys(fingerprints).filter(k => k.startsWith('main:')), now, fp);
  // #519 補填「誰遛的」原文：主清單 walker 還是 NULL 的狗指紋一樣也要，補好就不再要
  const unfilled = new Set((await db.prepare("SELECT number, name FROM v3_sheet_main WHERE walker IS NULL").all()).results.map(rowKey));
  const want = Object.keys(fingerprints).filter(k => fp[k] !== fingerprints[k] || unfilled.has(k));
  // #528 舊指紋：回所的狗（同一隻 main: 這次有送）、D1 已經沒有這隻狗的資料，只刪指紋，不算 D1 有、試算表沒有
  const missing = Object.keys(fp).filter(k => !(k in fingerprints));
  const stale = new Set(missing.filter(k => k.startsWith('departed:') && `main:${k.slice(9)}` in fingerprints));
  for (const [sheet, table] of [['main', 'v3_sheet_main'], ['departed', 'v3_dog_departures']]) {
    const keys = missing.filter(k => k.startsWith(`${sheet}:`) && !stale.has(k)).map(k => k.slice(sheet.length + 1));
    if (!keys.length) continue;
    const numbers = keys.filter(k => !k.startsWith('名:')), names = keys.filter(k => k.startsWith('名:')).map(k => k.slice(2));
    const marks = list => list.map(() => '?').join(',') || "''";
    const found = new Set((await db.prepare(`SELECT number, name FROM ${table} WHERE number IN (${marks(numbers)}) OR (number = '' AND name IN (${marks(names)}))`)
      .bind(...numbers, ...names).all()).results.map(r => r.number || `名:${r.name}`));
    keys.filter(k => !found.has(k)).forEach(k => stale.add(`${sheet}:${k}`));
  }
  for (const k of stale) delete fp[k];
  if (JSON.stringify(fp) !== before) await putState(db, FP_KEY, JSON.stringify(fp)).run();
  if (confirmed) await putState(db, SYNCED_AT_KEY, syncedAt(now)).run();
  const extra = missing.filter(k => !stale.has(k)).sort();
  let prev = {};
  try { prev = JSON.parse(await state(db, EXTRA_KEY) || '{}'); } catch { /* 讀不懂就重記 */ }
  // #567 管理網站要分辨「過期」：每次掃描都記 checkedAt（一天三次、1 列），at 只在清單變了才換
  const at = new Date(now).toISOString();
  const changed = !Array.isArray(prev.keys) || !sameList(prev.keys, extra) || !prev.at;
  await putState(db, EXTRA_KEY, JSON.stringify({ at: changed ? at : prev.at, checkedAt: at, keys: extra })).run();
  return { want, extra, candidates };
}
