// 按「溜了」寫進試算表（#138）：這份貼到 Google Apps Script，用 K 的 Google 帳號部署成「網頁應用程式」。
// 步驟見 docs/setup/SHEET_WRITE_SETUP.md。網站不會直接呼叫這裡，都經過 Worker（POST /api/walk），有設金鑰時 Worker 會帶過來。
// 只會改「主清單」的「遛狗日期」「誰遛的」兩欄、只追加的「備註」欄和下方異動紀錄（#239、#281），
// 其他欄、其他分頁都不寫；「常遛狗群」只讀人工改表結果並送 Worker（#474）。
//
// 指令碼屬性（專案設定 → 指令碼屬性）：
//   SHEET_ID   試算表 ID（網址 /d/ 和 /edit 中間那串）
//   WRITE_KEY  （可不設）金鑰；有設的話 GitHub Secret SHEET_WRITE_KEY 要一樣

var SHEET_NAME = '主清單';
var GROUP_SHEET_NAME = '常遛狗群';
var TIME_ZONE = 'Asia/Taipei';
var HEADERS = { cage: '籠位', id: '編號', name: '犬名', date: '遛狗日期', walker: '誰遛的', note: '備註' };
// 跟 worker/src/sheet-read.js 的 NAME_SEP 一樣（測試會比對）：一格寫好幾個名字時用這些符號或空白隔開
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
  // K 決定先不設金鑰（2026-10-04）；有設 WRITE_KEY 才檢查
  if (key && req.key !== key) return { ok: false, error: '金鑰不對', code: 'key' };
  if (['walkWake','walkWakeBatch','walkScan'].indexOf(req.action) !== -1 && (!key || req.key !== key)) return { ok: false, error: '寫回必須設定金鑰', code: 'key' };
  var lock = LockService.getScriptLock();
  lock.waitLock(15000); // 兩個人同時按，一個一個來，免得互相蓋掉
  try {
    var sheet = SpreadsheetApp.openById(sheetIdOf(props.getProperty('SHEET_ID'))).getSheetByName(SHEET_NAME);
    if (!sheet) return { ok: false, error: '找不到「' + SHEET_NAME + '」分頁' };
    if (req.action === 'walkWake') return writeLatestWalk(sheet, req, props);
    if (req.action === 'walkScan') return scanWalkSnapshot(sheet, req);
    if (req.action === 'walkWakeBatch') return writeLatestWalks(sheet, req, props);
    // 所有程式寫入共用此鎖；舊版喚醒延後抵達也不能繞過 D1 正本。
    if (props.getProperty('WALK_WORKER_URL') && ['walk', 'edit', 'undo'].indexOf(req.action) !== -1) {
      var gate = walkWorker(props, 'legacy-check', { dogs: req.dogs });
      if (!gate.ok || !gate.allowed) return { ok: false, error: '已使用新登記流程，請重新整理' };
    }
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

function walkWorker(props, action, body) {
  var url = props.getProperty('WALK_WORKER_URL');
  var key = props.getProperty('WRITE_KEY');
  if (!url || !/^https:\/\//.test(url) || !key) throw new Error('尚未設定寫回 Worker');
  var res = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/api/walk-writeback/' + action, {
    method: 'post', contentType: 'application/json', headers: { 'X-Sheet-Write-Key': key },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  var out = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200 || !out.ok) throw new Error('Worker 停止寫回：' + (out.error || res.getResponseCode()));
  return out;
}

// 每次直接重定位，不保存舊列號；無編號只認唯一且無編號的狗名。
function directWalkCell(sheet, dog) {
  var values = sheet.getDataRange().getValues(), header = findHeader(values);
  if (!header || ['id', 'name', 'date', 'walker'].some(function (k) { return header.cols[k] === undefined; })) throw new Error('主清單缺必要欄位');
  var matches = [];
  for (var r = header.row + 1; r < values.length; r++) {
    if (dog.id ? cellText(values[r][header.cols.id]) === dog.id
      : !cellText(values[r][header.cols.id]) && cellText(values[r][header.cols.name]) === dog.name) matches.push(r);
  }
  if (matches.length !== 1) throw new Error('找不到唯一的狗，停止寫回');
  var row = matches[0];
  return { row: row, cols: header.cols, current: walkCellValue(values[row], header.cols) };
}
function walkCellValue(row, cols) {
  var value = row[cols.date];
  var text = isDate(value) ? ymdOf(value) : cellText(value).replace(/\//g, '-').replace(/-(\d)(?=-|$)/g, '-0$1');
  if (text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('日期無法確認，停止寫回');
  return { date: text, walker: cellText(row[cols.walker]) };
}
function sameWalk(a, b) { return a.date === b.date && a.walker === b.walker; }
// 保險比對只取編號、狗名、日期、名單四欄；不下載備註等整份歷史內容。
function readWalkSnapshot(sheet) {
  var header = findHeader(sheet.getRange(1, 1, Math.min(20, sheet.getLastRow()), sheet.getLastColumn()).getValues());
  if (!header || ['id', 'name', 'date', 'walker'].some(function (k) { return header.cols[k] === undefined; })) throw new Error('主清單缺必要欄位');
  var count = sheet.getLastRow() - header.row - 1;
  var columns = {};
  ['id', 'name', 'date', 'walker'].forEach(function (k) {
    columns[k] = count ? sheet.getRange(header.row + 2, header.cols[k] + 1, count, 1).getValues() : [];
  });
  var rows = [];
  for (var r = 0; r < count; r++) {
    var id = cellText(columns.id[r][0]), name = cellText(columns.name[r][0]);
    if (!name) continue;
    var value = columns.date[r][0];
    var date = isDate(value) ? ymdOf(value) : cellText(value).replace(/\//g, '-').replace(/-(\d)(?=-|$)/g, '-0$1');
    rows.push({ dog: { id: id, name: name }, current: { date: date, walker: cellText(columns.walker[r][0]) } });
  }
  return { ok: true, rows: rows };
}
// 合併派送（#460）：一次收最多 10 隻，同一個鎖內逐隻走 writeLatestWalk；單隻失敗只記在該隻，不影響其他隻。
// 保險掃描（ADR 0018 第 5 點）：Worker 送每隻狗在 D1 記的表上值指紋，這裡只回指紋不一樣的狗，不再整份傳回。
// 沒帶 fingerprints（舊版 Worker）就回整份，讓兩邊不必同時部署。
function scanWalkSnapshot(sheet, req) {
  var snapshot = readWalkSnapshot(sheet);
  if (!req.fingerprints || typeof req.fingerprints !== 'object') return snapshot;
  return { ok: true, rows: walkScanRows(snapshot.rows, req.fingerprints, walkScanHash) };
}
function walkScanHash(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ((b + 256) % 256).toString(16).replace(/^(.)$/, '0$1'); }).join('').slice(0, 16);
}
function writeLatestWalks(sheet, req, props) {
  if (!Array.isArray(req.items) || !req.items.length || req.items.length > 10) throw new Error('合併派送數量不對');
  return { ok: true, results: req.items.map(function (item) {
    try { return writeLatestWalk(sheet, item, props); }
    catch (err) { return { ok: false, dispatchId: item && item.dispatchId, error: String(err && err.message ? err.message : err) }; }
  }) };
}
function writeLatestWalk(sheet, req, props) {
  if (!req.dog || !req.dispatchId) throw new Error('缺少寫回識別');
  var observed = directWalkCell(sheet, req.dog);
  var target = walkWorker(props, 'target', { dog: req.dog, dispatchId: req.dispatchId, current: observed.current });
  if (target.skip) return { ok:true, version:target.version, dispatchId:target.dispatchId, current:target.current, confirmed:true };
  // 人工不受 script lock 限制：寫前再讀，排序則重新定位，值不同立即停寫。
  var before = directWalkCell(sheet, req.dog);
  if (!sameWalk(observed.current, before.current)) {
    walkWorker(props,'observe',{ observations:[{ dog:req.dog,current:before.current }] });
    throw new Error('寫前觀測到人工修改，停止寫回');
  }
  if (!sameWalk(before.current, target.current)) {
    sheet.getRange(before.row + 1, before.cols.date + 1).setValue(target.current.date ? toSheetDate(target.current.date) : '');
    sheet.getRange(before.row + 1, before.cols.walker + 1).setValue(target.current.walker);
    SpreadsheetApp.flush();
  }
  var after = directWalkCell(sheet, req.dog);
  if (!sameWalk(after.current, target.current)) throw new Error('試算表讀回不符');
  var receipt = { dogKey: req.dog.id || '名:' + req.dog.name, version: target.version, dispatchId: target.dispatchId, current: after.current };
  var confirmed = walkWorker(props, 'receipt', receipt);
  return { ok: true, version: receipt.version, dispatchId: receipt.dispatchId, current: receipt.current, confirmed: confirmed.confirmed };
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
// #474：只供 GAS 編輯觸發與保險掃描判讀分頁，網站寫入已移除。
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

// ── 有人編輯才同步今日溜狗（#500，ADR 0018）──
// 觸發器：執行一次 installWalkEditTriggers（會建立「編輯時」→ onWalkSheetEdit、每 10 分鐘 → flushWalkEdits／flushDogList、每天三次 → dogListScan，
// 並刪掉 #501 退役的「變更時 → notifyWorker」舊觸發器；#512 起函式已刪，留著的舊觸發器只會報錯、不影響其他功能）。
// 只送受影響的列（編號＋改到的欄），Worker 依送來的列更新、不回頭讀整張表。網站寫回（doPost）是程式寫入，不會觸發。
// 送不出去（缺設定、HTTP 失敗、結果不明）就留在 WALK_EDITS_PENDING，下次編輯或每 10 分鐘補送；確認只清同一版本。
var DEPARTED_SHEET_NAME = '已出所';
var PENDING_EDITS = 'WALK_EDITS_PENDING';
var EDIT_BATCH = 50; // 跟 Worker 的 EDIT_ROWS_MAX 一樣
var FLUSH_ROUNDS = 4; // 一次觸發最多送 4 批（200 隻），其餘留給下次，避免單次執行過久

function installWalkEditTriggers() {
  var id = sheetIdOf(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['onWalkSheetEdit', 'flushWalkEdits', 'flushDogList', 'dogListScan', 'notifyWorker'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onWalkSheetEdit').forSpreadsheet(id).onEdit().create();
  ScriptApp.newTrigger('flushWalkEdits').timeBased().everyMinutes(10).create();
  // 狗清單（#501）：送不出去的每 10 分鐘補送；保險掃描每天台灣 09:43、13:53、23:53（專案時區要是 Asia/Taipei；Google 只保證在那個小時內、約略那幾分）
  ScriptApp.newTrigger('flushDogList').timeBased().everyMinutes(10).create();
  [[9, 43], [13, 53], [23, 53]].forEach(function (t) { ScriptApp.newTrigger('dogListScan').timeBased().atHour(t[0]).nearMinute(t[1]).everyDays(1).create(); });
}

function onWalkSheetEdit(e) {
  var range = e && e.range;
  if (!range) return;
  var sheet = range.getSheet(), name = sheet.getName();
  var kind = name === SHEET_NAME ? 'main' : name === DEPARTED_SHEET_NAME ? 'departed' : name === GROUP_SHEET_NAME ? 'groups' : '';
  if (!kind || !sheet.getLastRow()) return;
  var values = sheet.getDataRange().getValues();
  var header = kind === 'groups' ? null : findHeader(values);
  // 狗清單（#501）：主清單、已出所、常遛狗群改到的單位都記下來送 Worker
  var units = dogListKeysForEdit(kind, values, header, range.getRow() - 1, range.getNumRows(), range.getColumn() - 1, range.getLastColumn() - 1);
  if (units.length) updateDogListPending(function (p) {
    var next = { seq: p ? p.seq : 0, items: p ? p.items : {} };
    units.forEach(function (k) { next.seq++; next.items[k] = { seq: next.seq }; });
    return next;
  });
  if (kind !== 'groups' && header) {
    var rows = values.slice(range.getRow() - 1, range.getRow() - 1 + range.getNumRows());
    var entries = editedRows(rows, header, range.getRow() - 1, range.getColumn() - 1, range.getLastColumn() - 1, kind);
    if (entries.length) {
      updatePending(function (p) { return queueEdits(p, entries); });
      flushWalkEdits();
    }
  }
  if (units.length) flushDogList();
}

// 待通知版本只用短暫的使用者鎖保護；送通知時另拿 script lock（跟網站寫回同一把，讀到的值才不會夾在寫回中間），
// 但不在拿著使用者鎖時等 HTTP。
function updatePending(change) {
  var props = PropertiesService.getScriptProperties(), lock = LockService.getUserLock();
  lock.waitLock(10000);
  try {
    var next = change(JSON.parse(props.getProperty(PENDING_EDITS) || 'null'));
    props.setProperty(PENDING_EDITS, JSON.stringify(next));
    return next;
  } finally { lock.releaseLock(); }
}

function flushWalkEdits() {
  var props = PropertiesService.getScriptProperties();
  for (var round = 0; round < FLUSH_ROUNDS; round++) {
    var pending = JSON.parse(props.getProperty(PENDING_EDITS) || 'null');
    var keys = pending ? Object.keys(pending.items) : [];
    if (!keys.length) return;
    var sent = keys.slice(0, EDIT_BATCH).map(function (k) { return { key: k, seq: pending.items[k].seq }; });
    var results;
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      var sheet = SpreadsheetApp.openById(sheetIdOf(props.getProperty('SHEET_ID'))).getSheetByName(SHEET_NAME);
      if (!sheet) throw new Error('找不到「' + SHEET_NAME + '」分頁');
      var rows = editPayload(readWalkSnapshot(sheet).rows, sent.map(function (s) { return pending.items[s.key]; }));
      results = walkWorker(props, 'rows', { rows: rows }).results || [];
    } catch (err) {
      console.warn('flushWalkEdits: 保留待通知：' + (err && err.message ? err.message : err));
      return;
    } finally { lock.releaseLock(); }
    updatePending(function (p) { return clearSent(p, sent, results); });
    if (results.length < sent.length || results.some(function (r) { return !r || !r.ack; })) return;
  }
}

// rows：受影響的那幾列（第一列是表上第 firstRow 列，從 0 算）；firstCol、lastCol 是改到的欄。
// 改到「遛狗日期」「誰遛的」以外的欄（籠位、編號、犬名……）標 other，Worker 交給狗清單同步。
function editedRows(rows, header, firstRow, firstCol, lastCol, kind) {
  var walkCols = [header.cols.date, header.cols.walker];
  var other = false;
  for (var c = firstCol; c <= lastCol; c++) if (walkCols.indexOf(c) === -1) other = true;
  var out = [];
  rows.forEach(function (row, i) {
    if (firstRow + i <= header.row) return;
    var name = cellText(row[header.cols.name]);
    if (!name) return;
    var id = header.cols.id === undefined ? '' : cellText(row[header.cols.id]);
    out.push({ sheet: kind, dog: { id: id, name: name }, other: other || kind !== 'main' });
  });
  return out;
}

// 同一隻狗只留最後出現的那筆（換籠、離所看狗新出現在哪裡）；每筆帶遞增版本，確認時用來核對。
function dogKey(dog) { return dog.id || '名:' + dog.name; }

function queueEdits(pending, entries) {
  var next = { seq: pending ? pending.seq : 0, items: {} };
  if (pending) Object.keys(pending.items).forEach(function (k) { next.items[k] = pending.items[k]; });
  entries.forEach(function (e) {
    next.seq++;
    next.items[dogKey(e.dog)] = { seq: next.seq, sheet: e.sheet, dog: e.dog, other: e.other };
  });
  return next;
}

// Worker 已接手（ack）且還是送出時的同一版本才清；送出後又改過的新版本留著下次送。
function clearSent(pending, sent, results) {
  if (!pending) return pending;
  sent.forEach(function (s, i) {
    var item = pending.items[s.key];
    if (results[i] && results[i].ack && item && item.seq === s.seq) delete pending.items[s.key];
  });
  return pending;
}

// 主清單的列送當下直接讀到的日期＋名單；主清單找不到唯一一列（已移走、重複）就只送 other，交給狗清單同步。
function editPayload(snapshot, items) {
  var byKey = {};
  snapshot.forEach(function (r) {
    var k = dogKey(r.dog);
    byKey[k] = byKey.hasOwnProperty(k) ? null : r;
  });
  return items.map(function (item) {
    var found = item.sheet === 'main' ? byKey[dogKey(item.dog)] : null;
    return found ? { sheet: 'main', dog: item.dog, other: item.other, current: found.current } : { sheet: item.sheet, dog: item.dog, other: true };
  });
}

// ── 狗清單有人編輯才同步（#501，ADR 0018 第 5–7 點）──
// 取代每 10 分鐘叫 GitHub Actions 讀整張表：編輯觸發只把受影響的「單位」記進 DOG_LIST_PENDING，再送給 Worker（/api/walk-writeback/dog-list）。
// 單位：主清單一隻狗（main:編號，沒編號用 main:名:犬名）、已出所一隻狗（departed:…）、常遛狗群一欄（groups:欄）、主清單下方異動紀錄整段（notes）。
// 每天台灣 09:43、13:53、23:53（dogListScan）送每個單位的指紋，Worker 回不一樣的，再分批只送那幾個；D1 是空的時就等於全部重送。
// 也可以在 Apps Script 編輯器手動執行 dogListScan 補漏或重新灌資料。觸發器由 installWalkEditTriggers 一起建立。
var DOG_LIST_PENDING = 'DOG_LIST_PENDING';
var DOG_LIST_BATCH = 10; // 跟 Worker 的 DOG_LIST_ROWS_MAX 一樣
var DOG_LIST_ROUNDS = 10; // 一次觸發最多送 10 批，其餘留給下次
var DOG_LIST_SCAN_ROUNDS = 60; // 保險掃描一次最多 600 個單位（約 3 分鐘），沒送完下一次掃描接著補
var DEPART_DATE_HEADER = /(出所|離所|認養|領養|死亡)/; // 已出所分頁的出所日期欄

function dogListSheets() {
  var book = SpreadsheetApp.openById(sheetIdOf(PropertiesService.getScriptProperties().getProperty('SHEET_ID')));
  var values = function (name) { var s = book.getSheetByName(name); return s && s.getLastRow() ? s.getDataRange().getValues() : []; };
  return { main: values(SHEET_NAME), departed: values(DEPARTED_SHEET_NAME), groups: values(GROUP_SHEET_NAME) };
}
function dogListHash(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ((b + 256) % 256).toString(16).replace(/^(.)$/, '0$1'); }).join('').slice(0, 16);
}

function flushDogList() {
  var props = PropertiesService.getScriptProperties();
  for (var round = 0; round < DOG_LIST_ROUNDS; round++) {
    var pending = JSON.parse(props.getProperty(DOG_LIST_PENDING) || 'null');
    var keys = pending ? Object.keys(pending.items) : [];
    if (!keys.length) return;
    var sent = keys.slice(0, DOG_LIST_BATCH).map(function (k) { return { key: k, seq: pending.items[k].seq }; });
    var results;
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      var units = dogListUnits(dogListSheets(), ymdOf, dogListHash);
      // 單位已經不在表上（例：狗改了編號、整列刪掉）就沒東西可送，直接清；保險掃描會把 D1 多出來的列出來
      var rows = sent.map(function (s) { return units[s.key]; });
      var live = rows.filter(Boolean);
      var got = live.length ? walkWorker(props, 'dog-list', { rows: live }).results || [] : [];
      var i = 0;
      results = rows.map(function (r) { return r ? got[i++] : { ack: true }; });
    } catch (err) {
      console.warn('flushDogList: 保留待通知：' + (err && err.message ? err.message : err));
      return;
    } finally { lock.releaseLock(); }
    updateDogListPending(function (p) { return clearSent(p, sent, results); });
    if (results.some(function (r) { return !r || !r.ack; })) return;
  }
}

function updateDogListPending(change) {
  var props = PropertiesService.getScriptProperties(), lock = LockService.getUserLock();
  lock.waitLock(10000);
  try {
    var next = change(JSON.parse(props.getProperty(DOG_LIST_PENDING) || 'null'));
    props.setProperty(DOG_LIST_PENDING, JSON.stringify(next));
    return next;
  } finally { lock.releaseLock(); }
}

// 保險掃描：只送指紋，Worker 回要哪些；主清單先送（狗群要用主清單的犬名對）
function dogListScan() {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  var units;
  lock.waitLock(15000);
  try { units = dogListUnits(dogListSheets(), ymdOf, dogListHash); } finally { lock.releaseLock(); }
  var fingerprints = {};
  Object.keys(units).forEach(function (k) { fingerprints[k] = units[k].hash; });
  var out = walkWorker(props, 'dog-list-scan', { fingerprints: fingerprints });
  if (out.extra && out.extra.length) console.warn('dogListScan: D1 有、試算表沒有（只列出來，不自動刪）：' + out.extra.join('、'));
  var want = orderDogListKeys(out.want || []);
  for (var round = 0; round < DOG_LIST_SCAN_ROUNDS && want.length; round++) {
    var batch = want.splice(0, DOG_LIST_BATCH).map(function (k) { return units[k]; }).filter(Boolean);
    var results = walkWorker(props, 'dog-list', { rows: batch }).results || [];
    if (results.some(function (r) { return !r || !r.ack; })) { console.warn('dogListScan: Worker 沒接手，下次掃描再補'); return; }
  }
}

// ── 下面不碰 Google 的東西，Node 測試也跑得到（worker/test/sheet-write.test.mjs）──

function orderDogListKeys(keys) {
  var rank = function (k) { return ['main', 'departed', 'groups', 'notes'].indexOf(k.split(':')[0]); };
  return keys.slice().sort(function (a, b) { return rank(a) - rank(b); });
}
// 保險掃描：一隻狗的指紋 = hash(JSON [日期, 名單])，要跟 worker/src/walk-reconcile.js 的 walkFingerprint 完全一樣。
// 只回 D1 有記、指紋不同的狗；同一隻在表上出現兩次時都不回（Worker 本來就不比對重複的狗）。
function walkScanRows(rows, fingerprints, hash) {
  var count = {};
  rows.forEach(function (r) { var k = dogKey(r.dog); count[k] = (count[k] || 0) + 1; });
  return rows.filter(function (r) {
    var k = dogKey(r.dog);
    return count[k] === 1 && Object.prototype.hasOwnProperty.call(fingerprints, k) && fingerprints[k] !== hash(JSON.stringify([r.current.date, r.current.walker]));
  });
}
function dogUnitKey(kind, id, name) { return kind + ':' + (id || '名:' + name); }

// 表上的值 → { 單位: 要送給 Worker 的列（含 hash） }。sheets：{ main, departed, groups } 各分頁 getValues()
function dogListUnits(sheets, ymd, hash) {
  var units = {};
  var add = function (key, row) { row.hash = hash(JSON.stringify(row)); units[key] = row; };
  var dateText = function (v) {
    if (isDate(v)) return ymd(v);
    var t = cellText(v).replace(/\//g, '-').replace(/-(\d)(?=-|$)/g, '-0$1');
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
  };
  var r;
  var main = sheets.main || [], header = findHeader(main);
  if (header) {
    var c = header.cols, end = main.length;
    for (r = header.row + 1; r < main.length; r++) if (c.cage !== undefined && /^備註/.test(cellText(main[r][c.cage]))) { end = r; break; }
    for (r = header.row + 1; r < end; r++) {
      var row = main[r], name = cellText(row[c.name]), cage = c.cage === undefined ? '' : cellText(row[c.cage]);
      if (!name || !cage) continue;
      var id = c.id === undefined ? '' : cellText(row[c.id]);
      add(dogUnitKey('main', id, name), { sheet: 'main', dog: { id: id, name: name }, cage: cage,
        note: c.note === undefined ? '' : cellText(row[c.note]), date: c.date === undefined ? '' : dateText(row[c.date]),
        walker: c.walker === undefined ? '' : cellText(row[c.walker]) });
    }
    if (end < main.length && c.id !== undefined) {
      var items = [];
      for (r = end; r < Math.min(main.length, end + 400); r++) {
        var text = cellText(main[r][c.id]);
        if (text) items.push({ label: cellText(main[r][c.cage]), text: text });
      }
      add('notes', { sheet: 'notes', items: items });
    }
  }
  var departed = sheets.departed || [], dh = findHeader(departed);
  if (dh) {
    var labels = departed[dh.row].map(function (v) { return cellText(v).replace(/\s+/g, ''); });
    var dateCols = [];
    labels.forEach(function (h, i) { if (DEPART_DATE_HEADER.test(h) && !/遛|溜/.test(h)) dateCols.push(i); });
    for (r = dh.row + 1; r < departed.length; r++) {
      var drow = departed[r], dname = cellText(drow[dh.cols.name]), did = dh.cols.id === undefined ? '' : cellText(drow[dh.cols.id]);
      if (!dname && !did) continue;
      // 主清單上還有的狗（以前出所又回來，已出所留著舊的一列）以主清單為準，不送（2026-10-24 栗子、MINI 被誤記離所）
      if (units[dogUnitKey('main', did, dname)]) continue;
      add(dogUnitKey('departed', did, dname), { sheet: 'departed', dog: { id: did, name: dname },
        texts: drow.map(function (v) { return isDate(v) ? ymd(v).replace(/-/g, '/') : cellText(v); }).filter(Boolean),
        dates: dateCols.map(function (i) { return dateText(drow[i]); }).filter(Boolean) });
    }
  }
  var groups = sheets.groups || [], layout = groups.length ? groupLayout(groups) : null;
  if (layout) {
    for (var col = 0; col < layout.width; col++) {
      var names = [];
      for (r = layout.first; r < layout.labelRow; r++) {
        var n = cellText(groups[r][col]);
        if (n && !/^\d+$/.test(n) && names.indexOf(n) === -1) names.push(n);
      }
      add('groups:' + col, { sheet: 'groups', column: col, names: names, label: cellText(groups[layout.labelRow][col]) });
    }
  }
  return units;
}

// 編輯到哪些單位：values 是整個分頁、firstRow～firstRow+count-1 是改到的列（從 0 算）、firstCol～lastCol 是改到的欄
function dogListKeysForEdit(kind, values, header, firstRow, count, firstCol, lastCol) {
  var keys = [];
  if (kind === 'groups') {
    for (var col = firstCol; col <= lastCol; col++) keys.push('groups:' + col);
    return keys;
  }
  if (!header) return keys;
  var c = header.cols, notesFrom = -1;
  if (kind === 'main' && c.cage !== undefined) {
    for (var r = header.row + 1; r < values.length; r++) if (/^備註/.test(cellText(values[r][c.cage]))) { notesFrom = r; break; }
  }
  for (var at = Math.max(firstRow, header.row + 1); at < firstRow + count && at < values.length; at++) {
    if (notesFrom !== -1 && at >= notesFrom) { if (keys.indexOf('notes') === -1) keys.push('notes'); continue; }
    var row = values[at] || [], name = cellText(row[c.name]), id = c.id === undefined ? '' : cellText(row[c.id]);
    if (name || id) keys.push(dogUnitKey(kind, id, name));
  }
  return keys;
}
