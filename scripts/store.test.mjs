import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendModule } from './frontend-module-test-helper.mjs';

async function load(extra = {}) {
  return (await loadFrontendModule('store.js', extra)).BQStore;
}
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
}

test('舊名字與代號原樣讀取，寫入與移除維持原本鍵名、格式', async () => {
  const storage = fakeStorage({ 'bq-walker-name': '小明', 'bq-walker-codes': '["abcdef123456"]' });
  const store = (await load()).create(storage);
  assert.equal(store.get('bq-walker-name'), '小明');
  assert.equal(JSON.stringify(store.readJson('bq-walker-codes')), '["abcdef123456"]');
  store.set('bq-walker-name', '小美');
  store.writeJson('bq-walked-today', { date: '2026-10-23', ids: ['2024100502'] });
  assert.equal(storage.getItem('bq-walker-name'), '小美');
  assert.equal(storage.getItem('bq-walked-today'), '{"date":"2026-10-23","ids":["2024100502"]}');
  store.remove('bq-walker-codes');
  assert.equal(storage.getItem('bq-walker-codes'), null);
});

test('儲存空間滿了仍記住最新值、移除結果，不被可讀的舊值蓋回', async () => {
  const store = (await load()).create({ getItem: () => '舊值', setItem() { throw Error('quota'); }, removeItem() { throw Error('blocked'); } });
  assert.equal(store.get('bq-walker-name'), '舊值');
  assert.equal(store.set('bq-walker-name', '新值'), false, '回報沒有寫進持久儲存');
  assert.equal(store.get('bq-walker-name'), '新值');
  assert.equal(store.remove('bq-walker-name'), false);
  assert.equal(store.get('bq-walker-name'), null);
});

test('預設讀瀏覽器儲存空間；無痕模式連取得儲存空間都失敗時仍可使用', async () => {
  const storage = fakeStorage({ 'bq-walker-name': '小明' });
  assert.equal((await load({ localStorage: storage })).get('bq-walker-name'), '小明');
  const blocked = Object.defineProperty({}, 'localStorage', { get() { throw Error('SecurityError'); } });
  const store = (await load(blocked));
  store.writeJson('bq-companions', ['小明']);
  assert.equal(JSON.stringify(store.readJson('bq-companions')), '["小明"]');
});

test('壞掉或沒有 JSON 資料時回傳呼叫端的備援值，有效的 false 保持原值', async () => {
  const store = (await load()).create(fakeStorage({ broken: '{壞掉', flag: 'false' }));
  assert.equal(store.readJson('missing', '備援'), '備援');
  assert.equal(store.readJson('broken', '備援'), '備援');
  assert.equal(store.readJson('flag', true), false);
});


test('兩個頁籤與舊版頁面共用原儲存空間，每次讀到對方最新寫入或刪除', async () => {
  const storage = fakeStorage({ 'bq-walker-name': '小明' });
  const api = (await load()), first = api.create(storage), second = api.create(storage);
  assert.equal(first.get(api.keys.walkerName), '小明');
  second.set(api.keys.walkerName, '小美');
  assert.equal(first.get(api.keys.walkerName), '小美');
  storage.setItem('bq-walker-name', '舊版分頁');
  assert.equal(second.get(api.keys.walkerName), '舊版分頁');
  second.remove(api.keys.walkerName);
  assert.equal(first.get(api.keys.walkerName), null);
});

test('讀取暫時被拒時可使用剛讀到的資料；不同記憶體儲存互不影響', async () => {
  const storage = fakeStorage({ 'bq-companions': '["小明"]' });
  const api = (await load()), store = api.create(storage);
  assert.equal(JSON.stringify(store.readJson(api.keys.companions)), '["小明"]');
  storage.getItem = () => { throw Error('blocked'); };
  assert.equal(JSON.stringify(store.readJson(api.keys.companions)), '["小明"]');
  const first = api.create(null), second = api.create(null);
  first.set(api.keys.walkerName, '小明');
  assert.equal(first.get(api.keys.walkerName), '小明');
  assert.equal(second.get(api.keys.walkerName), null);
});

test('暫時寫不進去不影響其他鍵；重新成功儲存後恢復讀取其他頁籤的改動', async () => {
  const storage = fakeStorage({ 'bq-walk-view': 'photo' });
  const api = (await load()), store = api.create(storage), save = storage.setItem;
  storage.setItem = () => { throw Error('quota'); };
  store.set(api.keys.walkerName, '小明');
  save('bq-walk-view', 'list');
  assert.equal(store.get(api.keys.walkView), 'list');
  storage.setItem = save;
  assert.equal(store.set(api.keys.walkerName, '小美'), true);
  storage.setItem('bq-walker-name', '另一頁');
  assert.equal(store.get(api.keys.walkerName), '另一頁');
});

test('所有現有手機資料沿用鍵名與格式，沒有改名或清除舊資料', async () => {
  const fixtures = [
    ['walkerCodes', 'bq-walker-codes', '["abcdef123456"]'],
    ['walkedToday', 'bq-walked-today', '{"date":"2026-10-23","ids":["2024100502"]}'],
    ['favs', 'bq-favs', '["2024100502"]'],
    ['favsSync', 'bq-favs-sync', '{"v":1,"aliases":{"2024100502":"dog-1"},"books":{"abcdef123456":["dog-1"]},"pending":[]}'],
    ['walkerName', 'bq-walker-name', '小明'],
    ['sheetWrites', 'bq-sheet-writes', '{"date":"2026-10-23","items":{}}'],
    ['companions', 'bq-companions', '["小明","小美"]'],
    ['walkWith', 'bq-walk-with', '{"date":"2026-10-23","map":{}}'],
    ['walkRequests', 'bq-walk-requests', '{"request-1":{"id":"2024100502"}}'],
    ['walkFav', 'bq-walk-fav', 'false'],
    ['walkView', 'bq-walk-view', 'list'],
    ['onboarded', 'bq-onboarded', '1'],
    ['nameLater', 'bq-name-later', '1'],
    ['zukan', 'bq-zukan', '{"v":1,"codes":{"abcdef123456":{"2024100502":"2026-10-23"}}}'],
    ['editsCache', 'bq-edits-cache', '{"edits":[],"names":{}}'],
  ];
  const storage = fakeStorage(Object.fromEntries(fixtures.map(([, key, value]) => [key, value])));
  const api = (await load()), store = api.create(storage);
  for (const [name, key, value] of fixtures) {
    assert.equal(api.keys[name], key);
    assert.equal(store.get(api.keys[name]), value);
    store.set(api.keys[name], value);
    assert.equal(storage.getItem(key), value);
  }
});
