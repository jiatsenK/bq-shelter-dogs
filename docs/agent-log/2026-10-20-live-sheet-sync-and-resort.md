# 2026-10-20 不管在哪裡改都同步、只有自己按的狗留原地

- Agent：Claude Code（Opus 5.5）
- 分支：`fix/live-sheet-sync-and-resort`
- 依據：K 2026-10-20 回報——按「更新」不重排；別人溜的狗（中興溜了黑寶、MINI）手機上不同步、還顯示自己的名字。K 決定：不管在網站按還是直接改試算表都要同步，1 分鐘內；只有自己按的狗留原地。

## 做了什麼

- Worker `/walkers`：快取 5 分鐘 → 1 分鐘；多回 `dates`（遛狗日期）、`readAt`；`v3_volunteers` 名單沒變時 30 分鐘才寫一次。
- `walk-registration.js` `receiveNames`：名單帶日期一起換；比名單新的紀錄不被蓋掉；本機「今天我溜了」但試算表今天是別人 → 清掉本機紀錄。
- `app.js`：每分鐘跟今日紀錄一起重讀名單；狗卡日期以試算表為準；排序只固定這支手機按過的狗；「更新」一定重抓並重排（不等回應）。
- 測試：`tests/startup-stability.cjs` 兩個斷言照新決定改；新增 walk-state、worker 測試。
- 文件：ADR 0007 補充、`DESIGN_GUIDE.md` 排序規則。

## 未完成

- 正式環境要部署後才生效；手機上實際看需 K 驗收。
