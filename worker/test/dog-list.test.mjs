// #501：狗清單改成有人編輯才同步（ADR 0018 第 5–7 點）。GAS 只送受影響的列，Worker 只改那幾隻；
// 保險掃描只比指紋，不一樣的才要；照片垃圾桶每月 1 日自己的排程。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { setup } from './walk-fixture.mjs';
import { walkerCode } from '../src/editlog.js';
import { removeFormerNumber } from '../src/compact.js';

const post = (env, action, body, key = env.SHEET_WRITE_KEY) => worker.fetch(new Request(`https://worker.example/api/walk-writeback/${action}`, {
  method:'POST', headers:{ 'X-Sheet-Write-Key':key }, body:JSON.stringify(body),
}), env);
const send = async (env, rows) => {
  const res = await post(env, 'dog-list', { rows });
  assert.equal(res.status, 200);
  return (await res.json()).results;
};
const writes = async env => (await env.DB.prepare('SELECT total_changes() n').first()).n;
const main = (extra = {}) => ({ sheet:'main', hash:'h1', dog:{ id:'9001', name:'測試狗' }, cage:'A01', note:'', date:'2026-10-01', walker:'', ...extra });
const mainRows = async env => (await env.DB.prepare('SELECT number,name,cage,note,walked_date FROM v3_sheet_main ORDER BY row_index').all()).results;

test('#501 改狗清單一格只更新那隻狗；同樣內容再送不寫', async () => {
  const env = await setup();
  worker.testing.resetState();
  try {
    assert.equal((await post(env, 'dog-list', { rows:[main()] }, 'forged')).status, 403);
    assert.deepEqual((await send(env, [main({ cage:'B02' })])).map(r => r.ack), [true]);
    assert.deepEqual(await mainRows(env), [{ number:'9001', name:'測試狗', cage:'B02', note:'', walked_date:'2026-10-01' }]);
    assert.match((await env.DB.prepare("SELECT value FROM v3_sync_state WHERE key='synced_at'").first()).value, /\+08:00$/, '有改才更新「資料更新」時間');
    const before = await writes(env);
    assert.deepEqual((await send(env, [main({ cage:'B02' })])).map(r => r.ack), [true]);
    assert.equal(await writes(env), before, '無差異不重寫業務資料（指紋也一樣）');
  } finally { env.DB.close(); }
});

test('#501 新狗從編輯觸發進網站：建永久狗、編號、主清單列', async () => {
  const env = await setup();
  worker.testing.resetState();
  try {
    await send(env, [main({ dog:{ id:'9002', name:'新來的' }, cage:'C03', date:'' })]);
    const rows = await mainRows(env);
    assert.deepEqual(rows.map(r => [r.number, r.name, r.cage]), [['9001', '測試狗', ''], ['9002', '新來的', 'C03']]);
    assert.ok(await env.DB.prepare("SELECT 1 FROM v3_dog_numbers n JOIN v3_dogs d USING(dog_id) WHERE n.number='9002' AND d.name='新來的'").first());
    // 沒有籠位的不是狗（表尾提示文字），回 ack 但不建
    await send(env, [main({ dog:{ id:'', name:'今天週四' }, cage:'' })]);
    assert.equal((await mainRows(env)).length, 2);
  } finally { env.DB.close(); }
});

