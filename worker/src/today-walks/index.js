// 今日溜狗紀錄（GLOSSARY；ADR 0018）：網站登記先存 D1，再寫回試算表兩欄；人工改表由 GAS 送來比對。
// 這裡是 module 唯一入口，外面只 import 這個檔（worker/test/standards.test.mjs 會擋 import 內部檔）。
// 寫新版本只有一個轉換（version.js）；保險掃描跟改表通知同一套規則收下人工修改（observe.js）；寫入預算依要寫的表自動算（budget.js）。
//
// 建立：todayWalks(env, { sheet, now })。sheet 是叫 Apps Script 小程式的函式（預設 sheet-write.js 的 callSheet），
// now 是時鐘（預設 Date.now；排程傳排程時間）。每個入口只收領域資料。
import { callSheet } from '../sheet-write.js';
import { one, taiwanDay } from './shared.js';
import { acceptWalk } from './accept.js';
import { observeAll, listWalkLog } from './observe.js';
import { confirmWalk } from './receipt.js';
import { dispatchWalks, dueWalks, writebackTarget, STOPPED_AT } from './dispatch.js';
import { scanWalks } from './scan.js';
import { readAcceptedWalks, readWalkers, readStoppedWalks, withTodayWalks } from './read.js';

export { withTodayWalks, listWalkLog };

// 保險掃描與寫回重試：功能沒開、預覽版、沒接 D1 都不跑（回 false，排程紀錄就不記，見 cron-status.js）
const background = env => env.WALK_RETRY_ENABLED === 'true' && !env.PREVIEW && !!env.DB;

export function todayWalks(env, { sheet = callSheet, now = Date.now } = {}) {
  const db = env?.DB;
  return {
    // 溜了／修改／復原（input：requestId、operationDate、action、walker、editor、dogs[1]）→ 接受結果；不接受丟 WalkError（status、current）
    accept: input => acceptWalk(db, env, now(), input),
    // 試算表觀測值（[{ dog, current, version? }]），source：'edit' 改表通知、'scan' 保險掃描 → 每隻一筆結果
    observe: (items, { source = 'edit' } = {}) => observeAll(db, env, now(), items, { source }),
    // GAS 在 script lock 內讀到的表上值 → 這次要寫的目標（或 skip）
    target: input => writebackTarget(db, env, now(), input),
    // GAS 寫完讀回 → { confirmed }
    receipt: receipt => confirmWalk(db, env, now(), receipt),
    // 派送指定的狗（網站接受後的背景寫回）
    dispatch: dogs => dispatchWalks(db, env, sheet, now(), dogs.map(dog => ({ dog, recovery: null }))),
    // 派送到期與中斷的狗（寫回重試排程，每輪最多 10 隻）
    async dispatchDue() {
      if (!background(env)) return false;
      const at = now();
      await dispatchWalks(db, env, sheet, at, await dueWalks(db, at));
    },
    // 保險掃描一輪 → { changed, deferred }
    async scan() {
      if (!background(env)) return false;
      return scanWalks(db, env, sheet, now());
    },
    // 志工接受過的請求結果（網頁沒收到回應時用同一個 requestId 來問）；沒有回 null
    async result(requestId) {
      const found = await one(db, 'SELECT result_json FROM v3_walk_requests WHERE request_id=?', requestId);
      return found ? JSON.parse(found.result_json) : null;
    },
    today: () => readAcceptedWalks(db, taiwanDay(now())),
    walkers: () => readWalkers(db),
    stopped: () => readStoppedWalks(db, STOPPED_AT),
  };
}
