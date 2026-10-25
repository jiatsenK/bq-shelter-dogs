# 部署不再帶 Worker 用不到的密鑰（#595）

- 日期：2026-10-26。Agent：Claude。分支 `claude/595-unused-secrets`（從 main `0fadda8` 開）。
- 依據：#595（2026-10-26 稽核開立），K 2026-10-26 交辦照建議順序先做本票。
- `deploy-cloudflare.yml`：不再上傳 `MY_NAME`、`SHEET_ID`；`ADMIN_KEY` 不再用 `NOTES_PASSCODE` 備援。`r2-thumbs.yml` 同樣拿掉備援。
- `worker/src/index.js`：拿掉 `sheetId` 設定；首頁狀態不再顯示 `walkerNames`（#519 起志工名字讀 D1），`photos` 沒接 R2 時顯示「未設定」，不再顯示 GitHub（#547 已沒有 GitHub 照片路徑）。
- 測試：`worker/test/worker.test.mjs` 加首頁狀態檢查；`tests/index/hosting.js` 縮圖 Action 改檢查只用 `secrets.ADMIN_KEY`，並加部署不帶三個密鑰的檢查。
- 文件：重新產生 `docs/adr/README.md`（`SHEET_ID` 列消失）；`docs/setup/CLOUDFLARE_SETUP.md`、`docs/setup/SHEET_SYNC_SETUP.md` 補說明。
- **合併前 K 要做**：GitHub 目前沒有 `ADMIN_KEY` Secret（2026-10-26 `gh secret list`），正式部署與縮圖 Action 都是靠 `NOTES_PASSCODE` 備援拿到金鑰。合併前先新增 GitHub Secret `ADMIN_KEY`。不知道舊值也沒關係：設一組新值，合併後的部署會把新值帶到 Worker，縮圖 Action 也用同一個。
- **合併部署後 K 要做**：刪 Cloudflare 密鑰 `MY_NAME`、`SHEET_ID`（部署只會新增或更新，不會刪）；刪 GitHub Secrets `MY_NAME`、`SHEET_ID`、`NOTES_PASSCODE`。Apps Script 指令碼屬性的 `SHEET_ID` 不能刪。
- 本機檢查：`scripts/local-check.test.mjs` 在這台電腦用 `pwsh` 跑腳本會被指令碼執行原則擋，乾淨的 main 也一樣 4 個失敗，與本票無關，另計；其他 Node 測試與全部網頁套件見交付回報。
- 未做：沒有推送、沒有開 PR（未交辦）。
- 相關 PR：尚未建立。
