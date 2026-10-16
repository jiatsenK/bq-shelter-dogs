# 2026-10-16 新 worktree 跑網頁測試前先裝套件（#323）

- AGENTS.md「指令」段補上新 worktree 要先裝 Playwright 與 Chromium，步驟照 `.github/workflows/tests.yml`。
- repo 沒有 `package.json`，所以票上寫的 `npm ci` 不適用，改寫 CI 實際用的 `npm install --no-save --no-package-lock playwright@1.56.1`。
- 在全新 worktree 試跑：npm install 成功；`npx playwright install chromium` 在本機卡住沒進度，改用 curl 直接下載 headless shell 和 winldd 的 zip 解壓縮後，`node scripts/run-browser-tests.cjs` 全部 256 項通過（10/17）。這個備案也寫進 AGENTS.md。
