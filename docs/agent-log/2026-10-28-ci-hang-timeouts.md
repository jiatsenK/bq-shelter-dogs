# CI 卡住改成在時限內失敗：安裝逾時重試、網頁測試每套件時限

- 日期：2026-10-28。Agent：Claude Code。
- 依據：#659（安裝無頭瀏覽器卡住）、#713（網頁測試超過 10 分鐘被取消）。

## 查到的原因

- #713 不是「CI 整體比本機慢 6 倍」：正常的 CI 網頁測試約 1.5 分鐘（例如 run 40622219955：10:40:21→10:41:54），跟本機差不多。run 40524434740 是 `group-walks` 這一個套件卡住：前一個套件 `group-cache` 22:48:32 印出通過後，到 22:57:13 job 被取消都沒有任何輸出；這個套件平常 6 秒。日誌看不出卡在哪一步，本機連跑 9 次（每次 7–8 秒）都重現不出來。Playwright 的 `page.evaluate`、滑鼠／鍵盤、`context.close()` 沒有預設逾時，頁面卡住就會一直等到 job 時限。
- #659 卡在 `--with-deps` 用 apt 從 azure.archive.ubuntu.com 下載系統套件（字型、xvfb），每個檔要等 10～30 秒，不是 Chromium 本體下載慢。快取 `~/.cache/ms-playwright` 只省瀏覽器下載、省不到 apt，所以不做。

## 做了什麼

- `scripts/suite-timeout.cjs`：每個網頁測試套件 150 秒時限（index 自己等 120 秒），卡住就以錯誤失敗並寫出套件名稱；關瀏覽器最多等 10 秒。測試：`scripts/suite-timeout.test.mjs`。
- `.github/workflows/tests.yml`：安裝步驟每次最多 4 分鐘、失敗或卡住重試一次（重試前 `dpkg --configure -a`），步驟上限 9 分鐘；網頁測試步驟上限 5 分鐘；job 上限 10→15 分鐘，只當最後防線。卡住會變成步驟「失敗」（紅叉），不再是整個 job「取消」。
- 安裝加 `--only-shell`（#503 方案 4）：無頭模式本來就只用 headless shell，不下載完整版 Chromium。本機文件 `docs/agents/local-checks.md` 同步。

## 未完成

- 「取消」在 PR 上顯眼：私人 repo 免費方案不能設必要檢查（tests.yml 既有註解）；改用上面的步驟時限讓卡住變失敗。同 PR 推新 commit 造成的取消（concurrency）是正常的，不處理。
- 安裝前後耗時與「CI 至少跑兩次」要看這張 PR 的 CI 結果，依規則不等待；`--only-shell` 若沒變快或出問題再拿掉。
- `group-walks` 卡住的確切步驟未找到；下次再卡會在 150 秒內失敗並寫出套件名稱。
- 相關 PR：（開 PR 後補）
