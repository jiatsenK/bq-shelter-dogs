// 開關打開前寫的套件（試算表寫回的舊回應格式）照舊在開關關著時跑；D1 登記另有 walk-accept、walk-d1-entries、walk-feedback。
// Playwright 後註冊的 route 先處理，所以要在各套件自己的 route 之後、開頁之前呼叫。
const fs = require('node:fs');
module.exports = context => context.route('**/js/site-config.js', route => route.fulfill({ contentType: 'application/javascript',
  body: fs.readFileSync(require.resolve('../../public/js/site-config.js'), 'utf8').replace('d1WalkAccept: true', 'd1WalkAccept: false') }));
