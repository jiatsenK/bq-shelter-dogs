// #460：最新狀態資料包冷讀只讀一列；十倍狗數仍在既有分段上限（packs.js 每段 1 MB）內，不需拼接分段。
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, day } from './walk-fixture.mjs';
import { readAcceptedWalks } from '../src/walk-accept.js';

const CHUNK_BYTES = 1_000_000;

test('2,000 隻狗、每隻五個名字的資料包仍是一段，版本與內容同一列', async () => {
  const { DB } = await setup();
  const walker = ['志工甲甲', '志工乙乙', '志工丙丙', '志工丁丁', '志工戊戊'].join('、');
  const at = new Date().toISOString();
  for (let i = 0; i < 2000; i += 100) {
    await DB.batch(Array.from({ length: 100 }, (_, j) => DB.prepare('INSERT INTO v3_dogs(dog_id,name) VALUES(?,?)').bind(`d${i + j}`, `狗${i + j}`)));
    await DB.batch(Array.from({ length: 100 }, (_, j) => DB.prepare('INSERT INTO v3_walk_state(dog_key,dog_id,number,name,version,effective_date,walker,members_json,base_date,base_walker,previous_date,previous_walker,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(`${20260000 + i + j}`, `d${i + j}`, `${20260000 + i + j}`, `狗${i + j}`, 1, day(), walker, '[]', '', '', '', '', at)));
  }
  const pack = await DB.prepare('SELECT version,payload FROM v3_walk_pack WHERE id=1').first();
  assert.ok(new TextEncoder().encode(pack.payload).length < CHUNK_BYTES, '超過分段上限就要改用既有分段');
  const out = await readAcceptedWalks(DB, day());
  assert.equal(out.version, pack.version);
  assert.equal(out.walks.length, 2000);
  assert.ok(out.walks.every(w => w.walked && w.syncStatus === 'pending'));
});
