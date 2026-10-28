# 架構圖跟著程式更新：自動產生、CI 核對與版本顯示（2026-10-28）

> **2026-10-28 更新（K 決定，推翻第 5 點與第 6 節「手工圖保留、不導入 Mermaid」）**：架構圖改成跟 K 其他專案同一套，只留一份 `docs/ARCHITECTURE.md`，照 agent-hub `docs/rules/architecture-diagrams.md` 用 Mermaid 畫；`docs/diagrams/*.html` 七張手工圖刪除。原因：所有專案用同一套畫法與格式，agent-hub 的專案總覽頁才能直接讀進來對照，不用為這個專案另外維護一種圖。事實核對（第 3 節）與 PR 提醒（第 5 節做法）照舊，改成讀 `docs/ARCHITECTURE.md`；管理網站（第 2.4 節表格第 3 列的做法）在建置時用無頭瀏覽器把 Mermaid 畫成 SVG、樣式拆成外部 CSS。以下內容保留當時的研究原文。

2026-10-28（台灣時間）。問題（K）：`docs/diagrams/` 的 6 張架構圖（architecture、environments、writeback-sequence、sheet-sync-sequence、daily-schedule、data-flows）是 AI 手工排版的 HTML/SVG。希望程式或設定改了，圖能跟著改；做不到的話，至少在圖上看得到「放上去的日期＋第幾版」。這些圖之後要放進管理網站（`admin/public/`）。

只讀研究，沒有改任何既有檔案、沒有 commit、沒有開瀏覽器。程式以 `main`（`8cca77b`）為準，行號都是這一版的行號。外部說法附官方文件或原始碼連結；標「推論」的是我依來源推出來、還沒實測的。

---

## 結論（摘要）

1. **沒有現成工具能「讀 wrangler.jsonc／Apps Script 就自動長出這種圖」。** Mermaid、D2、Structurizr 都是「人寫文字描述 → 工具排版成圖」，描述本身還是要有人（或 AI）寫；要從設定檔自動產生，得自己寫轉換腳本，而且只能產生「有哪些盒子、叫什麼名字」，流程順序與白話說明產生不出來。排版品質也比現在的手工圖差，D2 最好的排版引擎 TALA 是付費閉源的。
2. **管理網站的 CSP 會擋掉現在的圖。** `ADMIN_CSP` 是 `style-src 'self'`、`font-src 'self'`（`worker/src/admin/index.js:17`），而 6 張圖都用 `<style>` 內嵌樣式＋Google Fonts（例如 `docs/diagrams/daily-schedule.html:7-8`、`:70-85`）。不管選哪種做法，放上管理網站前都要把樣式搬到外部 `.css`、字型改成系統字或自架。
3. **CI 核對做得到，而且 repo 已有先例。** `worker/test/walk-edit-rows.test.mjs:107-109` 已經在比對 wrangler 的 crons。圖上大約 25 個「名字、時間、次數」可以這樣比；箭頭方向、先後順序、白話說明比不了。
4. **用 git 推算版號在部署時會算錯。** 管理網站部署用 `actions/checkout@v4` 沒設 `fetch-depth`（`.github/workflows/deploy-admin.yml:48`），預設只抓 1 個 commit，`git log` 數出來永遠是 1、日期永遠是最新 commit 的日期。
5. **建議組合：手工圖保留＋圖檔內手寫版號與日期＋CI 事實核對＋PR 提醒重畫。** 理由與待決定事項見第 6、7 節。

---

## 1. 現況

