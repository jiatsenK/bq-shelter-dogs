// 記憶體 D1：node:sqlite 的記憶體資料庫，介面跟 Cloudflare D1 一樣（prepare／bind／run／all／first／batch）。
// 測試拿它當 D1（worker/test/fakes.mjs）。
import { DatabaseSync } from 'node:sqlite';

// 真實 SQLite 外鍵／唯一約束，batch 全部成功或全部回復。
// stats.rowsRead：查詢回傳了幾列（對照 D1 的讀取列數，測讀取量用）
export function memoryD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const stats = { rowsRead: 0 };
  const read = rows => { stats.rowsRead += rows.length; return rows.map(row => ({ ...row })); };
  const prepare = (sql, values = []) => {
    return {
      bind(...args) { return prepare(sql, args); },
      async run() {
        const statement = sqlite.prepare(sql);
        if (statement.columns().length) {
          return { success: true, results: read(statement.all(...values)), meta: {} };
        }
        const result = statement.run(...values);
        return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
      async all() { return { success: true, results: read(sqlite.prepare(sql).all(...values)), meta: {} }; },
      async first(column) {
        const row = sqlite.prepare(sql).get(...values);
        if (row) stats.rowsRead++;
        return row ? (column ? row[column] : { ...row }) : null;
      },
    };
  };
  let batchQueue = Promise.resolve();
  return {
    prepare,
    stats,
    batch(statements) {
      const result = batchQueue.then(async () => {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      });
      batchQueue = result.catch(() => {});
      return result;
    },
    close() { sqlite.close(); },
  };
}
