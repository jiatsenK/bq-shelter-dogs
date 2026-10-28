-- #672：修改紀錄每筆記來源（access＝管理網站、volunteer＝志工網站、sheet＝試算表），讓管理網站分得出「溜了」是網站按的還是試算表改的。
-- 不加 CHECK（之後要改允許的值不用重建表）；允許的值在程式白名單（worker/src/admin/edits.js 的 SOURCES）。
-- 舊紀錄維持 NULL：讀取時 COALESCE(v3_dog_edit_actors.source, v3_edit_log.source, 'legacy')，沒來源的照舊顯示「舊紀錄」。
ALTER TABLE v3_edit_log ADD COLUMN source TEXT;
-- 試算表（自動認回所）的舊編號紀錄是狗清單同步照試算表記的，來源改成試算表；其他舊紀錄不補
UPDATE v3_edit_log SET source='sheet' WHERE kind='former' AND editor_name='試算表（自動認回所）';
