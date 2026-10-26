import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAdminAssets } from './build-admin-assets.mjs';
await buildAdminAssets();
const { parseManageDogs, selectDogs, orderDogs, maintenance } = await import('../admin/public/js/dog-table.js');
const { trashLabel } = await import('../admin/public/js/dog-editor.js');
const { FIELDS, PREVIEW_FIELDS, introDiff, restBounds, restProblem, fieldSummary, displayValue, patchDog } = await import('../admin/public/js/dog-edit-model.js');
test('垃圾桶每筆顯示台灣時間的換掉時間，和哪一次每月清理會刪掉', () => {
  assert.equal(trashLabel('2026-10-26T03:00:00.000Z', 30), '2026-10-26 11:00 換掉，2026-12-01 清理時刪除');
  assert.equal(trashLabel('2026-10-01T16:00:00.000Z', 30), '2026-10-02 00:00 換掉，2026-11-01 清理時刪除');
  assert.equal(trashLabel('2026-10-02T02:00:00.000Z', 30), '2026-10-02 10:00 換掉，2026-12-01 清理時刪除');
  assert.equal(trashLabel('', 30), '刪除時間不明');
});
const dog = (i, extra = {}) => ({ dogId: `dog${i}`, number: String(i), name: `狗${i}`, cage: `A${i}`, intro: '', note: '', sex: 'male', onMain: true, fixedCare: false, rest: null, photoUrl: null, ...extra });
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
  // #624 各缺項分開篩；試算表來源的兩項不算進「有待補資料」
  assert.equal(selectDogs(dogs, { care: 'missingNumber' }).total, 1);
  assert.equal(selectDogs(dogs, { care: 'missingIntro' }).total, 65);
  assert.equal(selectDogs(dogs, { care: 'unknownSex' }).total, 1);
  assert.equal(selectDogs(dogs, { care: 'badNumberDate' }).total, 65);
  assert.equal(selectDogs(dogs, { care: 'missingWalk' }).total, 66);
  assert.equal(selectDogs(dogs, { care: 'nonsense' }).total, 66, '不認得的條件不篩');
  assert.equal(orderDogs(dogs, { sort: 'number' }).length, 66, '存並開下一隻用不分頁的完整順序');
  assert.equal(orderDogs(dogs, { sort: 'number' })[25].number, '26');
  assert.deepEqual(maintenance(dogs.at(-1), '2099-01-01'), ['缺編號', '缺照片', '性別待確認', '休養中', '固定照顧']);
  assert.equal(maintenance(dogs.at(-1), '2100-01-01').includes('休養中'), false);
});
test('管理表格：格式錯誤及重複永久 ID 不當成空清單成功', () => {
  assert.deepEqual(parseManageDogs({ dogs: [] }), []);
  for (const data of [{}, { dogs: [dog(1), dog(1)] }, { dogs: [dog(1, { dogId: '' })] }, { dogs: [dog(1, { photoUrl: 'https://other.example/photo' })] }, { dogs: [dog(1, { rest: { until: '2026-02-30', reason: '' } })] }]) assert.throws(() => parseManageDogs(data));
});
test('管理資產：純模組來自同一份來源，部署設定跟線上一致、沒有資產／預覽網址繞過', async () => {
  for (const name of ['api-response.js', 'dates.js']) assert.equal(await readFile(new URL(`../admin/public/shared/${name}`, import.meta.url), 'utf8'), await readFile(new URL(`../public/js/${name}`, import.meta.url), 'utf8'));
  const config = JSON.parse((await readFile(new URL('../wrangler.admin.jsonc', import.meta.url), 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(config.assets.run_worker_first, true);
  // 管理網站就是 workers.dev 網址（Access 擋整個 host）；ADMIN_ORIGIN 要指向它，替代 host 一律被程式拒絕
  assert.equal(config.workers_dev, true);
  assert.equal(config.vars.ADMIN_ORIGIN, `https://${config.name}.jiatsen-k.workers.dev`);
  assert.match(config.vars.ACCESS_TEAM_DOMAIN, /^[a-z0-9-]+\.cloudflareaccess\.com$/);
  assert.match(config.vars.ACCESS_AUD, /^[a-f0-9]{64}$/);
  assert.equal(config.keep_vars, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.triggers, undefined);
  assert.equal(config.assets.directory, './admin/public');
  assert.deepEqual(Object.keys(config.vars).sort(), ['ACCESS_AUD', 'ACCESS_TEAM_DOMAIN', 'ADMIN_ORIGIN']);
});

test('#624 抽屜規則：欄位順序、只有編號／出入所／照片要預覽、介紹只標差異', () => {
  assert.deepEqual(FIELDS.map(([f]) => f), ['intro', 'rest', 'fixedCare', 'sex', 'numbers', 'stays', 'photo']);
  assert.deepEqual([...PREVIEW_FIELDS].sort(), ['numbers', 'photo', 'stays']);
  assert.deepEqual(introDiff('親人，喜歡散步', '親人，很喜歡散步'), { lead: '親人，', removed: '', added: '很', tail: '喜歡散步' });
  assert.deepEqual(introDiff('abc', 'axc'), { lead: 'a', removed: 'b', added: 'x', tail: 'c' });
  const long = '一'.repeat(40);
  const diff = introDiff(long + '舊' + long, long + '新' + long);
  assert.equal(diff.lead, '…' + '一'.repeat(16));
  assert.equal(diff.tail, '一'.repeat(16) + '…');
  assert.deepEqual(introDiff('', '新介紹'), { lead: '', removed: '', added: '新介紹', tail: '' });
  assert.deepEqual(restBounds('2026-10-26'), { min: '2026-10-26', max: '2027-04-24' });
  assert.equal(restProblem(null, '2026-10-26'), '');
  assert.match(restProblem({ until: '', reason: '' }, '2026-10-26'), /請填休養/);
  assert.match(restProblem({ until: '2026-10-25', reason: '' }, '2026-10-26'), /之間/);
  assert.match(restProblem({ until: '2027-04-25', reason: '' }, '2026-10-26'), /之間/);
  assert.equal(restProblem({ until: '2027-04-24', reason: '術後' }, '2026-10-26'), '');
  const snap = { intro: ' ', sex: '', fixedCare: false, rest: null, numbers: [], stays: [], photo: null };
  for (const field of ['intro', 'sex', 'numbers', 'photo']) assert.equal(fieldSummary(field, snap).missing, true, field + ' 待補');
  assert.equal(fieldSummary('photo', snap, '/photos/1.jpg').missing, false, '舊固定路徑有照片');
  assert.equal(displayValue('rest', { until: '2026-11-01', reason: '術後' }), '休養至 2026-11-01（術後）');
  const row = dog(1, { photoUrl: '/photos/1.jpg' });
  assert.deepEqual(patchDog(row, { intro: '新', sex: 'female', fixedCare: true, rest: null, photo: { key: 'photos/x.jpg', thumb: 'photos/thumbs/x.jpg' } }),
    { ...row, intro: '新', sex: 'female', fixedCare: true, photoUrl: '/photos/thumbs/x.jpg' });
  assert.equal(patchDog(row, { ...snap, intro: '' }).photoUrl, '/photos/1.jpg', '沒有 D1 照片引用時保留原本的照片');
});
test('#624 六頁側欄一致：資料／志工網站兩組、目前頁標 aria-current、沒有 sidebar-note', async () => {
  const pages = { 'index.html': './', 'activities.html': './activities.html', 'checks.html': './checks.html', 'settings.html': './settings.html', 'updates.html': './updates.html', 'releases.html': './releases.html' };
  let first;
  for (const [file, href] of Object.entries(pages)) {
    const html = (await readFile(new URL(`../admin/public/${file}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
    const aside = html.match(/<aside class="admin-sidebar"[\s\S]*?<\/aside>/)[0];
    assert.ok(!html.includes('sidebar-note'), file);
    assert.ok(aside.includes(`<a class="nav-item active" href="${href}" aria-current="page">`), file + ' 標出目前頁');
    assert.equal((aside.match(/aria-current/g) || []).length, 1, file);
    const plain = aside.replace(' active', '').replace(' aria-current="page"', '');
    first ??= plain;
    assert.equal(plain, first, file + ' 側欄跟其他頁一樣');
    assert.ok(!/id="(?:reload|refresh|reload-settings)"[^>]*btn-primary|btn-primary[^>]*id="(?:reload|refresh|reload-settings)"/.test(html), file + ' 重新讀取是次要按鈕');
  }
  assert.match(first, /資料[\s\S]*狗資料[\s\S]*活動紀錄[\s\S]*待補清單[\s\S]*志工網站[\s\S]*志工網站設定[\s\S]*修改紀錄[\s\S]*網站更新/);
});
