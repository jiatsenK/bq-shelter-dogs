import { settle } from '../shared/api-response.js';
import { prepareImages, imageForm } from '../shared/photo-images.js';
import {
  FIELDS,
  FIELD_LABELS,
  PREVIEW_FIELDS,
  INTRO_MAX,
  REST_REASON_MAX,
  restBounds,
  fieldSummary,
  displayValue,
  sameValue,
  introDiff,
  restProblem,
  patchDog,
  stayRow
} from './dog-edit-model.js';
import { mergeCandidates, mergeSides, mergePreviewText } from './dog-merge.js';
import { shownNumber } from './dog-table.js';
import { BQDates } from '../shared/dates.js';

// #624 右側抽屜：六個欄位全部展開（#639 編號併進出入所紀錄）；介紹、休養、固定照顧、性別改完直接可存（行內標改前→改後），
// 出入所紀錄（含編號，ADR 0021）、照片要先預覽。後端不變：一欄一筆 PUT／POST，每欄帶上一筆回應的 revision。
const el = (tag, value, className) => {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
};
const button = (label, className = 'btn') => {
  const node = el('button', label, className);
  node.type = 'button';
  return node;
};
const call = (path, init = {}) =>
  settle(
    fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      ...init
    })
  );
// 垃圾桶每筆：台灣時間的刪除時間，和哪一天清理會刪掉（每月 1 日 UTC 01:53 清超過 days 天的，worker/src/index.js trashDue）
const taiwan = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
export function trashLabel(deletedAt, days) {
  const at = Date.parse(deletedAt);
  if (isNaN(at)) return '刪除時間不明';
  const due = new Date(at + days * 86400000);
  let run = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), 1, 1, 53);
  if (run <= due.getTime()) run = Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 1, 1, 53);
  return `${taiwan(at)} 換掉，${taiwan(run).slice(0, 10)} 清理時刪除`;
}
// 合併重複的狗（K 2026-10-26）：選另一隻→預覽→按兩次確認；成功前不改任何資料。放在欄位外面，不算進抽屜的草稿
function mergeSection(dog, dogs, onMerged) {
  const wrap = el('section', undefined, 'merge-section');
  wrap.setAttribute('aria-labelledby', 'merge-title');
  const heading = el('h3', '合併重複的狗');
  heading.id = 'merge-title';
  wrap.append(heading, el('p', '試算表改編號時可能多出一隻同名的狗。選另一隻預覽：溜狗紀錄、舊編號、介紹、照片等會搬到留下的那隻，被併的那筆從狗資料刪掉；修改紀錄可取消合併。主清單上的狗只能當留下的那隻。', 'text-secondary'));
  const candidates = mergeCandidates(dog, dogs);
  if (!candidates.length) {
    wrap.append(el('p', '沒有可以合併的狗（兩隻都在主清單上時不能合併）。', 'text-secondary'));
    return wrap;
  }
  const select = el('select', undefined, 'form-select');
  select.id = 'merge-with';
  const caption = el('label', '跟哪一隻合併', 'form-label');
  caption.htmlFor = select.id;
  for (const c of candidates) {
    const option = el('option', c.text);
    option.value = c.dogId;
    select.append(option);
  }
  const preview = button('預覽合併');
  const result = el('pre', '', 'merge-preview');
  result.hidden = true;
  const confirm = button('合併', 'btn btn-outline-danger');
  confirm.hidden = true;
  const note = el('p', '');
  note.setAttribute('role', 'status');
  note.setAttribute('aria-live', 'polite');
  wrap.append(caption, select, preview, result, confirm, note);
  let planned = null,
    armed = false,
    busy = false;
  const reset = () => {
    planned = null;
    armed = false;
    result.hidden = true;
    confirm.hidden = true;
    confirm.textContent = '合併';
    confirm.className = 'btn btn-outline-danger';
  };
  select.addEventListener('change', () => {
    reset();
    note.textContent = '';
  });
  preview.addEventListener('click', async () => {
    if (busy) return;
    reset();
    const other = dogs.find((d) => d.dogId === select.value);
    const sides = other && mergeSides(dog, other);
    if (!sides) return;
    busy = true;
    preview.disabled = true;
    note.textContent = '正在預覽…';
    const response = await call(
      `/api/manage/dogs/${encodeURIComponent(sides.target.dogId)}/merge?source=${encodeURIComponent(sides.source.dogId)}`
    );
    busy = false;
    preview.disabled = false;
    if (!response.ok) {
      note.textContent = response.data?.error || '預覽失敗，請重試';
      return;
    }
    planned = response.data;
    result.textContent = mergePreviewText(planned);
    result.hidden = false;
    confirm.hidden = false;
    note.textContent = '請核對預覽；確認無誤再按「合併」，還要再按一次才會寫入。';
  });
  confirm.addEventListener('click', async () => {
    if (!planned || busy) return;
    const gone = `${planned.source.name || '未命名'} ${planned.source.number || '無編號'}`;
    if (!armed) {
      armed = true;
      confirm.className = 'btn btn-danger';
      confirm.textContent = `確定合併：刪掉「${gone}」這筆`;
      note.textContent = '再按一次才會合併。';
      return;
    }
    busy = true;
    confirm.disabled = preview.disabled = select.disabled = true;
    note.textContent = '正在合併，請稍候…';
    const response = await call(`/api/manage/dogs/${encodeURIComponent(planned.target.dogId)}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: planned.source.dogId, revision: planned.target.revision, sourceRevision: planned.source.revision })
    });
    busy = false;
    confirm.disabled = preview.disabled = select.disabled = false;
    if (!response.ok) {
      reset();
      note.textContent = response.data?.error || '未能確認合併，資料沒有改；請重新預覽';
      return;
    }
    onMerged(`已把「${gone}」併到「${planned.target.name || '未命名'} ${planned.target.number || ''}」。要拆回來，到修改紀錄找這筆「合併狗」按「取消合併」。`);
  });
  return wrap;
}
export function createDogDrawer(root, { onSaved, onNext, onClose, dogs = () => [], onMerged = () => {} }) {
  let dog = null,
    snapshot = null,
    busy = false,
    leaveArmed = false,
    images = null,
    previewUrl = null,
    previewed = new Map(),
    sections = {},
    loadSeq = 0;
  const base = () => `/api/manage/dogs/${encodeURIComponent(dog.dogId)}`;

  const head = el('header', undefined, 'drawer-head');
  const status = el('p', '', 'drawer-status');
  // 存檔時儲存鈕會停用、焦點會掉，存完把焦點放這裡，讀得到結果、Esc 也還關得掉
  status.tabIndex = -1;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const reload = button('讀取最新資料並保留草稿');
  reload.hidden = true;
  const statusBar = el('div', undefined, 'drawer-status-bar');
  statusBar.append(status, reload);
  const form = el('form', undefined, 'drawer-form');
  form.noValidate = true;
  const fields = el('fieldset', undefined, 'drawer-fields');
  const body = el('div', undefined, 'drawer-body');
  const mergeHost = el('div');
  body.append(fields, mergeHost);
  const dirtyLine = el('p', '', 'drawer-dirty');
  dirtyLine.id = 'drawer-dirty';
  const save = el('button', '儲存', 'btn btn-primary');
  save.type = 'submit';
  save.setAttribute('aria-describedby', dirtyLine.id);
  const next = button('存並開下一隻');
  next.setAttribute('aria-describedby', dirtyLine.id);
  const foot = el('footer', undefined, 'drawer-foot');
  const actions = el('div', undefined, 'drawer-actions');
  actions.append(save, next);
  foot.append(dirtyLine, actions);
  form.append(statusBar, body, foot);
  root.replaceChildren(head, form);

  function renderHead() {
    const photo = el('div', undefined, 'drawer-photo');
    if (dog.photoUrl) {
      const img = el('img');
      img.src = dog.photoUrl;
      img.alt = `${dog.name || '未命名'}的照片`;
      img.width = 72;
      img.height = 72;
      img.addEventListener('error', () => photo.replaceChildren(el('span', '照片讀不到', 'photo-unavailable')), { once: true });
      photo.append(img);
    } else photo.append(el('span', '無照片紀錄', 'photo-unavailable'));
    const title = el('h2', dog.name || '未命名');
    title.id = 'drawer-title';
    title.tabIndex = -1;
    const number = dog.number || (shownNumber(dog) ? `舊編號 ${shownNumber(dog)}` : '未編號');
    const meta = el('p', `${number} · 籠位 ${dog.cage || '—'}`, 'drawer-meta');
    const identity = el('p', `永久 ID ${dog.dogId}`, 'drawer-identity');
    const text = el('div', undefined, 'drawer-title');
    text.append(title, meta, identity);
    const close = button('關閉', 'btn drawer-close');
    close.setAttribute('aria-label', '關閉編輯');
    close.addEventListener('click', () => api.close());
    head.replaceChildren(photo, text, close);
  }

  // ---- 各欄位 ----
  function section(field) {
    const wrap = el('section', undefined, 'edit-field');
    wrap.dataset.field = field;
    const heading = el('h3', undefined, 'edit-field-head');
    heading.id = `field-${field}`;
    const now = el('span', '', 'edit-field-now');
    heading.append(el('span', FIELD_LABELS[field]), now);
    wrap.setAttribute('aria-labelledby', heading.id);
    const controls = el('div', undefined, 'edit-field-controls');
    const diff = el('div', undefined, 'field-diff');
    diff.setAttribute('aria-live', 'polite');
    wrap.append(heading, controls, diff);
    fields.append(wrap);
    sections[field] = { wrap, now, controls, diff };
    return controls;
  }
  // hidden：欄名已經在區塊標題，標籤只留給螢幕報讀
  function labelled(controls, node, label, id, hidden = false) {
    const caption = el('label', label, hidden ? 'visually-hidden' : 'form-label');
    caption.htmlFor = node.id = id;
    controls.append(caption, node);
    return node;
  }
  function textInput(type, className = 'form-control') {
    const node = el(type === 'textarea' ? 'textarea' : 'input', undefined, className);
    if (type !== 'textarea') node.type = type;
    return node;
  }
  function checkRow(controls, id, label) {
    const row = el('label', undefined, 'form-check edit-check');
    const node = textInput('checkbox', 'form-check-input');
    node.id = id;
    row.append(node, el('span', label, 'form-check-label'));
    controls.append(row);
    return node;
  }

  function buildIntro() {
    const controls = section('intro');
    const node = labelled(controls, textInput('textarea'), `介紹（最多 ${INTRO_MAX} 字）`, 'edit-intro', true);
    node.rows = 6;
    node.maxLength = INTRO_MAX;
    node.value = snapshot.intro;
    const count = el('p', '', 'form-hint');
    count.id = 'edit-intro-count';
    node.setAttribute('aria-describedby', count.id);
    controls.append(count);
  }
  function buildRest() {
    const controls = section('rest');
    const { min, max } = restBounds();
    const off = checkRow(controls, 'edit-rest-end', snapshot.rest ? '結束休養' : '不設定休養');
    off.checked = !snapshot.rest;
    const until = labelled(controls, textInput('date'), `休養至（${min} 到 ${max}）`, 'edit-until');
    until.min = min;
    until.max = max;
    until.value = snapshot.rest?.until || '';
    const reason = labelled(controls, textInput('text'), `原因（最多 ${REST_REASON_MAX} 字）`, 'edit-reason');
    reason.maxLength = REST_REASON_MAX;
    reason.value = snapshot.rest?.reason || '';
  }
  function buildFixedCare() {
    checkRow(section('fixedCare'), 'edit-fixed-care', '有人固定照顧').checked = snapshot.fixedCare;
  }
  function buildSex() {
    const controls = section('sex');
    controls.append(el('p', '舊試算表副本已停止維護；請以狗正本逐隻確認，不依名字推測。', 'form-hint'));
    const node = labelled(controls, el('select', undefined, 'form-select'), '性別', 'edit-sex', true);
    for (const [value, label] of [
      ['', '待確認'],
      ['male', '公'],
      ['female', '母']
    ]) {
      const option = el('option', label);
      option.value = value;
      node.append(option);
    }
    node.value = snapshot.sex;
  }
  function previewButton(field) {
    const node = button('預覽改前／改後');
    node.dataset.preview = field;
    node.addEventListener('click', () => preview(field));
    sections[field].controls.append(node);
  }
  // 出入所表（ADR 0021）：一個編號一列，查不到編號的那次編號空著。有編號的入所日就是編號前 8 碼；
  // 有離所紀錄的出所日照離所紀錄（唯讀，離所原因寫在提示），那列跟目前編號那列都不能刪；入所原因每列都手填。補編號＝新增一列填編號，刪編號＝刪那一列。
  function buildStays() {
    const controls = section('stays');
    controls.append(
      el(
        'p',
        `每次在所一列。有編號的入所日自動用編號前 8 碼；查不到編號的那次，編號留空、自己填入所日。目前編號（${
          snapshot.currentNumbers.join('、') || '無'
        }）不能刪，編號不能移給另一隻狗。`,
        'form-hint'
      )
    );
    const rows = el('div');
    rows.id = 'edit-stays';
    controls.append(rows);
    const addRow = (stay = { number: '', in: '', out: '', reason: '' }) => {
      const row = el('fieldset', undefined, 'stay-row');
      const current = snapshot.currentNumbers.includes(stay.number);
      const legend = el('legend', '');
      row.append(legend);
      const inputs = {};
      for (const [key, label, type] of [
        ['number', '編號（查不到留空）', 'text'],
        ['in', '入所日', 'date'],
        ['out', '出所日（還在所留空）', 'date'],
        ['reason', '入所原因', 'text']
      ]) {
        const wrap = el('label', label, 'form-label');
        const node = textInput(type);
        node.dataset.key = key;
        node.value = stay[key] || '';
        if (key === 'number') node.inputMode = 'numeric';
        wrap.append(node);
        row.append(wrap);
        inputs[key] = node;
      }
      inputs.number.readOnly = current || Boolean(stay.departed);
      inputs.out.readOnly = Boolean(stay.departed);
      if (stay.departed) row.append(el('p', `出所日照離所紀錄（${stay.departure || '待確認'}）。`, 'form-hint'));
      // 有編號：入所日跟著編號，不能另外改
      const sync = () => {
        const number = inputs.number.value.trim();
        legend.textContent = number ? `編號 ${number}` : '查不到編號的那次';
        inputs.in.readOnly = Boolean(number);
        if (number) inputs.in.value = BQDates.idDay(number);
      };
      inputs.number.addEventListener('input', sync);
      sync();
      if (!current && !stay.departed) {
        const remove = button(stay.number ? `刪掉這列（刪掉編號 ${stay.number}）` : '刪掉這列');
        remove.addEventListener('click', () => {
          row.remove();
          update();
        });
        row.append(remove);
      }
      rows.append(row);
    };
    snapshot.stays.forEach(addRow);
    const add = button('新增一列');
    add.addEventListener('click', () => {
      addRow();
      update();
    });
    controls.append(add);
    previewButton('stays');
  }
  function buildPhoto() {
    const controls = section('photo');
    const file = labelled(controls, textInput('file'), '選擇新照片', 'edit-photo');
    file.accept = 'image/*';
    const image = el('img', undefined, 'edit-photo');
    image.alt = '新照片預覽';
    image.hidden = true;
    controls.append(image);
    file.addEventListener('change', async () => {
      images = null;
      update();
      if (!file.files[0]) return;
      try {
        images = await prepareImages(file.files[0]);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(images.original);
        image.src = previewUrl;
        image.hidden = false;
        status.textContent = images.thumb ? '照片與縮圖已準備好，請預覽後儲存。' : '縮圖未產生，將使用原圖；請預覽後儲存。';
      } catch (e) {
        status.textContent = e.message;
        images = null;
      }
      update();
    });
    const trash = button('查看這隻狗的照片垃圾桶');
    controls.append(trash);
    previewButton('photo');
    trash.addEventListener('click', async () => {
      const result = await call(base() + '/trash');
      if (!result.ok) {
        status.textContent = '垃圾桶暫時無法讀取，請重試';
        return;
      }
      document.getElementById('photo-trash')?.remove();
      const list = el('div', undefined, 'photo-trash');
      list.id = 'photo-trash';
      controls.append(list);
      if (!result.data.trash.length) list.append(el('p', '沒有可復原的照片。', 'form-hint'));
      for (const item of result.data.trash) {
        const pick = button(`預覽復原：${trashLabel(item.deletedAt, result.data.days)}`);
        pick.addEventListener('click', () => {
          images = { restore: item.id };
          preview('photo');
        });
        list.append(pick);
      }
    });
  }
  const builders = {
    intro: buildIntro,
    rest: buildRest,
    fixedCare: buildFixedCare,
    sex: buildSex,
    stays: buildStays,
    photo: buildPhoto
  };
  function rebuild(field) {
    const old = sections[field]?.wrap;
    const holder = el('div');
    if (old) old.replaceWith(holder);
    if (field === 'photo') {
      images = null;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    previewed.delete(field);
    builders[field]();
    if (old) holder.replaceWith(sections[field].wrap);
  }

  // ---- 草稿 ----
  const q = (selector) => fields.querySelector(selector);
  function value(field) {
    if (field === 'intro') return q('#edit-intro').value;
    if (field === 'rest') return q('#edit-rest-end').checked ? null : { until: q('#edit-until').value, reason: q('#edit-reason').value };
    if (field === 'fixedCare') return q('#edit-fixed-care').checked;
    if (field === 'sex') return q('#edit-sex').value;
    if (field === 'stays')
      return [...fields.querySelectorAll('.stay-row')].map((row) => {
        const input = Object.fromEntries([...row.querySelectorAll('input')].map((n) => [n.dataset.key, n.value]));
        return stayRow({ ...input, number: input.number.replace(/\s+/g, '') });
      });
    return images;
  }
  // 草稿和原值用同一套正規化比較：出入所補齊欄位、不比 departed
  const before = (field) => (field === 'stays' ? snapshot.stays.map(stayRow) : snapshot[field]);
  const changed = (field) => (field === 'photo' ? Boolean(images) : !sameValue(value(field), before(field)));
  const draftKey = (field) => (field === 'photo' ? images : JSON.stringify(value(field)));
  const dirtyFields = () => (snapshot ? FIELDS.map(([f]) => f).filter(changed) : []);
  function problems() {
    const list = [];
    for (const field of dirtyFields()) {
      if (field === 'rest' && restProblem(value('rest'))) list.push(restProblem(value('rest')));
      if (PREVIEW_FIELDS.has(field) && previewed.get(field) !== draftKey(field)) list.push(`${FIELD_LABELS[field]}要先按「預覽改前／改後」。`);
    }
    return list;
  }

  function inlineDiff(field) {
    const { diff } = sections[field];
    if (!changed(field)) return diff.replaceChildren();
    const line = el('p', undefined, 'diff-line');
    line.append(el('span', '改前→改後：', 'diff-caption'));
    if (field === 'intro') {
      const part = introDiff(snapshot.intro, value('intro'));
      if (part.lead) line.append(part.lead);
      if (part.removed) line.append(el('del', part.removed));
      if (part.added) line.append(el('ins', part.added));
      if (part.tail) line.append(part.tail);
    } else {
      line.append(el('del', displayValue(field, before(field))), ' → ', el('ins', displayValue(field, value(field))));
    }
    diff.replaceChildren(line);
    if (field === 'rest' && restProblem(value('rest'))) diff.append(el('p', restProblem(value('rest')), 'field-problem'));
  }

  function preview(field) {
    if (!snapshot || busy) return;
    const { diff } = sections[field];
    if (!changed(field)) {
      diff.replaceChildren(el('p', '內容沒有變更，無須儲存。', 'form-hint'));
      previewed.delete(field);
      return update();
    }
    diff.replaceChildren(el('h4', '改前／改後'));
    if (field === 'photo') {
      const oldPhoto = snapshot.photo ? '/' + snapshot.photo.key : dog.photoUrl?.replace('/photos/thumbs/', '/photos/');
      const pair = el('div', undefined, 'photo-pair');
      for (const [label, src] of [
        ['改前', oldPhoto],
        ['改後', images.restore ? base() + '/trash/' + images.restore : previewUrl]
      ]) {
        const figure = el('figure');
        if (src) {
          const img = el('img', undefined, 'edit-photo');
          img.alt = label + '照片';
          img.src = src;
          figure.append(img);
        } else figure.append(el('p', '尚無照片紀錄', 'form-hint'));
        figure.append(el('figcaption', label));
        pair.append(figure);
      }
      diff.append(pair, el('p', '目前照片會保留於垃圾桶，可在 30 天內復原。', 'form-hint'));
    } else {
      for (const [label, shown] of [
        ['改前', displayValue(field, before(field))],
        ['改後', displayValue(field, value(field))]
      ])
        diff.append(el('h5', label), el('pre', shown));
    }
    previewed.set(field, draftKey(field));
    update();
  }

  function update() {
    if (!snapshot) return;
    for (const [field] of FIELDS) {
      const summary = fieldSummary(field, snapshot, dog.photoUrl);
      const { now, wrap, diff } = sections[field];
      now.replaceChildren(summary.missing ? el('span', '待補', 'state-label state-missing') : summary.text);
      wrap.dataset.dirty = String(changed(field));
      if (!PREVIEW_FIELDS.has(field)) inlineDiff(field);
      else if (previewed.has(field) && previewed.get(field) !== draftKey(field)) {
        previewed.delete(field);
        diff.replaceChildren(el('p', '內容改過了，請重新預覽。', 'form-hint'));
      }
    }
    const intro = q('#edit-intro');
    q('#edit-intro-count').textContent = `${[...intro.value].length} / ${INTRO_MAX} 字`;
    const restOff = q('#edit-rest-end').checked;
    q('#edit-until').disabled = restOff;
    q('#edit-reason').disabled = restOff;
    const dirty = dirtyFields(),
      blocked = problems();
    dirtyLine.textContent = dirty.length
      ? `改了 ${dirty.length} 項：${dirty.map((f) => FIELD_LABELS[f]).join('、')}。${blocked.join('')}`
      : '沒有修改。';
    dirtyLine.dataset.blocked = String(blocked.length > 0);
    save.disabled = busy || !dirty.length || blocked.length > 0;
    next.disabled = busy || (dirty.length > 0 && blocked.length > 0);
    next.textContent = dirty.length ? '存並開下一隻' : '下一隻';
  }

  // ---- 讀取與儲存 ----
  async function load(preserve = false) {
    const seq = ++loadSeq;
    busy = true;
    reload.disabled = true;
    update();
    const result = await call(base());
    if (seq !== loadSeq) return;
    busy = false;
    reload.disabled = false;
    if (!result.ok) {
      status.dataset.error = 'true';
      status.textContent = result.data?.error || '資料無法讀取，請重試或重新登入';
      reload.hidden = false;
      reload.textContent = preserve ? '讀取最新資料並保留草稿' : '重新讀取這隻狗';
      update();
      return false;
    }
    snapshot = result.data;
    if (!preserve || !Object.keys(sections).length) {
      sections = {};
      fields.replaceChildren();
      previewed = new Map();
      for (const [field] of FIELDS) builders[field]();
    } else {
      previewed = new Map();
      for (const field of PREVIEW_FIELDS) sections[field].diff.replaceChildren();
    }
    update();
    return true;
  }

  function requestFor(field, revision) {
    const json = (body) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (field !== 'photo') return [base(), json({ revision, field, value: value(field) })];
    if (images.restore)
      return [base() + '/restore', { ...json({ revision, trashId: images.restore }), method: 'POST' }];
    return [base() + '/photo', { method: 'POST', headers: { 'X-Dog-Revision': String(revision) }, body: imageForm(images) }];
  }

  async function saveAll(thenNext) {
    if (!snapshot || busy) return;
    const dirty = dirtyFields();
    if (!dirty.length) return thenNext && onNext(dog.dogId, '');
    if (problems().length) return update();
    busy = true;
    fields.disabled = true;
    reload.hidden = true;
    delete status.dataset.error;
    update();
    const saved = [];
    let failure = null;
    for (const field of dirty) {
      status.textContent = `正在儲存${FIELD_LABELS[field]}…`;
      const result = await call(...requestFor(field, snapshot.revision));
      if (!result.ok) {
        failure = { field, error: result.data?.error || '未能確認儲存', conflict: result.status === 409 };
        break;
      }
      snapshot = result.data;
      dog = patchDog(dog, snapshot);
      saved.push(FIELD_LABELS[field]);
      rebuild(field);
      onSaved(dog);
    }
    busy = false;
    fields.disabled = false;
    if (saved.length) renderHead();
    const done = saved.length ? `已儲存：${saved.join('、')}。` : '';
    if (failure) {
      status.dataset.error = 'true';
      status.textContent = `${done}${FIELD_LABELS[failure.field]}沒存成：${failure.error}。還沒存的草稿保留${
        failure.conflict ? '；請按「讀取最新資料並保留草稿」核對後再存。' : '，可再按儲存重試。'
      }`;
      reload.hidden = false;
      reload.textContent = '讀取最新資料並保留草稿';
      update();
      status.focus();
      return;
    }
    status.textContent = `${done}伺服器已確認。`;
    update();
    if (thenNext) onNext(dog.dogId, `${dog.name || '未命名'} ${done}`);
    else status.focus();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveAll(false);
  });
  next.addEventListener('click', () => saveAll(true));
  reload.addEventListener('click', async () => {
    if (await load(true)) {
      reload.hidden = true;
      delete status.dataset.error;
      status.textContent = '已讀取最新資料，草稿保留；改前→改後已依最新資料重算，出入所紀錄、照片請重新預覽。';
    }
  });
  fields.addEventListener('input', () => {
    leaveArmed = false;
    update();
  });
  fields.addEventListener('change', () => update());
  // Esc 掛在 document：焦點不在抽屜裡（例如存完、點了表格）也關得掉；有其他對話框開著時不搶
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || root.hidden) return;
    if (document.querySelector('dialog[open], [aria-modal="true"]:not([hidden])')) return;
    event.preventDefault();
    api.close();
  });

  // 有沒存的修改時，第一次關閉／換狗只提醒，再按一次才放棄（不擋，只避免誤丟）
  function mayLeave() {
    const dirty = dirtyFields();
    if (busy) return false;
    if (!dirty.length || leaveArmed) return true;
    leaveArmed = true;
    status.dataset.error = 'true';
    status.textContent = `${dog.name || '這隻狗'}還有沒存的修改（${dirty.map((f) => FIELD_LABELS[f]).join('、')}）。再按一次就放棄這些修改。`;
    status.scrollIntoView?.({ block: 'nearest' });
    return false;
  }

  const api = {
    get dogId() {
      return root.hidden ? null : dog?.dogId;
    },
    open(nextDog, { notice = '', force = false } = {}) {
      if (!root.hidden && dog && !force && !mayLeave()) return false;
      dog = nextDog;
      snapshot = null;
      sections = {};
      leaveArmed = false;
      images = null;
      fields.replaceChildren();
      // 合併成功後被併的那隻可能就是正在編輯的這隻：直接關抽屜、重讀狗表
      mergeHost.replaceChildren(
        mergeSection(dog, dogs(), (message) => {
          leaveArmed = true;
          api.close();
          onMerged(message);
        })
      );
      body.scrollTop = 0;
      reload.hidden = true;
      delete status.dataset.error;
      status.textContent = notice ? `${notice}正在讀取${dog.name || '這隻狗'}…` : '正在讀取…';
      dirtyLine.textContent = '';
      save.disabled = true;
      next.disabled = true;
      renderHead();
      root.hidden = false;
      document.body.classList.add('drawer-open');
      root.querySelector('#drawer-title').focus();
      load().then((ok) => {
        if (ok && dog === nextDog)
          status.textContent = notice ? `${notice}現在編輯${dog.name || '未命名'}。` : '改完按「儲存」；出入所紀錄、照片要先預覽。';
      });
      return true;
    },
    close() {
      if (root.hidden || !mayLeave()) return false;
      loadSeq++;
      root.hidden = true;
      document.body.classList.remove('drawer-open');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      const closed = dog.dogId;
      dog = snapshot = null;
      onClose(closed);
      return true;
    }
  };
  return api;
}
