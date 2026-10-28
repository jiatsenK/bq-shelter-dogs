# 常溜狗群清單：列高、密度與「整群溜了、少數例外」（2026-10-28）

2026-10-28（台灣時間）。問題（K）：「常溜狗群」一頁列出一群 2～10 隻狗（正式資料 11 群，大小 10、8、8、8、7、6、5、5、4、2、2）。每列：沒溜天數色塊（寬 68px）、照片 44px、名字 19px＋性別圖示＋籠位 16px，列高 56px。清單下方一個主要按鈕「整群溜了」、一個文字連結「有狗沒溜」（進入點選排除模式）。K 覺得 56px 還是「有點擠」、看久眼睛累，例外流程也不順。已做一版示意：每列一個勾選框，預設全勾，取消勾選例外，按鈕變成「溜了 N 隻」。限制：390×844 畫面，底部分頁列約 60px，頁首＋搜尋欄約 260px；點擊範圍至少 44px、間距至少 8px。使用情境是單手拿手機、另一手牽狗。

只讀研究，沒有改產品程式、沒有 commit、沒有開瀏覽器。外部說法都附第一手連結；標「【推論】」的是我依來源推出來、還沒實測的；標「【二手來源】」的是找不到第一手原文、只能引用轉述的。

---

## 摘要

