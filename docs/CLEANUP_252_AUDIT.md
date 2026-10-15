# #252 刪檔驗證與唯讀 D1 比對

本次依 K 最新指示在分支移除 data/、dogs/ 以驗證依賴；main／正式網站未變更，沒有打標籤、刪 D1 表、寫正式 D1、合併或部署。此分支須保持草稿，等待期和差異處理完成前不可合併。

## 刪檔後的原始失敗

原版 Node CI 清單：233 項，218 通過、15 失敗。未先修程式，先取得以下完整失敗清單：

- `scripts/build-db.test.mjs`：repo 裡現在的資料轉得進去，而且真的能放進 db/schema.sql 的表（有 node:sqlite 才跑這段）
- `scripts/import-compact-departures.test.mjs`：repo 的 departures.json 匯入後讀回一模一樣，重跑也一樣
- `scripts/import-compact-departures.test.mjs`：比對抓得到少一筆或欄位不同
- `scripts/import-compact-departures.test.mjs`：來源格式錯或編號重複就丟錯，不寫
- `scripts/import-compact-dogs.test.mjs`：真實 JSON 讀回完全一致，改一筆時指出狗編號和欄位
- `scripts/sync-compact-d1.test.mjs`：第一次寫入正式 D1：主清單、試算表備註、常遛狗群讀回跟 dogs.json 一樣
- `scripts/sync-compact-d1.test.mjs`：正式 D1 還沒有離所表時，SQL 自己先建
- `scripts/sync-compact-d1.test.mjs`：再同步一次沿用正式 D1 的永久狗 ID，不新增狗
- `scripts/sync-compact-d1.test.mjs`：開卡、照片、休養、介紹不被同步清掉
- `scripts/sync-compact-d1.test.mjs`：來源有問題時丟錯，不產生 SQL
- `scripts/sync-compact-d1.test.mjs`：#251 新的溜狗日期記一筆進 v3_walks，舊紀錄一筆不少
- `scripts/sync-compact-d1.test.mjs`：#251 試算表沒變再同步一次：溜狗紀錄、離所都不變（不重複記）
- `scripts/sync-compact-d1.test.mjs`：#251 狗從主清單消失記成離所，最後的樣子從 D1 上一次的主清單來；已有的離所保留
- `scripts/sync-compact-d1.test.mjs`：#251 複本可以從試算表整份重建：D1 是空的也能同步，主清單跟試算表一樣
- `scripts/sync-sheet.test.mjs`：狗卡：同編號只讀一次；讀不到就留空；編號不是英數字不去讀檔

網頁原版測試：載入 ../data/dogs.json 得到 HTTP 404，測試頁整體中止，不能將後續未執行項目列為通過。使用原 HEAD 的 tests/index.html 與實際缺檔工作區取得此結果。

另以程式檢查發現正式／預覽部署還跑 photo-versions.mjs、Worker 備註 API 與無 D1 時的照片驗證仍讀 GitHub 舊資料；這些不是原測試失敗清單中的項目，均另外解除。

## D1 比對

- 舊檔提交：255dbcfaa9ec6e8e1d7e37d80dc84773bda88074（git show，與工作區是否有資料目錄無關）。
- D1：bq-shelter-dogs，ID 6cd6c304-0fed-4ddb-b9ec-799e60a4adb4。
- SELECT 快照完成時間：2026-10-15T06:59:56.762Z（UTC）。單次指令讀回九張表，每張 rows_written=0。
- 快照筆數依序：永久狗 133、編號 131、主清單 118、主清單舊編號 1、介紹 127、休養 2、溜狗列 1120、離所 6、離所子項 5。
- 完整快照與逐筆 JSON 報告僅在 .migration-private/252/，已忽略 Git 且禁止打包成網站資產。公開報告不含志工名字或私密匯出。

| 類別 | 比對單位數 | 差異 |
| --- | ---: | ---: |
| sex | 129 | 10 |
| formerIds | 129 | 0 |
| intro | 129 | 0 |
| rest | 2 | 0 |
| walks | 121 | 0 |
| departures | 6 | 0 |

單位是狗／欄位、休養設定或離所紀錄，不是 SQL 總筆數。性別／介紹包括舊狗卡上的離所狗；舊編號以同一永久狗的整組關係比對，不以陣列順序判差異；無編號溜狗紀錄按 D1 既有無編號狗名對照；同日舊紀錄只保留最後一筆有代號者，忽略已停用 mine；休養忽略 updatedAt；其餘內容逐筆比對。

### 性別差異（尚未修復）

| 編號 | 犬名 | 舊檔 | D1 |
| --- | --- | --- | --- |
| 2018070201 | 小偉 | male | 空白 |
| 2019042407 | JOJO | male | 空白 |
| 2021030913 | 咪寶 | female | 空白 |
| 2024101903 | 仲基 | male | 空白 |
| 2026021301 | 雪寶 | male | 空白 |
| 2026040501 | 栗子 | male | 空白 |
| 2026072401 | 芊芊 | female | 空白 |
| 2026082601 | 朵力（開多） | male | 空白 |
| 2026082607 | 寶妮 | female | 空白 |
| 2026091401 | 豆花 | male | 空白 |

程式修正只保留 D1 已有值，不會補回這十筆已缺失值；需 K 另行確認補值，重新唯讀比對一致後才能清除。這些差異不是自動可略過的搬遷差異。

## 重跑

在 repo 根目錄，明確選擇刪除前提交及完整唯讀快照：

```powershell
Set-Location C:\Users\User\repos\bq-shelter-dogs
if (!(Test-Path -LiteralPath .migration-private/252/d1-raw.json)) { throw '請先取得完整唯讀 D1 快照' }
node scripts/compare-cleanup.mjs 255dbcf .migration-private/252/d1-raw.json
```

快照 SQL 的表順序見 compare-cleanup.mjs 的 TABLES，使用 SELECT * 依序查詢。腳本只讀 Git 舊提交及已匯出的快照，沒有正式寫入指令；有任何差異或缺表時非零結束。舊檔已停止更新，快照若比舊檔新可能出現正常新增紀錄；仍逐筆列出，由人判斷，不能自動當成一致。

## TDD 與驗證

- 規格 #245 已確認的接縫：同步／搬遷函式介面，以及 Worker fetch；未新增測試接縫。
- 先紅再綠：沒有 dogs/ 保留 D1 性別與舊編號、備註 API 退役、六類唯讀比對及錯誤合併檢查。
- 合成 fixture 只有 12 隻虛構狗與兩筆虛構離所；沒有搬移正式資料。
- Node 完整清單及網頁測試結果在 PR 記錄；本機 headless 使用已安裝 Chrome（Playwright 版本相同），CI 使用 workflow 指定 Chromium。
- 正式／預覽只做 dry-run 打包，不部署。
