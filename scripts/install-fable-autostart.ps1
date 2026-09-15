#Requires -Version 5.1
<#
.SYNOPSIS
  安装 / 卸载 / 自愈「开机自启 + 定时看门狗」。

.DESCRIPTION
  换电脑或挪仓库后一般不用手动再跑：start-fable / watchdog 会自动 -Ensure。
  仅当计划任务缺失、或任务里的脚本路径 ≠ 当前仓库路径时，才重写任务。

.EXAMPLE
  powershell -File scripts\install-fable-autostart.ps1
  powershell -File scripts\install-fable-autostart.ps1 -Ensure
  powershell -File scripts\install-fable-autostart.ps1 -Uninstall
#>
param(
  [switch]$Uninstall,
  # 静默自愈：路径对就跳过；不对才重装。不弹「立刻拉起」重复狗（已有则复用）
  [switch]$Ensure,
  [int]$IntervalSec = 120,
  [int]$LogonDelaySec = 45
)

$ErrorActionPreference = 'Stop'
$taskName = 'RustBelt-Fable-HomeGpu-Watchdog'
$root = [System.IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$watchdog = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'watchdog-fable-home-gpu.ps1'))
$marker = Join-Path $root 'tmp\fable-autostart.path'

if (-not (Test-Path -LiteralPath $watchdog)) {
  throw "missing $watchdog"
}

function Unregister-TaskSafe([string]$name) {
  $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($t) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    if (-not $Ensure) { Write-Host "removed task: $name" }
  }
}

function Stop-WatchdogProcesses {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*watchdog-fable-home-gpu.ps1*' } |
    ForEach-Object {
      if (-not $Ensure) { Write-Host "stop watchdog pid=$($_.ProcessId)" }
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Test-WatchdogRunningHere {
  $needle = $watchdog.Replace('\', '\\')
  $hit = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine.IndexOf($watchdog, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $_.CommandLine -like '*watchdog-fable-home-gpu.ps1*'
      )
    }
  return [bool]$hit
}

function Test-TaskPointsHere {
  $t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $t) { return $false }
  $act = @($t.Actions)[0]
  if (-not $act) { return $false }
  $arg = [string]$act.Arguments
  $wd = [string]$act.WorkingDirectory
  if (-not $arg) { return $false }
  $wdOk = $false
  if ($wd) {
    try {
      $wdOk = ([System.IO.Path]::GetFullPath($wd)).Equals($root, [StringComparison]::OrdinalIgnoreCase)
    } catch { $wdOk = $false }
  }
  $fileOk = $arg.IndexOf($watchdog, [StringComparison]::OrdinalIgnoreCase) -ge 0
  if (-not $fileOk) {
    # 容忍正反斜杠差异
    $alt = $watchdog.Replace('\', '/')
    $fileOk = $arg.IndexOf($alt, [StringComparison]::OrdinalIgnoreCase) -ge 0
  }
  return ($fileOk -and $wdOk)
}

function Register-FableTask {
  Unregister-TaskSafe $taskName

  $arg = @(
    '-NoProfile'
    '-ExecutionPolicy', 'Bypass'
    '-WindowStyle', 'Hidden'
    '-File', "`"$watchdog`""
    '-Loop'
    '-IntervalSec', [string]$IntervalSec
  ) -join ' '

  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  try {
    $trigger.Delay = 'PT{0}S' -f [Math]::Max(15, $LogonDelaySec)
  } catch {}

  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $desc = 'RustBelt: keep Fable llama.cpp :8080 + Tailscale up; auto-restart if down.'

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description $desc `
    -Force | Out-Null

  New-Item -ItemType Directory -Force -Path (Split-Path $marker -Parent) | Out-Null
  Set-Content -LiteralPath $marker -Value $root -Encoding UTF8
}

function Start-WatchdogLoop {
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', $watchdog, '-Loop', '-IntervalSec', [string]$IntervalSec
    ) `
    -WorkingDirectory $root `
    -WindowStyle Hidden
}

if ($Uninstall) {
  Unregister-TaskSafe $taskName
  Stop-WatchdogProcesses
  if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue }
  Write-Host 'Uninstall done.'
  exit 0
}

if ($Ensure) {
  if (Test-TaskPointsHere) {
    if (-not (Test-WatchdogRunningHere)) {
      Start-WatchdogLoop
      Write-Host "==> Fable autostart OK (task current); started watchdog from $root"
    }
    # 路径对且狗在跑：完全静默
    exit 0
  }
  Write-Host "==> Fable autostart path drift or missing → rebind to $root" -ForegroundColor Yellow
  Stop-WatchdogProcesses
  Register-FableTask
  Start-WatchdogLoop
  Write-Host "==> Scheduled task rebound: $taskName" -ForegroundColor Green
  exit 0
}

# 显式完整安装
Register-FableTask
Write-Host ("==> Scheduled task registered: {0}" -f $taskName) -ForegroundColor Green
Write-Host ("    IntervalSec={0} LogonDelaySec={1}" -f $IntervalSec, $LogonDelaySec)
Write-Host ("    Root: {0}" -f $root)
Write-Host "    Log: tmp\fable-watchdog.log"
Write-Host ""
Write-Host "Starting watchdog now (first bring-up)..." -ForegroundColor Cyan
Stop-WatchdogProcesses
Start-WatchdogLoop
Write-Host "Done. Phone: open Tailscale, then reconnect home-gpu (100.x:8080)."
Write-Host "Uninstall: powershell -File scripts\install-fable-autostart.ps1 -Uninstall"
Write-Host "Note: start-fable / watchdog will auto -Ensure after move/clone."
