// 資訊 → 活動紀錄（#270）。跟 analysis.js 分開：analysis.js 只讀（tests/index.html 檢查），活動要寫入 /api/activities
// ── 活動紀錄（#270，ADR 0002）：動保小小兵、認養會每場出席的狗，存 D1（/api/activities）──
// 每場標題（日期＋類型）下直接列出席的狗；選好名字就能新增、修改、刪除，Worker 記編輯紀錄。狗卡上不顯示活動
const ACTIVITY_KINDS = { kids: '動保小小兵', adoption: '認養會' };
let activitiesData = null; // { state: 'loading' | 'ready' | 'error', list }
let actEdit = null; // { id（新增是 ''）, date, kind, dogs: [{ dogId, number, name }], query, busy, error }

function loadActivities(force) {
  if (activitiesData && !force) return;
  activitiesData = { state: 'loading', list: activitiesData?.list || [] };
  fetch(`${UPLOAD_URL}/activities`, { cache: 'no-cache' })
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then(data => { if (!Array.isArray(data?.activities)) throw new Error('格式不對'); activitiesData = { state: 'ready', list: data.activities }; })
    .catch(() => { activitiesData = { state: 'error', list: [] }; })
    .then(() => { if (analysisOpen && infoPage === 'activities') render(); });
}

const actTitle = a => `${a.date.replace(/-/g, '/')} ${ACTIVITY_KINDS[a.kind] || a.kind}`;
const actDogHtml = d => `<li${d.dogId ? '' : ' class="act-name-only"'}>${esc(d.name)}${d.dogId ? '' : '<small>（未對上狗卡）</small>'}</li>`;
const actToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function actSuggestionsHtml() {
  const q = (actEdit?.query || '').trim();
  if (!q) return '';
  const picked = new Set(actEdit.dogs.map(d => d.number).filter(Boolean)); // 已對上的在所狗也帶編號（GET 讀回）
  const hits = (allDogs || []).filter(d => d.id && !picked.has(d.id) && (d.name.includes(q) || d.id.includes(q))).slice(0, 8);
  return hits.map(d => `<button type="button" data-act-add="${esc(d.id)}">${esc(d.name)}<small>${esc(d.id)}</small></button>`).join('') +
    (actEdit.dogs.some(d => !d.dogId && !d.number && d.name === q) ? '' : `<button type="button" data-act-add-name>只記名字「${esc(q)}」</button>`);
}

function actFormHtml() {
  const e = actEdit;
  return `<form class="act-form rest-form" id="actForm">
    <h3>${e.id ? '修改活動' : '新增活動'}</h3>
    <label>日期<input type="date" id="actDate" value="${esc(e.date)}" required></label>
    <label>活動類型<select id="actKind">${Object.entries(ACTIVITY_KINDS).map(([k, v]) => `<option value="${k}"${k === e.kind ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <div class="act-picked" aria-label="出席的狗">${e.dogs.length ? e.dogs.map((d, i) => `<button type="button" data-act-remove="${i}" aria-label="移除 ${esc(d.name)}">${esc(d.name)} ✕</button>`).join('') : '<span class="a-hint">還沒加入出席的狗</span>'}</div>
    <label>加入出席的狗<input type="search" id="actQuery" value="${esc(e.query)}" placeholder="輸入狗名或編號" autocomplete="off"></label>
    <div class="act-suggest" id="actSuggest">${actSuggestionsHtml()}</div>
    ${e.error ? `<p role="alert" class="act-error">${esc(e.error)}</p>` : ''}
    <div class="act-actions"><button type="submit" class="dep-open"${e.busy ? ' disabled aria-busy="true"' : ''}>${e.busy ? '儲存中…' : '儲存'}</button><button type="button" class="dep-open" data-act-cancel>取消</button></div>
  </form>`;
}

function activitiesHtml() {
  loadActivities();
  const title = '活動紀錄';
  if (activitiesData.state === 'loading' && !activitiesData.list.length) return section(title, '', '<p class="a-empty">讀取中…</p>', 'paw');
  if (activitiesData.state === 'error') return section(title, '', '<p role="alert">活動紀錄讀取失敗</p><button type="button" class="dep-open" data-act-retry>重新讀取</button>', 'paw');
  const list = activitiesData.list;
  const items = list.map(a => (actEdit && actEdit.id === a.id ? actFormHtml() : `<article class="act-item">
      <h3>${esc(actTitle(a))}<small>${a.dogs.length} 隻</small></h3>
      ${a.dogs.length ? `<ul class="act-dogs">${a.dogs.map(actDogHtml).join('')}</ul>` : '<p class="a-hint">沒有出席名單</p>'}
      <div class="act-actions"><button type="button" class="rest-admin-btn" data-act-edit="${esc(a.id)}">修改</button><button type="button" class="rest-admin-btn" data-act-delete="${esc(a.id)}">刪除</button></div>
    </article>`)).join('');
  const add = actEdit && !actEdit.id ? actFormHtml() : '<button type="button" class="dep-open" data-act-new>新增活動</button>';
  return section(title, '動保小小兵、認養會出席的狗；選好名字就能新增、修改、刪除，改動記在編輯紀錄', add + (list.length ? items : '<p class="a-empty">還沒有活動紀錄</p>'), 'paw');
}

function startActEdit(a) {
  actEdit = a
    ? { id: a.id, date: a.date, kind: a.kind, dogs: a.dogs.map(d => ({ dogId: d.dogId, number: d.number, name: d.name })), query: '', busy: false, error: '' }
    : { id: '', date: actToday(), kind: 'adoption', dogs: [], query: '', busy: false, error: '' };
  render();
  document.getElementById('actDate')?.focus();
}

async function actRequest(method, path, body) {
  let res;
  try {
    res = await fetch(`${UPLOAD_URL}/activities${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, editor: editorName() }) });
  } catch (e) { throw new Error('沒有存進去，請確認網路後再試'); }
  const out = await res.json().catch(() => null);
  if (!res.ok || !out?.ok) throw new Error(out?.code === 'editor' ? NEED_EDITOR : out?.error || '沒有存進去，請稍後再試');
  return out;
}

