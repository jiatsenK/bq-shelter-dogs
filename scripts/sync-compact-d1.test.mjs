import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { readDogsPayload, readDepartures, readWalks } from '../worker/src/compact.js';
import { buildSyncSql, buildSyncPlan, SEED_TABLES, planSync, readPrevious, readSeed } from './sync-compact-d1.mjs';
import { budgetProblem, todayRowsWritten } from './sync-diff.mjs';

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
  assert.equal(lines.findIndex(l => !/^CREATE /.test(l)), creates.length);
});

test('正式 D1 還沒有群名表也能同步：讀不到群名表當成空的，其他表讀不到照樣停', async () => {
  const missing = table => async sql => { if (sql === SEED_TABLES[table]) throw new Error('no such table: ' + table); return []; };
  assert.deepEqual((await readSeed(missing('v3_sheet_group_labels'))).v3_sheet_group_labels, []);
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
  const writes = sql.split('\n').filter(l => !/^CREATE /.test(l)).join('\n');
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

test('讀 D1 現況：第一張讀完後其餘表同時讀，不再一張等一張（頁首「更新」變慢）', async () => {
  const { readSeed } = await import('./sync-compact-d1.mjs');
  const tables = Object.keys(SEED_TABLES);
  let running = 0, peak = 0;
  const seed = await readSeed(async sql => {
    running++; peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 5));
    running--;
    return [{ sql }];
  });
  assert.equal(peak, tables.length - 1);
  for (const t of tables) assert.deepEqual(seed[t], [{ sql: SEED_TABLES[t] }]);
  await assert.rejects(readSeed(async sql => { if (sql === SEED_TABLES.v3_walks) throw new Error('讀不到'); return []; }), /讀不到/);
});

// ── #302 差異同步：只寫有變的列，寫入量異常時停寫 ──
const planOnce = async (db, sheet) => {
  const seed = await seedOf(db);
  const groupColumns = (await source()).groupColumns;
  return buildSyncPlan(seed, async mem => ({ ...planSync(await readPrevious(mem), sheet, null, NOW, KEY), groupColumns }));
};
const writes = sql => sql.split('\n').filter(l => l && !/^CREATE /.test(l));

test('#302 試算表沒變再同步一次：一列都不寫', async t => {
  const { src, db } = await production(t);
  const once = await syncOnce(t, db, sheetOf(src));
  const plan = await planOnce(once, sheetOf(src));
  assert.equal(plan.rows, 0);
  assert.deepEqual(writes(plan.sql), []);
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
    // 主清單只有第 0 列的同步時間有用（網站只讀這列），其他列不跟著改
    const all = async d => (await d.prepare(`SELECT * FROM ${table}`).all()).results.map(r => JSON.stringify(r.row_index ? { ...r, synced_at: '' } : r)).sort();
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
