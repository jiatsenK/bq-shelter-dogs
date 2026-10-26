import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryD1 } from '../../scripts/memory-d1.mjs';
import worker from '../src/admin/index.js';
import { scanDogList } from '../src/dog-list.js';
import { readSheetGaps } from '../src/admin/checks.js';
import { searchEdits } from '../src/admin/edits.js';

// #567 管理網站第 4 階段：活動紀錄、資料檢查（#518）、資料編輯紀錄搜尋。隔離記憶體 D1，不碰正式資料。
const origin = 'https://manage.example.org';
const issuer = 'https://shelter.cloudflareaccess.com';
const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const now = Math.floor(Date.now() / 1000);
const claims = { iss: issuer, aud: ['admin-audience'], exp: now + 3600, iat: now - 10, nbf: now - 10, type: 'app', sub: 'manager-id', email: 'manager@example.org' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function token() {
  const data = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode(claims)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(data));
  return `${data}.${Buffer.from(signature).toString('base64url')}`;
}
const env = { ADMIN_ORIGIN: origin, ACCESS_TEAM_DOMAIN: 'shelter.cloudflareaccess.com', ACCESS_AUD: 'admin-audience' };
const fetchKeys = async () => Response.json({ keys: [jwk] });
const request = (path, jwt, options = {}) => new Request(origin + path, { ...options, headers: { ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}), ...options.headers } });
const write = (path, jwt, method, body, headers = {}) => request(path, jwt, { method, body: JSON.stringify(body), headers: { Origin: origin, 'Content-Type': 'application/json', ...headers } });

async function setup(t) {
  t.mock.method(globalThis, 'fetch', fetchKeys);
  const DB = memoryD1();
  t.after(() => DB.close());
  await (await import('../../scripts/migrate-compact-db.mjs')).migrateCompactDatabase(DB);
  await DB.prepare("INSERT INTO v3_dogs(dog_id,name,sex) VALUES(?,?,'male'),(?,?,'')").bind('a'.repeat(32), '阿福', 'b'.repeat(32), '小黑').run();
  await DB.prepare("INSERT INTO v3_dog_numbers(number,dog_id) VALUES('2026010101',?),('2026010202',?)").bind('a'.repeat(32), 'b'.repeat(32)).run();
  await DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage,note) VALUES(0,?,'2026010101','阿福','A1','')").bind('a'.repeat(32)).run();
  return { DB, bindings: { ...env, DB }, jwt: await token() };
}

test('#567 新管理路徑：未登入一律 401，不讀 D1', async () => {
  const forbidden = () => { throw Error('unauthorized resource read'); };
  for (const path of ['/api/manage/activities', '/api/manage/activities/' + 'c'.repeat(32), '/api/manage/data-checks', '/api/manage/cron-status', '/api/manage/edits', '/activities.html', '/checks.html', '/updates.html']) {
    const res = await worker.fetch(request(path), { ...env, DB: { prepare: forbidden }, ASSETS: { fetch: forbidden } });
    assert.equal(res.status, 401, path);
  }
});

