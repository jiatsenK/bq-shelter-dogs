# #400 警示狗卡底色遮蓋回歸修復

- 日期：2026-10-20；Agent：CODEX。
- 依據：K 回報正式網站紅／黃色警示狗卡整卡染色，狗名與操作被遮住的截圖。
- 原因：#400 將絕對定位 ::before 改以 grid-column: 1 定位，未指定結束線，auto 終點使背景延伸至整卡；更正為 1 / 2，只佔第一欄。
- 紅燈：320px 背景寬 292px、第一欄 70px，nameVisible=false。修復後紅／黃色在 320／390／768／1024px 的背景欄寬、名字 hit test、按鈕 trial click 皆通過。
- 審查：獨立 Standards／Spec 無阻擋項目；補上紅／黃色 class 斷言，避免 fixture 日後失去覆蓋。
- 驗證：Node 333／333、頁面 261／261 與全部互動套件通過；補強斷言後重跑 large-text 通過；git diff --check 通過。detect 僅既有 layout-transition 警告（1675 行），本次無新提示。
- PR：本分支 fix/400-warning-background；未變更資料寫入或產品設計，合併前確認自動部署授權。
