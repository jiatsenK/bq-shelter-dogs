// #301 原型的預覽 Worker：GET /run?key=PROTO_KEY 跑一次差異同步，寫進預覽 D1（不碰正式 D1），回傳量測數字。
// CPU 時間看 wrangler tail（每筆紀錄的 cpuTime）。設定在 wrangler.prototype.jsonc。
import { syncSheetToD1 } from '../src/sheet-sync.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/run' || !env.PROTO_KEY || url.searchParams.get('key') !== env.PROTO_KEY) return new Response('not found', { status: 404 });
    const started = Date.now();
    try {
      const result = await syncSheetToD1(env.DB);
      return Response.json({ ok: true, ...result, wallMs: Date.now() - started });
    } catch (e) {
      return Response.json({ ok: false, error: e.message, stack: e.stack }, { status: 500 });
    }
  },
};
