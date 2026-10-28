// 編輯紀錄（docs/adr/0004-open-editing-and-edit-log.md）：志工網站上開放編輯的休養、介紹、照片等（各項開關見 ADR 0020），
// 改之前要先選好名字；每次改成功記一筆「誰、什麼時候、改了哪隻狗的什麼、改前→改後」到 D1 的 v3_edit_log。
// 其他功能（活動紀錄、試算表備註）照 ADR 的寫法接上 editorOf + logEdit。

// 種類 → 編輯紀錄頁顯示的字；新種類加在這裡
export const KIND_LABELS = {
  volunteer_rename: '志工更名',
  volunteer_merge: '身分合併',
  rest: '休養',
  sex: '性別補正',
  'fixed-care': '有人固定照顧',
  intro: '介紹',
  photo: '照片',
  activity: '活動紀錄',
  'departed-card': '已出所狗卡',
  note: '試算表備註',
  sheetlog: '試算表異動紀錄',
  group: '常溜狗群',
  former: '舊編號',
  stays: '出入所紀錄',
  walk: '溜了', // #672：只在管理網站修改紀錄顯示，志工網站編輯紀錄（readEdits）不列
  walkundo: '撤銷溜了',
  walkedit: '溜狗名單',
  merge: '合併狗',
  unmerge: '取消合併',
};
// 合併狗的紀錄存整份快照（snapshot、rows）給管理網站取消合併用；公開的編輯紀錄只看摘要
const MERGE_KINDS = new Set(['merge', 'unmerge']);
export const slimMergeValue = v => (v && typeof v === 'object' ? (({ snapshot, rows, ...rest }) => rest)(v) : v);
export const EDITS_DEFAULT = 100;
export const EDITS_MAX = 500;
const EDITOR_NAME_MAX = 20;
const WALKER_CODE_LENGTH = 12;

// ── 誰遛的代號（#95）──
// 算法不能改（D1 裡舊的代號都是這樣算的）：名字全形半形統一（NFKC）、去空白、轉小寫，
// HMAC-SHA256(WALKER_KEY, 名字) 取前 12 碼十六進位。測試向量（WALKER_VECTORS）固定住結果。
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

// 修改紀錄的來源（#672）：access＝管理網站、volunteer＝志工網站、sheet＝試算表。v3_edit_log.source 沒有 CHECK，允許的值以這裡為準
export const EDIT_SOURCES = ['access', 'volunteer', 'sheet'];
const checkSource = source => {
  if (!EDIT_SOURCES.includes(source)) throw new Error(`修改紀錄來源不對：${source}`);
};

// 寫修改紀錄的 SQL 只在這裡（#709，worker/test/edit-log-single.test.mjs 擋第二處 INSERT INTO v3_edit_log）；回傳要放進呼叫端 batch 的句子。
// source 必填；帶 actor（{ requestId, subject, email }）時另記一列 v3_dog_edit_actors，來源記在那列，v3_edit_log.source 照舊留 NULL。
// when：[條件 SQL, ...參數]，寫入當下條件成立才記（跟同一批的 guard 一起用）；沒給就直接 VALUES 寫
export function editLogWrites(db, { at, code = '', name, kind, dogId = null, number = '', before, after, source, actor = null }, [when, ...args] = []) {
  checkSource(source);
  // exprs：每欄的值（? 或 SQL 運算式）
  const values = exprs => when ? `SELECT ${exprs.join(',')} WHERE ${when}` : `VALUES(${exprs.join(',')})`;
  const writes = [db.prepare(`INSERT INTO v3_edit_log(at,editor_code,editor_name,kind,dog_id,dog_number,before_json,after_json,source) ${values(Array(9).fill('?'))}`)
    .bind(at, code, name, kind, dogId, number || '', JSON.stringify(before), JSON.stringify(after), actor ? null : source, ...args)];
  if (actor) writes.push(db.prepare(`INSERT INTO v3_dog_edit_actors(request_id,log_id,actor_subject,actor_email,source) ${values(['?', 'last_insert_rowid()', '?', '?', '?'])}`)
    .bind(actor.requestId, actor.subject, actor.email, source, ...args));
  return writes;
}

// 記一筆；記失敗不影響編輯本身（編輯已經存好了）。來源沒傳或不對直接丟錯，不吞掉
export async function logEdit(db, { editor, kind, dogId = null, dogNumber = '', before = null, after = null, source }, now = Date.now()) {
  checkSource(source);
  if (!db || !editor) return false;
  try {
    const [write] = editLogWrites(db, { at: new Date(now).toISOString(), code: editor.code || '', name: editor.name, kind, dogId, number: dogNumber, before, after, source });
    await write.run();
    return true;
  } catch (e) {
    console.error('edit log', e);
    return false;
  }
}

// 清修改紀錄只在這裡（ADR 0004 修訂：保留 14 天；worker/test/edit-log-single.test.mjs 擋別處 DELETE FROM v3_edit_log）。
// 超過 14 天的清掉，合併狗快照（MERGE_KINDS）永久保留：被併那隻的資料只存在這裡，取消合併也要看後面同一隻的合併／取消合併。
// v3_dog_edit_actors 有外鍵指向紀錄，同一批先刪。排程一天跑一次（at 沒索引，兩句各掃整張一次），表維持約 14 天份。回傳清掉幾筆
const KEEP_DAYS = 14;
export async function pruneEdits(db, now = Date.now()) {
  const cutoff = new Date(now - KEEP_DAYS * 86400000).toISOString();
  const expiredWhere = `at<? AND kind NOT IN (${[...MERGE_KINDS].map(() => '?').join(',')})`;
  const [, deleted] = await db.batch([
    db.prepare(`DELETE FROM v3_dog_edit_actors WHERE log_id IN (SELECT id FROM v3_edit_log WHERE ${expiredWhere})`).bind(cutoff, ...MERGE_KINDS),
    db.prepare(`DELETE FROM v3_edit_log WHERE ${expiredWhere}`).bind(cutoff, ...MERGE_KINDS),
  ]);
  return deleted.meta.changes;
}

// 新到舊；不列「溜了」（#672，量大，只在管理網站看）。這頁之後會拿掉，不為了跳過溜了加索引
export async function readEdits(db, limit = EDITS_DEFAULT) {
  const n = Math.min(Math.max(1, Number.isInteger(limit) ? limit : EDITS_DEFAULT), EDITS_MAX);
  const { results = [] } = await db.prepare("SELECT l.*, COALESCE(a.source,l.source,'legacy') AS actor_source FROM v3_edit_log l LEFT JOIN v3_dog_edit_actors a ON a.log_id=l.id WHERE l.kind<>'walk' ORDER BY l.id DESC LIMIT ?").bind(n).all();
  const parse = s => { try { return JSON.parse(s); } catch (e) { return null; } };
  return results.map(r => ({
    id: r.id, at: r.at, source: r.actor_source, editorName: r.editor_name, editorCode: r.editor_code, kind: r.kind,
    kindLabel: KIND_LABELS[r.kind] || r.kind, dogId: r.dog_id, dogNumber: r.dog_number,
    before: MERGE_KINDS.has(r.kind) ? slimMergeValue(parse(r.before_json)) : parse(r.before_json),
    after: MERGE_KINDS.has(r.kind) ? slimMergeValue(parse(r.after_json)) : parse(r.after_json),
    ...(['volunteer_rename', 'volunteer_merge'].includes(r.kind) ? { editorVolunteerId: parse(r.before_json)?.volunteerId || parse(r.before_json)?.source?.volunteerId } : {}),
  }));
}
