// 保險掃描（ADR 0018 第 5 點）：按狗送指紋，Apps Script 只回指紋不同的狗，Worker 只比那幾隻。
// 收下人工修改跟改表通知同一套規則（observe.js，#746）：沒用過網站的名字、同一天名單合併、連改前的「上一次」、v3_walk_baselines、失敗記進 v3_walk_conflicts。
import { keyOf } from './shared.js';
import { observeAll } from './observe.js';

// 一隻狗的指紋：D1 記的「表上值」（base_date／base_walker）；要跟 apps-script/sheet-write.gs 的 walkScanRows 算法完全一樣。
export async function walkFingerprint(date, walker) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([date, walker]))));
  return [...bytes.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 指紋直接由 base 算出、不另外記：寫回確認或人工值收下時 base 就跟著更新；沒收完（派送中、比對失敗、一輪上限、讀表期間有新登記）的狗 base 不變，下次自然再回來。
// CROSS JOIN 固定先掃在所的狗、再用主鍵查寫回紀錄：結果跟 JOIN 相同，讀取量不隨只增不刪的 outbox 歷史長大（#676；不靠 PRAGMA optimize）。
// 讀表前先記下每隻的版本，比對時版本變了（讀表期間有新登記）就留給下一輪，避免新登記被撤銷。
export async function scanWalks(db, env, sheet, now) {
  const observed = (await db.prepare(`SELECT s.*,o.status FROM v3_walk_state s
    CROSS JOIN v3_walk_outbox o ON o.dog_key=s.dog_key AND o.version=s.version`).all()).results || [];
  if (!observed.length) return { changed: 0, deferred: 0 };
  const fingerprints = {};
  for (const s of observed) fingerprints[s.dog_key] = await walkFingerprint(s.base_date, s.base_walker);
  const body = await sheet(env, { action: 'walkScan', fingerprints }).catch(e => { throw new Error(`主清單直接讀回失敗：${e.message}`); });
  if (Array.isArray(body.rows) && !body.rows.length) return { changed: 0, deferred: 0 };
  if (!Array.isArray(body.rows)) throw new Error('主清單讀回不完整');
  // 只吃 GAS 在同一 script lock 內直接讀出的列；同一隻出現兩次（表上重複）不比。
  const byKey = new Map();
  for (const row of body.rows) {
    if (!row.dog || !row.current || typeof row.current.walker !== 'string' || !/^(\d{4}-\d{2}-\d{2})?$/.test(row.current.date)) throw new Error('主清單讀回格式不明');
    const key = keyOf(row.dog);
    byKey.set(key, byKey.has(key) ? null : row);
  }
  // 已交給 GAS 的派送（派送中、結果不明、等重試）由派送自己在同鎖 target／回執收尾，掃描不插手，免得把結果不明記成衝突。
  const differ = observed.filter(s => byKey.get(s.dog_key));
  const items = differ.filter(s => s.status === 'synced' || s.status === 'pending').map(s => ({ ...byKey.get(s.dog_key), version: s.version }));
  const results = await observeAll(db, env, now, items, { source: 'scan' });
  for (const [i, r] of results.entries()) if (!r.ok) console.warn('walk-scan:', keyOf(items[i].dog), r.error);
  return { changed: results.filter(r => r.changed).length, deferred: differ.length - items.length + results.filter(r => !r.ok || r.deferred).length };
}
