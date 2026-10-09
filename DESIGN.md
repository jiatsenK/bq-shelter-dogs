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
     - 外觀可以改。之後改版照 docs/PROJECT_GOALS.md 的版本流程，K 確認後就換；不要因為這份寫了某個值就拒絕改。
     - 這份上半（frontmatter 到第一個 Do's and Don'ts）只管志工版 index.html。cards.html（板收明星隊球員卡）是另一個視覺世界，寫在檔尾「球員卡世界：只限 cards.html」。 -->

## Overview

**Creative North Star: "病歷夾色籤"**

每隻狗是一份病歷夾，天數是夾邊凸出來的色籤。頁首和底部列是深檔案綠的檔案櫃（`--shell`），中間是淡鋼灰綠底上的一疊白色直角紙夾，1px 細線相接；志工一打開就看到紅籤、黃籤的那幾份凸出來。籠位是黑框白底的檔案標籤，上方的篩選是站在一條深綠線上的索引分頁。

整體安靜、實用，在犬舍走道的自然光、大太陽下也要看得清楚：每個字在自己的底色上對比 4.5 以上（大字 3 以上）。強烈的顏色只留給天數色籤；其他地方是綠灰中性色加一個檔案綠。這一版取代了 V9 的灰底白圓角卡＋系統藍。

**Key Characteristics:**
- 深綠檔案櫃夾住一疊白色直角紙夾
- 天數是卡片右緣的實心色籤，顏色就是訊息
- 籠位是全站一致的黑框檔案標籤
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
白底、墨字 700、1.5px 墨色內框、2px 圓角，前面一個定位圖示。狗卡、詳細資訊都長一樣；點了開在哪面板，按下變籤黃。

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

---

## 球員卡世界：只限 cards.html

<!-- 第二個視覺世界，範圍只有 cards.html、css/cards.css、js/cards.js（電腦寬螢幕展示頁「板收明星隊球員卡」）。
     - 上面 frontmatter 和 Overview 到 Do's and Don'ts 是志工版溜狗表（index.html、css/app.css）的「病歷夾色籤」，照舊有效；這一段不改它，它也不管這一頁。
     - frontmatter 只能放一套系統，所以這裡的數值以 css/cards.css 的 :root 和 js/cards.js 的 BQ_TEAMS、BQ_TIERS 為準；機器讀的版本在 .impeccable/design.json 的 extensions.surfaces["cards-html"]。2026-10-09 從實際畫面抄下來的；兩邊不一樣時信 CSS/JS。
     - 方向約定見 .impeccable/surfaces/cards-html.md。 -->

### Overview

**Creative North Star: "板收明星隊球員卡"**

收容所的狗是一支職棒球隊，這一頁是一套球員卡：抽、翻、收。地是深夜球場：深藍和淺一階的藍交替成 7.5vw 寬的直條草皮紋，中間淡淡一圈投手丘線。主角是一包燙金卡包，撕開後五張卡扇形攤開；卡面是白邊（或銀、金、雷射框）、滿版照片、隊色色帶、斜體粗黑狗名、Anton 背號。往下換成白底的年度獎項（金框獎座），再往下回到最深的藍，是一頁一頁的收集冊卡套。

這是展示用的，要熱鬧、會反光、會動，跟志工版的安靜實用刻意不同；但動作只用卡片本身的語法（發、翻、傾斜、流光），系統設定減少動態時直接攤開、不傾斜、不流光。

**Key Characteristics:**
- 深藍直條球場是地，燙金是唯一的亮面材料
- 卡片等級看在所多久：普卡白框、銀卡、金卡、雷射卡，等越久框越亮
- 隊色看犬舍：色帶、沒照片時的底、收集冊每頁的色點都用同一個隊色
- 數字一律 Anton，中文一律 Noto Sans TC 900／700
- 卡片是真的物件：有厚影、會翻面、跟著滑鼠傾斜反光

### Colors

深夜藍的地、粉筆白的卡、燙金的亮點，加一組按犬舍分的隊色；紅色只在獎項緞帶和卡包上的「撕開」。

#### Primary
- **燙金**（`--gold` #E8B400）：大標「BQ ALL-STARS」、收集進度條、「再開一包」、獎項數字、卡背的標籤字和球齡數字、卡背金色內框、徽章的金圈。在深藍上 7.3:1。
- **亮金**（`--gold-hi` #FFD95A）：「NEW」標籤、重複張數 ×N 的小牌、「再開一包」滑過、全頁的焦點框。
- **金箔漸層**（卡包、金卡框、獎座外框；#8A6400／#9A7200 到 #FFF2BA 之間 115°或 135° 的多段漸層）：只給「有收藏價值」的實體：卡包、金卡、獎座。卡包的漸層 240% 寬、4.5 秒來回流動。

