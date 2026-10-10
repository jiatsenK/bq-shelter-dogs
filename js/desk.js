// 電腦版溜狗表（K 2026-10-10，選「簡報＋全表」，全表可切「最近 30 天」）：寬螢幕（≥1100px）時溜狗表改成
// 上面今天的簡報（紅黃綠各幾隻、各區狀況），下面像試算表的全表（勾好幾隻一次登記溜了），右邊異動紀錄和休養中。
// 志工原本在試算表看整體狀況，電腦版要一樣一眼看完；手機照舊是 js/app.js 的狗卡／列表。
// 登記一樣走 setWalked（只寫「遛狗日期」「誰遛的」兩欄），這裡不另外寫試算表。

const DESK_MEDIA = typeof matchMedia === 'function' ? matchMedia('(min-width: 1100px)') : null;
function deskOn() {
  return !!(DESK_MEDIA && DESK_MEDIA.matches);
}

// 區域：照籠位開頭分；跟找狗的分區一樣大的分法，簡報一行一區
const DESK_ZONES = SITE.zones; // js/site-config.js
function deskZoneOf(dog) {
  const c = String(dog.cage || '').replace(/\s/g, '');
  return (DESK_ZONES.find(z => z.test(c)) || { key: 'other' }).key;
}

// 一隻狗在簡報、色條裡算哪一種：red、amber、sage（含固定有人照顧）、none（沒紀錄）、rest（休養中）
function deskBucket(s) {
  if (s.kind === 'rest') return 'rest';
  if (s.kind === 'covered') return 'sage';
  if (s.kind === 'dated') return s.days < 0 ? 'none' : s.level;
  return 'none';
}

// 異動紀錄（試算表狗清單下面那段）：新的在上面；開頭的日期拆出來加粗
function deskNoteParts(text) {
  const m = String(text || '').match(/^\s*((?:\d{4}\/)?\d{1,2}\/\d{1,2})\s*/);
  return m ? { date: m[1], rest: text.slice(m[0].length) } : { date: '', rest: String(text || '') };
}

let deskZone = 'all';
let deskSort = 'days'; // days（跟手機溜狗表同一個順序）、cage、name
let deskSortRev = false; // 同一欄再點一次就反過來排（K 2026-10-10：有三角形但不能切換）
let deskView = 'sheet'; // sheet（全表）、days30（最近 30 天）、fill（補資料：照片、入所原因）
let deskFill = 'all'; // 補資料要看哪些：all、photo（沒照片）、intro（沒入所原因）
let deskNotesAll = false;
const deskChecked = new Set(); // 勾起來要一起登記的狗（walkKey）
let deskWalkDays = null; // walkKey → Set(yyyy-mm-dd)，最近 30 天用；第一次切過去才讀 walks.json
let deskWalkFirst = '';
let deskWalksLoading = false;

