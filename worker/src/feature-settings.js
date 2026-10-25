export const SETTING_KEYS = Object.freeze(['showActivities', 'showQuality', 'showUpdates', 'editIntro', 'editPhoto', 'editRest', 'editActivity', 'editFixedCare', 'editStays', 'editFormer']);
const fault = (status, message) => Object.assign(new Error(message), { status });
function validValues(values) {
  return values && typeof values === 'object' && !Array.isArray(values) && Object.keys(values).length === SETTING_KEYS.length && SETTING_KEYS.every(key => Object.hasOwn(values, key) && typeof values[key] === 'boolean');
}
function canonical(values) { return JSON.stringify(Object.fromEntries(SETTING_KEYS.map(key => [key, values[key]]))); }
export async function readSettings(db) {
  try {
    const row = await db.prepare('SELECT revision, values_json FROM v3_feature_settings WHERE id=1').first();
    const values = JSON.parse(row?.values_json);
    if (!validValues(values) || !Number.isSafeInteger(row.revision) || row.revision < 1) throw Error('invalid settings');
    return { revision: row.revision, values };
  } catch { throw fault(503, '功能設定暫時無法確認，請重新讀取後再試'); }
}
export async function saveSettings(db, input, actor) {
  if (!input || Object.keys(input).sort().join(',') !== 'revision,values' || !Number.isSafeInteger(input.revision) || input.revision < 1 || !validValues(input.values)) throw fault(400, '設定格式不對，請重新讀取');
  // actor only comes from the protected admin worker's verified Access claims.
  if (!actor?.subject || !actor?.email) throw fault(403, '管理權限未確認');
  const before = await readSettings(db);
  if (before.revision !== input.revision) throw fault(409, '設定已被其他管理者修改，請重新讀取再調整');
  if (canonical(before.values) === canonical(input.values)) return before;
  const result = await db.prepare(`UPDATE v3_feature_settings SET values_json=?, revision=revision+1, actor_subject=?, actor_email=?, changed_at=?, request_id=? WHERE id=1 AND revision=?`)
    .bind(canonical(input.values), actor.subject, actor.email, new Date().toISOString(), crypto.randomUUID(), input.revision).run();
  if (!result.meta.changes) throw fault(409, '設定已被其他管理者修改，請重新讀取再調整');
  return { revision: input.revision + 1, values: input.values };
}
export function settingForWrite(path, method) {
  if (['GET','HEAD','OPTIONS'].includes(method)) return null;
  const routes = { intro: 'editIntro', photos: 'editPhoto', rest: 'editRest', activities: 'editActivity', 'fixed-care': 'editFixedCare', stays: 'editStays', former: 'editFormer' };
  const name = path.split('/')[1];
  return Object.hasOwn(routes, name) ? routes[name] : null;
}
export async function requireVolunteerEdit(db, key) {
  const settings = await readSettings(db);
  if (!settings.values[key]) throw fault(403, '這項志工編輯目前未開放');
}
