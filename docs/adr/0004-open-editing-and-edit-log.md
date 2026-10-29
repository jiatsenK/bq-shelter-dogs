# 0004 開放編輯與編輯紀錄

> 2026-10-24 已由 [ADR 0020](0020-independent-admin-site.md) 修訂：新增管理網站（不再「不做管理者後台」）；志工可編輯的七類資料改由管理者各自開關，預設維持開放。
>
> 2026-10-27 修訂（#672，K 同意）：溜狗打卡也記，類型「溜了」，每筆標來源（志工網站／試算表），只在管理網站修改紀錄顯示；見下方「修訂：溜了與來源」。
>
> 2026-10-28 修訂（K 決定）：不再只增不刪，操作紀錄保留 14 天，合併狗的快照永久保留；見下方「修訂：保留 14 天」。

日期：2026-10-16（K 決定）

## 背景

休養設定、入所介紹原本要輸入通關碼（`NOTES_PASSCODE`）才能改；#143 原本打算另做管理者後台（/admin）。K 想讓大家都能直接編輯，改成事後看得到「誰做了什麼編輯」。

## 決定

- **網站上不再有通關碼**：休養、介紹、照片任何人都能改。`NOTES_PASSCODE` 從 Worker、網頁、Apps Script、文件全部拿掉。
- **廢除 #143**：不做管理者後台。
- **機器用的管理 API 改用 `ADMIN_KEY`**：`/api/admin/*`（照片搬遷、縮圖、垃圾桶還原）只給 GitHub Action 用，改看標頭 `X-Admin-Key`，值放 GitHub Secret `ADMIN_KEY`（還沒設時部署會沿用舊的 `NOTES_PASSCODE` Secret 的值）。一般人碰不到、也不用輸入。
- **`WALKER_KEY` 保留**：它是把名字換成個人代號的金鑰，不是給人輸入的通關碼；拿掉會讓所有人的代號改變。Apps Script 的 `WRITE_KEY` 一樣保留（機器對機器）。
- **要先選好身分才能編輯**：網頁送出編輯時帶 `editor`（這支手機選好的名字，`bq-walker-name`；照片是 JPEG，改放標頭 `X-Editor: encodeURIComponent(名字)`）；沒有名字 Worker 回 400、`code: 'editor'`，網頁請志工先選名字。
- **編輯紀錄存 D1 的 `v3_edit_log`**：照 ADR 0001 的「跟著代號存」，存編輯者的代號，另存當時的名字方便顯示（名字本來就公開在 /api/walkers）。每筆存改前、改後內容，出錯時看紀錄就能手動改回來。
- **記哪些**：休養、入所介紹、照片（換主照片時記垃圾桶編號，30 天內可還原）、活動紀錄（ADR 0002）、試算表備註與異動紀錄（#239、#281，走 /api/walk 的 note／log，用 walker 當編輯者）。~~溜狗打卡不記~~（2026-10-27 起改記，見下方修訂）。
- **防亂寫**：必須選身分、留改前內容、沿用現有的次數限制；不另外做審核。
- **編輯紀錄頁**：`edits.html`，列出最近的編輯（時間、誰、改了哪隻狗的什麼、改前→改後），任何人都能看。

## 寫入介面（給其他功能接上）

`worker/src/editlog.js`：

```js
import { editorOf, logEdit } from './editlog.js';

// 1. 驗證身分：傳名字字串（JSON 的 input.editor，或 editorHeader(request)），回 { code, name } 或 null（沒選名字）
const editor = await editorOf(input.editor, cfg.walkerKey);
if (!editor) return fail(400, '請先選好你的名字再編輯', origin, { code: 'editor' });

// 2. 寫入成功後記一筆；記紀錄失敗不會讓編輯失敗（只 console.error）
await logEdit(env.DB, {
  editor,              // editorOf 的結果
  kind: 'note',        // 'rest' | 'intro' | 'photo' | 'activity' | 'note' | 'sheetlog'；新種類在 KIND_LABELS 加一行
  dogId: 'xxx',        // 永久 ID，沒有就 null
  dogNumber: '123',    // 當時的編號（顯示用），沒有就 ''
  before: '舊內容',     // 任何可 JSON 的值，沒有就 null
  after: '新內容',
});
```

