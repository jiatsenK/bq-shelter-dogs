// 志工網站的網址（ADR 0024）：#walk、#groups、#mine、#find、#info、#info/<子頁>、#dog/<編號>。
// 只負責網址和畫面之間怎麼換、哪些點擊交給瀏覽器；歷史紀錄在 overlays.js，畫面在各頁模組。不依賴其他模組。

const PAGE_TABS = ['walk', 'groups', 'mine', 'find', 'info'];

function pageHash(tab, infoPage = '') {
  return tab === 'info' && infoPage ? `#info/${infoPage}` : `#${tab}`;
}

// 沒有編號的狗不給網址
function dogHash(dog) {
  return dog && dog.id ? `#dog/${encodeURIComponent(dog.id)}` : '';
}

// 看不懂的網址回 null，呼叫的人照預設開溜狗表；子頁名稱對不對由呼叫的人用 INFO_PAGES 判斷
function parseHash(hash) {
  const m = /^#([a-z]+)(?:\/(.*))?$/.exec(hash || '');
  if (!m) return null;
  const [, head, rest = ''] = m;
  if (head === 'dog') {
    let id = '';
    try { id = decodeURIComponent(rest).trim(); } catch (e) { return null; }
    return id ? { tab: 'walk', infoPage: '', dogId: id } : null;
  }
  if (!PAGE_TABS.includes(head)) return null;
  return { tab: head, infoPage: head === 'info' ? rest : '', dogId: '' };
}

// 一般左鍵點擊（含 Enter）留在原頁；加了 Ctrl、⌘、Shift、Alt 交給瀏覽器開新分頁或新視窗
function plainClick(e) {
  return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}

// 電腦版是真連結（可以 Ctrl＋點、右鍵複製）；手機維持按鈕，長按不跳出連結選單
function routeControl(asLink, href, attrs, inner) {
  return asLink && href
    ? `<a href="${href}" ${attrs}>${inner}</a>`
    : `<button type="button" ${attrs}>${inner}</button>`;
}

export { PAGE_TABS, pageHash, dogHash, parseHash, plainClick, routeControl };
