# 2026-10-16 D1 每張表讀取量審核

- 日期：2026-10-16
- Agent：Claude Code（Opus 5.5）
- 分支：`docs/d1-table-audit`（從 origin/main）

## 做了什麼

- 新增 `docs/research/2026-10-16-d1-table-audit.md`：逐表審核 `db/compact-schema.sql` 的讀者、是否被資料包涵蓋、變動頻率、同步讀取量，標出改成大列／維持現狀／另外處理。
- 列數根據：同步 workflow 日誌（gh）、`proto-seed.sql` 快照、`fakeD1` 實測與 `EXPLAIN QUERY PLAN`。量測腳本放 scratchpad，沒進 repo。

## 依據

- K 交辦（#320、ADR 0009 的延伸審核）。

## 例外／未完成

- 只是研究，未改程式、未碰正式 D1、未部署。
- 志工、開卡、常溜、編輯紀錄沒有正式列數，文件中標「未知」。
- 建議是 agent 的建議，待 K 決定。

## 相關 PR

- 尚未開 PR（依交辦只 push 分支）。
