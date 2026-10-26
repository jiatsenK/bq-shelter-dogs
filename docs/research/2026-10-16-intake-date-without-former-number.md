# 沒有舊編號時，讓入所多久照「舊入所日」算（研究）

日期：2026-10-16（研究，未實作）

## 問題

狗轉所、退養再入所會拿新編號，入所多久就從頭算（墨西哥：現編號 2017090508，介紹寫 2015/8/18 入所）。#289（已關）做了「補舊編號」，但舊編號多半查不到。K 想要：沒有舊編號時，志工直接補一個舊入所日期，入所多久照最早的日期算；以後有新案例再補舊編號。

**最重要的一點**：這跟已鎖定的 ADR 0005 衝突。ADR 0005 寫明 K 決定「不從入所介紹的文字猜日期，也不另存一個人工入所日」（`docs/adr/0005-intake-date-from-oldest-number.md:5`）。GLOSSARY 的「入所日」定義也是「所有編號裡最舊那個的前 8 碼」（`GLOSSARY.md:41-43`）。所以不管選哪個做法，都要 K 明確重開這個決定，並寫新 ADR 取代 0005 的這一句、更新 GLOSSARY。

## 1. 入所日現在在哪裡算

只有兩個實作，規則相同（現編號＋舊編號取最舊的前 8 碼）：

| 位置 | 函式 | 用在哪 |
|---|---|---|
| `public/js/app.js:760-770` | `idDate`、`firstIntake(dog)` | 主要實作 |
| `public/js/app.js:794` | `reentryLine` | 詳細資訊編號下「舊編號 …・最早入所 YYYY/M/D」 |
| `public/js/app.js:2040-2047` | 詳細資訊標籤 | 「入所 YYYY/M」徽章 |
| `public/js/app.js:1956-1958` | 離所狗詳細資訊的 `since()` | 「入所 YYYY/M」 |
| `public/js/app.js:836` | `saveFormer` 的提示文字 | 「入所日改從 … 算」 |
| `public/js/analysis.js:19-23` | `intakeDate` → `firstIntake`，排除未來日期 | 分析頁在所天數／月數、分組、排名（`analysisRows` 36-45）；說明文字「入所日期取編號前 8 碼」（`analysis.js:331`，已經不精確） |
| `public/js/cards.js:42-51` | `bqIdDate`、`bqIntake(d)`（複製一份同規則） | 圖鑑：等級（`bqTier`）、在所多久（`bqStay`）、背號／資深球星（`cards.js:99-106`） |

結論：改規則要動 `firstIntake` 和 `bqIntake` 兩處，最好讓 `cards.js` 也吃同一份（或至少共用測試）。

## 2. 舊編號 formerIds 資料流

- D1 表：`v3_dog_numbers(number PK, dog_id)`（`db/compact-schema.sql:8-12`），一隻狗的所有編號都指到永久 ID。
- 讀：`/api/dogs` 由 `worker/src/compact.js:16-39` 組出，`formerIds` = 同 dog_id 但不是主清單現編號的號碼（`compact.js:19`），只在有時出現。離所狗另外處理（`compact.js:230-231`）。
- 寫：`POST/DELETE /former/{編號}`（`worker/src/index.js:407-443`），檢查 10 碼、日期合法且不在未來、不晚於現編號、不屬於別隻狗（`compact.js:184-207`），需要先選名字，記 `v3_edit_log`（kind `former`，`worker/src/editlog.js:16`）。
- 前端：`reentryLine`／`openFormerEdit`／`saveFormer`／`removeFormer`（`public/js/app.js:772-848`），存好直接改本機 `dog.formerIds` 重算。

## 3. 入所介紹 intro