test('#501 遛狗日期變新：更新主清單列、名字換代號、追加溜狗紀錄', async () => {
  const env = await setup();
  worker.testing.resetState();
  try {
    await send(env, [main({ date:'2026-10-05', walker:'甲、乙' })]);
    const row = await env.DB.prepare("SELECT walked_date,walker FROM v3_sheet_main WHERE number='9001'").first();
    assert.deepEqual({ ...row }, { walked_date:'2026-10-05', walker:'甲、乙' });
    const codes = [await walkerCode('甲', 'test'), await walkerCode('乙', 'test')];
    assert.deepEqual(JSON.parse((await env.DB.prepare("SELECT walker_codes FROM v3_sheet_main WHERE number='9001'").first()).walker_codes), codes);
    const walks = (await env.DB.prepare("SELECT walk_date,walker_code,dog_number FROM v3_walks WHERE dog_id='dog' ORDER BY position").all()).results;
    assert.deepEqual(walks.map(w => [w.walk_date, w.walker_code, w.dog_number]), codes.map(c => ['2026-10-05', c, '9001']));
    // 日期改回較早（K 2026-10-24，例如 Ctrl+Z）：那天照表上名單重寫，表上不再寫的較新那天刪掉
    await send(env, [main({ hash:'h2', date:'2026-09-30', walker:'甲' })]);
    const after = (await env.DB.prepare("SELECT walk_date,walker_code FROM v3_walks WHERE dog_id='dog' ORDER BY walk_date,position").all()).results;
    assert.deepEqual(after.map(w => [w.walk_date, w.walker_code]), [['2026-09-30', codes[0]]]);
  } finally { env.DB.close(); }
});

test('#501 出現在「已出所」：記離所（原因照共用規則）、從主清單移走', async () => {
  const env = await setup();
  worker.testing.resetState();
  try {
    await send(env, [main({ cage:'A01', note:'親人' })]);
    const results = await send(env, [{ sheet:'departed', hash:'d1', dog:{ id:'9001', name:'測試狗' }, texts:['9001', '測試狗', '2026/10/20被認養'], dates:[] }]);
    assert.deepEqual(results.map(r => r.ack), [true]);
    assert.deepEqual(await mainRows(env), []);
    const d = await env.DB.prepare("SELECT reason,matched,departed_date,date_source,last_cage,last_note FROM v3_dog_departures WHERE number='9001'").first();
    assert.deepEqual({ ...d }, { reason:'adopt', matched:'被認養', departed_date:'2026-10-20', date_source:'note', last_cage:'A01', last_note:'親人' });
    // 沒編號的狗記不了離所，不從主清單移走
    await send(env, [main({ dog:{ id:'', name:'無號' }, cage:'Z1' }), { sheet:'departed', hash:'d2', dog:{ id:'', name:'無號' }, texts:['無號', '被認養'], dates:[] }]);
    assert.deepEqual((await mainRows(env)).map(r => r.name), ['無號']);
    await env.DB.prepare("DELETE FROM v3_sheet_main WHERE name='無號'").run();
    // 又出現在主清單（例：退養回來）就不算離所
    await send(env, [main({ hash:'h3' })]);
    assert.equal(await env.DB.prepare("SELECT 1 FROM v3_dog_departures WHERE number='9001'").first(), null);
    assert.equal((await mainRows(env)).length, 1);
  } finally { env.DB.close(); }
});

// #557：舊編號表 v3_sheet_former_numbers 已刪，舊編號從 v3_dog_numbers 推
test('#557 記離所的舊編號從 v3_dog_numbers 抄；刪掉的舊編號不會抄進去', async () => {
  const env = await setup();
  worker.testing.resetState();
  try {
    await send(env, [main()]);
    const row = await env.DB.prepare("SELECT row_index,dog_id FROM v3_sheet_main WHERE number='9001'").first();
    await env.DB.prepare('INSERT INTO v3_dog_numbers VALUES(?,?),(?,?)').bind('8001', row.dog_id, '8002', row.dog_id).run();
    assert.deepEqual(await removeFormerNumber(env.DB, '9001', '8001'), { ok:true, dogId:row.dog_id });
    assert.deepEqual((await send(env, [{ sheet:'departed', hash:'d1', dog:{ id:'9001', name:'測試狗' }, texts:['9001', '測試狗', '被認養'], dates:[] }])).map(r => r.ack), [true]);
    assert.deepEqual(await mainRows(env), []);
    assert.deepEqual(JSON.parse(await env.DB.prepare("SELECT former_json FROM v3_dog_departures WHERE number='9001'").first('former_json')), ['8002']);
  } finally { env.DB.close(); }
});

