# CODING_STANDARDS — bq-shelter-dogs 程式規範

`/code-review` 的 Standards 審查會讀這份。通用規則見 agent-hub 的 `CODING_STANDARDS.md`；資料寫入的決定以 `AGENTS.md` 列的 ADR 為準，這裡只放審查時要檢查的寫法。

## D1：每次請求都會跑的讀寫，量不能隨資料變大（#408）

正式 D1 用免費方案，每天讀寫列數有上限（ADR 0007、0008）。使用者每次打開頁面、按一下就會跑的 API（不是一天一次的同步），一律：

- **不整張讀**：不能 `SELECT * FROM 表`（或只篩掉一點點）再在 JS 裡找要的那幾筆。要用 `WHERE` 對到索引欄位，只讀這次需要的列。
- **不整份重寫**：不能「先 `DELETE` 全部再 `INSERT` 全部」或把整份清單重寫一次。只寫有變的那幾列（`INSERT … ON CONFLICT DO UPDATE`、`DELETE … WHERE 主鍵 = ?`）。
- **附讀寫量測試**：新增或修改這類 API，要有測試攔下送出的 SQL、數讀寫列數，證明資料多 10 倍時讀寫量不變（或只跟這次請求帶的筆數成正比）。寫法比照 `worker/test/packs.test.mjs` 的 `readsOf()`：先用小資料跑一次，再塞大量無關資料跑一次，兩次斷言相同數字。

不適用：一天一次的同步（`scripts/sync-compact-d1.mjs`，照 ADR 0008 只寫差異即可）、手動執行的維運腳本。

### 反例（不要這樣寫）

```js
// 記住這次登記的名字：每次整張讀、整份重寫，志工越多越貴
const { results } = await env.DB.prepare('SELECT name FROM walker_names').all();
const names = new Set(results.map((r) => r.name));
names.add(name);
await env.DB.batch([
  env.DB.prepare('DELETE FROM walker_names'),
  ...[...names].map((n) => env.DB.prepare('INSERT INTO walker_names (name) VALUES (?)').bind(n)),
]);
```

### 正例

```js
// 只寫這一個名字，讀寫量固定 1 列
await env.DB.prepare(
  'INSERT INTO walker_names (name, last_used) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET last_used = excluded.last_used',
).bind(name, today).run();
```

測試（示意）：

```js
const small = await writesOf(DB, () => remember('小明'));
await seedNames(DB, 5000); // 塞一堆無關資料
assert.equal(await writesOf(DB, () => remember('小明')), small, '資料變多，寫入量不能變');
```

審查時：diff 裡出現每次請求都跑的 `SELECT` 沒有帶索引條件、`DELETE` 沒有 `WHERE`、或迴圈把整份清單重寫，又沒有附上述讀寫量測試，算違反本條。

能機械判斷的部分（沒帶 `WHERE`／`LIMIT` 的 `SELECT`、`DELETE`）由 `worker/test/standards.test.mjs` 擋；既有例外列在那裡的 `FULL_SCAN_OK`，每筆附原因或票號。

## 搬動的程式碼視同新寫

diff 碰到的程式（包括從別的檔案搬過來、改名、包進新函式）裡違反本檔或 agent-hub 規範的地方，跟新寫的一樣算數。二選一：

- 這次修掉；
- 開票，並把票號寫在例外清單或程式註解（例如 `FULL_SCAN_OK`），PR 內文列出。

「原本就這樣、只是搬位置」不能當作通過的理由。審查時，沒修也沒票號的既有違規照樣列為違反。
