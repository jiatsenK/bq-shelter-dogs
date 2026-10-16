// 測試用的假 R2、假靜態檔（worker/test/r2.test.mjs 用）
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// 共用 D1 接縫：真實 SQLite 外鍵／唯一約束，batch 全部成功或全部回復。
export function fakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const prepare = (sql, values = []) => {
    return {
      bind(...args) { return prepare(sql, args); },
      async run() {
        const statement = sqlite.prepare(sql);
        if (statement.columns().length) {
          return { success: true, results: statement.all(...values).map(row => ({ ...row })), meta: {} };
        }
        const result = statement.run(...values);
        return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values).map(row => ({ ...row })), meta: {} }; },
      async first(column) {
        const row = sqlite.prepare(sql).get(...values);
        return row ? (column ? row[column] : { ...row }) : null;
      },
    };
  };
  let batchQueue = Promise.resolve();
  return {
    prepare,
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

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// 假 R2：key → { bytes, etag, customMetadata, uploaded }；failPut(key) 回 true 的就寫入失敗
export function fakeR2({ failPut = () => false } = {}) {
  const objects = new Map();
  let clock = 0;
  const view = (key, o) => {
    const bytes = o.bytes;
    return {
      key,
      size: bytes.length,
      etag: o.etag,
      httpEtag: `"${o.etag}"`,
      uploaded: new Date(o.uploaded),
      customMetadata: { ...o.customMetadata },
      body: new Response(bytes).body,
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    };
  };
  return {
    objects,
    async get(key) { const o = objects.get(key); return o ? view(key, o) : null; },
    async head(key) { const o = objects.get(key); return o ? view(key, o) : null; },
    async put(key, value, opts = {}) {
      if (failPut(key)) throw new Error('R2 寫入失敗');
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
      const cur = objects.get(key);
      if (opts.onlyIf && opts.onlyIf.etagMatches && (!cur || cur.etag !== opts.onlyIf.etagMatches)) return null;
      if (opts.sha256 && sha(bytes) !== opts.sha256) throw new Error('sha256 不符');
      const o = { bytes, etag: createHash('md5').update(bytes).digest('hex') + (++clock), customMetadata: opts.customMetadata || {}, uploaded: ++clock * 1000 };
      objects.set(key, o);
      return view(key, o);
    },
    async delete(keys) { for (const k of [].concat(keys)) objects.delete(k); },
    async list({ prefix = '' } = {}) {
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort();
      return { objects: keys.map(k => view(k, objects.get(k))), truncated: false };
    },
  };
}

// 假靜態檔（部署上去的 repo 檔案）：路徑 → 內容
export function fakeAssets(files = {}) {
  return {
    files,
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname.slice(1));
      const body = files[path];
      if (body == null) return new Response('Not found', { status: 404 });
      const type = path.endsWith('.json') ? 'application/json' : 'image/jpeg';
      return new Response(typeof body === 'string' ? body : body.slice(), { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=0' } });
    },
  };
}