test('#501 常遛狗群一欄、異動紀錄整段：只換送來的那欄', async () => {
  const env = await setup();
  worker.testing.resetState();
  try {
    await send(env, [main({ dog:{ id:'9002', name:'Mini' }, cage:'C03' })]);
    await env.DB.prepare("INSERT INTO v3_sheet_group_columns(column_index,names) VALUES(0,'[\"別欄\"]')").run();
    await send(env, [{ sheet:'groups', hash:'g', column:1, names:['測試狗', 'mini', '不在清單'], label:'新十' },
      { sheet:'notes', hash:'n', items:[{ label:'備註1', text:'1/7 換籠' }] }]);
    // 一欄一列（#559）：只換送來的第 1 欄，群名和狗名在同一列
    assert.deepEqual((await env.DB.prepare('SELECT column_index,label,names FROM v3_sheet_group_columns ORDER BY column_index').all()).results.map(r => [r.column_index, r.label, JSON.parse(r.names)]),
      [[0, '', ['別欄']], [1, '新十', ['測試狗', 'Mini']]]);
    assert.deepEqual({ ...await env.DB.prepare('SELECT label,text FROM v3_sheet_changes').first() }, { label:'備註1', text:'1/7 換籠' });
  } finally { env.DB.close(); }
});

test('#501 保險掃描：指紋一樣不要資料；不一樣只要那幾列；D1 有、試算表沒有的只列出來', async () => {
  const env = await setup();
  worker.testing.resetState();
  const scan = async fingerprints => (await (await post(env, 'dog-list-scan', { fingerprints })).json());
  try {
    // D1 還沒有指紋（第一次）：全部要
    assert.deepEqual((await scan({ 'main:9001':'h1', 'groups:0':'g' })).want.sort(), ['groups:0', 'main:9001']);
    await send(env, [main(), { sheet:'groups', hash:'g', column:0, names:[], label:'' }]);
    const before = await writes(env);
    const same = await scan({ 'main:9001':'h1', 'groups:0':'g' });
    assert.deepEqual(same.want, []);
    assert.equal(await writes(env), before + 1, '指紋一樣不寫資料，只更新掃描時間 1 列（#567）');
    assert.ok(JSON.parse((await env.DB.prepare("SELECT value FROM v3_sync_state WHERE key='dog_list_extra'").first()).value).checkedAt);
    await send(env, [main({ dog:{ id:'9002', name:'走了' }, hash:'x' })]);
    const diff = await scan({ 'main:9001':'h9', 'groups:0':'g' });
    assert.deepEqual(diff.want, ['main:9001']);
    assert.deepEqual(diff.extra, ['main:9002']);
    assert.equal((await mainRows(env)).length, 2, '不自動刪');
    assert.match((await env.DB.prepare("SELECT value FROM v3_sync_state WHERE key='dog_list_extra'").first()).value, /9002/);
  } finally { env.DB.close(); }
});

test('#501 每 10 分鐘的試算表同步排程已移除；照片垃圾桶每月 1 日清理並記下結果', async () => {
  const config = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /"\*\/10 \* \* \* \*"/);
  assert.match(config, /"17 2 1 \* \*"/);
  const env = await setup();
  const calls = [], real = globalThis.fetch;
  globalThis.fetch = async url => { calls.push(String(url)); return new Response('', { status:204 }); };
  let purged = 0;
  env.PHOTOS = { list:async () => { purged++; return { objects:[], truncated:false }; } };
  try {
    for (const cron of ['5-59/10 * * * *', '43 1 * * *', '17 2 1 * *']) {
      const tasks = [];
      await worker.scheduled({ scheduledTime:Date.UTC(2026, 10, 1, 2, 17), cron }, env, { waitUntil:p => tasks.push(p) });
      await Promise.allSettled(tasks);
    }
    assert.ok(!calls.some(u => u.includes('api.github.com')), '不再叫 GitHub 同步');
    assert.equal(purged, 1, '只有每月排程清垃圾桶');
    assert.match((await env.DB.prepare("SELECT value FROM v3_sync_state WHERE key='trash_purged'").first()).value, /"purged":0/);
  } finally { globalThis.fetch = real; env.DB.close(); }
});

