// 網站更新頁的純規則：GitHub Releases（release-please 發版時自動產生）轉成要顯示的版本清單。
// 讀不懂整份回 null；草稿與預先發布版不列。日期換成台灣日期。

const taiwanDate = iso => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10) : null;
};

// release-please 每條改動長這樣：「* 說明 ([#457](網址)) ([a8edd13](網址))」。
// 拿掉結尾的 PR／commit 括號，其餘連結只留文字。
export function noteText(line) {
  return line
    .replace(/\s*\(\[[^\]]+\]\([^)]+\)\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

export function releaseSections(body) {
  const sections = [];
  for (const raw of String(body || '').split(/\r?\n/)) {
    const heading = raw.match(/^###\s+(.+)$/);
    if (heading) { sections.push({ title: heading[1].trim(), items: [] }); continue; }
    const item = raw.match(/^\s*[*-]\s+(.+)$/);
    if (!item) continue;
    if (!sections.length) sections.push({ title: '', items: [] });
    const text = noteText(item[1]);
    if (text) sections.at(-1).items.push(text);
  }
  return sections.filter(s => s.items.length);
}

export function toReleaseEntries(data) {
  if (!Array.isArray(data)) return null;
  const releases = [];
  for (const r of data) {
    if (!r || typeof r.tag_name !== 'string' || typeof r.html_url !== 'string') return null;
    if (r.draft || r.prerelease) continue;
    if (!taiwanDate(r.published_at)) return null;
    releases.push(r);
  }
  return releases
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .map(r => ({ version: r.tag_name, date: taiwanDate(r.published_at), url: r.html_url, sections: releaseSections(r.body) }));
}
