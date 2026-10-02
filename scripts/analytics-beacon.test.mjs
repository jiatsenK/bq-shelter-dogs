import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertBeacon, isBeaconToken, writeBeacon } from './analytics-beacon.mjs';

const TOKEN = '0123456789abcdef0123456789abcdef';
const HTML = '<html><body>\n<script src="js/app.js"></script>\n</body>\n</html>\n';

test('#128 beacon 插在 </body> 前、帶 token，只插一次', () => {
  const out = insertBeacon(HTML, TOKEN);
  assert.match(out, /static\.cloudflareinsights\.com\/beacon\.min\.js/);
  assert.ok(out.includes(`data-cf-beacon='{"token": "${TOKEN}"}'`));
  assert.ok(out.indexOf('beacon.min.js') > out.indexOf('js/app.js'));
  assert.ok(out.indexOf('beacon.min.js') < out.indexOf('</body>'));
  assert.equal(insertBeacon(out, TOKEN), out);
});

test('#128 沒有 token 或格式不對就不插', () => {
  assert.equal(insertBeacon(HTML, ''), HTML);
  assert.equal(insertBeacon(HTML, undefined), HTML);
  assert.equal(insertBeacon(HTML, 'abc"><script>'), HTML);
  assert.equal(isBeaconToken(TOKEN), true);
  assert.equal(isBeaconToken(TOKEN + '0'), false);
});

test('#128 writeBeacon 改寫 index.html', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beacon-'));
  await writeFile(join(root, 'index.html'), HTML);
  assert.equal(await writeBeacon(root, TOKEN), true);
  assert.match(await readFile(join(root, 'index.html'), 'utf8'), /data-cf-beacon/);
  assert.equal(await writeBeacon(root, TOKEN), false);
});

test('#128 repo 裡的 index.html 本身沒有 beacon（只在部署時插）', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('data-cf-beacon'));
  assert.ok(html.includes('</body>'));
});
