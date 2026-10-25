// #214／#553：正式部署不准改結構或忽略綁定錯誤（d1-migrations.mjs check 只送 SELECT，可以有）；
// 預覽只准「d1 migrations apply bq-shelter-dogs-test --remote --config wrangler.preview-db.jsonc」這一種寫入。回傳問題或 ''
function deployWriteProblem(deploy, preview) {
  const forbidden = /migrations apply|d1 execute|continue-on-error|if:\s*always\(/;
  if (forbidden.test(deploy)) return '部署不能改結構或忽略綁定錯誤';
  const allowed = /d1 migrations apply bq-shelter-dogs-test --remote --config wrangler\.preview-db\.jsonc[ \t]*\r?$/gm;
  if (forbidden.test(preview.replace(allowed, ''))) return '預覽只能對測試庫套 migration，不能改其他結構或忽略綁定錯誤';
  return '';
}

// 測試網站部署：只准部署 wrangler.test-site.jsonc、只准對測試庫套 migration，不帶金鑰（金鑰另外設在測試 Worker 上）。回傳問題或 ''
function testSiteDeployProblem(wf) {
  const allowedApply = /d1 migrations apply bq-shelter-dogs-test --remote --config wrangler\.preview-db\.jsonc[ \t]*\r?$/gm;
  const allowedDeploy = /wrangler@4 deploy --config wrangler\.test-site\.jsonc /g;
  if (!wf.match(allowedDeploy)) return '要用 wrangler.test-site.jsonc 部署';
  const rest = wf.replace(allowedApply, '').replace(allowedDeploy, '');
  if (/migrations apply|d1 execute|continue-on-error|if:\s*always\(/.test(rest)) return '只能對測試庫套 migration，不能改其他結構或忽略錯誤';
  if (/wrangler@4 (deploy|versions)/.test(rest)) return '不能部署或上傳其他設定';
  if (/--secrets-file|secret put|secrets\.(?!CLOUDFLARE_API_TOKEN\b|CLOUDFLARE_ACCOUNT_ID\b)/.test(rest)) return '不能帶金鑰';
  return '';
}

// #130 照片放 R2：Worker 讀 R2（照片、dogs.json 先經過 Worker）、部署前確認 bucket、縮圖與搬遷 Action
async function runR2Tests() {
  const get = p => fetch(p).then(r => r.ok ? r.text() : '');
  // wrangler.jsonc 不在網站資料夾，只有本機和 CI 讀得到，讀不到就跳過
  const cfg = await get('../wrangler.jsonc');
  await check('#130 wrangler.jsonc：R2 binding PHOTOS，照片、dogs.json 先經過 Worker（相簿 K 2026-10-09 拿掉）', () => {
    if (!cfg) return;
    if (!/"r2_buckets": \[\{ "binding": "PHOTOS", "bucket_name": "bq-shelter-photos" \}\]/.test(cfg)) throw new Error('少了 R2 binding');
    ['"/photos/*"', '"/api/*"'].forEach(p => {
      if (!cfg.includes(p)) throw new Error(`run_worker_first 少了 ${p}`);
    });
    if (cfg.includes('gallery')) throw new Error('相簿已拿掉，wrangler.jsonc 不該再有 gallery');
  });
  const deploy = await get('../.github/workflows/deploy-cloudflare.yml');
  const preview = await get('../.github/workflows/preview-cloudflare.yml');
  await check('#214 部署：R2 只查證，正式 D1 與隔離測試 D1 分開，失敗不繼續部署', () => {
    if (!/node scripts\/r2-bucket\.mjs\r?\n/.test(deploy) || /r2-bucket\.mjs --create/.test(deploy)) throw new Error('正式 R2 只能查證');
    if (!deploy.includes('node scripts/d1-database.mjs --config "${{ steps.r2.outputs.config }}"')) throw new Error('準備資料庫要接著 R2 那一步的設定');
    if (!deploy.includes('wrangler@4 deploy --config "${{ steps.d1.outputs.config }}"')) throw new Error('正式部署要用確認後的設定');
    if (!/node scripts\/r2-bucket\.mjs\r?\n/.test(preview) || /r2-bucket\.mjs --create/.test(preview)) throw new Error('預覽只確認、不建 bucket');
    if (!preview.includes('node scripts/d1-database.mjs --config "${{ steps.r2.outputs.config }}" --preview')) throw new Error('預覽要查證測試 D1');
    if (!/versions upload\s*\\\s*\r?\n\s*--config "\$\{\{ steps\.d1\.outputs\.config \}\}"/.test(preview)) throw new Error('預覽上傳要用測試 D1 的設定');
    const problem = deployWriteProblem(deploy, preview);
    if (problem) throw new Error(problem);
  });
  await check('#595 部署不帶 Worker 用不到的密鑰（MY_NAME、SHEET_ID、NOTES_PASSCODE）', () => {
    const left = ['MY_NAME', 'SHEET_ID', 'NOTES_PASSCODE'].filter(name => new RegExp(`secrets\\.${name}\\b|process\\.env\\.${name}\\b`).test(deploy));
    if (left.length) throw new Error(`還在帶 ${left.join('、')}`);
  });
  // #553：預覽只准一種 migrations apply（測試庫＋測試庫設定）；正式部署照舊完全不准
  await check('#553 擋關檢查的反例：預覽對正式庫、不帶測試庫設定、正式部署套用都會被擋', () => {
    const ok = 'npx --yes wrangler@4 d1 migrations apply bq-shelter-dogs-test --remote --config wrangler.preview-db.jsonc\n';
    if (deployWriteProblem('', ok)) throw new Error('預覽對測試庫套用應該放行');
    const bad = [
      ['', 'npx --yes wrangler@4 d1 migrations apply bq-shelter-dogs --remote --config wrangler.preview-db.jsonc\n'],
      ['', 'npx --yes wrangler@4 d1 migrations apply bq-shelter-dogs-test --remote\n'],
      ['', 'npx --yes wrangler@4 d1 migrations apply bq-shelter-dogs-test --remote --config wrangler.jsonc\n'],
      ['', ok + 'npx --yes wrangler@4 d1 execute bq-shelter-dogs-test --remote --command "DROP TABLE x"\n'],
      ['', ok + 'continue-on-error: true\n'],
      ['npx --yes wrangler@4 d1 migrations apply bq-shelter-dogs-test --remote --config wrangler.preview-db.jsonc\n', ''],
    ];
    bad.forEach(([d, p], i) => { if (!deployWriteProblem(d, p)) throw new Error(`反例 ${i + 1} 沒被擋`); });
  });
  const testSite = await get('../.github/workflows/deploy-test-site.yml');
  await check('測試網站部署 Action：main 推送與手動指定分支、只部署測試網站設定、只對測試庫套 migration、不帶金鑰', () => {
    if (!testSite) throw new Error('讀不到 deploy-test-site.yml');
    if (!/workflow_dispatch:/.test(testSite) || !/push:\r?\n    branches: \[main\]/.test(testSite)) throw new Error('要有 main 推送與手動觸發');
    const problem = testSiteDeployProblem(testSite);
    if (problem) throw new Error(problem);
  });
  await check('測試網站部署擋關檢查的反例：部署正式設定、對正式庫套用、帶金鑰都會被擋', () => {
    const apply = 'npx --yes wrangler@4 d1 migrations apply bq-shelter-dogs-test --remote --config wrangler.preview-db.jsonc\n';
    const deploy = 'npx --yes wrangler@4 deploy --config wrangler.test-site.jsonc --message "x"\n';
    if (testSiteDeployProblem(apply + deploy)) throw new Error('測試網站部署應該放行');
    const bad = [
      apply,
      apply + deploy.replace('wrangler.test-site.jsonc', 'wrangler.jsonc'),
      apply + deploy + 'npx --yes wrangler@4 deploy --config wrangler.jsonc\n',
      deploy + 'npx --yes wrangler@4 d1 migrations apply bq-shelter-dogs --remote --config wrangler.preview-db.jsonc\n',
      apply + deploy + 'npx --yes wrangler@4 d1 execute bq-shelter-dogs-test --remote --command "DROP TABLE x"\n',
      apply + deploy + 'WALKER_KEY: ${{ secrets.WALKER_KEY }}\n',
      apply + deploy.replace('--message', '--secrets-file s.json --message'),
    ];
    bad.forEach((wf, i) => { if (!testSiteDeployProblem(wf)) throw new Error(`反例 ${i + 1} 沒被擋`); });
  });
  const thumbs = await get('../.github/workflows/r2-thumbs.yml');
  await check('#130 縮圖（R2）Action：只能手動或由 Worker 叫、用管理金鑰、不提交 repo', () => {
    if (!thumbs) throw new Error('讀不到 r2-thumbs.yml');
    if (!/on:\r?\n  workflow_dispatch:\r?\n\r?\n/.test(thumbs)) throw new Error('只能用 workflow_dispatch 觸發');
    if (!/ADMIN_KEY: \$\{\{ secrets\.ADMIN_KEY \}\}/.test(thumbs)) throw new Error('金鑰要用 Secret ADMIN_KEY');
    if (/NOTES_PASSCODE/.test(thumbs)) throw new Error('#595 不再沿用 NOTES_PASSCODE');
    if (!/contents: read/.test(thumbs) || /git push|git commit/.test(thumbs)) throw new Error('不能提交 repo');
    if (!/make-thumbs\.py --site/.test(thumbs)) throw new Error('縮圖要用 make-thumbs.py --site');
  });
  await check('#130 換照片的提示：照片放 R2 後馬上生效，不再說要等幾分鐘', () => {
    if (/其他志工幾分鐘內會看到/.test(APP_JS + PHOTO_JS + WELCOME_JS)) throw new Error('提示還寫幾分鐘');
    if ((PHOTO_JS.match(/其他志工重新整理就會看到/g) || []).length !== 1) throw new Error('主照片的提示要改');
  });
}

// #126 PR 預覽網址：預覽版帶 PREVIEW、不碰正式網站；正式部署不保留網頁上加的變數，PREVIEW 不會被帶進正式版
async function runPreviewTests() {
  const get = p => fetch(p).then(r => r.ok ? r.text() : '');
  const preview = await get('../.github/workflows/preview-cloudflare.yml');
  await check('#126 預覽 Action：只上傳版本（不部署正式版）、帶 PREVIEW、別人 fork 的 PR 不跑、在 PR 更新同一則留言', () => {
    if (!preview) throw new Error('讀不到 preview-cloudflare.yml');
    if (!/wrangler@4 versions upload/.test(preview)) throw new Error('要用 versions upload');
    if (/wrangler@4 deploy/.test(preview)) throw new Error('預覽不能用 deploy，會換掉正式網站');
    if (!/--var PREVIEW:1/.test(preview)) throw new Error('預覽版要帶 PREVIEW');
    if (!/--preview-alias "pr-\$\{PR\}"/.test(preview)) throw new Error('網址要固定成 pr-編號');
    if (!/head\.repo\.full_name == github\.repository/.test(preview)) throw new Error('fork 的 PR 不能跑');
    if (!/updateComment/.test(preview)) throw new Error('再推送要更新同一則留言');
  });
  // wrangler.jsonc 不在網站資料夾，只有本機和 CI 讀得到，讀不到就跳過
  const cfg = await get('../wrangler.jsonc');
  await check('#126 wrangler.jsonc：開預覽網址、正式部署不保留網頁上加的變數', () => {
    if (!cfg) return;
    if (!/"preview_urls": true/.test(cfg)) throw new Error('要開 preview_urls');
    if (!/"keep_vars": false/.test(cfg)) throw new Error('keep_vars 要是 false，免得 PREVIEW 被帶進正式版');
  });
}

// #125 網站搬到 Cloudflare：同一個網址的 /api 是 Worker；舊網址和本機照舊用原本的照片上傳 Worker
async function runCloudflareTests() {
  await check('#125 照片上傳服務網址：一律用同網址 /api，舊的單獨 Worker 拿掉了', () => {
    eq(BQApi.baseFor({ hostname: 'bq-shelter-dogs.jiatsen-k.workers.dev', origin: 'https://bq-shelter-dogs.jiatsen-k.workers.dev' }),
      'https://bq-shelter-dogs.jiatsen-k.workers.dev/api', '新網址：');
    eq(BQApi.baseFor({ hostname: 'pr-12-bq-shelter-dogs.jiatsen-k.workers.dev', origin: 'https://pr-12-bq-shelter-dogs.jiatsen-k.workers.dev' }),
      'https://pr-12-bq-shelter-dogs.jiatsen-k.workers.dev/api', '預覽網址：');
    eq(BQApi.baseFor({ hostname: 'localhost', origin: 'http://localhost:8787' }), 'http://localhost:8787/api', '本機（wrangler dev）：');
    eq([BQApi.baseFor(undefined), BQApi.baseFor({ origin: 'null' })], ['', ''], '沒有網址（同步腳本測試、直接開檔案）不上傳：');
    if (/bq-shelter-photos\.jiatsen-k|OLD_UPLOAD_URL/.test(APP_JS + API_JS)) throw new Error('js/app.js、js/api.js 不該再有舊的照片上傳服務網址');
  });
  await check('#276 部署設定：只公開 public/，Worker 程式、腳本、部署設定、交接紀錄都不在網站資料夾', async () => {
    const cfg = await fetch('../wrangler.jsonc').then(r => r.ok ? r.text() : '');
    if (!cfg) return; // 只有本機和 CI 讀得到
    if (!/"directory": "\.\/public"/.test(cfg)) throw new Error('assets.directory 要是 ./public');
    for (const p of ['../public/wrangler.jsonc', '../public/AGENT_LOG.md', '../public/worker/src/index.js', '../public/scripts/memory-d1.mjs']) {
      if ((await fetch(p)).ok) throw new Error(`${p} 不該在網站資料夾`);
    }
  });
}
async function runOldUrlTests() {
  const testHtml = await fetch('index.html').then(r => r.text());
  // 把頁面裡的轉址程式拿出來，用假的 location 跑
  const redirectOf = (html, loc) => {
    const code = (html.match(/<script>(if \(location\.hostname === 'jiatsenk\.github\.io'\)[^<]*)<\/script>/) || [])[1];
    if (!code) throw new Error('找不到舊網址轉址程式');
    let to = null;
    new Function('location', code)({ search: '', hash: '', ...loc, replace: u => { to = u; } });
    return to;
  };
  const NEW = 'https://bq-shelter-dogs.jiatsen-k.workers.dev';
  await check('#129 舊網址（首頁、# 分類、/tests/）換到新網址同一頁', () => {
    for (const [name, html] of [['index.html', INDEX_HTML], ['tests/index.html', testHtml]]) {
      eq(redirectOf(html, { hostname: 'jiatsenk.github.io', pathname: '/bq-shelter-dogs/' }), `${NEW}/`, `${name} 首頁：`);
      eq(redirectOf(html, { hostname: 'jiatsenk.github.io', pathname: '/bq-shelter-dogs/', hash: '#find' }), `${NEW}/#find`, `${name} 分類：`);
      eq(redirectOf(html, { hostname: 'jiatsenk.github.io', pathname: '/bq-shelter-dogs/index.html', search: '?a=1' }), `${NEW}/index.html?a=1`, `${name} 帶參數：`);
      eq(redirectOf(html, { hostname: 'jiatsenk.github.io', pathname: '/bq-shelter-dogs/tests/' }), `${NEW}/tests/`, `${name} 測試頁：`);
      eq(redirectOf(html, { hostname: 'jiatsenk.github.io', pathname: '/bq-shelter-dogs' }), NEW, `${name} 沒有結尾斜線：`);
    }
  });
  await check('#129 新網址、預覽版、本機不轉址（沒有轉址迴圈）', () => {
    for (const hostname of ['bq-shelter-dogs.jiatsen-k.workers.dev', 'pr-12-bq-shelter-dogs.jiatsen-k.workers.dev', 'localhost']) {
      eq(redirectOf(INDEX_HTML, { hostname, pathname: '/' }), null, `${hostname}：`);
    }
  });
  await check('#129 轉址放在 index.html 最前面（比提早抓 dogs.json 早）', () => {
    const at = INDEX_HTML.indexOf("location.hostname === 'jiatsenk.github.io'");
    if (at < 0 || at > INDEX_HTML.indexOf('window.__dogsEarly')) throw new Error('轉址要在其他程式前面');
  });
}