#### Secondary
- **隊色**（寫在 `js/cards.js` 的 `BQ_TEAMS`，用 `--team` 傳進元件）：新犬舍隊 #1F5C9E、舊犬舍隊 #0F6B6B、幼母隊 #875700、C 區隊 #2F7A45、住院區隊 #6E4A9E、自由球員 #55605B。全部是中明度（OKLCH 約 47–52%），上面放粉筆白字都在 4.7:1 以上。用在卡面色帶、照片沒載到前的底、沒照片時的補位底、收集冊每頁標題前的色點。
- **等級框**：普卡是粉筆白；銀卡 #8E97A1–#F2F4F6 的 135° 金屬漸層；金卡用金箔漸層；雷射卡是 65° 細白斜紋疊在粉紅、黃、薄荷、藍、紫的 125° 彩虹上，彩虹位置跟著滑鼠走。

#### Tertiary
- **緞帶紅**（`--red` #C41E33）：年度獎項左上的緞帶、卡包上的「撕開」，粉筆白字 5.3:1。

#### Neutral
- **球場藍**（`--navy` #0B2A5B）／**草皮淺藍**（`--navy-2` #0D3068）：第一屏的直條紋；`--navy` 也是卡背、獎座內頁、徽章字的底。
- **夜空藍**（`--navy-deep` #071B3D）：html 底色、收集冊整段的底；收集冊每一頁是再亮一點的 #0E2147。
- **粉筆白**（`--chalk` #F4F4F0）：卡面框、深底上的主要字、獎項整段的底、已收到的卡套、隊伍切換選中的底。
- **燈光藍**（`--sky` #C6D2E8）／**看台藍**（`--sky-dim` #8FA3C8）：深底上的次要字和說明；看台藍也是收集進度分母、還沒收到的背號（在夜空藍上 6.7:1）。半透明的燈光藍（.06–.5）是卡套、分隔線、外框。
- **墨藍**（`--ink` #0A1428）／**灰墨藍**（`--ink-soft` #46506B）：白底、金底上的字。

#### Named Rules
**The 金是收藏 Rule.** 金箔漸層只給卡包、金卡和獎座；平面的 `--gold` 是重點字和主要按鈕。不要拿金色當一般裝飾。

**The 隊色是犬舍 Rule.** 隊色只表示「哪一隊（哪個犬舍）」，同一隊在色帶、補位底、收集冊色點必須同色；新隊色要中明度，上面的粉筆白字 4.5:1 以上。

**The 紅色是獎 Rule.** 紅只給獎項緞帶和「撕開」，不要拿來表示其他狀態。

### Typography

**Display Font:** Anton（Google Fonts，400），後備 Noto Sans TC
**Body Font:** Noto Sans TC（Google Fonts，500／700／900），後備蘋方、微軟正黑體
**Label/Mono Font:** 數字都用 Anton，不另用等寬字

**Character:** 窄高的 Anton 像球衣背號和計分板，只拿來寫數字和拉丁字的隊名；中文用 Noto Sans TC 的 900 撐出球員卡的粗黑感。全站只有這一頁載網路字型；志工版照舊用系統字。

#### Hierarchy
- **Display**（Anton 400, clamp(44px, 5vw, 76px), 行高 .95, 字距 .01em）：左上「BQ ALL-STARS 2026」，英文燙金、年份粉筆白。
- **背號與計數**（Anton 400）：卡面背號（卡寬 22%）、收集進度（40px）、獎項數字（64px）、收集冊頁數（22px）、卡套背號（26px）、NEW、×N。
- **Headline**（Noto Sans TC 900, clamp(32px, 3.2vw, 46px), 行高 1.1, 字距 .06em）：「年度獎項」「收集冊」段落標題。
- **狗名**（900, 卡寬 12%, 行高 1.05, `skewX(-8deg)`）：卡面的斜體粗黑狗名。斜體是用 skew 做的，Noto Sans TC 沒有斜體。
- **Title**（900；獎座狗名 28px、緞帶 22px 字距 .15em、收集冊每頁隊名 20px）。
- **Body**（500, 14–16px）：卡背「收容所的話」行高 1.65。
- **Label**（700, 13–14px, 字距 .1–.25em）：「志工版溜狗表」「已收」「點卡包撕開」「點卡片翻到背面」這類短句，靠拉開字距像印在球場看板上。卡面色帶 900、字距 .14em。

