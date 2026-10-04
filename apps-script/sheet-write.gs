// 按「溜了」寫進試算表（#138）：這份貼到 Google Apps Script，用 K 的 Google 帳號部署成「網頁應用程式」。
// 步驟見 docs/SHEET_WRITE_SETUP.md。網站不會直接呼叫這裡，都經過 Worker（POST /api/walk），有設通關碼時 Worker 會帶過來。
// 只會改「主清單」的「遛狗日期」「誰遛的」兩欄，其他欄、其他分頁都不碰。
//
// 指令碼屬性（專案設定 → 指令碼屬性）：
//   SHEET_ID   試算表 ID（網址 /d/ 和 /edit 中間那串）
//   WRITE_KEY  （可不設）通關碼；有設的話 GitHub Secret SHEET_WRITE_KEY 要一樣

var SHEET_NAME = '主清單';
var TIME_ZONE = 'Asia/Taipei';
var HEADERS = { id: '編號', name: '犬名', date: '遛狗日期', walker: '誰遛的' };
// 跟 scripts/sync-sheet.mjs 的 NAME_SEP 一樣：一格寫好幾個名字時用這些符號或空白隔開
var NAME_SEP = /[、,，\/／&＆+＋。｡．.;；:：|｜·・\s]+/;

function doPost(e) {
  var out;
  try {
    out = handleRequest(JSON.parse(e.postData.contents));
  } catch (err) {
    out = { ok: false, error: '小程式發生錯誤：' + (err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// 部署後用瀏覽器打開網址，看得到這行就代表有在跑（不會顯示試算表內容）
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: '板收志工溜狗表 寫入試算表' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleRequest(req) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('WRITE_KEY');
  if (!req) return { ok: false, error: '沒有資料' };
  // K 決定先不設通關碼（2026-10-04）；有設 WRITE_KEY 才檢查
  if (key && req.key !== key) return { ok: false, error: '通關碼不對', code: 'key' };
  var lock = LockService.getScriptLock();
  lock.waitLock(15000); // 兩個人同時按，一個一個來，免得互相蓋掉
  try {
    var sheet = SpreadsheetApp.openById(props.getProperty('SHEET_ID')).getSheetByName(SHEET_NAME);
    if (!sheet) return { ok: false, error: '找不到「' + SHEET_NAME + '」分頁' };
    var values = sheet.getDataRange().getValues();
    var today = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
    var plan = planSheetWrites(values, req, today, ymdOf);
    if (plan.error) return { ok: false, error: plan.error };
    plan.cells.forEach(function (c) {
      sheet.getRange(c.row + 1, c.col + 1).setValue(c.date ? toSheetDate(c.date) : c.value);
    });
    return { ok: true, today: today, results: plan.results };
  } finally {
    lock.releaseLock();
  }
}

function ymdOf(v) {
  return Utilities.formatDate(v, TIME_ZONE, 'yyyy-MM-dd');
}

// 寫成「2026/10/4」這種文字，跟志工手打一樣，試算表會自己認成日期；不用 new Date()，免得小程式時區跟試算表不同差一天
function toSheetDate(ymd) {
  var p = ymd.split('-').map(Number);
  return p[0] + '/' + p[1] + '/' + p[2];
}

// ── 下面不碰 Google 的東西，Node 測試也跑得到（worker/test/sheet-write.test.mjs）──

function isDate(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function cellText(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

// 存「原本的內容」用：日期格存成 { date: 'yyyy-MM-dd' }，其他存文字
function serializeCell(v, ymd) {
  if (isDate(v)) return { date: ymd(v) };
  return { text: cellText(v) };
}

function findHeader(values) {
  for (var r = 0; r < Math.min(values.length, 30); r++) {
    var norm = values[r].map(function (v) { return cellText(v).replace(/\s+/g, ''); });
    var cols = {};
    Object.keys(HEADERS).forEach(function (k) {
      var i = norm.indexOf(HEADERS[k]);
      if (i === -1) i = norm.findIndex(function (t) { return t.indexOf(HEADERS[k]) !== -1; });
      if (i !== -1) cols[k] = i;
    });
    if (cols.name !== undefined) return { row: r, cols: cols };
  }
  return null;
}

// 有編號用編號找，沒編號才用犬名
function findDogRow(values, header, dog) {
  for (var r = header.row + 1; r < values.length; r++) {
    var row = values[r];
    if (dog.id) {
      if (cellText(row[header.cols.id]) === dog.id) return r;
    } else if (cellText(row[header.cols.name]) === dog.name && !cellText(row[header.cols.id])) {
      return r;
    }
  }
  return -1;
}

function namesIn(text) {
  return cellText(text).split(NAME_SEP).filter(function (n) { return n; });
}

// req.action：
//   walk：每隻狗的遛狗日期改成今天、誰遛的填 req.walker；今天已經有別人寫了就接在後面（「甲、我」），已經有我就不動
//   undo：每隻狗如果還是我們寫的樣子（今天、誰遛的跟 wrote 一樣），寫回 prev；被別人改過就不動
// 回傳 { cells: [{ row, col, value | date }], results: [每隻狗的結果] } 或 { error }
function planSheetWrites(values, req, today, ymd) {
  var header = findHeader(values);
  if (!header) return { error: '主清單找不到「犬名」表頭' };
  var missing = ['id', 'date', 'walker'].filter(function (k) { return header.cols[k] === undefined; });
  if (missing.length) return { error: '主清單找不到「' + missing.map(function (k) { return HEADERS[k]; }).join('」「') + '」欄' };
  var cols = header.cols;
  var cells = [];
  var results = (req.dogs || []).map(function (dog) {
    var r = findDogRow(values, header, dog);
    var base = { id: dog.id, name: dog.name };
    if (r === -1) return Object.assign(base, { status: 'notFound' });
    var dateCell = values[r][cols.date];
    var walkerNow = cellText(values[r][cols.walker]);
    var isToday = isDate(dateCell) ? ymd(dateCell) === today : cellText(dateCell).replace(/\//g, '-') === today;
    if (req.action === 'walk') {
      var me = cellText(req.walker);
      var prev = { date: serializeCell(dateCell, ymd), walker: walkerNow };
      var walker = me;
      if (isToday && walkerNow) {
        if (namesIn(walkerNow).indexOf(me) !== -1) return Object.assign(base, { status: 'already' });
        walker = walkerNow + '、' + me;
      }
      if (!isToday) cells.push({ row: r, col: cols.date, date: today });
      cells.push({ row: r, col: cols.walker, value: walker });
      return Object.assign(base, { status: 'written', prev: prev, wrote: { walker: walker } });
    }
    if (req.action === 'undo') {
      if (!dog.prev || !dog.wrote || !isToday || walkerNow !== cellText(dog.wrote.walker)) return Object.assign(base, { status: 'changed' });
      var p = dog.prev.date || {};
      if (p.date) cells.push({ row: r, col: cols.date, date: p.date });
      else cells.push({ row: r, col: cols.date, value: p.text || '' });
      cells.push({ row: r, col: cols.walker, value: cellText(dog.prev.walker) });
      return Object.assign(base, { status: 'restored' });
    }
    return Object.assign(base, { status: 'badAction' });
  });
  return { cells: cells, results: results };
}
