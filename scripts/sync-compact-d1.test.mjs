import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { readDogsPayload, readDepartures, readWalks } from '../worker/src/compact.js';
import { buildSyncSql, buildSyncPlan, SEED_TABLES, SYNC_SCHEMA_SKIP, planSync, readPrevious, readSeed, lastWalkChecks, d1Target } from './sync-compact-d1.mjs';
import { budgetProblem, todayRowsWritten } from './sync-diff.mjs';

// SQL 開頭補建表、版本號、觸發器那幾行（不算同步寫的資料）
const SCHEMA_LINE = /^CREATE |^INSERT OR IGNORE INTO v3_(data|pack|walk)_versions|^INSERT INTO v3_departure_versions\(id,years\) |^DROP TRIGGER IF EXISTS pack_v3_|^DELETE FROM v3_packs WHERE part='(walks|small)'/;

const json = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

async function source() {
  const dogs = await json('tests/fixtures/dogs.json');
  // 常遛狗群照欄存：每隻有群組的狗跟它的群組一欄（真實試算表的欄可能更大，這裡只要能還原）
  const groupColumns = [], seen = new Set();
  for (const [name, others] of Object.entries(dogs.groups)) {
    const column = [name, ...others].sort();
    if (!seen.has(column.join()) && column.every(n => dogs.groups[n]?.length === others.length)) { seen.add(column.join()); groupColumns.push(column); }
  }
  return { dogs, walks: await json('tests/fixtures/walks.json'), departures: (await json('tests/fixtures/departures.json')).departures, groupColumns };
}

async function apply(t, seed, sql) {
  const db = fakeD1(); t.after(() => db.close());
  await migrateCompactDatabase(db);
  for (const [table, rows] of Object.entries(seed)) for (const row of rows) {
    await db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row)).run();
  }
  const statements = sql.split(';\n').map(s => s.trim()).filter(Boolean);
  await db.batch(statements.map(s => db.prepare(s)));
  return db;
}

test('第一次寫入正式 D1：主清單、試算表備註、常遛狗群讀回跟 dogs.json 一樣', async t => {
  const src = await source();
  const db = await apply(t, {}, await buildSyncSql({}, src));
  const payload = await readDogsPayload(db);
  // 介紹 #250 起由網站寫 D1，同步不帶
  assert.deepEqual(payload.dogs, src.dogs.dogs.map(d => ({ ...d, intro: '' })));
  assert.deepEqual(payload.sheetNotes, src.dogs.sheetNotes);
  for (const column of src.groupColumns) for (const name of column) assert.deepEqual([...payload.groups[name]].sort(), column.filter(n => n !== name));
  assert.ok(await db.prepare('SELECT COUNT(*) AS n FROM v3_walks').first('n'));
  assert.deepEqual(await readDepartures(db), src.departures);
});

test('正式 D1 還沒有離所表、群名表時，SQL 自己先建', async t => {
  const lines = (await buildSyncSql({}, await source())).split('\n');
  const creates = lines.filter(l => /^CREATE /.test(l));
  for (const t of ['v3_sheet_group_labels', 'v3_departures', 'v3_departure_items', 'v3_edit_log', 'v3_volunteers']) {
    assert.ok(creates.some(l => l.startsWith(`CREATE TABLE IF NOT EXISTS ${t} `)), t);
  }
  assert.ok(creates.every(l => / IF NOT EXISTS /.test(l)));
  // 版本號那一列和觸發器（#315）：同步自己改的列也會讓資料包失效
  const head = lines.filter(l => SCHEMA_LINE.test(l));
  assert.equal(lines.findIndex(l => !head.includes(l)), head.length);
  for (const name of ['version_v3_today_walks_INSERT', 'walkpack_v3_walks_UPDATE', 'packs_v3_rest_DELETE', 'packs_v3_departures_UPDATE']) assert.ok(creates.some(l => l.startsWith(`CREATE TRIGGER IF NOT EXISTS ${name} `)), name);
  assert.ok(!creates.some(l => /TRIGGER IF NOT EXISTS identity_/.test(l)), '身分的觸發器不在這裡建');
  // #320 舊的整份 walks 觸發器要拿掉
  for (const op of ['INSERT', 'UPDATE', 'DELETE']) assert.ok(lines.includes(`DROP TRIGGER IF EXISTS pack_v3_walks_${op};`), op);
  assert.ok(lines.includes('INSERT OR IGNORE INTO v3_walk_versions(id) VALUES(1);'));
});

