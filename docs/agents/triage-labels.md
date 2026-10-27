# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## 區域標籤（跟上面的狀態標籤並用）

開票或分票時，依改到哪裡補一個以上：

| 標籤 | 範圍 |
| ---- | ---- |
| `前端` | 網頁畫面：溜狗表、管理網站（`public/`） |
| `後端` | Worker `/api`、同步、Apps Script（`worker/`、`apps-script/`） |
| `資料` | D1 資料表、試算表內容、舊資料整理 |
| `部署` | 部署、測試網站與正式環境設定 |
| `開發流程` | CI、測試工具、AGENTS.md、agent-log |
| `documentation` | 只改文件（ADR、研究筆記） |
