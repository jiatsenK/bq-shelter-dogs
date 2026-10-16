---
version: 1
slug: "cards-html"
primary_target: "public/cards.html"
related_targets: []
---

# 板收圖鑑（public/cards.html）

Scope：只在電腦寬螢幕（電腦版溜狗表頁首「圖鑑」進來，K 2026-10-10；首頁不再自動轉來）。手機版就是溜狗表（K 2026-10-09），不為手機設計；有人直接用手機開 public/cards.html 時版面不壞即可。志工版溜狗表照舊在 public/index.html。Visitor mode：Experience。
Audience：K 開給朋友、同事看（會拍螢幕），之後也把連結傳給別人自己玩。
Job：你溜過的狗才拿得到牠的卡，新溜的包成卡包自己撕；圖鑑裡看得到所內每隻狗（沒溜過的還沒有卡）；看資料算出來的年度獎項。
Constraints：不寫試算表、不放志工名字和警示；只讀 data/dogs.json 和 data/walks.json；「你是誰」用溜狗表「我溜過」的代號，撕開過的卡記在各自的瀏覽器（localStorage `bq-zukan`）；沒照片的狗要好看地補位。之後（不在這次）：比大小對戰、溜狗排隊、認狗測驗、像素溜狗遊戲。
Memorable moment：撕開燙金卡包，五張閃卡扇形攤開，滑鼠一動雷射膜跟著反光。

K 2026-10-10 看預覽版後改版面：一進來是圖鑑（不是卡包）；開卡包是圖鑑標題右邊的金色按鈕，按了才是蓋住畫面的球場和卡包；年度獎項先藏起來。下面 STORY、FIRST VIEWPORT 寫的「卡包在第一屏中央」是改版前的。

## Direction contract

THESIS: 收容所的狗是一支職棒球隊，網站是一套球員卡：抽、翻、收；拒絕認養網站「標題＋一排排圓角照片卡」，也拒絕上一版畢業紀念冊的懷舊翻書。

OWN-WORLD: 深夜球場藍（深藍＋淺藍直條草皮紋）是地；燙金卡包與金框獎座；卡面白邊、照片、隊色色帶（照犬舍分隊）、斜體粗黑狗名、Anton 背號；稀有度看在所多久：普卡、銀卡、金卡、雷射卡；紅色只給獎項緞帶和「撕開」。

STORY: 一進來是一包卡在球場中央，紅標寫「N 張新卡」（你上次來之後新溜的狗）；撕開攤開五張，翻背面看入隊日、球齡、本月出門、你溜過幾天、收容所的話；往下是年度獎項（出門王、資深球星、新人王）；再往下是圖鑑，全部的狗一格一格：拿到的亮卡、待開的卡背、沒溜過的淡照片。還沒設定你是誰時卡包壓暗，下面「去設定」。

FIRST VIEWPORT: 左上「板橋收容所」小字＋「BQ ALL-STARS 2026」大字，右上「已拿到 N / 總數」；畫面正中一包約 300×420 的燙金卡包（會緩慢流光），下面一句「點卡包撕開」；撕開後同一個位置換成五張扇形卡片＋「再開一包」；沒有導覽列，右上角小小的「← 溜狗表」。

FORM: IMPECCABLE’S PICK（我自己排第 1 的球員卡），方向輪 seed key d9edc232（第一輪，K 2026-10-09 看過三個原型後選這個）。訊號互動：撕卡包、扇形發牌、滑鼠傾斜加雷射反光、點擊翻背面。動作語法：卡片的發、翻、傾斜；減少動態時直接攤開、不傾斜不流光。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
