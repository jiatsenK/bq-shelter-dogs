// #795 狗狗變裝秀的臉部位置檔（scripts/dog-faces.py 產生）：前端只靠這個格式出題
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const faces = JSON.parse(await readFile(new URL('../public/data/dog-faces.json', import.meta.url), 'utf8'));
const POINTS = ['le', 're', 'nose', 'lip', 'chin', 'top'];

test('臉部位置檔：鍵是編號，每筆有照片版本和六個 0～1 的點，左眼在右眼左邊', () => {
  const ids = Object.keys(faces);
  assert(ids.length > 0, '至少一隻狗');
  for (const id of ids) {
    const f = faces[id];
    assert.match(id, /^\d{10}$/, `鍵是編號：${id}`);
    assert.equal(typeof f.photoVersion, 'string', `${id} 有 photoVersion`);
    assert.match(f.photoVersion, /^[0-9a-f]{1,32}$/, `${id} 的 photoVersion 跟 /api/dogs 同格式`);
    assert.deepEqual(Object.keys(f).sort(), ['photoVersion', ...POINTS].sort(), `${id} 的欄位`);
    for (const key of POINTS) {
      const p = f[key];
      assert(Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number' && v >= 0 && v <= 1), `${id}.${key} 是 0～1 的兩個數字：${JSON.stringify(p)}`);
    }
    assert(f.le[0] < f.re[0], `${id} 的左眼在右眼左邊`);
  }
});
