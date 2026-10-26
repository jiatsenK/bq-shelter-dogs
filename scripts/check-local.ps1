# 本檔保留 UTF-8 BOM：Windows PowerShell 5.1 沒有 BOM 會用系統字碼頁讀中文字串。
param(
  [string[]]$Suite,
  [string[]]$NodeTest,
  [switch]$Full,
  [string]$Reason = '',
  [string]$RepeatReason = ''
)

$ErrorActionPreference = 'Stop'
# 5.1 預設用系統字碼頁解讀 node 輸出並寫出 stdout；執行期間改 UTF-8，結束還原。
$previousConsoleEncoding = [Console]::OutputEncoding
try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch {}
if (($Full -and ($Suite -or $NodeTest)) -or (!$Full -and !$Suite -and !$NodeTest)) {
  Write-Output '用法：scripts/check-local.ps1 (-NodeTest scripts/example.test.mjs | -Suite startup-stability | -Full) -Reason 原因 [-RepeatReason 重跑原因]'
  try { [Console]::OutputEncoding = $previousConsoleEncoding } catch {}
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
  # 5.1 在 Stop 下會把原生命令的第一行 stderr 當終止錯誤，*> 又寫成 UTF-16；改逐行寫 UTF-8。
  # stderr 行包成 ErrorRecord：5.1 原文在 TargetObject（空行的訊息會變成 RemoteException），pwsh 7 只在訊息裡。
  $ErrorActionPreference = 'Continue'
  $writer = [IO.StreamWriter]::new($log, $false, [Text.UTF8Encoding]::new($false))
  try {
    & node @NodeArgs 2>&1 | ForEach-Object {
      $writer.WriteLine($(if ($_ -is [Management.Automation.ErrorRecord]) { if ($_.TargetObject -is [string]) { $_.TargetObject } else { $_.Exception.Message } } else { "$_" }))
    }
    $code = $LASTEXITCODE
  } finally {
    $writer.Dispose()
    $timer.Stop()
    $checks.Add(@{ command = $NodeArgs; exitCode = $code; durationMs = $timer.ElapsedMilliseconds; log = $log })
  }
  Write-Output "$Name exit=$code；完整輸出：$log"
  if ($code -ne 0) { Get-Content $log -Encoding UTF8 -Tail 30; return }
  Get-Content $log -Encoding UTF8 -Tail 5
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
  try { [Console]::OutputEncoding = $previousConsoleEncoding } catch {}
  Pop-Location
}
exit $exitCode
