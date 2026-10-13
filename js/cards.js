// 板收圖鑑（cards.html）：電腦版溜狗表頁首「圖鑑」進來（K 2026-10-10）。
// 每隻狗一張球員卡，你溜過的才拿得到；上次來之後新溜的狗包成卡包自己撕。沒溜過的狗也看得到，只是還沒有卡。
// 「你是誰」用溜狗表「我溜過」設定的代號；開卡紀錄存 D1、localStorage 備援，不寫試算表、不顯示志工名字。
// 純函式在前面（tests/index.html 會測），畫面在後面。

const BQ_DATA_URL = 'data/dogs.json';
const BQ_WALKS_URL = 'data/walks.json';
const BQ_CODES_KEY = 'bq-walker-codes'; // 溜狗表（js/app.js）存的我的代號
const BQ_WRITES_KEY = 'bq-sheet-writes'; // 溜狗表今天按過的溜了（還沒同步進 walks.json 的）
const BQ_OPENED_KEY = 'bq-zukan'; // 撕開過的卡：{ v: 1, codes: { 代號: { 狗編號: 撕開那天 } } }
const BQ_CODE_PATTERN = /^[0-9a-f]{12}$/;
const BQ_PACK_SIZE = 5;

// 隊伍照犬舍分；顏色是卡面色帶和圖鑑的隊伍標
// 分區、隊名、隊色在 js/site-config.js（cards.html 先載入）
const BQ_TEAMS = SITE.zones.map(z => ({ key: z.key, name: z.team, test: z.test, color: z.color }));
const BQ_FREE = { key: SITE.freeTeam.key, name: SITE.freeTeam.team, test: () => true, color: SITE.freeTeam.color };

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
function bqYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

// ── 你是誰、你溜過誰 ──
function bqLoadCodes(storage) {
  try {
    const list = JSON.parse((storage && storage.getItem(BQ_CODES_KEY)) || 'null');
    return Array.isArray(list) ? list.filter(c => BQ_CODE_PATTERN.test(c)) : [];
  } catch (e) { return []; }
}
// 今天在溜狗表按的「溜了」（還沒同步）：跟 js/app.js 的 loadSheetWrites 同一份，只看今天、記成我的
function bqTodayWrites(storage, today) {
  try {
    const raw = JSON.parse((storage && storage.getItem(BQ_WRITES_KEY)) || 'null');
    if (!raw || raw.date !== bqYmd(today) || !raw.items || typeof raw.items !== 'object') return [];
    return Object.values(raw.items).filter(it => it && it.mine && it.id && it.current && it.current.date === raw.date).map(it => ({ id: String(it.id), date: raw.date }));
  } catch (e) { return []; }
}
// 我溜過的狗：{ 編號: { times: 幾天, first, last } }。跟「我溜過」同一個規則：同一隻狗同一天以最後一筆為準（先記了我、後來拿掉就不算）
function bqMyDogs(walks, codes, todayWrites = []) {
  const mine = new Map();
  if (!codes.length) return mine;
  const text = v => (v == null ? '' : String(v).trim());
  const last = new Map();
  (walks || []).forEach(w => { if (w && Array.isArray(w.walkers) && text(w.id)) last.set(`${text(w.id)}|${w.date}`, w); });
  const days = [...last.values()].filter(w => w.walkers.some(c => codes.includes(c))).map(w => ({ id: text(w.id), date: w.date }));
  const seen = new Set();
  for (const { id, date } of [...days, ...todayWrites]) {
    const d = bqParseYmd(date);
    if (!d || seen.has(`${id}|${date}`)) continue;
    seen.add(`${id}|${date}`);
    const m = mine.get(id) || { times: 0, first: d, last: d };
    m.times++;
    if (d < m.first) m.first = d;
    if (d > m.last) m.last = d;
    mine.set(id, m);
  }
  return mine;
}

