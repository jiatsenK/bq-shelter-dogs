-- 現在的完整結構（#553）：改結構時新增 migrations/NNNN_*.sql，同時改這份；scripts/d1-migrations.test.mjs 檢查空庫跑完全部 migration 跟這份建出來一樣。正式庫只由「套用 D1 migration」workflow 套用，不直接執行這份。
-- #456：網站已接管的最新溜狗狀態獨立於試算表複本；舊同步不得寫入這些表。
CREATE TABLE IF NOT EXISTS v3_walk_state (
  dog_key TEXT PRIMARY KEY,
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id),
  number TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  effective_date TEXT NOT NULL,
  walker TEXT NOT NULL,
  members_json TEXT NOT NULL CHECK(json_valid(members_json)),
  base_date TEXT NOT NULL,
  base_walker TEXT NOT NULL,
  previous_date TEXT NOT NULL,
  previous_walker TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v3_walk_requests (
  request_id TEXT NOT NULL,
  dog_key TEXT NOT NULL REFERENCES v3_walk_state(dog_key),
  operation_date TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  PRIMARY KEY(request_id)
);
CREATE TABLE IF NOT EXISTS v3_walk_outbox (
  dog_key TEXT NOT NULL REFERENCES v3_walk_state(dog_key),
  version INTEGER NOT NULL,
  operation_date TEXT NOT NULL,
  target_date TEXT NOT NULL,
  target_walker TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','dispatching','unconfirmed','retry','synced','superseded')),
  next_attempt_at TEXT NOT NULL,
  dispatch_id TEXT NOT NULL DEFAULT '',
  readback_seen INTEGER NOT NULL DEFAULT 0 CHECK(readback_seen IN (0,1)),
  error TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(dog_key,version)
);
CREATE INDEX IF NOT EXISTS v3_walk_outbox_due ON v3_walk_outbox(next_attempt_at,dog_key) WHERE status IN ('pending','retry','unconfirmed');
CREATE INDEX IF NOT EXISTS v3_walk_outbox_active ON v3_walk_outbox(dog_key) WHERE status NOT IN ('synced','superseded');
CREATE INDEX IF NOT EXISTS v3_walk_outbox_readback ON v3_walk_outbox(dog_key,target_date,target_walker) WHERE readback_seen=1;
CREATE INDEX IF NOT EXISTS v3_walk_outbox_agreed ON v3_walk_outbox(dog_key,version) WHERE status='synced';
CREATE INDEX IF NOT EXISTS v3_walk_outbox_causal ON v3_walk_outbox(dog_key,target_date,target_walker,version) WHERE readback_seen=1 AND status='superseded';
CREATE INDEX IF NOT EXISTS v3_walk_outbox_unknown ON v3_walk_outbox(dog_key,target_date,target_walker,version) WHERE readback_seen=0 AND dispatch_id<>'';
CREATE INDEX IF NOT EXISTS v3_walk_outbox_unknown_date ON v3_walk_outbox(dog_key,target_date,version) WHERE readback_seen=0 AND dispatch_id<>'';
CREATE INDEX IF NOT EXISTS v3_walk_outbox_unknown_walker ON v3_walk_outbox(dog_key,target_walker,version) WHERE readback_seen=0 AND dispatch_id<>'';
-- 一致基準／已接受人工觀測的因果界線；更早歷史值不能作派送中間值授權。
CREATE TABLE IF NOT EXISTS v3_walk_baselines (
  dog_key TEXT PRIMARY KEY REFERENCES v3_walk_state(dog_key),
  version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS v3_walk_outbox_dispatch ON v3_walk_outbox(dog_key,dispatch_id) WHERE status='dispatching';
CREATE INDEX IF NOT EXISTS v3_walk_outbox_interrupted ON v3_walk_outbox(next_attempt_at,dog_key) WHERE status='dispatching';
CREATE TABLE IF NOT EXISTS v3_walk_delivery (
  dog_key TEXT PRIMARY KEY REFERENCES v3_walk_state(dog_key),
  dispatch_id TEXT NOT NULL,
  started_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS v3_walk_delivery_started ON v3_walk_delivery(started_at,dog_key);
-- #459：只保留每狗目前版本的退避計數，程序重啟後仍沿用。
CREATE TABLE IF NOT EXISTS v3_walk_retry (
  dog_key TEXT PRIMARY KEY REFERENCES v3_walk_state(dog_key),
  version INTEGER NOT NULL,
  failures INTEGER NOT NULL,
  dispatch_id TEXT NOT NULL,
  reserved_day TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v3_walk_pack (
  id INTEGER PRIMARY KEY CHECK(id=1),
  version INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload))
);
INSERT OR IGNORE INTO v3_walk_pack VALUES(1,0,'{}');
-- 交易 guard：比較版本失敗必須整筆回復，不能留下去重結果或工作。
CREATE TABLE IF NOT EXISTS v3_walk_guard (ok INTEGER NOT NULL CHECK(ok=1));
-- 保守計量包含索引與觸發器；不是帳號分析用量的替代品。
CREATE TABLE IF NOT EXISTS v3_walk_write_budget (day TEXT PRIMARY KEY, reserved INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS v3_walk_conflicts (
  dog_key TEXT PRIMARY KEY,
  observation TEXT NOT NULL CHECK(json_valid(observation)),
  error TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS walk_pack_INSERT AFTER INSERT ON v3_walk_state BEGIN
  UPDATE v3_walk_pack SET version=version+1,payload=json_set(payload,'$.'||json_quote(NEW.dog_key),json_object('key',NEW.dog_key,'version',NEW.version,'walkedDate',NEW.effective_date,'walker',NEW.walker,'at',NEW.updated_at,'syncStatus','pending')) WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS walk_pack_UPDATE AFTER UPDATE OF version,effective_date,walker,updated_at ON v3_walk_state BEGIN
  UPDATE v3_walk_pack SET version=version+1,payload=json_set(payload,'$.'||json_quote(NEW.dog_key),json_object('key',NEW.dog_key,'version',NEW.version,'walkedDate',NEW.effective_date,'walker',NEW.walker,'at',NEW.updated_at,'syncStatus',COALESCE((SELECT status FROM v3_walk_outbox WHERE dog_key=NEW.dog_key AND version=NEW.version),'pending'))) WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS walk_pack_outbox_UPDATE AFTER UPDATE OF status ON v3_walk_outbox
WHEN NEW.status<>OLD.status AND EXISTS(SELECT 1 FROM v3_walk_state WHERE dog_key=NEW.dog_key AND version=NEW.version) BEGIN
  UPDATE v3_walk_pack SET version=version+1,payload=json_set(payload,'$.'||json_quote(NEW.dog_key)||'.syncStatus',NEW.status) WHERE id=1;
END;
-- 試算表複本以來源列／欄排序保存；集合拆成列，不存 JSON。
CREATE TABLE IF NOT EXISTS v3_dogs (
  dog_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  sex TEXT NOT NULL DEFAULT '',
  fixed_care INTEGER NOT NULL DEFAULT 0 CHECK(fixed_care IN (0,1))
);
CREATE TABLE IF NOT EXISTS v3_dog_numbers (
  number TEXT PRIMARY KEY NOT NULL CHECK(length(number)>0),
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS v3_numbers_dog ON v3_dog_numbers(dog_id);
-- 常溜用名字找狗時不整張掃（#406）
CREATE INDEX IF NOT EXISTS v3_dogs_name ON v3_dogs(name);

CREATE TABLE IF NOT EXISTS v3_sheet_main (
  row_index INTEGER PRIMARY KEY,
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  number TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  cage TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  walked_date TEXT,
  walker TEXT, -- 試算表「誰遛的」原文（#519）；NULL＝還沒補填，保險掃描會要這隻
  walker_codes TEXT NOT NULL DEFAULT '[]' -- 「誰遛的」代號 JSON 陣列，照名單順序（#559，取代 v3_sheet_main_walkers）
);
CREATE INDEX IF NOT EXISTS v3_sheet_main_number ON v3_sheet_main(number);
CREATE INDEX IF NOT EXISTS v3_sheet_main_name ON v3_sheet_main(name) WHERE number='';
-- 用狗 ID 找主清單列不整張掃：開卡讀回、觸發器的 EXISTS（#555）
CREATE INDEX IF NOT EXISTS v3_sheet_main_dog ON v3_sheet_main(dog_id);
CREATE TABLE IF NOT EXISTS v3_sheet_changes (
  row_index INTEGER PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT ''
);
-- 常遛狗群一欄一列（#559）：群名（分頁最下面一列，K 2026-10-16）＋狗名 JSON 陣列（照試算表由上往下）。
-- 取代一隻狗一列的 v3_sheet_groups 和 v3_sheet_group_labels（migration 0007 刪表）。只有群名、沒有狗的欄也有一列；群名和狗都空就刪掉那列
CREATE TABLE IF NOT EXISTS v3_sheet_group_columns (
  column_index INTEGER PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  names TEXT NOT NULL DEFAULT '[]'
);

-- 每個名字直接存在溜狗紀錄；無人名的舊紀錄仍能保留。
-- dog_number／dog_name 是那天的編號和狗名（#248），狗後來改名或換編號，「我溜過」仍顯示當時的。
CREATE TABLE IF NOT EXISTS v3_walks (
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  walk_date TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  walker_name TEXT,
  walker_code TEXT,
  dog_number TEXT NOT NULL DEFAULT '',
  dog_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(dog_id,walk_date,position)
);
-- last_seen 給名字推薦排序（沿用舊 walker_names）。
CREATE TABLE IF NOT EXISTS v3_volunteers (
  volunteer_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE,
  last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v3_card_opened (
  walker_code TEXT NOT NULL,
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  opened_on TEXT NOT NULL,
  PRIMARY KEY(walker_code,dog_id)
);
CREATE TABLE IF NOT EXISTS v3_rest (
  dog_id TEXT PRIMARY KEY NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  until_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS v3_intros (
  dog_id TEXT PRIMARY KEY NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  intro TEXT NOT NULL
);

-- #285：一次入所／退回／轉所一列，保留未確認的日期與事件空白。
-- 原介紹仍留在 v3_intros，不自動解析或以編號日期覆寫。
CREATE TABLE IF NOT EXISTS v3_intake_events (
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  number TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(dog_id,position)
);


-- 離所紀錄（#259，原本的 data/departures.json）：同步發現狗從主清單消失就記一筆，原因只讀「已出所」分頁判讀。
-- last_* 是離開主清單前最後一次的樣子（離所名冊的詳細資訊用）；last_number 是 NULL 表示沒有這份資料。
-- 判讀旗標、最後的舊編號、最後的常遛狗群拆成 v3_departure_items 的列。
-- 出入所紀錄（#333，ADR 0011）：一隻狗一列，stays_json 是 [{in,out,reason}]（照入所日排）；只有補過紀錄的狗才有這一列
CREATE TABLE IF NOT EXISTS v3_stays (
  dog_id TEXT PRIMARY KEY NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  stays_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v3_departures (
  number TEXT PRIMARY KEY NOT NULL CHECK(length(number)>0),
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  departed_date TEXT,
  date_source TEXT,
  seen_date TEXT,
  reason TEXT NOT NULL DEFAULT 'unknown',
  matched TEXT NOT NULL DEFAULT '',
  returned_number TEXT,
  last_number TEXT,
  last_name TEXT,
  last_cage TEXT,
  last_walked_date TEXT,
  last_note TEXT,
  last_sex TEXT,
  last_intro TEXT
);
CREATE TABLE IF NOT EXISTS v3_departure_items (
  number TEXT NOT NULL REFERENCES v3_departures(number) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('flag','former','group')),
  position INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY(number,kind,position)
);
-- 離所改用狗 ID 記（#560，取代上面兩張與 v3_departed_cards；舊表下一張 PR 才刪，程式已不讀寫）：一隻狗一次離所一列。
-- number 是離所時的編號；'' 是沒有編號、只有名字的已出所狗卡（scripts/departed-card.mjs 建，沒有 last_*）。
-- 判讀旗標、最後的舊編號、最後的常遛狗群是 JSON 陣列（flags_json、former_json、groups_json），整組讀寫。
CREATE TABLE IF NOT EXISTS v3_dog_departures (
  dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  number TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  departed_date TEXT,
  date_source TEXT,
  seen_date TEXT,
  reason TEXT NOT NULL DEFAULT 'unknown',
  matched TEXT NOT NULL DEFAULT '',
  flags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(flags_json)),
  returned_number TEXT,
  last_number TEXT,
  last_name TEXT,
  last_cage TEXT,
  last_walked_date TEXT,
  last_note TEXT,
  last_sex TEXT,
  last_intro TEXT,
  former_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(former_json)),
  groups_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(groups_json)),
  PRIMARY KEY(dog_id,number)
);

-- 編輯紀錄（docs/adr/0004-open-editing-and-edit-log.md）：網站上的編輯誰改了什麼；只增不刪。
-- before_json／after_json 是 JSON 文字（null 表示沒有）
CREATE TABLE IF NOT EXISTS v3_edit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  editor_code TEXT NOT NULL DEFAULT '',
  editor_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  dog_id TEXT,
  dog_number TEXT NOT NULL DEFAULT '',
  before_json TEXT,
  after_json TEXT
);
-- 活動紀錄（#270，ADR 0002）：一場一列，類型固定兩種（kids＝動保小小兵、adoption＝認養會）。網站寫，同步不碰。
-- revision 每改一次加 1，兩支手機同時改時後送的會被擋下（不互相蓋掉）
CREATE TABLE IF NOT EXISTS v3_activities (
  activity_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  activity_date TEXT NOT NULL CHECK(length(activity_date)=10),
  kind TEXT NOT NULL CHECK(kind IN ('kids','adoption')),
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS v3_activities_date ON v3_activities(activity_date);
-- 出席的狗：只記出席，不記狀況。dog_id 是 NULL 表示只有名字、還沒對上狗（舊名單），之後補建狗卡再接上；name 是記的時候的名字
CREATE TABLE IF NOT EXISTS v3_activity_dogs (
  activity_id TEXT NOT NULL REFERENCES v3_activities(activity_id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  dog_id TEXT REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  PRIMARY KEY(activity_id,position)
);
CREATE INDEX IF NOT EXISTS v3_activity_dogs_dog ON v3_activity_dogs(dog_id);
-- 在 batch 內檢查活動沒被別人改過；失敗時整批回復（同 v3_identity_guard）
CREATE TABLE IF NOT EXISTS v3_activity_guard (valid INTEGER NOT NULL CHECK(valid=1));
-- 活動紀錄版本號（ADR 0009 的做法）：兩張表有新增、修改、刪除就加 1，Worker 每次只讀這 1 列，沒變就回記憶體裡的名單
CREATE TABLE IF NOT EXISTS v3_activity_versions (id INTEGER PRIMARY KEY CHECK(id=1), ver INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO v3_activity_versions(id) VALUES(1);
CREATE TRIGGER IF NOT EXISTS version_v3_activities_INSERT AFTER INSERT ON v3_activities BEGIN UPDATE v3_activity_versions SET ver=ver+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS version_v3_activities_UPDATE AFTER UPDATE ON v3_activities BEGIN UPDATE v3_activity_versions SET ver=ver+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS version_v3_activities_DELETE AFTER DELETE ON v3_activities BEGIN UPDATE v3_activity_versions SET ver=ver+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS version_v3_activity_dogs_INSERT AFTER INSERT ON v3_activity_dogs BEGIN UPDATE v3_activity_versions SET ver=ver+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS version_v3_activity_dogs_UPDATE AFTER UPDATE ON v3_activity_dogs BEGIN UPDATE v3_activity_versions SET ver=ver+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS version_v3_activity_dogs_DELETE AFTER DELETE ON v3_activity_dogs BEGIN UPDATE v3_activity_versions SET ver=ver+1 WHERE id=1; END;

-- 只有名字的已出所狗卡（#271，ADR 0002）：網站開始記錄前就離所、D1 沒有的狗，K 確認後用 scripts/departed-card.mjs 建。
-- 狗本身是 v3_dogs 一列（沒有編號）；離所日、原因不知道就留空／unknown。同步不碰
CREATE TABLE IF NOT EXISTS v3_departed_cards (
  dog_id TEXT PRIMARY KEY NOT NULL REFERENCES v3_dogs(dog_id) ON DELETE RESTRICT,
  departed_date TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT 'unknown' CHECK(reason IN ('adopt','death','other','unknown')),
  created_at TEXT NOT NULL
);
-- 已出所狗卡的出席次數跟活動用同一個版本號（v3_activity_versions），建卡也要讓它加 1
CREATE TRIGGER IF NOT EXISTS version_v3_departed_cards_INSERT AFTER INSERT ON v3_departed_cards BEGIN UPDATE v3_activity_versions SET ver=ver+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS version_v3_departed_cards_UPDATE AFTER UPDATE ON v3_departed_cards BEGIN UPDATE v3_activity_versions SET ver=ver+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS version_v3_departed_cards_DELETE AFTER DELETE ON v3_departed_cards BEGIN UPDATE v3_activity_versions SET ver=ver+1 WHERE id=1; END;

-- #267：舊代號資料保留作為待對照來源，新個人資料只由固定志工持有。
CREATE TABLE IF NOT EXISTS v3_identity_names (
 code TEXT PRIMARY KEY NOT NULL,
 name_key TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 volunteer_id TEXT NOT NULL REFERENCES v3_volunteers(volunteer_id)
);
CREATE TABLE IF NOT EXISTS v3_identity_redirects (
 volunteer_id TEXT PRIMARY KEY NOT NULL REFERENCES v3_volunteers(volunteer_id),
 target_id TEXT NOT NULL REFERENCES v3_volunteers(volunteer_id),
 CHECK(volunteer_id <> target_id)
);
CREATE TABLE IF NOT EXISTS v3_volunteer_favorites (
 volunteer_id TEXT NOT NULL REFERENCES v3_volunteers(volunteer_id),
 dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id),
 added_on TEXT NOT NULL,
 PRIMARY KEY(volunteer_id,dog_id)
);
CREATE TABLE IF NOT EXISTS v3_volunteer_cards (
 volunteer_id TEXT NOT NULL REFERENCES v3_volunteers(volunteer_id),
 dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id),
 opened_on TEXT NOT NULL,
 PRIMARY KEY(volunteer_id,dog_id)
);
CREATE TABLE IF NOT EXISTS v3_identity_operations (
 operation_id TEXT PRIMARY KEY NOT NULL,
 request_json TEXT NOT NULL,
 identity_id TEXT NOT NULL REFERENCES v3_volunteers(volunteer_id)
);
-- 在 batch 內檢查前置條件；失敗時連同編輯紀錄回復。
CREATE TABLE IF NOT EXISTS v3_identity_guard (valid INTEGER NOT NULL CHECK(valid=1));
-- 名字對照的樂觀鎖：worker/src/identity.js 的 linkIdentityName、更名、合併在自己的 batch 加 1（#556 起不用觸發器）
CREATE TABLE IF NOT EXISTS v3_identity_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT OR IGNORE INTO v3_identity_revision VALUES(1,0);

-- 今日溜狗紀錄（ADR 0007）：網站按溜了／復原寫試算表成功後，Worker 記下那隻狗在試算表的「遛狗日期」「誰遛的」現在是什麼，
-- 其他手機不用等同步就看得到。walked=0 是按了復原（狗不能再算今天溜過）。只認台灣時間今天；以前的下次寫入時清掉。
-- dog_key 跟網站 walkKey 一樣（有編號用編號，沒有用「名:犬名」）。試算表是正本，網站只採用比上次同步新的紀錄。
CREATE TABLE IF NOT EXISTS v3_today_walks (
  walk_date TEXT NOT NULL,
  dog_key TEXT NOT NULL,
  walked INTEGER NOT NULL CHECK(walked IN (0,1)),
  walked_date TEXT NOT NULL DEFAULT '',
  walker TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(walk_date,dog_key)
);

-- 資料版本號（ADR 0009）：觸發器在表有新增、修改、刪除時自動加 1，Worker 每次只讀這 1 列，沒變就回記憶體裡的資料。
-- today 對應 v3_today_walks；small／walks／live 在下面的 v3_pack_versions（#315）。
CREATE TABLE IF NOT EXISTS v3_data_versions (id INTEGER PRIMARY KEY CHECK(id=1), today INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO v3_data_versions(id) VALUES(1);
CREATE TRIGGER IF NOT EXISTS version_v3_today_walks_INSERT AFTER INSERT ON v3_today_walks BEGIN UPDATE v3_data_versions SET today=today+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS version_v3_today_walks_UPDATE AFTER UPDATE ON v3_today_walks BEGIN UPDATE v3_data_versions SET today=today+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS version_v3_today_walks_DELETE AFTER DELETE ON v3_today_walks BEGIN UPDATE v3_data_versions SET today=today+1 WHERE id=1; END;

-- 同步狀態（鍵值）：synced_at（資料更新時間，ADR 0014）、dog_list_fp／dog_list_extra（狗清單保險掃描，#501）；舊同步的 sheet_sig、walks_synced 已刪（#557）
CREATE TABLE IF NOT EXISTS v3_sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 資料包（ADR 0009，#315，worker/src/packs.js）：small（在所：狗清單、主清單上的狗的休養，存在 part=main；離所按年見最後，ADR 0014）、walks（切點以前的溜狗紀錄）算好存在 v3_packs，
-- 一律分段存（每段最多 1 MB，D1 一列上限 2 MB）。v3_pack_versions 一列：small 版本號由觸發器自動加 1。
-- 溜狗紀錄按月分段（#320）後改用 v3_walk_versions，這張表只剩 small（#354）；正式 D1 舊欄 walks／live／cutoff 由 migration 0004 整張重建拿掉（#557）。
-- 獨立一張表（不加在 v3_data_versions）：同步補建只跑 IF NOT EXISTS，不用 ALTER TABLE
CREATE TABLE IF NOT EXISTS v3_pack_versions (id INTEGER PRIMARY KEY CHECK(id=1), small INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO v3_pack_versions(id) VALUES(1);
CREATE TABLE IF NOT EXISTS v3_packs (part TEXT NOT NULL, seq INTEGER NOT NULL, ver INTEGER NOT NULL, cutoff TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, PRIMARY KEY(part,seq));
CREATE INDEX IF NOT EXISTS v3_walks_date ON v3_walks(walk_date);
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_changes_INSERT AFTER INSERT ON v3_sheet_changes BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_changes_UPDATE AFTER UPDATE ON v3_sheet_changes BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_changes_DELETE AFTER DELETE ON v3_sheet_changes BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_group_columns_INSERT AFTER INSERT ON v3_sheet_group_columns BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_group_columns_UPDATE AFTER UPDATE ON v3_sheet_group_columns BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_group_columns_DELETE AFTER DELETE ON v3_sheet_group_columns BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; END;
-- 溜狗歷史按月分段（ADR 0009，#320）：取代上面 v3_pack_versions 的 walks／live／cutoff 和 v3_packs 的 walks。
-- v3_walk_versions 一列：months 是每個月的版本號（JSON，{"2026-10":3}），觸發器依 walk_date 只讓那個月加 1；
-- total 是切點以前任何一列有變就加 1（沒變時 Worker 只讀這 1 列），live 是切點以後（今天）的列；cutoff 由 Worker 跨日時往前移。
-- v3_walk_packs：一年一份，切成每段最多 1 MB 的大列，vers 是這份用哪些月份版本號算的（每段都存同一份）
CREATE TABLE IF NOT EXISTS v3_walk_versions (id INTEGER PRIMARY KEY CHECK(id=1), total INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, cutoff TEXT NOT NULL DEFAULT '', months TEXT NOT NULL DEFAULT '{}');
INSERT OR IGNORE INTO v3_walk_versions(id) VALUES(1);
CREATE TABLE IF NOT EXISTS v3_walk_packs (year TEXT NOT NULL, seq INTEGER NOT NULL, vers TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(year,seq));
-- v3_walk_summaries（#344，ADR 0013）：跟 v3_walk_packs 同一年、同一份 vers，存「每個代號對每隻狗：幾天、第一次、最近一次」，給 /api/walks/mine
CREATE TABLE IF NOT EXISTS v3_walk_summaries (year TEXT NOT NULL, seq INTEGER NOT NULL, vers TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(year,seq));
CREATE TRIGGER IF NOT EXISTS walkpack_v3_walks_INSERT AFTER INSERT ON v3_walks BEGIN UPDATE v3_walk_versions SET total=total+(NEW.walk_date<cutoff), live=live+(NEW.walk_date>=cutoff), months=CASE WHEN NEW.walk_date<cutoff THEN json_set(months,'$."'||substr(NEW.walk_date,1,7)||'"',COALESCE(json_extract(months,'$."'||substr(NEW.walk_date,1,7)||'"'),0)+1) ELSE months END WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS walkpack_v3_walks_UPDATE AFTER UPDATE ON v3_walks BEGIN UPDATE v3_walk_versions SET total=total+(OLD.walk_date<cutoff), live=live+(OLD.walk_date>=cutoff), months=CASE WHEN OLD.walk_date<cutoff THEN json_set(months,'$."'||substr(OLD.walk_date,1,7)||'"',COALESCE(json_extract(months,'$."'||substr(OLD.walk_date,1,7)||'"'),0)+1) ELSE months END WHERE id=1; UPDATE v3_walk_versions SET total=total+(NEW.walk_date<cutoff), live=live+(NEW.walk_date>=cutoff), months=CASE WHEN NEW.walk_date<cutoff THEN json_set(months,'$."'||substr(NEW.walk_date,1,7)||'"',COALESCE(json_extract(months,'$."'||substr(NEW.walk_date,1,7)||'"'),0)+1) ELSE months END WHERE id=1 AND NOT ((OLD.walk_date<cutoff)=(NEW.walk_date<cutoff) AND (OLD.walk_date>=cutoff OR substr(OLD.walk_date,1,7)=substr(NEW.walk_date,1,7))); END;
CREATE TRIGGER IF NOT EXISTS walkpack_v3_walks_DELETE AFTER DELETE ON v3_walks BEGIN UPDATE v3_walk_versions SET total=total+(OLD.walk_date<cutoff), live=live+(OLD.walk_date>=cutoff), months=CASE WHEN OLD.walk_date<cutoff THEN json_set(months,'$."'||substr(OLD.walk_date,1,7)||'"',COALESCE(json_extract(months,'$."'||substr(OLD.walk_date,1,7)||'"'),0)+1) ELSE months END WHERE id=1; END;
-- #315 的整份 walks 資料包不再用：拿掉它的觸發器（每寫一筆少寫 1 列）和存著的資料包
DROP TRIGGER IF EXISTS pack_v3_walks_INSERT;
DROP TRIGGER IF EXISTS pack_v3_walks_UPDATE;
DROP TRIGGER IF EXISTS pack_v3_walks_DELETE;
DELETE FROM v3_packs WHERE part='walks';
-- 離所按出所年份（ADR 0014，#362，worker/src/packs.js 的 departurePacks）：v3_departure_versions 一列，years 是每年的版本號
-- （JSON，{"2026":3,"none":1}，日期不明是 none），資料包存在 v3_packs 的 departures:年。
-- 觸發器只讓改到的那幾年加 1；狗的休養、出入所紀錄、編號改了，讓這隻狗出所那幾年加 1，在主清單上才讓 small 加 1。
-- 第一次建表時從現有離所紀錄補上每年的鍵（只有這一次讀整張；之後每次同步 WHERE NOT EXISTS 先擋掉）。
-- 改觸發器內容要先 DROP：同步只跑 IF NOT EXISTS
CREATE TABLE IF NOT EXISTS v3_departure_versions (id INTEGER PRIMARY KEY CHECK(id=1), years TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS v3_departures_date ON v3_departures(departed_date);
CREATE INDEX IF NOT EXISTS v3_departures_dog ON v3_departures(dog_id);
CREATE INDEX IF NOT EXISTS v3_dog_departures_date ON v3_dog_departures(departed_date);
CREATE INDEX IF NOT EXISTS v3_dog_departures_number ON v3_dog_departures(number);
INSERT INTO v3_departure_versions(id,years) SELECT 1,(SELECT COALESCE(json_group_object(k,1),'{}') FROM (SELECT DISTINCT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END AS k FROM v3_dog_departures d)) WHERE NOT EXISTS(SELECT 1 FROM v3_departure_versions WHERE id=1);
-- 觸發器內容換了，名字改成 packs_（同步只跑 IF NOT EXISTS，同名的舊觸發器不會被換掉）；舊的 pack_ 拿掉，
-- 舊的 small 資料包（含離所）也拿掉，在所資料包改存 main。之後每次同步這幾行都沒東西可刪
DROP TRIGGER IF EXISTS pack_v3_sheet_main_INSERT;
DROP TRIGGER IF EXISTS pack_v3_sheet_main_UPDATE;
DROP TRIGGER IF EXISTS pack_v3_sheet_main_DELETE;
DROP TRIGGER IF EXISTS pack_v3_intros_INSERT;
DROP TRIGGER IF EXISTS pack_v3_intros_UPDATE;
DROP TRIGGER IF EXISTS pack_v3_intros_DELETE;
DROP TRIGGER IF EXISTS pack_v3_sheet_main_walkers_INSERT;
DROP TRIGGER IF EXISTS pack_v3_sheet_main_walkers_UPDATE;
DROP TRIGGER IF EXISTS pack_v3_sheet_main_walkers_DELETE;
DROP TRIGGER IF EXISTS pack_v3_dog_numbers_INSERT;
DROP TRIGGER IF EXISTS pack_v3_dog_numbers_UPDATE;
DROP TRIGGER IF EXISTS pack_v3_dog_numbers_DELETE;
DROP TRIGGER IF EXISTS pack_v3_sheet_groups_INSERT;
DROP TRIGGER IF EXISTS pack_v3_sheet_groups_UPDATE;
DROP TRIGGER IF EXISTS pack_v3_sheet_groups_DELETE;
DROP TRIGGER IF EXISTS pack_v3_sheet_changes_INSERT;
DROP TRIGGER IF EXISTS pack_v3_sheet_changes_UPDATE;
DROP TRIGGER IF EXISTS pack_v3_sheet_changes_DELETE;
DROP TRIGGER IF EXISTS pack_v3_sheet_group_labels_INSERT;
DROP TRIGGER IF EXISTS pack_v3_sheet_group_labels_UPDATE;
DROP TRIGGER IF EXISTS pack_v3_sheet_group_labels_DELETE;
DROP TRIGGER IF EXISTS pack_v3_departures_INSERT;
DROP TRIGGER IF EXISTS pack_v3_departures_UPDATE;
DROP TRIGGER IF EXISTS pack_v3_departures_DELETE;
DROP TRIGGER IF EXISTS pack_v3_departure_items_INSERT;
DROP TRIGGER IF EXISTS pack_v3_departure_items_UPDATE;
DROP TRIGGER IF EXISTS pack_v3_departure_items_DELETE;
DROP TRIGGER IF EXISTS pack_v3_rest_INSERT;
DROP TRIGGER IF EXISTS pack_v3_rest_UPDATE;
DROP TRIGGER IF EXISTS pack_v3_rest_DELETE;
DROP TRIGGER IF EXISTS pack_v3_intake_events_INSERT;
DROP TRIGGER IF EXISTS pack_v3_intake_events_UPDATE;
DROP TRIGGER IF EXISTS pack_v3_intake_events_DELETE;
DROP TRIGGER IF EXISTS pack_v3_stays_INSERT;
DROP TRIGGER IF EXISTS pack_v3_stays_UPDATE;
DROP TRIGGER IF EXISTS pack_v3_stays_DELETE;
DELETE FROM v3_packs WHERE part='small';
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_main_INSERT AFTER INSERT ON v3_sheet_main BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_main_UPDATE AFTER UPDATE OF row_index,dog_id,number,name,cage,note,walked_date,walker_codes ON v3_sheet_main BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND (OLD.row_index<>NEW.row_index OR OLD.dog_id<>NEW.dog_id OR OLD.number<>NEW.number) AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_sheet_main_DELETE AFTER DELETE ON v3_sheet_main BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1; UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_intros_INSERT AFTER INSERT ON v3_intros BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_intros_UPDATE AFTER UPDATE ON v3_intros BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_intros_DELETE AFTER DELETE ON v3_intros BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_numbers_INSERT AFTER INSERT ON v3_dog_numbers BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_numbers_UPDATE AFTER UPDATE ON v3_dog_numbers BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_numbers_DELETE AFTER DELETE ON v3_dog_numbers BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=OLD.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_departures_INSERT AFTER INSERT ON v3_departures BEGIN UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"'),0)+1) WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_departures_INSERT AFTER INSERT ON v3_dog_departures BEGIN UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"'),0)+1) WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_departures_UPDATE AFTER UPDATE ON v3_departures BEGIN UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"'),0)+1) WHERE id=1; UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"'),0)+1) WHERE id=1 AND (CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END)<>(CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_departures_UPDATE AFTER UPDATE ON v3_dog_departures BEGIN UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"'),0)+1) WHERE id=1; UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END||'"'),0)+1) WHERE id=1 AND (CASE WHEN COALESCE(NEW.departed_date,'')='' THEN 'none' ELSE substr(NEW.departed_date,1,4) END)<>(CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_departures_DELETE AFTER DELETE ON v3_departures BEGIN UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"'),0)+1) WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dog_departures_DELETE AFTER DELETE ON v3_dog_departures BEGIN UPDATE v3_departure_versions SET years=json_set(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"',COALESCE(json_extract(years,'$."'||CASE WHEN COALESCE(OLD.departed_date,'')='' THEN 'none' ELSE substr(OLD.departed_date,1,4) END||'"'),0)+1) WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS packs_v3_departure_items_INSERT AFTER INSERT ON v3_departure_items BEGIN UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_departures d WHERE d.number=NEW.number))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_departures d WHERE d.number=NEW.number); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_departure_items_UPDATE AFTER UPDATE ON v3_departure_items BEGIN UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_departures d WHERE d.number=OLD.number))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_departures d WHERE d.number=OLD.number); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_departures d WHERE d.number=NEW.number))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_departures d WHERE d.number=NEW.number); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_departure_items_DELETE AFTER DELETE ON v3_departure_items BEGIN UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_departures d WHERE d.number=OLD.number))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_departures d WHERE d.number=OLD.number); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_rest_INSERT AFTER INSERT ON v3_rest BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_rest_UPDATE AFTER UPDATE ON v3_rest BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_rest_DELETE AFTER DELETE ON v3_rest BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=OLD.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_intake_events_INSERT AFTER INSERT ON v3_intake_events BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_intake_events_UPDATE AFTER UPDATE ON v3_intake_events BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_intake_events_DELETE AFTER DELETE ON v3_intake_events BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=OLD.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_stays_INSERT AFTER INSERT ON v3_stays BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_stays_UPDATE AFTER UPDATE ON v3_stays BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id IN (OLD.dog_id,NEW.dog_id)); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id IN (OLD.dog_id,NEW.dog_id)); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_stays_DELETE AFTER DELETE ON v3_stays BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=OLD.dog_id); UPDATE v3_departure_versions SET years=(SELECT json_group_object(j.key, j.value+(j.key IN (SELECT CASE WHEN COALESCE(d.departed_date,'')='' THEN 'none' ELSE substr(d.departed_date,1,4) END FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id))) FROM json_each(years) j) WHERE id=1 AND EXISTS(SELECT 1 FROM v3_dog_departures d WHERE d.dog_id=OLD.dog_id); END;
-- #399：只有網站設定改變才讓在所包失效；同步更新名字／性別不觸發。
CREATE TRIGGER IF NOT EXISTS packs_v3_dogs_INSERT AFTER INSERT ON v3_dogs BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dogs_UPDATE AFTER UPDATE OF fixed_care,sex ON v3_dogs WHEN OLD.fixed_care<>NEW.fixed_care OR OLD.sex<>NEW.sex BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=NEW.dog_id); END;
CREATE TRIGGER IF NOT EXISTS packs_v3_dogs_DELETE AFTER DELETE ON v3_dogs BEGIN UPDATE v3_pack_versions SET small=small+1 WHERE id=1 AND EXISTS(SELECT 1 FROM v3_sheet_main WHERE dog_id=OLD.dog_id); END;
-- #565：單列設定；同一 UPDATE 觸發可靠前後紀錄，失敗一併回復。
CREATE TABLE IF NOT EXISTS v3_feature_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision INTEGER NOT NULL CHECK(revision>=1),
 values_json TEXT NOT NULL CHECK(json_valid(values_json)),
 actor_subject TEXT NOT NULL DEFAULT '',
 actor_email TEXT NOT NULL DEFAULT '',
 changed_at TEXT NOT NULL DEFAULT '',
 request_id TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO v3_feature_settings(id,revision,values_json) VALUES(1,1,'{"showActivities":true,"showQuality":true,"showUpdates":true,"editIntro":true,"editPhoto":true,"editRest":true,"editActivity":true,"editFixedCare":true,"editStays":true,"editFormer":true}');
CREATE TABLE IF NOT EXISTS v3_feature_settings_log (
 revision INTEGER PRIMARY KEY,
 before_json TEXT NOT NULL,
 after_json TEXT NOT NULL,
 actor_subject TEXT NOT NULL,
 actor_email TEXT NOT NULL,
 changed_at TEXT NOT NULL,
 request_id TEXT NOT NULL UNIQUE
);
CREATE TRIGGER IF NOT EXISTS feature_settings_audit AFTER UPDATE ON v3_feature_settings BEGIN
 INSERT INTO v3_feature_settings_log(revision,before_json,after_json,actor_subject,actor_email,changed_at,request_id)
 VALUES(NEW.revision,OLD.values_json,NEW.values_json,NEW.actor_subject,NEW.actor_email,NEW.changed_at,NEW.request_id);
END;
