// 狗的狀態（#802）：在所、已出所、待核對各是什麼，畫面上顯示哪個編號（ADR 0027），離所怎麼記。其他地方只引用，不另外寫。
// 這裡只給 SQL 片段和句子，放進呼叫端原本的 batch，一起進退。

const INSERT_DEPARTURE = 'INSERT INTO v3_dog_departures(dog_id,number,name,departed_date,date_source,seen_date,reason,matched,flags_json,last_number,last_name,last_cage,last_walked_date,last_note,last_sex,last_intro,former_json,groups_json)';

// 待核對：不在主清單、沒有離所紀錄（同 dogStatus 的 unknown）。不檢查狗還在，呼叫端要自己保證
// id：狗 ID 的 SQL 運算式（預設 ?，要綁兩次）
export const pendingDog = (id = '?') => `NOT EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=${id}) AND NOT EXISTS(SELECT 1 FROM v3_dog_departures WHERE dog_id=${id})`;

// 在主清單＝在所；有離所紀錄＝已出所；兩邊都沒有＝待核對。在主清單優先：退養回來的狗留著舊離所列，還是在所
export const dogStatus = ({ onMain, hasDeparture }) => onMain ? 'main' : hasDeparture ? 'departed' : 'unknown';

// 顯示編號（ADR 0027）：主清單上非空的編號優先，不在主清單的狗取最大的編號，都沒有是 NULL。id：狗 ID 的 SQL 運算式
export const shownNumber = id => `COALESCE((SELECT m.number FROM v3_sheet_main m WHERE m.dog_id=${id} AND m.number<>'' ORDER BY m.row_index LIMIT 1),(SELECT MAX(n.number) FROM v3_dog_numbers n WHERE n.dog_id=${id}))`;

// 待核對的狗記離所：一句 INSERT…SELECT，狗已經不是待核對就不寫（呼叫端的條件另外擋）。
// 離開主清單前的樣子（last_*）主清單複本已經沒有，從狗資料、最後一次溜狗、確認消失時的籠位抄；備註與常遛狗群空著（ADR 0026）
export function pendingDepartureWrite(db, { dogId, number, date, dateSource, today, reason, matched = '', flags = [] }) {
  return db.prepare(`${INSERT_DEPARTURE}
    SELECT d.dog_id,?,d.name,?,?,?,?,?,?,?,d.name,COALESCE((SELECT cage FROM v3_sheet_gone WHERE dog_id=d.dog_id),''),(SELECT MAX(walk_date) FROM v3_walks WHERE dog_id=d.dog_id),'',d.sex,
      COALESCE((SELECT intro FROM v3_intros WHERE dog_id=d.dog_id),''),
      (SELECT json_group_array(number) FROM (SELECT number FROM v3_dog_numbers WHERE dog_id=d.dog_id AND number<>? ORDER BY number)),'[]'
    FROM v3_dogs d WHERE d.dog_id=? AND ${pendingDog('d.dog_id')}`)
    .bind(number, date, dateSource, today, reason, matched, JSON.stringify(flags), number, number, dogId);
}

// 主清單上的狗記離所：先讀舊編號、同欄的狗、性別與介紹，回傳「刪同編號的舊離所、加新離所」兩句，呼叫端同一批移走主清單那列。row：主清單複本那列
export async function departureFromMainRow(db, { row, number, date, dateSource, today, reason, matched, flags }) {
  const former = (await db.prepare('SELECT number FROM v3_dog_numbers WHERE dog_id=? AND number<>? ORDER BY number').bind(row.dog_id, number).all()).results.map(r => r.number);
  const groups = (await db.prepare('SELECT DISTINCT b.value AS name FROM v3_sheet_group_columns g, json_each(g.names) a, json_each(g.names) b WHERE a.value=? AND b.value<>? ORDER BY g.column_index,b.key').bind(row.name, row.name).all()).results.map(r => r.name);
  // 性別在 v3_dogs、入所介紹在 v3_intros（#250）；主清單不再存這兩欄（#557）
  const extra = await db.prepare('SELECT d.sex, i.intro FROM v3_dogs d LEFT JOIN v3_intros i USING(dog_id) WHERE d.dog_id=?').bind(row.dog_id).first();
  return [
    db.prepare('DELETE FROM v3_dog_departures WHERE number=?').bind(number),
    db.prepare(`${INSERT_DEPARTURE}
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(row.dog_id, number, row.name, date, dateSource, today,
      reason, matched || '', JSON.stringify(flags || []), number, row.name, row.cage, row.walked_date, row.note, extra?.sex || '', extra?.intro || '',
      JSON.stringify(former), JSON.stringify(groups)),
  ];
}
