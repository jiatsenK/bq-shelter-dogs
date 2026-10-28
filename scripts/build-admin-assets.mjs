import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DIAGRAMS, extractDiagram, gitHistory, diagramsCss } from './admin-diagrams.mjs';

// node --test 平行跑時，多個測試行程會同時建置同一個資料夾：
// 內容相同就不重寫；要寫時先寫暫存檔再 rename，別的行程只會讀到舊檔或完整新檔。
async function publish(source, dest) {
  await publishContent(await readFile(source), dest);
}
async function publishContent(data, dest) {
  const content = Buffer.from(data);
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
  // 系統架構圖頁：正本在 docs/diagrams/，抽出圖、說明與版本資訊
  const root = fileURLToPath(new URL('..', import.meta.url));
  const diagrams = [];
  for (const name of DIAGRAMS) {
    const file = `docs/diagrams/${name}.html`;
    diagrams.push({ ...extractDiagram(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), name), ...gitHistory(file, root) });
  }
  await publishContent(diagramsCss(diagrams), new URL('diagrams.css', target));
  await publishContent(JSON.stringify(diagrams.map(({ css, ...d }) => d)), new URL('diagrams.json', target));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildAdminAssets();
