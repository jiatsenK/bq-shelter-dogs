# 2026-10-30 同籠自動合併（#773）

- Agent：Claude Code（Opus 5.5），分支 `claude/issue-773-auto-merge`
- 依據：#773（母票 #768），阻擋 #771（PR #779，ADR 0025 與兩份研究文件）已合併；#772、#774 由其他 session 同時處理

## 做了什麼

- `worker/src/dog-list.js`：要新建狗時找同籠候選（`sameCageCandidate`：同籠位、這次清單不在表上、非暫住，剛好一隻），建新狗後呼叫 `autoMergeDogs`；一次請求只合併一隻，第二隻那列不 ack、候選這次不確認。沒編號的括號暫用名不再用溜狗紀錄的名字找回舊狗。補編號時編號已經屬於同一隻（清掉編號又打回，中間被自動合併）就照補編號處理。
- `worker/src/dog-merge.js`：抽出 `writeMerge`，新增系統入口 `autoMergeDogs`（不需 Access 身分、同一批移出主清單、紀錄種類 `automerge`、操作者「系統自動判斷」、來源 `sheet`，回傳留下那隻的新版本）。兩隻狗的各表讀取改成一個 batch（只算 1 次查詢）。取消合併也認 `automerge`。自動合併時留下那隻是剛建的狗，候選的主照片照舊當主照片。
- `worker/src/editlog.js`：種類「系統自動合併」，跟合併狗一樣永久保留。管理網站修改紀錄的取消合併按鈕、`public/js/edit-values.js` 的文字也認 `automerge`。
- 測試：新增 `worker/test/sheet-automerge.test.mjs`（直接改名、先清空再打、一次貼名字和編號、清掉編號再打回、改名同時換籠、同籠兩個候選、取消合併、下一隻 `(乳白)`、版本變了、D1 查詢次數）。
- 文件：ADR 0025「後面的票」同籠規則補上實作的技術選擇，ARCHITECTURE_NOW、dog-editing.md、GLOSSARY「合併狗」。

## 例外與要注意的

- 跟 #772（PR #781）同步：暫住列改存在 `v3_sheet_stays`，不在主清單複本上，本來就不會被當候選；複本上還留著的上線轉換前舊暫住列，用 #772 的 `stayTarget` 排除（拿掉原本自寫的 `isStayRow`）。補了「同籠暫住列也剛刪掉，(乳白) 照樣自動合併」的測試。
- 跟 #774（PR #782）同步：#774 的「已合併」配對寫入放在合併模組的同一批，搬到 `writeMerge` 後自動合併也會帶到。自動合併在候選確認前就併掉，不會產生「可能是同一隻」配對；新建狗那一批照 #774 一起寫同籠的 `newDogPairs`。
- D1 查詢次數照官方文件數往返（`db.batch()` 整批算 1 次）；#771 的測試數句數比較保守，自動合併的 batch 句數多，所以新測試用往返次數。
- 擁有者要做：部署志工 Worker 與管理網站（取消合併按鈕認新種類）；沒有 migration，Apps Script 不用重新部署。

## 審查與測試

- code-review 技能兩軸審查（基準 `ee7b4ef8`）：
  - Standards：`SCAN_OK` 的理由補上自動合併的觸發頻率；可取消的合併種類在 `dog-merge.js` 收成兩個常數；`looksWrong` 改名 `looksLikeWrongSheet`；`writeMerge` 的 `before／after` 改成 `prepend／append`（跟紀錄的改前改後撞名）。沒改：`list／fp／merge` 一起傳（跟既有 `applyMain` 的參數寫法一致）、前端兩處 `kind` 判斷（共用檔是建置複製，worker 的清單拿不到）。
  - Spec：同一批裡有編號的狗搬到已出所、同籠又打上新狗時，會把要離所的那隻當候選併掉、離所紀錄沒寫。改成這次一起送來的已出所編號不算候選，補測試。合併失敗不是 409 時記成錯誤。沒改：自動合併保留主照片（為了「照片接著用」，ADR 已記）、一次請求只合併一隻、`rowsOf` 改 batch 也影響管理者合併（只少查詢次數，結果一樣）。

## 相關 PR

- https://github.com/jiatsenK/bq-shelter-dogs/pull/780