test('讀 D1 現況：群名表和其他必要表讀不到都停止同步', async () => {
  const missing = table => async sql => { if (sql === SEED_TABLES[table]) throw new Error('no such table: ' + table); return []; };
  await assert.rejects(readSeed(missing('v3_sheet_group_labels')), /no such table/);
  await assert.rejects(readSeed(missing('v3_walks')), /no such table/);
});

test('群名（K 2026-10-16）：照欄存，api/dogs 的 groupColumns 帶群名和狗名', async t => {
  const src = await source();
  const labels = src.groupColumns.map((c, i) => (i === 0 ? '第一群' : ''));
  const db = await apply(t, {}, await buildSyncSql({}, { ...src, groupLabels: labels }));
  const payload = await readDogsPayload(db);
  assert.deepEqual(payload.groupColumns[0], { column: 0, label: '第一群', names: src.groupColumns[0] });
  assert.equal(payload.groupColumns.length, src.groupColumns.filter(c => c.length).length);
});

test('再同步一次沿用正式 D1 的永久狗 ID，不新增狗', async t => {
  const src = await source();
  const first = await apply(t, {}, await buildSyncSql({}, src));
  const seed = {};
  for (const [table, sql] of Object.entries(SEED_TABLES)) seed[table] = (await first.prepare(sql).all()).results;
  const db = await apply(t, seed, await buildSyncSql(seed, src));
  assert.deepEqual((await db.prepare('SELECT * FROM v3_dogs ORDER BY dog_id').all()).results, (await first.prepare('SELECT * FROM v3_dogs ORDER BY dog_id').all()).results);
  assert.deepEqual((await readDogsPayload(db)).dogs, src.dogs.dogs.map(d => ({ ...d, intro: '' })));
});

test('開卡、照片、休養、介紹不被同步清掉', async t => {
  const src = await source();
  const first = await apply(t, {}, await buildSyncSql({}, src));
  const dogId = await first.prepare('SELECT dog_id FROM v3_dogs LIMIT 1').first('dog_id');
  await first.prepare("INSERT INTO v3_card_opened VALUES('aaaaaaaaaaaa',?,'2026-10-15')").bind(dogId).run();
  await first.prepare("INSERT INTO v3_photos(object_key,dog_id) VALUES('photos/x.jpg',?)").bind(dogId).run();
  const seed = {};
  for (const [table, sql] of Object.entries(SEED_TABLES)) seed[table] = (await first.prepare(sql).all()).results;
  const sql = await buildSyncSql(seed, src);
  // 只補建表（IF NOT EXISTS），不刪不寫這幾張
  const writes = sql.split('\n').filter(l => !SCHEMA_LINE.test(l)).join('\n');
  assert.doesNotMatch(writes, /v3_card_opened|v3_photos|v3_volunteer|v3_rest|v3_intros|v3_edit_log/);
});

test('來源有問題時丟錯，不產生 SQL', async t => {
  const src = await source();
  await assert.rejects(buildSyncSql({}, { ...src, walks: { walks: [{ id: 'x', name: '狗', date: '不是日期' }] } }), /日期/);
});

// ── #251 同步只寫 D1：上一次的狀態從 D1 讀 ──
const KEY = { key: 'test-key', names: [] };
const NOW = new Date('2026-10-16T09:00:00+08:00');
const seedOf = async db => { const seed = {}; for (const [table, sql] of Object.entries(SEED_TABLES)) seed[table] = (await db.prepare(sql).all()).results; return seed; };
const sheetOf = src => ({ dogs: src.dogs.dogs.map(({ myWalkedDate, ...d }) => d), groups: src.dogs.groups, sheetNotes: src.dogs.sheetNotes });
// 正式 D1 的樣子：先用 repo 的 JSON 寫一次
async function production(t) {
  const src = await source();
  return { src, db: await apply(t, {}, await buildSyncSql({}, src)) };
}
const syncOnce = async (t, db, sheet, rows = null) => {
  const seed = await seedOf(db);
  const groupColumns = (await source()).groupColumns;
  return apply(t, seed, await buildSyncSql(seed, async mem => ({ ...planSync(await readPrevious(mem), sheet, rows, NOW, KEY), groupColumns })));
};

test('#251 新的溜狗日期記一筆進 v3_walks，舊紀錄一筆不少', async t => {
  const { src, db } = await production(t);
  const before = (await readWalks(db)).walks;
  const sheet = sheetOf(src);
  const dog = sheet.dogs.find(d => d.id && d.walkedDate);
  dog.walkedDate = '2026-10-16'; dog.walkers = ['aaaaaaaaaaaa'];
  const after = (await readWalks(await syncOnce(t, db, sheet))).walks;
  assert.deepEqual(after.filter(w => w.date === '2026-10-16'), [{ id: dog.id, name: dog.name, date: '2026-10-16', walkers: ['aaaaaaaaaaaa'] }]);
  for (const w of before) assert.ok(after.some(a => a.id === w.id && a.name === w.name && a.date === w.date), `少了 ${w.name} ${w.date}`);
});

