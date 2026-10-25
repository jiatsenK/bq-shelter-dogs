import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdminAssets } from './build-admin-assets.mjs';
await buildAdminAssets();
const { parseActivities, filterActivities, activityPayload, sameActivity, describeActivity, matchDog } = await import('../admin/public/js/activity-model.js');
const { completeness, parseSheetGaps, gapStatus } = await import('../admin/public/js/data-checks.js');
const { editQuery, parseEditPage, formatWhen, sourceLabel, valueText } = await import('../admin/public/js/edit-log.js');

const A = 'a'.repeat(32), B = 'b'.repeat(32);
const activity = { id: 'c'.repeat(32), date: '2026-09-06', kind: 'kids', revision: 3, dogs: [{ dogId: null, number: '', name: '舊名單小白' }, { dogId: A, number: '2026010101', name: '阿福' }] };

test('#567 活動：格式驗證、搜尋、保留未對應名字、無差異不送', () => {
  assert.equal(parseActivities({ activities: [activity] }).length, 1);
  for (const bad of [{}, { activities: [{ ...activity, kind: 'party' }] }, { activities: [{ ...activity, revision: '3' }] }, { activities: [{ ...activity, dogs: [{ dogId: 1, name: 'x' }] }] }]) {
    assert.throws(() => parseActivities(bad));
  }
  const list = [activity, { ...activity, id: 'd'.repeat(32), date: '2026-10-04', kind: 'adoption', dogs: [] }];
  assert.equal(filterActivities(list, { kind: 'adoption' }).length, 1);
  assert.equal(filterActivities(list, { query: '小白' }).length, 1);
  assert.equal(filterActivities(list, { query: '2026010101' }).length, 1);
  assert.equal(filterActivities(list, { query: '2026-10' }).length, 1);
  const draft = { date: activity.date, kind: activity.kind, dogs: activity.dogs };
  assert.ok(sameActivity(activity, draft));
  assert.ok(!sameActivity(activity, { ...draft, dogs: activity.dogs.slice(1) }));
  assert.deepEqual(activityPayload(draft, activity.revision), { revision: 3, date: '2026-09-06', kind: 'kids', dogs: [{ name: '舊名單小白' }, { dogId: A }] });
  assert.deepEqual(activityPayload(draft), { date: '2026-09-06', kind: 'kids', dogs: [{ name: '舊名單小白' }, { dogId: A }] });
  assert.equal(describeActivity(draft), '2026-09-06 動保小小兵：舊名單小白（未對應）、阿福');
  assert.equal(describeActivity({ date: '2026-10-04', kind: 'adoption', dogs: [] }), '2026-10-04 認養會：（沒有狗）');
});

test('#567 活動加狗：只接受明確對上的狗，不猜同名', () => {
  const dogs = [{ dogId: A, number: '2026010101', name: '阿福' }, { dogId: B, number: '', name: '小黑' }, { dogId: 'e'.repeat(32), number: '2026020202', name: '小黑' }];
  assert.equal(matchDog(dogs, '2026010101 阿福')?.dogId, A);
  assert.equal(matchDog(dogs, '2026010101')?.dogId, A);
  assert.equal(matchDog(dogs, '阿福')?.dogId, A);
  assert.equal(matchDog(dogs, '小黑'), null, '同名兩隻不猜');
  assert.equal(matchDog(dogs, '小黑（無編號）')?.dogId, B);
  assert.equal(matchDog(dogs, '不存在'), null);
});

test('#567 資料檢查：主清單上的狗，缺漏規則同志工資料完整度；#518 狀態分缺漏／讀取失敗／過期', () => {
  const base = { dogId: A, number: '2026010101', name: '阿福', cage: 'A1', note: '', intro: '介紹', sex: 'male', onMain: true, fixedCare: false, rest: null, photoUrl: '/photos/2026010101.jpg', walkedDate: '2026-10-01' };
  const dogs = [base, { ...base, dogId: B, number: '', intro: ' ', sex: '', photoUrl: null, walkedDate: '' }, { ...base, dogId: 'e'.repeat(32), number: '12345', onMain: true }, { ...base, dogId: 'f'.repeat(32), number: '', onMain: false }];
  const result = completeness(dogs);
  assert.equal(result.total, 3, '未列主清單的狗不算進完整度');
  const count = label => result.items.find(i => i.label === label).dogs.length;
  assert.equal(count('沒有編號'), 1);
  assert.equal(count('編號看不出入所日期'), 1);
  assert.equal(count('沒有溜狗日期'), 1);
  assert.equal(count('沒有性別'), 1);
  assert.equal(count('沒有入所介紹'), 1);
  assert.equal(count('沒有照片紀錄'), 1);

  const ok = parseSheetGaps({ sheetGaps: { state: 'ok', recordedAt: '2026-10-25T01:43:00.000Z', checkedAt: '2026-10-25T05:53:00.000Z', stale: false, total: 1, items: [{ sheet: 'main', key: 'main:1', number: '1', name: '阿福', dogId: A, cage: 'A1' }] } });
  assert.match(gapStatus(ok), /10\/25 13:53/);
  assert.match(gapStatus({ ...ok, stale: true }), /過期/);
  assert.match(gapStatus({ ...ok, checkedAt: null, stale: true }), /掃描時間還沒記錄/);
  assert.match(gapStatus(parseSheetGaps({ sheetGaps: { state: 'never', items: [], total: 0 } })), /還沒有掃描紀錄/);
  assert.match(gapStatus(parseSheetGaps({ sheetGaps: { state: 'error', items: [], total: 0 } })), /讀不懂/);
  assert.throws(() => parseSheetGaps({ sheetGaps: { state: 'ok', items: [{ sheet: 'main' }] } }));
});

test('#567 更新紀錄：查詢字串白名單、時間用台灣時間、來源標示', () => {
  assert.equal(editQuery({ q: ' 阿福 ', kind: '', dog: '', actor: '', source: 'access', from: '2026-10-01', to: '', order: 'newest', page: 2, size: 50, extra: 'x' }), 'q=%E9%98%BF%E7%A6%8F&source=access&from=2026-10-01&page=2&size=50');
  assert.equal(editQuery({ order: 'oldest', page: 1, size: 25 }), 'order=oldest');
  const page = parseEditPage({ total: 1, page: 1, pages: 1, pageSize: 25, kinds: [{ value: 'intro', label: '入所介紹' }], edits: [{ id: 1, at: '2026-01-01T15:59:00.000Z', kind: 'intro', kindLabel: '入所介紹', source: 'access', editorName: '管理者', dogId: A, dogNumber: '2026010101', dogName: '阿福', before: '', after: '新介紹', actorEmail: 'manager@example.org' }] });
  assert.equal(page.edits.length, 1);
  assert.throws(() => parseEditPage({ total: '1', edits: [] }));
  assert.equal(formatWhen('2026-01-01T15:59:00.000Z'), '2026/01/01 23:59');
  assert.equal(sourceLabel('access'), '管理網站');
  assert.equal(sourceLabel('volunteer'), '志工網站');
  assert.equal(sourceLabel('legacy'), '舊紀錄');
  assert.equal(valueText('sex', 'female'), '母');
  assert.equal(valueText('intro', ''), '（沒有）');
});
