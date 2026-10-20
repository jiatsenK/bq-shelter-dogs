# 2026-10-20 預覽測試庫補「有人固定照顧」

- Agent：Claude Code。
- 依據：K 回報預覽溜狗表「沒有紀錄」的狗排到最上面，指出是有人固定照顧的狗。固定照顧是網站寫進正式庫的（#399），試算表沒有，測試庫全部是 0。
- 改動：
  - 新增 `scripts/copy-fixed-care.mjs`：正式庫只送 SELECT 取固定照顧的編號，用編號對到測試庫的狗再更新（含取消）；沒有編號的狗對不到。
  - `.github/workflows/seed-preview-db.yml`：匯入後加「測試庫補固定照顧」，最後加「核對測試庫」（只讀，印主清單、沒日期、溜狗紀錄、固定照顧筆數）。
  - `docs/setup/CLOUDFLARE_SETUP.md` 補一句。
- 測試（先紅後綠）：`scripts/copy-fixed-care.test.mjs`。
- 未完成：合併後要再跑一次「準備預覽資料庫」。休養、介紹、開卡、照片設定仍不會進預覽。