test('#567 活動：管理者新增／修改／刪除共用驗證與 revision，紀錄同交易且不受志工開關限制', async t => {
  const { DB, bindings, jwt } = await setup(t);
  const { readSettings, saveSettings } = await import('../src/feature-settings.js');
  const settings = await readSettings(DB);
  await saveSettings(DB, { ...settings, values: { ...settings.values, editActivity: false, showActivities: false } }, { subject: claims.sub, email: claims.email });
  // 只有名字的舊紀錄（dog_id NULL）要原樣保留
  await DB.prepare("INSERT INTO v3_activities(activity_id,activity_date,kind) VALUES(?,'2026-09-06','kids')").bind('c'.repeat(32)).run();
  await DB.prepare("INSERT INTO v3_activity_dogs(activity_id,position,dog_id,name) VALUES(?,0,NULL,'舊名單小白'),(?,1,?,'阿福')").bind('c'.repeat(32), 'c'.repeat(32), 'a'.repeat(32)).run();

  const list = await (await worker.fetch(request('/api/manage/activities', jwt), bindings)).json();
  assert.equal(list.activities.length, 1);
  assert.deepEqual(list.activities[0].dogs.map(d => [d.dogId, d.name]), [[null, '舊名單小白'], ['a'.repeat(32), '阿福']]);

  const path = '/api/manage/activities';
  assert.equal((await worker.fetch(write(path, jwt, 'POST', { date: '2026-10-04', kind: 'adoption', dogs: [] }, { Origin: 'https://evil.example' }), bindings)).status, 403);
  assert.equal((await worker.fetch(write(path, jwt, 'POST', { date: '2026-10-04', kind: 'adoption', dogs: [] }, { 'Content-Type': 'text/plain' }), bindings)).status, 415);
  assert.equal((await worker.fetch(write(path, jwt, 'POST', { date: '2026-10-04', kind: 'party', dogs: [] }), bindings)).status, 400, '類型白名單沿用現有驗證');
  assert.equal((await worker.fetch(write(path, jwt, 'POST', { date: '2026-02-30', kind: 'kids', dogs: [] }), bindings)).status, 400);
  assert.equal((await worker.fetch(write(path, jwt, 'POST', { date: '2026-10-04', kind: 'kids', dogs: [{ dogId: 'f'.repeat(32) }] }), bindings)).status, 400);
  assert.equal((await worker.fetch(write(path + '/' + 'c'.repeat(32), jwt, 'POST', {}), bindings)).status, 405);

  const created = await worker.fetch(write(path, jwt, 'POST', { date: '2026-10-04', kind: 'adoption', dogs: [{ dogId: 'b'.repeat(32) }] }), bindings);
  assert.equal(created.status, 200, '志工活動開關關閉時管理者仍能維護');
  const fresh = (await created.json()).activity;
  assert.equal(fresh.revision, 1);

  const old = list.activities[0];
  const edit = { revision: old.revision, date: old.date, kind: old.kind, dogs: [{ name: '舊名單小白' }, { dogId: 'a'.repeat(32) }, { dogId: 'b'.repeat(32) }] };
  const updated = await worker.fetch(write(`${path}/${old.id}`, jwt, 'PUT', edit), bindings);
  assert.equal(updated.status, 200);
  const after = (await updated.json()).activity;
  assert.equal(after.revision, 2);
  assert.deepEqual(after.dogs.map(d => d.dogId), [null, 'a'.repeat(32), 'b'.repeat(32)], '未對應名字保留，不猜同名的狗');
  assert.equal((await worker.fetch(write(`${path}/${old.id}`, jwt, 'PUT', edit), bindings)).status, 409, '舊 revision 被擋下');
  assert.equal((await worker.fetch(write(`${path}/${old.id}`, jwt, 'DELETE', {}), bindings)).status, 400);

  const logs = (await DB.prepare("SELECT l.*, a.actor_email, a.source FROM v3_edit_log l LEFT JOIN v3_dog_edit_actors a ON a.log_id=l.id WHERE l.kind='activity' ORDER BY l.id").all()).results;
  assert.equal(logs.length, 2);
  assert.ok(logs.every(l => l.editor_name === '管理者' && l.source === 'access' && l.actor_email === claims.email));
  assert.deepEqual(JSON.parse(logs[1].before_json).dogs, ['舊名單小白', '阿福']);
  assert.deepEqual(JSON.parse(logs[1].after_json).dogIds, [null, 'a'.repeat(32), 'b'.repeat(32)]);

  // 紀錄寫不進去就整批回復：活動不能改了卻沒有紀錄
  await DB.prepare('CREATE TRIGGER fail_actor BEFORE INSERT ON v3_dog_edit_actors BEGIN SELECT RAISE(ABORT, \'actor broken\'); END').run();
  const broken = await worker.fetch(write(`${path}/${fresh.id}`, jwt, 'DELETE', { revision: fresh.revision }), bindings);
  assert.equal(broken.status, 503);
  assert.ok(await DB.prepare('SELECT 1 FROM v3_activities WHERE activity_id=?').bind(fresh.id).first(), '紀錄失敗，刪除一起回復');
  await DB.prepare('DROP TRIGGER fail_actor').run();
  const removed = await worker.fetch(write(`${path}/${fresh.id}`, jwt, 'DELETE', { revision: fresh.revision }), bindings);
  assert.equal(removed.status, 200);
  assert.equal((await worker.fetch(write(`${path}/${fresh.id}`, jwt, 'DELETE', { revision: fresh.revision }), bindings)).status, 404);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM v3_edit_log WHERE kind='activity'").first()).n, 3);

  // 公開的編輯紀錄只寫「管理者」，不洩露 Access 身分
  const publicWorker = (await import('../src/index.js')).default;
  const publicEdits = await publicWorker.fetch(new Request('https://volunteer.example/api/edits', { headers: { Origin: 'https://volunteer.example' } }), { DB });
  const text = await publicEdits.text();
  assert.match(text, /管理者/);
  assert.doesNotMatch(text, /manager@example|manager-id/);
});

