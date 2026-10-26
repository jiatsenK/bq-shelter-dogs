// 資料流頁（K 2026-10-26）的純規則：兩張節點圖的位置、連線與說明，以及把 /api/manage/flow-status 換成燈號。
// 內容依 docs/ARCHITECTURE_NOW.md 與 2026-10-26 資料傳輸稽核；架構改了要跟著改這份。不碰 DOM，Node 測試跑得到。
import { formatWhen as when } from './edit-log.js';
import { CRON_LABELS, cronStatus } from './data-checks.js';

// 節點：col／row 是格子位置（從 0 算）；live 是燈號來源（liveStatus 的 key），沒有就是不看狀態的節點。
// 連線：from／to 的 side 是接在哪一邊（l、r、t、b），shift 讓同一對節點的兩條線錯開；back 是回頭的線（虛線）。
export const VIEWS = {
  flow: {
    label: '資料流向',
    intro: 'D1 是正本：網站上的操作先記進 D1，再寫回試算表；管理者改試算表，由 Apps Script 送進 D1。排程負責補漏。',
    cols: 4, rows: 3,
    nodes: [
      { id: 'admin', title: '管理網站', kind: 'Worker・Access 登入', col: 0, row: 0, detail: {
        role: '管理者改設定、狗資料、活動、照片，直接讀寫正式 D1 和 R2。',
        data: '不碰試算表；試算表來的狗名、編號、籠位、備註只能看。',
        trigger: '管理者操作。main 合併不會自動部署，要手動跑「部署管理網站」。',
        failure: '每隻狗帶 revision，別人先改了回 409，草稿保留。',
        code: 'worker/src/admin/、admin/public/' } },
      { id: 'd1', title: 'D1', kind: '資料庫・正本', col: 1, row: 0, live: 'budget', detail: {
        role: '網站所有資料的正本：今日溜狗紀錄、溜狗紀錄、狗資料、設定、修改紀錄。',
        data: '網站和管理網站都只讀 D1，不讀試算表。',
        trigger: '每次寫入都先預留寫入預算；當天超過就停寫，登記回「溜狗寫入預算不足」。',
        failure: '一次登記的所有寫入在同一個交易，不會只寫一半。',
        code: 'db/compact-schema.sql、migrations/' } },
      { id: 'r2', title: 'R2', kind: '照片空間', col: 2, row: 0, detail: {
        role: '狗的照片與縮圖。每次上傳是新的不可覆寫版本，D1 記目前用哪一張。',
        data: '換掉的照片先放垃圾桶，管理網站可以復原。',
        trigger: '志工或管理者上傳、換主照片。',
        failure: 'D1 沒記這張照片時，清理不會刪它。',
        code: 'worker/src/dog-photo.js、worker/src/r2.js' } },
      { id: 'trash', title: '照片垃圾桶清理', kind: '排程・每月 1 日', col: 3, row: 0, live: 'cron:trash', detail: {
        role: '刪掉放進垃圾桶滿 30 天的照片備份。',
        data: '只刪 D1 記得、而且不是主照片的那幾張；固定路徑的舊照片不刪。',
        trigger: '每月 1 日 09:23，跟那次保險掃描一起跑。',
        failure: '一筆出錯就記下來、接著清下一筆；出錯那筆留到下個月。',
        code: 'worker/src/index.js 的 maintenance' } },
      { id: 'volunteer', title: '志工', kind: '手機', col: 0, row: 1, detail: {
        role: '按溜了、復原、改溜狗人，改介紹、休養、照片。',
        data: '登記前先把這次的識別存在手機，沒收到回應就用同一個識別重送，不會重複登記。',
        trigger: '志工操作。',
        failure: '網路斷了或逾時，手機留著原本的識別，下次查明或重送。',
        code: 'public/js/walk-registration.js' } },
      { id: 'worker', title: '志工網站', kind: 'Worker', col: 1, row: 1, live: 'lastWalk', detail: {
        role: '收下志工的操作：檢查格式、日期、身分，寫進 D1，再在背景派送寫回。',
        data: '回應「登記完成」只代表 D1 收下了，不代表試算表已經寫好。',
        trigger: '志工操作；寫回重試、保險掃描兩個排程也在這裡跑。',
        failure: '同時有人改同一隻狗，只有一個成功，另一個要先確認目前紀錄。',
        code: 'worker/src/index.js、worker/src/walk-accept.js' } },
      { id: 'gas', title: 'Apps Script', kind: 'Google', col: 2, row: 1, live: 'writeback', detail: {
        role: '兩個方向都經過這裡：把網站的登記寫回試算表；管理者改表時，把改到的列送給志工網站。',
        data: '寫回只改主清單「遛狗日期」「誰遛的」兩欄。寫前再讀一次，有人剛改過就停寫。',
        trigger: '寫回：志工網站派送。改表通知：試算表編輯觸發。',
        failure: '送不出去的改表通知留在指令碼屬性，每 10 分鐘補送；網站收到才清。燈號只看得到網站這邊還沒寫回的狗，Apps Script 自己的執行紀錄要到 Apps Script「執行作業」看。',
        code: 'apps-script/sheet-write.gs' } },
      { id: 'sheet', title: '試算表', kind: 'Google 試算表', col: 3, row: 1, live: 'conflicts', detail: {
        role: '管理者輸入狗清單、常溜狗群、異動紀錄的地方。網站不讀表。',
        data: '主清單刪掉的列，D1 不會跟著刪（K 2026-10-26 決定再發生才處理）。',
        trigger: '管理者改表 → 編輯觸發送改到的列。',
        failure: '試算表和網站對不上又不能判斷是誰改的，網站停寫、記成不一致，等下一次改表通知或保險掃描。',
        code: '主清單、已出所、常遛狗群三個分頁' } },
      { id: 'retry', title: '寫回重試', kind: '排程・每 10 分鐘', col: 1, row: 2, live: 'cron:retry', detail: {
        role: '把寫回失敗、結果不明或中斷的狗再派送一次。',
        data: '只處理還沒完成的，不讀整張試算表；沒工作就結束。',
        trigger: '志工網站 Worker 排程，每 10 分鐘（錯開 5 分）。',
        failure: '失敗後隔 1、2、4、8、15 分鐘再試，一直試到成功。',
        code: 'worker/src/walk-retry.js' } },
      { id: 'scan', title: '保險掃描', kind: '排程・每天三次', col: 2, row: 2, live: 'cron:scan', detail: {
        role: '比對試算表和網站的今日溜狗紀錄指紋，補回改表通知漏掉的人工修改。',
        data: '指紋一樣就結束；不一樣才找出是哪幾隻。不負責送出等著寫回的狗。',
        trigger: '志工網站 Worker 排程，每天 09:23、13:23、23:23，排在狗清單保險掃描之前，避免搶鎖。',
        failure: '這一輪沒處理完的狗，下一次掃描還會出現。',
        code: 'worker/src/walk-reconcile.js' } },
      { id: 'dogscan', title: '狗清單保險掃描', kind: '排程・Apps Script', col: 3, row: 2, live: 'dogListScan', detail: {
        role: '比對狗清單、已出所、常遛狗群、異動紀錄的指紋，只重送不一樣的單位。',
        data: 'D1 有、試算表沒有的只列出來，不自動刪；待補清單看得到。',
        trigger: 'Apps Script 時間觸發，每天 09:43、13:53、23:53；Google 只保證在那個小時內。',
        failure: '網站沒接手就停，下一次掃描接著補。',
        code: 'apps-script/sheet-write.gs 的 dogListScan、worker/src/dog-list.js' } },
    ],
    edges: [
      { from: ['volunteer', 'r'], to: ['worker', 'l'], label: '溜了' },
      { from: ['worker', 't'], to: ['d1', 'b'], label: '先記進 D1' },
      { from: ['worker', 'r', -12], to: ['gas', 'l', -12], label: '寫回' },
      { from: ['gas', 'l', 12], to: ['worker', 'r', 12], label: '改表通知', back: true },
      { from: ['gas', 'r', -12], to: ['sheet', 'l', -12], label: '寫兩欄' },
      { from: ['sheet', 'l', 12], to: ['gas', 'r', 12], label: '編輯觸發', back: true },
      { from: ['worker', 't', 24], to: ['r2', 'l', 12], label: '照片' },
      { from: ['admin', 'r'], to: ['d1', 'l'], label: '狗資料' },
      { from: ['admin', 't'], to: ['r2', 't'], label: '照片' },
      { from: ['trash', 'l'], to: ['r2', 'r'], label: '清理' },
      { from: ['retry', 'r'], to: ['gas', 'b', -24], label: '再派送', cron: true },
      { from: ['scan', 't'], to: ['gas', 'b'], label: '比指紋', cron: true },
      { from: ['dogscan', 'l'], to: ['gas', 'b', 24], label: '送指紋', cron: true },
    ],
  },
  chain: {
    label: '網站登記傳輸鏈',
    intro: '志工按溜了以後，上面一排在幾秒內完成，志工就看到「登記完成」；寫回試算表在背景進行，失敗了由寫回重試接手。',
    cols: 4, rows: 4,
    nodes: [
      { id: 'phone', title: '手機送出', kind: '1・志工', col: 0, row: 0, detail: {
        role: '志工按溜了。手機先存好這次的識別（requestId），再送出。',
        data: '識別存在手機；查明結果才清。',
        trigger: '按溜了、復原、改溜狗人。',
        failure: '沒回應：用同一個識別重送；過了午夜改成查這次的結果，不會變成另一筆。',
        code: 'public/js/walk-registration.js' } },
      { id: 'check', title: '檢查', kind: '2・志工網站 Worker', col: 1, row: 0, live: 'lastWalk', detail: {
        role: '檢查格式、操作日期是不是今天（台灣時間）、志工身分。',
        data: '同一個識別送過：直接回上次的結果；內容不同回 409。',
        trigger: '收到登記。',
        failure: '太頻繁回 429；格式不對回 400。手機會保留識別，可以再送。',
        code: 'worker/src/index.js 的 writeWalks、worker/src/walk-accept.js 的 acceptWalk' } },
      { id: 'tx', title: 'D1 交易', kind: '3・D1', col: 2, row: 0, live: 'budget', detail: {
        role: '今日溜狗紀錄、等著寫回的工作、這次的識別、溜狗紀錄、修改紀錄，同一個交易一起寫。',
        data: '版本不對就整批不寫，重讀再試（最多 8 次）。',
        trigger: '檢查通過。',
        failure: '寫入預算不夠：整批不寫，回 503，登記沒有成立。',
        code: 'worker/src/walk-accept.js 的 acceptWalk' } },
      { id: 'reply', title: '登記完成', kind: '4・回到手機', col: 3, row: 0, detail: {
        role: '手機收到結果，畫面換成 D1 的最新紀錄。',
        data: '這時候試算表多半還沒寫好（syncStatus 是 pending）。',
        trigger: 'D1 交易成功。',
        failure: '有人先改了：回 409 和目前紀錄，請志工先確認。',
        code: 'public/js/walk-registration.js' } },
      { id: 'dispatch', title: '派送', kind: '5・背景', col: 2, row: 1, detail: {
        role: '從等著寫回的工作拿出這隻，記下派送識別，交給 Apps Script。',
        data: '同一隻同時只有一個派送識別；舊的版本會被新登記蓋掉，只寫最新的。',
        trigger: '回應送出後在背景馬上做；之後由寫回重試補。',
        failure: '寫入預算不夠或 D1 出錯就停下，留給下一輪。',
        code: 'worker/src/walk-accept.js 的 dispatchWalks' } },
      { id: 'target', title: '拿目標', kind: '6・Apps Script', col: 3, row: 1, detail: {
        role: 'Apps Script 拿鎖、讀這隻狗目前在表上的值，問網站要寫什麼。',
        data: '網站核對表上的值：跟上次寫的一樣才給目標；不一樣就先當成人工修改比對。',
        trigger: '收到派送。',
        failure: '志工網站等 20 秒沒回應就放棄，但 Apps Script 可能還在寫；結果靠第 9 步的回報確認，不會重複寫。',
        code: 'apps-script/sheet-write.gs 的 writeLatestWalk' } },
      { id: 'reread', title: '寫前再讀', kind: '7・Apps Script', col: 3, row: 2, detail: {
        role: '人工改表不受 Apps Script 的鎖限制，所以寫之前再讀一次。',
        data: '值沒變才寫；變了就停寫，把新值交給網站比對。',
        trigger: '拿到目標。',
        failure: '有人剛改過：停寫，這隻記成不一致。',
        code: 'apps-script/sheet-write.gs 的 writeLatestWalk' } },
      { id: 'stop', title: '停寫、留待比對', kind: '有人剛改過表', col: 3, row: 3, live: 'conflicts', detail: {
        role: '不覆蓋人工修改。網站記下這隻不一致，等之後收下人工的值。',
        data: '下一次改表通知或保險掃描讀到可信的值，就收下並清掉不一致。',
        trigger: '寫前再讀發現值變了，或表上的值無法判斷是誰寫的。',
        failure: '一直不一致的狗留在清單上，燈號會亮橘。',
        code: 'worker/src/walk-accept.js 的 reconcileWalk' } },
      { id: 'write', title: '寫兩欄、讀回', kind: '8・試算表', col: 2, row: 2, detail: {
        role: '寫主清單「遛狗日期」「誰遛的」，馬上讀回比對。',
        data: '只寫這兩欄，其他欄、其他分頁都不動。',
        trigger: '寫前再讀沒變。',
        failure: '讀回跟目標不一樣：這次算失敗，交給寫回重試。',
        code: 'apps-script/sheet-write.gs 的 writeLatestWalk' } },
      { id: 'receipt', title: '回報、寫回完成', kind: '9・志工網站 Worker', col: 1, row: 2, live: 'writeback', detail: {
        role: 'Apps Script 把讀回的值回報給網站，網站核對後把這隻標成寫回完成。',
        data: '回報跟派送是同一個派送識別才算；舊的回報不會把新版本標成完成。',
        trigger: '讀回一樣。',
        failure: '回報沒送到：這隻維持未完成，寫回重試會再派送一次，Apps Script 讀到表上已經一樣就直接回報。',
        code: 'worker/src/walk-accept.js 的 confirmWalk' } },
      { id: 'retry', title: '寫回重試', kind: '排程・每 10 分鐘', col: 1, row: 1, live: 'cron:retry', detail: {
        role: '派送沒回應、被拒絕、讀回不符、中斷的，到期後再派送。',
        data: '只處理還沒完成的；一輪最多 10 隻。',
        trigger: '志工網站 Worker 排程，每 10 分鐘（錯開 5 分）。',
        failure: '隔 1、2、4、8、15 分鐘再試，一直試到成功，不會放棄。',
        code: 'worker/src/walk-retry.js' } },
    ],
    edges: [
      { from: ['phone', 'r'], to: ['check', 'l'], label: '送出' },
      { from: ['check', 'r'], to: ['tx', 'l'], label: '通過' },
      { from: ['tx', 'r'], to: ['reply', 'l'], label: 'D1 收下' },
      { from: ['tx', 'b'], to: ['dispatch', 't'], label: '背景' },
      { from: ['dispatch', 'r'], to: ['target', 'l'], label: '派送' },
      { from: ['target', 'b'], to: ['reread', 't'], label: '拿到目標' },
      { from: ['reread', 'b'], to: ['stop', 't'], label: '值變了', back: true },
      { from: ['reread', 'l'], to: ['write', 'r'], label: '值沒變' },
      { from: ['write', 'l'], to: ['receipt', 'r'], label: '讀回一樣' },
      { from: ['dispatch', 'l', -12], to: ['retry', 'r', -12], label: '失敗', back: true },
      { from: ['retry', 'r', 12], to: ['dispatch', 'l', 12], label: '再派送', cron: true },
    ],
  },
};

