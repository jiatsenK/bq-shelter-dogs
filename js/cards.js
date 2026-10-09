// 板收明星隊球員卡（cards.html）：電腦版展示（K 2026-10-09 看過原型選球員卡）。
// 只讀 data/dogs.json、data/walks.json，不寫試算表；收集冊記在各自的瀏覽器（localStorage）。
// 純函式在前面（tests/index.html 會測），畫面在後面。

const BQ_DATA_URL = 'data/dogs.json';
const BQ_WALKS_URL = 'data/walks.json';
const BQ_BOOK_KEY = 'bq-cards-book';
const BQ_PACK_SIZE = 5;

// 隊伍照犬舍分；顏色是卡面色帶和收集冊的隊伍標
const BQ_TEAMS = [
  { key: 'new', name: '新犬舍隊', test: c => /^新/.test(c), color: '#1F5C9E' },
  { key: 'old', name: '舊犬舍隊', test: c => /^舊/.test(c), color: '#0F6B6B' },
  { key: 'mom', name: '幼母隊', test: c => /^母幼/.test(c), color: '#875700' },
  { key: 'c', name: 'C 區隊', test: c => /^C/i.test(c), color: '#2F7A45' },
  { key: 'ward', name: '住院區隊', test: c => /^住院/.test(c), color: '#6E4A9E' },
];
const BQ_FREE = { key: 'free', name: '自由球員', test: () => true, color: '#55605B' };

// 卡的等級看在所多久：等越久的狗卡越閃，讓最久的被看見
const BQ_TIERS = [
  { key: 'holo', name: '雷射卡', min: 7, note: '在所 7 年以上' },
  { key: 'gold', name: '金卡', min: 5, note: '在所 5 到 7 年' },
  { key: 'silver', name: '銀卡', min: 3, note: '在所 3 到 5 年' },
  { key: 'base', name: '普卡', min: -Infinity, note: '在所 3 年以內' },
];

