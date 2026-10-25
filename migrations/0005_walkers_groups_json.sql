-- #559（#521-7，接在 #557 的 0004 之後）：「誰遛的」代號、常遛狗群改存所屬那一列的 JSON。先加後刪：這一步只加新欄／新表、從舊表搬資料、換觸發器；
-- 程式改讀寫新的，舊表 v3_sheet_main_walkers、v3_sheet_groups、v3_sheet_group_labels 先留著不讀不寫，下一張 PR 才 DROP。
-- 有搬資料，套用 workflow 會先把正式庫整份複製到 bq-shelter-dogs-backup。

-- 1. 主清單每隻狗的代號（JSON 陣列，照「誰遛的」順序），取代 v3_sheet_main_walkers 一個代號一列
ALTER TABLE v3_sheet_main ADD COLUMN walker_codes TEXT NOT NULL DEFAULT '[]';
UPDATE v3_sheet_main SET walker_codes=(SELECT json_group_array(walker_code) FROM (SELECT walker_code FROM v3_sheet_main_walkers w WHERE w.row_index=v3_sheet_main.row_index ORDER BY position))
  WHERE EXISTS(SELECT 1 FROM v3_sheet_main_walkers w WHERE w.row_index=v3_sheet_main.row_index);
-- 在所資料包讀 walker_codes：觸發條件加這一欄。搬資料時舊觸發器不看這欄，116 列不會各觸發一次；網站顯示的內容沒變，不用讓 small 加 1
DROP TRIGGER IF EXISTS packs_v3_sheet_main_UPDATE;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_main_UPDATE AFTER UPDATE OF row_index,dog_id,number,name,cage,note,walked_date,walker_codes ON v3_sheet_main BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND (OLD.row_index<>NEW.row_index OR OLD.dog_id<>NEW.dog_id OR OLD.number<>NEW.number) AND EXISTS(SELECT 1 FROM v3_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;

-- 2. 常遛狗群一欄一列：群名＋狗名（JSON 陣列，照試算表由上往下），取代 v3_sheet_groups 一隻狗一列＋v3_sheet_group_labels
CREATE TABLE IF NOT EXISTS v3_sheet_group_columns (
  column_index INTEGER PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  names TEXT NOT NULL DEFAULT '[]'
);
-- 先搬資料再建觸發器（搬的時候不用每列讓 small 加 1）。只有群名、沒有狗的欄也搬
INSERT INTO v3_sheet_group_columns(column_index,label,names)
  SELECT c.column_index,
    COALESCE((SELECT label FROM v3_sheet_group_labels l WHERE l.column_index=c.column_index),''),
    (SELECT json_group_array(name) FROM (SELECT name FROM v3_sheet_groups g WHERE g.column_index=c.column_index ORDER BY row_index))
  FROM (SELECT column_index FROM v3_sheet_groups UNION SELECT column_index FROM v3_sheet_group_labels) c;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_group_columns_INSERT AFTER INSERT ON v3_sheet_group_columns BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_group_columns_UPDATE AFTER UPDATE ON v3_sheet_group_columns BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_group_columns_DELETE AFTER DELETE ON v3_sheet_group_columns BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; END;
