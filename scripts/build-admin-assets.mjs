import { mkdir, copyFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Only pure modules are copied. The volunteer app's entry points never enter admin assets.
export async function buildAdminAssets() {
  const target = new URL('../admin/public/shared/', import.meta.url);
  await mkdir(target, { recursive: true });
  for (const name of ['api-response.js', 'dates.js']) {
    await copyFile(new URL(`../public/js/${name}`, import.meta.url), new URL(name, target));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildAdminAssets();