讀：`GET /api/edits?limit=100`（最多 500）→ `{ ok, edits: [{ id, at, editorName, editorCode, kind, dogId, dogNumber, before, after }] }`，新到舊。

## 後果

- 任何選了名字的人都能改；名字是自己選的，不是驗證過的身分，紀錄只能當線索。
- 誤改靠紀錄的改前內容手動改回；照片靠垃圾桶 30 天內還原（`/api/admin/trash`）。
- ~~`v3_edit_log` 只增不刪~~（2026-10-28 起保留 14 天，見下方修訂）。2026-10-27 起記溜狗後量會變大（每按一次溜了一列），志工網站編輯紀錄頁不列溜了、也不為此加索引（那頁之後會拿掉）。

## 修訂：溜了與來源（2026-10-27，#672）

K 要在管理網站看得出每筆溜狗登記是從哪裡來的（網站按的，還是有人直接改試算表）。

- **記哪些**：網站按「溜了」記一筆（來源志工網站）；試算表上新增或改了某天的溜狗人記一筆（來源試算表）。網站登記寫回試算表後讀回、內容一樣的不記；試算表清空日期不記；改回較早一天記成那天的溜了。撤銷、改溜狗人維持原本的 `walkundo`／`walkedit`。舊的溜狗紀錄不補。
- **內容**：類型「溜了」（kind `walk`）；操作者是溜狗的志工（一起溜就全部；試算表看不出是誰打的，只能寫表上的溜狗人）；改前是上一次哪天、誰溜的，改後是這一次。
- **在哪記**：跟今日溜狗紀錄同一批寫（`worker/src/today-walks/` 寫新版本的轉換 `version.js`：志工接受、收下人工改表、保險掃描都走它，#746）。不在狗清單同步（`dog-list.js`）記：網站寫回的值在那裡跟人工改表分不出來，會重複記。~~例外（#700）：沒有溜狗狀態的狗由狗清單同步在同一批記~~（2026-10-29 #747 起拿掉：狗清單同步在更新主清單之前把溜狗欄當成觀測值交給今日溜狗紀錄，溜狗類修改紀錄只由 module 記，不管哪個通道先到都只記一筆，見 ADR 0018 補充）。每筆照要寫的表預留寫入預算（ADR 0008；#746 起由 `today-walks/budget.js` 自動算）。
- **來源**：`v3_edit_log.source`（migration `0010_edit_log_source.sql`，沒有 CHECK，允許的值在 `worker/src/admin/edits.js` 的白名單）：`access` 管理網站、`volunteer` 志工網站、`sheet` 試算表；讀取 `COALESCE(v3_dog_edit_actors.source, v3_edit_log.source, 'legacy')`，沒有來源的舊紀錄顯示「舊紀錄」。志工網站的撤銷、改溜狗人、活動、備註、更名合併寫入時一併填 `volunteer`；自動認回所的舊編號紀錄改為 `sheet`（含 migration 補舊列）。不另加「系統自動」。
- **在哪看**：只在管理網站修改紀錄（來源篩選多「試算表」）；志工網站 `GET /api/edits` 不列溜了。


## 修訂：保留 14 天（2026-10-28）

K 留編輯紀錄是為了三件事：看有沒有人亂改、看誰在用網站、測試時對照。這三件都只需要最近的紀錄，2 週就夠；記溜狗之後量變大，不必一直留著。

- **清什麼**：`at` 超過 14 天的紀錄，連同對應的 `v3_dog_edit_actors`（外鍵指向紀錄，先刪它）。
- **不清什麼**：合併狗、取消合併（kind `merge`、`unmerge`）永久保留。被併那隻的資料只存在這份快照裡，清掉就不能取消合併；取消合併時也要看後面有沒有同一隻的合併／取消合併紀錄，兩種要一起留。
- **誰清**：只有 `worker/src/editlog.js` 的 `pruneEdits`（`worker/test/edit-log-single.test.mjs` 擋別處 `DELETE FROM v3_edit_log`），保留天數與哪些不清都寫在那裡。
- **何時清**：每天第一次保險掃描（台灣時間 09:23）順便跑，不另開排程；結果記成排程紀錄 `cron_editlog`，管理網站資料檢查看得到。
- **後果**：兩個紀錄頁只看得到 14 天內；誤改超過 14 天才發現，就沒有改前內容可對照。一天清一次、整張掃一次，表的大小維持在約 14 天份。
