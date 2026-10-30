# 2026-10-30 試算表列消失先當候選，確認後移出主清單（#771）

- Agent：Claude Code（Opus 5.5），分支 `claude/issue-771-a2de35`
- 依據：#771（母票 #768 的第一張實作票），阻擋 #769（PR #777，fixture）、#770（PR #776）已合併；#769 的交接筆記在共用筆記資料夾 `issue-769-fixture.md`

## 做了什麼

- `migrations/0020_sheet_main_missing.sql`、`db/compact-schema.sql`：`v3_sheet_main` 加 `missing_at`（候選第一次不見的時間）。資料包觸發器是 `UPDATE OF` 指定欄，改這欄不會讓資料包重算。
- `worker/src/dog-list.js`：`reconcileMissing` 標候選、取消、確認（隔 `MISSING_CONFIRM_MS` 10 分鐘），一次最多 `MISSING_MAX` 10 個、同一個 batch；清單沒有主清單 key 或少了一半以上的狗不處理。`/dog-list` 改走 `syncDogList(db, rows, mainKeys, env)` 回 `{ results, candidates }`，`applyDogListRows` 留著給既有呼叫；`scanDogList` 用指紋表的 `main:` key 做同一件事，回 `candidates`。
- `worker/src/index.js`：`/dog-list` 收 `mainKeys`（選填，舊版小程式沒送就不找消失）。
- `apps-script/sheet-write.gs`：送狗清單都附 `mainKeys`；改到主清單算不出單位時排假單位 `list`；待送單位都不在表上也照樣呼叫 Worker；`DOG_LIST_CANDIDATES` 記 Worker 的「還有候選」，補送沒有待送也送一次清單（同一次執行只送一次）；保險掃描在 script lock 內核對記號後才送指紋。
- 測試：新增 `worker/test/sheet-missing.test.mjs`（刪列確認、先清空再打回、只過一次清單不確認、清空最後一列、保險掃描讀表後新增、少一半不處理、單次上限與 D1 句數、上線時暖暖殘留）。fixture 拿掉保險掃描送指紋不檢查 script lock 的例外。三個既有測試照新行為改：`admin-stage4`（隔 4 小時的第二次掃描會確認候選，改成隔 5 分鐘）、`sheet-edit-stale` #701（多一次讀記號）、`standards` 的整張讀例外（SELECT 多一欄）、`apps-script-edits` 的刪列示範。
- 文件：ADR 0025（含 #768 後面的票要用的同籠規則、暫住判斷），ADR 0018 開頭加修訂註記，兩份研究文件從 worktree `frontend-issue-discussion-eb42e1` 複製進來，ARCHITECTURE_NOW、ARCHITECTURE.md「試算表改動回到 D1」、dog-editing.md、GLOSSARY「候選」。

## 例外與要注意的

- 確認時間用「第一次不見後至少 10 分鐘」，不用 GAS 執行代號：fixture 重跑時要送出一樣的內容，亂數代號做不到；GAS 一次執行最多 6 分鐘，時間已經能分辨不同執行。
- 測試要讓時間往前走，用 `t.mock.timers`（只影響 Worker，小程式在自己的 vm 裡）。管理網站把 Access 公鑰快取 5 分鐘（模組層級），所以每個測試的起點差一小時。
- 確認之後才把狗貼到已出所不會記離所、確認時還有沒寫回的溜狗工作會寫回失敗後停住，寫在 ADR 0025「已知限制」。
- 擁有者要做：重新部署 Apps Script、套用 D1 migration（`0020`）、部署志工 Worker；管理網站讀的欄沒變，不用另外部署。

## 審查與測試

（開 PR 前補）

## 相關 PR

（開 PR 後補）
