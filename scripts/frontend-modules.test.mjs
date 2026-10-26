import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const JS_DIR = new URL('../public/js/', import.meta.url);

test('Node 可直接匯入前端日期工具，且不建立全域名稱', async () => {
  const { BQDates } = await import('../public/js/dates.js');
  assert.equal(BQDates.parseYmd('2026-10-24').getDate(), 24);
  assert.equal(globalThis.BQDates, undefined);
});

// 主頁有循環引用，整個模組圖要瀏覽器才跑得起來；這裡只靠原始碼比對名稱，拆檔搬函式時漏改的匯入在 Node 就擋下（#623）
async function frontendFiles() {
  const names = (await readdir(JS_DIR)).filter(n => n.endsWith('.js')).sort();
  return Object.fromEntries(await Promise.all(names.map(async n => [n, (await readFile(new URL(n, JS_DIR), 'utf8')).replace(/\r\n/g, '\n')])));
}

function exportedNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/^export (?:async )?(?:function\*?|const|let|class) ([\w$]+)/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^export \{([^}]*)\}/gm)) {
    for (const part of m[1].split(',').map(s => s.trim()).filter(Boolean)) names.add(part.split(/\s+as\s+/).pop());
  }
  return names;
}

test('前端模組的具名匯入，對方都有匯出', async () => {
  const files = await frontendFiles();
  const missing = [];
  for (const [file, source] of Object.entries(files)) {
    for (const m of source.matchAll(/^import \{([^}]*)\} from '\.\/([\w-]+\.js)';/gm)) {
      const target = files[m[2]];
      if (!target) { missing.push(`${file} → ${m[2]}（沒有這支檔）`); continue; }
      const exported = exportedNames(target);
      for (const name of m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        if (!exported.has(name)) missing.push(`${file} 從 ${m[2]} 匯入 ${name}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('public/js 每支檔都列在 public/js/README.md（ADR 0017）', async () => {
  const files = Object.keys(await frontendFiles());
  const readme = await readFile(new URL('README.md', JS_DIR), 'utf8');
  const listed = new Set([...readme.matchAll(/`([\w-]+\.js)`/g)].map(m => m[1]));
  assert.deepEqual(files.filter(f => !listed.has(f)), []);
});

test('詳細資訊拆出 app.js 後，app.js 不再自己畫詳細資訊或處理各編輯器（#623 R4）', async () => {
  const files = await frontendFiles();
  for (const name of ['detailHtml', 'wireDetail', 'renderDetail', 'showDetail', 'hideDetail', 'saveIntro', 'saveStays', 'saveRest', 'saveFormer', 'toggleFixedCare', 'sendAppend']) {
    assert.doesNotMatch(files['app.js'], new RegExp(`^(?:async )?function ${name}\\(`, 'm'), `${name} 應該在詳細資訊的模組裡`);
  }
  // showDetail 與 hideDetail 共用同一段收掉編輯，不再各寫一份
  assert.equal((files['detail.js'].match(/if \(!appState\[field\] \|\| appState\[field\]\.phase !== 'saving'\)/g) || []).length, 1);
  assert.doesNotMatch(files['detail.js'], /appState\.(rest|intro|former|stays)Edit = null/);
});
