# Product

<!-- impeccable:product-schema 1 -->

<!-- 給 impeccable 技能讀的產品摘要。規格不在這裡重寫：功能與版本以 docs/PROJECT_GOALS.md 為準，用字以 CONTEXT.md 為準，兩邊衝突時以那兩份為準。本檔依 K 2026-10-09 指示由現有文件整理，沒有另外訪談。 -->

## Platform

web

## Users

板橋收容所的遛狗志工。在所裡站著、走路，常常一手牽狗、一手拿手機用。不是試算表管理者。背景與使用情境見 `docs/PROJECT_GOALS.md`「背景」和 `docs/DESIGN_GUIDE.md`「單手操作 › 為什麼」。

## Product Purpose

讓志工用手機很快知道三件事：哪隻狗很久沒溜、牠在哪、牠能跟誰一起溜，並在溜完時記一筆。各分類與功能的現況見 `docs/PROJECT_GOALS.md`（最新的版本段落在最上面）。

## Operating Context

- 資料來自志工共用的 Google 試算表，定時同步成 `data/dogs.json`；網站和 `/api` 在同一個 Cloudflare Worker。流程見 `docs/PROJECT_GOALS.md`「資料載入」。
- 志工使用說明：`docs/VOLUNTEER_GUIDE.md`。

## Capabilities and Constraints

- 寫回試算表只限主清單的「遛狗日期」和「誰遛的」兩欄，新功能不能加寫入（`AGENTS.md`）。介面上不要出現看起來能改試算表其他內容的元素。
- 公開資料不放志工名字。
- 固定名詞照 `CONTEXT.md`，畫面上的字也一樣。

## Product Principles

- 安靜、實用：先讓志工把事情做完，不做行銷式、裝飾性的畫面。
- 單手、拇指按得到是規範，不是加分項（`docs/DESIGN_GUIDE.md`「單手操作」）。
- 天數一定連著顏色一起出現，紅黃綠只拿來表示天數和警示。
- 資料抓不到時安靜退回預設，不白屏、不報錯給志工看。

## Accessibility & Inclusion

點擊目標至少 44×44 px、避開系統手勢區（`docs/DESIGN_GUIDE.md`「單手操作 › 規範」）；手機設定減少動態效果時要跟著減少動畫（V5.2 #78）。
