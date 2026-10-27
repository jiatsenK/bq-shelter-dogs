# 身分查詢合併、名字表索引與切回網頁同步常溜節流（稽核第 4 項）

日期：2026-10-27｜唯讀研究，不改程式、不部署、不開 Issue。
來源：`docs/research/2026-10-27-d1-efficiency-audit.md` 第 4 項（在 `claude/d1-efficiency-audit` 分支）。

## 結論

1. **加索引 `v3_identity_names(volunteer_id, code)` 是必要的**：現在依 `volunteer_id` 找名字是整張掃（`SCAN … USING INDEX sqlite_autoindex_v3_identity_names_1`，只是借主鍵索引排序）；加索引後變成 `SEARCH … (volunteer_id=?)`，而且順序已照 `code` 排好，不用另外排序。〔本機 SQLite 查詢計畫〕
2. **4 句可以合成 1 句**，查詢計畫 4 段全是 `SEARCH`（前提是先加上面的索引；沒加索引，合併後最後一段仍是 `SCAN`）。合併前要先加索引，順序不能反。〔本機 SQLite〕
3. **切回網頁的觸發量比稽核寫的多**：一次切回會打 `POST /api/identity`（解析名字：1 句代號查詢＋`identityOf` 3 句）＋`GET` 常溜（`identitiesForCodes` 每個代號 4 句），也就是至少 8 句身分查詢，手機有多個代號時再加 4×代號數。節流一次就省掉這整組。〔程式碼〕
4. **節流間隔建議 5 分鐘**，比稽核提的 10 分鐘短，理由見下方取捨；按「同步」鈕、恢復連線、自己改常溜一律不受節流。

## 現況（程式碼）

- `worker/src/identity.js:9-21`：`identityByCode` 依代號查人 → `identityOf` 再查轉址、查志工、查名字，共 4 次往返。
- `worker/src/identity.js:30-34`：`linkIdentityName` 代號已存在時再呼叫 `identityOf`（又 3 句）。
- `worker/src/identity.js:83-89`：`identitiesForCodes` 逐代號呼叫 `identityByCode`，代號數 × 4 句，且是循序 `await`。
- `public/js/app.js:1314`：`visibilitychange` 只要回到前景就呼叫 `syncFavs()`，沒有時間判斷。
- `public/js/favorites.js:108-124`：`syncFavs` 先 `refreshIdentity`（`POST /api/identity`），再 `reconcileFavorites` 讀常溜（`GET` 常溜，Worker 端走 `identitiesForCodes`）。
- schema（`migrations/0000_compact_schema.sql:329`）：`code` 是主鍵、`name_key` UNIQUE，`volunteer_id` 沒有索引。
- 同一份 `v3_identity_names WHERE volunteer_id=?` 也出現在 `identity.js:91`（合併預覽的溜狗數），加索引後子查詢變成 `COVERING INDEX`。

## 查詢計畫驗證（本機 SQLite）

方法：Node 24 內建 `node:sqlite`（:memory:），依序套用 `migrations/*.sql`，塞 300 位志工與名字後 `ANALYZE`，再 `EXPLAIN QUERY PLAN`。腳本內容見文末。

| 查詢 | 加索引前 | 加索引後 |
|---|---|---|
| `SELECT code,name FROM v3_identity_names WHERE volunteer_id=? ORDER BY code` | `SCAN v3_identity_names USING INDEX sqlite_autoindex_…_1` | `SEARCH … USING INDEX v3_identity_names_volunteer (volunteer_id=?)` |
| 合併後 1 句（下節） | 前 3 段 `SEARCH`，最後 `SCAN n` | 4 段全 `SEARCH` |
| 合併預覽的溜狗數子查詢 | 子查詢整張掃 | 子查詢 `COVERING INDEX`；外層 `SCAN v3_walks` 是另一題，不在本項 |

