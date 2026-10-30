// #775 系統自動判斷（ADR 0025）的純規則：資料頁「系統自動判斷」列表與編輯抽屜一筆寫一句。
// 紀錄就是修改紀錄（/api/manage/edits?kind=judge），種類見 worker/src/editlog.js JUDGE_KINDS；改前／改後的樣子見各寫入處。
import { editQuery } from './edit-log.js';

// 管理 API 的類別值（worker/src/admin/edits.js）；資料頁也拿它當「系統自動判斷」按鈕的狀態
export const JUDGE = 'judge';
export const judgeQuery = ({ dog = '', cursor = null, size = 25 } = {}) => editQuery({ kind: JUDGE, dog, cursor, size });
const dog = (name, number) => `${name || '未命名'}${number ? ` ${number}` : ''}`;
const at = cage => (cage ? `${cage} ` : '');
export function judgementText(e) {
  const b = e.before || {}, a = e.after || {};
  // 自動合併：改前＝候選那一列（#775 起記籠位），改後＝新建的那隻
  if (e.kind === 'automerge') return `${at(b.cage)}${b.name || '未命名'} 改成 ${dog(a.name, a.number)}，判斷為同一隻，已合併`;
  // 暫住：紀錄掛在暫住的那隻狗身上，名字是牠現在的名字
  if (e.kind === 'stay-start') return `${at(a.cage)}出現 ${e.dogName || '未命名'} 的暫住列，判斷為暫住，不另建狗`;
  if (e.kind === 'stay-end') return `${at(b.cage)}${e.dogName || '未命名'} 的暫住列消失，暫住結束`;
  if (e.kind === 'pair') return `${at(b.cage)}${dog(b.name, b.number)} 消失，同籠有 ${dog(a.name, a.number)}，判斷可能是同一隻，等管理者確認`;
  if (e.kind === 'not_same') return `管理者確認 ${b.name || '未命名'} 跟 ${a.name || '未命名'}（${a.cage || '籠位不明'}）不是同一隻`;
  return e.kindLabel || e.kind;
}
