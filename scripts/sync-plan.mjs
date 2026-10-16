// 同步的計算（#301 從 sync-compact-d1.mjs 拆出來）：不依賴 node:sqlite、child_process，腳本和 Worker 共用。
import { importCompactDogs } from './import-compact-dogs.mjs';
import { importCompactProfiles } from './import-compact-profiles.mjs';
import { importCompactDepartures } from './import-compact-departures.mjs';
import { readDogsPayload, readWalks, readDepartures } from '../worker/src/compact.js';
import { upgradeWalks, newWalks, attachMyWalkedDate, updateDepartures, myNames, walkerCode, formatDate, formatTimestamp, FORMAT_VERSION, dogKey } from './sync-sheet.mjs';

// D1 上一次的狀態：主清單複本（還沒有就是 null）、溜狗紀錄、離所紀錄
export async function readPrevious(db) {
  // 第一次同步主清單複本是空的；其他讀取錯誤照樣丟出，不當成沒有上一次
  const empty = !(await db.prepare('SELECT COUNT(*) AS n FROM v3_sheet_main').first('n'));
  const dogs = empty ? null : await readDogsPayload(db);
  const identities = (await db.prepare('SELECT d.dog_id,d.sex,n.number FROM v3_dogs d LEFT JOIN v3_dog_numbers n USING(dog_id)').all()).results;
  const unnumbered = (await db.prepare("SELECT dog_id,name FROM v3_sheet_main WHERE number=''").all()).results;
  return { dogs, identities, unnumbered, walks: (await readWalks(db)).walks, departures: await readDepartures(db) };
}

// 試算表這次的內容 ＋ D1 上一次的狀態 → 要寫進 D1 的完整內容（跟原本 dogs.json、walks.json、departures.json 同樣子）。
// - sheet：buildData() 的結果；sheetNotes 是 null（異動紀錄讀不到）就沿用上一次
// - rows：已出所分頁（loadDepartedRows），null 表示讀不到，離所原因沿用上一次
// D1 的溜狗紀錄一隻狗一天只存最後一筆、沒有 mine，所以用代號推回 mine：newWalks 的「同一天換人」才比得準。
// 同一天多算出來的紀錄寫進 D1 時會合併成一筆（importCompactProfiles），不會重複。
// ADR 0010：since 有值時 prev.walks 只有 since 以後的紀錄（加上 daily 時用主鍵核對到的每隻狗最後一次）。
// since 以前的紀錄定下來：試算表上改了舊日期也不理；daily（6:30 保險同步）時，每隻狗最後一次溜狗在 D1 缺了才補。
export function planSync(prev, sheet, rows, now = new Date(), { key = process.env.WALKER_KEY, names = myNames(), since = '', daily = false } = {}) {
  // 性別與編號關係由 D1 永久身分提供，不再讀狗卡；有編號的狗絕不按名字合併。
  const identities = prev.identities || [];
  sheet = { ...sheet, dogs: sheet.dogs.map(dog => {
    const identity = dog.id ? identities.find(r => r.number === dog.id)
      : identities.find(r => r.dog_id === (prev.unnumbered || []).find(r => r.name === dog.name)?.dog_id);
    const formerIds = identity ? identities.filter(r => r.dog_id === identity.dog_id && r.number && r.number !== dog.id).map(r => r.number).sort() : [];
    const { formerIds: ignored, ...sheetDog } = dog;
    return { ...sheetDog, sex: identity?.sex || '', intro: '', ...(formerIds.length ? { formerIds } : {}) };
  }) };
  const myCodes = new Set(key ? names.map(n => walkerCode(n, key)) : []);
  const walks = prev.walks.map(w => ({ ...w, mine: Array.isArray(w.walkers) && w.walkers.some(c => myCodes.has(c)) }));
  const prevDogs = prev.dogs ? prev.dogs.dogs : null;
  const upgraded = upgradeWalks(walks, sheet.dogs, { key, names }).walks;
  const added = newWalks(sheet.dogs, prevDogs, upgraded, key).filter(w => !since || w.date >= since);
  if (since && daily) {
    const have = new Set([...upgraded, ...added].map(w => `${dogKey(w)}|${w.date}`));
    for (const d of sheet.dogs) {
      // 沒編號的狗不核對（見 lastWalkChecks）
      if (!d.id || !d.walkedDate || d.walkedDate >= since || have.has(`${dogKey(d)}|${d.walkedDate}`)) continue;
      added.push({ id: d.id, name: d.name, date: d.walkedDate, mine: d.myWalked === true, ...(key ? { walkers: d.walkers || [] } : {}) });
    }
  }
  const allWalks = [...upgraded, ...added];
  // 只讀最近一段時，「我最後一次遛」可能在更早以前：沿用上一次算好的，取比較新的那個
  const prevMine = new Map(since && prevDogs ? prevDogs.filter(d => d.myWalkedDate).map(d => [dogKey(d), d.myWalkedDate]) : []);
  const dogs = attachMyWalkedDate(sheet.dogs, allWalks).map(d => {
    const old = prevMine.get(dogKey(d));
    return old && (!d.myWalkedDate || d.myWalkedDate < old) ? { ...d, myWalkedDate: old } : d;
  });
  const sheetNotes = sheet.sheetNotes ?? (prev.dogs ? prev.dogs.sheetNotes : []);
  const today = formatDate(now);
  const snapshots = [
    ...(prev.dogs ? [{ date: today, dogs: prev.dogs.dogs, groups: prev.dogs.groups }] : []),
    { date: today, dogs, groups: sheet.groups },
  ];
  return {
    dogs: { version: FORMAT_VERSION, syncedAt: formatTimestamp(now), dogs, groups: sheet.groups, sheetNotes },
    walks: { version: 1, walks: allWalks },
    departures: updateDepartures(prev.departures, snapshots, rows, now),
  };
}


// 把這次要的內容（planSync 的結果＋常遛狗群、群名）寫進 db：試算表的部分整份換掉。
// 腳本是寫進記憶體 D1 再產生 SQL；Worker（#301）是寫進 worker/src/sheet-sync.js 的假 D1，再只把差異寫回真的 D1。
export async function applySource(db, source) {
  await importCompactDogs(db, source.dogs);
  const profiles = { walks: source.walks };
  await importCompactProfiles(db, profiles);
  const sheet = [];
  source.groupColumns.forEach((names, column) => names.forEach((name, row) => sheet.push(db.prepare('INSERT INTO v3_sheet_groups(column_index,row_index,name) VALUES(?,?,?)').bind(column, row, name))));
  (source.groupLabels || []).forEach((label, column) => { if (label) sheet.push(db.prepare('INSERT INTO v3_sheet_group_labels(column_index,label) VALUES(?,?)').bind(column, label)); });
  (source.dogs.sheetNotes || []).forEach((n, row) => sheet.push(db.prepare('INSERT INTO v3_sheet_changes(row_index,label,text) VALUES(?,?,?)').bind(row, n.label || '', n.text || '')));
  await db.batch([db.prepare('DELETE FROM v3_sheet_groups'), db.prepare('DELETE FROM v3_sheet_group_labels'), db.prepare('DELETE FROM v3_sheet_changes'), ...sheet]);
  await importCompactDepartures(db, source.departures);
}