test('#251 試算表沒變再同步一次：溜狗紀錄、離所都不變（不重複記）', async t => {
  const { src, db } = await production(t);
  const once = await syncOnce(t, db, sheetOf(src));
  const twice = await syncOnce(t, once, sheetOf(src));
  assert.deepEqual(await readWalks(twice), await readWalks(once));
  assert.deepEqual(await readDepartures(twice), await readDepartures(once));
  assert.deepEqual(await readDepartures(once), src.departures);
});

test('#251 狗從主清單消失記成離所，最後的樣子從 D1 上一次的主清單來；已有的離所保留', async t => {
  const { src, db } = await production(t);
  const sheet = sheetOf(src);
  const gone = sheet.dogs.find(d => d.id && !src.departures.some(e => e.id === d.id));
  sheet.dogs = sheet.dogs.filter(d => d !== gone);
  const deps = await readDepartures(await syncOnce(t, db, sheet));
  const entry = deps.find(e => e.id === gone.id);
  assert.equal(entry.seen, '2026-10-16');
  assert.equal(entry.last.name, gone.name);
  for (const e of src.departures) assert.ok(deps.some(d => d.id === e.id));
});

test('#251 複本可以從試算表整份重建：D1 是空的也能同步，主清單跟試算表一樣', async t => {
  const src = await source();
  const sheet = sheetOf(src);
  const db = await apply(t, {}, await buildSyncSql({}, async mem => ({ ...planSync(await readPrevious(mem), sheet, null, NOW, KEY), groupColumns: src.groupColumns })));
  const payload = await readDogsPayload(db);
  assert.deepEqual(payload.dogs.map(({ myWalkedDate, intro, ...d }) => d), sheet.dogs.map(({ intro, formerIds, ...d }) => ({ ...d, sex: '' })));
  assert.deepEqual(payload.sheetNotes, src.dogs.sheetNotes);
});

test('#251 只寫 D1：同步不寫 data/、不呼叫 git／GitHub、不寫試算表；workflow 沒有提交步驟', async () => {
  const code = await readFile(new URL('./sync-compact-d1.mjs', import.meta.url), 'utf8');
  const sheetCode = await readFile(new URL('./sync-sheet.mjs', import.meta.url), 'utf8');
  for (const [name, text] of [['sync-compact-d1.mjs', code], ['sync-sheet.mjs', sheetCode]]) {
    assert.doesNotMatch(text, /api\.github\.com|['"]git['"]|method:\s*['"](POST|PUT|PATCH|DELETE)/, name);
    assert.doesNotMatch(text, /writeFile\([^)]*DATA_DIR/, name);
  }
  assert.match(code, /'d1', 'execute'/);
  const workflow = await readFile(new URL('../.github/workflows/sync-sheet.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /git (add|commit|push)/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
});

test('#252 沒有 dogs/：同步保留永久狗性別、舊編號與再入所身分，新狗不猜性別', async t => {
  const db = await apply(t, {}, await buildSyncSql({}, { dogs: { dogs: [
    { id: 'current', name: '甲', sex: 'female', formerIds: ['old'] },
    { id: '', name: '無編號', sex: 'male' },
  ] }, walks: { walks: [] }, departures: [], groupColumns: [] }));
  const sheet = { dogs: [{ id: 'old', name: '甲改名' }, { id: '', name: '無編號' }, { id: 'new', name: '甲' }], groups: {}, sheetNotes: [] };
  const seed = await seedOf(db);
  const sql = await buildSyncSql(seed, async mem => ({ ...planSync(await readPrevious(mem), sheet, [], NOW, KEY), groupColumns: [] }));
  const after = await apply(t, seed, sql);
  const dogs = (await readDogsPayload(after)).dogs;
  assert.deepEqual(dogs.map(d => [d.id, d.sex, d.formerIds || []]), [['old', 'female', ['current']], ['', 'male', []], ['new', '', []]]);
  const beforeId = await db.prepare("SELECT dog_id FROM v3_dog_numbers WHERE number='current'").first('dog_id');
  assert.equal(await after.prepare("SELECT dog_id FROM v3_dog_numbers WHERE number='old'").first('dog_id'), beforeId);
});

test('讀 D1 現況：先讀上一次同步的日期，其餘表同時讀，不再一張等一張（頁首「更新」變慢）', async () => {
  const { readSeed } = await import('./sync-compact-d1.mjs');
  const tables = Object.keys(SEED_TABLES);
  let running = 0, peak = 0;
  const seed = await readSeed(async sql => {
    running++; peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 5));
    running--;
    return [{ sql }];
  }, { full: true });
  assert.equal(peak, tables.length);
  for (const t of tables) assert.deepEqual(seed[t], [{ sql: SEED_TABLES[t] }]);
  await assert.rejects(readSeed(async sql => { if (sql === SEED_TABLES.v3_walks) throw new Error('讀不到'); return []; }), /讀不到/);
});

