// 介紹搬家核對表（#665，ADR 0022）：唯讀正式 D1 → .scratch/intro-split/checklist.csv（K 用 Excel 逐列看）＋ snapshot.json。
// 一列＝搬完後的一筆出入所紀錄，同一隻狗排在一起；K 只核對出入所紀錄，介紹搬完會清空（之後另寫狗自己的介紹）。
// 核對表含捕獲地址等原文：只放 .scratch（.gitignore），不 commit、不貼 GitHub。摘要只印狗名。
// 用法：node scripts/intro-split/checklist.mjs [--out .scratch/intro-split]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSnapshot } from './snapshot.mjs';
import { suggestDog } from './suggest.mjs';
import { toCsv, ID_COLUMN, NO_NUMBER } from './csv.mjs';

export const DEFAULT_DIR = fileURLToPath(new URL('../../.scratch/intro-split/', import.meta.url));

// 有介紹、離所時的介紹或入所事件的狗才列；在所的在前、離所的在後，再照狗名排
export const listedDogs = snapshot => snapshot.dogs.filter(d => d.intro || d.departures.some(p => p.lastIntro) || d.events.length)
  .sort((a, b) => Number(b.onMain) - Number(a.onMain) || a.name.localeCompare(b.name, 'zh-Hant') || a.dogId.localeCompare(b.dogId));

export function checklistRows(snapshot) {
  return listedDogs(snapshot).flatMap(dog => {
    const { records, notes } = suggestDog(dog);
    return records.map((r, i) => ({
      狗名: dog.name,
      原本的介紹: i === 0 ? dog.intro || '' : '',
      編號: r.number || NO_NUMBER,
      入所日: r.in,
      入所原因: r.reason,
      出所日: r.out,
      離所原因: r.departed ? r.departure : r.outReason || '',
      說明: [...(i === 0 ? notes : []), ...r.notes].join('；'),
      對嗎: '', 改成的入所原因: '', 改成的離所原因: '',
      [ID_COLUMN]: dog.dogId,
    }));
  });
}

export function summary(rows) {
  const names = f => [...new Set(rows.filter(f).map(r => r.狗名))];
  const look = re => names(r => re.test(r.說明));
  return {
    dogs: new Set(rows.map(r => r[ID_COLUMN])).size,
    rows: rows.length,
    noNumber: rows.filter(r => r.編號 === NO_NUMBER).length,
    withNote: rows.filter(r => r.說明).length,
    tooLong: look(/超過 40 字/),
    addressRemoved: look(/拿掉了(捕獲|拾獲)/),
    mismatched: look(/沒有這天的編號|請填入所日/),
    nearTypo: look(/可能打錯/),
    multi: look(/好幾件事|入所和退回/),
    moved: look(/改放到離所原因|推測/),
    keptManual: look(/先保留/),
    events: look(/入所事件/),
    lastIntroDiffers: look(/離所時存的介紹不一樣/),
    introLeft: look(/介紹還會留下/),
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