- 來源：**只有 D1 的 `v3_intros(dog_id, intro)`**（`db/compact-schema.sql:114-117`），`/api/dogs` 用 `LEFT JOIN v3_intros` 讀成 `intro`（`worker/src/compact.js:9,17`）。不是試算表欄位（#250 起改存 D1，`worker/src/index.js:35,372-373`）；舊資料是用 `scripts/import-compact-profiles.mjs` 匯入。
- 前台可以編輯：詳細資訊點介紹就原地改（`public/js/app.js:1781-1848`），電腦版「補資料」也能改（`public/js/desk.js:253-394`），都打 `PUT /intro/{編號}`，任何人可改、記編輯紀錄 kind `intro`（`worker/src/index.js:400-403`）。
- 顯示：目前是一整段純文字（`app.js:1786`，離所的 `app.js:1952`）。#285（已關）要改成「一次入所一行：`- 2015/08/18 政府捕捉入所`」的條列，並說日期「跟著同一隻狗的各個編號走」。
- 既有日期解析：**沒有**。程式裡沒有任何從介紹抓「2015年8月18日」「2015/8/18」的程式；唯一相關是圖鑑 `bqQuote` 會「跳過開頭的日期」取引言（`public/js/cards.js:66-68`），只是切字串，沒有解析成日期。#289 那份「21 隻介紹日期比編號早」清單是一次性調查，不在程式裡。

## 4. 對照 ADR／GLOSSARY

| 文件 | 跟「舊入所日」的關係 |
|---|---|
| ADR 0005（intake） | 明文排除「從介紹猜日期」和「另存人工入所日」→ **需要新 ADR 取代這部分**（建議 0010，標明取代 0005 第一段的那句，其餘照舊：存 D1、誰都能補、記編輯紀錄、全站同一算法）。 |
| ADR 0006（寫試算表範圍） | 試算表不寫這個欄位；存 D1 符合現況（舊編號、介紹都不寫試算表）。 |
| ADR 0001（使用者資料跟著代碼） | 這是狗的資料不是志工資料，應指到狗的永久 `dog_id`（跟 0005 舊編號同一把 ID），不是編號，換號不會掉。 |
| ADR 0002（活動紀錄） | 0005 參照它「任何人都能補、都能刪」的開放模式，舊入所日照同一模式。 |
| ADR 0004（開放編輯與編輯紀錄） | 會改資料 → 先選名字、寫 `v3_edit_log`；`editlog.js` 要新增一種 kind（例如 `intake: '舊入所日'`）。 |
| ADR 0009（版本包） | 新表若進 `/api/dogs`（small 包），要在 `db/compact-schema.sql` 加觸發器讓 `small` 版本號 +1，否則寫了別台看不到。目前 0009 是未提交草稿（git status `??`），要看實作時是否已上線。 |
| GLOSSARY | 「入所日」要改成「所有編號前 8 碼和補登的舊入所日裡最早的那天」；新增詞「舊入所日」（避免：人工入所日、首次入所日——後者已列在避免清單 `GLOSSARY.md:43`，要一併調整）。 |

## 5. 可行做法

### A. 前台「補入所日」存 D1，跟舊編號並列（建議）

- 新表 `v3_intake_dates(dog_id PK, intake_date TEXT 'YYYY-MM-DD', note)`，寫進 `db/compact-schema.sql`（同步會補建，#293），加 ADR 0009 的 small 版本觸發器。
- `worker/src/compact.js`：`/api/dogs` 多讀一欄 `intakeDate`（只有有值才出現，跟 `formerIds` 同做法；離所那份也要）。新增 `setIntakeDate`／`clearIntakeDate`。
- `worker/src/index.js`：`PUT/DELETE /intake/{編號}`，檢查日期合法、不在未來、**要比現編號早**（不然沒意義），選名字、限流、記編輯紀錄；`worker/src/editlog.js` 加 kind。
- 前端：`app.js` `firstIntake` 把 `dog.intakeDate` 一起比；`cards.js` `bqIntake` 同步；`reentryLine` 旁加「＋補入所日」（顯示「補登入所 2015/8/18」可刪）；`analysis.js:331` 說明文字更新。
- 優點：明確、可追查（誰補的）、跟舊編號同一套 UX 與權限；不受介紹文字寫法影響。
- 缺點：要人一隻一隻補（21 隻）；多一個欄位要維護。

### B. 從入所介紹文字自動抓最早日期

