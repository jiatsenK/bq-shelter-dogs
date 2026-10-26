# 管理網站：狗表狀態分頁、合併重複的狗

- 日期：2026-10-26。Agent：Claude。分支 `claude/admin-dog-merge`（從 main `2feead4`）。
- 依據：K 回報管理網站有 134 隻（實際 116）、有狗沒編號沒照片、同一隻狗兩個編號、看不出在所與已出所，希望不用進 SQL 就能合併重複的狗、溜狗紀錄不消失。#621 是重複的成因。
- 正式 D1 唯讀查詢（只 SELECT）：134 ＝ 主清單 116 ＋ 有離所紀錄 8 ＋ 兩邊都沒有 10。主清單 116 隻在志工網站都有編號和照片；沒編號／沒照片的都在多出來的 18 隻。同名重複 6 組：米香、福星、金寶（沒編號，前兩隻身上有 3＋1 筆溜狗紀錄）、JOJO、小偉、栗子（舊編號那筆有介紹與 R2 照片，可能是舊編號也可能是同名另一隻，要 K 看照片判斷）。另有芊芊、豆花與兩隻無名的狗不在表上也沒離所紀錄。
- K 決定：合併後刪掉被併的那筆、留快照可還原；狗表預設在所；#621 先手動合併＋資料檢查提示，自動認改編號之後再說；「標成已出所」之後再說。
- 做了：
  - `worker/src/admin/dogs.js` 每隻狗多回 `status`（main／departed／unknown）、最近一次離所、`formerNumber`（不在主清單時最新的舊編號）；仍是 1 個 SELECT。
  - 狗表上方分頁「在所／已出所／待核對／全部」帶數量，預設在所；不在所的狗顯示舊編號。原本「名單」下拉拿掉。
  - `worker/src/dog-merge.js` 預覽／合併／取消合併，管理 API `GET|POST /api/manage/dogs/{id}/merge`、`POST …/unmerge`。規則與一致性寫在 `docs/operations/dog-editing.md`「合併重複的狗」。
  - 編輯抽屜「合併重複的狗」、修改紀錄「取消合併」、待補清單「可能重複」卡片；公開編輯紀錄的 merge 只回摘要。
  - 名詞：第三個狀態叫「待核對」，不用「待確認」（名詞表裡是離所原因與性別用詞）；畫面文字用「離所」，分頁「已出所」沿用 K 的說法與試算表分頁名。GLOSSARY 加「在所／待核對」「合併狗」。
- 測試：新增 `worker/test/dog-merge.test.mjs`、`tests/admin-dog-merge.cjs`，改 `worker/test/admin.test.mjs`、`scripts/admin-table.test.mjs`、`tests/admin.cjs` 等夾具。
- 注意：`scripts/admin-table.test.mjs` 與 `scripts/admin-stage4.test.mjs` 同時跑時，兩邊都在重建 `admin/public/shared/`，有一次讀到寫一半的檔（`edit-values.js` 沒有 export）；重跑通過，跟本次改動無關，沒修。
- 未做：沒有部署（管理網站要 K 在 Actions 按「部署管理網站」）、沒有動正式資料、沒有開 PR。不需要新 migration。
- 相關 PR：無（K 尚未交辦）。
- 接上 main：開工後 main 合併了 #626（右側抽屜編輯、側欄分兩組、資料檢查改名待補清單、更新紀錄改名修改紀錄、`presence` 網址參數）。rebase 後合併區改放在抽屜欄位下方（不算進抽屜草稿），狀態分頁取代 `presence`、存在網址 `status`；待補清單的連結不再帶 `presence=main`。#626 的抽屜測試原本固定捲 120px，表格上方多了分頁後第一列被擠出 400px 高的視窗，改成把第一列捲到畫面中間再量。
- 兩軸審查（Standards／Spec 子代理）後補修：同一天兩邊都有溜狗時改成接在後面、不丟（K：「溜過的紀錄不會消失」）；照片只當一般照片搬、不蓋掉留下那隻的主照片（照計畫）；刪除先用 dog_id 篩走索引，沒有 dog_id 索引的五張小表列在 `SCAN_OK` 並加查詢計畫測試；預覽列出不採用的介紹／休養／出入所內容；用詞「日期待確認」；紀錄 ID 不靠句子順序；共用 `statusText`、`shownNumber`、`countsText`。
- 審查提到但沒改：取消合併時，合併後留下那隻又改過的列不動（計畫原本寫拒絕），改成「被併那隻照快照還原、留下那隻保留後來的修改」，寫在 `docs/operations/dog-editing.md`；被併那隻離所過、留下那隻在所時補 `returned_number`（同再入所）；`onMain` 與 `status` 並存，給既有完整度規則用。
- `scripts/local-check.test.mjs` 在這台 Windows 環境本來就失敗（乾淨 main 一樣），跟本次無關。平行測試讀到寫一半的共用檔：main 同時也修了（暫存檔再改名），rebase 時採用 main 的版本。
