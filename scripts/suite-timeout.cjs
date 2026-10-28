// 網頁測試每個套件的時限（#713）：Playwright 的 evaluate、滑鼠、關閉 context 沒有預設逾時，
// 頁面卡住時套件會一直等到 CI job 被取消；改成在時限內失敗並寫出是哪個套件卡住
function withSuiteTimeout(name, ms, run) {
  let timer;
  const timeout = new Promise((_, reject) => {
    // 不 unref：卡住的套件可能沒有其他東西撐住事件迴圈，計時器要能讓程序等到時限再失敗；跑完就 clearTimeout
    timer = setTimeout(() => reject(new Error(`網頁測試套件 ${name} 超過 ${ms / 1000} 秒沒跑完，視為卡住（#713）`)), ms);
  });
  return Promise.race([Promise.resolve().then(run), timeout]).finally(() => clearTimeout(timer));
}

module.exports = { withSuiteTimeout };
