// 試算表「誰遛的」格子的拆名規則：Worker 各處共用，分隔符號只改這裡。只有純函式，不連網路。
// #512 起試算表只由 Apps Script 讀（編輯觸發、保險掃描），gviz 讀表跟舊同步程式一起移除。

// 「誰遛的」一格寫好幾個名字時用這些符號或空白隔開。志工手打時常用句號、分號、冒號隔開，也都當分隔
// （2026-10-04 K 回報「志工甲。K」抓不到K）。apps-script/sheet-write.gs 的 NAME_SEP 要跟這裡一樣（測試會比對）
export const NAME_SEP = /[、,，\/／&＆+＋。｡．.;；:：|｜·・\s]+/;

// 「誰遛的」一格 → 名字清單（照格子裡的順序、去頭尾空白，不去重）
export const splitNames = text => String(text || '').split(NAME_SEP).map(n => n.trim()).filter(Boolean);
