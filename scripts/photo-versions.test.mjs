// 照片版本號（#127）的測試：node --test scripts/photo-versions.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { photoVersions, writePhotoVersions } from './photo-versions.mjs';

async function fakeRepo() {
  const root = await mkdtemp(join(tmpdir(), 'pv-'));
  await mkdir(join(root, 'photos', 'thumbs', 'gallery', '2024032902'), { recursive: true });
  await mkdir(join(root, 'photos', 'gallery', '2024032902'), { recursive: true });
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'photos', '2024032902.jpg'), 'a');
  await writeFile(join(root, 'photos', 'thumbs', '2024032902.jpg'), 'b');
  await writeFile(join(root, 'photos', 'gallery', '2024032902', '20260101-000000-abcd.jpg'), 'c');
  await writeFile(join(root, 'photos', 'thumbs', 'gallery', '2024032902', '20260101-000000-abcd.jpg'), 'd');
  await writeFile(join(root, 'photos', 'README.md'), '不是照片');
  await writeFile(join(root, 'data', 'dogs.json'), JSON.stringify({ version: 1, dogs: [{ id: '2024032902', name: '測試狗' }] }));
  return root;
}

test('#127 照片版本：photos/ 底下每張 .jpg 都有 8 碼雜湊，路徑用 /，不是照片的不算', async () => {
  const root = await fakeRepo();
  const v = await photoVersions(root);
  assert.deepEqual(Object.keys(v).sort(), [
    'photos/2024032902.jpg',
    'photos/gallery/2024032902/20260101-000000-abcd.jpg',
    'photos/thumbs/2024032902.jpg',
    'photos/thumbs/gallery/2024032902/20260101-000000-abcd.jpg',
  ]);
  // sha256('a') 前 8 碼
  assert.equal(v['photos/2024032902.jpg'], 'ca978112');
  Object.values(v).forEach(h => assert.match(h, /^[0-9a-f]{8}$/));
});

test('#127 照片換了內容，版本跟著變；沒變的不變', async () => {
  const root = await fakeRepo();
  const before = await photoVersions(root);
  await writeFile(join(root, 'photos', '2024032902.jpg'), 'a2');
  const after = await photoVersions(root);
  assert.notEqual(after['photos/2024032902.jpg'], before['photos/2024032902.jpg']);
  assert.equal(after['photos/thumbs/2024032902.jpg'], before['photos/thumbs/2024032902.jpg']);
});

test('#127 寫進 dogs.json 的 photoVersions，原本的資料不動；沒有 photos/ 也不會壞', async () => {
  const root = await fakeRepo();
  const n = await writePhotoVersions(root);
  assert.equal(n, 4);
  const data = JSON.parse(await readFile(join(root, 'data', 'dogs.json'), 'utf8'));
  assert.deepEqual(data.dogs, [{ id: '2024032902', name: '測試狗' }]);
  assert.equal(data.version, 1);
  assert.equal(data.photoVersions['photos/2024032902.jpg'], 'ca978112');

  const empty = await mkdtemp(join(tmpdir(), 'pv-'));
  assert.deepEqual(await photoVersions(empty), {});
});
