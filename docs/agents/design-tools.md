## Agent skills

`.claude/skills/` 內是 Matt Pocock 的技能（mattpocock/skills v1.3.1 @ 24fe0ef，MIT 授權，見 `.claude/skills/LICENSE-mattpocock-skills`）。Codex 不掃這個資料夾，要用時直接讀對應的 `SKILL.md`。

### impeccable（前端設計檢核）

`.claude/skills/impeccable/` 和 `.claude/agents/impeccable-*.md` 來自 pbakaus/impeccable（commit 778c8a7，技能版本 4.5.0，Apache 2.0，見 `.claude/skills/LICENSE-impeccable`）。用法：`/impeccable audit 找狗頁`、`/impeccable critique 溜狗表`、`/impeccable polish …`。第一次執行會自動下載它的檢查程式到 `~/.impeccable/`。沒有裝上游的自動 hook（每次改檔都會跑），改完介面時照技能指示手動跑一次 `detect`。修正仍要守 `docs/DESIGN_GUIDE.md` 和產品定位（安靜、實用），技能建議跟這兩份衝突時以 repo 文件為準。


## Context 輸出

先執行 `node scripts/design-context.mjs --target public/index.html`（圖鑑用 `public/cards.html`）。預設只列摘要與來源行號；`--section` 展開指定段落，`--full` 才展開該頁面的全文。摘要由現行文件即時擷取，不維護第二份規格。

技能要求的原版 context 仍執行一次，完整輸出導向 `.scratch/design-context-raw.txt`；先讀診斷與指令，再依本機摘要展開相關來源，不將完整輸出回填對話。原版技能與下載工具不修改。
