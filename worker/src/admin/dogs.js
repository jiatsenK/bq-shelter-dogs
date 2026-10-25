// One SELECT, one row per permanent identity. Do not infer departure from absence on the sheet.
// Sex comes from v3_dogs only; the main-list copy is retired (#557).
// Photos follow the volunteer site: photos/{number}.jpg in R2 (keys from r2Versions), not the retired v3_photos list (#557).
export async function readManageDogs(db, photoVersions = {}) {
  const { results = [] } = await db.prepare(`WITH current_rows AS (SELECT dog_id, MIN(row_index) AS row_index FROM v3_sheet_main GROUP BY dog_id)
    SELECT d.dog_id, COALESCE(m.name,d.name) AS name,
    COALESCE(m.number,'') AS number, COALESCE(m.cage,'') AS cage, COALESCE(m.note,'') AS note,
    m.row_index, d.sex, d.fixed_care,
    COALESCE(i.intro,'') AS intro, r.until_date, r.reason
    FROM v3_dogs d
    LEFT JOIN current_rows c ON c.dog_id=d.dog_id
    LEFT JOIN v3_sheet_main m ON m.row_index=c.row_index
    LEFT JOIN v3_intros i ON i.dog_id=d.dog_id
    LEFT JOIN v3_rest r ON r.dog_id=d.dog_id
    ORDER BY d.dog_id`).all();
  const has = key => Object.hasOwn(photoVersions, key);
  return results.map(row => {
    const full = `photos/${row.number}.jpg`, thumb = `photos/thumbs/${row.number}.jpg`;
    const photo = !row.number || !has(full) ? null : has(thumb) ? thumb : full;
    return {
      dogId: row.dog_id, number: row.number, name: row.name, cage: row.cage, note: row.note,
      onMain: row.row_index !== null, intro: row.intro, sex: row.sex,
      fixedCare: Boolean(row.fixed_care),
      rest: row.until_date ? { until: row.until_date, reason: row.reason || '' } : null,
      photoUrl: photo ? `/${photo}` : null,
    };
  });
}