D1 依「讀到的列數」計費，整張掃會把表內每一列都算進去；官方建議對常用的 `WHERE` 欄位建索引，代價是每次寫入要多維護索引（Cloudflare D1 文件：Pricing — rows read／rows written；Best practices — Use indexes）。`v3_identity_names` 只在登記新名字、更名、合併時寫入，頻率很低，索引的寫入成本可以忽略。

## 4 句合 1 句的寫法

```sql
WITH start AS (SELECT volunteer_id FROM v3_identity_names WHERE code=?1),
 id AS (SELECT COALESCE(r.target_id, s.volunteer_id) AS vid
        FROM start s LEFT JOIN v3_identity_redirects r ON r.volunteer_id = s.volunteer_id)
SELECT v.volunteer_id, v.name, n.code, n.name AS alias
FROM id JOIN v3_volunteers v ON v.volunteer_id = id.vid
LEFT JOIN v3_identity_names n ON n.volunteer_id = id.vid
ORDER BY n.code;
```

- 回傳多列（每個名字一列），JS 端取第一列的 `volunteer_id`、`name`，`codes`／`names` 從各列收集，回傳形狀與現在的 `identityOf` 一樣。
- 本機驗證：把 v1 轉址到 v2、名字改掛 v2 後，用 v1 的代號查得到 v2 與兩個名字，結果正確。
- 錯誤訊息要保留：現在「代號不存在」回 409（請重新設定登記名字），「轉址後找不到志工」回 404。合 1 句後查不到列一律是空結果，要分辨的話把 `JOIN v3_volunteers` 改成 `LEFT JOIN` 並多選 `start.volunteer_id`，或接受兩種都回 409。這是實作時要決定的小事，建議沿用 409/404 的分辨。
- 轉址只追一層，跟現在 `identityOf` 一樣；`mergeIdentity` 合併時會把指向來源的轉址改指目標（`identity.js:131`），所以一層就夠。
- `identitiesForCodes` 可以改成一次 `WHERE code IN (…)`，或至少用 `db.batch` 把多個代號的單句查詢一次送出（D1 的 `batch` 一次往返、依序執行）。
- `linkIdentityName` 代號已存在的分支，可以直接用這 1 句取代「查代號＋`identityOf`」。

## 切回網頁的節流

**觸發來源**：`visibilitychange` 在切換分頁、切 App、鎖螢幕再打開時都會觸發（WHATWG HTML 規格 Page Visibility 一節）。志工在收容所會一直切相機、LINE 再切回來，所以觸發頻率高；10/27 的實測裡 `identity.js:19` 跑 72 次、`v3_identity_redirects` 被查 184 次，主要來自這裡。

**要同步的資料會怎麼變**：
- 自己在這支手機改常溜：寫入時就送 Worker，畫面本地先更新，不需要靠切回來同步。
- 別台裝置（例如另一支手機）改常溜：才需要靠切回來拉。
- 身分（更名、合併）：在「我是誰」操作的那支手機當下就更新；別台要靠下次同步。這類事一位志工一年也沒幾次。

**取捨**：

| 間隔 | 效果 | 代價 |
|---|---|---|
| 不節流（現況） | 別台裝置改的常溜切回就看到 | 每次切回至少 8 句身分查詢＋常溜讀取 |
| 5 分鐘（建議） | 一次溜狗（約 15–30 分鐘）中切回多次只同步 1–2 次 | 跨裝置最多慢 5 分鐘 |
| 10 分鐘（稽核原提案） | 省更多 | 志工同時用兩台時，可能整趟溜狗都看不到另一台的修改 |

建議 5 分鐘：跨裝置改常溜本來就少見，同一人同時拿兩台更少；5 分鐘已能擋掉「切相機拍照再回來」這種幾秒到幾十秒的連續觸發，多數節省都來自這種情況，從 5 拉到 10 分鐘多省的有限〔推估，未實測〕。

