// 小遊戲頁（#795）：選單、狗狗變裝秀（遊戲中、結算）、分享截圖。出題與裝飾的規則在 dress-up.js。
// 網址：games.html 是選單、games.html#dressup 是狗狗變裝秀；返回鍵一層一層回去，選單再返回回資訊頁（ADR 0024 的規則）
import { BQApi } from './api.js';
import { bindOverlays, backFrom, closeOverlay, leaveTo, pushOverlay, pushPage, registerOverlay, replacePage, writeHistory } from './overlays.js';
import { DECOS, LIMIT_MS, Q_COUNT, dressUp, optionNames, playableDogs, points, shuffle, zoomToFace } from './dress-up.js';

const $ = id => document.getElementById(id);
const BEST_KEY = 'bq-game-dressup-best';
const GAME_HASH = '#dressup';
const INTRO = '考驗乾爹乾媽們，在狗狗們變裝後，還能認出幾成？';
const S = { dogs: [], sigs: {}, qs: [], i: 0, score: 0, right: 0, missed: [], t0: 0, raf: 0, next: 0, locked: true, round: 0, shot: null, shotUrl: '' };

// 最高分只記在這支手機；讀寫不了（無痕、被擋）就當沒有紀錄
function readBest() { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; } }
function writeBest(n) { try { localStorage.setItem(BEST_KEY, String(n)); } catch (e) { /* 存不了就算了 */ } }

const gameUrl = () => new URL('games.html' + GAME_HASH, location.href).href;
const shareText = () => `我在「狗狗變裝秀」認出 ${S.right} / ${S.qs.length} 隻變裝的板收狗狗，拿到 ${S.score} 分！換你來試試 ${gameUrl()}`;
const playing = () => !$('gPlay').hidden || !$('gEnd').hidden;

// 每張縮圖縮成 4×4 色塊當「長相」，選項挑顏色最像的狗
function signature(img) {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, 4, 4);
  return Array.from(x.getImageData(0, 0, 4, 4).data).filter((_, i) => i % 4 !== 3);
}

const loadImg = src => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

