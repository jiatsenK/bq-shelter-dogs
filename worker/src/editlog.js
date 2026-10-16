// 編輯紀錄（docs/adr/0004-open-editing-and-edit-log.md）：網站上任何人都能改休養、介紹、照片等，
// 改之前要先選好名字；每次改成功記一筆「誰、什麼時候、改了哪隻狗的什麼、改前→改後」到 D1 的 v3_edit_log。
// 其他功能（活動紀錄、試算表備註）照 ADR 的寫法接上 editorOf + logEdit。

// 種類 → 編輯紀錄頁顯示的字；新種類加在這裡
export const KIND_LABELS = {
  volunteer_rename: '志工更名',
  volunteer_merge: '身分合併',
  rest: '休養',
  intro: '入所介紹',
  photo: '照片',
  activity: '活動紀錄',
  note: '試算表備註',
  sheetlog: '試算表異動紀錄',
};
export const EDITS_DEFAULT = 100;
export const EDITS_MAX = 500;
const EDITOR_NAME_MAX = 20;
const WALKER_CODE_LENGTH = 12;

// ── 誰遛的代號（#95）──
// 算法要跟 scripts/sync-sheet.mjs 的 walkerCode 完全一樣：名字全形半形統一（NFKC）、去空白、轉小寫，
// HMAC-SHA256(WALKER_KEY, 名字) 取前 12 碼十六進位。兩邊用同一組測試向量（WALKER_VECTORS）確認。
export function walkerNameKey(name) {
  return String(name || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}
export async function walkerCode(name, key) {
  const k = walkerNameKey(name);
  if (!k || !key) return '';
  const enc = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, enc.encode(k)));
  return [...sig].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, WALKER_CODE_LENGTH);
}

// 編輯者：網站送來的名字（JSON 的 editor，照片放標頭 X-Editor）。沒有名字或太長回 null；
// 沒設 WALKER_KEY 時代號是空字串，照樣記名字
export async function editorOf(name, key) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n || [...n].length > EDITOR_NAME_MAX) return null;
  return { name: n, code: await walkerCode(n, key) };
}

// 照片的編輯者放標頭（內容是 JPEG，沒有 JSON）：encodeURIComponent 包起來
export function editorHeader(request) {
  try { return decodeURIComponent(request.headers.get('X-Editor') || ''); } catch (e) { return ''; }
}

// 記一筆；記失敗不影響編輯本身（編輯已經存好了）
export async function logEdit(db, { editor, kind, dogId = null, dogNumber = '', before = null, after = null }, now = Date.now()) {
  if (!db || !editor) return false;
  try {
    await db.prepare('INSERT INTO v3_edit_log(at,editor_code,editor_name,kind,dog_id,dog_number,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)')
      .bind(new Date(now).toISOString(), editor.code || '', editor.name, kind, dogId, dogNumber || '', JSON.stringify(before), JSON.stringify(after)).run();
    return true;
  } catch (e) {
    console.error('edit log', e);
    return false;
  }
}

// 新到舊
export async function readEdits(db, limit = EDITS_DEFAULT) {
  const n = Math.min(Math.max(1, Number.isInteger(limit) ? limit : EDITS_DEFAULT), EDITS_MAX);
  const { results = [] } = await db.prepare('SELECT * FROM v3_edit_log ORDER BY id DESC LIMIT ?').bind(n).all();
  const parse = s => { try { return JSON.parse(s); } catch (e) { return null; } };
  return results.map(r => ({
    id: r.id, at: r.at, editorName: r.editor_name, editorCode: r.editor_code, kind: r.kind,
    kindLabel: KIND_LABELS[r.kind] || r.kind, dogId: r.dog_id, dogNumber: r.dog_number,
    before: parse(r.before_json), after: parse(r.after_json),
    ...(['volunteer_rename', 'volunteer_merge'].includes(r.kind) ? { editorVolunteerId: parse(r.before_json)?.volunteerId || parse(r.before_json)?.source?.volunteerId } : {}),
  }));
}