function bqTeamOf(cage) {
  const c = String(cage || '').replace(/\s/g, '');
  return BQ_TEAMS.find(t => t.test(c)) || BQ_FREE;
}
function bqMakeDate(y, m, d) {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}
function bqParseYmd(text) {
  const m = String(text || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? bqMakeDate(+m[1], +m[2], +m[3]) : null;
}
// 編號前 8 碼是入所日期（2024032902 → 2024/3/29）
function bqIntake(id) {
  const m = String(id || '').match(/^(\d{4})(\d{2})(\d{2})\d{2}$/);
  return m ? bqMakeDate(+m[1], +m[2], +m[3]) : null;
}
function bqTier(years) {
  return BQ_TIERS.find(t => (years == null ? -1 : years) >= t.min);
}
// 在所多久：「9年3個月」「8個月」「12天」
function bqStay(intake, today) {
  if (!intake) return '—';
  const days = Math.max(0, Math.floor((today - intake) / 86400000));
  if (days < 31) return `${Math.max(1, days)}天`;
  let months = (today.getFullYear() - intake.getFullYear()) * 12 + today.getMonth() - intake.getMonth();
  if (today.getDate() < intake.getDate()) months--;
  const y = Math.floor(months / 12), m = months % 12;
  return y ? (m ? `${y}年${m}個月` : `${y}年`) : `${Math.max(1, m)}個月`;
}

// 收容所的話取講個性的一兩句：跳過開頭的日期、從哪裡來，最多 40 個字
function bqQuote(intro) {
  const parts = String(intro || '').split(/[,，。；;！!？?\n]+/).map(s => s.trim()).filter(Boolean);
  const skip = s => /^\d{4}年|^\d+\/\d+|進來|進板收|拾獲|通報|送進|帶進|入所|捕捉/.test(s);
  const keep = parts.filter(s => !skip(s));
  if (!keep.length) return '';
  let out = keep[0];
  for (const p of keep.slice(1)) { if ([...out].length + [...p].length > 38) break; out += '，' + p; }
  return [...out].length > 40 ? [...out].slice(0, 39).join('') + '…' : out;
}

// 這個月每隻狗出門幾天（同一天溜幾次都算一天）
function bqMonthOut(walks, today) {
  const seen = new Set(), out = new Map();
  for (const w of walks || []) {
    const d = bqParseYmd(w && w.date);
    if (!d || d.getFullYear() !== today.getFullYear() || d.getMonth() !== today.getMonth()) continue;
    const key = `${w.id}|${w.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.set(String(w.id), (out.get(String(w.id)) || 0) + 1);
  }
  return out;
}

// dogs.json → 球員；沒有編號的列（試算表的「(阿拉丁)」暫住標記、還沒建檔的）不算
function bqPlayers(data, walks, today = new Date()) {
  if (!data || !Array.isArray(data.dogs)) throw new Error('dogs.json 格式不對');
  const pv = data.photoVersions && typeof data.photoVersions === 'object' ? data.photoVersions : {};
  const text = v => (v == null ? '' : String(v).trim());
  const month = bqMonthOut(walks, today);
  const players = data.dogs.filter(d => d && text(d.id) && text(d.name) && !/^[(（].*[)）]$/.test(text(d.name))).map(d => {
    const id = text(d.id);
    const intake = bqIntake(id);
    const years = intake ? (today - intake) / (365.25 * 86400000) : null;
    const thumb = `photos/thumbs/${id}.jpg`, full = `photos/${id}.jpg`;
    const ver = p => (pv[p] ? `${p}?v=${pv[p]}` : p);
    return {
      id, name: text(d.name), cage: text(d.cage),
      sex: d.sex === 'male' ? '公' : d.sex === 'female' ? '母' : '',
      quote: bqQuote(d.intro), intake, years, stay: bqStay(intake, today),
      number: '', team: bqTeamOf(d.cage), tier: bqTier(years),
      monthOut: month.get(id) || 0,
      // 正式網站的 dogs.json 帶照片版本號（有照片才有）；本機沒有版本號就照樣去抓，讀不到再補位
      hasPhoto: Object.keys(pv).length ? !!pv[full] : null,
      thumb: ver(thumb), photo: ver(full),
    };
  });
  // 背號照入隊順序：1 號是最資深的；沒有入所日期的排最後
  [...players].sort((a, b) => (a.intake ? a.intake.getTime() : Infinity) - (b.intake ? b.intake.getTime() : Infinity) || a.id.localeCompare(b.id))
    .forEach((p, i) => { p.number = String(i + 1); });
  return players;
}

// 年度獎項：全部是資料算出來的，不是投票
function bqAwards(players, today = new Date()) {
  const dated = players.filter(p => p.intake);
  const oldest = dated.reduce((m, p) => (!m || p.intake < m.intake ? p : m), null);
  const newest = dated.reduce((m, p) => (!m || p.intake > m.intake ? p : m), null);
  const walker = players.reduce((m, p) => (p.monthOut > (m ? m.monthOut : 0) ? p : m), null);
  const out = [];
  if (walker) out.push({ key: 'walker', title: '出門王', who: walker, value: walker.monthOut, unit: '天', note: `${today.getMonth() + 1} 月出門最多天` });
  if (oldest) out.push({ key: 'veteran', title: '資深球星', who: oldest, value: Math.floor(oldest.years), unit: '年', note: `${oldest.intake.getFullYear()} 年入隊，等最久` });
  if (newest && newest !== oldest) out.push({ key: 'rookie', title: '新人王', who: newest, value: Math.max(1, Math.round((today - newest.intake) / 86400000)), unit: '天', note: '最新入隊' });
  return out;
}

// 抽一包：先從還沒收到的抽（最多 4 張），剩下的從全部抽，同一包不重複；rand 可換掉方便測試
function bqDraw(players, got, n = BQ_PACK_SIZE, rand = Math.random) {
  const take = (pool, k, out) => {
    const left = pool.filter(p => !out.includes(p));
    while (k-- > 0 && left.length) out.push(left.splice(Math.floor(rand() * left.length), 1)[0]);
    return out;
  };
  const out = take(players.filter(p => !got[p.id]), n - 1, []);
  return take(players, n - out.length, out);
}

// ── 收集冊：{ current: 名字, books: { 名字: { got: { id: 收到幾次 }, packs: 開了幾包 } } } ──
// 每個瀏覽器自己一份；同一台電腦（K 拿給朋友玩）可以「換人收集」開新的一本
function bqEmptyBook() { return { got: {}, packs: 0 }; }
function bqLoadBooks(storage) {
  let raw = null;
  try { raw = storage && JSON.parse(storage.getItem(BQ_BOOK_KEY) || 'null'); } catch (e) { raw = null; }
  const books = raw && raw.books && typeof raw.books === 'object' ? raw.books : {};
  for (const k of Object.keys(books)) {
    const b = books[k];
    if (!b || typeof b.got !== 'object') books[k] = bqEmptyBook();
  }
  const current = raw && typeof raw.current === 'string' && books[raw.current] ? raw.current : Object.keys(books)[0] || '我的收集冊';
  if (!books[current]) books[current] = bqEmptyBook();
  return { current, books };
}
function bqSaveBooks(storage, state) {
  try { if (storage) storage.setItem(BQ_BOOK_KEY, JSON.stringify(state)); } catch (e) { /* 存不了就這次開著的期間記得 */ }
}
// 收進收集冊；回傳這包裡哪些是第一次收到
function bqCollect(book, cards) {
  const fresh = new Set();
  for (const c of cards) {
    if (!book.got[c.id]) fresh.add(c.id);
    book.got[c.id] = (book.got[c.id] || 0) + 1;
  }
  book.packs = (book.packs || 0) + 1;
  return fresh;
}
function bqBookName(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 12);
}

// ───────────── 畫面 ─────────────

function bqEsc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
const BQ_PAW = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><ellipse cx="5.5" cy="10" rx="2.3" ry="2.9" transform="rotate(-18 5.5 10)"/><ellipse cx="9.3" cy="5.6" rx="2.3" ry="3" transform="rotate(-6 9.3 5.6)"/><ellipse cx="14.7" cy="5.6" rx="2.3" ry="3" transform="rotate(6 14.7 5.6)"/><ellipse cx="18.5" cy="10" rx="2.3" ry="2.9" transform="rotate(18 18.5 10)"/><path d="M12 11c-2.7 0-6 3.6-6 6.6 0 1.8 1.3 2.9 3 2.9 1.2 0 2-.6 3-.6s1.8.6 3 .6c1.7 0 3-1.1 3-2.9 0-3-3.3-6.6-6-6.6z"/></g></svg>';

// 坐著的狗剪影（立耳台灣犬側面）：沒照片的卡、還沒收到的卡套都用它
const BQ_DOG = '<svg class="bq-dog" viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" d="M27 97l2-31c0-9 1-15 3-20l-10-2c-5-1-9-4-8-7 1-3 5-4 10-5l3-6 1-15 7 11h5l4-13 3 16c3 6 5 13 7 19 8 5 15 11 20 18 4 6 6 13 6 19 4-4 8-11 9-20 0-4 4-4 4 0 0 12-4 23-11 29l2 7H62l-1-6-5 6H45l1-6-6 6z"/></svg>';

// 照片：讀不到（或已知沒有）就換成隊色底＋剪影＋大背號，寫「照片補拍中」
function bqPhoto(p, src) {
  const miss = `<span class="bq-nophoto">${BQ_DOG}<b>${bqEsc(p.number)}</b><span>照片補拍中</span></span>`;
  if (p.hasPhoto === false) return miss;
  return `<img src="${bqEsc(src)}" alt="" decoding="async" onerror="this.outerHTML=this.dataset.miss" data-miss="${bqEsc(miss)}">`;
}
function bqDate(d) { return d ? `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}` : '—'; }

// 一張卡：正面照片、背號、隊伍、名字、守備位置（籠位）；背面資料
function bqCardHtml(p, opts = {}) {
  const { fresh = false, tag = 'div', big = false } = opts;
  const role = tag === 'button' ? 'type="button"' : 'role="button" tabindex="0"';
  return `<${tag} ${role} class="bq-card tier-${p.tier.key}${fresh ? ' fresh' : ''}" data-id="${bqEsc(p.id)}" style="--team:${p.team.color}" aria-label="${bqEsc(p.name)}，${bqEsc(p.tier.name)}，點了翻到背面">
    <span class="bq-in">
      <span class="bq-face">
        <span class="bq-ph">${bqPhoto(p, big ? p.photo : p.thumb)}<span class="bq-no">${bqEsc(p.number)}</span>${fresh ? '<span class="bq-new">NEW</span>' : ''}</span>
        <span class="bq-band">${bqEsc(p.team.name)}<span>${bqEsc(p.tier.name)}</span></span>
        <span class="bq-nm">${bqEsc(p.name)}</span>
        <span class="bq-pos"><span>守備位置 <b>${bqEsc(p.cage)}</b></span><span>${bqEsc(p.sex)}</span></span>
        <span class="bq-holo" aria-hidden="true"></span><span class="bq-glare" aria-hidden="true"></span>
      </span>
      <span class="bq-back" aria-hidden="true">
        <span class="bq-back-top"><b>${bqEsc(p.name)}</b><span>#${bqEsc(p.number)}</span></span>
        <span class="bq-set">BQ26・${bqEsc(p.number.padStart(3, '0'))}/${BQ.players.length || '—'}・${bqEsc(p.team.name)}</span>
        <span class="bq-stats">
          <span><em>入隊</em><b>${bqDate(p.intake)}</b></span>
          <span><em>球齡</em><b>${bqEsc(p.stay)}</b></span>
          <span><em>本月出賽</em><b><i>${p.monthOut}</i> 天</b></span>
        </span>
        <span class="bq-quote">${bqEsc(p.quote || '收容所還沒幫牠寫介紹。')}</span>
        <span class="bq-tier-note">${bqEsc(p.tier.name)}：${bqEsc(p.tier.note)}</span>
      </span>
    </span>
  </${tag}>`;
}

const BQ = { players: [], byId: new Map(), state: null, storage: null, today: new Date(), hand: [], still: false };

function bqBook() { return BQ.state.books[BQ.state.current]; }
function bqSave() { bqSaveBooks(BQ.storage, BQ.state); }

function bqRenderProgress() {
  const got = Object.keys(bqBook().got).filter(id => BQ.byId.has(id)).length;
  document.querySelectorAll('[data-bq=got]').forEach(el => { el.textContent = got; });
  document.querySelectorAll('[data-bq=total]').forEach(el => { el.textContent = BQ.players.length; });
  const link = document.querySelector('.bq-progress');
  if (link) link.setAttribute('aria-label', `收集冊：已收 ${got} 張，共 ${BQ.players.length} 張`);
  const bar = document.getElementById('bqBar');
  if (bar) bar.style.setProperty('--p', BQ.players.length ? (got / BQ.players.length).toFixed(3) : 0);
}

// 扇形發牌：五張的水平位置、旋轉、下沉；窄螢幕擠一點
function bqFan(i, n) {
  const mid = (n - 1) / 2, k = i - mid;
  const wide = innerWidth > 900;
  const card = document.querySelector('#bqHand .bq-card');
  const cw = (card && card.offsetWidth) || 200;
  const step = wide ? Math.min(cw * .98, (innerWidth - cw - 96) / Math.max(1, n - 1)) : Math.min(56, (innerWidth - cw - 40) / Math.max(1, n - 1));
  return `translate(${k * step}px, ${Math.abs(k) * (wide ? 26 : 10)}px) rotate(${k * (wide ? 4 : 3)}deg)`;
}
function bqDeal() {
  const book = bqBook();
  BQ.hand = bqDraw(BQ.players, book.got);
  const fresh = bqCollect(book, BQ.hand);
  bqSave();
  const hand = document.getElementById('bqHand');
  hand.innerHTML = BQ.hand.map(p => bqCardHtml(p, { fresh: fresh.has(p.id) })).join('');
  const cards = [...hand.querySelectorAll('.bq-card')];
  cards.forEach((c, i) => {
    c.dataset.base = bqFan(i, cards.length);
    c.style.zIndex = String(i + 1);
    if (BQ.still) { c.style.transform = c.dataset.base; c.classList.add('dealt'); return; }
    setTimeout(() => { c.style.transform = c.dataset.base; c.classList.add('dealt'); }, 140 + i * 120);
  });
  const freshN = fresh.size;
  document.getElementById('bqDealNote').textContent = freshN ? `新收 ${freshN} 張，已收進收集冊` : '這包都收過了，再開一包';
  bqRenderProgress();
  bqRenderBinder();
}
function bqOpenPack() {
  const field = document.getElementById('bqField');
  if (field.classList.contains('tearing') || field.classList.contains('opened')) return;
  // 先撕掉上緣那條、卡包往下掉，卡片再從開口升起來攤開（減少動態時直接攤開）
  field.classList.add('tearing');
  setTimeout(() => { field.classList.add('opened'); bqDeal(); }, BQ.still ? 0 : 520);
  setTimeout(() => field.classList.remove('tearing'), BQ.still ? 0 : 1400);
  const first = document.querySelector('#bqHand .bq-card');
  if (first) setTimeout(() => first.focus({ preventScroll: true }), BQ.still ? 0 : 700);
}

// 滑鼠傾斜＋雷射反光（減少動態時不傾斜）
function bqTilt(e) {
  if (BQ.still || e.pointerType === 'touch') return;
  const c = e.target.closest('#bqHand .bq-card, #bqModalCard .bq-card');
  if (!c) return;
  const r = c.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
  c.classList.add('lift');
  c.style.transform = c.dataset.base
    ? `${c.dataset.base} translateY(-26px) scale(1.07) rotateY(${(px - .5) * 26}deg) rotateX(${(.5 - py) * 22}deg)`
    : `rotateY(${(px - .5) * 30}deg) rotateX(${(.5 - py) * 24}deg)`;
  c.style.setProperty('--hx', `${(px * 100).toFixed(1)}%`);
  c.style.setProperty('--hy', `${(py * 100).toFixed(1)}%`);
}
function bqUntilt(e) {
  const c = e.target.closest('#bqHand .bq-card, #bqModalCard .bq-card');
  if (!c || c.contains(e.relatedTarget)) return;
  c.classList.remove('lift');
  c.style.transform = c.dataset.base || '';
}

function bqRenderAwards() {
  const box = document.getElementById('bqAwards');
  box.innerHTML = bqAwards(BQ.players, BQ.today).map((a, i) => `<article class="bq-trophy" style="--team:${a.who.team.color}">
    <div class="bq-trophy-in">
      <button type="button" class="bq-trophy-ph" data-open="${bqEsc(a.who.id)}" aria-label="看 ${bqEsc(a.who.name)} 的球員卡">${bqPhoto(a.who, a.who.photo)}</button>
      <span class="bq-ribbon">${bqEsc(a.title)}</span>
      <div class="bq-trophy-tx"><div><h3>${bqEsc(a.who.name)}</h3><p>${bqEsc(a.note)}・${bqEsc(a.who.cage)}</p></div><p class="bq-trophy-n"><b>${a.value}</b>${a.unit}</p></div>
      <p class="bq-trophy-set">BQ26 年度獎項 ${i + 1}/3・#${bqEsc(a.who.number)} ${bqEsc(a.who.team.name)}</p>
    </div>
  </article>`).join('');
}

function bqRenderBooks() {
  const names = Object.keys(BQ.state.books);
  document.getElementById('bqBookName').textContent = BQ.state.current;
  document.getElementById('bqBooks').innerHTML = names.length > 1
    ? names.map(n => `<button type="button" class="bq-book-chip${n === BQ.state.current ? ' on' : ''}" data-book="${bqEsc(n)}" aria-pressed="${n === BQ.state.current}">${bqEsc(n)}</button>`).join('')
    : '';
}
function bqRenderBinder() {
  const got = bqBook().got;
  const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  const teams = [...BQ_TEAMS, BQ_FREE].map(t => ({ t, list: BQ.players.filter(p => p.team.key === t.key).sort((a, b) => natural(a.cage, b.cage) || natural(a.name, b.name)) })).filter(g => g.list.length);
  document.getElementById('bqBinder').innerHTML = teams.map(({ t, list }) => {
    const n = list.filter(p => got[p.id]).length;
    return `<section class="bq-sheet" style="--team:${t.color}" aria-label="${bqEsc(t.name)}">
      <h3><span>${bqEsc(t.name)}</span><small><b>${n}</b> / ${list.length}</small></h3>
      <div class="bq-pockets">${list.map(p => got[p.id]
        ? `<button type="button" class="bq-pocket got tier-${p.tier.key}" data-open="${bqEsc(p.id)}" aria-label="${bqEsc(p.name)}，${bqEsc(p.tier.name)}${got[p.id] > 1 ? `，收到 ${got[p.id]} 張` : ''}">
            <span class="bq-pocket-ph">${bqPhoto(p, p.thumb)}</span><span class="bq-pocket-nm">${bqEsc(p.name)}</span>${got[p.id] > 1 ? `<span class="bq-dup">×${got[p.id]}</span>` : ''}</button>`
        : `<span class="bq-pocket" aria-label="還沒收到：背號 ${bqEsc(p.number)}"><span class="bq-pocket-q">${BQ_DOG}<b>${bqEsc(p.number)}</b></span><span class="bq-pocket-nm">？</span></span>`).join('')}</div>
    </section>`;
  }).join('');
}

// 大卡：點收集冊或獎項的照片，放大看、可以翻面
let bqOpener = null;
function bqOpen(id, opener) {
  const p = BQ.byId.get(id);
  if (!p) return;
  bqOpener = opener || null;
  const modal = document.getElementById('bqModal');
  document.getElementById('bqModalCard').innerHTML = bqCardHtml(p, { tag: 'button', big: true });
  modal.hidden = false;
  document.documentElement.classList.add('bq-modal-open');
  document.querySelector('#bqModalCard .bq-card').focus({ preventScroll: true });
}
function bqClose() {
  const modal = document.getElementById('bqModal');
  if (modal.hidden) return;
  modal.hidden = true;
  document.documentElement.classList.remove('bq-modal-open');
  document.getElementById('bqModalCard').innerHTML = '';
  if (bqOpener && bqOpener.isConnected) bqOpener.focus({ preventScroll: true });
  bqOpener = null;
}

function bqBind() {
  document.getElementById('bqPack').addEventListener('click', bqOpenPack);
  document.getElementById('bqAgain').addEventListener('click', bqDeal);
  const hand = document.getElementById('bqHand');
  hand.addEventListener('pointermove', bqTilt);
  hand.addEventListener('pointerout', bqUntilt);
  const flip = e => { const c = e.target.closest('.bq-card'); if (c) c.classList.toggle('flipped'); };
  hand.addEventListener('click', flip);
  hand.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.bq-card')) { e.preventDefault(); flip(e); } });
  const big = document.getElementById('bqModalCard');
  big.addEventListener('click', flip);
  big.addEventListener('pointermove', bqTilt);
  big.addEventListener('pointerout', bqUntilt);
  document.addEventListener('click', e => {
    const open = e.target.closest('[data-open]');
    if (open) { bqOpen(open.dataset.open, open); return; }
    if (e.target.id === 'bqModal' || e.target.closest('#bqClose')) { bqClose(); return; }
    const chip = e.target.closest('[data-book]');
    if (chip) { BQ.state.current = chip.dataset.book; bqSave(); bqRenderBooks(); bqRenderBinder(); bqRenderProgress(); }
  });
  document.addEventListener('keydown', e => {
    if (document.getElementById('bqModal').hidden) return;
    if (e.key === 'Escape') bqClose();
    if (e.key === 'Tab') { e.preventDefault(); const c = document.querySelector('#bqModalCard .bq-card'); (document.activeElement === c ? document.getElementById('bqClose') : c).focus(); }
  });
  // 換人收集：輸入名字開一本新的（已經有這個名字就切過去）
  const form = document.getElementById('bqNewBook');
  document.getElementById('bqSwitch').addEventListener('click', () => {
    form.hidden = !form.hidden;
    document.getElementById('bqSwitch').setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) form.querySelector('input').focus();
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = bqBookName(form.querySelector('input').value);
    if (!name) { form.querySelector('input').focus(); return; }
    if (!BQ.state.books[name]) BQ.state.books[name] = bqEmptyBook();
    BQ.state.current = name;
    bqSave();
    form.reset(); form.hidden = true;
    document.getElementById('bqSwitch').setAttribute('aria-expanded', 'false');
    bqRenderBooks(); bqRenderBinder(); bqRenderProgress();
  });
  addEventListener('resize', () => document.querySelectorAll('#bqHand .bq-card').forEach((c, i, all) => { c.dataset.base = bqFan(i, all.length); c.style.transform = c.dataset.base; }));
}

async function bqInit() {
  BQ.still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { BQ.storage = window.localStorage; } catch (e) { BQ.storage = null; }
  BQ.state = bqLoadBooks(BQ.storage);
  bqBind();
  try {
    const [res, walks] = await Promise.all([
      fetch(BQ_DATA_URL, { cache: 'no-cache' }),
      fetch(BQ_WALKS_URL, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    BQ.players = bqPlayers(data, walks && walks.walks, BQ.today);
    BQ.byId = new Map(BQ.players.map(p => [p.id, p]));
    if (data.syncedAt) {
      const d = new Date(data.syncedAt);
      if (!isNaN(d)) document.getElementById('bqUpdated').textContent = `球員資料 ${d.getMonth() + 1}/${d.getDate()} 更新`;
    }
  } catch (e) {
    console.error(e);
    document.getElementById('bqField').classList.add('failed');
    document.getElementById('bqPackNote').textContent = '球員資料讀不到，請重新整理頁面';
    document.getElementById('bqPack').disabled = true;
    return;
  }
  document.getElementById('bqField').classList.add('ready');
  bqRenderProgress();
  bqRenderAwards();
  bqRenderBooks();
  bqRenderBinder();
}

if (typeof document !== 'undefined' && document.getElementById('bqField')) bqInit();
