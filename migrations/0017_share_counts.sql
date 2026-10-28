-- ADR 0023：分享網站的次數，每天、每種方式（分享選單／複製）一列，只記次數不記人。
CREATE TABLE IF NOT EXISTS v3_share_counts (
 day TEXT NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('share','copy')),
 count INTEGER NOT NULL CHECK(count>=1),
 PRIMARY KEY(day,method)
) WITHOUT ROWID;
-- 總數另存一列一種方式，管理網站讀總數不用整張加總（CODING_STANDARDS「不整張讀」）。
CREATE TABLE IF NOT EXISTS v3_share_totals (
 method TEXT PRIMARY KEY NOT NULL CHECK(method IN ('share','copy')),
 count INTEGER NOT NULL CHECK(count>=1)
) WITHOUT ROWID;
