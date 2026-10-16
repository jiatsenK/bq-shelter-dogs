# 2026-10-16 D1 寫入額度爆掉：追問修正方向

- Agent：Claude Code（Opus 5.5）
- 分支：prototype/worker-sync（只改 GLOSSARY，未 commit）
- 依據：#301、`docs/agent-log/2026-10-16-prototype-worker-sync.md`，K 在追問中的決定

## 做了什麼

- `GLOSSARY.md`：「溜了」補上口語「登記」；新增「差異同步」「寫入預算」。

## K 的決定

- 不做止血（排程放慢、推程式不觸發、限制按更新），直接修同步：GitHub Action 改成差異同步。
- 兩套排程（Worker :00/:30、GitHub :17/:47）先保留，差異同步後次數不再是問題。
- 異常偵測：同步寫入前先算要寫幾列；單次超過固定門檻、或當天累計超過額度 20% → 這次不寫、D1 保留上一次內容、Action 失敗。門檻數字等量到正常寫入量後再訂。
- 通知：K 在手機 GitHub App 開 Actions 失敗推播；失敗原因寫在 Job Summary。
- 要寫 ADR：同步只寫差異、每天寫入預算與異常停寫。

## 未完成

- 差異同步搬進 Action、測試（試算表沒變寫 0 列）、ADR，都還沒做。
- 注意：ADR 0007 今日溜狗紀錄上線後，溜了也會寫 D1，要算進寫入預算。
