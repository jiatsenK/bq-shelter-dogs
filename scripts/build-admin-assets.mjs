import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// node --test 平行跑時，多個測試行程會同時建置同一個資料夾：
// 內容相同就不重寫；要寫時先寫暫存檔再 rename，別的行程只會讀到舊檔或完整新檔。
async function publish(source, dest) {
  const content = await readFile(source);
  const current = await readFile(dest).catch(() => null);
  if (current && current.equals(content)) return;
  const temp = new URL(`${dest.href}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, content);
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(temp, dest);
      return;
    } catch (error) {
      // Windows 上目的檔正被別的行程開著時 rename 會暫時失敗
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 20) {
        await rm(temp, { force: true });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
}

// Only pure modules are copied. The volunteer app's entry points never enter admin assets.
export async function buildAdminAssets() {
  const target = new URL('../admin/public/shared/', import.meta.url);
  await mkdir(target, { recursive: true });
  for (const name of ['api-response.js', 'dates.js', 'photo-images.js', 'edit-values.js']) {
    await publish(new URL(`../public/js/${name}`, import.meta.url), new URL(name, target));
  }
  // #567 網站更新唯讀：沿用志工網站的版本紀錄檔，不另存 D1
  await publish(new URL('../public/website-updates.json', import.meta.url), new URL('website-updates.json', target));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildAdminAssets();