test('#518 網站有、試算表沒有：每次掃描記掃描時間，清單沒變不改記錄時間', async t => {
  const { DB } = await setup(t);
  const t0 = Date.parse('2026-10-25T01:43:00Z');
  await DB.prepare("INSERT INTO v3_sync_state(key,value) VALUES('dog_list_fp',?)").bind(JSON.stringify({ 'main:2026010101': 'h1', 'main:2026010202': 'h2' })).run();
  await DB.prepare("INSERT INTO v3_sheet_main(row_index,dog_id,number,name,cage,note) VALUES(1,?,'2026010202','小黑','B3','')").bind('b'.repeat(32)).run();
  assert.deepEqual((await scanDogList(DB, { 'main:2026010101': 'h1' }, t0)).extra, ['main:2026010202']);
  const first = JSON.parse((await DB.prepare("SELECT value FROM v3_sync_state WHERE key='dog_list_extra'").first()).value);
  assert.deepEqual(first, { at: '2026-10-25T01:43:00.000Z', checkedAt: '2026-10-25T01:43:00.000Z', keys: ['main:2026010202'] });
  await scanDogList(DB, { 'main:2026010101': 'h1' }, t0 + 4 * 3600000);
  const second = JSON.parse((await DB.prepare("SELECT value FROM v3_sync_state WHERE key='dog_list_extra'").first()).value);
  assert.equal(second.at, first.at, '清單沒變，記錄時間不動');
  assert.equal(second.checkedAt, '2026-10-25T05:43:00.000Z');
});

