# 2026-10-30 待核對的狗記成已出所（#784）

- Agent：Claude Code（Opus 5.5），分支 `claude/pending-discharge-records-833c5e`。
- 依據：K 回報資料頁待核對四隻都是已出所的狗、什麼都不能按；研究 `docs/research/2026-10-30-pending-review-discharged-dogs.md`；K 2026-10-30 選「兩個都做」；ADR 0026。

## 做了什麼

- `worker/src/dog-depart.js`：待核對判斷（`pendingDog`）、寫離所紀錄的一句 `INSERT…SELECT`（`last_*` 從狗資料、`v3_sheet_gone`、`v3_walks` 抄）、管理者記成已出所 `departDog`（日期、原因、revision、仍是待核對，同一批記修改紀錄 `depart`）。
- `worker/src/dog-list.js` `applyDeparted`：主清單複本找不到、也沒有這個編號的離所紀錄時，用編號找到待核對的狗照樣記離所。
- 管理 API `POST /api/manage/dogs/{dogId}/depart`；修改紀錄種類 `depart`（記成已出所）與顯示文字。
- 管理網站：待核對的狗名下「記成已出所」開抽屜；抽屜新段落 `admin/public/js/dog-depart.js`（手填出所日帶進來當預設，按兩次才寫）；資料頁說明補上。
- 文件：ADR 0026、0025 加修訂註記與已知限制、GLOSSARY 待核對、dog-editing、ARCHITECTURE_NOW、ARCHITECTURE（流程說明、元件圖）、admin/README、ADR 索引。
- 測試：`worker/test/pending-depart.test.mjs`（同步晚到的已出所列、管理 API 的檢查與紀錄）；`scripts/adr-index.test.mjs` 改成 0025 → 0026。

## 例外與未完成

- 沒有新 migration：離所紀錄既有觸發器讓資料包與 revision 失效。
- 記成已出所沒有撤銷；記錯可在出入所表改離所日，整筆拿掉要另開票。
- 部署後要 K 在資料頁把那四隻記成已出所。豆花的編號（2026091401 或 2026092401）、2021100407 是哪隻狗，研究裡列給 K 核對。
- 沒查正式 D1。
