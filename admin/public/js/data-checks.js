// #567 待補清單（原資料檢查）的純規則：缺漏項目沿用志工資料完整度（analysis.js dataCompleteness），只看主清單上的狗；
// #518 掃描清單的狀態分成從未掃描、讀不懂、過期與正常。用已載入的狗資料，不另查 D1 或照片檔。
import { BQDates } from '../shared/dates.js';
import { formatWhen as when } from './edit-log.js';

export const SHEET_LABELS = { main: '主清單', departed: '已出所', groups: '常遛狗群', notes: '異動紀錄' };

export function completeness(dogs) {
  const rows = dogs.filter(d => d.onMain);
  const pick = fn => rows.filter(fn);
  return { total: rows.length, items: [
    // #624 用語和狗資料表一致；care 是狗資料表「維護狀態」篩選的值（dog-table.js CARE_FILTERS），連過去直接看這幾隻
    { care: 'missingNumber', label: '缺編號', dogs: pick(d => !d.number) },
    { care: 'badNumberDate', label: '編號看不出入所日期', dogs: pick(d => d.number && !BQDates.idDate(d.number)) },
    { care: 'missingWalk', label: '缺溜狗日期', dogs: pick(d => !d.walkedDate) },
    { care: 'unknownSex', label: '性別待確認', dogs: pick(d => !['male', 'female'].includes(d.sex)) },
    { care: 'missingIntro', label: '缺介紹', dogs: pick(d => !d.intro.trim()) },
    // 照片紀錄＝D1 照片引用或 R2 清單；檔案本身讀不讀得到另外在狗資料表提示
    { care: 'missingPhoto', label: '缺照片', dogs: pick(d => !d.photoUrl) },
  ] };
}

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

// 稽核第 5 項：排程有沒有在跑。工作名稱與頻率跟 wrangler.jsonc 的排程一致（worker/src/index.js 的 RETRY_CRON、SCAN_CRON）。
export const CRON_LABELS = {
  retry: { name: '寫回重試', every: '每 10 分鐘' },
  scan: { name: '保險掃描', every: '每天 09:23、13:23、23:23' },
  trash: { name: '照片垃圾桶', every: '每月 1 日 09:23' },
};

export function parseCronStatus(data) {
  const jobs = data && data.jobs;
  const time = v => v === null || (typeof v === 'string' && !isNaN(Date.parse(v)));
  if (!Array.isArray(jobs) || !jobs.every(j => j && CRON_LABELS[j.job] && ['ok', 'never', 'error'].includes(j.state)
    && time(j.okAt) && time(j.failAt) && typeof j.error === 'string' && typeof j.stale === 'boolean')) throw Error('排程紀錄格式不正確');
  return jobs;
}

// 每件工作一行：最後一次跑完、最近失敗（比最後跑完還新才算現在有問題）、是否過期
export function cronStatus(j) {
  if (j.state === 'never') return { last: '還沒有紀錄', problem: j.job === 'trash' ? '每月 1 日才跑，第一次跑完後才會出現' : '志工網站更新後下一次排程跑完才會出現', bad: j.job !== 'trash' };
  if (j.state === 'error') return { last: '紀錄讀不懂', problem: '不能當成有在跑；請聯絡維護者', bad: true };
  const failing = j.failAt && (!j.okAt || Date.parse(j.failAt) > Date.parse(j.okAt));
  const problems = [];
  if (failing) problems.push(`${when(j.failAt)} 失敗${j.error ? `：${j.error}` : ''}`);
  if (j.stale) problems.push(j.okAt ? '已過期，最近幾次都沒有跑完' : '還沒有成功跑完過');
  return { last: j.okAt ? when(j.okAt) : '—', problem: problems.join('；') || '正常', bad: Boolean(failing || j.stale) };
}

// #684 寫回停止重試的狗：試算表明確拒絕就停、其他錯誤 10 次後停。舊版 Worker 沒回 stopped 時當成沒有。
export function parseStoppedWalks(data) {
  const list = data && data.stopped;
  if (list === undefined) return [];
  if (!Array.isArray(list) || !list.every(d => d && typeof d.name === 'string' && typeof d.number === 'string' && typeof d.reason === 'string'
    && typeof d.date === 'string' && Number.isSafeInteger(d.failures))) throw Error('停止重試清單格式不正確');
  return list;
}

export const stoppedStatus = list => list.length
  ? `${list.length} 隻狗寫回試算表失敗、已停止重試，試算表上還是舊的溜狗紀錄。修好設定後，下次有人登記這隻狗就會再寫回。`
  : '目前沒有停止重試的狗。';

// #624 待補清單 → 狗資料表：帶篩選條件；給 dogId 時直接開那隻狗的編輯抽屜（狀態分頁預設在所，不用另外帶）
export const careLink = (care, dogId) => `./?${new URLSearchParams({ care, ...(dogId ? { dog: dogId } : {}) })}`;
