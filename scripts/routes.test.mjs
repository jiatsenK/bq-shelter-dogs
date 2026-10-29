// 志工網站網址（public/js/routes.js，ADR 0024）：網址和畫面狀態互換、一般點擊判斷、電腦版連結與手機按鈕
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendModule } from './frontend-module-test-helper.mjs';

const plain = v => JSON.parse(JSON.stringify(v ?? null));
const routes = await loadFrontendModule('routes.js', {});

test('分頁、資訊子頁、狗的網址', () => {
  assert.equal(routes.pageHash('walk'), '#walk');
  assert.equal(routes.pageHash('info', 'stay'), '#info/stay');
  assert.equal(routes.pageHash('mine', 'stay'), '#mine', '只有資訊有子頁');
  assert.equal(routes.dogHash({ id: '2020/01 甲' }), '#dog/2020%2F01%20%E7%94%B2');
  assert.equal(routes.dogHash({ id: '', name: '沒編號' }), '', '沒有編號的狗不給網址');
});

test('看得懂的網址換回畫面，看不懂回 null', () => {
  assert.deepEqual(plain(routes.parseHash('#groups')), { tab: 'groups', infoPage: '', dogId: '' });
  assert.deepEqual(plain(routes.parseHash('#info/stay')), { tab: 'info', infoPage: 'stay', dogId: '' });
  assert.deepEqual(plain(routes.parseHash('#info/沒有這頁')), { tab: 'info', infoPage: '沒有這頁', dogId: '' }, '子頁對不對由呼叫的人判斷');
  assert.deepEqual(plain(routes.parseHash('#dog/2020%2F01%20%E7%94%B2')), { tab: 'walk', infoPage: '', dogId: '2020/01 甲' });
  for (const bad of ['', '#', '#dog/', '#dog/%E0%A4%A', '#admin', '#Walk', 'walk']) assert.equal(routes.parseHash(bad), null, bad);
});

test('一般左鍵點擊才留在原頁；加了按鍵或不是左鍵交給瀏覽器', () => {
  const click = (extra = {}) => ({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra });
  assert.equal(routes.plainClick(click()), true);
  for (const k of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) assert.equal(routes.plainClick(click({ [k]: true })), false, k);
  assert.equal(routes.plainClick(click({ button: 1 })), false, '中鍵');
});

test('電腦版是連結、手機是按鈕；沒有網址時也是按鈕', () => {
  assert.equal(routes.routeControl(true, '#dog/1', 'data-desk-open="0"', '豆花'), '<a href="#dog/1" data-desk-open="0">豆花</a>');
  assert.equal(routes.routeControl(false, '#dog/1', 'data-desk-open="0"', '豆花'), '<button type="button" data-desk-open="0">豆花</button>');
  assert.equal(routes.routeControl(true, '', 'data-desk-open="0"', '豆花'), '<button type="button" data-desk-open="0">豆花</button>');
});