// ── 撕開過的卡：記在這個瀏覽器，跟著代號走（同一台電腦換人設定代號，就是另一個人的圖鑑） ──
function bqLoadOpened(storage) {
  try {
    const raw = JSON.parse((storage && storage.getItem(BQ_OPENED_KEY)) || 'null');
    if (raw && raw.v === 1 && raw.codes && typeof raw.codes === 'object') return raw;
  } catch (e) { /* 壞掉就重來 */ }
  return { v: 1, codes: {} };
}
function bqSaveOpened(storage, state) {
  // 別的頁籤可能剛開過卡，不能用這頁載入時的舊狀態蓋掉它。
  const saved = bqLoadOpened(storage);
  for (const [code, book] of Object.entries(saved.codes)) {
    state.codes[code] = { ...state.codes[code], ...book };
  }
  try {
    if (!storage) return false;
    const text = JSON.stringify(state);
    storage.setItem(BQ_OPENED_KEY, text);
    return storage.getItem(BQ_OPENED_KEY) === text;
  } catch (e) { return false; } // 這次開著的期間仍保留記憶，畫面說明未能儲存
}
function bqOpenedIds(state, codes) {
  const out = new Set();
  for (const c of codes) for (const id of Object.keys((state.codes[c]) || {})) out.add(id);
  return out;
}
function bqMarkOpened(state, codes, ids, today) {
  for (const c of codes) {
    const book = state.codes[c] || (state.codes[c] = {});
    for (const id of ids) if (!book[id]) book[id] = bqYmd(today);
  }
}
// 還沒撕開的新卡：最近溜的先出；只算現在還在所裡的狗
function bqPending(players, mine, opened) {
  return players.filter(p => mine.has(p.id) && !opened.has(p.id)).sort((a, b) => mine.get(b.id).last - mine.get(a.id).last || a.number - b.number);
}

// ───────────── 畫面 ─────────────

function bqEsc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// 坐著的狗剪影（立耳台灣犬側面）：沒照片的卡用它
const BQ_DOG = '<svg class="bq-dog" viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" d="M27 97l2-31c0-9 1-15 3-20l-10-2c-5-1-9-4-8-7 1-3 5-4 10-5l3-6 1-15 7 11h5l4-13 3 16c3 6 5 13 7 19 8 5 15 11 20 18 4 6 6 13 6 19 4-4 8-11 9-20 0-4 4-4 4 0 0 12-4 23-11 29l2 7H62l-1-6-5 6H45l1-6-6 6z"/></svg>';
const BQ_PAW = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><ellipse cx="5.5" cy="10" rx="2.3" ry="2.9" transform="rotate(-18 5.5 10)"/><ellipse cx="9.3" cy="5.6" rx="2.3" ry="3" transform="rotate(-6 9.3 5.6)"/><ellipse cx="14.7" cy="5.6" rx="2.3" ry="3" transform="rotate(6 14.7 5.6)"/><ellipse cx="18.5" cy="10" rx="2.3" ry="2.9" transform="rotate(18 18.5 10)"/><path d="M12 11c-2.7 0-6 3.6-6 6.6 0 1.8 1.3 2.9 3 2.9 1.2 0 2-.6 3-.6s1.8.6 3 .6c1.7 0 3-1.1 3-2.9 0-3-3.3-6.6-6-6.6z"/></g></svg>';

// 照片：讀不到（或已知沒有）就換成隊色底＋剪影＋大背號，寫「照片補拍中」
function bqPhoto(p, src) {
  const miss = `<span class="bq-nophoto">${BQ_DOG}<b>${bqEsc(p.number)}</b><span>照片補拍中</span></span>`;
  if (p.hasPhoto === false) return miss;
  return `<img src="${bqEsc(src)}" alt="" decoding="async" loading="lazy" onerror="this.outerHTML=this.dataset.miss" data-miss="${bqEsc(miss)}">`;
}
function bqDate(d) { return d ? `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}` : '—'; }

// 一張卡：正面照片、背號、隊伍、名字、守備位置（籠位）；背面資料。
// locked：還沒溜過的狗，灰卡、不閃，背面寫溜過就拿得到
function bqCardHtml(p, opts = {}) {
  const { fresh = false, tag = 'div', big = false, mine = null } = opts;
  const locked = !mine;
  const role = tag === 'button' ? 'type="button"' : 'role="button" tabindex="0"';
  const tierName = locked ? '還沒拿到' : p.tier.name;
  return `<${tag} ${role} class="bq-card tier-${locked ? 'locked' : p.tier.key}${fresh ? ' fresh' : ''}" data-id="${bqEsc(p.id)}" style="--team:${p.team.color}" aria-label="${bqEsc(p.name)}，${bqEsc(tierName)}，點了翻到背面">
    <span class="bq-in">
      <span class="bq-face">
        <span class="bq-ph">${bqPhoto(p, big ? p.photo : p.thumb)}<span class="bq-no">${bqEsc(p.number)}</span>${fresh ? '<span class="bq-new">NEW</span>' : ''}</span>
        <span class="bq-band">${bqEsc(p.team.name)}<span>${bqEsc(tierName)}</span></span>
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
          <span><em>本月出門</em><b><i>${p.monthOut}</i> 天</b></span>
          ${mine ? `<span><em>你溜過</em><b><i>${mine.times}</i> 天</b></span>` : ''}
        </span>
        <span class="bq-quote">${bqEsc(p.quote || '收容所還沒幫牠寫介紹。')}</span>
        <span class="bq-tier-note">${locked ? `溜過${bqEsc(p.name)}就拿得到這張卡` : `${bqEsc(p.tier.name)}：${bqEsc(p.tier.note)}・第一次溜 ${bqDate(mine.first)}`}</span>
      </span>
    </span>
  </${tag}>`;
}

