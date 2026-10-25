import { isPhotoKey } from '../r2.js';

// One SELECT, one row per permanent identity. Do not infer departure from absence on the sheet.
// Preserve the volunteer site's current sex source until #566 reconciles the old copies.
export async function readManageDogs(db) {
  const { results = [] } = await db.prepare(`WITH current_rows AS (SELECT dog_id, MIN(row_index) AS row_index FROM v3_sheet_main GROUP BY dog_id)
    SELECT d.dog_id, COALESCE(m.name,d.name) AS name,
    COALESCE(m.number,'') AS number, COALESCE(m.cage,'') AS cage, COALESCE(m.note,'') AS note,
    m.row_index, d.sex AS sex, m.sex AS sheet_sex, d.sex AS dog_sex, d.fixed_care,
    COALESCE(i.intro,'') AS intro, r.until_date, r.reason, p.object_key, p.thumb_key
    FROM v3_dogs d
    LEFT JOIN current_rows c ON c.dog_id=d.dog_id
    LEFT JOIN v3_sheet_main m ON m.row_index=c.row_index
    LEFT JOIN v3_intros i ON i.dog_id=d.dog_id
    LEFT JOIN v3_rest r ON r.dog_id=d.dog_id
    LEFT JOIN v3_photos p ON p.dog_id=d.dog_id AND p.is_primary=1
    ORDER BY d.dog_id`).all();
  return results.map(row => {
    const photo = row.thumb_key || row.object_key;
    return {
      dogId: row.dog_id, number: row.number, name: row.name, cage: row.cage, note: row.note,
      onMain: row.row_index !== null, intro: row.intro, sex: row.sex,
      sexMismatch: row.row_index !== null && row.sheet_sex !== row.dog_sex,
      fixedCare: Boolean(row.fixed_care),
      rest: row.until_date ? { until: row.until_date, reason: row.reason || '' } : null,
      photoUrl: photo && isPhotoKey(photo) ? `/${photo}` : null,
    };
  });
}