async function loadDogs() {
  const [res, faces] = await Promise.all([
    BQApi.dogs(),
    fetch('data/dog-faces.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
  ]);
  if (!res.ok) throw new Error(res.message || `HTTP ${res.status}`);
  S.dogs = playableDogs(res.data, faces);
  // 長相算完才開放開始，第一題的選項就是長得像的狗；縮圖讀不到的那隻選項用隨機
  await Promise.all(S.dogs.map(d => loadImg(d.thumb).then(img => { S.sigs[d.id] = signature(img); }).catch(() => {})));
}

function show(id) {
  for (const s of ['gHub', 'gPlay', 'gEnd']) $(s).hidden = s !== id;
  $('gTitle').textContent = id === 'gHub' ? '小遊戲' : '狗狗變裝秀';
  window.scrollTo(0, 0);
}

// 停掉倒數和下一題，之後不會再跳題
function stop() {
  cancelAnimationFrame(S.raf);
  clearTimeout(S.next);
  S.locked = true;
  S.round++;
}

function showHub() {
  stop();
  if (!$('gSheet').hidden) hideShot();
  show('gHub');
}

function start() {
  if (!S.dogs.length) return;
  stop();
  S.i = 0; S.score = 0; S.right = 0; S.missed = [];
  S.qs = shuffle(S.dogs).slice(0, Q_COUNT).map(dog => ({ dog, opts: null, decos: [] }));
  $('gScore').textContent = '0';
  $('gCount').textContent = S.qs.length;
  show('gPlay');
  ask();
}

// 一個裝飾的 SVG；attrs 是畫面用的位置樣式，或分享截圖用的 xmlns 與像素大小
function decoSvg(key, attrs) {
  const k = DECOS[key];
  return `<svg ${attrs} viewBox="0 0 ${k.vb[0]} ${k.vb[1]}" preserveAspectRatio="none">${k.svg}</svg>`;
}
const decoOnPhoto = p => decoSvg(p.key, `aria-hidden="true" data-deco="${p.key}" style="left:${p.left}%;top:${p.top}%;width:${p.width}%;height:${p.height}%;transform-origin:${p.ox * 100}% ${p.oy * 100}%;transform:rotate(${p.deg}deg)"`);

function ask() {
  const q = S.qs[S.i], round = S.round;
  const current = () => round === S.round && S.qs[S.i] === q; // 照片晚到時已經換題或回選單，就不動畫面
  q.opts = optionNames(q.dog, S.dogs, S.sigs);
  $('gNo').textContent = S.i + 1;
  const pic = $('gPic'), stage = $('gStage');
  $('gDeco').innerHTML = '';
  $('gPicErr').hidden = true;
  stage.style.transform = ''; stage.style.transformOrigin = '';
  // 照片讀完、戴好裝飾才顯示：換 src 後瀏覽器會繼續顯示上一張（或讀到一半的新照片），不藏就會露出沒變裝的狗
  pic.hidden = true;
  // 倒數從照片出現（或確定讀不到）才開始，照片慢不吃作答時間
  const go = () => { S.locked = false; S.t0 = performance.now(); tick(); };
  pic.onload = () => {
    if (!current()) return;
    const size = [pic.naturalWidth, pic.naturalHeight];
    const z = zoomToFace(size, q.dog.face);
    q.zoom = z;
    q.decos = dressUp(size, q.dog.face);
    stage.style.transformOrigin = `${z.o[0]}% ${z.o[1]}%`;
    stage.style.transform = `translate(${z.t[0]}%,${z.t[1]}%) scale(${z.k}) rotate(${z.deg}deg)`;
    $('gDeco').innerHTML = q.decos.map(decoOnPhoto).join('');
    pic.hidden = false;
    go();
  };
  pic.onerror = () => {
    if (!current()) return;
    $('gPicErr').hidden = false;
    go();
  };
  pic.src = q.dog.photo;
  $('gSay').textContent = ''; $('gSay').className = 'g-say';
  $('gOpts').innerHTML = '';
  for (const name of q.opts) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = name;
    b.addEventListener('click', () => answer(name));
    $('gOpts').appendChild(b);
  }
  $('gBar').style.transform = 'scaleX(1)';
}

function tick() {
  const left = Math.max(0, 1 - (performance.now() - S.t0) / LIMIT_MS);
  $('gBar').style.transform = `scaleX(${left})`;
  $('gBar').parentElement.setAttribute('aria-valuenow', Math.ceil(left * LIMIT_MS / 1000));
  if (left <= 0) return answer(null);
  S.raf = requestAnimationFrame(tick);
}

function answer(name) {
  if (S.locked) return;
  S.locked = true;
  cancelAnimationFrame(S.raf);
  const q = S.qs[S.i], ok = name === q.dog.name;
  if (ok) { S.right++; S.score += points(performance.now() - S.t0); } else S.missed.push(q.dog);
  $('gScore').textContent = S.score;
  for (const b of $('gOpts').children) {
    if (b.textContent === q.dog.name) b.classList.add('ok');
    else if (b.textContent === name) b.classList.add('no');
    b.disabled = true;
  }
  $('gSay').className = 'g-say ' + (ok ? 'ok' : 'no');
  $('gSay').textContent = ok ? '答對了！' : name ? `牠是${q.dog.name}` : `時間到，牠是${q.dog.name}`;
  const round = S.round;
  S.next = setTimeout(() => {
    if (round !== S.round) return;
    S.i++;
    if (S.i < S.qs.length) ask(); else finish();
  }, ok ? 900 : 1600);
}

function finish() {
  stop();
  show('gEnd');
  $('gEndScore').textContent = S.score;
  $('gEndLine').textContent = `認出 ${S.right} / ${S.qs.length} 隻`;
  $('gMissed').innerHTML = '';
  for (const d of S.missed) {
    const f = document.createElement('figure');
    const img = document.createElement('img');
    img.src = d.thumb; img.alt = d.name;
    const c = document.createElement('figcaption');
    c.textContent = d.name;
    f.append(img, c);
    $('gMissed').appendChild(f);
  }
  $('gMissedWrap').hidden = !S.missed.length;
  const best = readBest();
  if (S.score > best) writeBest(S.score);
  $('gBest').textContent = S.score > best ? '新紀錄！' : `你的最高分是 ${best}`;
  $('gShare').textContent = '分享結果';
  prepareShot();
}

