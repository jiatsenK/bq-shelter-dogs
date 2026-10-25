import { groupsState } from './page-state.js';
import { BQApi } from './api.js';

// 舊獨立常溜狗群頁只能看，名單只在試算表「常遛狗群」分頁改（#474）。
// 呼叫 /api 經過 js/api.js 的 BQApi（#478）；目前沒有頁面載入這支檔

groupsState.gDogs = [];      // 主清單的狗 { name, cage }
groupsState.gColumns = [];   // [{ column, label, names }]
const gEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function gDogTile(name) {
  const dog = groupsState.gDogs.find(d => d.name === name);
  const cage = dog && dog.cage ? `<span class="cage">${gEsc(dog.cage)}</span>` : '';
  return `<span class="g-dog">${gEsc(name)}${cage}</span>`;
}

function gRender() {
  const box = document.getElementById('gGroups');
  const shown = groupsState.gColumns.filter(g => g.names.length || g.label);
  box.innerHTML = shown.length ? shown.map(g => `
    <section class="g-card">
      <h2>${gEsc(g.label || '（沒有群名）')}<small>${g.names.length} 隻</small></h2>
      <div class="g-dogs">${g.names.length ? g.names.map(n => gDogTile(n)).join('') : '<p class="g-empty">這一群還沒有狗</p>'}</div>
    </section>`).join('') : '<p class="g-empty">還沒有任何狗群</p>';
  const grouped = new Set(groupsState.gColumns.flatMap(g => g.names));
  const lone = groupsState.gDogs.filter(d => !grouped.has(d.name));
  document.getElementById('gLone').innerHTML = lone.length ? lone.map(d => gDogTile(d.name)).join('') : '<p class="g-empty">每隻狗都有群了</p>';
}

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

export { gEsc, gDogTile, gRender, gLoad };
export { groupsState } from './page-state.js';
