import { settle } from '../shared/api-response.js';
import { prepareImages, imageForm } from '../shared/photo-images.js';

const labels = {
  intro: '介紹',
  rest: '休養',
  fixedCare: '固定照顧',
  numbers: '編號',
  stays: '出入所紀錄',
  sex: '性別補正',
  photo: '照片'
};
const text = (tag, value, className) => {
  const el = document.createElement(tag);
  el.textContent = value;
  if (className) el.className = className;
  return el;
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
const show = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const sexLabel = (value) => ({ male: '公', female: '母' })[value] || '待確認';
function displayValue(field, value) {
  if (field === 'sex') return sexLabel(value);
  if (field === 'fixedCare') return value ? '開啟固定照顧' : '關閉固定照顧';
  if (field === 'rest') return value ? `休養至 ${value.until}；原因：${value.reason || '未填'}` : '未設定休養';
  if (field === 'numbers') return value.join('\n') || '無編號';
  if (field === 'stays')
    return (
      value.map((row) => `入所 ${row.in}／出所 ${row.out || '尚未出所'}／${row.reason || '未填原因'}`).join('\n') ||
      '無補登紀錄'
    );
  return show(value) || '（空白）';
}
export function openDogEditor(dog, container, onSaved) {
  container.replaceChildren();
  container.hidden = false;
  const title = text('h2', `編輯 ${dog.name || '未命名'} 的資料`);
  title.tabIndex = -1;
  container.append(title);
  container.append(text('p', `永久 ID：${dog.dogId}。目前編號、狗名、籠位及試算表備註只能查閱。`));
  const status = text('p', '正在讀取…');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  container.append(status);
  const form = document.createElement('form');
  form.className = 'dog-edit-form';
  container.append(form);
  const close = text('button', '關閉編輯', 'btn');
  close.type = 'button';
  close.addEventListener('click', () => {
    container.hidden = true;
  });
  container.append(close);
  const base = `/api/manage/dogs/${encodeURIComponent(dog.dogId)}`;
  let snapshot = null,
    images = null,
    previewUrl = null,
    busy = false;
  const field = document.createElement('select');
  field.className = 'form-select';
  field.id = 'edit-field';
  for (const [key, label] of Object.entries(labels)) {
    const option = text('option', label);
    option.value = key;
    field.append(option);
  }
  const fieldLabel = text('label', '修改項目', 'form-label');
  fieldLabel.htmlFor = field.id;
  const controls = document.createElement('div'),
    diff = document.createElement('div');
  diff.className = 'edit-diff';
  const submit = text('button', '確認儲存這一項', 'btn btn-primary');
  submit.type = 'submit';
  submit.disabled = true;
  const reload = text('button', '讀取最新資料並保留草稿', 'btn');
  reload.type = 'button';
  const preview = text('button', '預覽改前／改後', 'btn');
  preview.type = 'button';
  form.append(fieldLabel, field, controls, preview, diff, submit, reload);
  function input(type, id, label, value = '') {
    const wrap = document.createElement('div'),
      caption = text('label', label, 'form-label');
    caption.htmlFor = id;
    const node = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') node.type = type;
    node.id = id;
    node.className = 'form-control';
    node.value = value;
    wrap.append(caption, node);
    controls.append(wrap);
    return node;
  }
  function renderControls() {
    controls.replaceChildren();
    diff.replaceChildren();
    submit.disabled = true;
    images = null;
    status.textContent = '草稿尚未儲存；修改後請預覽，再確認儲存。';
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    const key = field.value;
    if (key === 'intro') {
      const node = input('textarea', 'edit-value', '介紹（最多 1000 字）', snapshot.intro);
      node.rows = 6;
      node.maxLength = 2000;
    }
    if (key === 'sex') {
      controls.append(
        text(
          'p',
          `目前性別：${sexLabel(snapshot.sex)}。舊試算表副本已停止維護；請以狗正本逐隻確認，不依名字推測。`
        )
      );
      const node = document.createElement('select');
      node.className = 'form-select';
      node.id = 'edit-value';
      const label = text('label', '性別', 'form-label');
      label.htmlFor = node.id;
      for (const [value, label] of [
        ['', '待確認'],
        ['male', '公'],
        ['female', '母']
      ]) {
        const option = text('option', label);
        option.value = value;
        node.append(option);
      }
      node.value = snapshot.sex;
      controls.append(label, node);
    }
    if (key === 'fixedCare') {
      const node = input('checkbox', 'edit-value', '有人固定照顧');
      node.checked = snapshot.fixedCare;
    }
    if (key === 'rest') {
      const off = input('checkbox', 'edit-rest-end', '結束休養');
      off.checked = !snapshot.rest;
      input('date', 'edit-until', '休養至（今天至 180 天內）', snapshot.rest?.until || '');
      input('text', 'edit-reason', '原因（最多 40 字）', snapshot.rest?.reason || '');
    }
    if (key === 'numbers') {
      controls.append(
        text(
          'p',
          `目前編號不可移除：${snapshot.currentNumbers.join('、') || '無編號'}。每行一個編號，不可移給另一隻狗。`
        )
      );
      input('textarea', 'edit-value', '所有編號（每行一個）', snapshot.numbers.join('\n')).rows = 5;
    }
    if (key === 'stays') {
      const rows = document.createElement('div');
      rows.id = 'edit-stays';
      controls.append(rows);
      const addRow = (stay = { in: '', out: '', reason: '' }) => {
        const row = document.createElement('fieldset');
        row.className = 'stay-row';
        row.append(text('legend', '一次出入所'));
        for (const [key, label, type] of [
          ['in', '入所日', 'date'],
          ['out', '出所日（還在所留空）', 'date'],
          ['reason', '原因', 'text']
        ]) {
          const wrap = text('label', label);
          const node = document.createElement('input');
          node.className = 'form-control';
          node.type = type;
          node.dataset.key = key;
          node.value = stay[key];
          wrap.append(node);
          row.append(wrap);
        }
        const remove = text('button', '移除這筆', 'btn');
        remove.type = 'button';
        remove.onclick = () => {
          row.remove();
          submit.disabled = true;
        };
        row.append(remove);
        rows.append(row);
      };
      snapshot.stays.forEach(addRow);
      const add = text('button', '新增一次出入所', 'btn');
      add.type = 'button';
      add.onclick = () => {
        addRow();
        submit.disabled = true;
      };
      controls.append(add);
    }
    if (key === 'photo') {
      const file = input('file', 'edit-value', '選擇新照片');
      file.accept = 'image/*';
      const image = document.createElement('img');
      image.className = 'edit-photo';
      image.alt = '新照片預覽';
      image.hidden = true;
      controls.append(image);
      file.addEventListener('change', async () => {
        submit.disabled = true;
        if (!file.files[0]) return;
        try {
          images = await prepareImages(file.files[0]);
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          previewUrl = URL.createObjectURL(images.original);
          image.src = previewUrl;
          image.hidden = false;
          status.textContent = images.thumb ? '照片與縮圖已準備好，請預覽後儲存。' : '縮圖未產生，將使用原圖。';
        } catch (e) {
          status.textContent = e.message;
          images = null;
        }
      });
      const trash = text('button', '查看這隻狗的照片垃圾桶', 'btn');
      trash.type = 'button';
      controls.append(trash);
      trash.onclick = async () => {
        const result = await call(base + '/trash');
        if (!result.ok) {
          status.textContent = '垃圾桶暫時無法讀取，請重試';
          return;
        }
        let list = document.getElementById('photo-trash');
        if (list) list.remove();
        list = document.createElement('div');
        list.id = 'photo-trash';
        controls.append(list);
        if (!result.data.trash.length) list.append(text('p', '沒有可復原的照片。'));
        for (const item of result.data.trash) {
          const button = text('button', `預覽復原 ${item.deletedAt} 的照片`, 'btn');
          button.type = 'button';
          button.onclick = () => {
            images = { restore: item.id };
            renderPreview();
            submit.disabled = false;
          };
          list.append(button);
        }
      };
    }
  }
  function value() {
    const node = controls.querySelector('#edit-value');
    if (field.value === 'fixedCare') return node.checked;
    if (field.value === 'rest')
      return controls.querySelector('#edit-rest-end').checked
        ? null
        : { until: controls.querySelector('#edit-until').value, reason: controls.querySelector('#edit-reason').value };
    if (field.value === 'numbers') return node.value.split(/\s+/).filter(Boolean).sort();
    if (field.value === 'stays')
      return [...controls.querySelectorAll('.stay-row')].map((row) =>
        Object.fromEntries([...row.querySelectorAll('input')].map((n) => [n.dataset.key, n.value]))
      );
    if (field.value === 'photo') return images;
    return node.value;
  }
  async function load(preserve = false) {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    reload.disabled = true;
    const result = await call(base);
    busy = false;
    reload.disabled = false;
    if (!result.ok) {
      status.textContent = result.data?.error || '資料無法讀取，請重試或重新登入';
      return;
    }
    snapshot = result.data;
    if (!preserve) renderControls();
    diff.replaceChildren();
    status.textContent = preserve
      ? '已讀取最新資料，草稿保留；請重新預覽改前／改後。'
      : '選擇項目，修改後預覽，再逐項儲存。';
  }
  field.addEventListener('change', () => {
    if (snapshot) renderControls();
  });
  controls.addEventListener('input', () => {
    submit.disabled = true;
    diff.replaceChildren();
    status.textContent = '草稿尚未儲存；修改後請重新預覽。';
  });
  function renderPreview() {
    if (!snapshot || busy) return;
    const next = value();
    diff.replaceChildren(
      text('h3', '改前／改後'),
      text('h4', '改前'),
      text('pre', field.value === 'photo' ? '目前照片' : displayValue(field.value, snapshot[field.value])),
      text('h4', '改後'),
      text('pre', field.value === 'photo' ? '選取的照片' : displayValue(field.value, next))
    );
    if (field.value === 'photo') {
      diff.replaceChildren(text('h3', '改前／改後'));
      const oldPhoto = snapshot.photo ? '/' + snapshot.photo.key : dog.photoUrl?.replace('/photos/thumbs/', '/photos/');
      for (const [label, src] of [
        ['改前', oldPhoto],
        ['改後', images?.restore ? base + '/trash/' + images.restore : previewUrl]
      ]) {
        diff.append(text('h4', label));
        if (src) {
          const img = document.createElement('img');
          img.className = 'edit-photo';
          img.alt = label + '照片';
          img.src = src;
          diff.append(img);
        } else diff.append(text('p', '尚無照片紀錄'));
      }
      diff.append(text('p', '目前照片會保留於垃圾桶，可在 30 天內復原。'));
    }
    submit.disabled =
      field.value === 'photo' ? !images : JSON.stringify(next) === JSON.stringify(snapshot[field.value]);
    status.textContent = submit.disabled ? '內容沒有變更，無須儲存。' : '預覽完成，草稿尚未儲存；請核對後確認儲存。';
  }
  preview.onclick = renderPreview;
  reload.onclick = () => load(true);
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!snapshot || submit.disabled || busy) return;
    busy = true;
    submit.disabled = true;
    field.disabled = true;
    reload.disabled = true;
    close.disabled = true;
    preview.disabled = true;
    const fieldset = document.createElement('fieldset');
    fieldset.disabled = true;
    while (controls.firstChild) fieldset.append(controls.firstChild);
    controls.append(fieldset);
    status.textContent = '正在儲存，請稍候…';
    const next = value();
    let path = base,
      init = {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: snapshot.revision, field: field.value, value: next })
      };
    if (field.value === 'photo') {
      if (images.restore) {
        path += '/restore';
        init = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: snapshot.revision, trashId: images.restore })
        };
      } else {
        path += '/photo';
        init = { method: 'POST', headers: { 'X-Dog-Revision': String(snapshot.revision) }, body: imageForm(images) };
      }
    }
    const result = await call(path, init);
    busy = false;
    field.disabled = false;
    reload.disabled = false;
    close.disabled = false;
    preview.disabled = false;
    while (fieldset.firstChild) controls.insertBefore(fieldset.firstChild, fieldset);
    fieldset.remove();
    if (!result.ok) {
      status.textContent = result.data?.error || '未能確認儲存，草稿保留；請讀取最新資料核對後再試';
      return;
    }
    snapshot = result.data;
    renderControls();
    status.textContent = '這一項已儲存，重新讀取確認完成。';
    onSaved();
  };
  load();
  title.focus();
}
