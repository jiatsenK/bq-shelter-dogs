# 手機上的「在所時間分布」圖：分組、標籤與點長條看名單（2026-10-28）

2026-10-28（台灣時間）。問題（K）：「資訊 › 在所統計」的「入所多久分布」直條圖，現在分 7 格（未滿 3 個月、3–6 個月、6 個月–1 年、1–2 年、2–3 年、3–5 年、5 年以上），約一半的狗擠在「5 年以上」一根。正在比較兩版示意圖：`docs/design/unify-other-pages/3f-分組-每年一格.png`（10 根）與 `3g-分組-兩年一格.png`（6 根），兩版都是點長條後在圖下面列名單。想知道一般在 390px 寬的手機上怎麼做才對。

只讀研究，沒有改產品程式、沒有 commit、沒有開瀏覽器。外部說法都附第一手連結；標「【推論】」的是我依來源推出來、還沒實測的；標「【二手來源】」的是找不到第一手原文、只能引用轉述的。

---

## 摘要

**問題在哪**

1. 現在的 7 格是不等寬分組（寬度從 3 個月到 2 年，最後一格沒有上限），卻用等寬長條、高度直接畫隻數。統計上不等寬分組要畫「每單位寬度的隻數」（面積＝隻數），否則寬的格子會看起來特別多（[OpenLearn：Frequency density](https://www.open.edu/openlearn/science-maths-technology/data-analysis-visualisations-excel/content-section-4.4)、[NIST e-Handbook：Histogram](https://www.itl.nist.gov/div898/handbook/eda/section3/histogra.htm)）。「3–5 年」一根涵蓋 2 年、「5 年以上」涵蓋 6 年以上，正是這種情況。
2. 現在的長條是 `<div>`，只有 `title` 屬性（`public/js/analysis.js:243-251`），手機點不到、螢幕閱讀器也讀不到每根的數字；示意圖要加的「點長條」還沒有對應的按鈕語意。

**結論**

1. 常見分組規則對 135 筆資料建議的格數落在 **6～12 格**之間：Sturges 約 9 格、平方根規則 12 格、Rice 規則 11 格、Freedman–Diaconis 與 Scott 的寬度約 1.7～1.8 年（0～11 年約 6～7 格）。「每年一格」（11～12 格）與「兩年一格」（6 格）都在合理範圍內，規則本身不會替你選，選擇要看讀者要回答的問題。
2. 等寬分組是直方圖與官方統計的預設做法；英國國家統計局（ONS）的人口金字塔規範寫明「所有年齡組必須同寬」、「用資料裡最細的層級」（[ONS：Population pyramid](https://service-manual.ons.gov.uk/data-visualisation/chart-types/population-pyramid)）。
3. 窄螢幕上直條太多時，權威指南的主流建議是改橫條圖或縮短標籤，不是把文字轉斜（[Government Analysis Function：Charts](https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-charts/#section-8)、[Datawrapper：chart types guide](https://www.datawrapper.de/blog/chart-types-guide)）。
4. 點選後「其他長條變淡、再點一次取消」是設計系統裡有寫明的慣例（SAP Fiori，見 3.2）。只要每根長條上方都有印出隻數，變淡的長條對比低於 3:1 也符合 WCAG 1.4.11；選中狀態不能只靠顏色（WCAG 1.4.1）。
5. 點擊範圍：WCAG 2.2 AA 的下限是 24×24 CSS px（2.5.8）；Apple 預設 44×44 pt、Material 48×48 dp。390px 寬放 12 根，每根約 27px 寬，**過得了 AA 下限，但達不到 Apple／Material 建議**。

**建議（本專案）**：每年一格、0～11 年共 12 根，等寬、高度＝隻數，標籤只寫數字，軸標題寫「滿幾年」並說明 0 的意思；整根欄（含上方空白與下方標籤）都是按鈕。若資料以後超過 11 年，最後一格改成開放末端「11+」。兩年一格（6 根）是點擊範圍最舒服的替代方案。細節見第 4 節。

---

## 1. 分組方式

### 1.1 分組數規則套到本專案資料

各規則的公式取自 NumPy 與 R 的官方文件（兩者都直接引用原始論文）：

| 規則 | 公式 | 原始文獻 | 官方實作文件 |
|---|---|---|---|
| Sturges | 格數 = log₂(n) + 1 | Sturges, H. A. (1926). The Choice of a Class Interval. *JASA* 21(153), 65–66. [doi:10.1080/01621459.1926.10502161](https://doi.org/10.1080/01621459.1926.10502161) | [R `nclass.Sturges`](https://search.r-project.org/R/refmans/grDevices/html/nclass.html)、[NumPy `histogram_bin_edges`](https://numpy.org/doc/stable/reference/generated/numpy.histogram_bin_edges.html) |
| 平方根 | 格數 = √n | — | [NumPy](https://numpy.org/doc/stable/reference/generated/numpy.histogram_bin_edges.html)（文件說 Excel 等軟體用它） |
| Rice | 格數 = 2·n^(1/3) | — | [NumPy](https://numpy.org/doc/stable/reference/generated/numpy.histogram_bin_edges.html) |
| Freedman–Diaconis | 寬度 = 2·IQR·n^(−1/3) | Freedman, D. & Diaconis, P. (1981). On the histogram as a density estimator: L2 theory. *Z. Wahrscheinlichkeitstheorie verw. Gebiete* 57, 453–476. [doi:10.1007/BF01025868](https://doi.org/10.1007/BF01025868) | [R `nclass.FD`](https://search.r-project.org/R/refmans/grDevices/html/nclass.html)、[NumPy](https://numpy.org/doc/stable/reference/generated/numpy.histogram_bin_edges.html) |
| Scott | 寬度 ≈ 3.49·σ·n^(−1/3) | Scott, D. W. (1979). On optimal and data-based histograms. *Biometrika* 66(3), 605–610. [doi:10.1093/biomet/66.3.605](https://doi.org/10.1093/biomet/66.3.605) | [R `nclass.scott`](https://search.r-project.org/R/refmans/grDevices/html/nclass.html)、[NumPy](https://numpy.org/doc/stable/reference/generated/numpy.histogram_bin_edges.html) |

套用本專案的「滿幾年」分布（滿 0 年 7、1 年 10、2 年 10、3 年 11、4 年 10、5 年 18、6 年 12、7 年 13、8 年 19、9 年 5）。每一格裡的隻數先平均攤開成連續值再算四分位數，所以是約略值：

| 項目 | n = 115（上面各年加總） | n = 135（在所總數） |
|---|---|---|
| Sturges | 7.8 → 8 格 | 8.1 → 9 格（R 取無條件進位） |
| 平方根 | 10.7 → 11 格 | 11.6 → 12 格 |
| Rice | 9.7 → 10 格 | 10.3 → 11 格 |
| Freedman–Diaconis | 寬 1.82 年 → 0～11 年約 6 格 | 寬 1.73 年 → 約 6～7 格 |
| Scott | 寬 1.90 年 → 約 6 格 | 寬 1.80 年 → 約 6 格 |

（Q1 ≈ 3.2 年、Q3 ≈ 7.6 年、IQR ≈ 4.4 年、標準差 ≈ 2.6 年、中位數 ≈ 5.5 年。）

怎麼解讀：

- **規則是為了「估計機率密度」設計的，不是為了溝通。** NIST 寫明分組「可以由使用者任意決定，也可以用系統化規則」（[NIST e-Handbook：Histogram](https://www.itl.nist.gov/div898/handbook/eda/section3/histogra.htm)）。NumPy 文件也提醒：Sturges「只對常態資料最佳」；FD 與 Scott「對小資料集可能太保守」（[NumPy](https://numpy.org/doc/stable/reference/generated/numpy.histogram_bin_edges.html)）。這份資料不是常態分布（5 年與 8 年各有一個高點），也只有 135 筆，屬於「小資料集」。
- **NumPy 預設的 `auto`** 取 Sturges 與 FD 兩者中較窄的寬度，小資料通常會選到 Sturges（[NumPy](https://numpy.org/doc/stable/reference/generated/numpy.histogram_bin_edges.html)）。套到這裡約 9 格、每格約 1.2 年。1.2 年這種寬度讀者難以理解，所以實務上會取整數年。
- NumPy 也註明整數資料的格寬「不會小於 1」（同上）。「滿幾年」是整數，所以**每年一格就是這個尺度下最細的分組**。

### 1.2 等寬、不等寬、開放末端

**等寬是預設。** NIST 對直方圖的描述就是「把資料範圍切成等寬的格子」（[NIST](https://www.itl.nist.gov/div898/handbook/eda/section3/histogra.htm)）。ONS 的人口金字塔規範寫明「All age bands must be the same size」，並要求「Use the most detailed level available in the data」（[ONS：Population pyramid](https://service-manual.ons.gov.uk/data-visualisation/chart-types/population-pyramid)）。

**不等寬分組要畫面積，不是高度。** 縱軸要用「頻率密度＝隻數 ÷ 格寬」，每根長條的面積才會等於隻數（[OpenLearn（英國開放大學）：Frequency density](https://www.open.edu/openlearn/science-maths-technology/data-analysis-visualisations-excel/content-section-4.4)；NIST 的第二種正規化「隻數 ÷（總數 × 格寬）」也是同一個道理，見 [NIST](https://www.itl.nist.gov/div898/handbook/eda/section3/histogra.htm)）。OpenLearn 的說明是：沒有做這一步，較寬的格子會因為涵蓋的範圍大而看起來比較多。

套到現行 7 格【推論】：「3–5 年」是 2 年寬，如果畫成跟「1–2 年」同寬、高度直接寫隻數，看起來會比實際每年的密度高一倍。改用密度畫雖然正確，但縱軸會變成「每年幾隻」，對志工來說不直觀，而且長條上方的數字（隻數）和長條高度（密度）會對不起來。**不等寬分組在一般讀者的圖上很難同時做到正確又好讀，這也是為什麼建議回到等寬。**

**開放末端（例如「10 年以上」）**：我找不到官方設計系統對「直方圖最後一格開放」的畫法規範。能找到的說法是：開放的格子沒有寬度，算平均或畫密度時都要先假設一個上限，常見做法是假設和前一格同寬，但這在很多實際情況下不是好的猜測【二手來源】（[The Math Doctors：Grouped Data: Open-ended Classes?](https://www.themathdoctors.org/grouped-data-open-ended-classes/)）。實務上的標示寫法：
- 標籤用「11+」或「11 年以上」，讓讀者一眼看出沒有上限【推論】。
- 無障礙名稱寫完整句「滿 11 年以上，N 隻」；Apple HIG 要求「避免容易混淆的格式與縮寫」（[Apple HIG：Charts](https://developer.apple.com/design/human-interface-guidelines/charts)）。
- 開放格子只在尾端資料很稀少、或上限會一直變動時才值得用；最大值已知且隻數不少時，用等寬格子畫到底就好【推論】。

---

## 2. 手機上長條數量與標籤

### 2.1 最多放幾根

**我找不到任何權威來源給出「手機最多 N 根」的數字。** 有寫的都是條件式建議：

- 英國政府 Government Analysis Function：「類別很多或類別名稱太長、放不進直條下方時，用橫條圖」；軸標籤一律用水平文字，「直的或斜的文字很難讀」；標籤放不下時可以把圖轉向，或換單位（[Analysis Function：Data visualisation: charts，Bar charts §8 與 Formatting §6](https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-charts/#section-8)）。同一份指南建議分布圖「用窄長條、小間距」，以及「長條間距要比長條本身窄」。
- Datawrapper（Lisa Charlotte Muth，2025-06-16）：30 根的直條圖在桌機上可能好看，「一縮到手機寬度，標籤就開始重疊（或被轉成斜的）」，橫條圖「通常是小螢幕比較安全的選擇」，因為它往下長而不是往右長（[Datawrapper：A friendly guide to choosing a chart type](https://www.datawrapper.de/blog/chart-types-guide)）。
- SAP Fiori（column micro chart）：只有容器寬到能放下最少根數、且每根長條至少跟標籤一樣寬時，才顯示每根的標籤，否則自動退回只顯示頭尾標籤【二手來源：搜尋摘要，SAP 頁面回 403 無法開啟全文】（[SAP Fiori：Column Micro Chart](https://www.sap.com/design-system/fiori-design-web/v1-139/ui-elements/column-micro-chart/usage)）。
- Apple HIG：「在窄小環境中，把繪圖區寬度放到最大」（[Apple HIG：Charts](https://developer.apple.com/design/human-interface-guidelines/charts)）。

本專案換算【推論，假設左右頁邊距各 16px、卡片內距各 16px】：390px 寬扣掉後約剩 326px 可畫圖。

| 根數 | 每根欄寬（含間距） | 「0」～「11」數字標籤（13px 字）放得下嗎 |
|---|---|---|
| 6（兩年一格） | 約 54px | 放得下，還能寫「0–1」這種範圍 |
| 10 | 約 33px | 兩位數放得下 |
| 12（每年一格到 11） | 約 27px | 兩位數（約 16px）放得下，範圍寫法放不下 |

所以 12 根在文字面上可行，前提是標籤只寫一個數字。

### 2.2 標籤寫不下時的常見做法

| 做法 | 來源 | 適合本專案嗎 |
|---|---|---|
| 縮短標籤、單位移到軸標題或圖的標題 | Apple HIG：可以把單位寫在圖的其他地方（例如標題），縱軸標籤「盡量短但不失清楚」（[Charts](https://developer.apple.com/design/human-interface-guidelines/charts)）；GAF：所有軸都要清楚標示（[§6](https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-charts/#section-6)） | 適合：標籤寫「0 1 2 … 11」，軸標題寫「滿幾年」 |
| 只標部分刻度（例如 0、5、10） | SAP 的退回做法（見上）；Apple HIG 建議刻度用「熟悉的數列」 | 只有在可以點選時不適合：每根都要讓人知道點的是哪一年【推論】 |
| 文字轉斜或轉直 | GAF 明確反對（[§6](https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-charts/#section-6)） | 不採用 |
| 轉成橫條圖 | GAF、Datawrapper（見 2.1） | 可行的替代方案，見 2.3 |

### 2.3 橫條圖還是直條圖

- **直條的好處**：「時間長短」是連續數值，直方圖慣例是橫軸放數值、長條緊鄰排列（[FT Visual Vocabulary：Distribution / Histogram](https://github.com/Financial-Times/chart-doctor/blob/main/visual-vocabulary/README.md)：直方圖是「呈現統計分布的標準方式」，欄與欄的間距要小，形狀才明顯）。ONS 對時間序列也建議用直條（[ONS：Bar charts](https://service-manual.ons.gov.uk/data-visualisation/chart-types/bar-charts)）。
- **橫條的好處**：每列可以滿版寬，標籤放得下完整文字（「滿 5 年」），每列高度也容易做到 44～48px 的點擊範圍（見 3.3）；GAF 與 Datawrapper 都說類別多時橫條在手機上比較安全（見 2.1）。
- **取捨【推論】**：12 列 × 44px ≈ 530px，大約佔掉 iPhone 一整個畫面高度，分布的「形狀」也比較不像直方圖。這頁的主要任務是「找住很久的狗」而不是精確比較長條，直條＋整欄可點，已經能同時顧到形狀與點選。

---

## 3. 點長條看名單（drill-down）

### 3.1 明細放在哪裡

- Apple HIG：「在合理的地方讓人與資料互動，但**不要把關鍵資訊藏在互動後面**」（[Apple HIG：Charts](https://developer.apple.com/design/human-interface-guidelines/charts)）。
- SAP Fiori（Android 圖表）：點橫條後，該筆的確切數值顯示在圖表的摘要區【二手來源：搜尋摘要，SAP 頁面回 403】（[SAP Fiori for Android：Chart types](https://www.sap.com/design-system/fiori-design-android/v26-4/patterns/charts/chart-types/usage)）。
- 「在圖的正下方展開名單」沒有找到明文規範；它的語意跟 WAI-ARIA 的「Disclosure（展開／收合）」相同：一個按鈕控制一段內容的顯示與隱藏（[WAI-ARIA APG：Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)）。放在圖下方、用小箭頭指向選中的長條，是合理的做法【推論】。

### 3.2 選中狀態：其他長條要多淡

- SAP Fiori（Android）：「選了一組資料時，其他長條會變淡；再點一次選中的那組就取消」【二手來源：搜尋摘要】（[SAP Fiori for Android：Chart types](https://www.sap.com/design-system/fiori-design-android/v26-4/patterns/charts/chart-types/usage)）。
- Datawrapper（Muth，2023-07-24）：淡化的類別建議用灰色或降低飽和度；也可以用同色系的淡色，讓整張圖維持單一色相；降低不透明度通常比只降飽和度好看；並明說「犧牲灰色類別的一些可讀性，換來重點的清楚」（[Datawrapper：Emphasize with color](https://www.datawrapper.de/blog/emphasize-with-color-in-data-visualizations)）。文章沒有給數字門檻。
- **WCAG 2.2 SC 1.4.11 非文字對比**：「理解內容所需」的圖形要跟相鄰顏色有 3:1；但**如果同樣資訊已經用文字標籤或數值呈現，圖形就不在這條的要求範圍內**（Understanding 文件的圓餅圖例子：有標籤和數值時，扇形就不需要 3:1）。互動圖表的預設狀態本身就要有足夠對比，hover／focus 只能用來補充資訊（[Understanding SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)）。
- 同一份文件也說：表示「已選取」等狀態所需的視覺資訊，要跟相鄰顏色有 3:1（同上）。
- **WCAG 2.2 SC 1.4.1 色彩使用**：顏色不能是唯一的視覺手段；亮度差達 3:1 可以算額外的視覺區別（[Understanding SC 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)）。

套到示意圖 `stats-tap3.cjs` 的顏色（我用 WCAG 相對亮度公式算）：

| 組合 | 對比 |
|---|---|
| 未選中 `#8FB5A6` vs 白底 | 2.25:1 |
| 選中 `--shell` `#1F5C4D` vs 白底 | 7.79:1 |
| 選中 `#1F5C4D` vs 未選中 `#8FB5A6` | 3.46:1 |
| 若把未選中加深到 `#6E9A89`：vs 白底 | 3.16:1 |
| 　同上：選中 vs 未選中 | 2.47:1 |

【推論】每根長條上方都印隻數時，未選中用 `#8FB5A6`（2.25:1）符合 1.4.11，高低也還看得出來；如果硬把未選中加深到 3:1 以上，選中和未選中之間反而掉到 3:1 以下，兩者有取捨。示意圖的選中狀態除了顏色，還有數字反白、標籤加粗、箭頭指向，已經不只靠顏色，符合 1.4.1。**數字一定要留著**，拿掉數字後未選中的長條就要回到 3:1。

### 3.3 點擊範圍

| 來源 | 要求 |
|---|---|
| WCAG 2.2 SC 2.5.8 Target Size (Minimum)，AA | 至少 24×24 CSS px；或以目標為中心畫直徑 24px 的圓，碰不到其他目標也算過。例外包括「同頁另有符合大小的等效控制項」，以及目標必須密集的互動資料圖表（[Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)） |
| WCAG 2.2 SC 2.5.5 Target Size (Enhanced)，AAA | 至少 44×44 CSS px（[Understanding 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)） |
| Apple HIG | iOS 控制項預設 44×44 pt、最小 28×28 pt；沒有外框的元素，周圍留約 24 pt（[Apple HIG：Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)）。圖表的標記太小時，可以把點擊範圍擴大到整個繪圖區，讓人沿著滑動來看各個數值（[Apple HIG：Charts](https://developer.apple.com/design/human-interface-guidelines/charts)） |
| Material／Android | 觸控目標至少 48×48 dp（[Android Developers：Make apps more accessible](https://developer.android.com/guide/topics/ui/accessibility/apps)；[Material 1：Accessibility](https://m1.material.io/usability/accessibility.html)；M3 現行頁面 [Accessibility designing](https://m3.material.io/foundations/designing/structure) 需要 JavaScript，讀不到全文） |

【推論】點擊範圍的高度可以用整欄（上方空白＋長條＋標籤），所以真正卡住的是**寬度**：12 根約 27px，過 24px（AA），不到 44／48；6 根約 54px，全部過。

### 3.4 鍵盤與螢幕閱讀器

- 每根可點的長條要是按鈕；切換型按鈕用 `aria-pressed` 表示狀態，Space 與 Enter 都要能觸發，而且**狀態改變時標籤不能跟著改**（[WAI-ARIA APG：Button](https://www.w3.org/WAI/ARIA/apg/patterns/button/)）。如果當成「展開下方名單」，則用 `aria-expanded`（`aria-controls` 可選）（[APG：Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)）。
- Apple HIG：圖表通常需要「每個重要或可互動的元素各有一個無障礙標籤」；要說明圖的類型、各軸代表什麼與上下限；描述「代表什麼」而不是「看起來怎樣」；**把畫面上的軸與刻度文字從輔助科技隱藏**，避免重複朗讀；要能用鍵盤（含全鍵盤操作）與切換控制操作（[Apple HIG：Charts](https://developer.apple.com/design/human-interface-guidelines/charts)）。
- W3C WAI 複雜圖片教學：圖表要有「短描述＋長描述」兩部分；長描述可以用 `<figure>` 包住，裡面放標題、文字與表格（[WAI：Complex Images](https://www.w3.org/WAI/tutorials/images/complex/)）。

---

## 4. 套到本專案

> 本節除了明確附來源的句子，全部都是【推論】。

### 4.1 分組

**建議：每年一格，0～11 年共 12 根，等寬，高度＝隻數。**

- 12 格落在平方根（12）與 Rice（11）規則的範圍內（1.1 節），也符合「等寬、用最細層級」的官方慣例（ONS，1.2 節）。
- 志工要找的是「住很久的狗」：每年一格才看得出 5 年與 8 年兩個高點，點「8」或「9」就能直接拿到最久那群；兩年一格會把 8–9 年、10–11 年各併成一根，最久的那幾隻被稀釋。
- 10、11 年那兩根大概只有個位數，很矮，但仍然點得到，名單也會出來。
- 如果以後有狗超過 11 年：固定 12 根，最後一根改成開放末端「11+」（無障礙名稱「滿 11 年以上」）。不建議讓根數跟著資料最大值變動，免得每次打開圖的樣子都不一樣。

**替代方案：兩年一格（6 根）。** 寬度約 54px，Apple／Material 的點擊範圍都過，也接近 FD／Scott 的建議寬度；代價是細節變少。如果 K 很在意「手指好點」勝過「看出哪一年」，選這個。

**不建議：保留現行 7 格的不等寬分組**（1.2 節），除非改畫頻率密度，但那樣縱軸不直觀。

### 4.2 標籤

- 長條下方只寫數字「0」～「11」，水平擺放，不轉斜（GAF）。
- 軸標題寫「滿幾年」，並把 0 說清楚，例如圖下方小字「0 = 未滿 1 年」；Apple HIG 要求避免容易混淆的縮寫（2.2 節）。
- 每根上方保留隻數（這是 4.3 能用淺色的前提）。

### 4.3 選中與未選中

- 示意圖的 `#1F5C4D`（選中）／`#8FB5A6`（未選中）可以維持：選中與未選中之間 3.46:1，加上數字反白、標籤加粗與箭頭，不只靠顏色。
- 未選中的長條不要再淡過 `#8FB5A6`；它對白底只有 2.25:1，能成立是因為上方有數字。
- 沒有任何長條被選中時，全部用同一個正常色（例如 `--shell`），不要用由淺到深的漸層：漸層只是重複表達「越右越久」，還會讓左邊幾根在預設狀態就低於 3:1（現行藍色漸層最淺的 `#CFE0FA` 對白底只有 1.34:1）。
- 再點一次選中的長條就取消選取（SAP 慣例），「收起」按鈕保留。

### 4.4 點擊範圍

- 整欄當按鈕（上方空白＋長條＋數字＋下方標籤），不要只有長條本身可點；矮長條（10、11 年）才點得到。
- 欄與欄之間不要留不可點的空隙，讓每根的點擊範圍連在一起（12 根各約 27px，過 WCAG 2.5.8 AA）。
- 下方名單每列已是 `min-height: 44px`（`stats-tap3.cjs:17`），符合 Apple 預設，保留。
- 頁面上已經有「最久的狗」名單（`analysis.js` 的 `longestStay`），等於「不需要點也看得到關鍵資訊」（Apple HIG，3.1 節），保留它。

### 4.5 可及性要補的

現行 `columnChart` 是 `<div>` 加 `title`（`public/js/analysis.js:243-251`），手機上 `title` 看不到，也不能用鍵盤操作。實作時要補：

1. 每欄改成 `<button type="button">`，加 `aria-pressed`（或 `aria-expanded` + `aria-controls` 指向下方名單）；無障礙名稱寫完整句，例如「滿 5 年，18 隻」，選中與否不改名稱（APG）。
2. 欄內的數字與標籤文字對輔助科技隱藏（`aria-hidden="true"`），改由按鈕名稱朗讀，避免念兩次（Apple HIG）。
3. 整張圖用 `<figure>` 包起來，`<figcaption>` 寫一句摘要，例如「在所 135 隻依滿幾年分組；約一半滿 5 年以上，最多的是滿 8 年」（WAI Complex Images）。
4. 選取後焦點留在按鈕上，不要自動跳走；名單區塊開頭放標題（例如「滿 8 年・19 隻」），讓螢幕閱讀器使用者往下就讀得到。
5. 鍵盤：Tab 依序到每一欄，Enter／Space 切換（APG）。12 個 Tab 停留點偏多，可以考慮改成一個 Tab 停留點、用左右方向鍵切換，但這比較複雜，先不做也合規。

---

## 5. 方法與限制

- **方法**：用 WebFetch／WebSearch 讀官方文件與規範原文；分組規則數字以 Node 腳本計算；對比用 WCAG 相對亮度公式計算；專案現況只讀了 `public/js/analysis.js` 的分組與 `columnChart`，以及示意圖腳本 `docs/design/unify-other-pages/scripts/stats-tap3.cjs` 的顏色。
- **資料不一致**：K 給的各年隻數加總是 115，不是 135；差的 20 隻推測是編號看不出入所日、沒進分布。表格兩種 n 都算了，結論不變。各年隻數只用編號日期算，加上出入所紀錄後會變（最久到 11 年）。
- **分位數是約略值**：每年格子內的隻數假設平均分布，IQR 與標準差只能當量級參考。
- **讀不到全文的來源**：SAP Fiori 頁面回 HTTP 403，相關引文來自搜尋摘要，已標【二手來源】。Material 2／3 的資料視覺化與 M3 無障礙頁面需要 JavaScript，讀不到，點擊範圍改引 Android Developers 與 Material 1。Sturges（1926）與 Freedman–Diaconis（1981）原文在付費牆後，公式以 R 與 NumPy 官方文件（直接引用原文）為準。IBM Carbon 的 histogram、axes 頁面沒有和本題相關的文字規範，所以沒有引用。
- **沒有找到的東西**：權威來源對「手機上最多幾根直條」、「未選中長條要淡到多少」都沒有給數字；本筆記的根數與顏色建議是依 WCAG 的對比與點擊範圍下限推算的。
- **沒有做的事**：沒有在真機或 Playwright 量實際欄寬；第 2.1 節的欄寬是假設頁邊距與卡片內距各 16px 推算的，實作前要用實際 CSS 量一次。

## 後續（2026-10-28，研究完成後）

- **資料更正**：上面用的各年隻數只看編號日期。改用網站同樣的算法（編號、舊編號、出入所紀錄取最早）重查正式庫：在所 **115 隻**，全部看得出入所日；滿 0 年 4、1 年 11、2 年 10、3 年 11、4 年 11、5 年 18、6 年 11、7 年 14、8 年 15、9 年 6、10 年 2、11 年 2。「在所總數 135」是之前算錯，以 115 為準。
- **K 的決定**：狗多半住到過世，年數會一直變多，所以選「滿 0～9 年每年一格＋最後一根 10+」，固定 11 根（`docs/design/unify-other-pages/3h-分組-0到9每年加10年以上.png`），不採本筆記「套到本專案」建議的「每年一格到 11」。11 根在 §2.1 的假設下每根約 30px，仍過 WCAG 2.5.8 的 24px 下限。
