// #214／#553：正式部署不准改結構或忽略綁定錯誤（d1-migrations.mjs check 只送 SELECT，可以有）；
// 預覽只准「d1 migrations apply bq-shelter-dogs-test --remote --config wrangler.preview-db.jsonc」這一種寫入。回傳問題或 ''
function deployWriteProblem(deploy, preview) {
  const forbidden = /migrations apply|d1 execute|continue-on-error|if:\s*always\(/;
  if (forbidden.test(deploy)) return '部署不能改結構或忽略綁定錯誤';
  const allowed = /d1 migrations apply bq-shelter-dogs-test --remote --config wrangler\.preview-db\.jsonc[ \t]*\r?$/gm;
  if (forbidden.test(preview.replace(allowed, ''))) return '預覽只能對測試庫套 migration，不能改其他結構或忽略綁定錯誤';
  return '';
}

// 管理網站部署：只能手動、只准部署 wrangler.admin.jsonc 且帶 --message，不套 migration、不帶金鑰。回傳問題或 ''
function adminDeployProblem(wf) {
  if (!/^on:\r?\n  workflow_dispatch:/m.test(wf) || /^\s+(push|pull_request|schedule|workflow_call|workflow_run):/m.test(wf)) return '只能手動觸發';
  const allowedDeploy = /wrangler@4 deploy --config wrangler\.admin\.jsonc --message /g;
  if (!wf.match(allowedDeploy)) return '要用 wrangler.admin.jsonc 部署並帶 --message';
  const rest = wf.replace(allowedDeploy, '');
  if (/migrations apply|d1 execute|continue-on-error|if:\s*always\(/.test(rest)) return '不能改結構或忽略錯誤';
  if (/wrangler@4 (deploy|versions)/.test(rest)) return '不能部署或上傳其他設定';
  if (/--secrets-file|secret put|secrets\.(?!CLOUDFLARE_API_TOKEN\b|CLOUDFLARE_ACCOUNT_ID\b|WORKERS_SUBDOMAIN\b)/.test(rest)) return '不能帶金鑰';
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
  if (/--secrets-file|secret put|secrets\.(?!CLOUDFLARE_API_TOKEN\b|CLOUDFLARE_ACCOUNT_ID\b|WORKERS_SUBDOMAIN\b)/.test(rest)) return '不能帶金鑰';
  return '';
}

// #622：會動正式環境的 workflow 每個 job 都要 `if: github.ref == 'refs/heads/main'`，也不能另外指定分支。回傳問題或 ''
function mainOnlyProblem(wf) {
  const jobs = wf.replace(/\r/g, '').split(/^jobs:\n/m)[1];
  const blocks = (jobs || '').split(/^(?=  [\w-]+:\n)/m).filter(b => /^  [\w-]+:\n/.test(b));
  if (!blocks.length) return '找不到 job';
  for (const b of blocks) {
    if (!/^    if: github\.ref == 'refs\/heads\/main'$/m.test(b)) return `job ${b.match(/^  ([\w-]+):/)[1]} 要限定 main`;
  }
  if (/inputs\.ref\b|^\s+ref:/m.test(wf)) return '不能另外指定分支';
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
  await check('#214／稽核 3 部署：R2 只查證，正式與預覽的 Worker、D1、R2 分開，失敗不繼續部署', () => {
    if (!/node scripts\/r2-bucket\.mjs\r?\n/.test(deploy) || /r2-bucket\.mjs --create/.test(deploy)) throw new Error('正式 R2 只能查證');
    if (!deploy.includes('node scripts/d1-database.mjs --config "${{ steps.r2.outputs.config }}"')) throw new Error('準備資料庫要接著 R2 那一步的設定');
    if (!deploy.includes('wrangler@4 deploy --config "${{ steps.d1.outputs.config }}"')) throw new Error('正式部署要用確認後的設定');
    if (/r2-bucket\.mjs/.test(preview)) throw new Error('預覽不查正式 R2，測試 R2 由 d1-database.mjs --preview 查證');
    if (!preview.includes('node scripts/d1-database.mjs --config wrangler.jsonc --preview')) throw new Error('預覽要查證隔離（測試 D1、測試 R2、沒有密鑰）');
    if (/--create-preview-worker/.test(preview)) throw new Error('預覽 Worker 只由 K 手動建立一次');
    if (!/versions upload\s*\\\s*\r?\n\s*--config "\$\{\{ steps\.d1\.outputs\.config \}\}"/.test(preview)) throw new Error('預覽上傳要用驗證過的隔離設定');
    if (/--secrets-file|secret put|secrets\.(?!CLOUDFLARE_API_TOKEN\b|CLOUDFLARE_ACCOUNT_ID\b|WORKERS_SUBDOMAIN\b)/.test(preview)) throw new Error('預覽不能帶金鑰');
    const problem = deployWriteProblem(deploy, preview);
    if (problem) throw new Error(problem);
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
  const adminDeploy = await get('../.github/workflows/deploy-admin.yml');
  await check('管理網站部署 Action：只能手動、只部署 wrangler.admin.jsonc 並記 commit、不套 migration、不帶金鑰、部署後確認 Access 擋住', () => {
    if (!adminDeploy) throw new Error('讀不到 deploy-admin.yml');
    const problem = adminDeployProblem(adminDeploy);
    if (problem) throw new Error(problem);
    if (!/d1-migrations\.mjs check --target production/.test(adminDeploy)) throw new Error('部署前要確認正式庫 migration 都套過');
    if (!/cloudflareaccess\.com\/cdn-cgi\/access\/login/.test(adminDeploy)) throw new Error('部署後要確認沒登入會被轉到 Access 登入頁');
  });
  await check('管理網站部署擋關檢查的反例：自動觸發、部署志工設定、沒記 commit、套 migration、帶金鑰都會被擋', () => {
    const head = 'on:\n  workflow_dispatch:\n';
    const deploy = 'npx --yes wrangler@4 deploy --config wrangler.admin.jsonc --message "x"\n';
    if (adminDeployProblem(head + deploy)) throw new Error('管理網站部署應該放行');
    const bad = [
      'on:\n  workflow_dispatch:\n  push:\n    branches: [main]\n' + deploy,
      head + deploy.replace('wrangler.admin.jsonc', 'wrangler.jsonc'),
      head + deploy.replace(' --message "x"', ''),
      head + deploy + 'npx --yes wrangler@4 deploy --config wrangler.jsonc\n',
      head + deploy + 'npx --yes wrangler@4 d1 migrations apply bq-shelter-dogs --remote\n',
      head + deploy + 'ADMIN_KEY: ${{ secrets.ADMIN_KEY }}\n',
    ];
    bad.forEach((wf, i) => { if (!adminDeployProblem(wf)) throw new Error(`反例 ${i + 1} 沒被擋`); });
  });
  const prodManual = {
    'deploy-cloudflare.yml': deploy,
    'd1-migrations.yml': await get('../.github/workflows/d1-migrations.yml'),
    'deploy-admin.yml': adminDeploy,
    'seed-preview-db.yml': await get('../.github/workflows/seed-preview-db.yml'),
  };
  await check('#622 會動正式環境的 workflow 只准 main；測試網站照舊可以填分支', () => {
    for (const [f, wf] of Object.entries(prodManual)) {
      if (!wf) throw new Error(`讀不到 ${f}`);
      const problem = mainOnlyProblem(wf);
      if (problem) throw new Error(`${f}：${problem}`);
    }
    if (!/inputs\.ref/.test(testSite) || !mainOnlyProblem(testSite)) throw new Error('測試網站要保留手動指定分支');
  });
  await check('#622 只准 main 檢查的反例：少一個 job、條件放寬、能填分支都會被擋', () => {
    const job = (name, extra = '') => `  ${name}:\n    if: github.ref == 'refs/heads/main'\n    runs-on: ubuntu-latest\n${extra}`;
    if (mainOnlyProblem('on:\n  workflow_dispatch:\njobs:\n' + job('a') + '\n' + job('b'))) throw new Error('每個 job 都限定 main 應該放行');
    const bad = [
      'jobs:\n' + job('a') + '  b:\n    runs-on: ubuntu-latest\n',
      "jobs:\n  a:\n    if: github.ref == 'refs/heads/main' || inputs.force\n",
      "jobs:\n  a:\n    steps:\n      - if: github.ref == 'refs/heads/main'\n",
      'jobs:\n' + job('a', '    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ inputs.ref }}\n'),
      'on:\n  workflow_dispatch:\n',
    ];
    bad.forEach((wf, i) => { if (!mainOnlyProblem(wf)) throw new Error(`反例 ${i + 1} 沒被擋`); });
  });
  await check('#622 志工站部署排隊不取消：套完 migration 後呼叫的部署不會被 push 部署砍掉', () => {
    if (!/^concurrency:\r?\n  group: deploy-cloudflare\r?\n  cancel-in-progress: false\r?$/m.test(deploy)) throw new Error('deploy-cloudflare 要 cancel-in-progress: false');
  });
  const thumbs = await get('../.github/workflows/r2-thumbs.yml');
  await check('#130 縮圖（R2）Action：只能手動或由 Worker 叫、用管理金鑰、不提交 repo', () => {
    if (!thumbs) throw new Error('讀不到 r2-thumbs.yml');
    if (!/on:\r?\n  workflow_dispatch:\r?\n\r?\n/.test(thumbs)) throw new Error('只能用 workflow_dispatch 觸發');
    if (!/ADMIN_KEY: \$\{\{ secrets\.ADMIN_KEY \|\| secrets\.NOTES_PASSCODE \}\}/.test(thumbs)) throw new Error('金鑰要用 Secret ADMIN_KEY');
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
  const isolated = await get('../wrangler.preview-db.jsonc');
  await check('稽核 3 wrangler.jsonc：正式 Worker 關預覽網址、不保留網頁上加的變數；預覽用獨立 Worker 與測試照片空間', () => {
    if (!cfg) return;
    if (!/"preview_urls": false/.test(cfg)) throw new Error('正式 Worker 要關 preview_urls，它的版本會帶正式密鑰');
    if (!/"name": "bq-shelter-dogs-preview"/.test(isolated)) throw new Error('預覽要用獨立 Worker bq-shelter-dogs-preview');
    if (!/"r2_buckets": \[\{ "binding": "PHOTOS", "bucket_name": "bq-shelter-photos-test" \}\]/.test(isolated)) throw new Error('預覽要用測試照片空間');
    if (!/"triggers": \{ "crons": \[\] \}/.test(isolated)) throw new Error('預覽不准有排程，要明寫 crons: []');
    if (!/"keep_vars": false/.test(cfg)) throw new Error('keep_vars 要是 false，免得 PREVIEW 被帶進正式版');
  });
}

// #125 網站搬到 Cloudflare：同一個網址的 /api 是 Worker；舊網址和本機照舊用原本的照片上傳 Worker
async function runCloudflareTests() {
  await check('#125 照片上傳服務網址：一律用同網址 /api，舊的單獨 Worker 拿掉了', () => {
    eq(BQApi.baseFor({ hostname: 'bq-shelter-dogs.example.workers.dev', origin: 'https://bq-shelter-dogs.example.workers.dev' }),
      'https://bq-shelter-dogs.example.workers.dev/api', '新網址：');
    eq(BQApi.baseFor({ hostname: 'pr-12-bq-shelter-dogs-preview.example.workers.dev', origin: 'https://pr-12-bq-shelter-dogs-preview.example.workers.dev' }),
      'https://pr-12-bq-shelter-dogs-preview.example.workers.dev/api', '預覽網址：');
    eq(BQApi.baseFor({ hostname: 'localhost', origin: 'http://localhost:8787' }), 'http://localhost:8787/api', '本機（wrangler dev）：');
    eq([BQApi.baseFor(undefined), BQApi.baseFor({ origin: 'null' })], ['', ''], '沒有網址（同步腳本測試、直接開檔案）不上傳：');
    if (/bq-shelter-photos\.|OLD_UPLOAD_URL/.test(APP_JS + API_JS)) throw new Error('js/app.js、js/api.js 不該再有舊的照片上傳服務網址');
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
