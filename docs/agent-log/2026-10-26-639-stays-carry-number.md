# #639 出入所紀錄每筆帶編號（ADR 0021）

- 日期：2026-10-26。Agent：Claude（Opus 5.5）。分支 `claude/639-stays-carry-number`（worktree `.scratch/639-worktree`，從 origin/main `70ff450`；共用目錄停在 `claude/test-site`，照 workflow 另開 worktree）。
- 依據：#639、ADR 0021（K 2026-10-26）、K 決定兩個志工編輯開關合成「出入所紀錄」。
- 存法決定：`v3_stays` 不換結構，每筆可帶 `number`；畫面上的出入所表由 `worker/src/stays.js` 的 `stayTable` 讀時合成（每個編號一列＋沒編號的手填；有離所紀錄的編號出所日、原因照離所）。舊資料（入所日跟某編號同一天）讀時接到那個編號，不搬資料。理由：舊版管理網站（手動部署）在新舊程式並存時仍讀得懂；不用 DROP／搬資料，ADR 說的「先加後刪兩張 PR」就沒有第二張要做。
- 觸發器：原本打算寫 migration 讓離所紀錄改了時 small 失效，實測發現既有 `dog_edit_v3_dog_departures_*` → revision → `packs_v3_dog_edit_state_UPDATE` 已經涵蓋（small 與這隻狗每一年的離所資料包），撤掉 migration，改用 `packs.test.mjs` 鎖住這件事。
- 做了：
  - Worker：`stays.js`（`stayTable`、`cleanStayTable`、`storedStays`、`joinStays`、`readStayTables`、`sameStays`）；`dog-edit.js` 快照 `stays` 改成出入所表、存 `stays` 同一筆交易補刪編號（目前編號、有離所紀錄的編號不能刪）；`index.js` 的 `/stays` 比對改前的表；`compact.js` 資料包帶出入所表；`dog-merge.js` 兩邊出入所紀錄接在一起、預覽拿掉「會丟掉的出入所紀錄」、取消合併放回留下那隻原本那列；`feature-settings.js` 拿掉 `editFormer`（讀到舊的那個鍵就丟掉，`/former` 看 `editStays`）。
  - 管理網站：抽屜「編號」欄拿掉，「出入所紀錄」改成帶編號的表；設定頁剩一個「出入所紀錄」。
  - 志工網站：詳細資訊的「舊編號」一行換成編號下面的出入所表（`detail-stays.js`），補刪舊編號改在表單新增、刪除那一列；刪掉 `detail-former.js`、`BQApi.saveFormer`。入所介紹閱讀列表照舊只列手填的紀錄。
  - 文件：`docs/operations/dog-editing.md` 新增「出入所紀錄」一節、合併規則；`feature-settings.md`、`docs/design/admin.md`、ADR 0020／0021 狀態、`ARCHITECTURE_NOW.md`。
- 測試：新增 `worker/test/stays.test.mjs`；改 `dog-edit`、`dog-merge`、`d1-read`、`d1-write`、`packs`、`feature-settings`、`feature-setting-keys`、`admin-table` 與網頁測試 `admin-dog-edit`、`index`（rest／app-layout／app-core）、`intake-presentation`、`feature-settings`。
- 兩軸審查（Standards／Spec 子代理）後補修：
  - 「舊資料接到編號」原本每次讀都套用，新填的沒編號列若剛好跟某編號同一天會被併掉（有離所時手填內容會不見、志工下次存會 409）。改成新寫入的沒編號列存 `number: ''`，只有舊格式（沒有 number 鍵）才接。
  - 取消合併：留下那隻合併後又改過出入所表時，拿掉被併那隻的手填紀錄與編號那幾筆（`withoutStays`），不讓兩隻重複。
  - 「不能刪」改用 `conflict` 旗標回 409，不靠錯誤文字；管理網站改用 `BQDates.idDay`；刪掉沒人用的 `.former-form`／`.former-del` CSS；`public/js/README.md` 的 dates.js 列補上；ADR 0021 後果補一句「沒有搬資料、不用 migration」的實作說明。
  - 審查提到但沒改：在所的狗只有一個編號、沒有其他紀錄時不畫表，只留「＋補出入所紀錄」入口（跟原本舊編號一行的做法一樣）；有離所紀錄的編號不能刪（試算表「已出所」對到的編號，刪了會對不到那次離所）；`/former` 舊路由留給舊網頁；離所原因照 GLOSSARY 寫「死亡」，詳細資訊既有的離所徽章仍寫「離世」，同一頁會兩種寫法，沒在本票改。
- K 2026-10-26 改規則：原因欄是入所原因（#390 2026-10-19 就答過，ADR 0021 原本寫錯方向）。研究 `docs/research/2026-10-26-intake-reason-source.md`（背景研究員）：試算表沒有入所原因欄，入所事件內容混雜，介紹文字 ADR 0011 不准自動抓，所以入所原因手填。改成：離所紀錄只帶出所日，離所原因放 `departure`、畫面寫在出所日旁；有離所紀錄的那列也能填入所原因並存起來；兩個網站欄名改「入所原因」。ADR 0021、GLOSSARY 跟著修。建議值、6～7 筆舊資料重放另開票。
- 沒做／要 K：正式資料 `editStays` 與 `editFormer` 是否一樣（沒查正式 D1）；部署（志工站合併後自動、管理站要按「部署管理網站」）；正式資料實測墨西哥、納卡西、合併。
- 相關 PR：還沒開。