const BQ = { players: [], byId: new Map(), storage: null, today: new Date(), codes: [], mine: new Map(), opened: null, pending: [], hand: [], still: false, walksOk: true, remote: 'loading', saving: false };

async function bqRemoteOpened(codes, ids) {
  const res = await fetch(ids ? '/api/cards/opened' : `/api/cards/opened?codes=${encodeURIComponent(codes.join(','))}`, ids
    ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codes, ids }), signal: AbortSignal.timeout(15000) }
    : { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const out = await res.json();
  if (!res.ok || !out.ok) throw new Error('開卡紀錄暫時無法同步');
  return out;
}
async function bqSyncOpened() {
  if (!BQ.codes.length || BQ.saving) return;
  BQ.remote = 'loading';
  bqRenderCta();
  try {
    const { opened } = await bqRemoteOpened(BQ.codes);
    // 只移入當前設定的人已開過的卡，不搬別人的資料。
    for (const code of BQ.codes) {
      const local = BQ.opened.codes[code] || {};
      const remote = opened.codes[code] || {};
      const missing = Object.keys(local).filter(id => BQ.byId.has(id) && !remote[id]);
      for (let i = 0; i < missing.length; i += 50) await bqRemoteOpened([code], missing.slice(i, i + 50));
      BQ.opened.codes[code] = { ...local, ...remote };
    }
    bqSaveOpened(BQ.storage, BQ.opened);
    BQ.remote = 'ready';
  } catch (e) { BQ.remote = 'error'; }
  bqRefreshOpened();
}

function bqOpenedSet() { return bqOpenedIds(BQ.opened, BQ.codes); }
function bqGotCount() { const o = bqOpenedSet(); return BQ.players.filter(p => o.has(p.id) && BQ.mine.has(p.id)).length; }

function bqRenderProgress() {
  const got = bqGotCount();
  document.querySelectorAll('[data-bq=got]').forEach(el => { el.textContent = got; });
  document.querySelectorAll('[data-bq=total]').forEach(el => { el.textContent = BQ.players.length; });
  const link = document.querySelector('.bq-progress');
  if (link) link.setAttribute('aria-label', `圖鑑：已拿到 ${got} 張，共 ${BQ.players.length} 張`);
  const bar = document.getElementById('bqBar');
  if (bar) bar.style.setProperty('--p', BQ.players.length ? (got / BQ.players.length).toFixed(3) : 0);
}

// 扇形攤開：五張的水平位置、旋轉、下沉；窄螢幕擠一點
function bqFan(i, n) {
  const mid = (n - 1) / 2, k = i - mid;
  const wide = innerWidth > 900;
  const card = document.querySelector('#bqHand .bq-card');
  const cw = (card && card.offsetWidth) || 200;
  const step = wide ? Math.min(cw * .98, (innerWidth - cw - 96) / Math.max(1, n - 1)) : Math.min(56, (innerWidth - cw - 40) / Math.max(1, n - 1));
  // 往下沉的一半扣回來：扇形整體的中心跟卡包的中心同高（撕開前後主角不跳）
  const s = wide ? 26 : 10;
  return `translate(${k * step}px, ${Math.abs(k) * s - Math.floor(n / 2) * s / 2}px) rotate(${k * (wide ? 4 : 3)}deg)`;
}
function bqShowHand(cards, freshIds, instant) {
  BQ.hand = cards;
  const hand = document.getElementById('bqHand');
  hand.innerHTML = cards.map(p => bqCardHtml(p, { fresh: freshIds.has(p.id), mine: BQ.mine.get(p.id) })).join('');
  [...hand.querySelectorAll('.bq-card')].forEach((c, i, all) => {
    c.dataset.base = bqFan(i, all.length);
    c.style.zIndex = String(i + 1);
    if (BQ.still || instant) { c.style.transform = c.dataset.base; c.classList.add('dealt'); return; }
    setTimeout(() => { c.style.transform = c.dataset.base; c.classList.add('dealt'); }, 140 + i * 120);
  });
}

