#Requires -Version 5.1
<#
.SYNOPSIS
  Fable 本机 GPU 看门狗：检查 :8080 健康；挂了就重启 llama-server；顺带拉起 Tailscale。

.DESCRIPTION
  - 单次检查：默认行为
  - 常驻循环：-Loop（开机任务用这个）
  - 断网 / 休眠唤醒 / 进程崩溃后，每隔 IntervalSec 自动重连

.EXAMPLE
  pwsh -File scripts/watchdog-fable-home-gpu.ps1
  pwsh -File scripts/watchdog-fable-home-gpu.ps1 -Loop -IntervalSec 120
#>
param(
  [int]$Port = 8080,
  [int]$IntervalSec = 120,
  [switch]$Loop,
  [switch]$SkipTailscale,
  [string]$StartScript = ''
)

$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
if (-not $StartScript) {
  $StartScript = Join-Path $PSScriptRoot 'start-fable-llamacpp.ps1'
}
$logDir = Join-Path $root 'tmp'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'fable-watchdog.log'

function Write-Log([string]$msg) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  Write-Host $line
}

function Test-FableHealth([int]$p) {
  try {
    $r = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $p) -TimeoutSec 3
    return ($r.status -eq 'ok' -or $null -ne $r)
  } catch {
    return $false
  }
}

function Ensure-Tailscale {
  if ($SkipTailscale) { return }
  $ts = Get-Command tailscale -ErrorAction SilentlyContinue
  if (-not $ts) {
    Write-Log 'Tailscale CLI not found (skip)'
    return
  }
  try {
    $st = & tailscale status --json 2>$null | ConvertFrom-Json
    if ($st.BackendState -ne 'Running') {
      Write-Log ("Tailscale BackendState={0} → tailscale up" -f $st.BackendState)
      & tailscale up --accept-routes=false 2>&1 | Out-Null
      Start-Sleep -Seconds 3
    } else {
      $ip = (& tailscale ip -4 2>$null | Select-Object -First 1)
      Write-Log ("Tailscale OK ip={0}" -f $ip)
    }
  } catch {
    Write-Log ("Tailscale check/up failed: {0}" -f $_.Exception.Message)
    try { & tailscale up 2>&1 | Out-Null } catch {}
  }
}

function Ensure-Firewall([int]$p) {
  $name = "llama-server-$p"
  $rule = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
  if (-not $rule) {
    try {
      New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
      Write-Log ("firewall rule added: {0}" -f $name)
    } catch {
      Write-Log ("firewall rule skip: {0}" -f $_.Exception.Message)
    }
  }
}

function Restart-Fable {
  Write-Log 'Fable unhealthy → restarting llama-server'
  Get-Process llama-server -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Log ("stop old llama-server pid={0}" -f $_.Id)
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
  if (-not (Test-Path -LiteralPath $StartScript)) {
    Write-Log ("missing start script: {0}" -f $StartScript)
    return $false
  }
  try {
    # 子进程启动服务；start 脚本会等到 health
    $p = Start-Process -FilePath 'powershell.exe' `
      -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', $StartScript
      ) `
      -WorkingDirectory $root `
      -WindowStyle Hidden `
      -PassThru `
      -Wait
    if ($p.ExitCode -ne 0 -and $null -ne $p.ExitCode) {
      Write-Log ("start script exit={0}" -f $p.ExitCode)
    }
  } catch {
    Write-Log ("start failed: {0}" -f $_.Exception.Message)
  }
  Start-Sleep -Seconds 2
  return (Test-FableHealth -p $Port)
}

function Invoke-Once {
  Ensure-Firewall -p $Port
  Ensure-Tailscale

  if (Test-FableHealth -p $Port) {
    Write-Log ("Fable OK :{0}" -f $Port)
    return $true
  }

  # 进程还在但 health 挂了 → 也重启
  $alive = Get-Process llama-server -ErrorAction SilentlyContinue
  if ($alive) {
    Write-Log ("llama-server alive but /health fail pids={0}" -f (($alive | ForEach-Object Id) -join ','))
  } else {
    Write-Log 'llama-server not running'
  }
  return (Restart-Fable)
}

Write-Log ("watchdog start Loop={0} IntervalSec={1} Port={2}" -f [bool]$Loop, $IntervalSec, $Port)

# 自愈：若计划任务指向旧路径，重绑到当前仓库（避免挪目录后开机空转）
try {
  $ensure = Join-Path $PSScriptRoot 'install-fable-autostart.ps1'
  if (Test-Path -LiteralPath $ensure) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ensure -Ensure 2>$null | ForEach-Object { Write-Log $_ }
  }
} catch {
  Write-Log ("autostart ensure skipped: {0}" -f $_.Exception.Message)
}

if (-not $Loop) {
  $ok = Invoke-Once
  exit $(if ($ok) { 0 } else { 1 })
}

# 开机后 GPU 驱动可能未就绪，先短等再进入循环
Start-Sleep -Seconds 15
while ($true) {
  try {
    [void](Invoke-Once)
  } catch {
    Write-Log ("loop error: {0}" -f $_.Exception.Message)
  }
  Start-Sleep -Seconds ([Math]::Max(30, $IntervalSec))
}