**一定要繞過節流的情況**：
- 按「同步」鈕、`online` 事件（恢復連線）、開網頁第一次載入。
- 有排隊中、上次失敗的常溜寫入要重送（`syncFavs` 的註解寫明失敗的操作靠下次打開或恢復連線再試）——節流不能讓重試等太久。
- 換了身分（`loadMyCodes()` 變了）。

**記錄位置**：上次同步時間放記憶體就夠（網頁重開本來就會同步）；不需要寫 localStorage。

## 預期效益與風險

- 效益〔推估〕：節流擋掉大部分切回觸發；剩下的同步每次身分查詢從 8 句以上降到 2 句（解析名字 1 句＋常溜 1 句），合起來切回網頁造成的身分查詢可望少八成以上。實際數字要上線後用同一套 D1 查詢統計重量。
- 風險：跨裝置最多慢 5 分鐘；合 1 句時錯誤碼分辨要小心；索引要用新 migration 加，不要改 `0000`。
- 不衝突：ADR 0005 的規則（固定身分、轉址、合併確認）都不變，只換查法；不需要新 ADR，也不改 `GLOSSARY.md`。

## 缺口

- 沒有拿正式 D1 跑查詢計畫；本機 SQLite 版本與 D1 可能不同，上線前用 `wrangler d1 execute --command "EXPLAIN QUERY PLAN …"` 對正式 schema 再看一次。
- 5 分鐘是依使用情境推估，沒有切回間隔的實測分布；若要更準，可以先在前端記一週切回間隔再定。
- 沒有查 `public/js/cards.js:664` 開卡流程的 `refreshIdentity` 呼叫頻率，它也會打 `POST /api/identity`，可一併受惠於合 1 句。

## 重跑方式

在 repo 根目錄執行（Node 22.5 以上）：

```js
// plan.mjs
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const db = new DatabaseSync(':memory:');
for (const f of fs.readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync('migrations/' + f, 'utf8'));
const v = db.prepare('INSERT INTO v3_volunteers(volunteer_id,name,last_seen) VALUES(?,?,?)');
const n = db.prepare('INSERT INTO v3_identity_names(code,name_key,name,volunteer_id) VALUES(?,?,?,?)');
for (let i = 0; i < 300; i++) { v.run('v' + i, 'n' + i, 'x'); n.run(i.toString(16).padStart(12, '0'), 'k' + i, 'n' + i, 'v' + i); }
db.exec('ANALYZE');
const plan = sql => console.log(db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(r => r.detail));
plan('SELECT code,name FROM v3_identity_names WHERE volunteer_id=? ORDER BY code');
db.exec('CREATE INDEX v3_identity_names_volunteer ON v3_identity_names(volunteer_id, code); ANALYZE');
plan('SELECT code,name FROM v3_identity_names WHERE volunteer_id=? ORDER BY code');
```

## 來源

- 程式碼：`worker/src/identity.js`、`worker/src/index.js:684-697`、`worker/src/compact.js:118-139`、`public/js/app.js:1312-1315`、`public/js/favorites.js:97-124`、`public/js/identity.js:27-33`、`migrations/0000_compact_schema.sql:329-338`。
- 決策：`docs/adr/0005-volunteer-identity.md`；名詞：`GLOSSARY.md`（志工身分、名字代號）。
- Cloudflare D1 官方文件：Pricing（rows read／rows written 計費）https://developers.cloudflare.com/d1/platform/pricing/ ；Use indexes https://developers.cloudflare.com/d1/best-practices/use-indexes/ ；Batch statements（D1 Worker API `batch`）https://developers.cloudflare.com/d1/worker-api/d1-database/
- SQLite：EXPLAIN QUERY PLAN https://www.sqlite.org/eqp.html
- WHATWG HTML 規格 Page visibility：https://html.spec.whatwg.org/multipage/interaction.html#page-visibility

## 定案（K，2026-10-27）

- 節流 5 分鐘；索引與合併查詢一起做（先加索引再合併）。實作票 #680。