// 圖鑑標題右邊那一塊：還沒設定你是誰／還沒溜過／有新卡（開卡包按鈕）／都開完了
function bqRenderCta() {
  const box = document.getElementById('bqCta');
  const n = BQ.pending.length;
  if (!BQ.codes.length) {
    box.innerHTML = '<p class="bq-cta-note">先在溜狗表的「我溜過」輸入你的名字，你溜過的狗就會變成你的卡。</p><a class="bq-cta-btn" href="index.html#mine">去設定</a>';
  } else if (BQ.remote !== 'ready') {
    box.innerHTML = BQ.remote === 'loading' ? '<p class="bq-cta-note">正在讀取已開卡紀錄…</p>' : '<p class="bq-cta-note" role="status">開卡紀錄暫時無法同步，請重試。</p><button type="button" class="bq-cta-btn" id="bqRetry">重試</button>';
  } else if (!BQ.walksOk && !n) {
    box.innerHTML = '<p class="bq-cta-note">溜狗紀錄讀不到，請重新整理頁面。</p>';
  } else if (n) {
    const packs = Math.ceil(n / BQ_PACK_SIZE);
    box.innerHTML = `<button type="button" class="bq-cta-btn bq-open" id="bqOpen"><span class="bq-open-pack" aria-hidden="true">${BQ_PAW}</span><span class="bq-open-t"><b>開卡包</b><small>${n} 張新卡${packs > 1 ? `・${packs} 包` : ''}</small></span></button>`;
  } else if (!BQ.mine.size) {
    box.innerHTML = '<p class="bq-cta-note">還沒有你的溜狗紀錄。溜完狗、按了「溜了」，回來就有卡包。</p>';
  } else {
    box.innerHTML = '<p class="bq-cta-note">新卡都開完了。下次溜完再來開。</p>';
  }
}
function bqRenderAgain() {
  const left = Math.ceil(BQ.pending.length / BQ_PACK_SIZE);
  const again = document.getElementById('bqAgain');
  again.hidden = !left;
  again.textContent = left > 1 ? `再開一包（還有 ${left} 包）` : '再開一包';
  document.getElementById('bqDone').hidden = false;
}

