// 異常通知（#809）：每天三次保險掃描時檢查狗清單同步有沒有出問題，有新問題就推 Telegram，不用人打開管理網站才知道。
// - 同一個問題只通知一次：通知過的記在 v3_sync_state 的 alert_seen；問題解決後從清單拿掉，再發生會再通知。
// - 真的有兩隻同名的狗也只通知一次，不用處理。
// - 沒設 TELEGRAM_BOT_TOKEN、TELEGRAM_CHAT_ID 就不跑（回 false，排程紀錄不記，見 cron-status.js）；送不出去就丟錯，這次不記通知過，下次掃描再送。
import { readCronStatus } from './admin/checks.js';
import { pendingDog, shownNumber } from './dog-standing.js';
import { readPairs } from './dog-pairs.js';
import { todayWalks } from './today-walks/index.js';

const SEEN_KEY = 'alert_seen';
// 狗清單同步失敗（dog-list.js 記）：連續這麼多次才通知，一兩次 GAS 會自己補送
export const SYNC_FAIL_KEY = 'dog_list_fail';
const SYNC_FAIL_MIN = 3;
// Telegram 一則最多 4096 字
const MESSAGE_MAX = 3800;
const CRON_NAMES = { retry: '寫回重試', scan: '保險掃描', trash: '照片垃圾桶', editlog: '修改紀錄清理' };

const withNumber = (name, number) => (number ? `${name}（${number}）` : name);
const parse = (text, fallback) => { try { return JSON.parse(text) ?? fallback; } catch { return fallback; } };
const state = async (db, key) => (await db.prepare('SELECT value FROM v3_sync_state WHERE key=?').bind(key).first('value')) || '';

// 現在有哪些問題：[{ key, text }]。key 固定，內容沒變就是同一個問題
export async function readIssues(env, now) {
  const db = env.DB;
  const [sameName, twoRows, pending, pairs, stopped, cron, syncFail] = await Promise.all([
    db.prepare('SELECT name,COUNT(*) AS n FROM v3_sheet_main GROUP BY name HAVING n>1 ORDER BY name').all(),
    db.prepare('SELECT dog_id,MIN(name) AS name,COUNT(*) AS n FROM v3_sheet_main GROUP BY dog_id HAVING n>1 ORDER BY dog_id').all(),
    db.prepare(`SELECT d.dog_id,d.name,${shownNumber('d.dog_id')} AS number FROM v3_dogs d WHERE ${pendingDog('d.dog_id')} ORDER BY d.dog_id`).all(),
    readPairs(db),
    todayWalks(env).stopped(),
    readCronStatus(db, now),
    state(db, SYNC_FAIL_KEY),
  ]);
  const fail = parse(syncFail, null);
  return [
    ...(fail?.count >= SYNC_FAIL_MIN ? [{ key: 'sync-fail', text: `狗清單同步連續失敗 ${fail.count} 次：${fail.error}` }] : []),
    ...sameName.results.map(r => ({ key: `same-name:${r.name}`, text: `主清單有 ${r.n} 隻同名：${r.name}，可能多建了一隻` })),
    ...twoRows.results.map(r => ({ key: `two-rows:${r.dog_id}`, text: `同一隻狗在主清單有 ${r.n} 列：${r.name}` })),
    ...pending.results.map(r => ({ key: `pending:${r.dog_id}`, text: `待核對：${withNumber(r.name, r.number)}` })),
    ...pairs.pairs.map(p => ({ key: `pair:${p.goneDogId}:${p.dogId}`, text: `可能是同一隻：${p.goneName}、${withNumber(p.name, p.number)}（${p.cage}）` })),
    ...stopped.map(w => ({ key: `stopped:${w.dogId || w.name}:${w.date}`, text: `寫回試算表停止重試：${withNumber(w.name, w.number)} ${w.date}` })),
    // 排程從沒跑過多半是功能沒開，不算問題；這個工作自己壞了也通知不出來，不檢查自己
    ...cron.filter(j => j.state !== 'never' && j.job !== 'alert' && (j.stale || (j.failAt && (!j.okAt || j.failAt > j.okAt))))
      .map(j => ({ key: `cron:${j.job}`, text: `排程有問題：${CRON_NAMES[j.job] || j.job}${j.error ? `（${j.error}）` : ''}` })),
  ];
}

export function alertMessage(issues) {
  const lines = ['溜狗表有新狀況，到管理網站資料頁處理：'];
  let shown = 0;
  for (const { text } of issues) {
    if (lines.join('\n').length + text.length > MESSAGE_MAX) break;
    lines.push(`・${text}`);
    shown++;
  }
  if (shown < issues.length) lines.push(`還有 ${issues.length - shown} 項沒列出`);
  return lines.join('\n');
}

async function sendTelegram(env, text) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  });
  // 錯誤訊息只留狀態碼：網址帶 token，不寫進排程紀錄
  if (!res.ok) throw new Error(`Telegram 回 ${res.status}`);
}

export async function runAlerts(env, now = Date.now()) {
  if (!env?.DB || env.PREVIEW || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const db = env.DB;
  const issues = await readIssues(env, now);
  const before = await state(db, SEEN_KEY);
  const seen = new Set(parse(before, []));
  const fresh = issues.filter(i => !seen.has(i.key));
  if (fresh.length) await sendTelegram(env, alertMessage(fresh));
  const after = JSON.stringify(issues.map(i => i.key).sort());
  if (after !== (before || '[]')) await db.prepare('INSERT INTO v3_sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(SEEN_KEY, after).run();
  return true;
}