// GAS（apps-script/sheet-write.gs）整理出的單位直接餵給 Worker：單位名稱兩邊要一樣，指紋一樣第二次掃描就不要資料
test('#501 GAS 整理的單位與 Worker 對得上：第一次全送，第二次指紋一樣不送；只改一格只送那隻', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(await readFile(new URL('../../apps-script/sheet-write.gs', import.meta.url), 'utf8'), ctx);
  const ymd = d => d.toISOString().slice(0, 10);
  const hash = t => String([...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
  const sheets = () => ({
    main: [['籠位', '編號', '犬名', '遛狗日期', '誰遛的', '備註'], ['A01', '9001', '測試狗', '2026/10/1', '', ''], ['B01', '9003', '二號', '', '甲', '怕生'],
      ['備註1', '1/7 換籠', '', '', '', '']],
    departed: [['編號', '犬名', '出所日期', '備註'], ['8001', '舊狗', new Date('2026-09-01T00:00:00Z'), '被認養']],
    groups: [['', ''], [2, 1], ['測試狗', '二號'], ['二號', ''], ['新十', '舊八']],
  });
  const units = vm.runInContext('dogListUnits', ctx)(sheets(), ymd, hash);
  assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(units).sort())), ['departed:8001', 'groups:0', 'groups:1', 'main:9001', 'main:9003', 'notes']);
  const edited = vm.runInContext('dogListKeysForEdit', ctx)('main', sheets().main, vm.runInContext('findHeader', ctx)(sheets().main), 1, 3, 0, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(edited)), ['main:9001', 'main:9003', 'notes']);
  const order = vm.runInContext('orderDogListKeys', ctx);
  const env = await setup();
  worker.testing.resetState();
  try {
    const fingerprints = Object.fromEntries(Object.entries(units).map(([k, u]) => [k, u.hash]));
    const scan = async () => (await (await post(env, 'dog-list-scan', { fingerprints })).json()).want;
    const want = order(await scan());
    assert.equal(want[0].split(':')[0], 'main', '主清單先送，狗群才對得到犬名');
    for (let i = 0; i < want.length; i += 10) assert.ok((await send(env, want.slice(i, i + 10).map(k => units[k]))).every(r => r.ack));
    assert.deepEqual(await scan(), []);
    assert.deepEqual(JSON.parse((await env.DB.prepare('SELECT names FROM v3_sheet_group_columns WHERE column_index=0').first()).names), ['測試狗', '二號']);
    const changed = sheets();
    changed.main[2][0] = 'C09';
    const again = vm.runInContext('dogListUnits', ctx)(changed, ymd, hash);
    fingerprints['main:9003'] = again['main:9003'].hash;
    assert.deepEqual(await scan(), ['main:9003']);
  } finally { env.DB.close(); }
});

// 狗回所會拿新編號，沒人會在網站上連舊編號：離所紀錄裡剛好一筆同名、主清單沒別的同名，就認定是同一隻（K 2026-10-24，取代 #252「有編號絕不按名字合併」）
test('#501 新編號回所：同名的唯一一筆離所認成同一隻，連上新編號、註明回所並記編輯紀錄；同名多筆不合併', async () => {
  const env = await setup();
  worker.testing.resetState();
  try {
    await send(env, [main({ note:'親人' }), { sheet:'departed', hash:'d1', dog:{ id:'9001', name:'測試狗' }, texts:['9001', '測試狗', '被認養'], dates:[] }]);
    await send(env, [main({ dog:{ id:'9100', name:'測試狗' }, hash:'h9', cage:'R01' })]);
    assert.equal(await env.DB.prepare("SELECT dog_id FROM v3_dog_numbers WHERE number='9100'").first('dog_id'), 'dog', '新編號連到原本的狗');
    assert.equal(await env.DB.prepare("SELECT returned_number FROM v3_dog_departures WHERE number='9001'").first('returned_number'), '9100');
    assert.deepEqual((await env.DB.prepare("SELECT number FROM v3_dog_numbers WHERE dog_id='dog' AND number<>'9100'").all()).results.map(r => r.number), ['9001']);
    const log = await env.DB.prepare("SELECT kind,dog_id,dog_number FROM v3_edit_log").first();
    assert.deepEqual({ ...log }, { kind:'former', dog_id:'dog', dog_number:'9100' });
    // 同名兩筆離所：認不出來，當新狗
    await env.DB.batch([
      env.DB.prepare("INSERT INTO v3_dogs(dog_id,name) VALUES('a','小黑'),('b','小黑')"),
      env.DB.prepare("INSERT INTO v3_dog_numbers VALUES('7001','a'),('7002','b')"),
      env.DB.prepare("INSERT INTO v3_dog_departures(number,dog_id,name) VALUES('7001','a','小黑'),('7002','b','小黑')")]);
    await send(env, [main({ dog:{ id:'9200', name:'小黑' }, hash:'h10', cage:'R02' })]);
    assert.ok(!['a', 'b'].includes(await env.DB.prepare("SELECT dog_id FROM v3_dog_numbers WHERE number='9200'").first('dog_id')));
  } finally { env.DB.close(); }
});

