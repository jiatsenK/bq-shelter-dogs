-- #683：主清單新增沒編號的狗時（dog-list.js applyMain），用名字找以前記過的溜狗紀錄（dog_number='' AND dog_name=?），原本整張掃 v3_walks。
-- 部分索引只收沒編號的溜狗紀錄，很小；查詢改走索引，v3_walks 越長也不會越貴。
CREATE INDEX IF NOT EXISTS v3_walks_nameonly ON v3_walks(dog_name) WHERE dog_number='';
