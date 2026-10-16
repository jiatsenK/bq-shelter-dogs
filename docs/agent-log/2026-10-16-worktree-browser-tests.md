# 2026-10-16 新 worktree 跑網頁測試前先裝套件（#323）

- AGENTS.md「指令」段補上新 worktree 要先裝 Playwright 與 Chromium，步驟照 `.github/workflows/tests.yml`。
- repo 沒有 `package.json`，所以票上寫的 `npm ci` 不適用，改寫 CI 實際用的 `npm install --no-save --no-package-lock playwright@1.56.1`。
- 在全新 worktree 照新寫法跑過 `node scripts/run-browser-tests.cjs`。
