# 0004 開放編輯與編輯紀錄

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
- **記哪些**：休養、入所介紹、照片（換主照片時記垃圾桶編號，30 天內可還原）、活動紀錄（ADR 0002）、試算表備註（#239）。**溜狗打卡不記**（量大，試算表本身就有）。
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
  kind: 'note',        // 'rest' | 'intro' | 'photo' | 'activity' | 'note'；新種類在 KIND_LABELS 加一行
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
- `v3_edit_log` 只增不刪，量不大（不記溜狗）。
