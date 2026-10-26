# 本檔保留 UTF-8 BOM：Windows PowerShell 5.1 沒有 BOM 會用系統字碼頁讀中文字串。
param([Parameter(Mandatory)][int]$Number)

$ErrorActionPreference = 'Stop'
# 5.1 預設用系統字碼頁解讀 gh 輸出並寫出 stdout；執行期間改 UTF-8，結束還原。
$previousConsoleEncoding = [Console]::OutputEncoding
try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch {}
$root = Split-Path $PSScriptRoot -Parent
$logs = Join-Path $root '.scratch/checks'
New-Item -ItemType Directory -Force $logs | Out-Null
$runId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$log = Join-Path $logs "pr-$Number-$runId.log"
Push-Location $root
try {
  # 5.1 在 Stop 下會把原生命令的 stderr 當終止錯誤；改逐行寫 UTF-8。不把一整串 pending 帶進對話。
  $ErrorActionPreference = 'Continue'
  $writer = [IO.StreamWriter]::new($log, $false, [Text.UTF8Encoding]::new($false))
  try {
    & gh pr checks $Number --watch --interval 30 2>&1 | ForEach-Object {
      $writer.WriteLine($(if ($_ -is [Management.Automation.ErrorRecord]) { if ($_.TargetObject -is [string]) { $_.TargetObject } else { $_.Exception.Message } } else { "$_" }))
    }
    $code = $LASTEXITCODE
  } finally { $writer.Dispose() }
  # gh 把被取消的 check 印成 fail 卻回 0；結束後再讀一次狀態，取消／失敗／未完成都不算通過。
  $buckets = (& gh pr checks $Number --json name,bucket 2>$null) -join "`n"
  if ($code -eq 0) {
    $code = if (!$buckets) { 1 } else {
      $bad = @((ConvertFrom-Json $buckets) | Where-Object { $_.bucket -in 'fail', 'cancel', 'pending' })
      if ($bad.Count) { 1 } else { 0 }
    }
  }
  Write-Output "PR #$Number checks exit=$code；完整輸出：$log"
  Get-Content $log -Encoding UTF8 -Tail 8
  exit $code
} finally {
  try { [Console]::OutputEncoding = $previousConsoleEncoding } catch {}
  Pop-Location
}
