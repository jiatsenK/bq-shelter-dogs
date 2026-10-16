// 按「溜了」寫進試算表（#138）：這份貼到 Google Apps Script，用 K 的 Google 帳號部署成「網頁應用程式」。
// 步驟見 docs/setup/SHEET_WRITE_SETUP.md。網站不會直接呼叫這裡，都經過 Worker（POST /api/walk），有設通關碼時 Worker 會帶過來。
// 只會改「主清單」的「遛狗日期」「誰遛的」兩欄、只追加的「備註」欄和下方異動紀錄（#239、#281），
// 以及「常遛狗群」分頁的狗名格和群名列（K 2026-10-16 開放網站編輯狗群）；其他欄、其他分頁都不碰。
//
// 指令碼屬性（專案設定 → 指令碼屬性）：
//   SHEET_ID   試算表 ID（網址 /d/ 和 /edit 中間那串）
//   WRITE_KEY  （可不設）通關碼；有設的話 GitHub Secret SHEET_WRITE_KEY 要一樣

var SHEET_NAME = '主清單';
var GROUP_SHEET_NAME = '常遛狗群';
var TIME_ZONE = 'Asia/Taipei';
var HEADERS = { cage: '籠位', id: '編號', name: '犬名', date: '遛狗日期', walker: '誰遛的', note: '備註' };
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
    if (req.action === 'group') return writeGroup(SpreadsheetApp.openById(sheetIdOf(props.getProperty('SHEET_ID'))), req);
    var sheet = SpreadsheetApp.openById(sheetIdOf(props.getProperty('SHEET_ID'))).getSheetByName(SHEET_NAME);
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