async function saveActEdit() {
  const e = actEdit;
  if (!e || e.busy) return;
  if (!editorName()) { e.error = NEED_EDITOR; render(); return; }
  e.busy = true; e.error = '';
  render();
  try {
    const dogs = e.dogs.map(d => (d.dogId ? { dogId: d.dogId } : d.number ? { number: d.number } : { name: d.name }));
    await actRequest(e.id ? 'PUT' : 'POST', e.id ? `/${encodeURIComponent(e.id)}` : '', { date: e.date, kind: e.kind, dogs });
    actEdit = null;
    showToast('活動紀錄已儲存');
    loadActivities(true);
  } catch (err) {
    e.busy = false; e.error = err.message;
  }
  render();
}

async function removeActivity(a) {
  if (!editorName()) { showToast(NEED_EDITOR); return; }
  if (!confirm(`刪除「${actTitle(a)}」？出席名單會一起刪除，編輯紀錄會留下內容。`)) return;
  try {
    await actRequest('DELETE', `/${encodeURIComponent(a.id)}`, {});
    showToast(`已刪除 ${actTitle(a)}`);
    loadActivities(true);
  } catch (err) { showToast(err.message); }
}

document.getElementById('main').addEventListener('click', e => {
  if (!analysisOpen || infoPage !== 'activities' || !e.target.closest) return;
  const find = id => activitiesData?.list.find(a => a.id === id);
  const at = sel => e.target.closest(sel);
  if (at('[data-act-retry]')) loadActivities(true);
  else if (at('[data-act-new]')) startActEdit(null);
  else if (at('[data-act-edit]')) startActEdit(find(at('[data-act-edit]').dataset.actEdit));
  else if (at('[data-act-delete]')) { const a = find(at('[data-act-delete]').dataset.actDelete); if (a) removeActivity(a); }
  else if (at('[data-act-cancel]')) { actEdit = null; render(); }
  else if (actEdit && at('[data-act-remove]')) { actEdit.dogs.splice(Number(at('[data-act-remove]').dataset.actRemove), 1); render(); }
  else if (actEdit && (at('[data-act-add]') || at('[data-act-add-name]'))) {
    const number = at('[data-act-add]')?.dataset.actAdd;
    const dog = number && allDogs.find(d => d.id === number);
    actEdit.dogs.push(dog ? { dogId: null, number, name: dog.name } : { dogId: null, number: '', name: actEdit.query.trim() });
    actEdit.query = '';
    render();
    document.getElementById('actQuery')?.focus();
  }
});
document.getElementById('main').addEventListener('input', e => {
  if (!actEdit) return;
  if (e.target.id === 'actQuery') { actEdit.query = e.target.value; const box = document.getElementById('actSuggest'); if (box) box.innerHTML = actSuggestionsHtml(); }
  if (e.target.id === 'actDate') actEdit.date = e.target.value;
  if (e.target.id === 'actKind') actEdit.kind = e.target.value;
});
document.getElementById('main').addEventListener('submit', e => {
  if (e.target.id !== 'actForm') return;
  e.preventDefault();
  saveActEdit();
});
