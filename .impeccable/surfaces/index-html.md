---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# 溜狗表全站（index.html）視覺改版

Mode: Operate。志工單手、在犬舍走道的自然光下用；任務是挑最久沒溜的狗、知道牠在哪、溜完按「溜了」。功能、文字、版面結構、操作方式全部不動，只換 CSS。

K 2026-10-09：現在的 AI 味來自通用的系統藍、千篇一律的圓角卡片、整體太平均；「做錯了」＝太花、在所裡看不清楚。三個方向各做一版（只改 css/app.css 檔尾的主題區塊），放 PR 預覽在手機比較，選定一個再合併。

## Direction contract

THESIS: 每隻狗是一份病歷夾，天數是夾邊的色籤；拒絕灰底白圓角卡＋系統藍的 iOS 樣板。

OWN-WORLD: 深檔案綠（#1F5C4D）的頁首與底部列；淡鋼灰綠底；白色直角紙夾、1px 細線相接成一整疊；天數是實心色籤（紅底白字、黃底黑字、綠底白字、灰底白字）；籠位是黑框白底的檔案標籤；篩選鈕是上緣圓、下緣平的索引分頁。

STORY: 志工一打開就看到一疊夾子，紅籤的那幾份凸出來；點籠位標籤知道在哪；按綠框「溜了」，籤變綠。

FIRST VIEWPORT: 上方深綠頁首（白字標題、日期、白底搜尋框）；索引分頁一排；中間直角狗卡一張接一張，每張右側是寫天數的實心色籤＋綠框「溜了」；底部深綠抽屜列，選中的分類是白底綠字的標籤。

FORM: 病歷夾色籤，排序第 4 名（seed 7f36b0c9）。另做兩個對照版：犬舍籠位牌（第 1 名）、航廈黃色指標（競爭者）。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 對照版

- 犬舍籠位牌：髮絲鋼灰底、鋼板卡片、黑色頁首與底部列；籠位是黑底白字的壓印門牌（全站一致的記號）；「溜了」是安全黃按鈕。
- 航廈黃色指標：白底黑字、黑色底部列；黃色只用在指路（籠位、在哪、找狗的籠位欄），黃帶配黑方塊白圖示；「溜了」黑底白字。

## 未決

- 頁首範圍字（目前看到 X 天～Y 天）要改 JS，這次只改 CSS 先不做。
