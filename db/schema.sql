-- 板收志工溜狗表的資料庫（Cloudflare D1，SQLite 語法）。K 2026-10-10 同意的第 2 步：
-- 資料從「repo 裡的 JSON 檔＋每天一整份快照」搬進資料庫，改成「現況＋異動紀錄」。
-- 試算表還是主人：同步程式讀試算表，只把有變的欄位寫進 dogs，同時在 changes 記一筆。
-- 這個檔可以重複執行（IF NOT EXISTS）；欄位要改時另外加 db/migrations/。

-- 狗的現況：一隻一列。key 是編號；沒有編號的列（還沒建檔、暫住標記）用「名:犬名」，跟網站的 walkKey 一樣
CREATE TABLE IF NOT EXISTS dogs (
  key             TEXT PRIMARY KEY,
  id              TEXT NOT NULL DEFAULT '',           -- 編號（前 8 碼是入所日期）；沒有就空字串
  name            TEXT NOT NULL,
  sex             TEXT NOT NULL DEFAULT '',           -- male／female／空
  cage            TEXT NOT NULL DEFAULT '',
  note            TEXT NOT NULL DEFAULT '',           -- 試算表備註
  intro           TEXT NOT NULL DEFAULT '',           -- 入所介紹（dogs/{編號}.md 的內文）
  covered         INTEGER NOT NULL DEFAULT 0,         -- 有人固定照顧
  walked_date     TEXT,                               -- 上次溜（YYYY-MM-DD）
  walkers         TEXT NOT NULL DEFAULT '[]',         -- 上次是誰溜的：代號的 JSON 陣列，不存名字
  status          TEXT NOT NULL DEFAULT 'in' CHECK (status IN ('in', 'departed')),
  departed_date   TEXT,                               -- 離所日期
  departed_reason TEXT,                               -- adopt／death／other／unknown
  departed_source TEXT,                               -- 日期哪裡來的（seen：從試算表消失那天…）
  rest_until      TEXT,                               -- 休養中到哪天（含）
  rest_reason     TEXT,
  sort            INTEGER NOT NULL DEFAULT 0,         -- 在試算表上的順序
  updated_at      TEXT NOT NULL                       -- 這一列最後一次變動（ISO 時間）
);
CREATE INDEX IF NOT EXISTS dogs_status ON dogs (status, sort);

-- 溜狗紀錄：某天某隻狗被溜（同一天溜幾次算一筆，誰溜的以最後一次為準）
CREATE TABLE IF NOT EXISTS walks (
  dog_key  TEXT NOT NULL,
  date     TEXT NOT NULL,                             -- YYYY-MM-DD
  name     TEXT NOT NULL DEFAULT '',                  -- 當時的犬名（狗離所後還看得到是誰）
  walkers  TEXT NOT NULL DEFAULT '[]',                -- 代號的 JSON 陣列
  PRIMARY KEY (dog_key, date)
);
CREATE INDEX IF NOT EXISTS walks_date ON walks (date);

-- 異動紀錄：某一欄被改了一次。還原就是把 old 寫回去（第 3 步）
CREATE TABLE IF NOT EXISTS changes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL,                             -- 什麼時候（ISO 時間）
  dog_key  TEXT NOT NULL,
  name     TEXT NOT NULL DEFAULT '',                  -- 當時的犬名
  field    TEXT NOT NULL,                             -- name／cage／note／sex／intro／covered／status／rest
  old      TEXT,                                      -- 改之前（NULL＝原本沒有這隻）
  new      TEXT,                                      -- 改之後
  by       TEXT NOT NULL DEFAULT '',                  -- 誰改的（網站上選的名字的代號；不知道就空）
  source   TEXT NOT NULL                              -- sheet（試算表同步）／site（網站）／import（舊快照轉進來）
);
CREATE INDEX IF NOT EXISTS changes_dog ON changes (dog_key, at);
CREATE INDEX IF NOT EXISTS changes_at ON changes (at);

-- 其他零散的資料：可以一起溜的分組（groups）、試算表下面那段異動備註（sheetNotes）、上次同步時間（syncedAt）
CREATE TABLE IF NOT EXISTS kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                           -- JSON
  updated_at TEXT NOT NULL
);
