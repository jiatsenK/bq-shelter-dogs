// 志工身分更新（public/js/identity.js，#623 R8）：設定名字、常溜同步、圖鑑共用的規則
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendModule } from './frontend-module-test-helper.mjs';

// respond(body)：回應前可以改手機上的身分，模擬「送出到回來之間被改過」
async function load(respond) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push([url, JSON.parse(init.body)]);
    const { status = 200, json } = await respond(JSON.parse(init.body));
    return new Response(JSON.stringify(json), { status });
  };
  const ctx = { location: { origin: 'https://bq.test' }, fetch };
  ctx.window = ctx;
  return { ...(await loadFrontendModule('identity.js', ctx)), calls };
}

function phone(name, codes) {
  const state = { name, codes, writes: [] };
  return { state, read: () => ({ name: state.name, codes: state.codes }), write: identity => { state.writes.push(identity); state.name = identity.name; state.codes = identity.codes; } };
}

const IDENTITY = { name: '小明（王）', codes: ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'] };

test('名字和代號都沒被改：存 Worker 回的登記名字與代號', async () => {
  const { refreshIdentity, calls } = await load(() => ({ json: { ok: true, identity: IDENTITY } }));
  const p = phone('小明', ['aaaaaaaaaaaa']);
  const result = await refreshIdentity('小明', p);
  assert.equal(result.status, 'saved');
  assert.deepEqual(p.state.writes.map(w => ({ name: w.name, codes: [...w.codes] })), [IDENTITY]);
  assert.equal(calls[0][0], 'https://bq.test/api/identity');
  assert.deepEqual(calls[0][1], { name: '小明' });
});

test('送出到回來之間名字或代號被改過：不存，回 changed', async () => {
  for (const change of [p => { p.state.name = '小華'; }, p => { p.state.codes = ['cccccccccccc']; }]) {
    const p = phone('小明', ['aaaaaaaaaaaa']);
    const { refreshIdentity } = await load(() => { change(p); return { json: { ok: true, identity: IDENTITY } }; });
    const result = await refreshIdentity('小明', p);
    assert.equal(result.status, 'changed');
    assert.deepEqual(p.state.writes, []);
  }
});

test('伺服器拒絕或斷線：丟出給人看的原因，不存', async () => {
  const p = phone('小明', ['aaaaaaaaaaaa']);
  let { refreshIdentity } = await load(() => ({ status: 409, json: { ok: false, error: '這個名字有多個既有身分，請先確認對照', targetCode: 'dddddddddddd' } }));
  await assert.rejects(refreshIdentity('小明', p), e => e.message === '這個名字有多個既有身分，請先確認對照' && e.targetCode === 'dddddddddddd');
  ({ refreshIdentity } = await load(() => ({ status: 500, json: { ok: false } })));
  await assert.rejects(refreshIdentity('小明', p), /身分設定失敗，請稍後再試/);
  ({ refreshIdentity } = await load(() => { throw new TypeError('Failed to fetch'); }));
  await assert.rejects(refreshIdentity('小明', p));
  assert.deepEqual(p.state.writes, []);
});

test('改名、合併也走同一個請求：帶 action 路徑', async () => {
  const { identityRequest, calls } = await load(() => ({ json: { ok: true, identity: IDENTITY } }));
  const out = await identityRequest('/rename', { code: 'aaaaaaaaaaaa', name: '小明（王）' });
  assert.equal(out.identity.name, '小明（王）');
  assert.equal(calls[0][0], 'https://bq.test/api/identity/rename');
});
