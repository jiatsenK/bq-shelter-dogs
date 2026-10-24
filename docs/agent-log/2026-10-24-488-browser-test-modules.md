# 網頁測試依模組拆檔（#488）

- 日期：2026-10-24。Agent：CODEX。沿用交辦時的 `codex/486-favorites-sync` 分支。
- 依據：#488、父票 #471 的整個網頁測試接縫與 ADR 0017；本次只拆測試，不切換正式前端的載入方式。
- 將 `tests/index.html` 的主測試 script 拆成 `tests/index/` 下的共用工具、啟動流程及各模組測試；HTML 保留 DOM 與依序載入的 script。新增 `tests/README.md` 說明責任、共用狀態與執行入口。
- 保留既有測試內容、假資料、斷言與執行順序；未修改 public、Worker、runner 或 CI。
- 驗證：拆檔前與初次拆檔後 index 均 266 項通過。固定比較基準 `1ef4e4e6331fd266551db1d43e41d88dd400637f`，逐檔對回原本 4,768 行，確認全部原樣保留，16 支 JS 語法檢查通過，bootstrap 的執行順序不變。本 repo 無 typecheck 設定。
- code-review：依 agent-split.md 的純測試／文件例外，在同一對話分開檢查兩軸。Standards：對照本 repo 與 agent-hub 的 CODING_STANDARDS、ADR 0017 及技能 smell baseline，無發現；Spec：對照 #488／#471，未減少測試、未修改網站行為與 CI 入口，無發現。
- 最終完整檢核：`check-local.ps1 -Full` 通過，Node 486／486、全部網頁套件通過，index 266／266。紀錄在獨立 worktree 的 `.scratch/checks/1792782913540-0942766c-a70b-4a8f-9c56-e216d12bb607.json`；完成後補驗證紀錄、去除新檔檔尾多餘空白行，重新檢查語法、內容與 diff；未改測試邏輯或網站程式。
- 共享目錄在實作途中被切至 `claude/d1-walk-accept-on`；依 workflow 改到 `.scratch/488-worktree`，仍使用原任務分支，未變更他人的 public/js/site-config.js 或 ADR 索引。
- 例外／未完成：既有 V9 與 #141 測試同時操作身分和溜狗，整組放 welcome，避免改變原本的共用 setup／cleanup；無新增網站行為或已知違規。
- PR 交付：K 後續明確交辦「建立 PR」，因此推送並建立本分支對應的草稿 PR；不轉正式、不等待 CI。
- 建立 PR 前核對：#486 已由 #532 squash 合併；將 #488 的單一提交接到最新 main（`b3c0074`），避免帶入已合併的變更。測試檔內容與原 `3a3af15` 完全一致，沿用既有驗證結果；僅更新本紀錄。
