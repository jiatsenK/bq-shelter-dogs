// 合併狗的純規則（K 2026-10-26）：誰留下、候選順序、預覽文字、待補清單的「可能重複」。畫面在 dog-editor.js／checks.js／updates.js。
import { STATUS_LABELS, shownNumber } from './dog-table.js';
import { countsText } from '../shared/edit-values.js';

// 比名字：去掉全形／半形括號（暫時籠位寫成「(狗名)」）與空白，英文不分大小寫
export const nameKey = name => String(name || '').replace(/[()（）\s]/g, '').toLowerCase();
const label = dog => `${dog.name || '未命名'} ${shownNumber(dog) || '無編號'}（${STATUS_LABELS[dog.status]}）`;

// 主清單上的狗由試算表管，只能當留下的那隻；兩隻都不在主清單時留下對方（正在編輯的這隻被併掉）
export function mergeSides(dog, other) {
  if (dog.status === 'main' && other.status === 'main') return null;
  return dog.status === 'main' ? { target: dog, source: other } : { target: other, source: dog };
}
// 候選：能跟這隻合併的狗；同名的排最前，再來在所，再照名字
export function mergeCandidates(dog, dogs) {
  const key = nameKey(dog.name);
  return dogs.filter(d => d.dogId !== dog.dogId && mergeSides(dog, d))
    .map(d => ({ dog: d, same: Boolean(key) && nameKey(d.name) === key }))
    .sort((a, b) => b.same - a.same || (b.dog.status === 'main') - (a.dog.status === 'main') || a.dog.name.localeCompare(b.dog.name, 'zh-Hant') || a.dog.dogId.localeCompare(b.dog.dogId))
    .map(({ dog: d, same }) => ({ dogId: d.dogId, text: `${same ? '同名：' : ''}${label(d)}`, same }));
}
export function mergePreviewText(p) {
  const dog = d => `${d.name || '未命名'} ${d.number || '無編號'}`;
  return [
    `留下：${dog(p.target)}`,
    `併掉：${dog(p.source)}（合併後從狗資料刪掉，修改紀錄可取消合併）`,
    `搬到留下那隻：${countsText(p.moved) || '沒有資料'}`,
    ...(Object.keys(p.kept || {}).length ? [`兩邊都有、留「留下那隻」的：${countsText(p.kept)}`] : []),
    // 只留一份的內容：被併那隻的版本不會出現在網站上（快照裡還有，取消合併拿得回來）
    ...Object.entries(p.lost || {}).map(([label, value]) => `不採用被併那隻的${label}：${value}`),
  ].join('\n');
}
// #774 可能是同一隻：系統在試算表列消失時配的組（/api/manage/dog-pairs），依待核對那隻分組
const HEX = /^[a-f0-9]{32}$/;
export function parsePairs(data) {
  if (!data || !Array.isArray(data.pairs) || !Number.isSafeInteger(data.count)) throw Error('配對資料格式不正確');
  const byGone = new Map();
  for (const p of data.pairs) {
    if (!p || !HEX.test(p.goneDogId) || !HEX.test(p.dogId) || ['name', 'number', 'cage'].some(k => typeof p[k] !== 'string')) throw Error('配對資料格式不正確');
    byGone.set(p.goneDogId, [...(byGone.get(p.goneDogId) || []), p]);
  }
  return { count: data.count, byGone };
}
export const pairText = p => `可能跟 ${p.name || '未命名'}（${p.cage || '籠位不明'}）是同一隻`;
// 待補清單：名字一樣、一隻在所一隻不在所的配對（#621 改編號多出來的狗多半長這樣）
export function possibleDuplicates(dogs) {
  const byName = new Map();
  for (const d of dogs) {
    const key = nameKey(d.name);
    if (key) byName.set(key, [...(byName.get(key) || []), d]);
  }
  const pairs = [];
  for (const group of byName.values()) {
    const kept = group.filter(d => d.status === 'main');
    for (const extra of group.filter(d => d.status !== 'main')) for (const main of kept) pairs.push({ main, extra });
  }
  return pairs.sort((a, b) => a.main.name.localeCompare(b.main.name, 'zh-Hant'));
}
