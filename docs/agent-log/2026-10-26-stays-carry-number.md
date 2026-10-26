# ADR 0021：一個編號就是一筆出入所紀錄

- 日期：2026-10-26。Agent：Claude（Opus 5.5）；分支 `claude/stays-number`，基準 origin/main `c2ae88f`。
- 依據：K 2026-10-26 發現管理網站合併重複的狗後舊編號「消失」，指出編號跟出入所紀錄本來是同一件事；K 選「改資料結構」，並回答四個邊界問題（入所日固定用編號日期、出所日有離所就自動帶、入所日跟編號日期一樣的舊紀錄自動接上、志工網站一起改）。
- 查到的現況：編號（`v3_dog_numbers`）、離所（`v3_dog_departures`）、出入所紀錄（`v3_stays`）分三處；`worker/src/dog-merge.js` 合併時出入所紀錄只留一份，留下那隻有就丟掉被併那隻的。測試庫 `bq-shelter-dogs-test` 唯讀查：7 隻有出入所紀錄，6 筆是有編號之前的那次，納卡西一筆跟編號 2026042101 重複。
- 變更（只有文件，不改程式）：新增 `docs/adr/0021-stays-carry-number.md`；ADR 0005（入所日）、0011 開頭加「已由 ADR 0021 修訂」；重新產生 `docs/adr/README.md`；`GLOSSARY.md` 改「出入所紀錄」「入所日」；`docs/agents/data-changes.md` 入所日那列加 0021。
- 實作的票：[#639](https://github.com/jiatsenK/bq-shelter-dogs/issues/639)。
- 未做：實作、migration；ADR 0020 志工編輯開關「出入所紀錄」「舊編號」要不要合成一個，待 K 決定。
- 相關 PR：[#640](https://github.com/jiatsenK/bq-shelter-dogs/pull/640)，草稿。
