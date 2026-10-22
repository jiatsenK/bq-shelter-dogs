// 共用日期工具（ADR 0005、0011、0017）：日期物件保留既有本地午夜語意。
const BQDates = (() => {
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

  // 現在編號、舊編號與出入所紀錄，三者裡最早的那天；沒有可讀日期回 null。
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

  return { makeDate, parseYmd, idDate, firstIntake, localDateKey, taipeiToday, taipeiStamp };
})();
