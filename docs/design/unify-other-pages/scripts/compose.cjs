const { chromium } = require('C:/Users/User/projects/bq-shelter-dogs/node_modules/playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 820, height: 800 }, deviceScaleFactor: 1.5 });
  await p.goto('file:///' + process.argv[2]); await p.waitForTimeout(500); await p.screenshot({ path: process.argv[3], fullPage: true }); await b.close(); })();