#### Named Rules
**The 數字用背號 Rule.** 背號、張數、天數、年數這些要被看見的數字用 Anton；中文和夾在中文裡的小數字用 Noto Sans TC（卡背資料列用 `tabular-nums`）。

**The 卡片等比 Rule.** 卡片上的字和間距都是卡寬（`--cw`）的比例，所以手上、大卡、獎座、卡套四種尺寸是同一張卡縮放。

### Layout

三段直向疊：第一屏球場（至少 100svh，頁首、卡包桌、下方提示三列）→ 白底年度獎項 → 夜空藍收集冊。段落左右 48px、上下 96px；段落標題左右分開，標題在左、說明或操作在右，下方 40px。卡寬 `--cw` 是 clamp(150px, 16.5vw, 248px)，卡包是卡寬 1.2 × 1.68 倍（最大約 298×417px）、卡片 1 × 1.4。

撕開後五張扇形：每張往兩側平移約一張卡寬、離中間每一張下沉 26px、旋轉 4°。年度獎項三欄、間距 40px。收集冊每隊一頁、頁與頁 28px，卡套至少 96px 寬自動排滿、間距 12px／10px。

只為電腦寬螢幕設計；900px 以下（手機打開分享連結）卡寬改 clamp(116px, 32vw, 190px)、扇形擠成 10px／3°、獎項一欄、卡套固定四欄、左右 18px，只求不壞。

### Elevation & Depth

立體，而且是真的物件感：卡包、卡片、獎座都浮在桌面上有厚影；平面的底（球場、收集冊頁）只用細 inset 線分層。

#### Shadow Vocabulary
- **卡片**（`box-shadow: 0 24px 50px rgba(0, 0, 0, .5)`）：手上的卡、大卡的正反面。
- **卡包**（`filter: drop-shadow(0 34px 40px rgba(0, 0, 0, .5))`）：用 drop-shadow 是因為卡包有鋸齒遮罩。
- **獎座**（`box-shadow: 0 22px 44px rgba(11, 42, 91, .28)`）：白底上用帶藍的影。
- **已收到的卡套**（`box-shadow: 0 6px 14px rgba(0, 0, 0, .35)`）：插在卡套裡的卡比空卡套高一層。
- **內框**：徽章和卡包圓徽用多圈 inset 線（金、白、藍）；卡背 `inset 0 0 0 calc(var(--cw) * .018) var(--gold)`；收集冊頁 1px、空卡套 1px 半透明燈光藍。
- **背號字影**（`text-shadow: 0 2px 0 rgba(0, 0, 0, .35), 0 0 12px rgba(0, 0, 0, .25)`）：讓白色背號壓在任何照片上都讀得到。

#### Named Rules
**The 物件才浮 Rule.** 有影子的只有拿得起來的東西：卡包、卡、獎座、收到的卡。球場、段落、收集冊頁不加外陰影。

**The 雷射不霧照片 Rule.** 雷射彩虹層（`mix-blend-mode: color-dodge`）在照片區只留約 7%，到框和名字那一塊才滿；滑鼠亮點（`screen` 的白色光暈）是另一層，照樣掃過照片。

### Shapes

卡的形：卡片圓角是卡寬 4%（約 6–10px），卡套 5px、卡套裡的照片 2px；獎座外框 12px、內頁 4px；收集冊頁 6px；按鈕、隊伍切換、輸入框 3px。卡包上下緣是 12px 一齒的鋸齒封口，撕開時上緣沿 13% 的虛線撕成不規則鋸齒。唯一的圓：左上徽章是膠囊（41px 圓角）配三圈 inset 線，像球衣臂章；卡包上的圓徽；大卡的關閉鈕。

### Components

#### 卡包（Signature Component）
金箔漸層、鋸齒封口、中間藍底金圈的腳掌圓徽、「板收明星隊」900 墨字、下方紅底「撕開」。平常流光；滑過時上浮 10px、左傾 1.5°。點了上緣那條沿虛線撕下、往左上飛走（.6s），卡包往下掉出畫面（.8s），卡片從原位升起攤開。

#### 球員卡（Signature Component）
- **正面：** 等級框（框的寬度是卡寬 4.5%）包著照片；照片左上 Anton 背號、右上亮金「NEW」（新收到的才有）；下方隊色色帶寫隊名和等級；再下面斜體粗黑狗名、灰墨藍「守備位置 籠位」和性別。
- **背面：** 球場藍底、金色內框；狗名＋金色背號、看台藍的卡號（BQ26・001/總數・隊名）、上下細線夾住的三列資料（入隊、球齡、本月出賽），金色標籤；收容所的話；最下面等級說明。
- **沒照片：** 隊色底加淡斜紋和一隻狗的剪影，大大的淡背號，中間「照片補拍中」。
- **互動：** 點了繞 Y 軸翻面（.7s）。滑鼠在上面時上浮 26px、放大 1.07、跟著游標傾斜（最多約 13°／11°），雷射層和亮點跟著游標位置移動。剛收到的卡發完後亮一下（1.4s）。
- **Focus：** 卡面外加 4px 亮金框。

