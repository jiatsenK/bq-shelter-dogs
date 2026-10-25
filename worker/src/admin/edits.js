// #567 資料編輯紀錄（後台）：搜尋、篩選、排序都在 D1 做，涵蓋 v3_edit_log 全部，不是只過濾最近 100 筆。
// 參數全走白名單，任何未知參數回 400；每次請求固定 2 個查詢（總數＋一頁），讀取量上限是紀錄表列數。
// Access 身分（actor_email）只回後台，公開的 /api/edits 不帶。
import { KIND_LABELS } from '../editlog.js';

const PARAMS = new Set(['q', 'kind', 'dog', 'actor', 'source', 'from', 'to', 'order', 'page', 'size']);
const SIZES = [25, 50, 100];
const SOURCES = ['access', 'volunteer', 'legacy'];
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
    page: Number(params.get('page') || 1), size: Number(params.get('size') || 25) };
  if (f.kind && !Object.hasOwn(KIND_LABELS, f.kind)) throw bad('紀錄類型不對');
  if (f.source && !SOURCES.includes(f.source)) throw bad('操作來源不對');
  if (!['newest', 'oldest'].includes(f.order)) throw bad('排序方式不對');
  if (!SIZES.includes(f.size)) throw bad('每頁筆數只能是 25、50、100');
  if (!Number.isSafeInteger(f.page) || f.page < 1) throw bad('頁數不對');
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
  if (f.kind) add('l.kind=?', f.kind);
  if (f.source) add("COALESCE(a.source,'legacy')=?", f.source);
  if (f.actor) add("(l.editor_name LIKE ? ESCAPE '\\' OR COALESCE(a.actor_email,'') LIKE ? ESCAPE '\\')", like(f.actor), like(f.actor));
  if (f.dog) add('(l.dog_number=? OR l.dog_id=? OR d.name=? OR l.dog_id IN (SELECT dog_id FROM v3_dog_numbers WHERE number=?))', f.dog, f.dog, f.dog, f.dog);
  if (f.from) add('l.at>=?', taipeiStart(f.from));
  if (f.to) add('l.at<?', taipeiStart(f.to, 1));
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

const FROM = 'FROM v3_edit_log l LEFT JOIN v3_dog_edit_actors a ON a.log_id=l.id LEFT JOIN v3_dogs d ON d.dog_id=l.dog_id';
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
const kinds = Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }));

export async function searchEdits(db, params) {
  const f = editFilters(params);
  const { sql, args } = whereOf(f);
  const order = f.order === 'oldest' ? 'ASC' : 'DESC';
  const pageOf = page => db.prepare(`SELECT l.*, d.name AS dog_name, COALESCE(a.source,'legacy') AS actor_source, a.actor_email ${FROM} ${sql} ORDER BY l.id ${order} LIMIT ? OFFSET ?`)
    .bind(...args, f.size, (page - 1) * f.size);
  const [count, rows] = await db.batch([db.prepare(`SELECT COUNT(*) AS n ${FROM} ${sql}`).bind(...args), pageOf(f.page)]);
  const total = count.results[0].n, pages = Math.max(1, Math.ceil(total / f.size));
  let page = f.page, results = rows.results || [];
  // 超出頁數（別人剛好篩掉一些）才多查一次最後一頁
  if (page > pages) { page = pages; results = (await pageOf(page).all()).results || []; }
  return {
    total, page, pages, pageSize: f.size, kinds,
    edits: results.map(r => ({
      id: r.id, at: r.at, kind: r.kind, kindLabel: KIND_LABELS[r.kind] || r.kind, source: r.actor_source,
      editorName: r.editor_name, dogId: r.dog_id, dogNumber: r.dog_number, dogName: r.dog_name || '',
      before: parse(r.before_json), after: parse(r.after_json),
      ...(r.actor_source === 'access' ? { actorEmail: r.actor_email } : {}),
    })),
  };
}
