param([string[]]$Suite, [switch]$Full)

$ErrorActionPreference = 'Stop'
if (($Full -and $Suite) -or (!$Full -and !$Suite)) {
  Write-Output '用法：scripts/check-local.ps1 -Suite startup-stability 或 -Full'
  exit 1
}
$root = Split-Path $PSScriptRoot -Parent
$logs = Join-Path $root '.scratch/checks'
$runId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
New-Item -ItemType Directory -Force $logs | Out-Null
function Invoke-Check([string]$Name, [string[]]$NodeArgs) {
  $log = Join-Path $logs "$Name-$runId.log"
  & node @NodeArgs *> $log
  $code = $LASTEXITCODE
  Write-Output "$Name exit=$code；完整輸出：$log"
  if ($code -ne 0) { Get-Content $log -Tail 30; exit $code }
  Get-Content $log -Tail 5
}
Push-Location $root
try {
  if ($Full) {
    Invoke-Check 'node' @('scripts/run-node-tests.mjs')
    Invoke-Check 'browser' @('scripts/run-browser-tests.cjs')
  } else {
    Invoke-Check 'browser-selected' @('scripts/run-browser-tests.cjs', '--only', ($Suite -join ','))
  }
} finally { Pop-Location }
