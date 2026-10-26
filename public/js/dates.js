

// 共用日期工具（ADR 0005、0011、0017）：日期物件保留既有本地午夜語意。
export const BQDates = (() => {
  function makeDate(y, m, d) {
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return date;
  }

  function parseYmd(text) {
    const m = String(text || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    return m ? makeDate(+m[1], +m[2], +m[3]) : null;
  }

  function idDate(id) {
    const m = String(id || '').match(/^(\d{4})(\d{2})(\d{2})\d{2}$/);
    return m ? makeDate(+m[1], +m[2], +m[3]) : null;
  }

  // 編號前 8 碼的日期（YYYY-MM-DD）；看不出日期回 ''。
  function idDay(id) {
    const text = String(id || '');
    return idDate(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : '';
  }

  // 出入所表（ADR 0021）：一個編號一列＋查不到編號的那幾次。Worker 只給手填過或有離所紀錄的狗 stays（整張表）；
  // 沒給的就是只有編號，這裡用編號排出來。照入所日排、看不出日期的排最後，跟 Worker 的 stayTable 一樣。
  function stayRows(dog) {
    if (Array.isArray(dog.stays)) return dog.stays;
    const numbers = [dog.id, ...(Array.isArray(dog.formerIds) ? dog.formerIds : [])].filter(Boolean);
    return [...new Set(numbers)].map(number => ({ number, in: idDay(number), out: '', reason: '' }))
      .sort((a, b) => (a.in || '9999').localeCompare(b.in || '9999') || a.number.localeCompare(b.number));
  }

  // 所有出入所紀錄裡最早的入所日（現在編號、舊編號、手填的都算）；沒有可讀日期回 null。
  function firstIntake(dog) {
    const stays = Array.isArray(dog.stays) ? dog.stays.map(r => parseYmd(r && r.in)) : [];
    const dates = [...[dog.id, ...(Array.isArray(dog.formerIds) ? dog.formerIds : [])].map(idDate), ...stays].filter(Boolean);
    return dates.length ? dates.reduce((a, b) => (b < a ? b : a)) : null;
  }

  // 手機暫存沿用本地日期；不要改成台灣日期，以免更動既有資料的歸日規則。
  function localDateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function taipeiToday(now = new Date()) {
    return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  }

  function taipeiStamp(now = new Date()) {
    const [y, m, d] = taipeiToday(now).split('-').map(Number);
    return `${y}/${m}/${d}`;
  }

  return { makeDate, parseYmd, idDate, idDay, stayRows, firstIntake, localDateKey, taipeiToday, taipeiStamp };
})();
