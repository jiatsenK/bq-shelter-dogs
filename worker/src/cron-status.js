// 排程有沒有在跑（稽核第 5 項）：寫回重試、保險掃描、照片垃圾桶、修改紀錄清理每次跑完，記在 v3_sync_state 的 cron_<工作> 一列 JSON，
// 管理網站「資料檢查」讀出來顯示（worker/src/admin/checks.js 的 readCronStatus）。
// 跑完記 okAt；出錯記 failAt 和訊息，不蓋掉上次的 okAt。工作回傳 false 表示功能沒開、沒跑，不記。
// 記不進去只警告，不影響工作本身。寫回重試每 10 分鐘寫這一列，一天約 144 列寫入。
export const CRON_JOBS = ['retry', 'scan', 'trash', 'editlog'];
export const cronKey = job => `cron_${job}`;

export async function recordRun(env, job, now, work) {
  const at = new Date(now).toISOString();
  let patch;
  try {
    if (await work() === false) return;
    patch = { okAt: at };
  } catch (error) {
    console.warn(`cron ${job}:`, error && error.message);
    patch = { failAt: at, error: String((error && error.message) || error).slice(0, 200) };
  }
  if (!env || !env.DB) return;
  try {
    await env.DB.prepare(`INSERT INTO v3_sync_state(key,value) VALUES(?1,?2)
      ON CONFLICT(key) DO UPDATE SET value=json_patch(CASE WHEN json_valid(value) THEN value ELSE '{}' END,?2)`)
      .bind(cronKey(job), JSON.stringify(patch)).run();
  } catch (error) { console.warn(`${cronKey(job)}:`, error.message); }
}
