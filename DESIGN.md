---
name: 板收志工溜狗表
description: 志工單手用的溜狗清單；目前視覺「病歷夾色籤」的快照，不是定案
colors:
  shell: "#1F5C4D"
  shell-deep: "#174538"
  shell-soft: "#B5CFC4"
  primary: "#1F5C4D"
  primary-soft: "#DDE9E3"
  bg: "#E3E9E5"
  surface: "#FFFFFF"
  surface-soft: "#EEF2EF"
  ink: "#16211D"
  ink-soft: "#4E5E57"
  line: "#C4CFC9"
  tab-red: "#C8202B"
  tab-amber: "#F2B21B"
  tab-muted: "#6B756F"
  green-text: "#1E6B3C"
  green-bg: "#DFF0E4"
  red-text: "#B3121F"
  red-bg: "#FBE3E4"
  amber-text: "#8A4B00"
  z-new-ink: "#1F6464"
typography:
  headline:
    fontFamily: "-apple-system, 'PingFang TC', 'Noto Sans TC', 'Noto Sans CJK TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.04em"
  title:
    fontFamily: "-apple-system, 'PingFang TC', 'Noto Sans TC', 'Noto Sans CJK TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
  day-value:
    fontFamily: "-apple-system, 'PingFang TC', 'Noto Sans TC', 'Noto Sans CJK TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "17px"
    fontWeight: 800
    lineHeight: 1.3
    fontFeature: "tnum"
  body:
    fontFamily: "-apple-system, 'PingFang TC', 'Noto Sans TC', 'Noto Sans CJK TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  meta:
    fontFamily: "-apple-system, 'PingFang TC', 'Noto Sans TC', 'Noto Sans CJK TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "-apple-system, 'PingFang TC', 'Noto Sans TC', 'Noto Sans CJK TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.2
rounded:
  folder: "0px"
  tag: "2px"
  control: "3px"
  index-tab: "4px 4px 0 0"
  sheet: "6px 6px 0 0"
spacing:
  tab-gap: "4px"
  card-pad: "8px"
  page-pad: "14px"
  column: "480px"
components:
  dog-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.folder}"
    padding: "8px"
  walk-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    size: "66px x 44px"
  walk-button-done:
    backgroundColor: "{colors.green-bg}"
    textColor: "{colors.green-text}"
    rounded: "{rounded.control}"
  day-tab-red:
    backgroundColor: "{colors.tab-red}"
    textColor: "{colors.surface}"
    width: "76px"
  day-tab-amber:
    backgroundColor: "{colors.tab-amber}"
    textColor: "{colors.ink}"
    width: "76px"
  day-tab-recent:
    backgroundColor: "transparent"
    textColor: "{colors.green-text}"
    width: "76px"
  day-tab-none:
    backgroundColor: "{colors.tab-muted}"
    textColor: "{colors.surface}"
    width: "76px"
  cage-tag:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "3px 8px 3px 5px"
  index-tab:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.index-tab}"
    height: "44px"
  index-tab-on:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.surface}"
    rounded: "{rounded.index-tab}"
  bottom-tab-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.shell}"
    rounded: "{rounded.control}"
    height: "52px"
  sheet-confirm:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    height: "50px"
  search-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 44px 11px 38px"
---

# Design System: 板收志工溜狗表

<!-- 給 impeccable 技能讀的視覺入口，是目前狀態的快照：
     - 數值以 css/app.css 的 :root 為準（含檔尾「視覺主題：病歷夾色籤」區塊覆寫後的結果）。上面 frontmatter 是 2026-10-09 從實際畫面抄下來的；兩邊不一樣時信 CSS，再用 /impeccable document 重新產生這份。
     - 單手操作規範、天數色標的規則與設計理由以 docs/DESIGN_GUIDE.md 為準，規格以 docs/PROJECT_GOALS.md 為準，這裡不重寫。
     - 外觀可以改。之後改版照 docs/PROJECT_GOALS.md 的版本流程，K 確認後就換；不要因為這份寫了某個值就拒絕改。 -->

## Overview

**Creative North Star: "病歷夾色籤"**

每隻狗是一份病歷夾，天數是夾邊凸出來的色籤。頁首和底部列是深檔案綠的檔案櫃（`--shell`），中間是淡鋼灰綠底上的一疊白色直角紙夾，1px 細線相接；志工一打開就看到紅籤、黃籤的那幾份凸出來。籠位是黑框白底的檔案標籤，上方的篩選是站在一條深綠線上的索引分頁。

整體安靜、實用，在犬舍走道的自然光、大太陽下也要看得清楚：每個字在自己的底色上對比 4.5 以上（大字 3 以上）。強烈的顏色只留給天數色籤；其他地方是綠灰中性色加一個檔案綠。這一版取代了 V9 的灰底白圓角卡＋系統藍。

