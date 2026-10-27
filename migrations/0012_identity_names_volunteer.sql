-- #680：依志工找名字（身分查詢、合併預覽的溜狗數）原本整張掃，加索引改成直接找；照 code 排好，查詢不用另外排序。
CREATE INDEX IF NOT EXISTS v3_identity_names_volunteer ON v3_identity_names(volunteer_id, code);
