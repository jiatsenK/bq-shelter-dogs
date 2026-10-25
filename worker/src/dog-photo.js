import { readDogEdit, saveDogEdit, editError } from './dog-edit.js';
import { readPhoto, putPhoto, thumbKey, toTrash, readTrash, isTrashId, resetR2State } from './r2.js';

const MAX_BYTES = 2 * 1024 * 1024,
  THUMB_MAX = 512 * 1024;
function jpeg(bytes, max) {
  if (!bytes?.length) throw editError(400, '請選擇照片');
  if (bytes.length > max) throw editError(413, '照片太大');
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw editError(415, '照片須為 JPEG');
}
export async function photoInput(request) {
  // Bound the stream before parsing multipart or JPEG, including chunked uploads.
  const reader = request.body?.getReader();
  if (!reader) throw editError(400, '請選照片');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES + THUMB_MAX + 16384) {
        await reader.cancel();
        throw editError(413, '照片太大');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const type = request.headers.get('Content-Type') || '';
  let original = bytes,
    thumb = null;
  if (type.startsWith('multipart/form-data')) {
    let form;
    try {
      form = await new Response(bytes, { headers: { 'Content-Type': type } }).formData();
    } catch {
      throw editError(400, '照片格式不對');
    }
    if (
      [...form.keys()].some((k) => !['photo', 'thumb'].includes(k)) ||
      form.getAll('photo').length !== 1 ||
      form.getAll('thumb').length > 1
    )
      throw editError(400, '照片欄位不對');
    if (!(form.get('photo') instanceof Blob) || (form.has('thumb') && !(form.get('thumb') instanceof Blob)))
      throw editError(400, '照片格式不對');
    original = new Uint8Array(await form.get('photo').arrayBuffer());
    if (form.has('thumb')) thumb = new Uint8Array(await form.get('thumb').arrayBuffer());
  } else if (type.split(';')[0] !== 'image/jpeg') throw editError(415, '請使用 JPEG');
  jpeg(original, MAX_BYTES);
  if (thumb) jpeg(thumb, THUMB_MAX);
  return { original, thumb };
}
// Immutable object names ensure two concurrent replacements cannot mix versions.
// Failed commits leave staged objects unreferenced; they never delete the old pair.
export async function saveDogPhoto(env, dogId, revision, images, identity, base) {
  if (!env.PHOTOS) throw editError(503, '照片儲存暫時無法使用');
  const before = await readDogEdit(env.DB, dogId);
  if (before.revision !== revision) throw editError(409, '資料已變更，請重新讀取；照片草稿仍保留');
  if (!images) throw editError(400, '請選擇要替換的照片');
  jpeg(images.original, MAX_BYTES);
  if (images.thumb) jpeg(images.thumb, THUMB_MAX);
  const oldKey =
    before.photo?.key ||
    (before.currentNumbers[0] || before.numbers.at(-1)
      ? `photos/${before.currentNumbers[0] || before.numbers.at(-1)}.jpg`
      : null);
  const old = oldKey ? await readPhoto(env, base, oldKey) : null;
  const oldThumb = oldKey ? await readPhoto(env, base, before.photo?.thumb || thumbKey(oldKey)) : null;
  const equal = (a, b) => (!a && !b) || (a && b && a.length === b.length && a.every((byte, i) => byte === b[i]));
  if (equal(old?.bytes, images.original) && equal(oldThumb?.bytes, images.thumb)) {
    return {
      ...before,
      photo: before.photo || { key: oldKey, thumb: oldThumb ? thumbKey(oldKey) : null },
      trash: null
    };
  }
  let trash = null;
  if (old) trash = await toTrash(env, base, oldKey, { dogId, kind: 'main' });
  const key = `photos/${crypto.randomUUID().replaceAll('-', '')}.jpg`;
  const staging = { from: 'site', dogId, stagedAt: new Date().toISOString(), operation: crypto.randomUUID() };
  await putPhoto(env, key, images.original, staging);
  if (images.thumb) await putPhoto(env, thumbKey(key), images.thumb, staging);
  const value = { key, thumb: images.thumb ? thumbKey(key) : null };
  const after = await saveDogEdit(
    env.DB,
    dogId,
    { revision, field: 'photo', value },
    {
      ...identity,
      photo: true,
      photoBefore: old ? { key: oldKey, thumb: oldThumb ? before.photo?.thumb || thumbKey(oldKey) : null, trash } : null
    }
  );
  resetR2State();
  return { ...after, trash };
}
export async function restoreDogPhoto(env, dogId, revision, trashId, identity, base) {
  if (!isTrashId(trashId)) throw editError(400, '垃圾桶編號不對');
  const old = await readTrash(env, trashId);
  if (!old || old.meta.dogId !== dogId) throw editError(404, '找不到這隻狗的照片備份');
  return saveDogPhoto(env, dogId, revision, { original: old.bytes, thumb: old.thumb }, identity, base);
}
