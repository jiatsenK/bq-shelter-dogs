# 改版收尾：開關啟用、Issue 與過時文件整理

- 日期：2026-10-24。Agent：Claude。分支 `claude/revamp-docs-cleanup`。
- 依據：K 2026-10-24 對話：釐清改版終點（D1 唯一正本、試算表只剩輸入）；混亂來源是 agent 讀到過時規格、Issue 範圍不清；清單 `.scratch/2026-10-24-revamp-cleanup-plan.md` 經 K 確認後執行。

## 正式環境（K 明確授權）

- 發現 #533 打開 `d1WalkAccept` 時，正式 Worker 沒有 `D1_WALK_NOTIFY`、`WALK_RETRY_ENABLED`：人工改表不進 D1，保險掃描與寫回重試都沒跑。設定前查 D1：outbox 6 筆皆 synced、衝突 0。
- `wrangler secret put` 設 `D1_WALK_NOTIFY=1`、`WALK_RETRY_ENABLED=true`。
- 驗收：K 手動改馬克（2020122507）→ 2026/10/24 K，D1 `v3_walk_state` 08:03:45 UTC 更新為 version 2，衝突 0。

## Issue

- 關 #519（已隨 PR #527 完成）、#398（併入 #512）。
- 更新內文：#498（進度、開關、驗收）、#512（#519／#520 打勾、併入 `/sync` 前端 POST）、#503（刪過時的 sync-sheet 段）。
- 留言：#445、#401（前提已滿足；#401 改 ready-for-agent）。
- 新開母票 #538。

## 文件

- 新增 `docs/ARCHITECTURE_NOW.md`（資料流現況入口），AGENTS.md「依任務載入」加一列。
- 456–460 同步設計稿移到 `docs/design/history/`，開頭標已過時；引用與相對連結已修。
- `PROJECT_GOALS.md` 後端節加過時註記、gviz 與公開檢視改正；`FRONTEND_REQUIREMENTS.md` gviz、`COMPACT_D1.md` sync-sheet 段標退役。

## 未做

- 兩個開關已由 PR #540 改成 `wrangler.jsonc` vars，`ARCHITECTURE_NOW.md` 開關段同步改寫。
- `python` 在這台是 Windows 商店空殼，腳本請用 node。