const OPEN_LABEL = { pending: '等待派送', dispatching: '派送中', retry: '等待重試', unconfirmed: '結果不明' };
const STUCK_MS = 15 * 60000; // 到期超過 15 分鐘還沒被派送：寫回重試應該每 10 分鐘接手一次
const SCAN_STALE_MS = 24 * 3600000;
const LEVELS = ['ok', 'warn', 'bad', 'info', 'none'];
const time = v => v === null || (typeof v === 'string' && !isNaN(Date.parse(v)));
const count = v => Number.isInteger(v) && v >= 0;

export function parseFlowStatus(data) {
  const ok = data && typeof data === 'object' && time(data.readAt) && data.readAt
    && data.writeback && count(data.writeback.total) && Array.isArray(data.writeback.items)
    && data.writeback.items.every(i => i && typeof i.name === 'string' && typeof i.number === 'string' && OPEN_LABEL[i.status] && typeof i.error === 'string' && time(i.nextAt))
    && count(data.conflicts) && count(data.delivering)
    && data.budget && count(data.budget.reserved) && count(data.budget.limit) && data.budget.limit > 0
    && time(data.lastWalkAt) && time(data.dogListChangedAt)
    && (data.dogListScan === null || (data.dogListScan && time(data.dogListScan.checkedAt) && count(data.dogListScan.extra)))
    && Array.isArray(data.cron) && data.cron.every(j => j && CRON_LABELS[j.job] && ['ok', 'never', 'error'].includes(j.state));
  if (!ok) throw Error('資料流狀態格式不正確');
  return data;
}

