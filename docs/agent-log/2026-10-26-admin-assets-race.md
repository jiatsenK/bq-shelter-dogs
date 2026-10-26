# 2026-10-26 管理網站共用檔建置的平行競爭

- Agent：Claude Code（#597 工作階段分出的子工作階段）
- 依據：#597 的 PR #628 CI（run 40285702493）偶發 `SyntaxError: ... '../shared/dates.js' does not provide an export named 'BQDates'`；Windows 本機出現 `EBUSY` 開 `admin/public/shared/edit-values.js`。跟 #597 的修改無關。

## 原因

`scripts/admin-table.test.mjs` 與 `scripts/admin-stage4.test.mjs` 都在最上層 `await buildAdminAssets()`。`node --test` 平行跑兩個行程，同時 `copyFile` 到 `admin/public/shared/`，一邊 import 到另一邊複製到一半的檔案。本機重現：刪掉資料夾後平行跑兩支測試 15 次，失敗 2 次。

## 做了什麼

- `scripts/build-admin-assets.mjs`：每個檔案先比對內容，相同就不重寫；不同時先寫 `<檔名>.<pid>.<時間>.tmp` 再 rename 成正式檔，Windows 目的檔被占用的 `EPERM`／`EBUSY`／`EACCES` 短暫重試，最後失敗會刪暫存檔再丟錯。複製的檔案清單、`run-browser-tests.cjs` 與管理網站部署的呼叫方式不變。

## 驗證

- 平行跑兩支測試 30 次（一半先刪資料夾、一半先把目標改成舊內容），0 失敗，資料夾沒有殘留暫存檔。
- `check-local.ps1 -Full` 通過（Node＋網頁 256 項）。本機沒有 pwsh，`local-check.test.mjs` 以 `BQ_CHECK_PWSH` 指到 Windows PowerShell 5.1 執行；不設時那支測試的 4 項會因找不到 pwsh 失敗，與本修改無關。

## 未完成／例外

- 無。PR：見本分支的草稿 PR。