- 只改前端：`app.js`／`cards.js` 加 `introDates(intro)` 解析「YYYY/M/D」「YYYY年M月D日」「YYYY-MM-DD」，取最早一個併進 `firstIntake`。不用新表、不用新 API；改介紹（既有編輯紀錄 kind `intro`）就等於改入所日。
- 優點：改最少；#285 條列格式本來就每行開頭一個日期，正好吃得到；21 隻馬上生效。
- 缺點／風險：介紹裡的日期不一定是入所（例如「2023/02/23 被認養後退回」、「2020 年結紮」、出生年），會誤判；打錯年份（百吉、土撥鼠剛好差 365 天）直接變成排名錯，而且看不出來是被介紹改的；ADR 0005 明確拒絕過這做法。

### C. 混合：A 為準，B 只當「建議」

- A 全做；再加 B 的解析，但**不直接算入所日**，只在詳細資訊或分析頁列「介紹日期比入所日早的狗：介紹寫 2015/8/18 → 一鍵補入所日」，按了才寫入 A 的表。
- 優點：21 隻好補，又保留人為確認；打錯年份的會被人看到。
- 缺點：做最多；解析規則要維護。

### 共同規則與風險

- **跟舊編號衝突時**：一律取所有來源（現編號、舊編號、補登入所日）最早的那天，跟現行「取最舊」一致，簡單、可預期。要注意「補登日期打太早」會一直贏——靠編輯紀錄和可刪除來救。
- **打錯年份**：API 至少擋未來日期、擋晚於現編號；可加軟提示「比現編號早超過 N 年，確定？」（N 由 K 定）。百吉／土撥鼠差剛好 365 天，用 A 或 C 時要請補的人對照收容所資料，不要照介紹抄。
- **快取／版本包**：前端存好就改本機 `dog`（像 `saveFormer`）；伺服器端要靠 small 版本號觸發器，否則 Worker 記憶體快取不更新。
- **測試要補**：
  - `worker/test/d1-write.test.mjs`：補／刪入所日、格式錯、未來日、晚於現編號、編輯紀錄寫入。
  - `worker/test/d1-read.test.mjs`：`/api/dogs` 有／無 `intakeDate`、離所狗也帶。
  - `worker/test/worker.test.mjs`：路由、415、429、沒選名字。
  - `scripts/compact-schema.test.mjs`：新表與觸發器。
  - 網頁測試 `tests/index.html`（`scripts/run-browser-tests.cjs`）：`firstIntake`／`bqIntake` 三來源取最早、兩邊結果一致；B/C 的話加介紹日期解析案例（多日期、年月日中文、只有年、錯誤日期）。

### 建議

**做 A**（必要時之後再加 C 的提示）。理由：跟 ADR 0005 的精神（存 D1、誰都能補、記編輯紀錄、全站同一算法）一致，只是多一個來源；不讓介紹文字的寫法暗中改排名。B 只建議當 C 的輔助，不建議單獨上。

## 6. K 在正式站怎麼看效果

1. 開 https://bq-shelter-dogs.<子網域>.workers.dev ，先在頁首選好自己的名字。
2. 找狗搜「墨西哥」，打開詳細資訊：編號下面那行按「＋補入所日」，填 2015/8/18 儲存。
3. 看三個地方變了：詳細資訊徽章「入所 2015/8」、編號下「最早入所 2015/8/18」；分析頁在所最久排名墨西哥應升到第 1（約 4077 天）；圖鑑卡片的在所年數／等級。
4. 用另一支手機重新整理，確認也看到（驗證版本包有更新）。
5. 按 ✕ 刪掉，確認回到 2017/9 起算；編輯紀錄裡有補、刪兩筆。

## 需要 K 決定

1. 是否正式重開 ADR 0005「不另存人工入所日／不從介紹猜」這條（寫新 ADR、改 GLOSSARY「入所日」）。
2. 選 A、B 或 C。
3. 補登入所日一隻狗只能一個，還是可以多個（建議一個，取最早）。
4. 打錯年份的防呆要多嚴（只擋未來／晚於現編號，或再加「早太多要確認」）。
5. 百吉、土撥鼠要不要先查證再補。
