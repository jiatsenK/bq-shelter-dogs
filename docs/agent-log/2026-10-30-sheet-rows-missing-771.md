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

- 第一次完整測試抓到兩件：`adr-index.test` 寫死 0018 是現行（改成被 0025 修訂）；主清單沒有籠位欄時小程式送空清單，Worker 多讀整張主清單（`walk-reconcile` 讀取量測試）。改成沒有列、也沒有主清單 key 就不呼叫 Worker。
- code-review 技能兩軸審查（基準 `8794e3f`）：
  - Standards：確認時 DELETE 條件沒對上（別的請求改過那列）也被當成確認、更新了資料更新時間，改成看 batch 的 `meta.changes`；`rowKey`、資料更新時間的寫法收成一個。沒改：`'back'／'confirm'／'mark'` 用字串當動作、`applyDogListRows` 只是包一層（既有測試還在用）。
  - Spec：查詢數測試改成最重的組合（一批 10 列加 10 個以上消失）；被當成讀錯表時不再回「還有候選」，免得 GAS 每 10 分鐘一直重送；ADR 補「只清掉籠位也算消失」。沒改：「刪掉最後一列」測的是清空內容（Google 刪整列不跑編輯觸發，ADR 第 4 點已寫）；保險掃描讀表後新增那個測試只能驗「指紋沒送出」，fixture 排不出編輯觸發插在讀表和送指紋之間（送指紋已移進 script lock）；「同一次執行不互相確認」靠 GAS 一次執行最多 6 分鐘，測試只驗到不到 10 分鐘不確認。

## 相關 PR

- https://github.com/jiatsenK/bq-shelter-dogs/pull/779