// 2026-10-24 正式切換時：栗子、MINI 還在主清單，「已出所」也有舊的一列，保險掃描把牠們誤記離所。
// 兩邊都有時以主清單為準（同舊同步），GAS 不送已出所那一列
test('#501 主清單和已出所都有的狗：GAS 不送已出所單位，網站不會誤記離所', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(await readFile(new URL('../../apps-script/sheet-write.gs', import.meta.url), 'utf8'), ctx);
  const units = vm.runInContext('dogListUnits', ctx)({
    main: [['籠位', '編號', '犬名'], ['A01', '9001', '測試狗'], ['A02', '', '無號']],
    departed: [['編號', '犬名', '備註'], ['9001', '測試狗', '以前退養'], ['', '無號', '舊'], ['8001', '走了', '被認養']],
    groups: [],
  }, d => d.toISOString().slice(0, 10), t => t);
  assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(units).sort())), ['departed:8001', 'main:9001', 'main:名:無號']);
});

test('#501 新增狗先打名字、後補編號：補到同一隻，不多出一隻沒編號的', async () => {
  const env = await setup();
  worker.testing.resetState();
  try {
    await send(env, [{ ...main({ dog:{ id:'', name:'先打名' }, cage:'舊B07', date:'' }), hash:'n1' }]);
    const before = (await env.DB.prepare("SELECT dog_id FROM v3_sheet_main WHERE name='先打名'").first()).dog_id;
    await send(env, [{ ...main({ dog:{ id:'9003', name:'先打名' }, cage:'舊B07', date:'' }), hash:'n2' }]);
    const rows = (await env.DB.prepare("SELECT number,dog_id FROM v3_sheet_main WHERE name='先打名'").all()).results;
    assert.deepEqual(rows, [{ number:'9003', dog_id:before }]);
    assert.equal((await env.DB.prepare("SELECT dog_id FROM v3_dog_numbers WHERE number='9003'").first()).dog_id, before);
    const fp = JSON.parse((await env.DB.prepare("SELECT value FROM v3_sync_state WHERE key='dog_list_fp'").first()).value);
    assert.equal(fp['main:名:先打名'], undefined, '舊的名字單位不留，掃描不會列成多出來的');
  } finally { env.DB.close(); }
});

test('#519 試算表「誰遛的」填了新名字：記進志工名單，/walkers 換得回名字（2026-10-24 實測「123」換不回來）', async () => {
  const env = await setup();
  worker.testing.resetState();
  try {
    await send(env, [main({ date:'2026-10-05', walker:'新志工、甲' })]);
    const code = await walkerCode('新志工', 'test');
    assert.equal(await env.DB.prepare('SELECT name FROM v3_identity_names WHERE code=?').bind(code).first('name'), '新志工');
    const res = await worker.fetch(new Request('https://bq-shelter-dogs.<子網域>.workers.dev/api/walkers', { headers:{ Origin:'https://bq-shelter-dogs.<子網域>.workers.dev' } }), env);
    const body = await res.json();
    assert.equal(body.walkers['9001'], '新志工、甲');
    assert.ok(body.names.includes('新志工'));
  } finally { env.DB.close(); }
});