// 常遛狗群：照 planGroupWrite 算好的結果寫格子；狗名格滿了先在群名列上面插一列（整列插入，各欄的數量公式會自己跟著擴大）
function writeGroup(book, req) {
  var sheet = book.getSheetByName(GROUP_SHEET_NAME);
  if (!sheet) return { ok: false, error: '找不到「' + GROUP_SHEET_NAME + '」分頁' };
  var plan = planGroupWrite(sheet.getDataRange().getValues(), req);
  if (plan.error) return { ok: false, error: plan.error };
  if (plan.insertRowBefore !== undefined) sheet.insertRowBefore(plan.insertRowBefore + 1);
  plan.cells.forEach(function (c) { sheet.getRange(c.row + 1, c.col + 1).setValue(c.value); });
  // 新開的一欄：數量那格照左邊一欄的公式（相對位置）補上
  if (plan.countFormula) {
    var left = sheet.getRange(plan.countFormula.row + 1, plan.countFormula.col);
    var formula = left.getFormulaR1C1();
    if (formula) sheet.getRange(plan.countFormula.row + 1, plan.countFormula.col + 1).setFormulaR1C1(formula);
  }
  return { ok: true, result: plan.result };
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

// SHEET_ID 貼成整個網址、或前後多了空白也沒關係
function sheetIdOf(v) {
  var text = String(v || '').trim();
  var m = text.match(/\/d\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : text;
}

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
  if (req.action === 'note' || req.action === 'log') return planAppend(values, header, req, today);
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
    var dateNow = isDate(dateCell) ? ymd(dateCell) : cellText(dateCell).replace(/\//g, '-').replace(/-(\d)(?=-|$)/g, '-0$1');
    var isToday = dateNow === today;
    if (req.action === 'walk') {
      var me = cellText(req.walker);
      var prev = { date: serializeCell(dateCell, ymd), walker: walkerNow };
      var walker = me;
      if (isToday && walkerNow) {
        var added = namesIn(me).filter(function (n) { return namesIn(walkerNow).indexOf(n) === -1; });
        if (!added.length) return Object.assign(base, { status: 'already', current: { date: today, walker: walkerNow } });
        walker = walkerNow + '、' + added.join('、');
      }
      if (!isToday) cells.push({ row: r, col: cols.date, date: today });
      cells.push({ row: r, col: cols.walker, value: walker });
      return Object.assign(base, { status: 'written', prev: prev, wrote: { walker: walker } });
    }
    if (req.action === 'edit') {
      if (!isToday || walkerNow !== cellText(dog.expected)) return Object.assign(base, { status: 'changed', current: { date: dateNow, walker: walkerNow } });
      var replacement = namesIn(req.walker).filter(function (n, i, list) { return list.indexOf(n) === i; }).join('、');
      if (!replacement) return Object.assign(base, { status: 'badAction' });
      cells.push({ row: r, col: cols.walker, value: replacement });
      return Object.assign(base, { status: 'written', prev: { date: serializeCell(dateCell, ymd), walker: walkerNow }, wrote: { walker: replacement } });
    }
    if (req.action === 'undo') {
      if (!dog.prev || !dog.wrote || !isToday || walkerNow !== cellText(dog.wrote.walker)) return Object.assign(base, { status: 'changed', current: { date: dateNow, walker: walkerNow } });
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

// ── 只追加（#239、#281）：日期用今天（台灣時間），月日不補 0；名字用全形括號；不刪、不改原本的字 ──
function appendEntry(req, today) {
  var p = today.split('-').map(Number);
  return p[0] + '/' + p[1] + '/' + p[2] + cellText(req.text) + '（' + cellText(req.walker) + '）';
}

// note：該狗「備註」欄接上「;日期內容（名字）」，原本空的就不加分號
// log：狗清單下方異動紀錄最後一列的下一列，籠位欄寫「備註N」（現有最大 N + 1），編號欄寫「日期內容（名字）」
function planAppend(values, header, req, today) {
  var cols = header.cols;
  if (!cellText(req.text) || !cellText(req.walker)) return { error: '內容和名字都要有' };
  var entry = appendEntry(req, today);
  if (req.action === 'note') {
    if (cols.note === undefined || cols.id === undefined) return { error: '主清單找不到「備註」或「編號」欄' };
    var dog = (req.dogs || [])[0] || {};
    var base = { id: dog.id, name: dog.name };
    var r = findDogRow(values, header, dog);
    if (r === -1) return { cells: [], results: [Object.assign(base, { status: 'notFound' })] };
    var raw = values[r][cols.note];
    var now = raw === null || raw === undefined ? '' : String(raw);
    var value = now.trim() ? now + ';' + entry : entry;
    return { cells: [{ row: r, col: cols.note, value: value }], results: [Object.assign(base, { status: 'written', prev: { note: now }, wrote: { note: value } })] };
  }
  if (cols.cage === undefined || cols.id === undefined) return { error: '主清單找不到「籠位」或「編號」欄' };
  var max = 0;
  for (var i = header.row + 1; i < values.length; i++) {
    var m = cellText(values[i][cols.cage]).match(/^備註\s*(\d*)/);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  var last = values.length - 1;
  while (last > header.row && values[last].every(function (v) { return cellText(v) === ''; })) last--;
  var label = '備註' + (max + 1);
  return {
    cells: [{ row: last + 1, col: cols.cage, value: label }, { row: last + 1, col: cols.id, value: entry }],
    results: [{ status: 'written', wrote: { label: label, text: entry } }],
  };
}

// ── 常遛狗群（K 2026-10-16）：每一欄是一群；上面有一列數量（數字），最下面一列是群名，中間是狗名 ──
// req.op：
//   add：req.column 那群加上 req.name（已經在就不動）；中間沒空格就在群名列上面插一列
//   remove：req.column 那群拿掉 req.name，下面的狗往上補，不留空格
//   create：開一個新群（第一個整欄空的欄，沒有就接在最右邊），群名 req.label、第一隻狗 req.name
// 回傳 { cells, insertRowBefore?, countFormula?, result: { status, column, label, names } } 或 { error }
function groupNameKey(n) {
  return cellText(n).replace(/\s+/g, '').toLowerCase();
}

function groupLayout(values) {
  var isNumber = function (v) { return typeof v === 'number' || /^\d+$/.test(cellText(v)); };
  var countRow = -1;
  for (var r = 0; r < Math.min(values.length, 10); r++) {
    var filled = values[r].filter(function (v) { return cellText(v) !== ''; });
    if (filled.length && filled.every(isNumber)) { countRow = r; break; }
  }
  var labelRow = values.length - 1;
  while (labelRow > countRow && values[labelRow].every(function (v) { return cellText(v) === ''; })) labelRow--;
  if (countRow === -1 || labelRow <= countRow + 1) return null;
  return { countRow: countRow, labelRow: labelRow, first: countRow + 1, width: values[0].length };
}

function planGroupWrite(values, req) {
  var layout = groupLayout(values);
  if (!layout) return { error: '常遛狗群分頁找不到數量列或群名列' };
  var name = cellText(req.name);
  if (!name) return { error: '要有狗名' };
  var cell = function (r, c) { return r < values.length && c < (values[r] || []).length ? cellText(values[r][c]) : ''; };
  var namesOf = function (c) {
    var out = [];
    for (var r = layout.first; r < layout.labelRow; r++) if (cell(r, c)) out.push(cell(r, c));
    return out;
  };
  var result = function (status, col, names) {
    return { status: status, column: col, label: cell(layout.labelRow, col), names: names };
  };
  if (req.op === 'create') {
    var label = cellText(req.label);
    if (!label) return { error: '要有群名' };
    var col = 0;
    while (col < layout.width && (namesOf(col).length || cell(layout.labelRow, col))) col++;
    var out = { cells: [{ row: layout.first, col: col, value: name }, { row: layout.labelRow, col: col, value: label }], result: { status: 'written', column: col, label: label, names: [name] } };
    if (col > 0 && !cell(layout.countRow, col)) out.countFormula = { row: layout.countRow, col: col };
    return out;
  }
  var c = Number(req.column);
  if (!(c >= 0 && c < layout.width) || (!namesOf(c).length && !cell(layout.labelRow, c))) return { error: '找不到這一群' };
  var names = namesOf(c);
  var at = names.map(groupNameKey).indexOf(groupNameKey(name));
  if (req.op === 'add') {
    if (at !== -1) return { cells: [], result: result('already', c, names) };
    for (var r = layout.first; r < layout.labelRow; r++) {
      if (!cell(r, c)) return { cells: [{ row: r, col: c, value: name }], result: result('written', c, names.concat([name])) };
    }
    // 中間格子都滿了：插在群名列上面，插完新的那列就在原本群名列的位置
    return { insertRowBefore: layout.labelRow, cells: [{ row: layout.labelRow, col: c, value: name }], result: result('written', c, names.concat([name])) };
  }
  if (req.op === 'remove') {
    if (at === -1) return { cells: [], result: result('notFound', c, names) };
    var left = names.slice(0, at).concat(names.slice(at + 1));
    var cells = [];
    for (var k = layout.first; k < layout.labelRow; k++) {
      var want = left[k - layout.first] || '';
      if (cell(k, c) !== want) cells.push({ row: k, col: c, value: want });
    }
    return { cells: cells, result: result('written', c, left) };
  }
  return { error: '不認得的狗群操作' };
}
