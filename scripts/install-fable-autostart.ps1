#Requires -Version 5.1
<#
.SYNOPSIS
  安装 / 卸载 Fable 开机自启 + 闪退/断线看门狗（固定目录，不绑游戏仓库）。

.DESCRIPTION
  将脚本部署到稳定目录（默认 F:\Ollama\fable-home-gpu），计划任务只指向该目录。
  挪游戏仓库、换盘符装游戏都不会让自启失效。
  探测：进程没了 / 端口没了 / /health 失败 → 自动重启 llama-server；Tailscale 掉线 → up。

.EXAMPLE
  powershell -File scripts\install-fable-autostart.ps1
  powershell -File scripts\install-fable-autostart.ps1 -Uninstall
#>
param(
  [switch]$Uninstall,
  [switch]$Ensure,
  [int]$IntervalSec = 60,
  [int]$LogonDelaySec = 45,
  # 固定家目录；不存在 F:\Ollama 时落到 LOCALAPPDATA
  [string]$InstallRoot = ''
)

$ErrorActionPreference = 'Stop'
$taskName = 'RustBelt-Fable-HomeGpu-Watchdog'
$repoBundle = Join-Path $PSScriptRoot 'fable-home-gpu'

function Resolve-FableHome([string]$preferred) {
  if ($preferred -and $preferred.Trim()) {
    return [System.IO.Path]::GetFullPath($preferred.Trim())
  }
  if (Test-Path -LiteralPath 'F:\Ollama') {
    return 'F:\Ollama\fable-home-gpu'
  }
  return (Join-Path $env:LOCALAPPDATA 'RustBelt-Fable-HomeGpu')
}

$homeDir = Resolve-FableHome $InstallRoot
$watchdog = Join-Path $homeDir 'watchdog.ps1'
$startPs1 = Join-Path $homeDir 'start-fable.ps1'

function Unregister-TaskSafe([string]$name) {
  $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($t) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    if (-not $Ensure) { Write-Host "removed task: $name" }
  }
}

function Stop-WatchdogProcesses {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -like '*watchdog-fable-home-gpu.ps1*' -or
        $_.CommandLine -like '*fable-home-gpu\watchdog.ps1*' -or
        $_.CommandLine -like '*RustBelt-Fable-HomeGpu*watchdog*' -or
        ($_.CommandLine -like '*watchdog.ps1*' -and $_.CommandLine -like '*fable-home-gpu*')
      )
    } |
    ForEach-Object {
      if (-not $Ensure) { Write-Host "stop watchdog pid=$($_.ProcessId)" }
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Test-WatchdogRunningHere {
  $hit = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine.IndexOf($watchdog, [StringComparison]::OrdinalIgnoreCase) -ge 0
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
  if (-not $arg) { return $false }
  $fileOk = $arg.IndexOf($watchdog, [StringComparison]::OrdinalIgnoreCase) -ge 0
  if (-not $fileOk) {
    $alt = $watchdog.Replace('\', '/')
    $fileOk = $arg.IndexOf($alt, [StringComparison]::OrdinalIgnoreCase) -ge 0
  }
  $wd = [string]$act.WorkingDirectory
  $wdOk = $false
  if ($wd) {
    try {
      $wdOk = ([System.IO.Path]::GetFullPath($wd)).Equals($homeDir, [StringComparison]::OrdinalIgnoreCase)
    } catch { $wdOk = $false }
  }
  return ($fileOk -and $wdOk)
}

function Deploy-HomeFiles {
  if (-not (Test-Path -LiteralPath $repoBundle)) {
    throw "missing bundle: $repoBundle"
  }
  New-Item -ItemType Directory -Force -Path $homeDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $homeDir 'logs') | Out-Null
  foreach ($name in @('watchdog.ps1', 'start-fable.ps1', 'stop-fable.ps1')) {
    $src = Join-Path $repoBundle $name
    if (-not (Test-Path -LiteralPath $src)) { throw "missing $src" }
    Copy-Item -LiteralPath $src -Destination (Join-Path $homeDir $name) -Force
  }
  Set-Content -LiteralPath (Join-Path $homeDir 'INSTALL.txt') -Encoding UTF8 -Value @"
RustBelt Fable Home GPU
Installed: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Home: $homeDir
Task: $taskName
Does NOT depend on game repo path.
Logs: $homeDir\logs\
Reinstall from game repo: powershell -File scripts\install-fable-autostart.ps1
"@
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

  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg -WorkingDirectory $homeDir
  # 登录后拉起（GPU 用户会话）
  $triggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  try {
    $triggerLogon.Delay = 'PT{0}S' -f [Math]::Max(15, $LogonDelaySec)
  } catch {}

  # 每 15 分钟兜底：若看门狗进程死了，任务调度器会再拉一实例（IgnoreNew 避免叠狗）
  $triggerRepeat = New-ScheduledTaskTrigger -Once -At ((Get-Date).Date.AddMinutes(2)) `
    -RepetitionInterval (New-TimeSpan -Minutes 15) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $desc = 'RustBelt Fable: boot + crash/disconnect watchdog. Fixed home (not game repo). :8080 + Tailscale.'

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger @($triggerLogon, $triggerRepeat) `
    -Settings $settings `
    -Principal $principal `
    -Description $desc `
    -Force | Out-Null
}

function Start-WatchdogLoop {
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', $watchdog, '-Loop', '-IntervalSec', [string]$IntervalSec
    ) `
    -WorkingDirectory $homeDir `
    -WindowStyle Hidden
}

if ($Uninstall) {
  Unregister-TaskSafe $taskName
  Stop-WatchdogProcesses
  Write-Host "Uninstall done. Home files left at: $homeDir (delete manually if unwanted)"
  exit 0
}

if ($Ensure) {
  Deploy-HomeFiles
  if (Test-TaskPointsHere) {
    if (-not (Test-WatchdogRunningHere)) {
      Start-WatchdogLoop
      Write-Host "==> Fable autostart OK (fixed home); started watchdog from $homeDir"
    }
    exit 0
  }
  Write-Host "==> Task missing or not on fixed home → rebind to $homeDir" -ForegroundColor Yellow
  Stop-WatchdogProcesses
  Register-FableTask
  Start-WatchdogLoop
  Write-Host "==> Scheduled task rebound: $taskName" -ForegroundColor Green
  exit 0
}

# 完整安装
Deploy-HomeFiles
Register-FableTask
Write-Host ("==> Fixed home: {0}" -f $homeDir) -ForegroundColor Green
Write-Host ("==> Scheduled task: {0}" -f $taskName) -ForegroundColor Green
Write-Host ("    IntervalSec={0} LogonDelaySec={1}" -f $IntervalSec, $LogonDelaySec)
Write-Host ("    Triggers: AtLogOn + every 15min safety net")
Write-Host ("    Log: {0}\logs\watchdog.log" -f $homeDir)
Write-Host ""
Write-Host "Starting watchdog now..." -ForegroundColor Cyan
Stop-WatchdogProcesses
Start-WatchdogLoop
Write-Host "Done. Boot → auto start; crash/disconnect → auto restart. Independent of game repo path."
Write-Host "Uninstall: powershell -File scripts\install-fable-autostart.ps1 -Uninstall"
