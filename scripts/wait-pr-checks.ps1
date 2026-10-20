param([Parameter(Mandatory)][int]$Number)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$logs = Join-Path $root '.scratch/checks'
New-Item -ItemType Directory -Force $logs | Out-Null
$runId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$log = Join-Path $logs "pr-$Number-$runId.log"
Push-Location $root
try {
  # 保留 gh 的失敗狀態；不把一整串 pending 帶進對話。
  & gh pr checks $Number --watch --interval 30 *> $log
  $code = $LASTEXITCODE
  Write-Output "PR #$Number checks exit=$code；完整輸出：$log"
  Get-Content $log -Tail 8
  exit $code
} finally { Pop-Location }
