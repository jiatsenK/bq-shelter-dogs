import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkCompactLegacy, writeCompactLegacySql } from './check-compact-legacy.mjs';

test('本機演練匯入兩次、逐筆比對與外鍵檢核；實際沒有開卡也能確認', async () => {
  const report = await checkCompactLegacy({
    dogs: { dogs: [{ id: 'new', name: '圓仔', formerIds: ['old'] }] },
    legacy: { cardOpened: [], walkerNames: [{ name: '測試志工', last_seen: '2026-10-01T00:00:00Z' }], kv: [{ key: '不搬', value: '不碰' }] },
  });
  assert.deepEqual(report, {
    source: { cardOpened: 0, walkerNames: 1 }, imported: { cardOpened: 0, walkerNames: 1 },
    counts: { v3_card_opened: 0, v3_volunteers: 1 }, replayIdentical: true, foreignKeyErrors: 0,
    equal: true, differences: [],
  });
});

test('SQL 只產出到私密目錄且不覆寫既有檔，未知編號令演練失敗', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bq-249-test-'));
  t.after(async () => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())));
    await rm(dir, { recursive: true });
  });
  const legacy = { cardOpened: [], walkerNames: [{ name: '測試志工', last_seen: '2026-10-01T00:00:00Z' }] };
  await assert.rejects(writeCompactLegacySql(join(dir, 'public.sql'), legacy), /私密|migration-private/);
  const output = join(dir, '.migration-private', 'review.sql');
  assert.equal(await writeCompactLegacySql(output, legacy), output);
  const before = await readFile(output, 'utf8');
  assert.match(before, /INSERT INTO v3_volunteers/);
  await assert.rejects(writeCompactLegacySql(output, legacy), /EEXIST/);
  assert.equal(await readFile(output, 'utf8'), before);
  await assert.rejects(checkCompactLegacy({ dogs: { dogs: [{ id: 'new', name: '圓仔' }] }, legacy: { cardOpened: [{ walker_code: 'aaaaaaaaaaaa', dog_id: 'missing', opened_on: '2026-10-01' }], walkerNames: [] } }), /找不到編號/);
});
