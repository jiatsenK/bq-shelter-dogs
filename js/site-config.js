// 這間收容所的設定（K 2026-10-10：「這個網站以後若其他收容所要用可以整個搬去用，所以有些東西要分離出來」）。
// 換一間收容所時先改這個檔；還沒搬進來、要另外改的地方列在 docs/SITE_CONFIG.md。
// index.html、cards.html 都在其他程式前面載入；這裡只放設定，不放邏輯。
const SITE = {
  // 名字：頁首、導覽、分析頁用。index.html 的 <title>、manifest.webmanifest 是靜態檔，要另外改（見 docs/SITE_CONFIG.md）
  name: '板收志工溜狗表',
  shelter: '板橋收容所',
  shelterShort: '板收',

  // 天數色標：0～amber-1 天綠、amber 天起黃、red 天起紅
  // （K 2026-10-09：大部分的狗三天沒溜就覺得很久了 → 0–2 天綠、3–4 天黃、5 天以上紅）
  days: { amber: 3, red: 5 },

  // 警示關鍵字（2026-09-24 K 定，#28）：備註含任一個，就把備註原文直接顯示在卡片第一層，字眼標紅。
  // 每組第一個是關鍵字，後面是常見異體寫法，一起比對。志工發現新的慣用字眼時，在這裡加一組。
  // 「住院」不列入：住院區只是籠位，那裡的狗照常會遛。
  warnKeywords: [
    ['勿溜', '勿遛', '勿蹓'],
    ['不要'],
    ['攻擊'],
    ['不親狗'],
    ['不親'],
  ],

  // 入所原因（K 2026-10-10）：狗卡上選一個；place 是這個原因要不要另外寫「拾獲地點」。
  // scripts/sync-sheet.mjs 的 INTAKE_REASONS 是同一份名字（同步時從舊介紹讀出來用），改這裡也要改那裡
  intakeReasons: [
    { name: '政府處理案件', place: true },
    { name: '收容所轉入', place: true },
    { name: '民眾拾獲', place: true },
    { name: '認養後退回', place: false },
    { name: '飼主不續養', place: false },
  ],

  // 犬舍分區：照籠位開頭分（match 是正規表示式，比對去掉空白的籠位）。
  // name：電腦版簡報、分區分頁；team、color：圖鑑的隊名和隊色（中明度，上面放白字）。
  // 找狗的平面圖（js/find.js 的 FIND_ZONES、籠位排法）還沒搬進來。
  zones: [
    { key: 'new', name: '新犬舍', match: '^新', team: '新犬舍隊', color: '#1F5C9E' },
    { key: 'old', name: '舊犬舍', match: '^舊', team: '舊犬舍隊', color: '#0F6B6B' },
    { key: 'mom', name: '幼母', match: '^母幼', team: '幼母隊', color: '#875700' },
    { key: 'c', name: 'C 區', match: '^C', flags: 'i', team: 'C 區隊', color: '#2F7A45' },
    { key: 'ward', name: '住院區', match: '^住院', team: '住院區隊', color: '#6E4A9E' },
  ],
  // 不在上面任何一區的狗，在圖鑑算這一隊
  freeTeam: { key: 'free', team: '自由球員', color: '#55605B' },
};

// 分區的比對函式：其他檔案用 zone.test(籠位)；籠位先去掉空白
for (const z of SITE.zones) {
  const re = new RegExp(z.match, z.flags || '');
  z.test = cage => re.test(String(cage || '').replace(/\s/g, ''));
}