#### 年度獎項（獎座）
12px 金箔外框、球場藍內頁；4:3 照片、左上紅緞帶寫獎名；下面粉筆白 28px 狗名、燈光藍說明、右邊金色 Anton 大數字加單位；最下一行看台藍小字是獎座的卡號。滑過時整座上浮 6px、微傾，照片放大 1.04。點照片開大卡。

#### 收集冊（卡套頁）
每隊一頁，#0E2147 底、6px 圓角、1px 內框；標題前一顆隊色小方塊，右邊 Anton「已收 / 總數」。卡套 5:7：沒收到的是半透明空卡套，裡面淡淡一隻狗剪影和看台藍背號，名字寫「？」；收到的換成等級框的小卡（照片＋名字），重複的右上亮金 ×N。卡套上有一道 160° 的反光。

#### Buttons
- **Shape:** 3px 圓角，至少 44px 高。
- **主要（再開一包、開新的一本）：** 燙金底、墨藍 900 字；「再開一包」18px、字距 .2em，滑過變亮金並上浮 2px，按下往下 1px。
- **外框（換人收集）：** 透明底、粉筆白字、2px 半透明燈光藍 inset 框，滑過框變粉筆白。
- **關閉（大卡）：** 48px 圓形、12% 粉筆白底、SVG 叉。

#### Chips
- **收集冊切換：** 3px 圓角；未選是 12% 燈光藍底、燈光藍字；選中是粉筆白底、墨藍字；滑過加 2px 粉筆白 inset 框。

#### Inputs / Fields
- **Style:** 粉筆白底、無框、3px 圓角、高 44px、墨藍 700 16px 字；佔位字 #5A6276。
- **Focus:** 全頁統一 3px 亮金外框、離 3px。

#### Navigation
沒有導覽列。右上只有燈光藍 14px「志工版溜狗表」（底下 1px 半透明線，滑過變粉筆白）和收集進度（「已收」＋Anton 的 N/總數＋4px 金色進度條），點進度跳到收集冊。頁尾再放一次回溜狗表的連結。

#### 大卡
86% 深藍遮罩，卡寬 min(340px, 72vw, 52vh)，從下方 30px、0.94 倍彈出（.45s）；可翻面、可傾斜，下面一行看台藍「點卡片翻面・Esc 關閉」。

#### 動作
- **主緩動**（`--ease`: `cubic-bezier(.2, .9, .2, 1)`）：發牌、翻面、進度條、滑過。
- **發牌：** 每張間隔 120ms（第一張 140ms 後），.9s 從 0.62 倍升到扇形位置。
- **減少動態：** 卡包不流光、不撕、不發牌、不傾斜，卡片直接在扇形位置；翻面、大卡也不做過場。

### Do's and Don'ts

#### Do:
- **Do** 改這一頁的顏色、字級時改 `css/cards.css` 的 `:root`；隊色和等級改 `js/cards.js` 的 `BQ_TEAMS`、`BQ_TIERS`，再用 `/impeccable document` 更新這一段。
- **Do** 新增的元件放在球場藍、夜空藍或粉筆白其中一種底上；深底上的次要字用燈光藍或看台藍。
- **Do** 新的隊色取中明度（OKLCH 約 47–52%），量過上面粉筆白字 4.5:1 以上。
- **Do** 卡片的新尺寸用改 `--cw` 的方式縮放，不要另外寫一套字級。
- **Do** 新的互動沿用卡片的發、翻、傾斜、流光，並在減少動態時直接到最後的樣子。

#### Don't:
- **Don't** 把這一段的深藍、燙金、Anton、網路字型、膠囊徽章帶進 `index.html`／`css/app.css`；志工版的規則（綠色等於最近溜過、只有警訊是實心、直角檔案）也不管這一頁的隊色和卡片。
- **Don't** 讓這一頁變回認養網站的「標題＋一排排圓角照片卡」；照片格只出現在收集冊的卡套裡。
- **Don't** 做成上一版畢業紀念冊那種懷舊翻書。
- **Don't** 用金箔漸層做一般背景或按鈕；金箔只給卡包、金卡、獎座。
- **Don't** 在獎項緞帶和「撕開」以外用紅色。
- **Don't** 讓雷射彩虹蓋滿照片；照片區保持清楚。