test('#518 資料檢查 API：清單對上狗、標示過期／未記錄／讀取失敗，只讀不寫', async t => {
  const { DB, bindings, jwt } = await setup(t);
  const at = '2026-10-25T01:43:00.000Z';
  await DB.prepare("INSERT INTO v3_dog_departures(dog_id,number,name,departed_date) VALUES(?,'2026010202','小黑','2026-10-01')").bind('b'.repeat(32)).run();
  await DB.prepare("INSERT INTO v3_sync_state(key,value) VALUES('dog_list_extra',?)").bind(JSON.stringify({ at, checkedAt: at, keys: ['departed:2026010202', 'groups:C', 'main:2026010101', 'main:名:無編號'] })).run();
  const writes = [];
  const measured = { prepare(sql) { if (!/^\s*(SELECT|WITH)/i.test(sql)) writes.push(sql); return DB.prepare(sql); }, batch: s => DB.batch(s) };
  const gaps = await readSheetGaps(measured, Date.parse(at) + 3600000);
  assert.equal(writes.length, 0, '資料檢查只讀，不自動刪狗、記離所或合併');
  assert.equal(gaps.state, 'ok');
  assert.equal(gaps.stale, false);
  assert.equal(gaps.recordedAt, at);
  assert.equal(gaps.checkedAt, at);
  assert.deepEqual(gaps.items.map(i => [i.sheet, i.number, i.name, i.dogId]), [
    ['departed', '2026010202', '小黑', 'b'.repeat(32)],
    ['groups', '', 'C', null],
    ['main', '2026010101', '阿福', 'a'.repeat(32)],
    ['main', '', '無編號', null],
  ]);
  assert.equal((await readSheetGaps(DB, Date.parse(at) + 25 * 3600000)).stale, true, '超過一天沒掃描算過期');

  await DB.prepare("UPDATE v3_sync_state SET value=? WHERE key='dog_list_extra'").bind(JSON.stringify({ at, keys: [] })).run();
  const legacy = await readSheetGaps(DB, Date.parse(at));
  assert.equal(legacy.checkedAt, null, '舊格式沒有掃描時間，不冒充');
  assert.equal(legacy.stale, true);
  await DB.prepare("UPDATE v3_sync_state SET value='{broken' WHERE key='dog_list_extra'").run();
  assert.equal((await readSheetGaps(DB)).state, 'error');
  await DB.prepare("DELETE FROM v3_sync_state WHERE key='dog_list_extra'").run();
  assert.equal((await readSheetGaps(DB)).state, 'never');

  const res = await worker.fetch(request('/api/manage/data-checks', jwt), bindings);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).sheetGaps.state, 'never');
  assert.equal((await worker.fetch(request('/api/manage/data-checks', jwt), { ...bindings, DB: { prepare() { throw Error('secret detail'); } } })).status, 503);
});