const dogText = i => `${i.name}（${i.number || '無編號'}）`;

// 燈號：level 是 ok 綠、warn 橘、bad 紅、info 只是資訊、none 還沒有紀錄；text 一行寫在節點上，lines 寫在右側詳細。
export function liveStatus(key, s, now = Date.now()) {
  if (key === 'writeback') {
    const { total, items } = s.writeback;
    const lines = [
      ...items.map(i => `${dogText(i)}：${OPEN_LABEL[i.status]}${i.error ? `・${i.error}` : ''}`),
      ...(total > items.length ? [`還有 ${total - items.length} 隻沒列出`] : []),
    ];
    if (!total) return { level: 'ok', text: '沒有等著寫回的狗', lines: ['網站登記的都已經寫回試算表。'] };
    const rejected = items.filter(i => i.error.startsWith('writeback-rejected')).length;
    const stuck = items.filter(i => now - Date.parse(i.nextAt) > STUCK_MS).length;
    if (rejected) return { level: 'bad', text: `${rejected} 隻被試算表拒絕`, lines };
    if (stuck) return { level: 'warn', text: `${stuck} 隻超過 15 分鐘還沒寫回`, lines };
    return { level: 'ok', text: `${total} 隻正在寫回`, lines };
  }
  if (key === 'budget') {
    const { reserved, limit } = s.budget, pct = Math.round(reserved / limit * 100);
    const text = `今天寫入預算 ${pct}%`;
    const lines = [`今天已預留 ${reserved.toLocaleString('en-US')}／${limit.toLocaleString('en-US')}（台灣每天 08:00 換日）。`];
    return { level: pct >= 80 ? 'bad' : pct >= 50 ? 'warn' : 'ok', text, lines };
  }
  if (key === 'conflicts') {
    const lines = [s.dogListChangedAt ? `最後一次收到改表、狗清單有變：${when(s.dogListChangedAt)}` : '還沒有收到改表的紀錄'];
    return s.conflicts ? { level: 'warn', text: `${s.conflicts} 隻跟網站不一致`, lines: [`${s.conflicts} 隻留待比對，等改表通知或保險掃描收下人工的值。`, ...lines] }
      : { level: 'ok', text: '沒有不一致', lines };
  }
  if (key === 'lastWalk') return s.lastWalkAt ? { level: 'info', text: `最近登記 ${when(s.lastWalkAt)}`, lines: [] }
    : { level: 'none', text: '還沒有網站登記', lines: [] };
  if (key === 'dogListScan') {
    const scan = s.dogListScan;
    if (!scan || !scan.checkedAt) return { level: 'none', text: '還沒有掃描紀錄', lines: [] };
    const lines = [`D1 有、試算表沒有：${scan.extra} 筆（待補清單看得到是哪幾隻）。`];
    if (now - Date.parse(scan.checkedAt) > SCAN_STALE_MS) return { level: 'bad', text: '超過一天沒有掃描', lines: [`最後掃描 ${when(scan.checkedAt)}。`, ...lines] };
    return { level: scan.extra ? 'warn' : 'ok', text: `${when(scan.checkedAt)} 掃描完`, lines };
  }
  if (key.startsWith('cron:')) {
    const job = s.cron.find(j => j.job === key.slice(5));
    if (!job) return { level: 'none', text: '還沒有紀錄', lines: [] };
    const c = cronStatus(job);
    const lines = [`最後跑完：${c.last}`, `狀況：${c.problem}`];
    if (job.state === 'never') return { level: 'none', text: '還沒有紀錄', lines };
    if (c.bad) return { level: 'bad', text: job.state === 'error' ? '紀錄讀不懂' : '需要注意', lines };
    return { level: 'ok', text: `${when(job.okAt)} 跑完`, lines };
  }
  return { level: 'none', text: '', lines: [] };
}

export const LEVEL_TEXT = { ok: '正常', warn: '注意', bad: '有問題', info: '資訊', none: '沒有紀錄', unknown: '讀不到' };
export { LEVELS };

// 一個節點連到哪些節點（右側詳細列出，選取時亮起這幾條線）
export function edgesOf(view, id) {
  return VIEWS[view].edges.filter(e => e.from[0] === id || e.to[0] === id);
}
export function nodeOf(view, id) {
  return VIEWS[view].nodes.find(n => n.id === id) || null;
}
