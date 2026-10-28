import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DOC, DOC_URL, parseDoc, diagramSections, renderMermaid, renderKey, cspSafe, gitHistory, diagramsCss } from './admin-diagrams.mjs';

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
  await buildDiagrams(target);
}

// 系統架構圖頁：正本是 docs/ARCHITECTURE.md。Mermaid 建置時畫成 SVG（scripts/admin-diagrams.mjs）；
// 原始碼沒變就沿用上次畫好的（node 測試、網頁測試會各建置一次）。沒有無頭瀏覽器時不擋建置，頁面改顯示「到 GitHub 看圖」。
async function buildDiagrams(target) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const markdown = await readFile(new URL(`../${DOC}`, import.meta.url), 'utf8');
  const { checked, commit } = parseDoc(markdown);
  const previous = await readFile(new URL('diagrams.json', target), 'utf8').then(JSON.parse).catch(() => null);
  const cached = new Map((previous?.sections || []).filter(s => s.svg && s.css && s.key).map(s => [s.key, s]));
  const sections = diagramSections(markdown).map(s => ({ name: s.name, title: s.title, notes: s.notes, hasDiagram: !!s.mermaid, key: s.mermaid ? renderKey(`${s.name}\n${s.mermaid}`) : null, source: s.mermaid }));
  const todo = sections.filter(s => s.hasDiagram && !cached.has(s.key));
  let drawn = new Map();
  try { drawn = await renderMermaid(todo.map(s => ({ name: s.name, source: s.source }))); }
  catch (error) {
    const note = `架構圖沒有畫成 SVG（${error.message.split('\n')[0]}），管理網站改顯示 GitHub 連結`;
    console.warn(process.env.GITHUB_ACTIONS ? `::warning::${note}` : note);
  }
  const out = sections.map(({ source, ...s }) => {
    if (!s.hasDiagram) return { ...s, svg: null, css: null };
    const hit = cached.get(s.key);
    if (hit) return { ...s, svg: hit.svg, css: hit.css };
    return drawn.has(s.name) ? { ...s, ...cspSafe(drawn.get(s.name), s.name) } : { ...s, svg: null, css: null };
  });
  const doc = { ...gitHistory(DOC, root), checked, commit, url: DOC_URL };
  await publishContent(diagramsCss(out), new URL('diagrams.css', target));
  await publishContent(JSON.stringify({ doc, sections: out }), new URL('diagrams.json', target));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildAdminAssets();
