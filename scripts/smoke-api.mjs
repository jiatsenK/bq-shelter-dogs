// 部署後檢查（K 2026-10-16 回顧）：正式站每支讀取 API 都要回 ok:true。
// CI 只測 repo 裡的程式；正式 D1 缺表、密碼沒設這類「正式環境跟 repo 不一樣」的問題，只有打正式站才看得到（例：v3_edit_log 沒建，#293）。
// 用法：node scripts/smoke-api.mjs <網址>，任何一支失敗就結束碼 1
// 網址一定要給：repo 公開後（#493）正式網址不寫在程式裡，CI 用 GitHub Secret WORKERS_SUBDOMAIN 組出來
import { pathToFileURL } from 'node:url';

export const READ_PATHS = ['dogs', 'walks', 'departures', 'edits', 'rest'];

// 剛部署完可能還沒換新版，每支最多試 tries 次
export async function smokeApi(base, { fetchFn = fetch, tries = 3, waitMs = 5000 } = {}) {
  const failures = [];
  for (const path of READ_PATHS) {
    let last = '';
    for (let i = 0; i < tries; i++) {
      if (i) await new Promise(r => setTimeout(r, waitMs));
      try {
        const res = await fetchFn(`${base}/api/${path}`, { headers: { Origin: base } });
        const body = await res.json().catch(() => null);
        if (res.ok && body?.ok === true) { last = ''; break; }
        last = `${res.status} ${body?.error || '回應不是 JSON'}${body?.code ? `（${body.code}）` : ''}`;
      } catch (e) { last = e.message; }
    }
    if (last) failures.push(`/api/${path}：${last}`);
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 子網域沒設時 CI 會組出「bq-shelter-dogs..workers.dev」，一併擋下
  let base = '';
  try { const url = new URL(process.argv[2]); if (url.protocol === 'https:' && !url.hostname.includes('..')) base = url.origin; } catch {}
  if (!base) { console.error('要給網址：node scripts/smoke-api.mjs https://…'); process.exit(1); }
  const failures = await smokeApi(base);
  if (failures.length) { console.error(`正式站 API 有問題：\n${failures.join('\n')}`); process.exit(1); }
  console.log(`正式站 ${READ_PATHS.length} 支讀取 API 都正常`);
}
