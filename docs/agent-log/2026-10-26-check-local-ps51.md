# 2026-10-26 check-local.ps1 在 Windows PowerShell 5.1 拿得到失敗原因

- Agent：Claude Code（由前端結構整理 #602／#607–#609 的工作階段分派）
- 依據：整理前端時發現 5.1 下測試一失敗就看不到原因，只能暫改 `run-browser-tests.cjs` 把錯誤印到 stdout；#568 紀錄的 `local-check.test.mjs` 5.1 中文亂碼。

## 做了什麼

- `scripts/check-local.ps1`
  - `Invoke-Check` 不再用 `*> $log`：5.1 在 `$ErrorActionPreference = 'Stop'` 下會把 node 的第一行 stderr 當終止錯誤（只看到 `NativeCommandError`、log 只剩一行、exitCode 留在預設 1），而且 `*>` 寫成 UTF-16。改成函式內 `Continue`，`2>&1` 逐行以無 BOM UTF-8 寫入 log；stderr 行取 `ErrorRecord.TargetObject` 原文，避免空行變成 `System.Management.Automation.RemoteException`。讀 log 尾端加 `-Encoding UTF8`。
  - 執行期間把 `[Console]::OutputEncoding` 改 UTF-8（node 輸出解碼與本腳本 stdout 都用 UTF-8），結束還原；沒有主控台時設定失敗就略過。
  - 檔案加 UTF-8 BOM：5.1 讀沒有 BOM 的 .ps1 會用系統字碼頁，`exit=…；完整輸出：…` 的中文字面值因此亂碼。pwsh 讀 BOM 不受影響。
- `scripts/local-check.test.mjs`：新增 5.1 測試，錯字路徑要看到 `node exit=1` 與「未知測試」，失敗測試的 log 要有 stderr／stdout 中文、空行、`Error: fixture failure` 堆疊，紀錄 exitCode=1、不含 `NativeCommandError`／`RemoteException`。

## 驗證

- 修正前：5.1 跑 `-NodeTest scripts/local-check.test.mjs` 失敗於第 36 行那項（stdout 亂碼且在「執行紀錄」後中斷），log 為 UTF-16。
- 修正後：5.1 跑同一檔 6／6 通過。
- 暫改 `tests/es-modules.cjs` 讓斷言失敗（未提交），5.1 跑 `-Suite es-modules`：log 為 UTF-8，有完整 AssertionError、中文 diff 與堆疊，紀錄 JSON `exitCode: 1`。
- 本機沒有 pwsh，Linux pwsh 行為由 CI 確認。
- K 同意合併後併入 main（#602、#607–#609），5.1 跑 `-Full`：第一次 `walk-order-undo` 的「約 8 秒收起」失敗，單獨重跑通過；第二次 `-Full` 全過。判定為偶發計時問題，與本 PR 無關，未處理。
- 轉正式後 CI（Linux pwsh 7）失敗：pwsh 7 的 stderr ErrorRecord 沒把原文放在 `TargetObject`，錯誤行寫成空白，第 36 行那項看不到「未知測試」。改成 `TargetObject` 是字串才用，否則用 `Exception.Message`。另外推送與轉正式同時觸發，草稿那次被略過的 run 取消了正式那次，已手動重跑。

## 未完成／例外

- `scripts/wait-pr-checks.ps1` 也沒有 BOM，5.1 下中文摘要亂碼，且 check 失敗時退出碼仍是 0；未在本 PR 處理。
