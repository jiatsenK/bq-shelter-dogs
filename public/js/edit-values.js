// 編輯紀錄的改前／改後顯示（純函式）：志工編輯紀錄頁與管理網站更新紀錄共用（#567，由 build-admin-assets 複製）。

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
  if (kind === 'rest') return `休養到 ${v.until}${v.reason ? `（${v.reason}）` : ''}`;
  if (kind === 'group') return `${v.label || '（沒有群名）'}：${(v.names || []).join('、') || '（沒有狗）'}`;
  if (kind === 'activity') return `${v.date} ${{ kids: '動保小小兵', adoption: '認養會' }[v.kind] || v.kind}：${(v.dogs || []).join('、') || '（沒有狗）'}`;
  if (kind === 'departed-card') return v.linkedTo ? `「${v.name}」接到編號 ${v.linkedTo}（${v.attendances} 筆出席）` : `${v.name}（離所 ${v.departed || '日期不明'}，接上 ${v.attendances} 筆出席）`;
  if (kind === 'walkundo' || kind === 'walkedit') return `上次溜 ${v.date || '沒溜過'}${v.walker ? `（${v.walker}）` : ''}`;
  if (kind === 'photo') return v.trash ? `舊照片在垃圾桶：${v.trash}` : (v.path || v.key ? '新照片' : '（沒有）');
  return typeof v === 'string' ? v : JSON.stringify(v);
}
