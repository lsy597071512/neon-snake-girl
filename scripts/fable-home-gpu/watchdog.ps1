#Requires -Version 5.1
<#
.SYNOPSIS
  Fable 本机 GPU 看门狗（固定安装目录版）：探活 :8080；断线/闪退/无进程则重启；顺带拉起 Tailscale。

.DESCRIPTION
  本脚本应安装在 F:\Ollama\fable-home-gpu\（或 LOCALAPPDATA\RustBelt-Fable-HomeGpu），
  **不依赖**游戏仓库路径。计划任务只指向本目录。

.EXAMPLE
  powershell -File F:\Ollama\fable-home-gpu\watchdog.ps1 -Loop -IntervalSec 60
#>
param(
  [int]$Port = 8080,
  [int]$IntervalSec = 60,
  [switch]$Loop,
  [switch]$SkipTailscale
)

$ErrorActionPreference = 'Continue'
$HomeDir = $PSScriptRoot
$StartScript = Join-Path $HomeDir 'start-fable.ps1'
$logDir = Join-Path $HomeDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'watchdog.log'

function Write-Log([string]$msg) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  try { Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8 } catch {}
  Write-Host $line
}

function Test-PortListening([int]$p) {
  try {
    $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    return [bool]$c
  } catch {
    return $false
  }
}

function Test-FableHealth([int]$p) {
  try {
    $r = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $p) -TimeoutSec 4
    return ($null -ne $r)
  } catch {
    return $false
  }
}

function Test-FableOk([int]$p) {
  if (-not (Test-PortListening -p $p)) { return $false }
  return (Test-FableHealth -p $p)
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
      Write-Log ("Tailscale BackendState={0} → up" -f $st.BackendState)
      & tailscale up --accept-routes=false 2>&1 | Out-Null
      Start-Sleep -Seconds 3
    } else {
      $ip = (& tailscale ip -4 2>$null | Select-Object -First 1)
      Write-Log ("Tailscale OK ip={0}" -f $ip)
    }
  } catch {
    Write-Log ("Tailscale check failed: {0}" -f $_.Exception.Message)
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
      Write-Log ("firewall skip: {0}" -f $_.Exception.Message)
    }
  }
}

function Stop-LlamaServer {
  Get-Process llama-server -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Log ("stop llama-server pid={0}" -f $_.Id)
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
  # 端口仍被占时再杀监听进程
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in @($conns)) {
      if ($c.OwningProcess) {
        Write-Log ("stop port owner pid={0}" -f $c.OwningProcess)
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
  Start-Sleep -Seconds 2
}

function Restart-Fable {
  Write-Log 'Fable down (crash/disconnect/no health) → restart'
  Stop-LlamaServer
  if (-not (Test-Path -LiteralPath $StartScript)) {
    Write-Log ("missing start script: {0}" -f $StartScript)
    return $false
  }
  try {
    $p = Start-Process -FilePath 'powershell.exe' `
      -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', $StartScript
      ) `
      -WorkingDirectory $HomeDir `
      -WindowStyle Hidden `
      -PassThru `
      -Wait
    if ($null -ne $p.ExitCode -and $p.ExitCode -ne 0) {
      Write-Log ("start-fable exit={0}" -f $p.ExitCode)
    }
  } catch {
    Write-Log ("start failed: {0}" -f $_.Exception.Message)
  }
  Start-Sleep -Seconds 2
  return (Test-FableOk -p $Port)
}

function Invoke-Once {
  Ensure-Firewall -p $Port
  Ensure-Tailscale

  if (Test-FableOk -p $Port) {
    Write-Log ("Fable OK :{0}" -f $Port)
    return $true
  }

  $alive = Get-Process llama-server -ErrorAction SilentlyContinue
  $listen = Test-PortListening -p $Port
  Write-Log ("unhealthy process={0} listen={1}" -f [bool]$alive, $listen)
  return (Restart-Fable)
}

Write-Log ("watchdog start Loop={0} IntervalSec={1} Port={2} Home={3}" -f [bool]$Loop, $IntervalSec, $Port, $HomeDir)

if (-not $Loop) {
  $ok = Invoke-Once
  exit $(if ($ok) { 0 } else { 1 })
}

# 开机后 GPU 驱动可能未就绪
Start-Sleep -Seconds 20
while ($true) {
  try {
    [void](Invoke-Once)
  } catch {
    Write-Log ("loop error: {0}" -f $_.Exception.Message)
  }
  Start-Sleep -Seconds ([Math]::Max(30, $IntervalSec))
}
