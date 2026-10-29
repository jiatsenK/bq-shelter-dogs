-- #747：活動、志工身分、狗資料的 guard 在 #751 改走有條件 batch（worker/src/conditional-batch.js）後就沒有程式用了（#751 已於 2026-10-29 部署）。
-- 三張都是永遠空的表，刪掉不會少資料。
DROP TABLE IF EXISTS v3_activity_guard;
DROP TABLE IF EXISTS v3_identity_guard;
DROP TABLE IF EXISTS v3_dog_edit_guard;
