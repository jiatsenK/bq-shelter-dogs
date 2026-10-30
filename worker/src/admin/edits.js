// #567 資料編輯紀錄（後台）：搜尋、篩選、排序都在 D1 做，涵蓋 v3_edit_log 全部，不是只過濾最近 100 筆。
// 參數全走白名單，任何未知參數回 400。每次請求 1 個查詢：照主鍵（id）順序走，游標接續、LIMIT 一頁＋1 判斷有沒有下一頁，
// 不算總數。沒有篩選時只讀一頁的列；有篩選時 SQLite 沿主鍵往下找到湊滿一頁為止，符合的很少時最多走完整張表（搜尋全部的代價，見 docs/operations/admin-records.md）。
// Access 身分（actor_email）只回後台，公開的 /api/edits 不帶。
import { EDIT_SOURCES, JUDGE_KINDS, KIND_LABELS } from '../editlog.js';

// #775 類別篩選多一個「系統自動判斷」：一次查 JUDGE_KINDS 那幾種（資料頁列表、編輯抽屜也用）
const JUDGE = 'judge';
const PARAMS = new Set(['q', 'kind', 'dog', 'actor', 'source', 'from', 'to', 'order', 'cursor', 'size']);
const SIZES = [25, 50, 100];
const SOURCES = [...EDIT_SOURCES, 'legacy']; // legacy：沒有來源的舊紀錄，只用來篩選
const TEXT_MAX = 100;
const bad = message => Object.assign(new Error(message), { status: 400 });
const like = s => `%${s.replace(/[\\%_]/g, c => `\\${c}`)}%`;
const ymd = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
// 台灣日期 → UTC ISO 起點（at 存的是 toISOString）
const taipeiStart = (s, days = 0) => new Date(Date.parse(`${s}T00:00:00+08:00`) + days * 86400000).toISOString();

export function editFilters(params) {
  for (const key of params.keys()) if (!PARAMS.has(key)) throw bad('搜尋條件不對');
  const text = key => {
    const v = (params.get(key) || '').trim();
    if ([...v].length > TEXT_MAX) throw bad(`搜尋文字最多 ${TEXT_MAX} 字`);
    return v;
  };
  const f = { q: text('q'), dog: text('dog'), actor: text('actor'), kind: params.get('kind') || '', source: params.get('source') || '',
    from: params.get('from') || '', to: params.get('to') || '', order: params.get('order') || 'newest',
    cursor: params.has('cursor') ? Number(params.get('cursor')) : null, size: Number(params.get('size') || 25) };
  if (f.kind && f.kind !== JUDGE && !Object.hasOwn(KIND_LABELS, f.kind)) throw bad('紀錄類型不對');
  if (f.source && !SOURCES.includes(f.source)) throw bad('操作來源不對');
  if (!['newest', 'oldest'].includes(f.order)) throw bad('排序方式不對');
  if (!SIZES.includes(f.size)) throw bad('每頁筆數只能是 25、50、100');
  if (f.cursor !== null && (!Number.isSafeInteger(f.cursor) || f.cursor < 1)) throw bad('翻頁位置不對，請回第一頁重查');
  if ((f.from && !ymd(f.from)) || (f.to && !ymd(f.to))) throw bad('日期看不懂');
  return f;
}

function whereOf(f) {
  const where = [], args = [];
  const add = (sql, ...values) => { where.push(sql); args.push(...values); };
  if (f.q) {
    const q = like(f.q);
    add("(l.editor_name LIKE ? ESCAPE '\\' OR l.dog_number LIKE ? ESCAPE '\\' OR COALESCE(d.name,'') LIKE ? ESCAPE '\\' OR COALESCE(l.before_json,'') LIKE ? ESCAPE '\\' OR COALESCE(l.after_json,'') LIKE ? ESCAPE '\\')", q, q, q, q, q);
  }
  if (f.kind === JUDGE) add(`l.kind IN (${JUDGE_KINDS.map(() => '?').join(',')})`, ...JUDGE_KINDS);
  else if (f.kind) add('l.kind=?', f.kind);
  if (f.source) add("COALESCE(a.source,l.source,'legacy')=?", f.source);
  if (f.actor) add("(l.editor_name LIKE ? ESCAPE '\\' OR COALESCE(a.actor_email,'') LIKE ? ESCAPE '\\')", like(f.actor), like(f.actor));
  // 狗：編號、永久 ID、名字。改後記著另一隻狗的紀錄（可能是同一隻、不是同一隻的表上那隻，合併的被併那隻）也算跟牠有關（#775 編輯抽屜）
  if (f.dog) add(`(l.dog_number=? OR l.dog_id=? OR d.name=? OR l.dog_id IN (SELECT dog_id FROM v3_dog_numbers WHERE number=?)
    OR l.after_json LIKE ? ESCAPE '\\' OR l.after_json LIKE ? ESCAPE '\\')`, f.dog, f.dog, f.dog, f.dog, like(`"dogId":${JSON.stringify(f.dog)}`), like(`"sourceId":${JSON.stringify(f.dog)}`));
  if (f.from) add('l.at>=?', taipeiStart(f.from));
  if (f.to) add('l.at<?', taipeiStart(f.to, 1));
  if (f.cursor !== null) add(f.order === 'oldest' ? 'l.id>?' : 'l.id<?', f.cursor);
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

const FROM = 'FROM v3_edit_log l LEFT JOIN v3_dog_edit_actors a ON a.log_id=l.id LEFT JOIN v3_dogs d ON d.dog_id=l.dog_id';
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
const kinds = [{ value: JUDGE, label: '系統自動判斷（全部）' }, ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))];

export async function searchEdits(db, params) {
  const f = editFilters(params);
  const { sql, args } = whereOf(f);
  const { results = [] } = await db.prepare(`SELECT l.*, d.name AS dog_name, COALESCE(a.source,l.source,'legacy') AS actor_source, a.actor_email ${FROM} ${sql} ORDER BY l.id ${f.order === 'oldest' ? 'ASC' : 'DESC'} LIMIT ?`)
    .bind(...args, f.size + 1).all();
  const rows = results.slice(0, f.size);
  return {
    pageSize: f.size, kinds, next: results.length > f.size ? rows.at(-1).id : null,
    edits: rows.map(r => ({
      id: r.id, at: r.at, kind: r.kind, kindLabel: KIND_LABELS[r.kind] || r.kind, source: r.actor_source,
      editorName: r.editor_name, dogId: r.dog_id, dogNumber: r.dog_number, dogName: r.dog_name || '',
      before: parse(r.before_json), after: parse(r.after_json),
      ...(r.actor_source === 'access' ? { actorEmail: r.actor_email } : {}),
    })),
  };
}
