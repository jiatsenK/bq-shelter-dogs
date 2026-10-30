// 待核對的狗記成已出所（K 2026-10-30）：抽屜裡一段，只有待核對的狗才有。填離所日、選原因，按兩次才寫入；
// 寫進離所紀錄後這隻狗變已出所（資料頁已出所分頁、志工網站已出所名單）。出入所紀錄手填過出所日的，帶進來當預設、手填的原因列出來參考
import { BQDates } from '../shared/dates.js';
import { DEPARTURE_REASON_LABELS } from '../shared/edit-values.js';

const el = (tag, value, className) => {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
};
// 出入所表手填的最後一次出所（沒有離所紀錄的那幾列）
export function handFilledOut(stays = []) {
  const rows = stays.filter(s => s.out && !s.departed);
  return rows.length ? rows[rows.length - 1] : null;
}
// send(body)：POST 記成已出所，回 settle 的結果；revision()：抽屜讀到的版本（還沒讀到是 undefined）
export function departSection({ send, revision, onDeparted }) {
  const wrap = el('section', undefined, 'depart-section');
  wrap.setAttribute('aria-labelledby', 'depart-title');
  const heading = el('h3', '記成已出所');
  heading.id = 'depart-title';
  const hint = el('p', '', 'text-secondary');
  wrap.append(heading, el('p', '不在主清單、也沒有離所紀錄的狗。確定已經出所（認養、離世等）就記下離所日與原因，這隻狗會移到「已出所」。', 'text-secondary'), hint);
  const date = el('input', undefined, 'form-control');
  date.type = 'date';
  date.id = 'depart-date';
  date.max = BQDates.taipeiToday();
  const dateLabel = el('label', '離所日', 'form-label');
  dateLabel.htmlFor = date.id;
  const reason = el('select', undefined, 'form-select');
  reason.id = 'depart-reason';
  reason.append(Object.assign(el('option', '請選擇'), { value: '' }));
  for (const [value, label] of Object.entries(DEPARTURE_REASON_LABELS)) reason.append(Object.assign(el('option', label), { value }));
  const reasonLabel = el('label', '離所原因', 'form-label');
  reasonLabel.htmlFor = reason.id;
  const confirm = el('button', '記成已出所', 'btn btn-outline-danger');
  confirm.type = 'button';
  const note = el('p', '');
  note.setAttribute('role', 'status');
  note.setAttribute('aria-live', 'polite');
  wrap.append(dateLabel, date, reasonLabel, reason, confirm, note);
  let armed = false, busy = false;
  const reset = () => {
    armed = false;
    confirm.textContent = '記成已出所';
    confirm.className = 'btn btn-outline-danger';
  };
  date.addEventListener('input', reset);
  reason.addEventListener('change', reset);
  confirm.addEventListener('click', async () => {
    if (busy) return;
    if (!date.value || !reason.value) { note.textContent = '請填離所日、選離所原因。'; return; }
    if (revision() === undefined) { note.textContent = '還在讀取這隻狗，請稍候再按。'; return; }
    if (!armed) {
      armed = true;
      confirm.className = 'btn btn-danger';
      confirm.textContent = `確定記成 ${date.value} 離所（${DEPARTURE_REASON_LABELS[reason.value]}）`;
      note.textContent = '再按一次才會寫入。';
      return;
    }
    busy = confirm.disabled = date.disabled = reason.disabled = true;
    note.textContent = '正在記下…';
    const response = await send({ revision: revision(), date: date.value, reason: reason.value });
    busy = confirm.disabled = date.disabled = reason.disabled = false;
    reset();
    if (!response.ok) {
      note.textContent = response.data?.error || '沒有記成已出所，資料沒有改；請重新讀取再試。';
      return;
    }
    onDeparted(`已記成 ${date.value} 離所（${DEPARTURE_REASON_LABELS[reason.value]}），移到「已出所」。`);
  });
  return {
    node: wrap,
    // 抽屜讀到這隻狗的資料後：手填的出所日帶進來當預設（管理者已經改過就不蓋）
    fill(snapshot) {
      const out = handFilledOut(snapshot.stays);
      hint.textContent = out ? `出入所紀錄手填：${out.out} 出所${out.outReason ? `，${out.outReason}` : ''}。` : '';
      if (out && !date.value && out.out <= date.max) date.value = out.out;
    },
  };
}
