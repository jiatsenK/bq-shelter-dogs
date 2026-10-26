// One SELECT, one row per permanent identity. Do not infer departure from absence on the sheet.
// Sex comes from v3_dogs only; the main-list copy is retired (#557).
// #566 maintains transactional photo pointers; old fixed paths still use the #557 R2 inventory fallback.
// 狀態（K 2026-10-26）：在主清單＝在所；有離所紀錄＝已出所；兩邊都沒有＝待核對（多半是試算表改編號留下的重複，#621）。
export async function readManageDogs(db, photoVersions = {}) {
  const { results = [] } = await db.prepare(`WITH current_rows AS (SELECT dog_id, MIN(row_index) AS row_index FROM v3_sheet_main GROUP BY dog_id)
    SELECT d.dog_id, COALESCE(m.name,d.name) AS name,
    COALESCE(m.number,'') AS number, COALESCE(m.cage,'') AS cage, COALESCE(m.note,'') AS note,
    m.row_index, COALESCE(m.walked_date,'') AS walked_date, d.sex, d.fixed_care, COALESCE(NULLIF(m.number,''),(SELECT MAX(number) FROM v3_dog_numbers WHERE dog_id=d.dog_id)) AS photo_number,
    (SELECT json_object('date',COALESCE(departed_date,''),'reason',reason) FROM v3_dog_departures WHERE dog_id=d.dog_id ORDER BY COALESCE(departed_date,'') DESC LIMIT 1) AS departure,
    COALESCE(i.intro,'') AS intro, r.until_date, r.reason, p.object_key, p.thumb_key
    FROM v3_dogs d
    LEFT JOIN current_rows c ON c.dog_id=d.dog_id
    LEFT JOIN v3_sheet_main m ON m.row_index=c.row_index
    LEFT JOIN v3_intros i ON i.dog_id=d.dog_id
    LEFT JOIN v3_rest r ON r.dog_id=d.dog_id
    LEFT JOIN v3_photos p ON p.dog_id=d.dog_id AND p.is_primary=1
    ORDER BY d.dog_id`).all();
  const has = key => Object.hasOwn(photoVersions, key);
  return results.map(row => {
    const full = `photos/${row.photo_number}.jpg`, thumb = `photos/thumbs/${row.photo_number}.jpg`;
    const photo = row.thumb_key || row.object_key || (!row.photo_number || !has(full) ? null : has(thumb) ? thumb : full);
    const onMain = row.row_index !== null;
    const departure = onMain || !row.departure ? null : JSON.parse(row.departure);
    return {
      dogId: row.dog_id, number: row.number, name: row.name, cage: row.cage, note: row.note,
      // 不在主清單的狗沒有目前編號，顯示最新的舊編號
      formerNumber: onMain ? '' : row.photo_number || '',
      onMain, status: onMain ? 'main' : departure ? 'departed' : 'unknown', departure,
      walkedDate: row.walked_date, intro: row.intro, sex: row.sex,
      sexMismatch: false,
      fixedCare: Boolean(row.fixed_care),
      rest: row.until_date ? { until: row.until_date, reason: row.reason || '' } : null,
      photoUrl: photo ? `/${photo}` : null,
    };
  });
}
