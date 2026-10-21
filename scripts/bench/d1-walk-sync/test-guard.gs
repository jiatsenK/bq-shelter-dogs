// Only used by build-gas.mjs. Do not add this to the production Apps Script.
function prototypeBookId() {
  var props = PropertiesService.getScriptProperties();
  var id = sheetIdOf(props.getProperty('SHEET_ID'));
  if (!id || id !== props.getProperty('PROTOTYPE_SHEET_ID') || !props.getProperty('WRITE_KEY')) {
    throw new Error('TEST ONLY: SHEET_ID must equal PROTOTYPE_SHEET_ID; WRITE_KEY required');
  }
  if (SpreadsheetApp.openById(id).getName().indexOf('BENCH441') !== 0) {
    throw new Error('TEST ONLY: spreadsheet title must start with BENCH441');
  }
  return id;
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true, prototype: 'd1-walk-sync-441', sheetId: prototypeBookId()
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleRequest(req) {
  var id = prototypeBookId();
  if (!req || req.testSheetId !== id || req.action !== 'walk' ||
      !/^BENCH441_[A-Za-z0-9_]+$/.test(req.walker || '') ||
      !req.dogs || req.dogs.length !== 1 || !req.dogs[0].id) {
    return { ok: false, error: 'TEST ONLY: one numbered dog and BENCH441 marker required' };
  }
  return unusedOriginal_handleRequest(req);
}

// Same trigger entry point as production; record events without notifying production.
function notifyWorker(e) {
  var id = prototypeBookId();
  if (!e || !e.source || e.source.getId() !== id) throw new Error('Wrong trigger source');
  console.log(JSON.stringify({
    prototype: 'd1-walk-sync-441', receivedAt: new Date().toISOString(),
    changeType: e.changeType || null, triggerUid: e.triggerUid || null
  }));
}
