# 保險掃描清掉舊指紋（#528）

- 日期：2026-10-24。Agent：Claude。分支 `claude/528-stale-fingerprint`。
- 問題：`dogListScan` 每次警告 `departed:2018052305`（MINI）、`departed:2021083002`（栗子）、`departed:2026102401`（TEST）「D1 有、試算表沒有」。前兩隻回所在主清單上，#522 起 GAS 不送牠們的已出所單位，但 `dog_list_fp` 是 #522 前建的；TEST 的離所紀錄已清，指紋沒清。
- 改法（`worker/src/dog-list.js` 的 `scanDogList`）：指紋有、這次沒送的單位裡，`departed:X` 而 `main:X` 有送的，或 D1（`v3_sheet_main`／`v3_departures`）已經沒有這隻狗的，只刪那筆指紋、不列為 extra。不刪任何狗的資料。
- 測試：`worker/test/dog-list.test.mjs` 的 #528。
- 上線後：下一次 `dogListScan` 應不再出現這三筆警告，待 K 確認。