const deskNatural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
function deskSorted(list) {
  const out = deskSort === 'cage' ? [...list].sort((a, b) => deskNatural(a.cage, b.cage) || deskNatural(a.name, b.name))
    : deskSort === 'name' ? [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
    : list;
  return deskSortRev ? [...out].reverse() : out;
}
// 現在這一欄是由大到小（▼）還是由小到大（▲）：天數預設最久沒溜的在上面，籠位、狗名預設由小到大
const deskSortDir = () => ((deskSort === 'days') !== deskSortRev ? 'descending' : 'ascending');

function deskBriefHtml(today) {
  const all = allDogs.map(d => ({ d, b: deskBucket(computeStatus(d, today)), s: computeStatus(d, today) }));
  const n = b => all.filter(x => x.b === b).length;
  const tile = (b, label, cls) => `<div class="db-count ${cls}${n(b) ? '' : ' zero'}"><span class="db-tag ${cls}">${label}</span><span class="db-n"><b class="num">${n(b)}</b>隻</span></div>`;
  const zones = DESK_ZONES.map(z => {
    const list = all.filter(x => deskZoneOf(x.d) === z.key);
    if (!list.length) return '';
    const pct = b => `${(list.filter(x => x.b === b).length / list.length * 100).toFixed(2)}%`;
    const longest = list.filter(x => x.s.kind === 'dated' && x.s.days >= 0).sort((a, b) => b.s.days - a.s.days)[0];
    const red = list.filter(x => x.b === 'red').length, amber = list.filter(x => x.b === 'amber').length;
    return `<button type="button" class="db-zone${deskZone === z.key ? ' on' : ''}" data-desk-zone="${z.key}" aria-pressed="${deskZone === z.key}">
      <span class="db-zn">${z.name}<small class="num">${list.length}</small></span>
      <span class="db-bar" aria-hidden="true"><i class="red" style="width:${pct('red')}"></i><i class="amber" style="width:${pct('amber')}"></i><i class="none" style="width:${pct('none')}"></i><i class="sage" style="width:${pct('sage')}"></i></span>
      <span class="db-zs num">${red ? `<span class="r">紅 ${red}</span>` : ''}${amber ? `<span class="a">黃 ${amber}</span>` : ''}${!red && !amber ? '<span class="g">都在 3 天內</span>' : ''}</span>
      <span class="db-long">${longest ? `最久 <b>${esc(longest.d.name)}</b> <span class="lv-${longest.s.level}">${longest.s.days} 天</span>` : ''}</span>
    </button>`;
  }).join('');
  return `<section class="desk-brief" aria-label="今天的狀況">
    <div class="db-counts">${tile('red', `${RED_DAYS} 天以上`, 'red')}${tile('amber', `${AMBER_DAYS}–${RED_DAYS - 1} 天`, 'amber')}${tile('none', '沒紀錄', 'none')}${tile('sage', `0–${AMBER_DAYS - 1} 天`, 'sage')}${n('rest') ? tile('rest', '休養中', 'rest') : ''}</div>
    <div class="db-zones">${zones}</div>
  </section>`;
}

function deskToolsHtml(shown, total) {
  const chips = [['all', '全部', total], ...DESK_ZONES.map(z => [z.key, z.name, allDogs.filter(d => deskZoneOf(d) === z.key).length])]
    .filter(([, , n]) => n)
    .map(([k, t, n]) => `<button type="button" class="dt-chip${deskZone === k ? ' on' : ''}" data-desk-zone="${k}" aria-pressed="${deskZone === k}">${t}<small class="num">${n}</small></button>`).join('');
  return `<div class="desk-tools">
    <div class="dt-chips" role="group" aria-label="區域">${chips}</div>
    <span class="dt-hint">${shown === total ? '' : `<b class="num">${shown}</b> / ${total} 隻・`}${deskView === 'fill' ? '' : '<span class="dt-tip">勾左邊的格子可以一次登記好幾隻</span>'}</span>
    <div class="dt-view" role="group" aria-label="表格">
      ${[['sheet', '全表'], ['days30', '最近 30 天'], ['fill', '補資料']].map(([k, t]) => `<button type="button" data-desk-view="${k}" class="${deskView === k ? 'on' : ''}" aria-pressed="${deskView === k}">${t}</button>`).join('')}
    </div>
  </div>`;
}

// 最近 30 天：今天往前 29 天
function deskDays(today) {
  return Array.from({ length: 30 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29 + i));
}
function deskWalkedOn(dog, key, today) {
  if (localDateKey(today) === key && walkedNow(dog, today)) return true;
  const date = effectiveWalkDate(dog, today);
  if (date && localDateKey(date) === key) return true;
  const set = deskWalkDays && deskWalkDays.get(walkKey(dog));
  return !!(set && set.has(key));
}
async function deskLoadWalks() {
  if (deskWalkDays || deskWalksLoading) return;
  deskWalksLoading = true;
  try {
    const data = walksData || await fetch(WALKS_URL, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null));
    const map = new Map();
    for (const w of (data && data.walks) || []) {
      const key = w.id ? w.id : `名:${w.name}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(w.date);
      if (!deskWalkFirst || w.date < deskWalkFirst) deskWalkFirst = w.date;
    }
    deskWalkDays = map;
  } catch (e) {
    console.error(e);
    deskWalkDays = new Map();
  }
  deskWalksLoading = false;
  if (activeTab === 'walk' && deskOn()) render();
}

function deskRowHtml(dog, today, days) {
  const s = computeStatus(dog, today);
  const key = walkKey(dog);
  const idx = allDogs.indexOf(dog);
  const flag = specialFlag(dog.note);
  const rest = s.kind === 'rest';
  const done = walkedNow(dog, today);
  const pending = walkPendingNow(dog);
  const tag = s.kind === 'rest' ? `<span class="dr-day rest">休養</span>`
    : s.kind === 'covered' ? `<span class="dr-day sage">固定</span>`
    : s.kind === 'dated' ? (s.days < 0 ? '<span class="dr-day none">？</span>' : `<span class="dr-day ${s.level}">${s.days === 0 ? '今天' : `<b class="num">${s.days}</b>天`}</span>`)
    : '<span class="dr-day none">沒紀錄</span>';
  const check = pending ? '<span class="dr-state">登記中</span>'
    : done ? `<span class="dr-state done" title="今天已溜；要取消請點狗名">${icon('tick')}</span>`
    : rest ? `<span class="dr-state" title="休養中，暫停帶出">—</span>`
    : `<input type="checkbox" data-desk-check="${esc(key)}" ${deskChecked.has(key) ? 'checked' : ''} aria-label="勾 ${esc(dog.name)}，等一下一起登記溜了">`;
  const date = effectiveWalkDate(dog, today);
  const who = walkerList(dog, today).join('、');
  const cage = typeof whereKnown === 'function' && whereKnown(dog)
    ? `<button type="button" class="dr-cage" data-where data-dog-i="${idx}" aria-label="${esc(dog.name)} 在哪：${esc(dog.cage)}">${esc(dog.cage)}</button>`
    : `<span class="dr-cage plain">${esc(dog.cage)}</span>`;
  const note = dog.note ? (flag ? highlightNote(dog.note, flag.terms) : esc(dog.note)) : '';
  const cells = days
    ? days.map(d => { const k = localDateKey(d); const on = deskWalkedOn(dog, k, today); const pre = !on && deskWalkFirst && k < deskWalkFirst; return `<td class="dr-d${localDateKey(d) === localDateKey(today) ? ' today' : ''}"><i class="${on ? 'on' : pre ? 'pre' : ''}"></i></td>`; }).join('')
    : '';
  return `<tr class="dr${deskChecked.has(key) ? ' checked' : ''}${flag ? ' flagged' : ''}" data-desk-dog="${idx}">
    <td class="dr-ck">${check}</td>
    <td class="dr-dayc">${tag}</td>
    <td class="dr-name"><button type="button" data-desk-open="${idx}" aria-haspopup="dialog">${esc(dog.name)}</button>${flag ? `<span class="dr-warn" title="${esc(flag.keywords.join('、'))}">注意</span>` : ''}${dog.homeCage ? '<small>暫住</small>' : ''}</td>
    <td class="dr-cagec">${cage}</td>
    <td class="dr-date num">${date ? `${date.getMonth() + 1}/${date.getDate()}` : ''}</td>
    <td class="dr-who">${esc(who)}</td>
    ${cells}
    <td class="dr-note"${dog.note ? ` title="${esc(dog.note)}"` : ''}><div>${note}</div></td>
  </tr>`;
}

function deskTableHtml(list, today) {
  const days = deskView === 'days30' ? deskDays(today) : null;
  if (days && !deskWalkDays) deskLoadWalks();
  const th = (k, t, cls) => `<th class="${cls}${deskSort === k ? ` sorted ${deskSortDir() === 'ascending' ? 'asc' : 'desc'}` : ''}" aria-sort="${deskSort === k ? deskSortDir() : 'none'}"><button type="button" data-desk-sort="${k}" title="${deskSort === k ? '再點一次反過來排' : `照${t}排`}">${t}</button></th>`;
  const eligible = list.filter(d => walkKey(d) && !walkedNow(d, today) && !walkPendingNow(d) && computeStatus(d, today).kind !== 'rest');
  const allOn = eligible.length && eligible.every(d => deskChecked.has(walkKey(d)));
  const dayHead = days ? days.map(d => `<th class="dr-d${localDateKey(d) === localDateKey(today) ? ' today' : ''}${d.getDay() % 6 === 0 ? ' we' : ''}" scope="col"><span class="num">${d.getDate()}</span><span>${'日一二三四五六'[d.getDay()]}</span></th>`).join('') : '';
  return `<div class="desk-sheet${days ? ' days30' : ''}">
    <table class="desk-table">
      <thead><tr>
        <th class="dr-ck"><input type="checkbox" data-desk-all ${allOn ? 'checked' : ''} aria-label="勾選這裡全部可以登記的狗"></th>
        ${th('days', '天數', 'dr-dayc')}${th('name', '狗名', 'dr-name')}${th('cage', '籠位', 'dr-cagec')}
        <th class="dr-date">上次溜</th><th class="dr-who">誰遛的</th>${dayHead}<th class="dr-note">備註（試算表）</th>
      </tr></thead>
      <tbody>${list.map(d => deskRowHtml(d, today, days)).join('')}</tbody>
    </table>
    ${days ? `<p class="desk-foot">綠格是那天有溜${deskWalkFirst ? `；溜狗紀錄從 ${+deskWalkFirst.slice(5, 7)}/${+deskWalkFirst.slice(8)} 開始，之前是斜線` : ''}。</p>` : ''}
  </div>`;
}

// ── 補資料（K 2026-10-10：電腦上比較好補資料）：所內的狗一列一隻，直接在這一列補 ──
// K 同一天用過後：「入所介紹的地方點擊就可以編輯、照片也是點擊就要可以上傳，而不是另外設按鈕」
// 「按了之後不知道有沒有成功」「一補其中一個順序馬上就會跳掉」。所以：
// - 點照片（或把檔案拖到那一列）→ 這一格先看預覽，按「上傳」；點介紹 → 這一格變成文字框，按「儲存」
// - 每個動作都在那一列寫出狀態：上傳中…／儲存中…／✓ 已上傳／✓ 已儲存／沒成功的原因
// - 這一輪的順序固定：補好的狗留在原位（打勾），換篩選、換區、搜尋、離開再回來才重排
// 照片所有人都能傳；入所原因（同一天改：原本的一段介紹換成選一個原因＋拾獲地點）要通關碼，存 repo 的 dogs/{編號}.md，不寫試算表
function deskHasPhoto(dog) {
  if (!dog.id) return false;
  if (photoOverrides[dog.id]) return true;
  if (!Object.keys(photoVersions).length) return null; // 沒有版本號（本機）就不知道，照樣去抓
  return !!photoVersions[`photos/${dog.id}.jpg`];
}
function deskFillNeeds(dog) {
  return { photo: deskHasPhoto(dog) === false, intro: !intakeOf(dog).reason };
}
let deskFillOrder = null; // { sig, keys }：這一輪固定的順序（walkKey）
let deskFillIntro = null; // 正在改的入所原因：{ key, reason, place, pass, needPass, phase: 'edit'|'saving'|'error', error }
let deskFillPhoto = null; // 選好還沒傳的照片：{ key, blob, url, phase: 'preview'|'uploading'|'error', error }
const deskFillDone = new Map(); // walkKey → { photo: '10:32', intro: '10:35' }：這次打開網頁補好的
const deskClock = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const deskDogOfKey = key => allDogs.find(d => walkKey(d) === key);

// 這一輪要列哪些狗、照什麼順序：兩樣都缺的最前面，再照籠位，沒編號的最後。sig 一樣就沿用，補好了也不動
function deskFillRows(list, query) {
  const sig = `${deskFill}|${deskZone}|${query || ''}`;
  if (!deskFillOrder || deskFillOrder.sig !== sig) {
    const keys = list.map(d => ({ d, need: deskFillNeeds(d) }))
      .filter(r => (deskFill === 'photo' ? r.need.photo : deskFill === 'intro' ? r.need.intro : true))
      .sort((a, b) => !a.d.id - !b.d.id || (b.need.photo + b.need.intro) - (a.need.photo + a.need.intro) || deskNatural(a.d.cage, b.d.cage))
      .map(r => walkKey(r.d));
    deskFillOrder = { sig, keys };
  }
  return deskFillOrder.keys.map(deskDogOfKey).filter(Boolean);
}
function deskFillPhotoCell(d, idx, need) {
  const key = walkKey(d);
  const p = deskFillPhoto && deskFillPhoto.key === key ? deskFillPhoto : null;
  if (!d.id) return `<span class="df-drop off">${icon('camera')}</span>`;
  if (p) {
    const busy = p.phase === 'uploading';
    return `<div class="df-photo pending">
      <span class="thumb"><img src="${esc(p.url)}" alt="${esc(d.name)} 的新照片預覽"></span>
      <span class="df-photo-act">
        <button type="button" class="df-go" data-fill-photo-go${busy ? ' disabled' : ''}>${busy ? '上傳中…' : '上傳'}</button>
        ${busy ? '' : '<button type="button" class="df-cancel" data-fill-photo-cancel>取消</button>'}
      </span>
    </div>`;
  }
  const label = need.photo || deskHasPhoto(d) === null ? '上傳' : '換';
  return `<button type="button" class="df-photo" data-fill-photo="${idx}" aria-label="${label} ${esc(d.name)} 的照片" title="點了選照片，或把照片檔拖到這一列">
    ${need.photo ? `<span class="df-drop">${icon('camera')}<span>點這裡<br>選照片</span></span>` : `${photoThumb(d, 64)}<span class="df-photo-hint">${icon('camera')}換照片</span>`}
  </button>`;
}
function deskFillIntroCell(d, idx) {
  const key = walkKey(d);
  if (!d.id) return '<span class="df-missing">沒有編號，試算表補上編號後才能補</span>';
  const e = deskFillIntro && deskFillIntro.key === key ? deskFillIntro : null;
  const prose = introOf(d); // 舊的介紹文字放在旁邊對照（K 2026-10-10：先不要刪）
  if (!e) {
    const tags = intakeTagsHtml(d);
    return `<button type="button" class="df-intro-btn${tags ? '' : ' empty'}" data-fill-intro="${idx}" aria-label="${tags ? '改' : '填'} ${esc(d.name)} 的入所原因" title="點了直接改">
      <span class="df-intro-text">${tags || '<span class="df-pick">選入所原因</span>'}${prose ? `<span class="df-prose">${esc(prose)}</span>` : ''}</span>${icon('write')}
    </button>`;
  }
  const busy = e.phase === 'saving';
  return `<form class="df-form" data-fill-form>
    ${intakeOptsHtml(e.reason, busy)}
    ${e.guessed && e.reason === e.guessed ? `<p class="df-guess">照介紹先選了「${esc(e.guessed)}」，不對就改，按儲存才算數。</p>` : ''}
    <div class="df-form-row">
      ${intakeNeedsPlace(e.reason) ? `<input type="text" id="dfIntroPlace" class="df-place" maxlength="${INTAKE_PLACE_MAX}" placeholder="拾獲地點，例：樹林區大同山" aria-label="${esc(d.name)} 的拾獲地點" autocomplete="off" value="${esc(e.place)}"${busy ? ' disabled' : ''}>` : ''}
      ${e.needPass ? `<input type="password" id="dfIntroPass" name="password" autocomplete="current-password" placeholder="通關碼" aria-label="通關碼" value="${esc(e.pass)}"${busy ? ' disabled' : ''}>` : ''}
      <button type="submit" class="df-go"${busy ? ' disabled' : ''}>${busy ? '儲存中…' : '儲存'}</button>
      ${busy ? '' : '<button type="button" class="df-cancel" data-fill-intro-cancel>取消</button>'}
    </div>
    ${prose ? `<p class="df-prose open">${esc(prose)}</p>` : ''}
  </form>`;
}
// 這一列的狀態：正在做什麼、做好了沒、哪裡沒成功
function deskFillStateCell(d) {
  const key = walkKey(d);
  const out = [];
  const p = deskFillPhoto && deskFillPhoto.key === key ? deskFillPhoto : null;
  const e = deskFillIntro && deskFillIntro.key === key ? deskFillIntro : null;
  const done = deskFillDone.get(key) || {};
  if (p && p.phase === 'uploading') out.push('<span class="df-st busy">照片上傳中…</span>');
  else if (p && p.phase === 'error') out.push(`<span class="df-st err" role="alert">${icon('alert')}照片沒有上傳：${esc(p.error)}</span>`);
  else if (p) out.push('<span class="df-st hint">這是預覽，按「上傳」才會換</span>');
  else if (done.photo) out.push(`<span class="df-st ok">${icon('tick')}照片已上傳 <small>${done.photo}</small></span>`);
  if (e && e.phase === 'saving') out.push('<span class="df-st busy">入所原因儲存中…</span>');
  else if (e && e.phase === 'error') out.push(`<span class="df-st err" role="alert">${icon('alert')}入所原因沒有存：${esc(e.error)}</span>`);
  else if (!e && done.intro) out.push(`<span class="df-st ok">${icon('tick')}入所原因已儲存 <small>${done.intro}</small></span>`);
  return out.join('');
}
function deskFillHtml(list, query) {
  const all = list.map(d => ({ d, need: deskFillNeeds(d) }));
  const known = Object.keys(photoVersions).length > 0; // 沒有照片清單（本機、讀不到）就不知道誰沒照片
  const nPhoto = all.filter(r => r.d.id && r.need.photo).length, nIntro = all.filter(r => r.d.id && r.need.intro).length;
  const shown = deskFillRows(list, query);
  const nDone = shown.filter(d => deskFillDone.has(walkKey(d))).length;
  const chip = (k, t, n, off) => `<button type="button" class="df-chip${deskFill === k ? ' on' : ''}" data-desk-fill="${k}" aria-pressed="${deskFill === k}"${off ? ' disabled title="還不知道哪些狗沒照片"' : ''}>${t}<b class="num">${off ? '—' : n}</b></button>`;
  return `<div class="desk-fill">
    <div class="df-bar">
      <div class="df-chips" role="group" aria-label="要補什麼">${chip('photo', '沒照片', nPhoto, !known)}${chip('intro', '沒入所原因', nIntro)}${chip('all', '全部', all.length)}</div>
      <p class="df-note">${nDone ? `<b class="df-done-n">${icon('tick')}這次補好 ${nDone} 隻</b>・補好的留在原位。` : '點照片換照片、點入所原因直接選；也可以把照片檔拖到那一列。'}入所原因要通關碼，存在網站，不寫試算表。</p>
    </div>
    ${shown.length ? `<table class="desk-table df-table">
      <thead><tr><th class="df-ph">照片</th><th class="dr-name">狗名</th><th class="dr-cagec">籠位</th><th class="df-intro">入所原因</th><th class="df-state">狀態</th></tr></thead>
      <tbody>${shown.map(d => {
        const idx = allDogs.indexOf(d), key = walkKey(d), need = deskFillNeeds(d);
        return `<tr class="df-row${deskFillDone.has(key) ? ' done' : ''}" ${d.id ? `data-fill-dog="${idx}"` : ''}>
          <td class="df-ph">${deskFillPhotoCell(d, idx, need)}</td>
          <td class="dr-name"><button type="button" data-desk-open="${idx}" aria-haspopup="dialog">${esc(d.name)}</button></td>
          <td class="dr-cagec">${typeof whereKnown === 'function' && whereKnown(d) ? `<button type="button" class="dr-cage" data-where data-dog-i="${idx}" aria-label="${esc(d.name)} 在哪：${esc(d.cage)}">${esc(d.cage)}</button>` : `<span class="dr-cage plain">${esc(d.cage)}</span>`}</td>
          <td class="df-intro">${deskFillIntroCell(d, idx)}</td>
          <td class="df-state" aria-live="polite">${deskFillStateCell(d)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : `<div class="status-msg">${deskFill === 'photo' ? '這裡的狗都有照片了' : deskFill === 'intro' ? '這裡的狗都有入所原因了' : '這一區沒有狗'}</div>`}
  </div>`;
}

// 選好照片（點了選檔，或拖到那一列）：先壓縮、在這一格預覽，按「上傳」才送
function deskFillPickPhoto(dog) {
  let input = document.getElementById('deskFillFile');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.id = 'deskFillFile'; input.hidden = true;
    input.addEventListener('change', () => {
      const file = (input.files || [])[0];
      const d = deskDogOfKey(input.dataset.key);
      input.value = '';
      if (file && d) deskFillPreparePhoto(d, file);
    });
    document.body.appendChild(input);
  }
  input.dataset.key = walkKey(dog);
  input.click();
}
async function deskFillPreparePhoto(dog, file) {
  if (deskFillPhoto && deskFillPhoto.phase === 'uploading') { showToast('上一張照片還在上傳，請稍等一下'); return; }
  let blob;
  try { blob = await compressPhoto(file); } catch (e) { showToast(e.message); return; }
  if (deskFillPhoto) URL.revokeObjectURL(deskFillPhoto.url);
  deskFillPhoto = { key: walkKey(dog), blob, url: URL.createObjectURL(blob), phase: 'preview', error: '' };
  render();
  const go = document.querySelector('#main [data-fill-photo-go]');
  if (go) go.focus({ preventScroll: true });
}
async function deskFillUploadPhoto() {
  const p = deskFillPhoto;
  const dog = p && deskDogOfKey(p.key);
  if (!p || !dog || p.phase === 'uploading') return;
  p.phase = 'uploading'; p.error = ''; render();
  let error = '';
  try {
    const res = await fetch(`${UPLOAD_URL}/photos/${encodeURIComponent(dog.id)}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: p.blob });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out || !out.ok) error = (out && out.error) || `網站暫時收不到照片（${res.status}），原本的照片不受影響`;
  } catch (e) {
    error = '請確認網路後再按一次「上傳」，原本的照片不受影響';
  }
  if (deskFillPhoto !== p) return;
  if (error) { p.phase = 'error'; p.error = error; render(); return; }
  photoOverrides[dog.id] = p.url; // 這台電腦馬上換成新照片（其他人重新整理就會看到）
  deskFillPhoto = null;
  deskFillDone.set(p.key, { ...(deskFillDone.get(p.key) || {}), photo: deskClock() });
  render();
  showToast(`${dog.name} 的照片已上傳`);
}
function deskFillOpenIntro(dog) {
  if (!dog || !dog.id) return;
  if (deskFillIntro && deskFillIntro.phase === 'saving') { showToast('上一筆還在儲存，請稍等一下'); return; }
  deskFillIntro = { key: walkKey(dog), ...intakeDraft(dog), pass: '', needPass: !loadNotesPass(), phase: 'edit', error: '' };
  render();
  const first = document.querySelector('#main .df-form .intake-opt.on') || document.querySelector('#main .df-form .intake-opt');
  if (first) first.focus({ preventScroll: true });
}
async function deskFillSaveIntro() {
  const e = deskFillIntro;
  const dog = e && deskDogOfKey(e.key);
  if (!e || !dog || e.phase === 'saving') return;
  const fail = msg => { e.phase = 'error'; e.error = msg; render(); const b = (e.needPass && !e.pass && document.getElementById('dfIntroPass')) || document.querySelector('#main .df-form .intake-opt.on') || document.querySelector('#main .df-form .intake-opt'); if (b) b.focus({ preventScroll: true }); };
  const pass = e.needPass ? e.pass : loadNotesPass();
  if (!pass) { e.needPass = true; fail('請輸入通關碼'); return; }
  const reason = e.reason, place = intakeNeedsPlace(reason) ? e.place.replace(/\s+/g, ' ').trim() : '';
  e.phase = 'saving'; e.error = ''; render();
  let out = null, error = '';
  try {
    const res = await fetch(`${UPLOAD_URL}/intro/${encodeURIComponent(dog.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: pass, reason, place }) });
    out = await res.json().catch(() => null);
    if (!res.ok || !out || !out.ok) error = (out && out.error) || `沒有存進去（${res.status}），請稍後再試`;
  } catch (err) {
    error = '請確認網路後再按一次「儲存」';
  }
  if (deskFillIntro !== e) return;
  if (error) {
    if (out && out.code === 'passcode') { saveNotesPass(''); e.needPass = true; e.pass = ''; }
    fail(error);
    return;
  }
  saveNotesPass(pass);
  introOverrides[dog.id] = { reason: typeof out.reason === 'string' ? out.reason : reason, place: typeof out.place === 'string' ? out.place : place };
  deskFillIntro = null;
  deskFillDone.set(e.key, { ...(deskFillDone.get(e.key) || {}), intro: deskClock() });
  render();
  const back = document.querySelector(`#main [data-fill-intro="${allDogs.indexOf(dog)}"]`);
  if (back) back.focus({ preventScroll: true });
  showToast(`${dog.name} 的入所原因已儲存`);
}

function deskSideHtml(today) {
  const notes = [...(typeof sheetNotes !== 'undefined' ? sheetNotes : [])].reverse();
  const shown = deskNotesAll ? notes : notes.slice(0, 8);
  const resting = allDogs.filter(d => restOf(d, today));
  return `<aside class="desk-side">
    <section class="ds-panel" aria-labelledby="dsNotes">
      <h2 id="dsNotes">異動紀錄<small>試算表狗清單下面</small></h2>
      ${notes.length ? `<ol class="ds-notes">${shown.map(n => { const p = deskNoteParts(n.text); return `<li>${p.date ? `<b class="num">${esc(p.date)}</b>` : ''}<span>${esc(p.rest)}</span></li>`; }).join('')}</ol>
        ${notes.length > 8 ? `<button type="button" class="ds-more" data-desk-notes>${deskNotesAll ? '收起' : `看全部 ${notes.length} 則`}</button>` : ''}`
        : '<p class="ds-empty">還沒有紀錄（同步試算表後會出現）。</p>'}
    </section>
    ${resting.length ? `<section class="ds-panel" aria-labelledby="dsRest"><h2 id="dsRest">休養中<small>${resting.length} 隻</small></h2>
      <ul class="ds-rest">${resting.map(d => { const r = restOf(d, today); return `<li><button type="button" data-desk-open="${allDogs.indexOf(d)}">${esc(d.name)}</button><span>${esc(d.cage)}・${esc(r.reason || '休養')}，${monthDay(r.until)} 前暫停帶出</span></li>`; }).join('')}</ul></section>` : ''}
  </aside>`;
}

function deskBatchHtml() {
  const dogs = [...deskChecked].map(k => allDogs.find(d => walkKey(d) === k)).filter(Boolean);
  if (!dogs.length) return '';
  return `<div class="desk-batch" role="region" aria-label="一起登記">
    <span class="dbx-n">已勾 <b class="num">${dogs.length}</b> 隻</span>
    <span class="dbx-names">${esc(dogs.map(d => d.name).join('、'))}</span>
    <button type="button" class="dbx-clear" data-desk-clear>清掉</button>
    <button type="button" class="dbx-go" data-desk-go>今天 溜了</button>
  </div>`;
}

// js/app.js 的 renderMain 在寬螢幕、溜狗表時叫這個；walkList 已經照手機溜狗表排好、套過搜尋
function deskWalkHtml(today, query, walkList) {
  // 勾了之後狗不見了（搜尋、資料更新、已經溜了）就拿掉
  for (const k of [...deskChecked]) {
    const d = allDogs.find(x => walkKey(x) === k);
    if (!d || walkedNow(d, today) || walkPendingNow(d)) deskChecked.delete(k);
  }
  const list = deskSorted(deskZone === 'all' ? walkList : walkList.filter(d => deskZoneOf(d) === deskZone));
  const empty = !list.length ? `<div class="status-msg">${query ? `找不到「${esc(query)}」` : '這一區沒有狗'}</div>` : '';
  return `<h2 class="sr-only">溜狗表（電腦版）</h2><div class="desk${deskView === 'fill' ? ' filling' : ''}">
    <div class="desk-main">${query || deskView === 'fill' ? '' : deskBriefHtml(today)}${deskToolsHtml(list.length, walkList.length)}${empty || (deskView === 'fill' ? deskFillHtml(list, query) : deskTableHtml(list, today))}</div>
    ${deskSideHtml(today)}
  </div>${deskBatchHtml()}`;
}

// 頁首：寬螢幕時分類從畫面最下面搬到頁首（站名和搜尋框中間），變回一般網站的分頁
function deskPlaceTabs() {
  const bar = document.getElementById('bottomBar');
  const head = document.querySelector('header.app .header-inner');
  const search = head && head.querySelector('.search');
  if (!bar || !head || !search) return;
  if (deskOn()) {
    if (bar.parentElement !== head) head.insertBefore(bar, search);
  } else if (bar.parentElement === head) {
    document.body.insertBefore(bar, document.getElementById('main').nextSibling);
  }
  document.documentElement.classList.toggle('desk-on', deskOn());
}

if (typeof document !== 'undefined' && document.getElementById('main')) {
  deskPlaceTabs();
  if (DESK_MEDIA) DESK_MEDIA.addEventListener('change', () => { deskPlaceTabs(); if (loadState === 'ready') render(); });
  const main = document.getElementById('main');
  // 最近 30 天放不下時捲到最右邊（今天那一格）
  new MutationObserver(() => { const sheet = main.querySelector('.desk-sheet.days30'); if (sheet && !sheet.dataset.scrolled) { sheet.dataset.scrolled = '1'; sheet.scrollLeft = sheet.scrollWidth; } }).observe(main, { childList: true });
  main.addEventListener('click', e => {
    if (!deskOn() || activeTab !== 'walk') return;
    const t = e.target;
    const zone = t.closest('[data-desk-zone]');
    if (zone) { deskZone = deskZone === zone.dataset.deskZone && zone.classList.contains('db-zone') ? 'all' : zone.dataset.deskZone; render(); return; }
    const view = t.closest('[data-desk-view]');
    if (view) { deskView = view.dataset.deskView; deskFillOrder = null; render(); return; } // 離開再回補資料才重排
    const sort = t.closest('[data-desk-sort]');
    if (sort) {
      // 同一欄再點一次反過來排；換一欄從那一欄的預設方向開始
      if (deskSort === sort.dataset.deskSort) deskSortRev = !deskSortRev; else { deskSort = sort.dataset.deskSort; deskSortRev = false; }
      render();
      const again = main.querySelector(`[data-desk-sort="${deskSort}"]`);
      if (again) again.focus({ preventScroll: true });
      return;
    }
    const open = t.closest('[data-desk-open]');
    if (open) { showDetail(allDogs[Number(open.dataset.deskOpen)]); return; }
    const where = t.closest('[data-where][data-dog-i]');
    if (where) { whereOpen(allDogs[Number(where.dataset.dogI)], where); return; }
    // 點這一列任何地方都開這隻狗的詳細資訊（K 2026-10-10：不用對準狗名）；勾選那一格、按鈕、正在選字不算
    const row = t.closest('tr[data-desk-dog]');
    if (row && !t.closest('button, input, a, label, .dr-ck') && !String(window.getSelection ? window.getSelection() : '').trim()) { showDetail(allDogs[Number(row.dataset.deskDog)]); return; }
    const pick = t.closest('.df-form [data-intake-reason]');
    if (pick) { pickIntakeReason(deskFillIntro, pick.dataset.intakeReason, render, main); return; }
    if (t.closest('[data-desk-notes]')) { deskNotesAll = !deskNotesAll; render(); return; }
    const fill = t.closest('[data-desk-fill]');
    if (fill) { deskFill = fill.dataset.deskFill; render(); return; }
    const addPhoto = t.closest('[data-fill-photo]');
    if (addPhoto) { deskFillPickPhoto(allDogs[Number(addPhoto.dataset.fillPhoto)]); return; }
    if (t.closest('[data-fill-photo-go]')) { deskFillUploadPhoto(); return; }
    if (t.closest('[data-fill-photo-cancel]')) { if (deskFillPhoto) URL.revokeObjectURL(deskFillPhoto.url); deskFillPhoto = null; render(); return; }
    const addIntro = t.closest('[data-fill-intro]');
    if (addIntro) { deskFillOpenIntro(allDogs[Number(addIntro.dataset.fillIntro)]); return; }
    if (t.closest('[data-fill-intro-cancel]')) {
      const d = deskFillIntro && deskDogOfKey(deskFillIntro.key);
      deskFillIntro = null; render();
      const back = d && document.querySelector(`#main [data-fill-intro="${allDogs.indexOf(d)}"]`);
      if (back) back.focus({ preventScroll: true });
      return;
    }
    if (t.closest('[data-desk-clear]')) { deskChecked.clear(); render(); return; }
    if (t.closest('[data-desk-go]')) {
      const dogs = [...deskChecked].map(k => allDogs.find(d => walkKey(d) === k)).filter(Boolean);
      deskChecked.clear();
      if (dogs.length) setWalked(dogs, true);
      render();
    }
  });
  // 補資料的入所原因：打的字記在 deskFillIntro（重畫不會不見）；Enter 或 Ctrl+Enter 儲存、Esc 取消
  main.addEventListener('input', e => {
    if (!deskFillIntro) return;
    if (e.target.id === 'dfIntroPlace') deskFillIntro.place = e.target.value;
    else if (e.target.id === 'dfIntroPass') deskFillIntro.pass = e.target.value;
  });
  main.addEventListener('submit', e => { if (e.target.matches('[data-fill-form]')) { e.preventDefault(); deskFillSaveIntro(); } });
  main.addEventListener('keydown', e => {
    if (!deskFillIntro || !e.target.closest || !e.target.closest('[data-fill-form]')) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); deskFillSaveIntro(); }
    else if (e.key === 'Escape' && deskFillIntro.phase !== 'saving') { e.preventDefault(); e.stopPropagation(); const b = main.querySelector('[data-fill-intro-cancel]'); if (b) b.click(); }
  });
  // 補資料：照片檔拖到那一列 → 那一格直接預覽（按「上傳」才送）
  const fillRow = e => (deskOn() && activeTab === 'walk' && deskView === 'fill' && e.dataTransfer && [...e.dataTransfer.types].includes('Files') ? e.target.closest('[data-fill-dog]') : null);
  main.addEventListener('dragover', e => {
    const row = fillRow(e);
    if (!row) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    main.querySelectorAll('.df-row.drop').forEach(r => { if (r !== row) r.classList.remove('drop'); });
    row.classList.add('drop');
  });
  main.addEventListener('dragleave', e => { const row = e.target.closest && e.target.closest('.df-row'); if (row && !row.contains(e.relatedTarget)) row.classList.remove('drop'); });
  main.addEventListener('drop', e => {
    const row = fillRow(e);
    if (!row) return;
    e.preventDefault();
    row.classList.remove('drop');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    const dog = allDogs[Number(row.dataset.fillDog)];
    if (!file || !dog) return;
    deskFillPreparePhoto(dog, file);
  });
  main.addEventListener('change', e => {
    if (!deskOn() || activeTab !== 'walk') return;
    if (e.target.matches('[data-desk-all]')) {
      main.querySelectorAll('[data-desk-check]').forEach(box => { if (e.target.checked) deskChecked.add(box.dataset.deskCheck); else deskChecked.delete(box.dataset.deskCheck); });
      render();
      return;
    }
    const key = e.target.dataset.deskCheck;
    if (!key) return;
    if (e.target.checked) deskChecked.add(key); else deskChecked.delete(key);
    // 只換這一列和下面的登記列，不整頁重畫（勾很多隻時不跳）
    const row = e.target.closest('tr');
    if (row) row.classList.toggle('checked', e.target.checked);
    const old = main.querySelector('.desk-batch');
    if (old) old.remove();
    main.insertAdjacentHTML('beforeend', deskBatchHtml());
    const all = main.querySelector('[data-desk-all]');
    if (all) { const boxes = [...main.querySelectorAll('[data-desk-check]')]; all.checked = boxes.length > 0 && boxes.every(b => b.checked); }
  });
}
