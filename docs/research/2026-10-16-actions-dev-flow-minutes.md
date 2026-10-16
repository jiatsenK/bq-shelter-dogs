# 開發流程怎麼再省 GitHub Actions 分鐘數

日期：2026-10-16（研究紀錄，只查不改程式）
相關：#329、PR #332（分支 `claude/issue-329-actions-minutes`）、`.github/workflows/`

## 結論

**建議組合：PR 先開草稿（draft）、草稿不跑測試與同步預演；PR 預覽改成加 `preview` 標籤才跑。** 估計本 repo 從約 1,685 分鐘／月降到約 950 分鐘／月，帳號合計約 1,550，低於 2,000（推估，算法見第 6 節）。

- `cancel-in-progress` 幾乎省不到：被取消的 job 已經跑的時間照算、且照樣進位到整分鐘；我們的 job 本來就 1 分鐘內。
- 合併佇列（merge queue）不能用：個人帳號的私人 repo 不支援。
- 自架 runner 不計分鐘，但要一台一直開著的電腦，留作最後手段。
- 不建議快取 Playwright 瀏覽器：官方說還原時間跟下載差不多，而且省的是秒、不是分鐘。

## 1. 計費規則（先弄清楚怎麼算）

- 私人 repo 用 GitHub 託管 runner 才計費；公開 repo、自架 runner 免費。來源：<https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions>
- **每個 job 各自無條件進位到整分鐘**（文件原意：job 的執行時間會進位到最接近的整分鐘）。所以 3 個各跑 10 秒的 job ＝ 3 分鐘，合成 1 個 job ＝ 1 分鐘。來源同上。
- 作業系統倍數：Linux 1 倍、Windows 2 倍、macOS 10 倍。本 repo 全用 `ubuntu-latest`，維持 Linux。來源同上。
- 免費方案每月 2,000 分鐘，帳號底下所有私人 repo 共用。來源：<https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions#included-storage-and-minutes>
- 因為每個 job 都 1 分鐘內，**省分鐘＝少跑幾個 job**，把 job 變快沒用。

## 2. PR 推好幾次只測最後一次（concurrency cancel-in-progress）

- 寫法：`concurrency: { group: tests-${{ github.ref }}, cancel-in-progress: true }`。同一組新 run 進來時，取消正在跑的舊 run。來源：<https://docs.github.com/en/actions/using-jobs/using-concurrency>
- 計費：被取消的 job 一樣按已執行時間計，並進位到整分鐘；還在排隊、沒開始跑的 job 不計（計費以 runner 實際執行 job 的時間為準，見第 1 節來源）。
- 對本 repo：一次推送後 job 1 分鐘內就跑完，兩次推送通常間隔更久，舊 run 早就結束，取消不到。**預估省 0～5%**。現在各 workflow 已有 `concurrency` group，可加 `cancel-in-progress: true`，成本為零但效果小。
- 注意：部署（`deploy-cloudflare`）、同步（`sync-sheet`）不要加取消，否則可能部署或寫入到一半被中斷；維持現在的排隊行為。

## 3. 草稿 PR 不跑

- `pull_request` 預設只觸發 `opened`、`synchronize`、`reopened`，**不含 `ready_for_review`**，要自己加，不然草稿轉正式時不會跑。來源：<https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#pull_request>
- 寫法：

  ```yaml
  on:
    pull_request:
      types: [opened, synchronize, reopened, ready_for_review]
  jobs:
    test:
      if: ${{ !github.event.pull_request.draft }}
  ```

  `github.event.pull_request.draft` 是 webhook 內容裡的欄位。來源：<https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request>
- 限制：
  - 被 `if` 跳過的 job 會顯示「Skipped」，不計分鐘；但 workflow run 本身仍會建立（只是不佔 runner）。來源：<https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#jobsjob_idif>
  - 若之後設了「必要檢查」，被跳過的 job 會被當成成功；本 repo 沒有分支保護（見第 5 節），不受影響。
  - 要真的省，**agent 開 PR 時要開草稿、最後一次推送後才轉正式**（`gh pr create --draft`、`gh pr ready`）。轉正式後再推，照樣每次都跑。這要寫進 `docs/rules/workflow.md` 或 agent 指示，否則白改。
  - 有 `paths` 篩選時，`ready_for_review` 事件的路徑比對看整個 PR 的差異，照常生效。

## 4. 預覽改成手動或加標籤才跑

三種做法：

| 做法 | 寫法 | 權限／安全 |
|---|---|---|
| 加標籤（建議） | `types: [labeled, synchronize]`，`if: contains(github.event.pull_request.labels.*.name, 'preview')` | 只有有寫入權限的人能加標籤；跑的是 PR 分支自己的 workflow 檔。私人 repo 只有自己和 agent，風險低。來源：<https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#pull_request> |
| `workflow_dispatch` 手動 | 在 Actions 頁或 `gh workflow run preview-cloudflare.yml --ref <分支>` | 需寫入權限；拿不到 `pull_request` 內容（PR 編號要自己傳 input），預覽網址留言要改寫。來源：<https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#workflow_dispatch> |
| `issue_comment` 指令（如 `/preview`） | `on: issue_comment`，判斷 `github.event.issue.pull_request` 與留言內容 | **只會跑預設分支（main）上的 workflow 檔**，要自己 checkout PR 分支；有 secrets 可用，所以一定要檢查 `author_association`（OWNER／MEMBER），否則任何能留言的人都能觸發。每則留言都會建立 run（被 `if` 跳過不計分鐘）。來源：<https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#issue_comment>、<https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/> |

