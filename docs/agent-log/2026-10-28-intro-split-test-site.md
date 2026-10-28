# 2026-10-28 介紹搬家套到測試網站（ADR 0022）

- 日期：2026-10-28（台灣時間）
- Agent：Claude Code
- 分支：`claude/intro-split`（PR #668，草稿）

## 做了什麼

- K 在管理網站合併了重複的狗（小偉、JOJO、栗子），重新產生核對表：124 隻、147 列。
- K 說「核對表先這樣確認OK」：全部填「對」，加上 K 之前給的答案：
  - JOJO 2019042407：入所原因改「被棄養入所，主人說不親人」，離所原因「領養後退養」
  - 小七沒編號那筆：重複的狗
  - 小七 2026032605：入所原因改「從樹林入所，有晶片但沒人領回」
- 留空白、這次不寫：豆花（K：先不管）、仲基（沒編號那筆只寫 2018 年，要 K 填入所日）。
- 產生 migration：122 隻、496 句，預演寫 1,238 列。
- 「準備預覽資料庫」把正式庫複製到測試庫（兩邊狗數一樣），再把 SQL 只套到測試庫 `bq-shelter-dogs-test`（`wrangler d1 execute --config wrangler.preview-db.jsonc --file`），實際改了 1,239 列。抽查 JOJO、小七、小偉、豆花的出入所紀錄與介紹，跟核對表一樣。
- 「部署到測試網站」部署 `claude/intro-split` d4f922e。

## 沒做／要注意

- **正式庫沒動**。migration SQL 放在 `.scratch/intro-split/`（不 commit），還沒決定要不要進公開 repo。
- 正式上線時要照順序：先在正式庫套 SQL，再部署程式；中間有人改過的狗會整隻跳過，要重產核對表再比一次。
- main 之後有推送，測試網站會換回 main 的程式，要再手動部署這個分支。

## 同日上線（K：「測試網站看過沒問題」「確認上線」）

- 合併 main 進分支，補改兩個還寫「死亡」的測試（`scripts/admin-table.test.mjs`、`scripts/intro-split/intro-split.test.mjs`），本機完整測試通過。
- 寫正式庫前再比一次：正式庫從核對表後沒被改過，SQL 跟測試庫套的一樣。用 `wrangler d1 execute bq-shelter-dogs --remote --file` 套（SQL 不進 repo，留在本機 `.scratch/intro-split/`），實際 1,239 列；抽查 `v3_stays` 122 隻、介紹只剩仲基與豆花、JOJO 兩筆正確。
- PR 轉正式時，草稿那次推送的事件把正式那次測試取消掉（同一組 concurrency），手動重跑後通過；squash 合併 #668，「部署到 Cloudflare」成功。
- 收尾：刪掉本機與 GitHub 的 `claude/intro-split`、移除工作資料夾 `merge-intro`（沒進 git 的檔案先複製到主資料夾 `.scratch/`）。
- 還沒做：仲基（要 K 給 2018 年入所日）、豆花（K 先不管）、DROP `v3_intake_events`（下一張 PR）。