test('#519 改錯再改回（2026-10-24 IU 實測）：同一天先換人、日期改新、再整格 Ctrl+Z，舊的那天救回原本的人', async () => {
  const env = await setup();
  worker.testing.resetState();
  try {
    await send(env, [main({ date:'2026-10-20', walker:'甲' })]);
    await send(env, [main({ hash:'h2', date:'2026-10-20', walker:'123' })]);
    await send(env, [main({ hash:'h3', date:'2026-10-24', walker:'123' })]);
    await send(env, [main({ hash:'h4', date:'2026-10-20', walker:'甲' })]);
    const walks = (await env.DB.prepare("SELECT walk_date,walker_code FROM v3_walks WHERE dog_id='dog' ORDER BY walk_date,position").all()).results;
    assert.deepEqual(walks.map(w => [w.walk_date, w.walker_code]), [['2026-10-20', await walkerCode('甲', 'test')]]);
  } finally { env.DB.close(); }
});

test('#519 「誰遛的」原文存進 D1 主清單：/walkers 直接回原文，不用代號換名字', async () => {
  const env = await setup();
  worker.testing.resetState();
  try {
    await send(env, [main({ date:'2026-10-05', walker:'志工乙+志工丙' })]);
    assert.equal(await env.DB.prepare("SELECT walker FROM v3_sheet_main WHERE number='9001'").first('walker'), '志工乙+志工丙');
    const body = await (await worker.fetch(new Request('https://bq-shelter-dogs.<子網域>.workers.dev/api/walkers', { headers:{ Origin:'https://bq-shelter-dogs.<子網域>.workers.dev' } }), env)).json();
    assert.equal(body.walkers['9001'], '志工乙+志工丙');
    // 清空也記成空字串（不是 NULL），手機才知道被清掉
    await send(env, [main({ hash:'h2', date:'2026-10-05', walker:'' })]);
    assert.equal(await env.DB.prepare("SELECT walker FROM v3_sheet_main WHERE number='9001'").first('walker'), '');
  } finally { env.DB.close(); }
});

test('#519 補填原文：主清單 walker 還是 NULL 的狗，保險掃描指紋一樣也要送', async () => {
  const env = await setup();
  worker.testing.resetState();
  const scan = async fingerprints => (await (await post(env, 'dog-list-scan', { fingerprints })).json());
  try {
    await send(env, [main()]);
    assert.deepEqual((await scan({ 'main:9001':'h1' })).want, []);
    await env.DB.prepare("UPDATE v3_sheet_main SET walker=NULL WHERE number='9001'").run();
    assert.deepEqual((await scan({ 'main:9001':'h1' })).want, ['main:9001']);
    await send(env, [main()]);
    assert.deepEqual((await scan({ 'main:9001':'h1' })).want, [], '補好就不再要');
  } finally { env.DB.close(); }
});

test('#528 保險掃描清掉舊指紋：回所的狗（主清單有）、D1 已經沒有的狗不再列為 D1 有、試算表沒有', async () => {
  const env = await setup();
  worker.testing.resetState();
  const scan = async fingerprints => (await (await post(env, 'dog-list-scan', { fingerprints })).json());
  const fp = async () => JSON.parse(await env.DB.prepare("SELECT value FROM v3_sync_state WHERE key='dog_list_fp'").first('value'));
  try {
    await send(env, [main({ dog:{ id:'9002', name:'走了' }, hash:'x' })]);
    // #522 之前建的舊指紋：9001 回所（主清單有）、7777 測試狗已清掉
    const old = { ...(await fp()), 'departed:9001':'d1', 'departed:7777':'d2', 'main:名:清掉的':'d3' };
    await env.DB.prepare("UPDATE v3_sync_state SET value=? WHERE key='dog_list_fp'").bind(JSON.stringify(old)).run();
    const out = await scan({ 'main:9001':'h1' });
    assert.deepEqual(out.extra, ['main:9002'], 'D1 真的還有、試算表沒有的照舊列出');
    assert.deepEqual(Object.keys(await fp()).sort(), ['main:9002'].concat(Object.keys(old).filter(k => k === 'main:9001')).sort(), '只刪舊指紋');
    assert.equal((await mainRows(env)).length, 2, '不刪狗的資料');
  } finally { env.DB.close(); }
});

