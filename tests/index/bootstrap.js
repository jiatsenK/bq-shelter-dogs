// 讀進 index.html（結構檢查用）與 js/app.js 後執行程式，函式就能在這頁直接呼叫
Promise.all(['../public/index.html', '../public/js/app.js', '../public/manifest.webmanifest', 'fixtures/dogs.json', '../public/js/analysis.js', '../public/js/find.js', '../public/js/site-config.js', '../public/js/detail-viewport.js', '../public/js/group-stage.js', '../public/js/walk-registration.js', '../public/js/activities.js', '../public/js/dates.js', '../public/js/api.js', '../public/js/store.js', '../public/js/walk-flow.js', '../public/js/detail-editor.js', '../public/js/tour.js', '../public/js/photo.js', '../public/js/walk-ui.js', '../public/js/welcome.js', '../public/js/favorites.js'].map(u => fetch(u).then(res => {
  if (!res.ok) throw new Error(`讀不到 ${u}（HTTP ${res.status}）`);
  return res.text();
})))
  .then(async ([html, js, manifest, dogsJson, analysisJs, findJs, siteJs, detailViewportJs, groupStageJs, walkRegistrationJs, activitiesJs, datesJs, apiJs, storeJs, walkFlowJs, detailEditorJs, tourJs, photoJs, walkUiJs, welcomeJs, favoritesJs]) => {
    await import('../fixtures/module-globals.js');
    bindApp(); bindAnalysis(); bindGroups(); bindFind(); bindActivities();
    API_JS = apiJs; SITE_JS = siteJs; ANALYSIS_JS = analysisJs; FIND_JS = findJs;
    INDEX_HTML = html; MANIFEST = JSON.parse(manifest); APP_JS = js;
    TOUR_JS = tourJs; PHOTO_JS = photoJs; WALK_UI_JS = walkUiJs;
    WELCOME_JS = welcomeJs; FAVORITES_JS = favoritesJs; DOGS_JSON = JSON.parse(dogsJson);
    phoneStore = fakeStorage(); // 其他測試也不碰真正的 localStorage
    loadState = 'ready'; // 測試頁不跑 init，直接當資料已讀好，各測試自己放假資料
    restState = 'ready'; todayState = 'ready'; // 初次狀態讀取另由 startup-stability.cjs 走真實頁面驗證
    // 介面評估第四輪：沒設名字按溜了會先問名字。測試頁預設當作試算表寫入沒開（溜了只記手機），測寫試算表的各自設 'unknown'
    sheetWriteState = 'off';
    return runTests();
  })
  .then(runSerialTests)
  .then(runD1PickTests)
  .then(runPhotoTests)
  .then(runAnalysisTests)
  .then(runHistoryTests)
  .then(runMyWalksTests)
  .then(runCropTests)
  .then(runRestTests)
  .then(runWarnLayoutTests)
  .then(runMonthWalkTests)
  .then(runV52Tests)
  .then(runThumbTests)
  .then(runDetailWiringTests)
  .then(runFirstScreenTests)
  .then(runFindTests)
  .then(runCageMateTests)
  .then(runSyncButtonTests)
  .then(runTermTests)
  .then(runWhereTests)
  .then(runFindV7Tests)
  .then(runV7PagesTests)
  .then(runFastOpenTests)
  .then(runCloudflareTests)
  .then(runPreviewTests)
  .then(runPhotoVersionTests)
  .then(runOldUrlTests)
  .then(runWalkSortTests)
  .then(runSheetWriteTests)
  .then(runV9Tests)
  .then(runR2Tests)
  .then(runWalkerChipTests)
  .then(runPhotoBarTests)
  .then(runFindListTests)
  .then(runFavTests)
  .then(runWalkFavTests)
  .then(runFavSyncTests)
  .then(runFix141Tests)
  .then(runSquarePhotoTests)
  .then(runDepartureTests)
  .then(runCritique3Tests)
  .then(runRangeTests)
  .then(runFindOverviewTests)
  .then(runHeaderTuckTests)
  .then(runCardsTests)
  .then(runDeskTests) // 最後跑：載入 js/desk.js 後寬螢幕的溜狗表會換成電腦版
  .then(runTourLayoutTests)
  .then(show)
  .catch(e => {
    document.getElementById('summary').textContent = `測試頁載入失敗：${e.message}（請用網址開啟，不要直接雙擊檔案）`;
    document.getElementById('summary').className = 'fail';
  });
