import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAdminAssets } from './build-admin-assets.mjs';
await buildAdminAssets();
const { parseManageDogs, selectDogs, maintenance } = await import('../admin/public/js/dog-table.js');
const dog = (i, extra = {}) => ({ dogId: `dog${i}`, number: String(i), name: `狗${i}`, cage: `A${i}`, intro: '', note: '', sex: 'male', onMain: true, fixedCare: false, sexMismatch: false, rest: null, photoUrl: null, ...extra });
test('管理表格：搜尋全欄位、複合篩選、自然排序及有界分頁', () => {
  const dogs = Array.from({ length: 65 }, (_, i) => dog(i + 1));
  dogs.push(dog(66, { name: '阿福', number: '', cage: 'B1', note: '表格備註', intro: '喜歡散步', sex: '', onMain: false, fixedCare: true, rest: { until: '2099-01-01', reason: '' } }));
  assert.equal(selectDogs(dogs).rows.length, 25);
  assert.equal(selectDogs(dogs, { pageSize: 500 }).rows.length, 25);
  assert.equal(selectDogs(dogs, { page: 999 }).page, 3);
  assert.equal(selectDogs(dogs, { sort: 'number' }).rows[1].number, '2');
  assert.equal(selectDogs(dogs, { sort: 'number', direction: 'desc' }).rows[0].number, '65');
  assert.equal(selectDogs(dogs, { page: 3 }).rows.at(-1).number, '');
  for (const query of ['阿福', '表格備註', '喜歡散步', 'dog66', 'b1']) assert.equal(selectDogs(dogs, { query }).total, 1);
  assert.equal(selectDogs(dogs, { query: '不存在' }).total, 0);
  assert.equal(selectDogs(dogs, { presence: 'other', sex: 'unknown', care: 'rest' }).total, 1);
  assert.equal(selectDogs(dogs, { care: 'fixed' }).total, 1);
  assert.equal(selectDogs(dogs, { care: 'missing' }).total, 66);
  assert.deepEqual(maintenance(dogs.at(-1), '2099-01-01'), ['缺編號', '缺照片', '性別待確認', '休養中', '固定照顧']);
  assert.equal(maintenance(dogs.at(-1), '2100-01-01').includes('休養中'), false);
});
test('管理表格：格式錯誤及重複永久 ID 不當成空清單成功', () => {
  assert.deepEqual(parseManageDogs({ dogs: [] }), []);
  for (const data of [{}, { dogs: [dog(1), dog(1)] }, { dogs: [dog(1, { dogId: '' })] }, { dogs: [dog(1, { photoUrl: 'https://other.example/photo' })] }, { dogs: [dog(1, { rest: { until: '2026-02-30', reason: '' } })] }]) assert.throws(() => parseManageDogs(data));
});
test('管理資產：純模組來自同一份來源，部署設定沒有資產／替代網址繞過', async () => {
  for (const name of ['api-response.js', 'dates.js']) assert.equal(await readFile(new URL(`../admin/public/shared/${name}`, import.meta.url), 'utf8'), await readFile(new URL(`../public/js/${name}`, import.meta.url), 'utf8'));
  const config = JSON.parse((await readFile(new URL('../wrangler.admin.jsonc', import.meta.url), 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.triggers, undefined);
  assert.equal(config.assets.directory, './admin/public');
  assert.deepEqual(Object.keys(config.vars).sort(), ['ACCESS_AUD', 'ACCESS_TEAM_DOMAIN', 'ADMIN_ORIGIN']);
});