1. **列高**：Material 3 的清單項目高度是一行 56dp、兩行 72dp、三行 88dp，左右內距 16dp，前置圖片 56dp、頭像 40dp（[androidx `ListTokens.kt`](https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/ListTokens.kt)）。現在的列是「一行版高度（56px）塞了兩行份量的資訊」，擠的感覺主要來自這裡，不是單純高度不夠。
2. **「全部完成、少數例外」**：點名系統的主流做法就是「先全部標出席，再改缺席的人」，有的系統甚至預設全員出席（Canvas、MySchoolWorx、Teacher app，見 2.1）。每列勾選框、預設全勾，是有前例的做法。
3. **滑動操作不適合**：NN/g 實測發現大多數使用者發現不了滑動手勢，建議只用在刪除類動作（[NN/g：Contextual Swipe](https://www.nngroup.com/articles/contextual-swipe/)）。
4. **防呆**：日常、可復原的動作不要跳確認對話框，改給醒目的「復原」（[NN/g：Confirmation Dialogs](https://www.nngroup.com/articles/confirmation-dialog/)）。
5. **按鈕位置**：Hoober 2017 年的觀察研究修正了 2013 年的「拇指熱區」圖：人最常點、也點得最準的是畫面中間，邊緣與角落需要更大的目標（[UXmatters 2017](https://www.uxmatters.com/mt/archives/2017/03/design-for-fingers-touch-and-people-part-1.php)）。主要按鈕放在清單正下方（中間偏下）比貼在角落好。

**建議（本專案）**：列高改 64～72px，名字一行、籠位與天數放第二行（兩行版版面）；採用每列勾選、預設全勾、按鈕寫「溜了 N 隻」；送出後給「復原」，不跳確認。細節與取捨見第 4 節。

---

## 1. 列高與密度

### 1.1 各家規範的數字

| 來源 | 數字 |
|---|---|
| Material 3（Compose 元件 token，VERSION 29.0.0） | 一行 56dp、兩行 72dp、三行 88dp；前置頭像 40dp、前置圖片 56×56dp；左右內距各 16dp；分隔線左右內縮 16dp、上下 0（[ListTokens.kt](https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/ListTokens.kt)） |
| Material Web（`md-list-item` 預設 token） | 頭像 40px、前置圖片 56×56px；標題字型用 `label-large`、輔助文字用 `body-medium`（[material-web list.md](https://raw.githubusercontent.com/material-components/material-web/main/docs/components/list.md)） |
| Apple HIG：Accessibility | iOS 控制項預設 44×44pt、最小 28×28pt；有外框的元素周圍約留 12pt，沒外框的約 24pt；iOS 內文預設 17pt、最小 11pt（[HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)，以 [JSON 版](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json) 讀取） |
| Apple HIG：Lists and tables | 沒有給列高數字；只說「讓列的文字簡短，讀起來才舒服」，文字很多時改成只列標題、點進去看細節（[HIG Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)，以 [JSON 版](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/lists-and-tables.json) 讀取） |
| Android Developers | 互動元素觸控範圍至少 48×48dp，「越大越好」；內建 `ListItem` 已自動符合（[Make apps more accessible](https://developer.android.com/guide/topics/ui/accessibility/apps)） |
| WCAG 2.2 | 2.5.8（AA）至少 24×24 CSS px，或以中心畫 24px 圓不碰到其他目標；2.5.5（AAA）44×44 CSS px，並建議常用、不易復原、靠近螢幕邊緣的控制項用更大目標，受益者包含單手操作與在晃動環境使用的人（[2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)、[2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)） |

讀不到的：m3.material.io 的 Lists specs 與 m2.material.io 的 density 頁面需要 JavaScript，WebFetch 拿不到內文，所以 M3 數字改引官方 Compose 元件原始碼裡的設計 token。「iOS 預設列高 44pt」在 HIG 現行文字裡找不到明文，只有「控制項 44×44pt」，本筆記不把它當列高規範引用。

### 1.2 什麼讓清單感覺擠【推論，依上表】

把現行一列拆開看（390px 寬）：

| 項目 | 現行 | M3 對照 |
|---|---|---|
| 列高 | 56px | 一行 56dp；**但現行一列裡有名字、性別、籠位、天數四種資訊**，份量接近兩行（72dp） |
| 前置元素 | 色塊 68px＋照片 44px，兩個前置元素 | M3 只有一個前置元素（頭像 40 或圖片 56） |
| 文字 | 名字 19px＋籠位 16px 擠在同一行 | 標題一行、輔助文字另一行 |
| 左右內距 | 依實作 | 16dp |

橫向估算：16（內距）＋68（色塊）＋12＋44（照片）＋12＝152px，剩約 222px 給名字＋性別＋籠位＋右內距；再加一個 24px 勾選框和間距，只剩約 180px。**擠的感覺有一半是橫向的**：兩個前置元素加上一行塞三種文字。只把列高加大，橫向的擁擠不會消失。

能讓清單變鬆的四個槓桿，依效果排序：

1. **一行改兩行**：名字（主要）一行、籠位＋天數（次要）一行，符合 M3 兩行版 72dp 的結構，也符合 HIG「文字簡短」的方向。
2. **減少前置元素**：天數色塊從 68px 寬的獨立欄，改成第二行的小標籤或照片角落的徽章，橫向可省 60～80px。
3. **列高**：56 → 64～72px，上下各多 4～8px 留白。
4. **分隔線**：M3 的分隔線左右內縮 16dp、不貼滿；有了足夠留白就可以拿掉粗分隔線或底色交錯，減少視覺雜訊。

字級不建議縮：iOS 內文預設 17pt（HIG），名字 19px 適合邊走邊看。

---

## 2. 「整群完成、少數例外」的做法

### 2.1 實際產品怎麼做

| 產品 | 做法 | 來源 |
|---|---|---|
| Canvas 點名（University of Dayton 說明頁） | 建議先用「Mark all displayed students as… Present」全標出席，再逐一改缺席；狀態點了就自動存 | [Taking attendance](https://help.col.udayton.edu/attendance/taking-attendance/) |
| 某校的 Teacher app（Tacoma CC 說明頁，未寫 app 名） | 「Mark All as Present」按鈕；標過一位後，按鈕變成「Mark Remaining as Present」，只標還沒標的人 | [Tacoma CC KB](https://tacomacc.teamdynamix.com/TDClient/1903/Portal/KB/PrintArticle?ID=48291) |
| MySchoolWorx | 學生**預設就是出席**（綠色），只要點缺席的人改狀態再送出 | [Taking Attendance](https://support.myschoolworx.com/article/73-taking-attendance) |
| Apple 提醒事項（Mac） | 多選後按其中一個的完成鈕即全部完成；完成的可以再取消勾選（復原） | [Mark reminders as completed](https://support.apple.com/guide/reminders/mark-reminders-as-completed-remndbeda47c/mac) |
| Google Keep | 找不到官方說明頁（help 網址 404）；只有轉述說清單的 ⋮ 選單有「取消勾選所有項目」【二手來源】 | [Jeff Su newsletter 175](https://www.jeffsu.org/newsletter-175/) |

點名情境和本專案最像：名單固定、大多數人都「是」、少數例外。「預設全勾、取消例外」對應 MySchoolWorx 的預設出席；「整群溜了＋有狗沒溜」的現行做法對應 Canvas 的「先全標、再改」，但本專案把兩步拆成兩個模式。

### 2.2 各做法比較

| 做法 | 優點 | 缺點 |
|---|---|---|
| A. 每列勾選框、預設全勾，按鈕顯示「溜了 N 隻」（示意版） | 一個畫面完成；送出前就看得到哪幾隻不算；按鈕上的數字就是確認 | 預設全勾有「沒看就送出」的風險；每列多一個控制項，橫向更擠（見 1.2） |
| B. 主要按鈕「整群溜了」＋次要「有狗沒溜」進入排除模式（現行） | 最常見情況一鍵完成 | 例外要先切模式，多一步；模式切換後畫面狀態不明顯（K 回報不順） |
| C. 「整群溜了」後立刻在原清單上逐隻取消（先做再改，類似 Teacher app 的 Mark Remaining） | 常見情況最快；例外也在同一畫面 | 已經寫入資料，取消要能逐筆復原 |
| D. 滑動列來排除 | 不佔畫面空間 | NN/g：缺少提示，「大多數使用者不會發現這些動作」；建議滑動只用在刪除類動作（[Contextual Swipe](https://www.nngroup.com/articles/contextual-swipe/)）。單手牽狗時橫滑也容易誤觸【推論】 |

NN/g 對勾選框的要求（[Checkboxes vs. Radio Buttons](https://www.nngroup.com/articles/checkboxes-vs-radio-buttons/)）：一行一個選項、垂直排列；標籤用正面說法，避免否定句，讓人清楚勾和不勾分別會發生什麼。文中「預設不勾」的建議是針對同意行銷信這類需要使用者主動選擇的情況；點名式「預設出席」是反映最常見的實際狀態，兩者情境不同【推論】。套到本專案：勾選代表「溜了」（正面），按鈕寫「溜了 N 隻」，不要寫「排除 N 隻」。

### 2.3 防呆：確認還是復原

- NN/g：確認對話框只留給嚴重、不可逆的動作；常規動作加確認只會增加阻力，而且太常出現會讓人養成不看就按的習慣。能做復原時，復原是更好的保護（[Confirmation Dialogs](https://www.nngroup.com/articles/confirmation-dialog/)）。
- NN/g（滑動那篇）：重複性任務若每次確認太煩，就提供「在畫面上很醒目」的復原（[Contextual Swipe](https://www.nngroup.com/articles/contextual-swipe/)）。
- WCAG 2.5.5 的理解文件也建議，不易復原的動作要用更大的點擊範圍（[2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)）。

【推論】登記溜狗一天會做好幾次，屬於常規動作，而且資料可以刪；用「送出後顯示可復原的提示」比跳確認視窗合適。按鈕上的「溜了 N 隻」本身就是送出前的最後確認。

---

## 3. 主要按鈕放哪裡（單手）

### 3.1 拇指與點擊準確度的研究

- Hoober 2013（1,333 次街頭觀察，其中 780 人在觸控螢幕）：單手 49%、一手托一手點 36%、雙手 15%；單手中右手拇指 67%（[UXmatters 2013](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)）。**常被轉載的「拇指熱區」彩色圖出自這篇，但作者本人在 2017 年的留言說那張圖不準、應該忽略，後續研究發現人最常點的是畫面中間**（同頁留言）。
- Hoober 2017：人偏好看、也偏好點畫面中間，中間點得最準；中間目標約 7mm 就能涵蓋 95% 的點擊，角落要約 12mm。建議主要內容放中間，次要動作（分頁、撰寫、搜尋）放上下邊緣，危險動作離其他控制項遠一點（[UXmatters 2017](https://www.uxmatters.com/mt/archives/2017/03/design-for-fingers-touch-and-people-part-1.php)）。

【推論】「越靠下越好按」不是可靠的規則；更可靠的是「目標要大、離螢幕邊緣與角落遠一點、跟其他按鈕隔開」。390×844 的手機單手時，畫面中下段（大約 y 400～700px）是拇指最舒服的範圍。

### 3.2 平台規範

- Apple HIG Buttons：最可能的動作用醒目樣式；每個畫面醒目按鈕「一到兩個」；按鈕點擊範圍至少 44×44pt（[Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)，以 [JSON 版](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/buttons.json) 讀取）。
- Apple HIG Toolbars：工具列在畫面上緣或下緣；「謹慎挑選項目，避免擁擠」；只指定一個主要動作（[Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)，以 [JSON 版](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/toolbars.json) 讀取）。
- Android：FAB 是「單一、聚焦、最常見路徑」的高強調按鈕，通常固定在右下角（[Compose FAB](https://developer.android.com/develop/ui/compose/components/fab)）。M3 的 FAB／底部列規格頁需要 JavaScript，讀不到。

### 3.3 浮動條的代價【推論】

- 固定在底部的按鈕列會和分頁列（60px）疊在一起，等於底部被吃掉 120～130px；在 524px 可用高度裡（844－260－60）佔掉約四分之一。
- 右下角 FAB 落在 Hoober 說的「角落、要更大目標」區域，而且會蓋住清單最後一列右側。
- 本專案一半以上的群（6 / 11 群）只有 2～6 隻，清單本身就放得下，固定浮條沒有必要；只有 7～10 隻的群才可能需要捲動。

---

## 4. 套到本專案

> 本節除了明確附來源的句子，全部都是【推論】。

### 4.1 高度預算

可用高度 844－260（頁首＋搜尋）－60（分頁列）＝ **524px**。按鈕區（48px 按鈕＋上下留白）約 72px，清單約剩 450px。

| 列高 | 一畫面放得下幾列 | 不用捲動的群（11 群中） |
|---|---|---|
| 56px（現行） | 8 | 9 群（10 隻那群要捲） |
| 64px | 7 | 8 群（7 隻以下） |
| 72px（M3 兩行） | 6 | 6 群（6 隻以下） |

捲動本身不是問題：Apple HIG 只要求文字簡短、列表好讀，沒有要求一頁放完。真正要避免的是**捲動後看不到送出按鈕、也不知道下面還有幾隻**。所以只要 (1) 標題顯示「共 N 隻」，(2) 清單超出時按鈕才固定在分頁列上方，就可以接受 7～10 隻的群要捲一小段。

### 4.2 建議

1. **列高 64～72px，改兩行版面**：第一行名字（19px）＋性別圖示；第二行籠位＋沒溜天數（16px）。天數色塊從 68px 寬獨立欄縮成第二行的小標籤（保留顏色、加文字，不只靠顏色）。橫向多出約 60px，正好放勾選框。偏好看得多選 64px，偏好舒服選 72px（M3 兩行標準）。
2. **採用每列勾選、預設全勾**（示意版）：有點名系統的前例（2.1）。整列都是點擊範圍（不是只有 24px 的框），勾選框放右側、靠近右手拇指，符合 M3 至少 48dp、Apple 44pt。按鈕文字跟著變「溜了 N 隻」；全部取消時按鈕停用。
3. **拿掉「有狗沒溜」模式**：勾選已經涵蓋例外，不用再切模式。
4. **按鈕緊接在清單後**；清單超出可視範圍時才改成固定在分頁列上方，用實心底色、細上邊線，不加大陰影卡片。
5. **送出後不確認，給「復原」提示**（停留數秒、按鈕夠大），對應 NN/g 對常規動作的建議。
6. **不用滑動手勢**。

### 4.3 取捨

| 選擇 | 得到 | 付出 |
|---|---|---|
| 72px 兩行 | 最鬆、符合 M3 標準 | 7 隻以上的群要捲動 |
| 64px 兩行 | 8 / 11 群一頁看完 | 留白較少，可能仍覺得略擠 |
| 預設全勾 | 最常見情況仍是一鍵 | 沒看清就送出的風險；靠按鈕上的「N 隻」與復原兜底 |
| 預設全不勾（逐隻勾） | 不會誤登記 | 每次要點 2～10 下，違背「整群溜」的主要情境 |
| 保留現行兩模式 | 不用改架構 | K 已回報例外流程不順 |

---

## 5. 方法與限制

- **方法**：WebFetch／WebSearch 讀官方文件與研究原文；Apple HIG 頁面需要 JavaScript，改讀同網址的 JSON 版（`developer.apple.com/tutorials/data/design/...json`）。高度預算用 K 給的尺寸手算，沒有量實際 CSS。
- **讀不到全文**：m3.material.io（Lists specs、FAB、density）與 m2.material.io（Lists、Applying density）需要 JavaScript；M3 數字改用 androidx 官方原始碼的設計 token。Google Keep 說明頁網址 404，相關說法只能引用轉述。Apple 提醒事項 iPhone 版找不到官方「全部完成」說明；Mac 版說明頁只寫多選後完成。
- **沒找到的東西**：權威來源沒有給「清單一頁最多幾列」或「列高多少才不擠」的數字；NN/g 沒有找到專談清單密度或拇指熱區的原文（搜尋只出現轉述網站，不引用）。
- **沒有做的事**：沒在真機或 Playwright 量橫向寬度；1.2 節的橫向估算假設內距 16px、元素間距 12px，實作前要用實際 CSS 量一次。
