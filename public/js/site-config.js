

// 這間收容所的設定（K 2026-10-10：「這個網站以後若其他收容所要用可以整個搬去用，所以有些東西要分離出來」）。
// 換一間收容所時先改這個檔；還沒搬進來、要另外改的地方列在 docs/setup/SITE_CONFIG.md。
// index.html、cards.html 都在其他程式前面載入；這裡只放設定，不放邏輯。
const SITE = {
  // 名字：頁首、導覽、分析頁用。index.html 的 <title>、manifest.webmanifest 是靜態檔，要另外改（見 docs/setup/SITE_CONFIG.md）
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
    // K 2026-10-29：常溜狗群原本另外用這兩種字眼擋登記；改成都不擋、只顯示警示，字眼併進來（critique 2026-10-28 #9）
    ['不可帶出'],
    ['禁止溜', '禁止遛', '禁止蹓'],
  ],

  // 犬舍分區：照籠位開頭分（match 是正規表示式，比對去掉空白的籠位）。
  // name：電腦版簡報、分區分頁，區名照 GLOSSARY「區」（住院區、C區，跟找狗同一個叫法，critique 2026-10-28 #11；K 2026-10-29 隔離區改叫住院區）；team、color：圖鑑的隊名和隊色（中明度，上面放白字）。
  // 找狗的平面圖位置與籠位排法還在 js/find.js（FIND_ZONES 用這裡的 test 判斷籠位在哪一區）。
  zones: [
    { key: 'new', name: '新犬舍', match: '^新', team: '新犬舍隊', color: '#1F5C9E' },
    { key: 'old', name: '舊犬舍', match: '^舊', team: '舊犬舍隊', color: '#0F6B6B' },
    { key: 'mom', name: '幼母犬舍', match: '^母幼', team: '幼母隊', color: '#875700' },
    { key: 'c', name: 'C區', match: '^C', flags: 'i', team: 'C區隊', color: '#2F7A45' },
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

export { SITE };
