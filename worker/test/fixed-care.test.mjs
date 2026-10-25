import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { fakeD1 } from './fakes.mjs';
import { migrateCompactDatabase } from '../../scripts/migrate-compact-db.mjs';
import { importCompactDogs } from '../../scripts/import-compact-dogs.mjs';

const SITE = 'https://bq-shelter-dogs.jiatsen-k.workers.dev';
async function setup() {
  worker.testing.resetState();
  const DB = fakeD1();
  await migrateCompactDatabase(DB);
  await importCompactDogs(DB, { dogs: [{ id: '2024032902', name: '甲', covered: true, formerIds: ['2020010101'] }, { id: '2024010101', name: '乙' }] });
  return { DB, WALKER_KEY: 'test-key' };
}
async function call(env, path, body) {
  const res = await worker.fetch(new Request(`${SITE}/api${path}`, {
    method: body === undefined ? 'GET' : 'PUT', headers: { Origin: SITE, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json() };
}
const dogs = async env => (await call(env, '/dogs')).body.dogs;

test('固定照顧：拒絕未選身分、非布林值、未知編號與預覽寫入，原設定不變', async () => {
  const env = await setup();
  await call(env, '/fixed-care/2024032902', { editor: '甲', enabled: true });
  for (const body of [{ enabled: false }, { editor: '甲', enabled: 'false' }, null]) {
    assert.equal((await call(env, '/fixed-care/2024032902', body)).status, 400);
  }
  assert.equal((await call(env, '/fixed-care/unknown', { editor: '甲', enabled: false })).status, 404);
  assert.equal((await call({ ...env, PREVIEW: '1' }, '/fixed-care/2024032902', { editor: '甲', enabled: false })).status, 403);
  assert.equal((await call(env, '/fixed-care/2024032902')).status, 405);
  assert.equal((await dogs(env))[0].covered, true);
});

test('固定照顧：同步換編號、離所再入所仍保留；舊資料包也不能帶回試算表標記', async () => {
  const env = await setup();
  // 模擬上線前的資料包；其版本與目前相同，不能只等版本號改變。
  await dogs(env);
  const packed = await env.DB.prepare("SELECT * FROM v3_packs WHERE part='main'").all();
  assert.ok(packed.results.length);
  for (const row of packed.results) {
    const body = JSON.parse(row.body);
    delete body.fixedCareVersion;
    body.dogs.dogs[0].covered = true;
    await env.DB.prepare("UPDATE v3_packs SET body=? WHERE part='main' AND seq=?").bind(JSON.stringify(body), row.seq).run();
  }
  worker.testing.resetState();
  assert.equal((await dogs(env))[0].covered, false);
  await call(env, '/fixed-care/2024032902', { editor: '甲', enabled: true });
  await importCompactDogs(env.DB, { dogs: [{ id: '2026101801', name: '甲', formerIds: ['2024032902'] }] });
  assert.equal((await dogs(env))[0].covered, true);
  await importCompactDogs(env.DB, { dogs: [{ id: '2024010101', name: '乙' }] });
  await importCompactDogs(env.DB, { dogs: [{ id: '2026101801', name: '甲', covered: false }] });
  assert.equal((await dogs(env))[0].covered, true);
});

test('固定照顧：全部預設關閉，網站開關經狗清單讀回，舊編號指向同一隻狗並記編輯紀錄', async () => {
  const env = await setup();
  assert.deepEqual((await dogs(env)).map(d => d.covered), [false, false]);
  const on = await call(env, '/fixed-care/2020010101', { editor: '志工甲', enabled: true });
  assert.equal(on.status, 200);
  assert.equal(on.body.enabled, true);
  assert.equal(await env.DB.prepare("SELECT fixed_care FROM v3_dogs WHERE name='甲'").first('fixed_care'), 1, '設定跟狗的永久資料存同一列');
  assert.deepEqual((await dogs(env)).map(d => d.covered), [true, false]);
  const changes = await env.DB.prepare('SELECT total_changes() AS n').first('n');
  await call(env, '/fixed-care/2024032902', { editor: '志工甲', enabled: true });
  assert.equal(await env.DB.prepare('SELECT total_changes() AS n').first('n'), changes, '重送相同設定零寫入');
  worker.testing.resetState(); // 另一個 Worker／手機重新讀取也一樣
  assert.equal((await dogs(env))[0].covered, true);
  const off = await call(env, '/fixed-care/2024032902', { editor: '志工乙', enabled: false });
  assert.equal(off.status, 200);
  assert.equal((await dogs(env))[0].covered, false);
  const edits = (await call(env, '/edits')).body.edits;
  assert.deepEqual(edits.map(e => [e.kind, e.kindLabel, e.before, e.after]), [
    ['fixed-care', '有人固定照顧', true, false], ['fixed-care', '有人固定照顧', false, true],
  ]);
});

test('固定照顧：沒有編號的狗也能獨立設定，不按同名合併', async () => {
  const env = await setup();
  await importCompactDogs(env.DB, { dogs: [{ id: '', name: '無編號' }, { id: '2024010101', name: '乙' }] });
  const dog = (await dogs(env))[0];
  assert.match(dog.dogId, /^[a-f0-9]{32}$/);
  assert.equal((await call(env, `/fixed-care/${dog.dogId}`, { editor: '甲', enabled: true })).status, 200);
  assert.deepEqual((await dogs(env)).map(d => d.covered), [true, false]);
});

test('固定照顧 API：無關設定多 10 倍，單次讀寫量固定且只用索引查詢', async () => {
  const env = await setup();
  const measure = async enabled => {
    const before = await env.DB.prepare('SELECT total_changes() AS n').first('n');
    const readsBefore = env.DB.stats.rowsRead;
    const sql = [];
    const spy = { ...env.DB, prepare(query) { sql.push(query); return env.DB.prepare(query); } };
    assert.equal((await call({ ...env, DB: spy }, '/fixed-care/2024032902', { editor: '甲', enabled })).status, 200);
    const reads = env.DB.stats.rowsRead - readsBefore;
    const writes = (await env.DB.prepare('SELECT total_changes() AS n').first('n')) - before;
    for (const query of sql.filter(q => /^SELECT/.test(q))) {
      const plan = (await env.DB.prepare(`EXPLAIN QUERY PLAN ${query.replace(/\?/g, "'2024032902'")}`).all()).results;
      assert.ok(plan.every(p => !/SCAN /.test(p.detail)), query);
    }
    return { reads, writes };
  };
  const seed = async (start, end) => {
    for (let n = start; n < end; n++) {
      const id = n.toString(16).padStart(32, '0');
      await env.DB.prepare('INSERT INTO v3_dogs(dog_id,name,fixed_care) VALUES(?,?,1)').bind(id, `無關${n}`).run();
    }
  };
  await seed(1, 11);
  await call(env, '/fixed-care/2024032902', { editor: '甲', enabled: true });
  await call(env, '/fixed-care/2024032902', { editor: '甲', enabled: false });
  const small = await measure(true);
  await seed(11, 101);
  assert.deepEqual(await measure(false), small);
  assert.deepEqual(small, { reads: 3, writes: 3 });
});
