// #460 CPU 驗收用的假 Apps Script：不連 Google，主清單只在記憶體裡。
// 每隻測速狗的試算表值固定等於 D1 的目標（S），所以保險掃描沒有差異、派送照正式流程取目標、寫入、讀回、確認。
export const BENCH_DOGS = Number(globalThis.process?.env?.BENCH_DOGS) || 200;
export const BENCH_VALUE = { date: '2026-10-21', walker: '甲' };
export const benchDog = i => ({ id: `CPU${String(i).padStart(4, '0')}`, name: `測速狗${i}` });

export function fakeSheet(env, worker) {
  // 回呼跟正式 Apps Script 一樣走寫回端點。線上經服務綁定 CALLBACK 打到另一個測速 Worker，
  // 是分開的呼叫、各自計 CPU（跟正式相同）；本機測試沒有綁定時在同一個行程執行。
  const machine = async (action, body) => {
    const req = new Request(`https://bench.invalid/api/walk-writeback/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sheet-Write-Key': env.SHEET_WRITE_KEY }, body: JSON.stringify(body),
    });
    const res = env.CALLBACK ? await env.CALLBACK.fetch(req) : await worker.fetch(req, env, { waitUntil() {} });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
    return out;
  };
  return async (url, init) => {
    if (String(url) !== env.SHEET_WRITE_URL) throw new Error('測速 Worker 不連外');
    const body = JSON.parse(init.body);
    if (body.key !== env.SHEET_WRITE_KEY) return Response.json({ ok: false }, { status: 403 });
    // 量最壞情況（#460）：指紋每輪都不同，Worker 每輪都拿整份 200 列比對，不走「沒改」捷徑
    if (body.action === 'walkScan') {
      return Response.json({ ok: true, sig: `bench-${Date.now()}-${Math.random()}`, rows: Array.from({ length: BENCH_DOGS }, (_, i) => ({ dog: benchDog(i + 1), current: BENCH_VALUE })) });
    }
    const wake = async item => {
      const target = await machine('target', { dog: item.dog, dispatchId: item.dispatchId, current: BENCH_VALUE });
      const receipt = { dogKey: item.dog.id, version: target.version, dispatchId: target.dispatchId, current: target.current };
      return { ok: true, ...receipt, ...await machine('receipt', receipt) };
    };
    if (body.action === 'walkWake') return Response.json(await wake(body));
    // 合併派送：跟 Apps Script 一樣逐隻走（同一個鎖），回呼各自是分開的呼叫
    if (body.action === 'walkWakeBatch') {
      const results = [];
      for (const item of body.items) results.push(await wake(item));
      return Response.json({ ok: true, results });
    }
    return Response.json({ ok: false }, { status: 400 });
  };
}
