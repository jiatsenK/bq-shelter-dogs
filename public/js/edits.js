// 編輯紀錄頁（edits.html，ADR 0004）：列出最近的編輯，新到舊。純函式在前面（tests/index.html 會測），畫面在後面。

const EDITS_URL = 'api/edits?limit=200';
const EDITS_DOGS_URL = 'api/dogs';

function editsEsc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 台灣時間「10/16 14:05」
function editsWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

// 改前／改後內容寫成一行字
function editsValue(kind, v) {
  if (kind === 'fixed-care') return v ? '開啟' : '關閉';
  if (v === null || v === undefined || v === '') return '（沒有）';
  if (kind === 'intro' && typeof v === 'object' && Array.isArray(v.events)) {
    return [...v.events.map(e => `${e.date || '日期未確認'} ${e.event}${e.number ? `（${e.number}）` : ''}`), v.text].filter(Boolean).join('\n');
  }
  if (kind === 'volunteer_rename') return v.name;
  if (kind === 'volunteer_merge') {
    const person = p => p.name + '（常溜 ' + p.favorites + '、開卡 ' + p.cards + '、溜狗來源紀錄 ' + p.walkRows + '）';
    return v.source ? person(v.source) + ' ＋ ' + person(v.target) : v.name;
  }
  if (kind === 'rest') return `休養到 ${v.until}${v.reason ? `（${v.reason}）` : ''}`;
  if (kind === 'group') return `${v.label || '（沒有群名）'}：${(v.names || []).join('、') || '（沒有狗）'}`;
  if (kind === 'walkundo') return `上次溜 ${v.date || '沒溜過'}${v.walker ? `（${v.walker}）` : ''}`;
  if (kind === 'photo') return v.trash ? `舊照片在垃圾桶：${v.trash}` : (v.path ? '新照片' : '（沒有）');
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function editsItemHtml(e, names) {
  const dog = e.dogNumber ? `${names[e.dogNumber] || ''} ${e.dogNumber}`.trim() : names[e.dogId] || '';
  return `<li>
    <div class="head"><span class="who">${editsEsc(e.editorName)}</span><span class="what">${editsEsc(e.kindLabel || e.kind)}</span>${dog ? `<span>${editsEsc(dog)}</span>` : ''}<span class="when">${editsEsc(editsWhen(e.at))}</span></div>
    <dl class="diff"><dt>改前</dt><dd>${editsEsc(editsValue(e.kind, e.before))}</dd><dt>改後</dt><dd>${editsEsc(editsValue(e.kind, e.after))}</dd></dl>
  </li>`;
}

// #421 嵌在資訊頁時，上次讀到的紀錄留在上層頁面的記憶體：切回資料編輯先顯示，每次打開仍向 API 確認；
// 讀不到保留先前內容。單獨打開或上層讀不到（不同網站等）就沒有先前內容，照常讀取。
// api/edits 回 ETag（private, no-cache）：cache: 'no-cache' 讓瀏覽器帶 If-None-Match，沒有新編輯時 Worker 回 304、不讀整份紀錄。
function editsCacheHost() {
  try { return window.parent !== window && window.parent.document ? window.parent : null; } catch (e) { return null; }
}

function editsShow(list, cache) {
  list.innerHTML = cache.edits.map(e => editsItemHtml(e, cache.names)).join('');
}

async function editsLoad() {
  const status = document.getElementById('status');
  const list = document.getElementById('list');
  const retry = document.getElementById('retry');
  if (!status || !list) return;
  const host = editsCacheHost();
  let cache = null;
  try {
    const saved = host && host.bqEditsCache;
    if (saved && Array.isArray(saved.edits) && saved.names && typeof saved.names === 'object' && typeof saved.at === 'number') { editsShow(list, saved); cache = saved; }
  } catch (e) { list.innerHTML = ''; /* 先前內容壞掉就當沒有 */ }
  const when = cache && editsWhen(cache.at);
  status.textContent = cache ? `讀取 ${when}・檢查中…` : '讀取中…';
  if (retry) retry.hidden = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const [res, dogsRes] = await Promise.all([fetch(EDITS_URL, { cache: 'no-cache', signal: controller.signal }), fetch(EDITS_DOGS_URL).catch(() => null)]);
    const out = await res.json();
    if (!res.ok || !out.ok) throw new Error(out.error || '讀不到');
    const names = {};
    try {
      const d = dogsRes && dogsRes.ok ? await dogsRes.json() : null;
      for (const dog of (d && d.dogs) || []) {
        if (dog.id) names[dog.id] = dog.name;
        if (dog.dogId) names[dog.dogId] = dog.name;
      }
    } catch (e) { /* 沒有狗名就只顯示編號 */ }
    const fresh = { edits: out.edits, names: Object.keys(names).length ? names : (cache ? cache.names : names), at: Date.now() };
    editsShow(list, fresh);
    try { if (host) host.bqEditsCache = fresh; } catch (e) { /* 存不了就下次重讀 */ }
    status.textContent = out.edits.length ? '' : '還沒有編輯紀錄';
  } catch (e) {
    status.textContent = cache ? `讀不到新的編輯紀錄，顯示 ${when} 讀取的內容` : '暫時讀不到編輯紀錄';
    if (retry) retry.hidden = false;
  } finally { clearTimeout(timeout); }
}

if (typeof document !== 'undefined' && document.getElementById('list')) {
  document.getElementById('retry')?.addEventListener('click', editsLoad);
  editsLoad();
}
