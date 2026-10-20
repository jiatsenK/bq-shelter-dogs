# 小範圍設計文件整理

- 日期：2026-10-20；Agent：CODEX。
- 依據：K 在 #400 retrospective 後同意縮短入口、整理現行規格、context 摘要＋來源位置。
- AGENTS 保留必要規則與條件式路由；資料契約、工具與安裝細節搬至專用文件。
- 志工版以 DESIGN_GUIDE 為現行來源；圖鑑分檔，舊快照與單手提案移至 history；消除天數、導覽與篩選的舊描述。
- 新增本機 context 摘要入口，不改原版技能、不改網站執行碼。
- 本機獨立分支 docs/design-context，承接 #400 的文件整理；#428 已合併，推送前改以 main 442b8cd 為基準。K 已授權推送，未新增 Issue／PR。
- 驗證：Node 333／333（含 context 四組測試）；相對連結與 git diff --check 通過；資料 ADR 路由逐字保留。未改網站執行碼，因此未重跑網頁互動套件。