// ---- 分享截圖：分數和這局前四隻變裝狗畫成一張 1080×1440 的圖（不寫名字，看圖的人才能猜），最下面印遊戲網址 ----

// 照遊戲畫面的方式畫一隻狗：照片裁成正方形、拉近狗臉，再把裝飾一個個轉成圖片貼上
async function drawDog(ctx, q, x, y, size) {
  const u = size / 100;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary-soft').trim(); ctx.fillRect(x, y, size, size);
  let img;
  try { img = await loadImg(q.dog.photo); } catch (e) { ctx.restore(); return; }
  const z = q.zoom || zoomToFace([img.naturalWidth, img.naturalHeight], q.dog.face);
  const decos = q.decos.length ? q.decos : dressUp([img.naturalWidth, img.naturalHeight], q.dog.face);
  ctx.translate(x + (z.o[0] + z.t[0]) * u, y + (z.o[1] + z.t[1]) * u);
  ctx.scale(z.k, z.k); ctx.rotate(z.deg * Math.PI / 180);
  ctx.translate(-z.o[0] * u, -z.o[1] * u);
  const s = Math.max(size / img.naturalWidth, size / img.naturalHeight);
  ctx.drawImage(img, (size - img.naturalWidth * s) / 2, (size - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
  for (const p of decos) {
    const W = p.width * u, H = p.height * u;
    const svg = decoSvg(p.key, `xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"`);
    const pic = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
    ctx.save();
    ctx.translate(p.left * u + p.ox * W, p.top * u + p.oy * H);
    ctx.rotate(p.deg * Math.PI / 180);
    ctx.drawImage(pic, -p.ox * W, -p.oy * H, W, H);
    ctx.restore();
  }
  ctx.restore();
}

async function shotCanvas() {
  const W = 1080, H = 1440, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d'), css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
  const font = (w, px) => `${w} ${px}px ${v('--font')}`;
  ctx.fillStyle = v('--bg'); ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = v('--shell'); ctx.fillRect(0, 0, W, 230);
  ctx.fillStyle = '#fff'; ctx.font = font(900, 76); ctx.fillText('狗狗變裝秀', 72, 128);
  ctx.fillStyle = v('--shell-soft'); ctx.font = font(400, 34); ctx.fillText(INTRO, 72, 190);
  ctx.fillStyle = v('--ink'); ctx.font = font(900, 150); ctx.fillText(String(S.score), 72, 420);
  ctx.font = font(700, 50); ctx.fillText(`認出 ${S.right} / ${S.qs.length} 隻`, 72, 500);
  const size = 360, gap = 30, x0 = (W - size * 2 - gap) / 2, y0 = 545;
  const qs = S.qs.slice(0, 4);
  for (let i = 0; i < qs.length; i++) await drawDog(ctx, qs[i], x0 + (i % 2) * (size + gap), y0 + Math.floor(i / 2) * (size + gap), size);
  ctx.fillStyle = v('--ink-soft'); ctx.font = font(400, 34); ctx.textAlign = 'center';
  ctx.fillText('你認得出牠們是誰嗎？', W / 2, H - 90);
  // 網址印在圖上，圖被存下來、轉傳也找得到遊戲；太長就縮小字到放得下
  const url = gameUrl().replace(/^https?:\/\//, '');
  let px = 36;
  ctx.font = font(700, px);
  while (ctx.measureText(url).width > W - 144 && px > 20) ctx.font = font(700, --px);
  ctx.fillStyle = v('--primary');
  ctx.fillText(url, W / 2, H - 36);
  return c;
}

// 截圖在結算一出來就先畫，按「分享結果」時馬上能叫出手機的分享（等太久瀏覽器會當成不是使用者按的）
async function makeShot() {
  const c = await shotCanvas();
  const blob = await new Promise((resolve, reject) => c.toBlob(x => (x ? resolve(x) : reject(new Error('toBlob'))), 'image/png'));
  S.shot = new File([blob], 'dog-dressup.png', { type: 'image/png' });
  if (S.shotUrl) URL.revokeObjectURL(S.shotUrl);
  S.shotUrl = URL.createObjectURL(blob);
}

const canShareShot = () => !!(navigator.canShare && navigator.canShare({ files: [S.shot] }));
const shareShot = () => navigator.share({ files: [S.shot], title: '狗狗變裝秀', text: shareText() });

// 分享結果：截圖和網址（文字裡、也印在圖上）一起交給手機的分享；不能分享檔案（電腦、舊瀏覽器）就打開截圖讓人存
async function shareResult() {
  const b = $('gShare'), round = S.round;
  b.disabled = true; b.textContent = '產生中…';
  try {
    await S.shotReady;
  } catch (e) {
    console.error(e);
    b.disabled = false; b.textContent = '截圖失敗，再試一次';
    prepareShot();
    return;
  }
  b.disabled = false; b.textContent = '分享結果';
  if (round !== S.round) return;
  if (canShareShot()) {
    try { await shareShot(); return; } catch (e) { if (e.name === 'AbortError') return; } // 自己取消就算了；其他失敗改開截圖
  }
  openSheet();
}

function prepareShot() {
  S.shotReady = makeShot();
  S.shotReady.catch(() => {}); // 失敗等按分享結果時再說
}

function openSheet() {
  $('gSheetImg').src = S.shotUrl;
  $('gSheetUrl').textContent = $('gSheetUrl').href = gameUrl();
  $('gSheetShare').hidden = !canShareShot();
  $('gSheet').hidden = false;
  pushOverlay('gameShot');
  ($('gSheetShare').hidden ? $('gSheetClose') : $('gSheetShare')).focus();
}

function hideShot() {
  $('gSheet').hidden = true;
  $('gShare').focus({ preventScroll: true });
}

function bind() {
  registerOverlay('gameShot', { isOpen: () => !$('gSheet').hidden, hide: hideShot });
  // 網址：遊戲中、結算是 #dressup，選單沒有 hash
  bindOverlays(e => {
    if (e.state && e.state.game) { if (!playing()) start(); } else showHub();
  }, state => (state.game ? GAME_HASH : location.pathname + location.search));
  $('gDressUp').addEventListener('click', () => { pushPage({}, { game: 'dressup' }); start(); });
  $('gAgain').addEventListener('click', start);
  $('gShare').addEventListener('click', shareResult);
  $('gSheetClose').addEventListener('click', () => closeOverlay('gameShot'));
  $('gSheetShare').addEventListener('click', () => shareShot().catch(() => {}));
  $('gSheet').addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlay('gameShot'); });
  // 左上角返回：遊戲中、結算回選單；選單回資訊頁
  $('gBack').addEventListener('click', e => {
    e.preventDefault();
    if (!playing()) { leaveTo('index.html#info'); return; }
    backFrom(state => !!(state && state.game), () => { replacePage({}); showHub(); });
  });
}

export async function startGames() {
  bind();
  const fromLink = location.hash === GAME_HASH;
  // 打開網頁的那一筆一律是選單；從分享連結（#dressup）進來的，讀完資料再多一筆遊戲，返回回到選單
  writeHistory('replaceState', { bqLanding: true }, location.pathname + location.search);
  try {
    await loadDogs();
  } catch (e) {
    console.error(e);
    $('gHubNote').textContent = '狗狗資料讀不到，請確認網路後重新整理。';
    return;
  }
  if (!S.dogs.length) { $('gHubNote').textContent = '目前沒有可以出題的狗狗。'; return; }
  $('gHubNote').textContent = `每題 10 秒，答得越快分數越高・目前有 ${S.dogs.length} 隻狗狗可以出題`;
  $('gDressUp').disabled = false;
  if (fromLink) { pushPage({}, { game: 'dressup' }); start(); }
}
