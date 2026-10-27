# 2026-10-28 Windows 本機 local-check.test.mjs 4 個固定失敗（#708）

- Agent：Claude Code（Opus 5.5），由盤點工作階段交辦
- 分支：`claude/fix-708-windows-local-check-b28cda`
- 相關 PR：見本票 PR

## 依據

#708：Windows 本機乾淨 main 跑 `scripts/local-check.test.mjs` 固定 4 個失敗，`-Full` 因此停在 Node，不跑網頁測試。

## 原因

前 4 支測試用 `pwsh` 開 `check-local.ps1`（`BQ_CHECK_PWSH` 可覆寫）。這台只有 Windows PowerShell 5.1，`spawnSync('pwsh')` 啟動失敗（status 為 null），之後讀 `.scratch/checks` 才出現 ENOENT。舊紀錄提到的 5.1 中文亂碼已在 `check-local.ps1` 改 UTF-8 輸出後解決（5.1 專屬那兩支本來就會過）。

## 做了什麼

- `scripts/local-check.test.mjs`：
  - 測試用的 shell 改成：有 `BQ_CHECK_PWSH` 用它；Windows 上找不到 `pwsh` 改用內建 5.1；其他照舊用 `pwsh`。
  - Windows 上加 `-ExecutionPolicy Bypass`，避免執行原則擋 `-File`（跟 5.1 專屬測試一致）。
  - 5.1 路徑提到檔案開頭共用，兩支 5.1 測試不再各自組。
- 沒動 `check-local.ps1`、runner 與任何產品程式。

## 本機測試

見 PR 說明。
