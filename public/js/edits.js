// 編輯紀錄頁（edits.html，ADR 0004）：列出最近的編輯，新到舊。純函式在前面（tests/index.html 會測），畫面在後面。

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
  if (kind === 'activity') return `${v.date} ${{ kids: '動保小小兵', adoption: '認養會' }[v.kind] || v.kind}：${(v.dogs || []).join('、') || '（沒有狗）'}`;
  if (kind === 'departed-card') return v.linkedTo ? `「${v.name}」接到編號 ${v.linkedTo}（${v.attendances} 筆出席）` : `${v.name}（離所 ${v.departed || '日期不明'}，接上 ${v.attendances} 筆出席）`;
  if (kind === 'walkundo' || kind === 'walkedit') return `上次溜 ${v.date || '沒溜過'}${v.walker ? `（${v.walker}）` : ''}`;
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

// #421 先顯示上次讀到的紀錄，背景再抓最新；抓不到不清空，標示是上次讀到的。
const EDITS_CACHE = BQStore.keys.editsCache;

async function editsLoad() {
  const status = document.getElementById('status');
  const list = document.getElementById('list');
  if (!status || !list) return;
  let cached = null;
  try {
    const c = BQStore.readJson(EDITS_CACHE);
    if (c && Array.isArray(c.edits) && c.names && typeof c.names === 'object') cached = c;
  } catch (e) { /* 沒有快取就照常讀取 */ }
  if (cached) {
    list.innerHTML = cached.edits.map(e => editsItemHtml(e, cached.names)).join('');
    status.textContent = cached.edits.length ? '' : '還沒有編輯紀錄';
  }
  try {
    const [res, dogsRes] = await Promise.all([BQApi.edits(), BQApi.dogs({ cache: 'default' })]);
    const out = res.data;
    if (!out) throw new Error(res.message);
    if (!res.ok || !out.ok) throw new Error(out.error || '讀不到');
    const names = {};
    try {
      const d = dogsRes.ok ? dogsRes.data : null;
      for (const dog of (d && d.dogs) || []) {
        if (dog.id) names[dog.id] = dog.name;
        if (dog.dogId) names[dog.dogId] = dog.name;
      }
    } catch (e) { /* 沒有狗名就只顯示編號 */ }
    list.innerHTML = out.edits.map(e => editsItemHtml(e, names)).join('');
    status.textContent = out.edits.length ? '' : '還沒有編輯紀錄';
    try { BQStore.writeJson(EDITS_CACHE, { edits: out.edits, names }); } catch (e) { /* 存不了下次就重新讀 */ }
  } catch (e) {
    status.textContent = cached ? '暫時讀不到最新編輯紀錄，以下是上次讀到的' : '暫時讀不到編輯紀錄，請稍後重新整理';
  }
}

if (typeof document !== 'undefined' && document.getElementById('list')) editsLoad();