- 加標籤做法：加 `synchronize` 是為了已加標籤的 PR 之後推送也自動更新預覽；不想要就只留 `labeled`。
- 不要用 `pull_request_target` 來做：它用 main 的 workflow 加上有權限的 token，checkout PR 程式碼執行是已知的高風險寫法。來源同上 Security Lab 文章。

## 5. 合併佇列（merge queue）

- 合併佇列要用分支保護規則或 ruleset 開啟，**只支援組織擁有的公開 repo，或使用 GitHub Enterprise Cloud 的組織私人 repo**。本 repo 是個人帳號的私人 repo，不能用。來源：<https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue>
- 另外，私人 repo 的分支保護與 ruleset 要 GitHub Pro／Team 以上，免費方案沒有。來源：<https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>
- 就算能用，合併佇列是「合併前再測一次」，分鐘數只會更多，不是省錢工具。

## 6. 其他做法

- **合併 job**：每個 job 各自進位，所以把同一事件下的多個 job 合成一個能省。本 repo 的 `tests` 已是單一 job；`sync-dry-run` 是另一個 workflow、只在同步相關路徑變更時跑，可考慮併進 `tests` 當一個條件步驟（`dorny/paths-filter` 或 `git diff` 判斷），每次觸發時省 1 分鐘。推估省約 100 分鐘／月。
- **`[skip ci]`**：commit 訊息（HEAD commit）含 `[skip ci]`、`[ci skip]`、`[no ci]`、`[skip actions]`、`[actions skip]` 時，`push` 與 `pull_request` 觸發的 workflow 不跑。來源：<https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/skipping-workflow-runs>。適合純文件 commit，但 `paths-ignore` 已經處理大部分文件變更；而且合併到 main 時若標了，部署也不會跑，容易漏部署，不建議讓 agent 自動加。
- **快取 Playwright 瀏覽器**：Playwright 官方不建議，因為還原快取的時間跟下載差不多。來源：<https://playwright.dev/docs/ci#caching-browsers>。job 本來就 1 分鐘內，進位後沒差別。
- **自架 runner**：自架 runner 執行不計分鐘。來源：第 1 節計費文件；<https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners>。風險：
  - 電腦要一直開著連網，關機時 job 會卡在排隊（排隊最久 24 小時後失敗）。來源同上。
  - job 能在那台電腦執行任意程式；官方建議只用於私人 repo。本 repo 私人、只有自己與 agent，可接受，但不要用平常工作的電腦，最好用獨立使用者或 VM／容器。來源：<https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#hardening-for-self-hosted-runners>
  - 要自己維護 Node、Playwright 依賴與 runner 更新。
- **作業系統**：維持 `ubuntu-latest`（1 倍）；不要用 Windows／macOS runner。

## 7. 本 repo 的建議組合與預估（推估）

起點數字（K 提供）：PR #332 合併後約 1,685 分鐘／月；9 天合併 97 張 PR → 約 323 張／月；每張 PR 平均推約 1.8 次 → 約 580 次 PR 推送；其他 repo 約 600 分鐘／月。

拆解 1,685 的方式（**推估**，各 workflow 實際比例要從 Actions 用量報表核對）：

| 項目 | 推估觸發 | 推估分鐘 |
|---|---|---|
| `tests`（每次 PR 推送，扣掉純文件） | 約 580 次 × 0.95 | 約 550 |
| PR 預覽（網站檔案有變） | 約 580 × 0.8 | 約 465 |
| 同步預演（同步相關檔案有變） | 約 580 × 0.3 | 約 175 |
| 部署（合併到 main 且網站檔案有變） | 約 323 × 0.8 | 約 260 |
| 同步、版本號等排程 | — | 約 235 |
| 合計 | | 約 1,685 |

套用建議後：

| 做法 | 對象變化（推估） | 省下 |
|---|---|---|
| A. 草稿 PR 不跑（agent 確實照做） | tests、預演、預覽從每 PR 1.8 次變 1 次 | 約 535 |
| B. 預覽改加標籤才跑（假設 20% PR 要預覽） | 預覽約 260 → 約 65 | 約 195（在 A 之後） |
| C. 同步預演併進 tests | 每次預演省 1 個 job | 約 95 |
| D. `cancel-in-progress` | job 太短，很少取消到 | 約 0～30 |

- A＋B：本 repo 約 950 分鐘／月，帳號合計約 1,550（推估）。
- A＋B＋C：約 855，帳號合計約 1,455（推估）。
- 只做 B：約 1,315，帳號合計約 1,915，太接近上限，不夠。
- 開發速度再變快時，A 和 B 的效果跟著 PR 數等比例放大，比較穩；真的還不夠再考慮自架 runner。

建議順序：先做 A＋B（改 workflow 加上改 agent 開 PR 的流程），一個月後看 Actions 用量報表（Settings → Billing）核對上面的推估，再決定要不要做 C。