test('#567 資料編輯紀錄：搜尋涵蓋全部、白名單篩選、台灣日期、游標分頁，資料多 10 倍讀取量不變', async t => {
  const { DB, bindings, jwt } = await setup(t);
  const insert = DB.prepare('INSERT INTO v3_edit_log(at,editor_code,editor_name,kind,dog_id,dog_number,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)');
  await insert.bind('2026-01-01T15:59:00.000Z', '', '最早的志工', 'intro', 'a'.repeat(32), '2026010101', '""', JSON.stringify('百分比 100% 的介紹')).run();
  for (let i = 0; i < 130; i++) await insert.bind(`2026-10-0${1 + (i % 9)}T02:00:00.000Z`, '', `志工${i}`, i % 2 ? 'rest' : 'photo', 'b'.repeat(32), '2026010202', 'null', 'null').run();
  const log = await DB.prepare("INSERT INTO v3_edit_log(at,editor_code,editor_name,kind,dog_id,dog_number,before_json,after_json) VALUES('2026-10-20T01:00:00.000Z','','管理者','sex',?,'2026010101','\"\"','\"male\"')").bind('a'.repeat(32)).run();
  await DB.prepare("INSERT INTO v3_dog_edit_actors(request_id,log_id,actor_subject,actor_email,source) VALUES('r1',?,?,?,'access')").bind(log.meta.last_row_id, claims.sub, claims.email).run();
  // 跟著游標翻完全部頁，回傳符合的總筆數
  const count = async query => {
    let total = 0, cursor = null;
    do {
      const page = await searchEdits(DB, new URLSearchParams(`${query}&size=100${cursor ? `&cursor=${cursor}` : ''}`));
      total += page.edits.length; cursor = page.next;
    } while (cursor);
    return total;
  };

  let queries = 0;
  const measured = { prepare(sql) { queries++; return DB.prepare(sql); }, batch: s => DB.batch(s) };
  const oldest = await searchEdits(measured, new URLSearchParams('q=最早'));
  assert.equal(queries, 1, '每次請求 1 個查詢，不算總數');
  assert.equal(oldest.edits.length, 1, '搜尋涵蓋超過最近 100 筆的完整範圍');
  assert.equal(oldest.edits[0].editorName, '最早的志工');
  assert.equal(oldest.next, null);
  assert.equal(await count('q=100%'), 1, '% 視為文字不是萬用字元');
  assert.equal(await count('q=_'), 0);

  const first = await searchEdits(DB, new URLSearchParams('kind=photo&size=25'));
  assert.equal(first.edits.length, 25);
  assert.ok(first.edits.every(e => e.kind === 'photo' && e.kindLabel === '照片'));
  const second = await searchEdits(DB, new URLSearchParams(`kind=photo&size=25&cursor=${first.next}`));
  assert.ok(second.edits[0].id < first.edits.at(-1).id, '下一頁接在上一頁最後一筆之後');
  assert.equal(await count('kind=photo'), 65);
  assert.equal(await count('dog=2026010101'), 2, '對象可用編號找');
  assert.equal(await count('dog=小黑'), 130, '對象可用狗名找');
  assert.equal(await count('from=2026-01-01&to=2026-01-01'), 1, '15:59Z 是台灣 1/1 23:59');
  assert.equal(await count('from=2026-01-02&to=2026-01-02'), 0);
  const admin = await searchEdits(DB, new URLSearchParams('source=access'));
  assert.equal(admin.edits.length, 1);
  assert.equal(admin.edits[0].actorEmail, claims.email, '後台看得到管理者登入身分');
  assert.equal(await count('actor=manager@example'), 1);
  const asc = await searchEdits(DB, new URLSearchParams('order=oldest&size=25'));
  assert.equal(asc.edits[0].editorName, '最早的志工');
  assert.ok((await searchEdits(DB, new URLSearchParams(`order=oldest&size=25&cursor=${asc.next}`))).edits[0].id > asc.edits.at(-1).id);
  assert.ok(!('actorEmail' in oldest.edits[0]), '志工紀錄不帶管理者欄位');
  assert.ok(first.kinds.some(k => k.value === 'activity' && k.label === '活動紀錄'));

  // 讀取量：不帶條件的一頁照主鍵順序走、LIMIT 停下，不排序整張表；紀錄多 10 倍，讀到的列數一樣
  const readsOf = async query => { const before = DB.stats.rowsRead; await searchEdits(DB, new URLSearchParams(query)); return DB.stats.rowsRead - before; };
  const small = await readsOf('size=25');
  for (let i = 0; i < 1200; i++) await insert.bind('2025-01-01T00:00:00.000Z', '', '更早的無關紀錄', 'rest', null, '', 'null', 'null').run();
  assert.equal(await readsOf('size=25'), small);
  const plan = (await DB.prepare("EXPLAIN QUERY PLAN SELECT l.id FROM v3_edit_log l LEFT JOIN v3_dog_edit_actors a ON a.log_id=l.id LEFT JOIN v3_dogs d ON d.dog_id=l.dog_id WHERE l.id<? ORDER BY l.id DESC LIMIT 26").bind(999999).all()).results.map(r => r.detail).join(' | ');
  assert.doesNotMatch(plan, /TEMP B-TREE/, plan);

  for (const bad of ['kind=drop', 'size=500', 'order=random', 'cursor=0', 'cursor=x', 'page=2', 'from=2026-13-01', 'q=' + 'x'.repeat(101), 'source=root', 'sort=at']) {
    await assert.rejects(searchEdits(DB, new URLSearchParams(bad)), e => e.status === 400, bad);
  }
  const res = await worker.fetch(request('/api/manage/edits?kind=sex', jwt), bindings);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).edits.length, 1);
  assert.equal((await worker.fetch(request('/api/manage/edits?kind=drop', jwt), bindings)).status, 400);
  assert.equal((await worker.fetch(request('/api/manage/edits', jwt, { method: 'POST', body: '{}' }), bindings)).status, 405);
});
