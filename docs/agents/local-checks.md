# 本機檢核與工具輸出

依據：#425，K 同意 #418 retrospective 的改善。全域讀取／輸出原則沿用 CORE_RULES §9，不在此重寫；Matt 原版技能維持原樣。

## 檢查入口

在 repo 根目錄執行；Playwright 安裝方式見本檔末段。

```powershell
node scripts/run-browser-tests.cjs --list
node scripts/run-node-tests.mjs --list
.\scripts\check-local.ps1 -Suite startup-stability -Reason '驗證啟動補修'
.\scripts\check-local.ps1 -NodeTest worker/test/walk-retry.test.mjs -Reason '驗證重試補修'
.\scripts\check-local.ps1 -NodeTest scripts/local-check.test.mjs,worker/test/walk-retry.test.mjs -Reason '驗證相關模組'
.\scripts\check-local.ps1 -Full -Reason '補修與審查完成後的最終完整測試'
.\scripts\check-local.ps1 -Suite startup-stability -Reason '調查偶發失敗' -RepeatReason '相同程式與環境下重現間歇問題'
```

- **本機執行測試一律走 `check-local.ps1`**，包含開發、補修、診斷與最終全套；AI 也使用同一入口，並填寫具體 `-Reason`。`-NodeTest` 接受 repo 相對完整檔名（不接受 glob），`-Suite` 接受網頁套件名；可以同時指定兩者。兩種 runner 的 `--list`／`--help` 可直接查詢，錯字會失敗，不會誤跑整套。`index` 是 tests/index.html 的全部檢查。
- **同條件已通過仍要重跑，另填 `-RepeatReason`**；合理診斷照常執行。沒有理由只留下 blocked 紀錄，不跑測試；失敗可直接補跑，不算通過。此階段沒有快取或自動略過。
- `.scratch/checks/*.json` 記錄開始／結束時間、HEAD、未提交狀態、內容指紋、命令範圍、執行／重跑原因、先前通過紀錄、結果、退出碼、耗時及完整日誌路徑。逐次保存，包含 failed／blocked；中斷可能留下 running，不視為通過。日誌不提交。指紋保守涵蓋全部 Git 追蹤及未忽略的未追蹤檔（排除 `.scratch/`），以及 Node／PowerShell／Playwright 版本、平台、相關環境變數雜湊；不是依賴分析或效能快取，文件變更也可能形成新條件。環境變數值不直接寫入紀錄。
- 既有兩種 runner 在本機缺少有效入口紀錄時拒絕執行；GitHub Actions 的原命令保留。這是防誤用，不是安全隔離：任意 `node --test`、自寫腳本或偽造環境仍可繞過。AI 依此文件使用統一入口；本次不新增 agent／shell hook，不宣稱全面攔截任意命令。
- 日常先跑相關套件，補修與審查完成後保留一次 `-Full`；GitHub CI 仍跑完整 Node＋網頁測試。成功只顯示末幾行，失敗顯示末 30 行。PR／CI 的交付範圍依全域 workflow。
- worktree 可沿用主工作目錄已安裝的 Playwright：將 `$env:NODE_PATH` 指到該目錄的 node_modules，再執行入口。

## 明確交辦等待 CI 時

授權範圍依全域 workflow；以下命令只用於使用者明確交辦的 CI 等待工作。

```powershell
.\scripts\wait-pr-checks.ps1 -Number 424
```

等待結束後回報對應 SHA 與 check 狀態；退出碼須與實際 check／run 結果一致：失敗、被取消或還沒跑完都不是 0（gh 對被取消的 check 回 0，腳本另外讀狀態判斷）。剛開 PR 尚無 checks 時回報目前狀態。

## 查找與載入

- PowerShell 搜尋檔案用 `rg -n '關鍵字' tests -g '*.js'`，glob 交給 rg；先定位再讀相關段落。
- 技能與規則已讀且未變更時沿用，不為每個 checkpoint 重讀。
- 純行為修正沿用既有產品／設計文件，不自動擴成完整視覺設計流程；介面改動仍照 AGENTS.md 做必要 detect。
- 使用技能的長 context 命令時先輸出到 `.scratch/`，只讀與當前目標相關的段落；不把無關設計資產與診斷整份帶入對話。
- 審查維持規定的獨立性；複審只交付新增差異、基準與未解項目。

## 完整測試與安裝

跟 `.github/workflows/tests.yml` 一樣，PR 要全過：

- 本機完整測試：`./scripts/check-local.ps1 -Full -Reason '補修與審查完成後的最終完整測試'`。
- CI node 測試仍用 `node scripts/run-node-tests.mjs`（自動找 `scripts/`、`worker/` 底下全部 `*.test.mjs`）。
- CI 網頁測試仍用 `node scripts/run-browser-tests.cjs`（需要 Playwright 的 Chromium）。
  - 新 worktree 沒有 `node_modules`，先在 repo 根目錄裝（照 `tests.yml`，repo 沒有 `package.json`，不用 `npm ci`）：`npm install --no-save --no-package-lock playwright@1.56.1`，再 `npx playwright install chromium`（Linux 加 `--with-deps`）
  - `playwright install` 卡住沒進度時：刪 `%LOCALAPPDATA%\ms-playwright\__dirlock`，改用 curl 直接下載 `https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1194/chromium-headless-shell-win64.zip` 解壓縮到 `ms-playwright\chromium_headless_shell-1194\`，`builds/winldd/1007/winldd-win64.zip` 解壓縮到 `ms-playwright\winldd-1007\`（版本號以錯誤訊息寫的路徑為準）


設計 context 摘要、指定段落與原版工具輸出方式見 [design-tools.md](design-tools.md)。
