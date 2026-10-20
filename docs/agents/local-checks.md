# 本機檢核與工具輸出

依據：#425，K 同意 #418 retrospective 的改善。全域讀取／輸出原則沿用 CORE_RULES §9，不在此重寫；Matt 原版技能維持原樣。

## 檢查入口

在 repo 根目錄執行；需要的 Playwright 安裝方式見 AGENTS.md。

```powershell
node scripts/run-browser-tests.cjs --list
node scripts/run-browser-tests.cjs --only startup-stability
node scripts/run-browser-tests.cjs --only startup-stability,walker-editing
.\scripts\check-local.ps1 -Suite startup-stability
.\scripts\check-local.ps1 -Full
.\scripts\wait-pr-checks.ps1 -Number 424
```

- `--only` 僅接受列出的名稱；錯字會失敗，不會誤跑整套。`index` 是 tests/index.html 的全部檢查。
- 無參數仍跑完整網頁流程；CI 不變。日常開發先跑相關套件，修正與審查完成後跑一次完整檢查；後續只因新變更、失敗或未解疑慮重跑。
- PowerShell 入口將完整輸出存到 `.scratch/checks/`，成功只顯示末幾行，失敗顯示末 30 行。日誌不提交。CI 等待結束只回傳最後結果與退出碼；剛開 PR 尚無 checks 時會明確失敗，稍後再執行。
- worktree 可沿用主工作目錄已安裝的 Playwright：將 `$env:NODE_PATH` 指到該目錄的 node_modules，再執行入口。

## 查找與載入

- PowerShell 搜尋檔案用 `rg -n '關鍵字' tests -g '*.js'`，glob 交給 rg；先定位再讀相關段落。
- 技能與規則已讀且未變更時沿用，不為每個 checkpoint 重讀。
- 純行為修正沿用既有產品／設計文件，不自動擴成完整視覺設計流程；介面改動仍照 AGENTS.md 做必要 detect。
- 使用技能的長 context 命令時先輸出到 `.scratch/`，只讀與當前目標相關的段落；不把無關設計資產與診斷整份帶入對話。
- 審查維持規定的獨立性；複審只交付新增差異、基準與未解項目。
