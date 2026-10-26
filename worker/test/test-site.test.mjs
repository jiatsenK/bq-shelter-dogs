import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import worker from '../src/index.js';
import { testSiteHtml, TEST_THEME } from '../src/test-site.js';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');
const jsonc = text => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));

test('測試網站換裝：標題、網址列顏色、圖示、manifest 都換成測試版，其他內容不動', async () => {
  const html = await read('public/index.html');
  const out = testSiteHtml(html);
  assert.match(out, /<html data-site="test" lang="zh-Hant">/);
  assert.match(out, /<title>測試｜板收志工溜狗表<\/title>/);
  assert.ok(out.includes(`<meta name="theme-color" content="${TEST_THEME}">`));
  assert.ok(out.includes('<meta name="apple-mobile-web-app-title" content="板收測試版">'));
  for (const swapped of ['icons/icon-test.svg', 'icons/icon-test-192.png', 'icons/apple-touch-icon-test.png', 'manifest-test.webmanifest']) assert.ok(out.includes(`href="${swapped}"`), swapped);
  assert.ok(!/href="(?:icons\/[^"]*v2[^"]*|manifest\.webmanifest)"/.test(out), '不留正式版圖示');
  assert.equal(out.replace(/<head>[\s\S]*?<\/head>/, ''), html.replace(/<html/, '<html data-site="test"').replace(/<head>[\s\S]*?<\/head>/, ''), 'body 不動');
});

test('測試網站換裝：每一頁都套得到，換上的圖示與 manifest 檔都存在', async () => {
  const pages = (await readdir(new URL('public/', ROOT))).filter(f => f.endsWith('.html'));
  for (const page of pages) {
    const out = testSiteHtml(await read(`public/${page}`));
    assert.match(out, /<html data-site="test"/, page);
    assert.match(out, /<title>測試｜/, page);
    for (const [, href] of out.matchAll(/href="((?:icons\/[^"]+)|manifest-test\.webmanifest)"/g)) await read(`public/${href}`);
  }
  const manifest = JSON.parse(await read('public/manifest-test.webmanifest'));
  assert.equal(manifest.theme_color, TEST_THEME);
  for (const icon of manifest.icons) await readFile(new URL(`public/${icon.src}`, ROOT));
});

test('測試網站設定：SITE_ENV=test、每一頁先經過 Worker；正式版沒有 SITE_ENV、網頁不經過 Worker', async () => {
  const testSite = jsonc(await read('wrangler.test-site.jsonc'));
  const prod = jsonc(await read('wrangler.jsonc'));
  assert.equal(testSite.vars.SITE_ENV, 'test');
  assert.equal(prod.vars?.SITE_ENV, undefined);
  assert.ok(!prod.assets.run_worker_first.some(p => p === '/' || /html|groups|cards|edits/.test(p)), '正式版網頁不經過 Worker');
  const routes = testSite.assets.run_worker_first;
  const pages = (await readdir(new URL('public/', ROOT))).filter(f => f.endsWith('.html'));
  for (const page of pages) {
    const name = page.replace(/\.html$/, '');
    const paths = name === 'index' ? ['/', '/index.html'] : [`/${name}`, `/${page}`];
    for (const p of paths) assert.ok(routes.includes(p), `run_worker_first 少了 ${p}（public/ 新增網頁要加）`);
  }
});

test('測試網站 Worker：網頁換裝，非網頁、轉址原樣；沒設 SITE_ENV 完全不動', async () => {
  const page = '<!doctype html><html lang="zh-Hant"><head><title>板收</title><meta name="theme-color" content="#1F5C4D"></head><body></body></html>';
  const ASSETS = { fetch: async request => {
    const path = new URL(request.url).pathname;
    if (path === '/groups.html') return new Response(null, { status: 307, headers: { Location: '/groups' } });
    if (path === '/css/app.css') return new Response('body{}', { headers: { 'Content-Type': 'text/css' } });
    return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(page.length), ETag: '"x"' } });
  } };
  const get = (path, env) => worker.fetch(new Request('https://site.example.org' + path), env, { waitUntil() {} });
  const test = await get('/', { ASSETS, SITE_ENV: 'test' });
  const text = await test.text();
  assert.match(text, /<html data-site="test"/);
  assert.match(text, /<title>測試｜板收<\/title>/);
  assert.equal(test.headers.get('ETag'), null);
  assert.equal(test.headers.get('Content-Length'), null);
  assert.equal((await get('/groups.html', { ASSETS, SITE_ENV: 'test' })).status, 307);
  assert.equal(await (await get('/css/app.css', { ASSETS, SITE_ENV: 'test' })).text(), 'body{}');
  assert.equal(await (await get('/', { ASSETS })).text(), page, '正式版原樣');
});