| 項目 | 事實 | 來源 |
|---|---|---|
| 圖的格式 | 6 個獨立 HTML，每個內含一張 inline SVG；頁首 `<style>`、SVG `<defs>` 裡又有一段 `<style>`，字型從 Google Fonts 載入 | `docs/diagrams/daily-schedule.html:7-8`、`:70-85`（其他 5 張同結構，例如 `architecture.html:7-8`、`:70-79`） |
| 圖上已有的版本線索 | 每張圖底下的說明寫「依程式碼核對（main c2da5f0）」，是手寫的 | `architecture.html:249`、`daily-schedule.html:195`、`writeback-sequence.html:198` 等 |
| 圖的 git 紀錄 | 只有兩次：`fc54caa`（#723）、`8cca77b`（#727） | `git log -- docs/diagrams` |
| 管理網站建置 | `wrangler deploy` 前先跑 `node scripts/build-admin-assets.mjs`，目前只複製 4 支共用 JS 與 `website-updates.json` 到 `admin/public/shared/` | `wrangler.admin.jsonc:14`；`scripts/build-admin-assets.mjs:28-36` |
| 複製出來的檔不進 git | `admin/public/shared/` 在 `.gitignore` | `.gitignore:18` |
| `build.command` 何時跑 | `wrangler dev` 與 `wrangler deploy` 都會先跑 | [Cloudflare：Custom builds](https://developers.cloudflare.com/workers/wrangler/custom-builds/) |
| 管理網站部署在哪跑 | GitHub Actions，只能手動、只部署 main | `.github/workflows/deploy-admin.yml:14-15`、`:27`、`:68` |
| 管理網站 CSP | 所有回應（含靜態檔）都加上 `ADMIN_CSP`，沒有 `_headers` 檔 | `worker/src/admin/index.js:17`、`:27`、`:118-121`；`admin/public/` 沒有 `_headers` |
| 管理頁面寫法 | 外部 CSS（`vendor/tabler.min.css`、`admin.css`）＋外部 module script，沒有內嵌樣式 | `admin/public/releases.html:7-9` |
| 測試已用真的 CSP 跑管理頁 | Playwright 測試回應時帶 `ADMIN_CSP` | `tests/admin-dog-edit.cjs:8`、`:39` |
| Apps Script 怎麼上線 | repo 只有 `apps-script/sheet-write.gs`，沒有 clasp，靠人工貼上 | `apps-script/` 目錄只有這一個檔 |

### 1.1 CSP 會擋什麼

- `style-src` 沒有 `'unsafe-inline'`（也沒有 nonce／hash）時，`<style>` 元素與 `style="…"` 屬性都會被擋；不在允許清單的外部樣式表（例如 `fonts.googleapis.com`）也會被擋。來源：[MDN：CSP style-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src)。
- 所以把現在的 HTML 原樣複製到 `admin/public/`：頁面排版（`.frame`、`h1`）和 SVG 文字的字型、字級（`.n`、`.s`、`.zh` 等 class）都會失效，文字會用瀏覽器預設字級，標籤會互相重疊。**推論**，依上面的 MDN 規則與 `ADMIN_CSP`；要用 `tests/admin-dog-edit.cjs:39` 同樣的方式實測確認。
- 不受影響的：SVG 的展示屬性（`fill="#2d3142"`、`font-size="8"` 這類寫在標籤上的屬性，不是 CSS）。`daily-schedule.html:228`、`architecture.html:228` 已有這種寫法。
- 解法（任何方案都要做）：建置時把兩段 `<style>` 抽成 `admin/public/diagrams/diagrams.css`，HTML 改用 `<link rel="stylesheet">`；拿掉 Google Fonts，改用 `admin.css` 已在用的字型或系統字。

---

## 2. 做法一：Diagrams-as-code 從程式碼／設定自動產生

### 2.1 三種工具各自是什麼

| 工具 | 輸入 | 輸出 | 跟這個 repo 的關係 | 來源 |
|---|---|---|---|---|
| Mermaid | 人寫的 `.mmd` 文字 | 瀏覽器內即時畫成 SVG；或用 mermaid-cli 轉成 SVG/PNG/PDF | mermaid-cli 透過 Puppeteer／headless Chromium 渲染；README 自己提醒內嵌 CSS 可能被網站的 CSP 擋 | [mermaid-cli README](https://github.com/mermaid-js/mermaid-cli) |
| D2 | 人寫的 `.d2` 文字 | SVG/PNG | 排版引擎 dagre（預設）、ELK 免費；TALA 專為軟體架構圖設計，但**閉源，沒授權會加浮水印，商用要授權**，要另外安裝外掛 | [D2 Layouts](https://d2lang.com/tour/layouts/)、[TALA repo](https://github.com/terrastruct/TALA) |
| Structurizr（C4） | 人寫的 Structurizr DSL，描述 C4 模型 | 可匯出 PlantUML、C4-PlantUML、Mermaid、WebSequenceDiagrams、靜態網站／PNG／SVG | 適合「系統—容器—元件」分層的大型架構；這個 repo 只有 2 個 Worker、1 個 D1、1 個 R2、1 份 GAS，分層用不太到 | [Structurizr DSL](https://docs.structurizr.com/dsl) |

### 2.2 能不能從 wrangler.jsonc、Apps Script 自動長出圖

**不能直接做到。** 三種工具都沒有讀 `wrangler.jsonc` 或 `.gs` 的功能，輸入都是人寫的描述檔（見上表來源）。要自動化得自己寫一支腳本：讀設定檔 → 產生 `.mmd`／`.d2` → 再交給工具排版。這支腳本能拿到的東西：

| 能從設定檔取出 | 來源 |
|---|---|
| Worker 名稱 `bq-shelter-dogs`、`bq-shelter-dogs-admin`、`bq-shelter-dogs-test`、`bq-shelter-dogs-preview` | `wrangler.jsonc:8`、`wrangler.admin.jsonc:9`、`wrangler.test-site.jsonc:10`、`wrangler.preview-db.jsonc:6` |
| D1 名稱與綁定 `DB` | `wrangler.jsonc:21-26`、`wrangler.admin.jsonc:21-25`、`wrangler.test-site.jsonc:25-26` |
| R2 名稱與綁定 `PHOTOS` | `wrangler.jsonc:19`、`wrangler.admin.jsonc:26`、`wrangler.test-site.jsonc:23` |
| 排程 crons（UTC） | `wrangler.jsonc:41-43`、`wrangler.test-site.jsonc:39`、`wrangler.preview-db.jsonc:9` |
| vars（`SYNC_DAILY_BUDGET` 等） | `wrangler.jsonc:27-36` |
| GAS 時間觸發 | 不在設定檔，寫在程式裡：`apps-script/sheet-write.gs:305-314`（`everyMinutes(10)`、`[[9, 43], [13, 53], [23, 53]]`），要用正規表示式從程式碼抓 |

**取不出來的**：Worker 會不會呼叫 GAS、GAS 會不會打回 Worker、寫回的先後順序（`/target` → 寫表 → `/receipt`）、「先寫 D1」「失敗不重試」這種行為規則、例外情況。這些只存在於程式邏輯裡（例如 `worker/src/index.js:857` 的路由清單只給得出端點名，給不出誰先誰後），自動腳本產生不了，還是要人或 AI 讀程式後寫進描述檔。另外 GAS 的觸發實際裝了什麼要看 Google 那邊最後一次跑 `installWalkEditTriggers` 的結果，repo 看不到。

### 2.3 排版品質與白話說明

- 自動排版（dagre／ELK／Mermaid 內建）只保證「不重疊、方向一致」，不會照「志工在左、Google 在右、Cloudflare 在中間」這種為了好懂而刻意安排的位置。現在 6 張圖有分區（`architecture.html:95`、`:99` 的 CLOUDFLARE／GOOGLE）、時間軸（`daily-schedule.html:147-181`）、泳道（`data-flows.html:103-112`），用自動排版很難還原。**推論**，依 [D2 Layouts](https://d2lang.com/tour/layouts/) 對各引擎「layered/hierarchical」的描述。
- 白話說明（例如 `sheet-sync-sequence.html:181`「網站新增的備註、異動紀錄，要等下一次保險掃描才進 D1，最久約 10 小時」）可以寫成標籤或註解，但那是人寫在描述檔裡的，不是自動產生的。也就是說：**換成 diagrams-as-code，維護工作從「改 SVG」變成「改描述檔」，沒有消失。**
- 時間軸那張（daily-schedule）三種工具都沒有對應的圖型；Mermaid 有 gantt／timeline，但做不出現在「兩條泳道＋固定／約略時刻」的樣子。**推論**。

### 2.4 在管理網站的 CSP 下能不能顯示

| 方式 | 能不能 | 理由 |
|---|---|---|
| 瀏覽器裡跑 Mermaid（把 mermaid.js 放 `vendor/`） | script 可以（`script-src 'self'`）；樣式很可能被擋 | Mermaid 畫出的 SVG 會帶 `<style>`，`style-src 'self'` 擋內嵌樣式（[MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src)；mermaid-cli README 也提醒內嵌 CSS 可能被 CSP 擋）。**推論**，需實測 |
| 建置時先轉成 SVG 檔，網頁用 `<img src="x.svg">` 顯示 | 很可能可以，但要實測 | SVG 當圖片載入時不執行 script；但管理 Worker 對 SVG 回應也會加 CSP（`worker/src/admin/index.js:27`、`:118-121`），SVG 檔內的 `<style>` 會不會被擋要在 Chromium 實測 |
| 建置時轉 SVG，再把 `<style>` 抽成外部 CSS | 可以 | 跟手工圖要做的處理一樣 |
| 在 GitHub Actions 部署時跑 mermaid-cli | 可以但重 | 要裝 Puppeteer＋Chromium；管理網站部署 job 時限 10 分鐘（`deploy-admin.yml:29`），repo 也已經碰過安裝逾時（#659、#713，commit `7ae7fbb`） |

**小結**：diagrams-as-code 解決的是「圖是文字、diff 看得懂、AI 好改」，不是「程式改了圖自動對」。對這個 repo，它比現在手工圖多了工具依賴、排版變差，換來的自動化很有限。

---

## 3. 做法二：CI 事實核對（node --test）

### 3.1 怎麼做

- 新增 `scripts/diagram-facts.test.mjs`：讀 `docs/diagrams/*.html` 抽出 `<text>` 內容，讀 `wrangler*.jsonc`、`worker/src/*.js`、`apps-script/sheet-write.gs`，逐項比對。`scripts/run-node-tests.mjs` 會自動找 `scripts/` 底下所有 `*.test.mjs`（`scripts/run-node-tests.mjs:1-2`、`:22`），不用改清單。
- 先例：`worker/test/walk-edit-rows.test.mjs:107-109` 已經在比對兩份 wrangler 的 crons；`worker/test/test-site.test.mjs:37-38` 讀 wrangler 做比對；`tests/index/hosting.js:54-62` 也讀 `wrangler.jsonc`。
- 比較穩的做法：每張圖加一段機器可讀的事實清單（例如 `<script type="application/json" id="diagram-facts">`，不會執行，CSP 不擋；或 `data-fact="cron.scan"` 屬性），測試比對清單與設定檔，再檢查清單裡的值確實出現在圖上的文字裡。這樣不必用正規表示式猜 SVG 文字的意思。

### 3.2 目前圖上可以比對的事實

| 圖上寫的 | 位置 | 對照的設定／程式 | 怎麼比 |
|---|---|---|---|
| Worker `bq-shelter-dogs` | `architecture.html:178`、`environments.html:140`、`writeback-sequence.html:159` | `wrangler.jsonc:8` | 字串相等 |
| Worker `bq-shelter-dogs-admin` | `architecture.html:187`、`environments.html:149` | `wrangler.admin.jsonc:9` | 字串相等 |
| Worker `bq-shelter-dogs-test` | `environments.html:176` | `wrangler.test-site.jsonc:10` | 字串相等 |
| Worker `bq-shelter-dogs-preview` | `environments.html:185` | `wrangler.preview-db.jsonc:6` | 字串相等 |
| D1 `bq-shelter-dogs` | `architecture.html:196`、`environments.html:158` | `wrangler.jsonc:23`、`wrangler.admin.jsonc:23` | 字串相等 |
| R2 `bq-shelter-photos` | `architecture.html:205`、`environments.html:158` | `wrangler.jsonc:19`、`wrangler.admin.jsonc:26` | 字串相等 |
| 測試 D1 `bq-shelter-dogs-test` | `environments.html:194` | `wrangler.test-site.jsonc:26` | 字串相等 |
| 測試 R2「photos-test」 | `environments.html:194` | `wrangler.test-site.jsonc:23` 是 `bq-shelter-photos-test` | **圖上是縮寫，直接比會失敗**；要嘛圖改全名，要嘛事實清單另記全名 |
| 正式「2 個排程」、測試「1 個排程」、預覽與管理網站沒有排程 | `environments.html:141`、`:177`；`daily-schedule.html:195` | `wrangler.jsonc:42`（2 個）、`wrangler.test-site.jsonc:39`（1 個）、`wrangler.preview-db.jsonc:9`（空）、`wrangler.admin.jsonc` 沒有 `triggers` | 數 crons 陣列長度 |
| 每 10 分鐘、每小時 :05 起 | `daily-schedule.html:112`、`writeback-sequence.html:179` | `wrangler.jsonc:42` 的 `5-59/10 * * * *`；`worker/src/index.js:27` | cron 字串解析 |
| 09:23、13:23、23:23 今日溜狗掃描 | `daily-schedule.html:121`、`:125`、`:129`；`architecture.html:153` | `wrangler.jsonc:42` 的 `23 1,5,15 * * *`（UTC＋8 換算）；`worker/src/index.js:28` | UTC 小時＋8 後比對 |
| GAS 每 10 分鐘補送 | `daily-schedule.html:114`、`architecture.html:214` | `apps-script/sheet-write.gs:311`、`:313` 的 `everyMinutes(10)` | 正規表示式抓程式 |
| 約 09:43、13:53、23:53 狗清單掃描 | `daily-schedule.html:137`、`:141`、`:145`；`architecture.html:215` | `apps-script/sheet-write.gs:314` 的 `[[9, 43], [13, 53], [23, 53]]` | 正規表示式抓程式 |
| 錯開 20～30 分鐘 | `daily-schedule.html:118` | 上面兩組時間相減（20、30、30 分） | 計算 |
| 最久約 10 小時才進 D1 | `sheet-sync-sequence.html:181` | 23:53 到隔天 09:43 約 9 小時 50 分 | 計算（容許「約」） |
| 每月 1 日清照片垃圾桶、30 天以上 | `daily-schedule.html:134`、`architecture.html:154` | `worker/src/index.js:799-801`（掃描那次順便清）、`worker/src/r2.js:10` 的 `TRASH_DAYS = 30` | 常數比對；「每月 1 日」在 `trashDue` 裡，要讀函式 |
| 重試間隔 1、2、4、8、15 分鐘 | `writeback-sequence.html:179` | `worker/src/walk-accept.js:357` 的 `[1,2,4,8,15]` | 正規表示式抓陣列 |
| 第 10 次失敗就停 | `writeback-sequence.html:180` | `worker/src/walk-accept.js:254` 的 `RETRY_LIMIT = 10` | 常數比對 |
| 每輪最多 10 隻、合併每批最多 10 隻 | `daily-schedule.html:112`、`writeback-sequence.html:198` | `worker/src/walk-retry.js:20` 的 `LIMIT 10`；`worker/src/walk-accept.js:248` 的 `Math.min(10, …)` | 正規表示式，較脆弱 |
| 端點 `/target`、`/receipt`、`/observe`、`/rows`、`/dog-list`、`/dog-list-scan` | `writeback-sequence.html:134`、`:142`、`:181`；`sheet-sync-sequence.html:134`、`:142`、`:146` | `worker/src/index.js:857` 的路由清單 | 圖上每個端點都要在清單裡 |
| GAS 動作 `walkWake`、`walkWakeBatch` | `writeback-sequence.html:132`、`:198` | `worker/src/sheet-write.js:6` 的 `SHEET_ACTIONS` | 集合包含 |
| 待通知 `WALK_EDITS_PENDING`、`DOG_LIST_PENDING` | `sheet-sync-sequence.html:199` | `apps-script/sheet-write.gs:278`、`:437` | 字串出現 |
| PR 加 `preview` 標籤 | `environments.html:186` | `.github/workflows/preview-cloudflare.yml:39-40` | 字串出現 |
| 寫 `sheet-write.gs` | `architecture.html:213` 等 | 檔案 `apps-script/sheet-write.gs` 存在 | 檔案存在 |

### 3.3 比不了的

- **箭頭方向與連到誰**：例如「Apps Script → 志工網站」那條（`architecture.html:140`）。程式裡沒有一份「誰呼叫誰」的清單可以比；硬要比只能維護一份手寫的「邊清單」，那其實就是在重寫圖。
- **先後順序**：寫回的 `/target` → 寫表 → 讀回 → `/receipt`（`writeback-sequence.html:126-146`），只存在於程式流程中。
- **白話說明與例外規則**：「先寫 D1」「失敗不重試」「保險掃描只補不刪」（`sheet-sync-sequence.html:182`）、「管理網站與 PR 預覽都不連試算表」（`environments.html:131`）。後者勉強可比（管理網站設定沒有 `SHEET_WRITE_URL`），但大部分是行為描述。
- **漏畫**：測試只能確認「圖上寫的對不對」，抓不到「程式新增了東西、圖上根本沒畫」。例如新增第 3 個 cron，數量那項會失敗；但新增一個新的 GAS 端點，除非測試反過來要求「路由清單每個都要出現在某張圖上」，否則不會發現。
- **線上實況**：GAS 實際裝的觸發、Cloudflare 實際的 cron，以 repo 為準，不保證跟線上一樣（GAS 靠人工貼上，`apps-script/` 沒有 clasp）。

### 3.4 小結

可比的約 25 項，正好是最容易「改了設定忘了改圖」的部分（名稱、時間、次數）。測試失敗時錯誤訊息要寫白話，例如「daily-schedule 圖寫 09:23，但 wrangler.jsonc 的掃描排程換算是 10:23，請重畫排程圖」，K 才看得懂。

---

## 4. 做法三：版本與日期顯示

### 4.1 git 推算（建置時跑 `git log -1 --format=%cI -- 檔案`、`git rev-list --count HEAD -- 檔案`）

- 管理網站部署 job 用 `actions/checkout@v4`，沒設 `fetch-depth`（`deploy-admin.yml:48`）。actions/checkout 預設 `fetch-depth: 1`，「只抓觸發 workflow 的那一個 commit」；`0` 才是全部歷史。來源：[actions/checkout v4 README](https://github.com/actions/checkout/tree/v4)。
- 淺層 clone 的歷史會被截到指定的 commit 數。來源：[git-clone `--depth`](https://git-scm.com/docs/git-clone)。
- 結果（**推論**，依上述兩份文件）：在部署機上，每張圖的 `git log -1 -- 檔案` 都會回最新那個 main commit（因為它是唯一的 commit，所有檔案都「在這裡出現」），日期就是部署當下 main 的日期；`rev-list --count` 永遠是 1。**圖沒改也會顯示今天的日期、第 1 版，比不顯示還誤導。**
- 要修就在 `deploy-admin.yml` 的 checkout 加 `fetch-depth: 0`。代價：多抓整個歷史（repo 目前 700 多個 PR，量不大）；另外 `build.command` 在本機 `wrangler dev` 與測試（`scripts/admin-stage4.test.mjs:3-4`、`scripts/run-browser-tests.cjs:48` 也會呼叫 `buildAdminAssets`）也會跑，測試結果會隨 git 狀態變，worktree 或沒有 git 的環境要有退路。
- 「第幾版」用 commit 數的問題：任何碰到圖檔的 commit 都算一版，包括只改錯字、改顏色；squash merge 後一個 PR 算一版還算直觀，但 K 看到「第 7 版」不知道哪一版改了什麼。
- 另一個坑：這次研究的圖是 `docs/diagrams/`，若之後建置改成複製到 `admin/public/diagrams/`（跟 `admin/public/shared/` 一樣進 `.gitignore:18`），git 指令一定要對 `docs/diagrams/` 的原檔下，不能對複製出來的檔。

### 4.2 圖檔內手寫 meta

- 每張圖頭部加例如 `<meta name="diagram-version" content="3">`、`<meta name="diagram-date" content="2026-10-28">`、`<meta name="diagram-checked" content="main 8cca77b">`。建置腳本讀這三個值，寫進圖頁上方或管理網站的圖片清單頁。現在圖底下已經有手寫的「依程式碼核對（main c2da5f0）」（例如 `architecture.html:249`），等於已經在做，只是沒有版號、沒有給機器讀。
- 好處：部署環境無關（淺層 clone 也對）、版號只在「內容真的改了」時才升、日期是「AI 核對程式的日期」而不是「搬檔案的日期」，對 K 的意義比較正確。
- 壞處：會忘記升。用測試補：
  - **測試 A（只看檔案本身，在任何環境都能跑）**：`diagram-checked` 寫的 commit 之後，若 `wrangler*.jsonc`、`apps-script/sheet-write.gs` 等相關檔有變動，提醒重新核對。這需要 git 歷史，CI 的 `tests.yml` 也是 `actions/checkout@v4` 預設深度（`.github/workflows/tests.yml:39`），一樣只有 1 個 commit。
  - **測試 B（PR 比對，建議）**：在 PR 上比對 base 與 head：圖檔內容（扣掉 meta）有變，`diagram-version` 就要比 base 大、`diagram-date` 要更新。PR 的 diff 可以用 `git diff origin/main...HEAD`，但同樣需要 `fetch-depth: 0` 或另外 `git fetch origin main`；或改在 `pr-guard` 那種 workflow 用 GitHub API 取 PR 改動檔案清單（`.github/workflows/pr-guard.yml:24-32` 用 `gh` 已有權限）。
- 版號不怕寫錯的折衷：版號手寫，日期也手寫，但測試只要求「內容變了就要 +1、日期不能早於上一版」，不檢查日期是否等於今天。

### 4.3 比較

| | git 推算 | 圖檔內手寫 meta＋測試 |
|---|---|---|
| 部署時（淺層 clone） | 預設會算錯，要改 `deploy-admin.yml` | 不受影響 |
| 本機、測試環境 | 跟 git 狀態綁在一起 | 不受影響 |
| 「版」的意義 | 每個碰到檔案的 commit | 只有刻意升版才算 |
| 日期的意義 | 最後一次改檔 | 最後一次核對程式 |
| 會不會忘 | 不會忘 | 會忘，靠 PR 測試擋 |
| 需要的改動 | build 腳本＋deploy workflow | build 腳本＋6 張圖加 meta＋一支測試 |

---

## 5. 做法四：混合方案（手工圖＋相關檔案變更時提醒重畫）

- **流程規定**：在 `docs/agents/` 或 `AGENTS.md` 的依任務載入表加一列：改到 `wrangler*.jsonc`、`apps-script/sheet-write.gs`、`worker/src/index.js` 的 `scheduled`／路由、`.github/workflows/deploy-*.yml` 時，要一起檢查對應的圖並升版。成本最低，但靠 AI 每次記得。
- **CI 偵測**：照 `pr-guard` 的模式（開 PR 時檢查、在 PR 留言提醒、不擋合併，`.github/workflows/pr-guard.yml:1-4`），新增一項：PR 改到相關檔、卻沒改對應的圖，就留言列出「這幾張圖可能要重畫」。需要一份對照表（哪個檔影響哪張圖），例如：

| 改到 | 可能要重畫 |
|---|---|
| `wrangler.jsonc` 的 `triggers` | daily-schedule、architecture、environments |
| `wrangler*.jsonc` 的 `name`、`d1_databases`、`r2_buckets` | architecture、environments |
| `apps-script/sheet-write.gs` | sheet-sync-sequence、writeback-sequence、daily-schedule、data-flows |
| `worker/src/walk-accept.js`、`walk-retry.js` | writeback-sequence |
| `worker/src/dog-list.js`、`walk-reconcile.js` | sheet-sync-sequence、data-flows |
| `.github/workflows/deploy-*.yml`、`preview-cloudflare.yml`、`seed-preview-db.yml` | environments |

- **限制**：會有「改了但不影響圖」的誤報（例如只改註解）；留言不擋合併，K 不一定會注意；重畫本身還是要人叫 AI 做，CI 不能自己重畫（重畫需要讀懂程式，不適合放進每次 CI）。
- `pr-guard` 不跑 `synchronize`（`pr-guard.yml:4`），PR 後續推送不會重新提醒；若要加在這裡，要接受只在開 PR 與改內文時檢查。

---

## 6. 建議組合

**手工圖保留＋圖檔內手寫 meta（版號、日期、核對的 commit）＋CI 事實核對＋PR 提醒重畫。不導入 Mermaid／D2／Structurizr。**

理由：

1. **自動產生解決不了真正的問題。** K 要看懂的是「誰呼叫誰、先後順序、例外」，這些都不在設定檔裡（第 2.2 節），自動產生只拿得到盒子名稱，而且排版變差、多一個工具依賴（第 2.3、2.4 節）。
2. **最常過時的事實可以機器擋。** 名字、時間、次數約 25 項（第 3.2 節），設定改了測試就紅，錯誤訊息直接說哪張圖要改。這是「圖跟著程式更新」裡唯一能真正自動的部分。
3. **比不了的部分，用版號＋日期誠實告知。** 顯示「第 3 版 · 2026-10-28 核對 main 8cca77b」，K 自己判斷新不新。手寫 meta 不受部署淺層 clone 影響（第 4.1 節），意義也比 git 日期正確。
4. **重畫的時機靠 PR 提醒。** 沿用 `pr-guard` 不擋合併的習慣，只提醒。
5. **放上管理網站一定要先處理 CSP**（第 1.1 節）：建置時把 `<style>` 抽成外部 CSS、去掉 Google Fonts，並用既有的 `ADMIN_CSP` Playwright 測試模式（`tests/admin-dog-edit.cjs:39`）確認圖顯示正常。

建議實作順序（每步可以各自一個 PR）：

1. 6 張圖改成外部 CSS、系統字，加 meta；`build-admin-assets.mjs` 複製到 `admin/public/diagrams/`（進 `.gitignore`），加一頁圖片清單顯示版號與日期；Playwright 在 `ADMIN_CSP` 下截圖檢查。
2. `scripts/diagram-facts.test.mjs`：第 3.2 節的事實核對，順便修 `environments.html:194` 的「photos-test」縮寫。
3. PR 提醒：對照表＋`pr-guard` 留言；或先只寫進 AGENTS.md 流程規定，觀察一陣子再決定要不要上 CI。

---

## 7. 還沒解決、需要 K 決定的事

1. **「第幾版」怎麼算？** 手寫版號（只有刻意重畫才 +1）或 git commit 數（碰到檔就算，部署 workflow 要改 `fetch-depth: 0`）。建議前者。
2. **日期要顯示哪一個？**「最後核對程式的日期」或「最後改檔的日期」。兩者常常一樣，但只改錯字時不同。
3. **字型。** 去掉 Google Fonts 後，圖上的英文等寬字（Geist Mono）、標題襯線字（Instrument Serif）會換成系統字，看起來會跟現在不一樣。可接受，或要把字型檔自架到 `admin/public/`（`font-src 'self'` 允許）？自架要確認字型授權。
4. **事實核對失敗要不要擋合併？** 擋（測試紅了就不能 merge，最可靠，但只改設定的小 PR 也得一起重畫圖）或只提醒。
5. **PR 提醒要不要上 CI？** 或先只寫進 AGENTS.md 的流程規定。
6. **`docs/diagrams/` 與管理網站，哪個是正本？** 建議 `docs/diagrams/` 是正本、管理網站建置時複製（跟 `website-updates.json` 一樣，`scripts/build-admin-assets.mjs:34-35`）。但管理網站只能手動部署（`deploy-admin.yml:14-15`），圖改了要記得按部署，線上才會更新。
7. **管理網站上的圖要不要顯示「目前線上程式版本」做對照？** 部署訊息已記 `main <sha>`（`deploy-admin.yml:61`、`:68`），可以一併顯示「這次部署是 main xxx，圖核對的是 main yyy」，兩者差很多就代表圖可能過時。要不要做由 K 決定。
