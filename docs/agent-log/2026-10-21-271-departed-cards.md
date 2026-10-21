# 2026-10-21 #271 圖鑑已出所狗卡

- Agent：Claude Code（雲端）。分支 `claude/271-departed-cards`，疊在 #270 的 `claude/270-activity-records` 上（出席次數、未對上的出席都要 #270 的活動表）。
- 依據：#271、ADR 0002、#271 triage 留言（溜過幾趟用年度摘要，不整表讀 v3_walks）。

## 做了什麼

- 溜過幾天：`worker/src/packs.js` 的年度摘要多存 `dogs`（每個編號溜過幾天，沒記人的舊紀錄也算）；`readDogWalkDays` 跟 `/walks/mine` 一樣用各年摘要＋今天的紀錄。舊摘要沒有 `dogs` 就當舊的重算一次（讀那年的資料包，不讀 v3_walks 整表），之後照常沿用。
- `GET /api/departed-cards`（`worker/src/departed.js`）：離所資料包（ADR 0014）裡的狗，排除再入所的；同一隻離所兩次只留最新那筆；溜過天數加上舊編號；出席活動次數從 `v3_activity_dogs` 算；加上 `v3_departed_cards` 只有名字的卡。
- D1：`v3_departed_cards`（dog_id、離所日、原因、建立時間）。同步不碰。
- K 建卡：`scripts/departed-card.mjs --name 名字 [--left 日期 --reason adopt|death|other|unknown] [--write]`，預演只送 SELECT；建卡時活動紀錄同名、沒對上的出席接上這張卡。也可 `--to 編號` 把沒對上的名字接到已經有的狗（#270 同名多隻的情況）。記編輯紀錄 `departed-card`，edits.js 顯示。
- 圖鑑（cards.html／cards.js／cards.css）：圖鑑下面加「已出所」一段，所有人直接看到、全是拿到的卡套，不算開卡進度；點了開大卡，背面是在所期間、在所多久、溜過幾天、出席活動幾次、離所原因。`docs/design/cards.md` 補規格。
- 離所原因的字：被認養／當小天使了／離開收容所／原因待確認（給收藏卡用，語氣比離所名冊的「死亡」柔和），K 可再改。

## 測試

- 新增 `worker/test/departed-cards.test.mjs`（舊編號、沒記人、再入所、離所兩次、只有名字的卡；舊摘要重算後答案一樣、冷啟動讀取列數）、`scripts/departed-card.test.mjs`、`tests/departed-cards.cjs`；`tests/index.html` 補 `bqAlumni`、圖鑑 fetch 數 5→6（新的只 GET）。
- Node 362／362、網頁 262／262 與全部互動套件通過。impeccable detect：只有 cards.html 既有的球場斜紋提示。
- 截圖（合成資料）：docs/design/issue-271。

## 未完成

- 只有名字的卡還不能上傳照片（照片上傳以編號為準），要補照片再開票。
- 部署後第一次讀已出所或我溜過，會各年重算一次摘要（一年寫幾列）。
- #270 合併後這張 PR 改以 main 為基底。未在真機驗收。

## 審查（/implement 流程的 /code-review，同 PR）

- 使用者補充改用 /implement 技能接續；先合併 #270 審查後的修正（`v3_activity_versions` 等），解 `compact-schema.test` 表清單衝突。
- Standards：出席次數每次 JOIN 整張 `v3_departures`、讀取量測試只有絕對上限。修正：出席次數與只有名字的卡改跟活動同一個版本號（`v3_departed_cards` 也加觸發器），沒變只讀 1 列；變了才讀出席名單和這些狗的編號（索引），不讀離所表。測試改 `readsOf`：塞 300 隻狗、40 場活動、40 筆溜狗後，沒變時讀取量相同。前端抽 `bqShowModal`（大卡與已出所共用）、`BQ.alumni` 改 `{ state, list }`、補 `number: ''` 的註解。離所原因清單在 Worker、腳本、前端、schema CHECK 各一份，分屬不同執行環境，維持。
- Spec：只有名字的卡「之後可補照片」沒做到（照片上傳只收主清單上的編號，離所的狗也一樣）；需要另開票設計上傳入口，PR 註明。「溜過幾趟」照 triage 留言算天數，卡上寫「溜過 N 天」，請 K 確認。`--to`、「在所多久」一列、摘要重算對 `/walks/mine` 的一次性影響都在 PR 寫明。
- 複驗：Node 365／365、網頁 262／262 與全部互動套件通過。
