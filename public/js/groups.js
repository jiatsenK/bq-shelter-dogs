import { BQStore } from './store.js';
import { groupsState } from './page-state.js';
import { BQApi } from './api.js';

// 常溜狗群頁（groups.html，K 2026-10-16）：讀 api/dogs 的 groupColumns 列出每一群；加狗、移出、開新群送 POST api/groups，
// Worker 轉給小程式改試算表「常遛狗群」分頁，成功後回這一群最新的名單，畫面直接換掉，不用等同步
// 呼叫 /api 經過 js/api.js 的 BQApi（#478）；目前沒有頁面載入這支檔

 groupsState.gDogs = [];      // 主清單的狗 { name, cage }
 groupsState.gColumns = [];   // [{ column, label, names }]
 groupsState.gBusy = false;

const gEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 編輯要先選好名字（ADR 0004 編輯紀錄）：跟溜狗表共用同一個 localStorage（js/app.js 的 WALKER_NAME_KEY）
function gEditor() {
  try { return String(BQStore.get(BQStore.keys.walkerName) || '').trim().replace(/經常帶.*$/, '').trim(); } catch (e) { return ''; }
}
const gKey = n => String(n || '').replace(/\s+/g, '').toLowerCase();

function gMessage(text, kind = '') {
  const box = document.getElementById('gMsg');
  box.textContent = text;
  box.className = `g-msg ${kind}`;
}

// 打的狗名換成主清單的寫法；對不到回空字串
function gDogName(text) {
  const dog = groupsState.gDogs.find(d => gKey(d.name) === gKey(text));
  return dog ? dog.name : '';
}

function gDogTile(name, column) {
  const dog = groupsState.gDogs.find(d => d.name === name);
  const cage = dog && dog.cage ? `<span class="cage">${gEsc(dog.cage)}</span>` : '';
  const remove = column === undefined ? ''
    : `<button type="button" data-remove="${gEsc(name)}" data-column="${column}" aria-label="把${gEsc(name)}移出這一群">×</button>`;
  return `<span class="g-dog">${gEsc(name)}${cage}${remove}</span>`;
}

function gRender() {
  const box = document.getElementById('gGroups');
  const shown = groupsState.gColumns.filter(g => g.names.length || g.label);
  box.innerHTML = shown.length ? shown.map(g => `
    <section class="g-card">
      <h2>${gEsc(g.label || '（沒有群名）')}<small>${g.names.length} 隻</small></h2>
      <div class="g-dogs">${g.names.length ? g.names.map(n => gDogTile(n, g.column)).join('') : '<p class="g-empty">這一群還沒有狗</p>'}</div>
      <form class="g-form add" data-column="${g.column}">
        <label>加一隻狗 <input name="name" list="gDogNames" maxlength="30" required autocomplete="off" placeholder="狗名"></label>
        <button type="submit">加進這一群</button>
      </form>
    </section>`).join('') : '<p class="g-empty">還沒有任何狗群</p>';
  const grouped = new Set(groupsState.gColumns.flatMap(g => g.names));
  const lone = groupsState.gDogs.filter(d => !grouped.has(d.name));
  document.getElementById('gLone').innerHTML = lone.length ? lone.map(d => gDogTile(d.name)).join('') : '<p class="g-empty">每隻狗都有群了</p>';
  document.getElementById('gDogNames').innerHTML = groupsState.gDogs.map(d => `<option value="${gEsc(d.name)}">`).join('');
}

async function gSend(body) {
  if (groupsState.gBusy) return null;
  const editor = gEditor();
  if (!editor) { gMessage('請先選好你的名字再編輯（到溜狗表開頭畫面點自己的名字）', 'err'); return null; }
  body = { ...body, editor };
  groupsState.gBusy = true;
  document.querySelectorAll('.g-main button').forEach(b => { b.disabled = true; });
  gMessage('寫入試算表中…');
  try {
    const r = await BQApi.saveGroup(body);
    if (r.error === 'network') throw new Error(r.message);
    const out = r.data;
    if (!r.ok || !out || !out.ok) throw new Error((out && out.error) || `寫入失敗（${r.status}）`);
    const i = groupsState.gColumns.findIndex(g => g.column === out.group.column);
    if (i === -1) groupsState.gColumns.push(out.group); else groupsState.gColumns[i] = out.group;
    groupsState.gColumns.sort((a, b) => a.column - b.column);
    gRender();
    return out;
  } catch (e) {
    gMessage(e.message || '寫入失敗，請稍後再試', 'err');
    return null;
  } finally {
    groupsState.gBusy = false;
    document.querySelectorAll('.g-main button').forEach(b => { b.disabled = false; });
  }
}

document.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-remove]');
  if (!btn) return;
  const name = btn.dataset.remove;
  const column = Number(btn.dataset.column);
  const group = groupsState.gColumns.find(g => g.column === column);
  if (!confirm(`把「${name}」移出「${(group && group.label) || '這一群'}」？`)) return;
  const out = await gSend({ op: 'remove', column, name });
  if (out) gMessage(out.status === 'notFound' ? `「${name}」已經不在這一群了` : `已把「${name}」移出`, 'ok');
});

document.addEventListener('submit', async e => {
  const form = e.target.closest('form');
  if (!form) return;
  e.preventDefault();
  const name = gDogName(form.elements.name.value);
  if (!name) { gMessage('主清單上找不到這隻狗，請從清單選', 'err'); return; }
  if (form.id === 'gNewForm') {
    const label = form.elements.label.value.trim();
    const out = await gSend({ op: 'create', label, name });
    if (out) { form.reset(); gMessage(`已開新群「${label}」`, 'ok'); }
    return;
  }
  const out = await gSend({ op: 'add', column: Number(form.dataset.column), name });
  if (out) gMessage(out.status === 'already' ? `「${name}」本來就在這一群` : `已把「${name}」加進去`, 'ok');
});

async function gLoad() {
  try {
    const r = await BQApi.dogs();
    const data = r.data;
    if (!r.ok || !data || !Array.isArray(data.dogs)) throw new Error();
    groupsState.gDogs = data.dogs.filter(d => d && d.name).map(d => ({ name: String(d.name).trim(), cage: String(d.cage || '').trim() }));
    groupsState.gColumns = Array.isArray(data.groupColumns) ? data.groupColumns : [];
    gRender();
  } catch (e) {
    document.getElementById('gGroups').innerHTML = '<p class="g-empty">讀不到狗群，請重新整理再試一次</p>';
  }
}

gLoad();

export { gEsc, gEditor, gKey, gMessage, gDogName, gDogTile, gRender, gSend, gLoad };
export { groupsState } from './page-state.js';
