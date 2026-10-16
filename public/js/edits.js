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
  if (v === null || v === undefined || v === '') return '（沒有）';
  if (kind === 'volunteer_rename') return v.name;
  if (kind === 'volunteer_merge') {
    const person = p => p.name + '（常溜 ' + p.favorites + '、開卡 ' + p.cards + '、溜狗來源紀錄 ' + p.walkRows + '）';
    return v.source ? person(v.source) + ' ＋ ' + person(v.target) : v.name;
  }
  if (kind === 'rest') return `休養到 ${v.until}${v.reason ? `（${v.reason}）` : ''}`;
  if (kind === 'group') return `${v.label || '（沒有群名）'}：${(v.names || []).join('、') || '（沒有狗）'}`;
  if (kind === 'photo') return v.trash ? `舊照片在垃圾桶：${v.trash}` : (v.path ? '新照片' : '（沒有）');
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function editsItemHtml(e, names) {
  const dog = e.dogNumber ? `${names[e.dogNumber] || ''} ${e.dogNumber}`.trim() : '';
  return `<li>
    <div class="head"><span class="who">${editsEsc(e.editorName)}</span><span class="what">${editsEsc(e.kindLabel || e.kind)}</span>${dog ? `<span>${editsEsc(dog)}</span>` : ''}<span class="when">${editsEsc(editsWhen(e.at))}</span></div>
    <dl class="diff"><dt>改前</dt><dd>${editsEsc(editsValue(e.kind, e.before))}</dd><dt>改後</dt><dd>${editsEsc(editsValue(e.kind, e.after))}</dd></dl>
  </li>`;
}

async function editsLoad() {
  const status = document.getElementById('status');
  const list = document.getElementById('list');
  if (!status || !list) return;
  try {
    const [res, dogsRes] = await Promise.all([fetch(EDITS_URL, { cache: 'no-cache' }), fetch(EDITS_DOGS_URL).catch(() => null)]);
    const out = await res.json();
    if (!res.ok || !out.ok) throw new Error(out.error || '讀不到');
    const names = {};
    try {
      const d = dogsRes && dogsRes.ok ? await dogsRes.json() : null;
      for (const dog of (d && d.dogs) || []) if (dog.id) names[dog.id] = dog.name;
    } catch (e) { /* 沒有狗名就只顯示編號 */ }
    list.innerHTML = out.edits.map(e => editsItemHtml(e, names)).join('');
    status.textContent = out.edits.length ? '' : '還沒有編輯紀錄';
  } catch (e) {
    status.textContent = '暫時讀不到編輯紀錄，請稍後重新整理';
  }
}

if (typeof document !== 'undefined' && document.getElementById('list')) editsLoad();
