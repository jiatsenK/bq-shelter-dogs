---
version: 1
slug: "cards-html"
primary_target: "cards.html"
related_targets: []
---

# 板收明星隊球員卡（cards.html）

Scope：只在電腦寬螢幕（index.html 在 ≥1100px、有滑鼠時轉來這裡）。手機版就是溜狗表（K 2026-10-09），不為手機設計；有人直接用手機開 cards.html 時版面不壞即可。志工版溜狗表照舊在 index.html。Visitor mode：Experience。
Audience：K 開給朋友、同事看（會拍螢幕），之後也把連結傳給別人自己玩。
Job：抽卡認識所內的狗；看資料算出來的年度獎項；把收到的卡收進收集冊。
Constraints：不寫試算表、不放志工名字和警示；只讀 data/dogs.json 和 data/walks.json；收集冊記在各自的瀏覽器（localStorage），同一台電腦可以「換人收集」；沒照片的狗要好看地補位。之後（不在這次）：比大小對戰、溜狗排隊、認狗測驗、像素溜狗遊戲。
Memorable moment：撕開燙金卡包，五張閃卡扇形攤開，滑鼠一動雷射膜跟著反光。

## Direction contract

THESIS: 收容所的狗是一支職棒球隊，網站是一套球員卡：抽、翻、收；拒絕認養網站「標題＋一排排圓角照片卡」，也拒絕上一版畢業紀念冊的懷舊翻書。

OWN-WORLD: 深夜球場藍（深藍＋淺藍直條草皮紋）是地；燙金卡包與金框獎座；卡面白邊、照片、隊色色帶（照犬舍分隊）、斜體粗黑狗名、Anton 背號；稀有度看在所多久：普卡、銀卡、金卡、雷射卡；紅色只給獎項緞帶和「撕開」。

STORY: 一進來就是一包卡在球場中央；撕開抽五張，翻背面看入隊日、球齡、本月出賽、收容所的話；新卡自動收進收集冊；往下是年度獎項（出門王、資深球星、新人王）；再往下是收集冊，全部球員一格一格，還沒收到的是剪影和背號。

FIRST VIEWPORT: 左上「板橋收容所」小字＋「BQ ALL-STARS 2026」大字，右上收集進度「已收 N / 121」；畫面正中一包約 300×420 的燙金卡包（會緩慢流光），下面一句「點卡包撕開」；撕開後同一個位置換成五張扇形卡片＋「再開一包」；沒有導覽列，右上角小小的「志工版溜狗表」。

FORM: IMPECCABLE’S PICK（我自己排第 1 的球員卡），方向輪 seed key d9edc232（第一輪，K 2026-10-09 看過三個原型後選這個）。訊號互動：撕卡包、扇形發牌、滑鼠傾斜加雷射反光、點擊翻背面。動作語法：卡片的發、翻、傾斜；減少動態時直接攤開、不傾斜不流光。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
