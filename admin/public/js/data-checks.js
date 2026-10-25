// #567 資料檢查的純規則：缺漏項目沿用志工資料完整度（analysis.js dataCompleteness），只看主清單上的狗；
// #518 掃描清單的狀態分成從未掃描、讀不懂、過期與正常。用已載入的狗資料，不另查 D1 或照片檔。
import { BQDates } from '../shared/dates.js';

export const SHEET_LABELS = { main: '主清單', departed: '已出所', groups: '常遛狗群', notes: '異動紀錄' };

export function completeness(dogs) {
  const rows = dogs.filter(d => d.onMain);
  const pick = fn => rows.filter(fn);
  return { total: rows.length, items: [
    { label: '沒有編號', dogs: pick(d => !d.number) },
    { label: '編號看不出入所日期', dogs: pick(d => d.number && !BQDates.idDate(d.number)) },
    { label: '沒有溜狗日期', dogs: pick(d => !d.walkedDate) },
    { label: '沒有性別', dogs: pick(d => !['male', 'female'].includes(d.sex)) },
    { label: '沒有入所介紹', dogs: pick(d => !d.intro.trim()) },
    // 照片紀錄＝D1 照片引用或 R2 清單；檔案本身讀不讀得到另外在狗資料表提示
    { label: '沒有照片紀錄', dogs: pick(d => !d.photoUrl) },
  ] };
}

const when = iso => {
  const d = new Date(Date.parse(iso) + 8 * 3600000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

export function parseSheetGaps(data) {
  const g = data && data.sheetGaps;
  if (!g || !['ok', 'never', 'error'].includes(g.state) || !Array.isArray(g.items) || !Number.isSafeInteger(g.total)) throw Error('掃描清單格式不正確');
  for (const item of g.items) {
    if (!item || typeof item.sheet !== 'string' || typeof item.key !== 'string' || typeof item.name !== 'string' || typeof item.number !== 'string') throw Error('掃描清單格式不正確');
  }
  return g;
}

export function gapStatus(g) {
  if (g.state === 'never') return '還沒有掃描紀錄。試算表保險掃描（每天 09:43、13:53、23:53）跑過後才會出現。';
  if (g.state === 'error') return '掃描紀錄讀不懂，不能當成沒有差異；請等下一次掃描或聯絡維護者。';
  const recorded = g.recordedAt ? `清單記錄於 ${when(g.recordedAt)}` : '清單記錄時間不明';
  if (!g.checkedAt) return `${recorded}；掃描時間還沒記錄（志工網站更新後的下一次掃描開始記），無法確認是否過期。`;
  return `${recorded}；最後掃描 ${when(g.checkedAt)}${g.stale ? '，已過期（超過一天沒有新掃描），清單可能不是最新' : ''}。`;
}