async function bqDeal() {
  if (BQ.saving || BQ.remote !== 'ready') return;
  bqRefreshOpened();
  const cards = BQ.pending.slice(0, BQ_PACK_SIZE);
  if (!cards.length) return;
  BQ.saving = true;
  document.getElementById('bqAgain').disabled = true;
  document.getElementById('bqDealNote').textContent = '正在儲存開卡紀錄…';
  try {
    await bqRemoteOpened(BQ.codes, cards.map(p => p.id));
  } catch (e) {
    document.getElementById('bqDealNote').textContent = '開卡紀錄未儲存，請重新開啟卡包再試。';
    document.getElementById('bqField').classList.remove('opened', 'tearing');
    document.getElementById('bqPackCount').textContent = `${cards.length} 張新卡`;
    return;
  } finally {
    BQ.saving = false;
    document.getElementById('bqAgain').disabled = false;
  }
  bqMarkOpened(BQ.opened, BQ.codes, cards.map(p => p.id), BQ.today);
  bqSaveOpened(BQ.storage, BQ.opened);
  BQ.pending = bqPending(BQ.players, BQ.mine, bqOpenedSet());
  bqShowHand(cards, new Set(cards.map(p => p.id)), false);
  document.getElementById('bqDealNote').textContent = `拿到 ${cards.length} 張，已收進圖鑑`;
  document.getElementById('bqPackCount').textContent = '';
  bqRenderAgain();
  bqRenderProgress();
  bqRenderBinder();
  bqRenderCta();
}
// 按「開卡包」：球場蓋住畫面、卡包掉進來；撕開、攤開五張；「收進圖鑑」或 Esc 回圖鑑
let bqFieldOpener = null;
function bqRefreshOpened() {
  if (!BQ.opened) return;
  const saved = bqLoadOpened(BQ.storage);
  for (const [code, book] of Object.entries(saved.codes)) {
    BQ.opened.codes[code] = { ...BQ.opened.codes[code], ...book };
  }
  BQ.pending = bqPending(BQ.players, BQ.mine, bqOpenedSet());
  bqRenderCta();
  bqRenderProgress();
  bqRenderBinder();
  if (!document.getElementById('bqField').hidden) bqRenderAgain();
}
async function bqOpenField(opener) {
  if (BQ.remote === 'loading' || BQ.saving) return;
  await bqSyncOpened();
  if (BQ.remote !== 'ready') return;
  bqRefreshOpened();
  if (!BQ.pending.length) return;
  const field = document.getElementById('bqField');
  bqFieldOpener = opener || null;
  field.classList.remove('tearing', 'opened');
  document.getElementById('bqHand').innerHTML = '';
  document.getElementById('bqAgain').hidden = true;
  document.getElementById('bqDone').hidden = true;
  const n = BQ.pending.length;
  document.getElementById('bqPackCount').textContent = `${Math.min(n, BQ_PACK_SIZE)} 張新卡`;
  field.hidden = false;
  document.documentElement.classList.add('bq-modal-open');
  document.getElementById('bqPack').focus({ preventScroll: true });
}
function bqCloseField() {
  const field = document.getElementById('bqField');
  if (field.hidden) return;
  field.hidden = true;
  field.classList.remove('tearing', 'opened');
  document.getElementById('bqHand').innerHTML = '';
  document.documentElement.classList.remove('bq-modal-open');
  const back = document.getElementById('bqOpen') || (bqFieldOpener && bqFieldOpener.isConnected ? bqFieldOpener : document.getElementById('bqBinderTitle'));
  bqFieldOpener = null;
  if (back && back.focus) back.focus({ preventScroll: true });
}
function bqOpenPack() {
  const field = document.getElementById('bqField');
  if (field.classList.contains('tearing') || field.classList.contains('opened') || !BQ.pending.length) return;
  // 先撕掉上緣那條、卡包往下掉，卡片再從開口升起來攤開（減少動態時直接攤開）
  field.classList.add('tearing');
  setTimeout(() => { field.classList.add('opened'); bqDeal(); }, BQ.still ? 0 : 520);
  setTimeout(() => field.classList.remove('tearing'), BQ.still ? 0 : 1400);
  setTimeout(() => { const first = document.querySelector('#bqHand .bq-card'); if (first) first.focus({ preventScroll: true }); }, BQ.still ? 0 : 900);
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

// 圖鑑：全部的狗照犬舍分；拿到的是亮卡，溜過還沒撕的是卡背，沒溜過的照片淡淡的
function bqRenderBinder() {
  const opened = bqOpenedSet();
  const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  const state = p => (!BQ.mine.has(p.id) ? 'locked' : opened.has(p.id) ? 'got' : 'pending');
  const teams = [...BQ_TEAMS, BQ_FREE].map(t => ({ t, list: BQ.players.filter(p => p.team.key === t.key).sort((a, b) => natural(a.cage, b.cage) || natural(a.name, b.name)) })).filter(g => g.list.length);
  document.getElementById('bqBinder').innerHTML = teams.map(({ t, list }) => {
    const n = list.filter(p => state(p) === 'got').length;
    return `<section class="bq-sheet" style="--team:${t.color}" aria-label="${bqEsc(t.name)}">
      <h3><span>${bqEsc(t.name)}</span><small><b>${n}</b> / ${list.length}</small></h3>
      <div class="bq-pockets">${list.map(p => {
        const s = state(p);
        if (s === 'pending') return `<button type="button" class="bq-pocket pending" data-to-pack aria-label="${bqEsc(p.name)}，還沒撕開，按了開卡包"><span class="bq-pocket-back">${BQ_PAW}<b>待開</b></span><span class="bq-pocket-nm">${bqEsc(p.name)}</span></button>`;
        return `<button type="button" class="bq-pocket ${s === 'got' ? `got tier-${p.tier.key}` : 'locked'}" data-open="${bqEsc(p.id)}" aria-label="${bqEsc(p.name)}，${s === 'got' ? bqEsc(p.tier.name) : '還沒溜過'}">
            <span class="bq-pocket-ph">${bqPhoto(p, p.thumb)}</span><span class="bq-pocket-nm">${bqEsc(p.name)}</span></button>`;
      }).join('')}</div>
    </section>`;
  }).join('');
}

// 大卡：點圖鑑或獎項的照片，放大看、可以翻面
let bqOpener = null;
function bqOpen(id, opener) {
  const p = BQ.byId.get(id);
  if (!p) return;
  bqOpener = opener || null;
  const mine = BQ.mine.has(id) && bqOpenedSet().has(id) ? BQ.mine.get(id) : null;
  const modal = document.getElementById('bqModal');
  document.getElementById('bqModalCard').innerHTML = bqCardHtml(p, { tag: 'button', big: true, mine });
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
  addEventListener('storage', e => { if (e.key === BQ_OPENED_KEY) bqRefreshOpened(); });
  addEventListener('pageshow', () => bqRefreshOpened());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) bqRefreshOpened(); });
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
    if (e.target.closest('#bqRetry')) { bqSyncOpened(); return; }
    const open = e.target.closest('[data-open]');
    if (open) { bqOpen(open.dataset.open, open); return; }
    const toPack = e.target.closest('[data-to-pack], #bqOpen');
    if (toPack) { bqOpenField(toPack); return; }
    if (e.target.closest('#bqDone, #bqFieldClose')) { bqCloseField(); return; }
    if (e.target.id === 'bqModal' || e.target.closest('#bqClose')) bqClose();
  });
  document.addEventListener('keydown', e => {
    if (document.getElementById('bqModal').hidden) {
      // 開卡包的畫面：Esc 回圖鑑；Tab 留在這個畫面裡
      const field = document.getElementById('bqField');
      if (field.hidden) return;
      if (e.key === 'Escape') { bqCloseField(); return; }
      if (e.key === 'Tab') {
        const items = [...field.querySelectorAll('button:not([hidden]):not(:disabled), [tabindex="0"]')].filter(el => el.offsetParent !== null);
        if (!items.length) return;
        const at = items.indexOf(document.activeElement);
        e.preventDefault();
        items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      }
      return;
    }
    if (e.key === 'Escape') bqClose();
    if (e.key === 'Tab') { e.preventDefault(); const c = document.querySelector('#bqModalCard .bq-card'); (document.activeElement === c ? document.getElementById('bqClose') : c).focus(); }
  });
  addEventListener('resize', () => document.querySelectorAll('#bqHand .bq-card').forEach((c, i, all) => { c.dataset.base = bqFan(i, all.length); c.style.transform = c.dataset.base; }));
}