**Key Characteristics:**
- 深綠檔案櫃夾住一疊白色直角紙夾
- 天數是卡片右緣的實心色籤，顏色就是訊息
- 籠位在手機是圖釘＋粗字（狗卡、列表都在狗名下面），電腦版全表是黑框檔案標籤
- 索引分頁：上緣圓、下緣平，站在 2px 深綠線上
- 平面，靠細線和底色分層，不靠陰影

## Colors

綠灰中性色加一個深檔案綠，再加一組只給天數用的實心色籤。

### Primary
- **檔案櫃綠**（`--shell`，與 `--primary` 同值）：頁首、底部列、選中的索引分頁、詳細資訊底部的主要動作、卡片「溜了」的外框與字、白底上的焦點框。`--shell-deep` 是在深綠上按下去的顏色；`--shell-soft` 是深綠上的次要字（日期、更新時間、未選中的分類）。
- **淡檔案綠**（`--primary-soft`）：「溜了」按下、等待中的底色。

### Secondary
- **天數色籤**：`--tab-red` 紅底白字、`--tab-amber` 黃底黑字、`--tab-muted` 灰底白字（沒有紀錄），都是實心。0–2 天（最近溜過）刻意不用實心，用淡綠底深綠字（`--green-bg` / `--green-text`），讓實心的只剩需要注意的那幾份。`--tab-green` 有宣告但目前沒有用到。哪個天數配哪個顏色見 `docs/DESIGN_GUIDE.md`「天數色標」。
- **籤黃**（`--tab-amber`）也兼任：深綠底上的焦點框與搜尋框焦點、文字選取、找狗平面圖選到的那一籠、搜尋命中標示、提示條的「復原」。

### Tertiary
- **青綠灰**（`--z-new-ink`）：找狗「新犬舍」分區的字色，也用在 ♂。♀ 用 `--red-text`。

### Neutral
- **鋼灰綠底**（`--bg`）：頁面底。
- **紙白**（`--surface`）：紙夾、詳細資訊、籠位標籤、搜尋框。
- **淡紙綠**（`--surface-soft`）：未選中的索引分頁、次要按鈕、找狗平面圖底、卡片按下。
- **墨綠黑**（`--ink`）／**灰綠字**（`--ink-soft`）：主要字／次要字。
- **細線**（`--line`）：紙夾之間、白卡外框（用 inset 1px）、分隔點。
- **警示**：`--red-bg` 是警示備註的底；`--amber-text` 是「改回沒溜」與常溜星號的框色。

### Named Rules
**The 綠色等於最近溜過 Rule.** 在內容區，綠色的意思是「最近溜過」。其他需要區別的記號不要用綠，例如 ♂ 改用 `--z-new-ink`。

**The 只有警訊是實心 Rule.** 實心色籤只給紅、黃、灰三種；最近溜過用淡綠。新的狀態顏色不要做成實心色塊。

## Typography

**Display Font:** 手機內建字型（iPhone 蘋方、Android Noto Sans TC），不載入網路字型
**Body Font:** 同上

**Character:** 一套系統字，靠字重拉層次：標題 800、狗名 700、天數 800，數字一律等寬。不載網路字型的理由見 `docs/DESIGN_GUIDE.md`「字體與字級」。

### Hierarchy
- **Headline**（800, 20px, 1.2, 字距 0.04em）：頁首站名，在深綠底上白字。
- **Title**（700, 17px, 1.3）：狗卡上的狗名；詳細資訊的狗名同字重更大。
- **Day value**（800, 17px, 等寬數字）：色籤裡的「N 天前」；字比較長時 13px（「沒有紀錄」15px）。
- **Body**（400, 15px, 1.4）：提示、說明、詳細資訊內文；分區標題 15px 700。
- **Meta**（400, 13.5px）：狗卡的籠位列與編號。
- **Label**（500, 12px）：色籤上的「上次溜」、底部列分類名，不打淡（對比要過 4.5）。

### Named Rules
**The 等寬天數 Rule.** 天數、計數、統計數字都用 `tabular-nums`，一疊卡片往下看時數字對齊。

## Layout

單欄，最寬 480px 置中，左右 14px。頁首黏在上方，分類列固定在畫面最下面（單手規範見 `docs/DESIGN_GUIDE.md`「單手操作」）。狗卡一張接一張沒有間距（下一張往上疊 1px，共用細線），像一疊夾子；詳細資訊的各段、統計的各張卡也一樣疊成一份。索引分頁之間 4px，底部列分類之間 6px。寬度 600px 以上時，詳細資訊改成置中的面板。

## Elevation & Depth

平面。分層靠底色（深綠檔案櫃／鋼灰綠底／白紙）和 1px 細線，白卡外框用 inset 1px `--line`，不用外陰影。

### Shadow Vocabulary
- **捲動後的頁首**（`box-shadow: 0 6px 16px rgba(16, 40, 33, 0.22)`）：只在內容捲到頁首底下時出現。
- **提示條**（`box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25)`）：浮在內容上、深色底的提示條。

