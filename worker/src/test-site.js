// 測試網站（wrangler.test-site.jsonc 設 SITE_ENV=test）跟正式版長不一樣：程式同一份，網頁送出前在這裡換掉。
// - <html data-site="test">：各頁 CSS 依這個換成紫色頁首、標題旁加「測試版」（public/css/*.css 的「測試網站」段）
// - 分頁標題前加「測試｜」、手機網址列顏色、主畫面圖示與名稱、manifest 都換成測試版，加到主畫面跟正式版分得出來
// 正式版不設 SITE_ENV，也不讓網頁經過 Worker（wrangler.jsonc 的 run_worker_first 只有 /api、/photos），完全不受影響。
export const TEST_THEME = '#5A2A5E';
export const TEST_APP_TITLE = '板收測試版';
const ASSET_SWAPS = [
  ['icons/icon-v2.svg', 'icons/icon-test.svg'],
  ['icons/icon-v2-192.png', 'icons/icon-test-192.png'],
  ['icons/apple-touch-icon-v2.png', 'icons/apple-touch-icon-test.png'],
  ['manifest.webmanifest', 'manifest-test.webmanifest'],
];

export const isTestSite = env => env?.SITE_ENV === 'test';

export function testSiteHtml(html) {
  let out = html
    .replace(/<html(?=[\s>])/, '<html data-site="test"')
    .replace(/<title>/, '<title>測試｜')
    .replace(/(<meta name="theme-color" content=")[^"]*/, `$1${TEST_THEME}`)
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*/, `$1${TEST_APP_TITLE}`);
  for (const [from, to] of ASSET_SWAPS) out = out.replaceAll(`href="${from}"`, `href="${to}"`);
  return out;
}

// 只改成功的 HTML 回應；轉址、404、照片、程式檔原樣回傳
export async function testSiteResponse(response) {
  if (response.status !== 200 || !(response.headers.get('Content-Type') || '').startsWith('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.delete('ETag');
  return new Response(testSiteHtml(await response.text()), { status: 200, headers });
}
