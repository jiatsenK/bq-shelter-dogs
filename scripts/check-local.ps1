param(
  [string[]]$Suite,
  [string[]]$NodeTest,
  [switch]$Full,
  [string]$Reason = '',
  [string]$RepeatReason = ''
)

$ErrorActionPreference = 'Stop'
if (($Full -and ($Suite -or $NodeTest)) -or (!$Full -and !$Suite -and !$NodeTest)) {
  Write-Output '用法：scripts/check-local.ps1 (-NodeTest scripts/example.test.mjs | -Suite startup-stability | -Full) -Reason 原因 [-RepeatReason 重跑原因]'
  exit 1
}
$root = Split-Path $PSScriptRoot -Parent
$logs = Join-Path $root '.scratch/checks'
$runId = [guid]::NewGuid().ToString()
New-Item -ItemType Directory -Force $logs | Out-Null
$commands = [System.Collections.Generic.List[object]]::new()
if ($Full) {
  $commands.Add(@('scripts/run-node-tests.mjs'))
  $commands.Add(@('scripts/run-browser-tests.cjs'))
} else {
  if ($NodeTest) { $commands.Add(@('scripts/run-node-tests.mjs', '--only', (($NodeTest | ForEach-Object { $_.Replace('\', '/') } | Sort-Object -Unique) -join ','))) }
  if ($Suite) { $commands.Add(@('scripts/run-browser-tests.cjs', '--only', (($Suite | Sort-Object -Unique) -join ','))) }
}
$checks = [System.Collections.Generic.List[object]]::new()
function ConvertTo-Packet($Value) {
  # Base64 避免 Windows PowerShell 5.1 原生命令參數處理移除 JSON 引號／空字串。
  $json = ConvertTo-Json -InputObject $Value -Depth 8 -Compress
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
}
function Invoke-Check([string]$Name, [string[]]$NodeArgs) {
  $log = Join-Path $logs "$Name-$runId.log"
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $code = 1
  try {
    & node @NodeArgs *> $log
    $code = $LASTEXITCODE
  } finally {
    $timer.Stop()
    $checks.Add(@{ command = $NodeArgs; exitCode = $code; durationMs = $timer.ElapsedMilliseconds; log = $log })
  }
  Write-Output "$Name exit=$code；完整輸出：$log"
  if ($code -ne 0) { Get-Content $log -Tail 30; return }
  Get-Content $log -Tail 5
}
Push-Location $root
$previousRecord = $env:BQ_LOCAL_CHECK_RECORD
$record = $null
$exitCode = 1
try {
  $request = ConvertTo-Packet @{ commands = $commands.ToArray(); reason = $Reason; repeatReason = $RepeatReason; shellVersion = $PSVersionTable.PSVersion.ToString(); ownerPid = $PID }
  $record = & node scripts/local-check-record.cjs start $request
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $env:BQ_LOCAL_CHECK_RECORD = $record
  Write-Output "執行紀錄：$record"
  $exitCode = 0
  foreach ($command in $commands) {
    $name = if ($command[0] -match 'run-node') { 'node' } else { 'browser' }
    # Invoke-Check 同時輸出摘要；退出碼從紀錄取，避免混進 PowerShell pipeline。
    Invoke-Check $name $command | Out-Host
    $exitCode = $checks[$checks.Count - 1].exitCode
    if ($exitCode -ne 0) { break }
  }
} finally {
  if ($record -and $env:BQ_LOCAL_CHECK_RECORD -eq $record) {
    $packet = ConvertTo-Packet $checks.ToArray()
    & node scripts/local-check-record.cjs finish $record $packet
    if ($LASTEXITCODE -ne 0) { $exitCode = 1 }
  }
  $env:BQ_LOCAL_CHECK_RECORD = $previousRecord
  Pop-Location
}
exit $exitCode
