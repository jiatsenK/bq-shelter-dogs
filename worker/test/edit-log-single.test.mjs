// #709：修改紀錄只由 editlog.js editLogWrites 寫；來源必填、只收白名單。
// 執行：node --test worker/test/edit-log-single.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { editLogWrites, logEdit, EDIT_SOURCES } from '../src/editlog.js';
import { setup } from './walk-fixture.mjs';

const SRC = new URL('../src/', import.meta.url);
const files = (await readdir(SRC, { recursive: true })).filter(f => f.endsWith('.js')).map(f => f.replaceAll('\\', '/'));

// 整份檔案一起比（SQL 拆行也抓得到），註解先拿掉（保留換行，行號才對）；INSERT OR …、REPLACE、加 schema 前綴都算
const strip = code => code.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/^[ \t]*\/\/.*$/gm, '');
const lineOf = (code, index) => code.slice(0, index).split('\n').length;
const EDIT_LOG_INSERT = /\b(?:INSERT(?:\s+OR\s+\w+)?|REPLACE)\s+INTO\s+["'`[]?(?:\w+\.)?v3_edit_log\b/gi;
// 表名用變數組的 INSERT 看不出寫哪張表：已知的列在這裡，多了一處就要確認不是寫修改紀錄
const DYNAMIC_INSERT_OK = {
  'dog-merge.js': '合併狗搬資料表的列（copyRows），表清單不含 v3_edit_log',
  'identity.js': '身分合併只搬常溜、開卡兩張表',
};
const DYNAMIC_INSERT = /\bINTO\s+\$\{/g;

test('worker/src 只有 editlog.js 一處 INSERT INTO v3_edit_log', async () => {
  const found = [], dynamic = [];
  for (const file of files) {
    const code = strip(await readFile(new URL(file, SRC), 'utf8'));
    for (const m of code.matchAll(EDIT_LOG_INSERT)) found.push(`${file}:${lineOf(code, m.index)}`);
    for (const m of code.matchAll(DYNAMIC_INSERT)) dynamic.push(`${file}:${lineOf(code, m.index)}`);
  }
  assert.equal(found.length, 1, `修改紀錄要交給 editlog.js editLogWrites 寫，不要另寫 INSERT：${found.join('、')}`);
  assert.match(found[0], /^editlog\.js:/);
  assert.deepEqual(dynamic.map(d => d.split(':')[0]).sort(), Object.keys(DYNAMIC_INSERT_OK).sort(),
    `表名用變數組的 INSERT 有變動：${dynamic.join('、')}；確認不是寫 v3_edit_log 後更新 DYNAMIC_INSERT_OK`);
});

test('來源沒傳或不在白名單就丟錯', async () => {
  const env = await setup();
  try {
    const entry = { at: '2026-10-28T00:00:00.000Z', name: '甲', kind: 'note', before: null, after: '備註' };
    for (const source of [undefined, '', 'legacy', 'system']) {
      assert.throws(() => editLogWrites(env.DB, { ...entry, source }), /修改紀錄來源不對/);
      await assert.rejects(logEdit(env.DB, { editor: { name: '甲', code: '' }, kind: 'note', after: '備註', source }), /修改紀錄來源不對/);
      // 沒有編輯者（本來就不寫）也要抓到漏傳
      await assert.rejects(logEdit(env.DB, { editor: null, kind: 'note', after: '備註', source }), /修改紀錄來源不對/);
    }
    assert.deepEqual(EDIT_SOURCES, ['access', 'volunteer', 'sheet']);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM v3_edit_log').first()).n, 0);
  } finally { env.DB.close(); }
});

test('帶 actor 時來源記在 v3_dog_edit_actors，v3_edit_log.source 照舊留 NULL', async () => {
  const env = await setup();
  try {
    await env.DB.batch(editLogWrites(env.DB, { at: '2026-10-28T00:00:00.000Z', name: '管理者', kind: 'activity', before: null, after: { a: 1 },
      source: 'access', actor: { requestId: 'r1', subject: 's', email: 'e@example.com' } }));
    await logEdit(env.DB, { editor: { name: '乙', code: 'c2' }, kind: 'note', dogNumber: '9001', after: '備註', source: 'volunteer' }, Date.parse('2026-10-28T01:00:00Z'));
    const rows = (await env.DB.prepare('SELECT l.at,l.editor_code,l.editor_name,l.kind,l.dog_id,l.dog_number,l.before_json,l.after_json,l.source,a.source actor_source FROM v3_edit_log l LEFT JOIN v3_dog_edit_actors a ON a.log_id=l.id ORDER BY l.id').all()).results;
    assert.deepEqual(rows.map(r => ({ ...r })), [
      { at: '2026-10-28T00:00:00.000Z', editor_code: '', editor_name: '管理者', kind: 'activity', dog_id: null, dog_number: '', before_json: 'null', after_json: '{"a":1}', source: null, actor_source: 'access' },
      { at: '2026-10-28T01:00:00.000Z', editor_code: 'c2', editor_name: '乙', kind: 'note', dog_id: null, dog_number: '9001', before_json: 'null', after_json: '"備註"', source: 'volunteer', actor_source: null },
    ]);
  } finally { env.DB.close(); }
});
