// 編輯紀錄的改前／改後顯示（純函式）：志工編輯紀錄頁與管理網站更新紀錄共用（#567，由 build-admin-assets 複製）。

// 合併狗的筆數：{ 溜狗紀錄: 3 } → 「溜狗紀錄 3 筆」（管理網站預覽也用）
export const countsText = c => Object.entries(c || {}).map(([k, n]) => `${k} ${n} 筆`).join('、');

// 改前／改後內容寫成一行字
export function editsValue(kind, v) {
  if (kind === 'sex') return ({ male: '公', female: '母', '': '待確認' })[v] || '待確認';
  if (kind === 'fixed-care') return v ? '開啟' : '關閉';
  if (v === null || v === undefined || v === '') return '（沒有）';
  if (kind === 'intro' && typeof v === 'object' && Array.isArray(v.events)) {
    return [...v.events.map(e => `${e.date || '日期未確認'} ${e.event}${e.number ? `（${e.number}）` : ''}`), v.text].filter(Boolean).join('\n');
  }
  if (kind === 'volunteer_rename') return v.name;
  if (kind === 'volunteer_merge') {
    const person = p => p.name + '（常溜 ' + p.favorites + '、開卡 ' + p.cards + '、溜狗來源紀錄 ' + p.walkRows + '）';
    return v.source ? person(v.source) + ' ＋ ' + person(v.target) : v.name;
  }
  if (kind === 'merge' || kind === 'unmerge') {
    // 合併狗（管理網站）：改前＝被併那隻與牠的資料筆數；改後＝併到哪隻、搬了什麼（取消合併反過來）
    const counts = c => countsText(c) || '沒有資料';
    const dog = (name, numbers) => `${name || '未命名'}（${(numbers || []).join('、') || '無編號'}）`;
    if (v.moved) return `併到 ${dog(v.name, [v.number].filter(Boolean))}；搬過去：${counts(v.moved)}${Object.keys(v.kept || {}).length ? `；兩邊都有、留原本的：${counts(v.kept)}` : ''}`;
    if (v.mergeLogId) return `${dog(v.name, [v.number].filter(Boolean))}，取消第 ${v.mergeLogId} 筆合併`;
    return `${dog(v.name, v.numbers)}：${counts(v.counts)}`;
  }
  // #774 不是同一隻：改前＝待核對那隻，改後＝表上那隻
  if (kind === 'not_same') return v.cage ? `跟 ${v.name || '未命名'}（${v.cage}）不是同一隻` : (v.name || '未命名');
  if (kind === 'rest') return `休養到 ${v.until}${v.reason ? `（${v.reason}）` : ''}`;
  if (kind === 'group') return `${v.label || '（沒有群名）'}：${(v.names || []).join('、') || '（沒有狗）'}`;
  if (kind === 'activity') return `${v.date} ${{ kids: '動保小小兵', adoption: '認養會' }[v.kind] || v.kind}：${(v.dogs || []).join('、') || '（沒有狗）'}`;
  if (kind === 'departed-card') return v.linkedTo ? `「${v.name}」接到編號 ${v.linkedTo}（${v.attendances} 筆出席）` : `${v.name}（離所 ${v.departed || '日期不明'}，接上 ${v.attendances} 筆出席）`;
  if (kind === 'walk') return `${v.date || '沒溜過'}${v.walker ? `（${v.walker}）` : ''}`; // #672：上一次／這一次哪天、誰溜的
  if (kind === 'walkundo' || kind === 'walkedit') return `上次溜 ${v.date || '沒溜過'}${v.walker ? `（${v.walker}）` : ''}`;
  if (kind === 'photo') return v.trash ? `舊照片在垃圾桶：${v.trash}` : (v.path || v.key ? '新照片' : '（沒有）');
  return typeof v === 'string' ? v : JSON.stringify(v);
}