async function bqInit() {
  BQ.still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { BQ.storage = window.localStorage; } catch (e) { BQ.storage = null; }
  BQ.codes = bqLoadCodes(BQ.storage);
  BQ.opened = bqLoadOpened(BQ.storage);
  bqBind();
  let walks = null;
  try {
    const [res, w] = await Promise.all([
      fetch(BQ_DATA_URL, { cache: 'no-cache' }),
      fetch(BQ_WALKS_URL, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    walks = w && Array.isArray(w.walks) ? w.walks : null;
    BQ.walksOk = !!walks;
    BQ.players = bqPlayers(data, walks, BQ.today);
    BQ.byId = new Map(BQ.players.map(p => [p.id, p]));
    if (data.syncedAt) {
      const d = new Date(data.syncedAt);
      if (!isNaN(d)) document.getElementById('bqUpdated').textContent = `資料 ${d.getMonth() + 1}/${d.getDate()} 更新`;
    }
  } catch (e) {
    console.error(e);
    document.getElementById('bqCta').innerHTML = '<p class="bq-cta-note">狗的資料讀不到，請重新整理頁面。</p>';
    return;
  }
  BQ.mine = bqMyDogs(walks, BQ.codes, bqTodayWrites(BQ.storage, BQ.today));
  BQ.pending = bqPending(BQ.players, BQ.mine, bqOpenedSet());
  document.getElementById('bqField').classList.add('ready');
  bqRenderCta();
  bqRenderProgress();
  // 年度獎項先藏起來（K 2026-10-10）：cards.html 那一段拿掉 hidden 就會出現
  if (!document.querySelector('.bq-awards').hidden) bqRenderAwards();
  bqRenderBinder();
  await bqSyncOpened();
}

if (typeof document !== 'undefined' && document.getElementById('bqBinder')) bqInit();