// ── #302 差異同步：只寫有變的列，寫入量異常時停寫 ──
const planOnce = async (db, sheet) => {
  const seed = await seedOf(db);
  const groupColumns = (await source()).groupColumns;
  return buildSyncPlan(seed, async mem => ({ ...planSync(await readPrevious(mem), sheet, null, NOW, KEY), groupColumns }));
};
const writes = sql => sql.split('\n').filter(l => l && !SCHEMA_LINE.test(l));

test('#302 試算表沒變再同步一次：只寫同步時間 1 列', async t => {
  const { src, db } = await production(t);
  const once = await syncOnce(t, db, sheetOf(src));
  const plan = await planOnce(once, sheetOf(src));
  assert.equal(plan.rows, 1);
  assert.equal(writes(plan.sql).length, 1);
  assert.match(writes(plan.sql)[0], /^INSERT INTO v3_sync_state\(key,value\) VALUES\('synced_at',/);
});

// #361 同步時間存 v3_sync_state（ADR 0014）：只跑同步、試算表沒改時 small 資料包不失效
test('#361 試算表沒改只跑同步：small 版本號不變，同步時間照樣更新', async t => {
  const { src, db } = await production(t);
  const once = await syncOnce(t, db, sheetOf(src));
  const small = async () => (await once.prepare('SELECT small FROM v3_pack_versions WHERE id=1').first()).small;
  const before = await small();
  const later = new Date(NOW.getTime() + 60 * 60 * 1000);
  const seed = await seedOf(once);
  const plan = await buildSyncPlan(seed, async mem => ({ ...planSync(await readPrevious(mem), sheetOf(src), null, later, KEY), groupColumns: src.groupColumns }));
  await once.batch(plan.sql.split(';\n').map(l => l.trim()).filter(Boolean).map(l => once.prepare(l)));
  assert.equal(await small(), before);
  const synced = await once.prepare("SELECT value FROM v3_sync_state WHERE key='synced_at'").first('value');
  assert.match(synced, /^2026-10-16T10:00/);
  assert.equal((await readDogsPayload(once)).syncedAt, undefined, '主清單不帶同步時間');
});

test('#302 一隻狗被溜：只寫幾列，不再刪光重寫溜狗紀錄', async t => {
  const { src, db } = await production(t);
  const once = await syncOnce(t, db, sheetOf(src));
  const sheet = sheetOf(src);
  const dog = sheet.dogs.find(d => d.id && d.walkedDate);
  dog.walkedDate = '2026-10-16'; dog.walkers = ['aaaaaaaaaaaa'];
  const plan = await planOnce(once, sheet);
  assert.ok(plan.rows > 0 && plan.rows <= 10, `寫了 ${plan.rows} 列`);
  assert.equal(writes(plan.sql).length, plan.rows);
  assert.ok(writes(plan.sql).every(l => !/^DELETE FROM \w+;$/.test(l)), '不能有整張表刪光');
});

test('#302 寫完的結果跟整份重建一樣', async t => {
  const { src, db } = await production(t);
  const sheet = sheetOf(src);
  sheet.dogs = sheet.dogs.slice(1);
  sheet.dogs[0] = { ...sheet.dogs[0], walkedDate: '2026-10-16', walkers: ['aaaaaaaaaaaa'] };
  const diffed = await syncOnce(t, db, sheet);
  const seed = await seedOf(db);
  const fresh = await apply(t, {}, await buildSyncSql({}, async mem => {
    for (const [table, rows] of Object.entries(seed)) for (const row of rows) await mem.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row)).run();
    return { ...planSync(await readPrevious(mem), sheet, null, NOW, KEY), groupColumns: src.groupColumns };
  }));
  for (const table of Object.keys(SEED_TABLES)) {
    const all = async d => (await d.prepare(`SELECT * FROM ${table}`).all()).results.map(r => JSON.stringify(r)).sort();
    assert.deepEqual(await all(diffed), await all(fresh), table);
  }
});

