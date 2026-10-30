# 2026-10-30 Apps Script fixture 補上改表操作（#769）

- Agent：Claude Code（Opus 5.5），分支 `claude/issue-769-fb3846`
- 依據：#769（母票 #768 新狗與暫住的身分辨認的測試準備；#771 等本票合併後接著做）
- 相關 PR：（開 PR 後補）

## 做了什麼

- `worker/test/apps-script.mjs` 補管理者改表的操作，說明寫在檔頭：
  - `CAGE_HEADER`：主清單帶籠位、備註欄的表頭，人工改表才會送狗清單同步（`/dog-list`）。預設表頭不變，現有測試不受影響。
  - 哪一列可以用狗的 key 或表上的列號（清空犬名後、表下面的新列用列號）；改哪幾格用 `{ cage, id, name, date, walker, note }`。
  - `gas.edit` 能改任何欄（一次改好幾格只跑一次編輯觸發，範圍是改到的欄；只改遛狗日期、誰遛的時範圍跟以前一樣）、`gas.paste` 一次改好幾列、`gas.clear` 清空整列、`gas.remove` 刪整列、`gas.timer` 跑 10 分鐘補送、`gas.scan` 跑保險掃描。
  - `gas.during(when, target, cells)`：在某次執行的「第 n 次讀主清單後」或「拿到某個 Worker 回應後」插入一次人工改表（改格子、換表上變動記號），那次執行結束後跑這次改表的編輯觸發；`gas.idle()` 等它跑完。重跑時每次都在同一個時間點再改，讀到的內容才一致。
- 新增 `worker/test/manage-fixture.mjs`：測試自己簽 Access 登入憑證呼叫管理網站 API（`manageApi(t, env)`），#768 的管理 API 斷言用。
- 新增 `worker/test/apps-script-edits.test.mjs`：帶籠位改犬名、多格貼上（一列犬名加編號、一次兩列）、先清空再打字、刪列與清空最後一列、補送、保險掃描讀表後有人改表，只看 `/api/dogs` 與 `/api/manage/data-checks`。斷言的是目前行為（列消失不處理），#768 改行為時跟著改。
- `docs/ARCHITECTURE.md`：fixture 行號往後移、檔案說明補上狗清單同步與改表操作。正式程式的方塊與線沒變，核對日與依據 commit 不動。

## 例外與要注意的

- 正式程式沒改：`apps-script/sheet-write.gs`、`worker/src` 都沒動，不用重新部署。
- 讀表次數原本只在設了 `onRead` 時才算（`gas.onRead?.(…, ++attempt.reads)` 沒設時整個略過），`during` 的 `afterRead` 要用，改成一律計數；有設 `onRead` 的測試讀到的次數不變。
- `during` 只給下一次執行，那次沒跑到 when 就讓那次執行失敗，不留到之後；插入的編輯觸發失敗時 `gas.idle()` 會丟出錯誤。
- 示範測試裡少數幾個「只跑一次執行」「沒有執行」用 `gas.posts` 補充斷言（API 看不出執行次數），結果仍以 API 為準。
- fixture 原本斷言「呼叫 Worker 要拿著 script lock」，但 `dogListScan` 送指紋（`dog-list-scan`）是放開鎖之後才送，所以這個 action 先不檢查；#768 要改成鎖內核對記號再送，改完可以拿掉這個例外。
- 刪整列：Google 刪列只跑「變更時」觸發（changeType `REMOVE_ROW`），不跑「編輯時」觸發，小程式只裝編輯觸發，所以 `gas.remove` 不跑任何執行。選整列按 Delete 是清空內容，會跑編輯觸發（`gas.clear`），但那列沒有犬名、編號，算不出單位，什麼都不送。#768 寫的「刪掉最後一列」要送清單，指的應該是後者；真的刪整列要等下一次有人編輯、補送或保險掃描才會發現。
