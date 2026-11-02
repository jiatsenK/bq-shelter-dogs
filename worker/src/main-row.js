// 主清單列認狗：依序判斷這列是哪隻狗，回傳判斷結果。
// 只讀資料，不寫入，也不改主清單複本、暫住紀錄或自動合併狀態。

export const rowKey = m => `main:${m.number || `名:${m.name}`}`;
export const findMain = (list, dog) => list.find(m => (dog.id ? m.number === dog.id : m.number === '' && m.name === dog.name));
// 暫住判斷（#772）：沒編號、犬名整個用括號包起來（半形全形混用都算）、括號裡去掉空白後跟主清單上一隻有編號的狗同名。
// 有編號的括號列一律是新狗。回傳那隻狗在主清單複本的列，不是暫住列回 null（migrations/0021 上線轉換用同一套判斷）
const STAY_NAME = /^[(（](.+)[)）]$/;
const bare = name => name.replace(/\s/g, '');
function stayTarget(dog, list) {
  const inner = !dog.id && STAY_NAME.exec(dog.name);
  return inner ? list.find(m => m.number && bare(m.name) === bare(inner[1])) || null : null;
}
// 括號暫用名（#773）：沒編號時不拿溜狗紀錄的名字找回舊狗
const bracketed = name => STAY_NAME.test(name);

// 同籠自動合併的候選（#773）：這個籠位不在表上（present 沒有）、非暫住的列剛好一隻才算；超過一隻或籠位不同就不猜。
// 暫住列存在暫住紀錄、不在主清單複本；複本上還有上線轉換前建成狗的舊暫住列，用 stayTarget 排除。
// present：GAS 讀表那一刻主清單的全部單位 key；沒送（舊版小程式）或看起來像讀錯表時是 null，不找。
// departing：這次一起送來的已出所編號。GAS 先送主清單的列，搬到已出所的狗這時還在主清單複本、不在表上，不能被當成候選併掉
function sameCageCandidate(list, cage, { present, departing }) {
  if (!present) return null;
  const found = list.filter(m => m.cage === cage && !present.has(rowKey(m)) && !departing.has(m.number) && !stayTarget({ id: m.number, name: m.name }, list));
  return found.length === 1 ? found[0] : null;
}

// 搬籠清舊列常先清編號、再清名字：中間那幾秒是同名、同備註、沒編號的列（2026-10-30 皮蛋舊A13，ADR 0025）。
// 同名同備註、有編號的那隻還在表上（present 有），這列就是牠搬走留下的，不另建一隻沒照片的狗。
// 有編號那列不在表上是清掉編號再打回（#773），照常建狗、同籠自動合併；備註空白不判斷，同名新狗照樣建
function leftBehind(dog, note, list, present) {
  if (dog.id || !note || !present) return false;
  return list.some(m => m.number && m.name === dog.name && m.note === note && present.has(rowKey(m)));
}

// 狗回所會拿新編號，沒人會在網站上連舊編號（K 2026-10-24）：離所紀錄裡剛好一筆同名、主清單上沒別的同名，就是同一隻。
// 認錯可在網站「舊編號」拆開（編輯紀錄記為系統自動）。同名多筆不猜，當新狗。
// 這句沒有索引可用（#807）：只有表上出現認不得的新編號才跑
async function returnedDog(db, dog, list) {
  if (list.some(m => m.name === dog.name)) return null;
  const found = (await db.prepare("SELECT d.number,d.dog_id,s.revision FROM v3_dog_departures d JOIN v3_dog_edit_state s USING(dog_id) WHERE name=? AND number<>'' LIMIT 2").bind(dog.name).all()).results;
  return found.length === 1 ? found[0] : null;
}

// 規則由上到下，第一條成立就回傳：
// 1. 沒犬名、沒籠位或表頭略過。
// 2. 沒編號且已有同名暫住紀錄，沿用暫住並交回要移除的舊列。
// 3. 找到暫住對象且主清單沒有這列，判為暫住。
// 4. 複本沒有這列，且是搬籠留下的舊列，先不收。
// 5. 主清單已有這列，沿用原列。
// 6. 有編號且主清單有同名沒編號的列，編號無人使用或屬於牠才補上。
// 7. 依編號或溜狗紀錄認得的狗，沿用身分。
// 8. 有編號且離所紀錄可認回所，沿用回所的狗。
// 9. 同籠有候選但這次已自動合併過，等下一次。
// 10. 其餘是新狗，交回同籠候選或 null。
export async function identifyRow(db, { dog, cage, note }, { list, stays, merge }) {
  // 犬隻資料列一定有犬名和籠位；表頭和表尾提示文字不算狗
  if (!dog.name || !cage || dog.name === '犬名') return { kind: 'skip' };
  // 已經是暫住紀錄的列照舊當暫住（那隻狗之後離開主清單也是）。上線轉換前就建成狗的舊暫住列（複本上有、沒有暫住紀錄）照一般列處理；
  // 兩邊都有（migration 0021 套完、新程式部署前，舊程式又建了一隻）就移出主清單複本，同一個 key 不送兩份，那隻假狗變待核對
  const onCopy = findMain(list, dog);
  if (!dog.id && stays.find(s => s.name === dog.name)) return { kind: 'stay', target: null, dropLegacy: onCopy || null };
  const target = stayTarget(dog, list);
  if (target && !onCopy) return { kind: 'stay', target, dropLegacy: null };
  if (!onCopy && leftBehind(dog, note, list, merge?.present)) return { kind: 'held' };
  if (onCopy) return { kind: 'listed', row: onCopy, fillNumber: false, numberOwned: false };
  // 新增狗常先打名字、後補編號：主清單上同名沒編號的那隻就是牠，補上編號，不另建一隻（2026-10-24 驗收時多出一隻沒編號的 TEST）
  const unnumbered = dog.id && list.find(m => m.number === '' && m.name === dog.name);
  // 編號已經是這隻的（清掉編號又打回，中間被同籠自動合併併回來，#773）也一樣，只是不再記一次編號
  const owner = unnumbered && await db.prepare('SELECT dog_id FROM v3_dog_numbers WHERE number=?').bind(dog.id).first('dog_id');
  if (unnumbered && (!owner || owner === unnumbered.dog_id)) return { kind: 'listed', row: unnumbered, fillNumber: true, numberOwned: Boolean(owner) };
  // 沒編號的括號暫用名不拿溜狗紀錄的名字找回舊狗：顏色暫用名會重複用，下一隻 `(乳白)` 不是上一隻（#773）
  const identified=dog.id?await db.prepare('SELECT n.dog_id,s.revision FROM v3_dog_numbers n JOIN v3_dog_edit_state s USING(dog_id) WHERE number=?').bind(dog.id).first():bracketed(dog.name)?null:await db.prepare("SELECT w.dog_id,s.revision FROM v3_walks w JOIN v3_dog_edit_state s USING(dog_id) WHERE dog_number='' AND dog_name=? LIMIT 1").bind(dog.name).first();
  if (identified) return { kind: 'known', dog: identified };
  const returned = dog.id && await returnedDog(db, dog, list);
  if (returned) return { kind: 'returned', dog: returned };
  const candidate = merge && sameCageCandidate(list, cage, merge);
  // 一次請求只自動合併一隻（每次呼叫 50 次查詢）；第二隻不建狗、不 ack，GAS 補送時再來，候選這次也先不確認
  if (candidate && merge.done) return { kind: 'wait', candidate };
  return { kind: 'new', candidate: candidate || null };
}