test('#302 寫入預算：單次超過門檻、或今天累計會超過預算就停寫', () => {
  assert.equal(budgetProblem(3, 1000), null);
  assert.match(budgetProblem(501, 0), /單次門檻 500/);
  assert.match(budgetProblem(10, 19995), /每天的寫入預算 20000/);
  assert.equal(budgetProblem(10, null), null, '查不到今天用量時只看單次門檻');
  assert.match(budgetProblem(30, 0, { maxRows: 20 }), /單次門檻 20/);
});

test('#302 查今天的 D1 寫入量：加總帳號所有資料庫，查不到回 null', async () => {
  let body;
  const ok = async (url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsWritten: 40 } }, { sum: { rowsWritten: 2 } }] }] } } }) }; };
  assert.equal(await todayRowsWritten({ token: 't', accountId: 'a', now: new Date('2026-10-17T01:00:00+08:00'), fetchImpl: ok }), 42);
  assert.equal(body.variables.d, '2026-10-16', '額度照 UTC 日期算（台灣早上 8:00 重置）');
  const denied = async () => ({ ok: true, json: async () => ({ data: null, errors: [{ message: 'not authorized' }] }) });
  assert.equal(await todayRowsWritten({ token: 't', accountId: 'a', fetchImpl: denied }), null);
  assert.equal(await todayRowsWritten({ token: 't', accountId: 'a', fetchImpl: async () => { throw new Error('網路斷了'); } }), null);
});

test('#302 寫入量異常時不寫 D1：先檢查預算才呼叫 wrangler 寫入', async () => {
  const code = await readFile(new URL('./sync-compact-d1.mjs', import.meta.url), 'utf8');
  const check = code.indexOf('budgetProblem(planned');
  assert.ok(check > 0 && check < code.indexOf("wrangler(['--file'"));
  assert.match(code, /GITHUB_STEP_SUMMARY/);
});

test('預演（#309）：只算要寫幾列，寫入量正常時通過，超過單次門檻就失敗', async () => {
  const { dryRunReport } = await import('./sync-compact-d1.mjs');
  const ok = dryRunReport(12, 300, { maxRows: 500, dailyBudget: 20000 });
  assert.equal(ok.ok, true);
  assert.match(ok.text, /預演：會寫 12 列/);
  assert.match(ok.text, /沒有寫入/);
  const bad = dryRunReport(3000, 300, { maxRows: 500, dailyBudget: 20000 });
  assert.equal(bad.ok, false);
  assert.match(bad.text, /預演：會寫 3000 列/);
  assert.match(bad.text, /超過單次門檻 500 列/);
  assert.match(dryRunReport(5, null, { maxRows: 500, dailyBudget: 20000 }).text, /查不到/);
});

test('預演失敗時的報告（#309）：讀取或比對出錯也要留言', async () => {
  const { dryRunFailure } = await import('./sync-compact-d1.mjs');
  assert.match(dryRunFailure(new Error('no such table: v3_dogs')), /預演失敗.*no such table: v3_dogs/s);
});

test('預演（#309）：今天帳號寫太多不算這張 PR 的錯，只提醒、不失敗', async () => {
  const { dryRunReport } = await import('./sync-compact-d1.mjs');
  const r = dryRunReport(20, 149142, { maxRows: 500, dailyBudget: 20000 });
  assert.equal(r.ok, true);
  assert.match(r.text, /149142 列（已超過每天預算/);
});

// #321 同步補建的 schema 要和 compact-schema.sql 一致：schema 新增觸發器、表或預設列，同步沒送就失敗。
// 只允許 SYNC_SCHEMA_SKIP 明列的例外（身分的觸發器和 v3_identity_revision 那一列）
test('#321 同步 SQL 套到空的 D1，建出來的跟 migrateCompactDatabase 一樣（除了明列的例外）', async t => {
  const full = fakeD1(); t.after(() => full.close());
  await migrateCompactDatabase(full);
  const synced = fakeD1(); t.after(() => synced.close());
  const sql = await buildSyncSql({}, await source());
  await synced.batch(sql.split(';\n').map(s => s.trim()).filter(Boolean).map(s => synced.prepare(s)));
  const objects = async db => (await db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()).results
    .map(o => `${o.type} ${o.name}`);
  const skipped = o => o.startsWith('trigger ') && SYNC_SCHEMA_SKIP.triggers.test(o.slice(8));
  assert.deepEqual(await objects(synced), (await objects(full)).filter(o => !skipped(o)));
  // schema 自己放的預設列（版本號）同步也要放
  for (const name of (await objects(full)).filter(o => o.startsWith('table ')).map(o => o.slice(6))) {
    if (SYNC_SCHEMA_SKIP.rows.includes(name)) continue;
    const count = async db => (await db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).first()).n;
    if (await count(full)) assert.ok(await count(synced), `${name} 少了 schema 的預設列`);
  }
});

