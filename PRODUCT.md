# Product

<!-- impeccable:product-schema 1 -->

<!-- 給 impeccable 技能讀的產品摘要。規格不在這裡重寫：功能與版本以 docs/PROJECT_GOALS.md 為準，用字以 GLOSSARY.md 為準，兩邊衝突時以那兩份為準。本檔依 K 2026-10-09 指示由現有文件整理，沒有另外訪談。 -->

## Platform

web

## Users

板橋收容所的遛狗志工。在所裡站著、走路，常常一手牽狗、一手拿手機用。不是試算表管理者。背景與使用情境見 `docs/PROJECT_GOALS.md`「背景」和 `docs/DESIGN_GUIDE.md`「單手操作」。

## Product Purpose

讓志工用手機很快知道三件事：哪隻狗很久沒溜、牠在哪、牠能跟誰一起溜，並在溜完時記一筆。各分類與功能的現況見 `docs/PROJECT_GOALS.md`（最新的版本段落在最上面）。

## Operating Context

- 資料的唯一正本是 D1；試算表只剩管理者輸入，由 Apps Script 推給 Worker。網站和 `/api` 在同一個 Cloudflare Worker。資料在哪、誰寫、怎麼同步見 `docs/ARCHITECTURE_NOW.md`。
- 志工使用說明：`docs/VOLUNTEER_GUIDE.md`。

## Capabilities and Constraints

- 網站寫回試算表的範圍照 `docs/adr/0006-sheet-write-scope.md`：主清單的「遛狗日期」「誰遛的」，備註欄與異動紀錄只追加。範圍外的新寫入要先改那份 ADR；介面上不要出現看起來能改範圍外內容的元素。
- repo 裡的公開資料（data/walks.json 等）不放志工名字，用代號；網站畫面可以顯示試算表上的志工名字（溜狗人、名字選單），名字本來就在志工共用的試算表裡（K 2026-10-09）。
- 固定名詞照 `GLOSSARY.md`，畫面上的字也一樣。

## Product Principles

- 安靜、實用：先讓志工把事情做完，不做行銷式、裝飾性的畫面。
- 單手、拇指按得到是規範，不是加分項（`docs/DESIGN_GUIDE.md`「單手操作」）。
- 天數一定連著顏色一起出現，紅黃綠只拿來表示天數和警示。
- 資料抓不到時安靜退回預設，不白屏、不報錯給志工看。

## Accessibility & Inclusion

點擊目標至少 44×44 px、避開系統手勢區（`docs/DESIGN_GUIDE.md`「單手操作」）；手機設定減少動態效果時要跟著減少動畫（V5.2 #78）。
