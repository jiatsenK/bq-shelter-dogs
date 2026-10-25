// Legacy regression fixtures simulate a client that just read the current dog.
// Explicit stale-version/racing clients are covered by dog-edit.test.mjs.
export async function currentEditRevision(db, path) {
  if (!db) return undefined;
  const key = decodeURIComponent(path.split('/').at(-1));
  return db
    .prepare(
      'SELECT revision FROM v3_dog_edit_state WHERE dog_id IN (SELECT dog_id FROM v3_dogs WHERE dog_id=? UNION SELECT dog_id FROM v3_dog_numbers WHERE number=?)'
    )
    .bind(key, key)
    .first('revision');
}
