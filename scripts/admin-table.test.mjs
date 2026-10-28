import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAdminAssets } from './build-admin-assets.mjs';
await buildAdminAssets();
const { parseManageDogs, selectDogs, orderDogs, maintenance, statusCounts, departureLabel } = await import('../admin/public/js/dog-table.js');
const { trashLabel } = await import('../admin/public/js/dog-editor.js');
const { FIELDS, PREVIEW_FIELDS, introDiff, restBounds, restProblem, fieldSummary, displayValue, patchDog, stayRow } = await import('../admin/public/js/dog-edit-model.js');
test('垃圾桶每筆顯示台灣時間的換掉時間，和哪一次每月清理會刪掉', () => {
  assert.equal(trashLabel('2026-10-26T03:00:00.000Z', 30), '2026-10-26 11:00 換掉，2026-12-01 清理時刪除');
  assert.equal(trashLabel('2026-10-01T16:00:00.000Z', 30), '2026-10-02 00:00 換掉，2026-11-01 清理時刪除');
  assert.equal(trashLabel('2026-10-02T02:00:00.000Z', 30), '2026-10-02 10:00 換掉，2026-12-01 清理時刪除');
  assert.equal(trashLabel('', 30), '刪除時間不明');
});
const dog = (i, extra = {}) => ({ dogId: `dog${i}`, number: String(i), name: `狗${i}`, cage: `A${i}`, intro: '', note: '', sex: 'male', onMain: true, status: 'main', formerNumber: '', departure: null, fixedCare: false, rest: null, photoUrl: null, ...extra });
test('管理表格：搜尋全欄位、複合篩選、自然排序及有界分頁', () => {
  const dogs = Array.from({ length: 65 }, (_, i) => dog(i + 1));
  dogs.push(dog(66, { name: '阿福', number: '', cage: 'B1', note: '表格備註', intro: '喜歡散步', sex: '', onMain: false, status: 'unknown', fixedCare: true, rest: { until: '2099-01-01', reason: '' } }));
  assert.equal(selectDogs(dogs).rows.length, 25);
  assert.equal(selectDogs(dogs, { pageSize: 500 }).rows.length, 25);
  assert.equal(selectDogs(dogs, { page: 999 }).page, 3);
  assert.equal(selectDogs(dogs, { sort: 'number' }).rows[1].number, '2');
  assert.equal(selectDogs(dogs, { sort: 'number', direction: 'desc' }).rows[0].number, '65');
  assert.equal(selectDogs(dogs, { page: 3 }).rows.at(-1).number, '');
  for (const query of ['阿福', '表格備註', '喜歡散步', 'dog66', 'b1']) assert.equal(selectDogs(dogs, { query }).total, 1);
  assert.equal(selectDogs(dogs, { query: '不存在' }).total, 0);
  assert.equal(selectDogs(dogs, { status: 'unknown', sex: 'unknown', care: 'rest' }).total, 1);
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
  for (const data of [{}, { dogs: [dog(1), dog(1)] }, { dogs: [dog(1, { dogId: '' })] }, { dogs: [dog(1, { photoUrl: 'https://other.example/photo' })] }, { dogs: [dog(1, { rest: { until: '2026-02-30', reason: '' } })] }, { dogs: [dog(1, { status: 'other' })] }, { dogs: [dog(1, { departure: { date: 1 } })] }]) assert.throws(() => parseManageDogs(data));
});
test('管理資產：純模組來自同一份來源，部署設定跟線上一致、沒有資產／預覽網址繞過', async () => {
  for (const name of ['api-response.js', 'dates.js']) assert.equal(await readFile(new URL(`../admin/public/shared/${name}`, import.meta.url), 'utf8'), await readFile(new URL(`../public/js/${name}`, import.meta.url), 'utf8'));
  const config = JSON.parse((await readFile(new URL('../wrangler.admin.jsonc', import.meta.url), 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(config.assets.run_worker_first, true);
  // 管理網站就是 workers.dev 網址（Access 擋整個 host）；ADMIN_ORIGIN 要指向它，替代 host 一律被程式拒絕
  // #493：ADMIN_ORIGIN 含帳號子網域，不寫在公開設定，部署時由 deploy-admin.yml 用 Secret 組出來
  assert.equal(config.workers_dev, true);
  assert.equal(config.vars.ADMIN_ORIGIN, undefined);
  const deploy = await readFile(new URL('../.github/workflows/deploy-admin.yml', import.meta.url), 'utf8');
  assert.ok(deploy.includes(`ADMIN_ORIGIN: https://${config.name}.\${{ secrets.WORKERS_SUBDOMAIN }}.workers.dev`));
  assert.ok(deploy.includes('--var "ADMIN_ORIGIN:${ADMIN_ORIGIN}"'));
  assert.match(config.vars.ACCESS_TEAM_DOMAIN, /^[a-z0-9-]+\.cloudflareaccess\.com$/);
  assert.match(config.vars.ACCESS_AUD, /^[a-f0-9]{64}$/);
  assert.equal(config.keep_vars, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.triggers, undefined);
  assert.equal(config.assets.directory, './admin/public');
  assert.deepEqual(Object.keys(config.vars).sort(), ['ACCESS_AUD', 'ACCESS_TEAM_DOMAIN']);
});

test('#624／#639 抽屜規則：欄位順序（編號併進出入所紀錄）、只有出入所／照片要預覽、介紹只標差異', () => {
  assert.deepEqual(FIELDS.map(([f]) => f), ['intro', 'rest', 'fixedCare', 'sex', 'stays', 'photo']);
  assert.deepEqual([...PREVIEW_FIELDS].sort(), ['photo', 'stays']);
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
  for (const field of ['intro', 'sex', 'stays', 'photo']) assert.equal(fieldSummary(field, snap).missing, true, field + ' 待補');
  // 出入所表：一個編號都沒有才算缺編號；顯示帶編號
  const stays = [{ number: '', in: '2015-08-18', out: '2017-09-05', reason: '整修移所' }, { number: '2017090508', in: '2017-09-05', out: '', reason: '' }];
  assert.deepEqual(fieldSummary('stays', { stays }), { text: '2 筆（2017090508）', missing: false });
  assert.equal(fieldSummary('stays', { stays: stays.slice(0, 1) }).missing, true);
  assert.equal(displayValue('stays', stays), '沒有編號：入所 2015-08-18（整修移所）／離所 2017-09-05（原因未填）\n2017090508：入所 2017-09-05（原因未填）／還在所');
  // 有離所紀錄：離所原因照離所紀錄；沒有的手填（K 2026-10-26）
  assert.equal(displayValue('stays', [{ number: '2016010101', in: '2016-01-01', out: '2016-06-06', reason: '迷路', departed: true, departure: '認養' }]), '2016010101：入所 2016-01-01（迷路）／離所 2016-06-06（認養）');
  assert.equal(displayValue('stays', [{ number: '', in: '2015-08-18', out: '2017-09-05', reason: '迷路', outReason: '整修移所' }]), '沒有編號：入所 2015-08-18（迷路）／離所 2017-09-05（整修移所）');
  assert.deepEqual(stayRow({ number: '2017090508', in: '2017-09-05', departed: true, outReason: '亂填' }), { number: '2017090508', in: '2017-09-05', out: '', reason: '', outReason: '' });
  assert.deepEqual(stayRow({ number: '', in: '2015-08-18', out: '2017-09-05', outReason: '整修移所' }), { number: '', in: '2015-08-18', out: '2017-09-05', reason: '', outReason: '整修移所' });
  assert.equal(fieldSummary('photo', snap, '/photos/1.jpg').missing, false, '舊固定路徑有照片');
  assert.equal(displayValue('rest', { until: '2026-11-01', reason: '術後' }), '休養至 2026-11-01（術後）');
  const row = dog(1, { photoUrl: '/photos/1.jpg' });
  assert.deepEqual(patchDog(row, { intro: '新', sex: 'female', fixedCare: true, rest: null, photo: { key: 'photos/x.jpg', thumb: 'photos/thumbs/x.jpg' } }),
    { ...row, intro: '新', sex: 'female', fixedCare: true, photoUrl: '/photos/thumbs/x.jpg' });
  assert.equal(patchDog(row, { ...snap, intro: '' }).photoUrl, '/photos/1.jpg', '沒有 D1 照片引用時保留原本的照片');
});
test('#624 七頁側欄一致：資料／志工網站兩組、目前頁標 aria-current、沒有 sidebar-note', async () => {
  const pages = { 'index.html': './', 'activities.html': './activities.html', 'checks.html': './checks.html', 'settings.html': './settings.html', 'updates.html': './updates.html', 'releases.html': './releases.html', 'links.html': './links.html' };
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
  assert.match(first, /資料[\s\S]*狗資料[\s\S]*活動紀錄[\s\S]*待補清單[\s\S]*志工網站[\s\S]*志工網站設定[\s\S]*修改紀錄[\s\S]*網站更新[\s\S]*網站連結/);
});
test('狀態分頁：在所／已出所／待核對各自篩選，數量不受搜尋影響；不在所的狗用舊編號', () => {
  const dogs = [dog(1), dog(2), dog(3, { number: '', formerNumber: '2020010101', onMain: false, status: 'departed', departure: { date: '2026-10-01', reason: 'adopt' } }),
    dog(4, { number: '', onMain: false, status: 'unknown' })];
  assert.deepEqual(statusCounts(dogs), { main: 2, departed: 1, unknown: 1, all: 4 });
  assert.equal(selectDogs(dogs, { status: 'main' }).total, 2);
  assert.equal(selectDogs(dogs, { status: 'departed' }).rows[0].dogId, 'dog3');
  assert.equal(selectDogs(dogs, { status: 'unknown' }).rows[0].dogId, 'dog4');
  assert.equal(selectDogs(dogs).total, 4);
  assert.equal(selectDogs(dogs, { query: '2020010101' }).total, 1, '舊編號也搜得到');
  assert.deepEqual(selectDogs(dogs, { sort: 'number', direction: 'desc' }).rows.map(d => d.dogId), ['dog3', 'dog2', 'dog1', 'dog4'], '舊編號一起排序，沒編號的排最後');
  assert.equal(maintenance(dogs[2]).includes('缺編號'), false, '有舊編號不算缺編號');
  assert.equal(maintenance(dogs[3]).includes('缺編號'), true);
  assert.equal(departureLabel(dogs[2].departure), '2026-10-01 離所（認養）');
  assert.equal(departureLabel({ date: '', reason: 'death' }), '日期待確認 離所（離世）');
  assert.equal(departureLabel({ date: '2026-01-01', reason: 'unknown' }), '2026-01-01 離所（待確認）', '原因未定照名詞表寫待確認');
});
test('合併狗：誰留下、候選順序、預覽文字、可能重複配對、紀錄文字', async () => {
  const { mergeSides, mergeCandidates, mergePreviewText, possibleDuplicates, nameKey } = await import('../admin/public/js/dog-merge.js');
  const { editsValue } = await import('../admin/public/shared/edit-values.js');
  const main = dog(1, { name: '米香', number: '2026082501' }), extra = dog(2, { name: '（米香）', number: '', onMain: false, status: 'unknown' });
  const departed = dog(3, { name: 'JOJO', number: '', formerNumber: '2019042407', onMain: false, status: 'departed', departure: { date: '', reason: 'adopt' } });
  const other = dog(4, { name: '別隻' }), jojo = dog(5, { name: 'jojo', number: '2024022801' });
  assert.equal(nameKey('（米香 ）'), '米香');
  assert.equal(mergeSides(main, other), null, '兩隻都在主清單不能合併');
  assert.deepEqual(mergeSides(main, extra), { target: main, source: extra });
  assert.deepEqual(mergeSides(extra, main), { target: main, source: extra }, '主清單上的永遠留下');
  assert.deepEqual(mergeSides(extra, departed), { target: departed, source: extra }, '都不在主清單：併到選的那隻');
  const all = [main, extra, departed, other, jojo];
  assert.deepEqual(mergeCandidates(main, all).map(c => c.text), ['同名：（米香） 無編號（待核對）', 'JOJO 2019042407（已出所）']);
  const order = mergeCandidates(departed, all).map(c => c.dogId);
  assert.equal(order[0], 'dog5', '同名（不分大小寫）最前');
  assert.equal(order.at(-1), 'dog2', '在所的排在不在所的前面');
  assert.equal(mergePreviewText({ target: { name: '米香', number: '2026082501' }, source: { name: '米香', number: '' }, moved: { 溜狗紀錄: 3 }, kept: {}, lost: {} }),
    '留下：米香 2026082501\n併掉：米香 無編號（合併後從狗資料刪掉，修改紀錄可取消合併）\n搬到留下那隻：溜狗紀錄 3 筆');
  assert.deepEqual(possibleDuplicates(all).map(p => `${p.main.dogId}+${p.extra.dogId}`).sort(), ['dog1+dog2', 'dog5+dog3']);
  assert.equal(editsValue('merge', { name: '米香', numbers: [], counts: { 溜狗紀錄: 3 }, snapshot: {} }), '米香（無編號）：溜狗紀錄 3 筆');
  assert.equal(editsValue('merge', { sourceId: 'x', name: '米香', number: '2026082501', moved: { 溜狗紀錄: 2 }, kept: { 溜狗紀錄: 1 } }), '併到 米香（2026082501）；搬過去：溜狗紀錄 2 筆；兩邊都有、留原本的：溜狗紀錄 1 筆');
  assert.equal(editsValue('unmerge', { name: '米香', number: '2026082501', mergeLogId: 12 }), '米香（2026082501），取消第 12 筆合併');
});