test('#512 狗清單（取代舊同步）不擁有 fixed_care：收列時不讀不寫網站的固定照顧設定', () => {
  assert.doesNotMatch(readFileSync(new URL('../src/dog-list.js', import.meta.url), 'utf8'), /fixed_care/);
});

// #554：異動紀錄改一格只寫有變的那段，不再整段刪掉重寫（21 段原本約 84 列寫入）
test('#554 異動紀錄改一段只寫那段；變長補新段、變短刪尾巴', async () => {
  const env = await setup();
  worker.testing.resetState();
  const notes = items => ({ sheet:'notes', hash:`n${Math.random()}`, items });
  const rows = async () => (await env.DB.prepare('SELECT row_index,label,text FROM v3_sheet_changes ORDER BY row_index').all()).results.map(r => [r.row_index, r.label, r.text]);
  const changed = async () => (await env.DB.prepare('SELECT COUNT(*) n FROM v3_sheet_changes').first()).n;
  try {
    const items = Array.from({ length:21 }, (_, i) => ({ label:`備註${i + 1}`, text:`第 ${i + 1} 段` }));
    await send(env, [notes(items)]);
    assert.equal(await changed(), 21);
    const small = async () => (await env.DB.prepare('SELECT small FROM v3_pack_versions WHERE id=1').first()).small;

    let before = await small();
    items[4] = { label:'備註5', text:'改過了' };
    await send(env, [notes(items)]);
    assert.equal(await small() - before, 1, '只改 1 段，觸發器只跑 1 次（原本刪 21＋寫 21）');
    assert.deepEqual((await rows())[4], [4, '備註5', '改過了']);

    before = await small();
    await send(env, [notes([...items, { label:'備註22', text:'新的' }])]);
    assert.equal(await small() - before, 1, '多 1 段只新增那段');
    assert.equal(await changed(), 22);

    before = await small();
    await send(env, [notes(items.slice(0, 19))]);
    assert.equal(await small() - before, 3, '少 3 段只刪那 3 段');
    assert.deepEqual(await rows(), items.slice(0, 19).map((n, i) => [i, n.label, n.text]));
  } finally { env.DB.close(); }
});

// #554：入所介紹存在 v3_intros（#250），主清單的 intro 欄在正式庫全空；記離所要抄 v3_intros，離所名冊才有介紹
test('#554 記離所時 last_intro 抄 v3_intros；已經記過的離所再送不動介紹', async () => {
  const env = await setup();
  worker.testing.resetState();
  const departed = (texts, hash = 'd1') => ({ sheet:'departed', hash, dog:{ id:'9001', name:'測試狗' }, texts:['9001', '測試狗', ...texts], dates:[] });
  const lastIntro = async () => (await env.DB.prepare("SELECT last_intro FROM v3_dog_departures WHERE number='9001'").first()).last_intro;
  try {
    await send(env, [main()]);
    await env.DB.prepare("INSERT INTO v3_intros(dog_id,intro) VALUES('dog','2026/9 從板橋入所，親人')").run();
    await send(env, [departed(['被認養'])]);
    assert.equal(await lastIntro(), '2026/9 從板橋入所，親人');

    await env.DB.prepare("UPDATE v3_dog_departures SET last_intro='舊同步記的介紹' WHERE number='9001'").run();
    await send(env, [departed(['2026/10/20被認養'], 'd2')]);
    assert.equal(await lastIntro(), '舊同步記的介紹', '補原因、日期只改原因欄');
  } finally { env.DB.close(); }
});