// ── ADR 0010（#331）：溜狗紀錄只讀、只寫最近一段 ──
const queryOf = db => async sql => (await db.prepare(sql).all()).results;
const syncedOn = (db, day) => db.prepare("INSERT INTO v3_sync_state(key,value) VALUES('walks_synced',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(day).run();
// 照正式同步的流程：讀最近一段 → 算 → 把 SQL 寫回同一個 D1（不是從 seed 重建，seed 只有一部分溜狗紀錄）
async function syncRecent(db, sheet, { mode = '', now = NOW } = {}) {
  const daily = mode === 'daily';
  const checks = () => (daily ? lastWalkChecks(sheet) : []);
  const seed = await readSeed(queryOf(db), { full: mode === 'full', checks, numbers: sheet.dogs.map(d => d.id), today: '2026-10-16' });
  const groupColumns = (await source()).groupColumns;
  const plan = await buildSyncPlan(seed, async mem => ({ ...planSync(await readPrevious(mem), sheet, null, now, { ...KEY, since: seed.since, daily }), groupColumns }), { today: '2026-10-16' });
  await db.batch(plan.sql.split(';\n').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  return { seed, written: writes(plan.sql) };
}
async function addHistory(db, days) {
  const dogs = (await db.prepare('SELECT dog_id,MIN(dog_number) AS number,MIN(dog_name) AS name FROM v3_walks GROUP BY dog_id').all()).results;
  const rows = [];
  for (let i = 1; i <= days; i++) {
    const date = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    for (const d of dogs) rows.push(db.prepare("INSERT INTO v3_walks(dog_id,walk_date,position,walker_code,dog_number,dog_name) VALUES(?,?,0,'bbbbbbbbbbbb',?,?)").bind(d.dog_id, date, d.number, d.name));
  }
  await db.batch(rows);
}

test('#331 平常同步讀的溜狗紀錄列數不隨歷史變多', async t => {
  const counts = [];
  for (const days of [0, 30, 200]) {
    const { src, db } = await production(t);
    await addHistory(db, days);
    await syncedOn(db, '2026-10-15');
    const { seed } = await syncRecent(db, sheetOf(src));
    assert.equal(seed.since, '2026-10-14');
    assert.ok(seed.v3_walks.every(w => w.walk_date >= '2026-10-14'));
    counts.push(seed.v3_walks.length);
  }
  assert.deepEqual(counts, [counts[0], counts[0], counts[0]]);
});

test('#331 舊紀錄不被平常的同步刪掉，也不被整張重寫', async t => {
  const { src, db } = await production(t);
  await addHistory(db, 30);
  await syncedOn(db, '2026-10-15');
  const before = await readWalks(db);
  const { written } = await syncRecent(db, sheetOf(src));
  assert.deepEqual(written.filter(l => /v3_walks/.test(l)), []);
  assert.ok(written.some(l => /^INSERT INTO v3_sync_state/.test(l)), '記下同步日期');
  assert.deepEqual((await syncRecent(db, sheetOf(src))).written.filter(l => /v3_sync_state/.test(l) && /walks_synced/.test(l)), [], '同一天不再寫一次');
  assert.deepEqual(await readWalks(db), before);
});

test('#331 停擺 3 天後第一次同步補回這幾天的紀錄', async t => {
  const { src, db } = await production(t);
  await syncedOn(db, '2026-10-12');
  const sheet = sheetOf(src);
  const walked = sheet.dogs.filter(d => d.id).slice(0, 3);
  // 試算表只留每隻狗最後一次，停擺期間溜的就是這幾隻最新的日期
  ['2026-10-15', '2026-10-15', '2026-10-16'].forEach((date, i) => { walked[i].walkedDate = date; walked[i].walkers = ['cccccccccccc']; });
  const { seed } = await syncRecent(db, sheet);
  assert.equal(seed.since, '2026-10-11');
  const walks = (await readWalks(db)).walks;
  for (const d of walked) assert.ok(walks.some(w => w.id === d.id && w.date === d.walkedDate), `少了 ${d.name} ${d.walkedDate}`);
  assert.equal(await db.prepare("SELECT value FROM v3_sync_state WHERE key='walks_synced'").first('value'), '2026-10-16');
});

test('#331 試算表上舊日期被改掉，平常的同步不影響 D1 的溜狗紀錄', async t => {
  const { src, db } = await production(t);
  await syncedOn(db, '2026-10-16');
  const before = await readWalks(db);
  const sheet = sheetOf(src);
  const dog = sheet.dogs.find(d => d.id && d.walkedDate);
  dog.walkedDate = '2026-09-01';
  await syncRecent(db, sheet);
  assert.deepEqual(await readWalks(db), before);
});

test('#331 6:30 保險同步：用主鍵核對每隻狗最後一次溜狗，D1 缺了就補；平常的同步不補', async t => {
  const { src, db } = await production(t);
  const dog = sheetOf(src).dogs.find(d => d.id && d.walkedDate && d.walkedDate < '2026-10-15');
  const dogId = await db.prepare('SELECT dog_id FROM v3_dog_numbers WHERE number=?').bind(dog.id).first('dog_id');
  await db.prepare('DELETE FROM v3_walks WHERE dog_id=? AND walk_date=?').bind(dogId, dog.walkedDate).run();
  await syncedOn(db, '2026-10-16');
  const has = async () => Boolean(await db.prepare('SELECT 1 AS x FROM v3_walks WHERE dog_id=? AND walk_date=?').bind(dogId, dog.walkedDate).first('x'));
  await syncRecent(db, sheetOf(src));
  assert.equal(await has(), false);
  const { seed } = await syncRecent(db, sheetOf(src), { mode: 'daily' });
  assert.equal(await has(), true);
  // 核對讀的列數跟狗的數量有關：最近一段＋每隻狗最後一次
  assert.ok(seed.v3_walks.length <= sheetOf(src).dogs.length * 2);
});

test('#331 輸出和整張比對一致（最近一段以內）', async t => {
  const results = [];
  for (const mode of ['full', '']) {
    const { src, db } = await production(t);
    await addHistory(db, 10);
    await syncedOn(db, '2026-10-15');
    const sheet = sheetOf(src);
    const dog = sheet.dogs.find(d => d.id && d.walkedDate);
    dog.walkedDate = '2026-10-16'; dog.walkers = ['aaaaaaaaaaaa'];
    const { seed } = await syncRecent(db, sheet, { mode });
    assert.equal(seed.since, mode === 'full' ? '' : '2026-10-14');
    results.push({ walks: await readWalks(db), dogs: (await readDogsPayload(db)).dogs.map(({ syncedAt, ...d }) => d) });
  }
  assert.deepEqual(results[1], results[0]);
});

test('#331 還沒記過同步日期或勾了全量核對就整張讀', async () => {
  const { walkSince, walkSeedSql } = await import('./sync-compact-d1.mjs');
  assert.equal(walkSince(''), '');
  assert.equal(walkSince('2026-10-16', { full: true }), '');
  assert.equal(walkSince('2026-10-01'), '2026-09-30');
  assert.equal(walkSeedSql(''), SEED_TABLES.v3_walks);
  assert.match(walkSeedSql('2026-10-15', [{ number: "A'", date: '2026-10-01' }, { number: 'B', date: '2026-10-16' }]),
    /walk_date>='2026-10-15' UNION .*IN \(VALUES \('A''','2026-10-01'\)\)$/);
  // 沒編號的狗不核對：剛改名會找不到而重複補一筆
  assert.deepEqual(lastWalkChecks({ dogs: [{ id: '', name: '甲', walkedDate: '2026-10-01' }, { id: 'B', name: '乙', walkedDate: '2026-10-02' }] }), [{ number: 'B', date: '2026-10-02' }]);
});

// ── ADR 0014（#364）：同步只讀出所 60 天內的離所，狗照主鍵讀 ──
// 出所很久的離所狗：永久狗、編號、離所紀錄和一筆旗標
async function addOldDepartures(db, count, date = '2020-03-01', prefix = 'old') {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const number = `${prefix}${i}`, dogId = `${prefix}dog${i}`;
    rows.push(db.prepare("INSERT INTO v3_dogs(dog_id,name,sex) VALUES(?,?,'')").bind(dogId, `舊狗${i}`));
    rows.push(db.prepare('INSERT INTO v3_dog_numbers(number,dog_id) VALUES(?,?)').bind(number, dogId));
    rows.push(db.prepare("INSERT INTO v3_departures(number,dog_id,name,departed_date,date_source,seen_date,reason) VALUES(?,?,?,?,'sheet',?,'adopted')").bind(number, dogId, `舊狗${i}`, date, date));
    rows.push(db.prepare("INSERT INTO v3_departure_items(number,kind,position,value) VALUES(?,'flag',0,'x')").bind(number));
  }
  if (rows.length) await db.batch(rows);
}
const DEPARTURE_TABLES = ['v3_dogs', 'v3_dog_numbers', 'v3_departures', 'v3_departure_items', 'v3_intros'];

test('#364 平常同步讀的狗、離所列數不隨舊離所變多；全量核對照樣整張讀', async t => {
  const counts = [];
  for (const n of [0, 40, 300]) {
    const { src, db } = await production(t);
    await addOldDepartures(db, n);
    await syncedOn(db, '2026-10-15');
    const { seed } = await syncRecent(db, sheetOf(src));
    assert.ok(seed.v3_departures.every(d => !d.departed_date || d.departed_date >= '2026-08-17'));
    counts.push(DEPARTURE_TABLES.map(tb => seed[tb].length));
  }
  assert.deepEqual(counts, [counts[0], counts[0], counts[0]]);
  const { src, db } = await production(t);
  await addOldDepartures(db, 5);
  const { seed } = await syncRecent(db, sheetOf(src), { mode: 'full' });
  assert.equal(seed.v3_departures.filter(d => d.number.startsWith('old')).length, 5);
});

test('#364 舊離所不被同步刪掉或改掉；新出所的狗照樣寫進去', async t => {
  const { src, db } = await production(t);
  await addOldDepartures(db, 20);
  // 剛好 60 天前那天還算近期，61 天前就定下來
  await addOldDepartures(db, 1, '2026-08-17', 'edge');
  await syncedOn(db, '2026-10-15');
  const old = async () => (await readDepartures(db)).filter(d => d.id.startsWith('old'));
  const before = await old();
  const sheet = sheetOf(src);
  const gone = sheet.dogs.find(d => d.id);
  sheet.dogs = sheet.dogs.filter(d => d !== gone);
  const { seed, written } = await syncRecent(db, sheet);
  assert.ok(seed.v3_departures.some(d => d.departed_date === '2026-08-17'));
  assert.deepEqual(written.filter(l => /v3_departure/.test(l) && /'old\d+'/.test(l)), []);
  assert.deepEqual(await old(), before);
  assert.ok((await readDepartures(db)).some(d => d.id === gone.id), '新出所的狗要有離所紀錄');
});

test('#364 出所很久的狗回到主清單（同一個編號）：照主鍵讀到原本的永久狗，不新建', async t => {
  const { src, db } = await production(t);
  await addOldDepartures(db, 3);
  await syncedOn(db, '2026-10-15');
  const sheet = sheetOf(src);
  sheet.dogs.push({ ...sheet.dogs.find(d => d.id), id: 'old1', name: '舊狗1', walkedDate: null, walkers: [] });
  const { seed } = await syncRecent(db, sheet);
  assert.deepEqual(seed.v3_dog_numbers.filter(r => r.number.startsWith('old')).map(r => r.number), ['old1']);
  assert.equal(await db.prepare("SELECT dog_id FROM v3_dog_numbers WHERE number='old1'").first('dog_id'), 'olddog1');
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM v3_dogs WHERE name='舊狗1'").first('n'), 1);
  assert.equal((await readDogsPayload(db)).dogs.filter(d => d.id === 'old1').length, 1);
});

test('#371 同步讀的 SQL 不整張掃溜狗紀錄、離所（D1 照掃過的列數算讀取額度）', async () => {
  const { narrowSeedSql, walkSeedSql } = await import('./sync-compact-d1.mjs');
  const db = fakeD1();
  try {
    await migrateCompactDatabase(db);
    const walksSql = walkSeedSql('2026-10-15', [{ number: 'A', date: '2026-10-01' }]);
    const sqls = { v3_walks: walksSql, ...narrowSeedSql({ cutoff: '2026-08-17', numbers: ['A'], walksSql }) };
    for (const [table, sql] of Object.entries(sqls)) {
      const plan = (await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()).results.map(r => r.detail);
      assert.deepEqual(plan.filter(d => /^SCAN v3_(walks|departures)\b/.test(d)), [], `${table}：${plan.join(' / ')}`);
    }
  } finally { db.close(); }
});

// 預覽測試庫補資料（預覽讀不到狗）：SYNC_D1 只能選正式庫或測試庫，測試庫要帶自己的設定檔
test('d1Target：預設正式庫，只接受測試庫這個例外', () => {
  assert.deepEqual(d1Target({}), { name: 'bq-shelter-dogs', config: [] });
  assert.deepEqual(d1Target({ SYNC_D1: 'bq-shelter-dogs-test' }), { name: 'bq-shelter-dogs-test', config: ['--config', 'wrangler.preview-db.jsonc'] });
  assert.throws(() => d1Target({ SYNC_D1: 'other' }), /SYNC_D1/);
});
