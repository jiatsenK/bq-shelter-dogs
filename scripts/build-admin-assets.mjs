import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// 內容一樣就不動；不一樣先寫暫存檔再改名蓋過去。admin-table、admin-stage4 測試平行建置時，
// 另一邊才不會讀到寫到一半的檔案（CI 偶發 dates.js 沒有 BQDates）。Windows 對方正在讀時改名會被擋，稍等再試
async function copyWhole(from, to) {
  const data = await readFile(from);
  try { if (data.equals(await readFile(to))) return; } catch (e) { /* 還沒有這個檔 */ }
  const tmp = new URL(`${to.pathname.split('/').pop()}.${process.pid}.tmp`, to);
  await writeFile(tmp, data);
  for (let tries = 0; ; tries++) {
    try { await rename(tmp, to); return; } catch (e) {
      if (tries >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { await rm(tmp, { force: true }); throw e; }
      await new Promise(r => setTimeout(r, 25));
    }
  }
}

// Only pure modules are copied. The volunteer app's entry points never enter admin assets.
export async function buildAdminAssets() {
  const target = new URL('../admin/public/shared/', import.meta.url);
  await mkdir(target, { recursive: true });
  for (const name of ['api-response.js', 'dates.js', 'photo-images.js', 'edit-values.js']) {
    await copyWhole(new URL(`../public/js/${name}`, import.meta.url), new URL(name, target));
  }
  // #567 網站更新唯讀：沿用志工網站的版本紀錄檔，不另存 D1
  await copyWhole(new URL('../public/website-updates.json', import.meta.url), new URL('website-updates.json', target));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildAdminAssets();
