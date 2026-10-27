// 介紹搬家核對表（#665，ADR 0022）：唯讀正式 D1 → .scratch/intro-split/checklist.csv（K 用 Excel 逐列勾）＋ snapshot.json。
// 核對表含捕獲地址等原文：只放 .scratch（.gitignore），不 commit、不貼 GitHub。摘要只印狗名。
// 用法：node scripts/intro-split/checklist.mjs [--out .scratch/intro-split]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSnapshot } from './snapshot.mjs';
import { suggestRows, needsLook, KINDS, NEW_STAY, chars } from './suggest.mjs';
import { toCsv } from './csv.mjs';
import { STAY_REASON_MAX } from '../../worker/src/stays.js';

export const DEFAULT_DIR = fileURLToPath(new URL('../../.scratch/intro-split/', import.meta.url));

// 有介紹、離所時的介紹或入所事件的狗才列
export function checklistRows(snapshot) {
  const dogs = snapshot.dogs.filter(d => d.intro || d.departures.some(p => p.lastIntro) || d.events.length)
    .sort((a, b) => Number(b.onMain) - Number(a.onMain) || (a.mainNumber || a.numbers.at(-1) || '').localeCompare(b.mainNumber || b.numbers.at(-1) || ''));
  return dogs.flatMap(dog => suggestRows(dog).map((r, i) => ({
    狗名: r.name, dog_id: r.dogId, 在所: r.place, 項目: r.kind, 放哪一筆: r.target, 入所日: r.in, 出所日: r.out,
    介紹原文: i === 0 || r.kind === KINDS.lastIntro ? r.original : '', 現有的值: r.current, 建議值: r.suggest, 建議字數: chars(r.suggest),
    注意: r.note, K勾選: '', K改成: '',
  })));
}

export function summary(rows) {
  const dogs = new Set(rows.map(r => r.dog_id));
  const count = f => rows.filter(f).length;
  const names = f => [...new Set(rows.filter(f).map(r => r.狗名))];
  const reason = r => r.項目 === KINDS.reason;
  return {
    dogs: dogs.size,
    rows: rows.length,
    byKind: Object.fromEntries(Object.values(KINDS).map(k => [k, count(r => r.項目 === k)])),
    reasonOnNumber: count(r => reason(r) && r.放哪一筆 !== NEW_STAY),
    reasonNewStay: count(r => reason(r) && r.放哪一筆 === NEW_STAY),
    needsLook: count(r => needsLook({ note: r.注意 })),
    tooLong: names(r => r.建議字數 > STAY_REASON_MAX && r.項目 !== KINDS.intro && r.項目 !== KINDS.lastIntro),
    addressRemoved: names(r => r.dog_id && rows.some(x => x.dog_id === r.dog_id && /捕獲地址|拾獲地點/.test(x.介紹原文))),
    mismatched: names(r => /對不上|不完整/.test(r.注意)),
    nearTypo: names(r => /差一點/.test(r.注意)),
    multi: names(r => /好幾件事|入所和退回/.test(r.注意)),
    replay: names(r => /舊資料重放|推測/.test(r.注意)),
    keptManual: names(r => /已手填/.test(r.注意)),
    events: names(r => /入所事件/.test(r.注意)),
    lastIntroDiffers: names(r => /不一樣/.test(r.注意)),
    introLeft: names(r => r.項目 === KINDS.intro && r.建議值),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf('--out');
  const dir = at > 0 ? process.argv[at + 1] : DEFAULT_DIR;
  mkdirSync(dir, { recursive: true });
  const snapshot = readSnapshot();
  const rows = checklistRows(snapshot);
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(snapshot, null, 1));
  writeFileSync(join(dir, 'checklist.csv'), toCsv(rows));
  console.log(JSON.stringify(summary(rows), null, 1));
  console.log(`寫好 ${join(dir, 'checklist.csv')}（含原文地址，不要 commit、不要貼 GitHub）`);
}
