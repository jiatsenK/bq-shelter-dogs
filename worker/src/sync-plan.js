// 共用的台灣日期。ADR 0012 的「有改才叫 GitHub 同步」（markChanged／planTick／試算表指紋）#501 起退役，
// 狗清單改由 GAS 編輯觸發送列（worker/src/dog-list.js，ADR 0018）。

// 台灣今天的日期 YYYY-MM-DD（index.js 也用這個）
export const taiwanYmd = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