### Named Rules
**The 紙疊不浮 Rule.** 紙夾、白卡不加陰影；要分開就用細線或底色。陰影只給真的浮在上面的東西（捲動後的頁首、提示條）。

## Shapes

幾乎直角。紙夾、詳細資訊的段落、統計卡是 0；色籤、籠位標籤、照片、小徽章 2px；按鈕、輸入框、底部列分類 3px；索引分頁上緣 4px、下緣 0；從下面拉出的面板上緣 6px。外框用 inset 線條畫（籠位、「溜了」1.5–2px，白卡 1px），不用 border。

**The 直角檔案 Rule.** 不再用大圓角卡片和膠囊按鈕；最大的圓角是拉出面板的 6px。

## Components

### Buttons
- **Shape:** 小圓角（3px）。
- **卡片「溜了」：** 白底、2px 檔案綠內框、綠字 700（66×44px）。溜完變淡綠底、深綠字、1.5px 框；按下是淡檔案綠。
- **詳細資訊底部主要動作：** 實心檔案綠、白字（高 50px）；旁邊的次要鈕（關閉、在哪）是淡紙綠底、墨字，圖示用檔案綠。
- **Focus：** 白底上 3px 檔案綠外框，離 2px；深綠頁首、底部列、提示條上改用籤黃。

### Chips
- **索引分頁：** 溜狗表的篩選（全部、我的常溜）和找狗上方的切換都一樣。未選中是淡紙綠底、灰綠字 600、1px 細框；選中是實心檔案綠、白字，數字用 `--shell-soft`。一排站在 2px `--shell` 底線上。
- **顯示切換（照片／列表）：** 3px 圓角的小方鈕，選中實心檔案綠。

### Cards / Containers
- **Corner Style:** 直角（0）。
- **Background:** 紙白，按下時淡紙綠。
- **Shadow Strategy:** 無，見 Elevation & Depth。
- **Border:** 1px `--line`，相鄰的卡片共用一條。
- **Internal Padding:** 8px；照片 64px 正方、2px 圓角。

### Inputs / Fields
- **Style:** 搜尋框在深綠頁首裡，白底、3px 圓角、無框。
- **Focus:** 3px 籤黃外框。

### Navigation
- **頁首：** 實心 `--shell`，白字站名、`--shell-soft` 日期，右上圖示鈕白色，按下 `--shell-deep`。溜狗表時搜尋框下面一行 13px / 600 的 `--shell-soft` 範圍字（畫面上第一隻到最後一隻多久沒溜），像抽屜上的範圍標籤。
- **底部分類列：** 實心 `--shell`，分類是 `--shell-soft` 圖示＋字；選中的那格是白底綠字的標籤（3px）。

### 天數色籤（Signature Component）
狗卡右緣一條 76px 寬、上下貼齊卡片的色塊，上面小字「上次溜」、下面天數。顏色見 Colors；換顏色時 0.4s ease-out 淡淡轉過去（系統設定減少動態時關掉）。列表模式第一欄的天數（寫「20天」）；0–2 天在狗卡和列表都只用綠字、不上底色、在哪面板的天數、詳細資訊的天數徽章用同一組顏色，縮成 2px 圓角的小籤。

### 籠位標籤（Signature Component）
手機（狗卡、列表、詳細資訊）：不加底和框，檔案綠定位圖釘＋墨字 600，放在狗名下面，按下變淡檔案綠底（`css/app.css`「少一點格子」區塊的 `.cage-pill`）；列表 2026-10-10 起也用同一個（K：原本單獨一欄的黑框標籤位置怪、跟照片檢視不一樣）。電腦版全表：白底、墨字 700、1.5px 墨色內框、2px 圓角的檔案標籤（`.dr-cage`），滑過淡檔案綠。點了都開在哪面板。

## Do's and Don'ts

### Do:
- **Do** 改顏色、字級時改 `css/app.css` 的 `:root` 變數（`--shell`、`--tab-red`、`--tab-amber`、`--tab-muted` 等），再用 `/impeccable document` 更新這份。
- **Do** 新的白色區塊用直角或 3px 圓角，加 inset 1px `--line` 外框，相鄰時疊在一起。
- **Do** 新的狀態色在自己的底色上量對比，4.5 以上（大字 3 以上）。
- **Do** 改版前先看 `docs/DESIGN_GUIDE.md` 的理由；要推翻跟 K 確認。

### Don't:
- **Don't** 在內容區用綠色表示「最近溜過」以外的意思。
- **Don't** 把最近溜過做成實心綠籤；實心只給紅、黃、灰。
- **Don't** 把系統藍、大圓角白卡、膠囊按鈕帶回來（V9 的樣子）。
- **Don't** 把這份快照當成不能改的規格，也不要在這裡重寫 `docs/PROJECT_GOALS.md` 或 `docs/DESIGN_GUIDE.md` 的內容。
