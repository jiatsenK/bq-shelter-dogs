// 分享網站（ADR 0023）：先用手機分享選單，不行就複製，都不行由畫面顯示網址。navigator 由呼叫端帶入，Node 測試用假的。
export const SHARE_TEXT = '來去板橋動物之家遛狗吧 🐕';

// 回傳 share（分享選單回報成功）、copy（複製成功）、cancel（取消，不記次數）、manual（要顯示網址讓人自己複製）
export async function shareSite(url, nav) {
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ text: SHARE_TEXT, url });
      return 'share';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancel';
    }
  }
  if (typeof nav.clipboard?.writeText === 'function') {
    try {
      await nav.clipboard.writeText(SHARE_TEXT + '\n' + url);
      return 'copy';
    } catch {}
  }
  return 'manual';
}
