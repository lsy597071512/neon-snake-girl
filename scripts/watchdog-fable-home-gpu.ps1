#Requires -Version 5.1
<#
.SYNOPSIS
  兼容入口：转发到固定安装目录看门狗（不再绑游戏仓库路径）。
#>
param(
  [int]$Port = 8080,
  [int]$IntervalSec = 60,
  [switch]$Loop,
  [switch]$SkipTailscale,
  [string]$StartScript = ''
)

$ErrorActionPreference = 'Continue'
$install = Join-Path $PSScriptRoot 'install-fable-autostart.ps1'
if (Test-Path -LiteralPath $install) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $install -Ensure -IntervalSec $IntervalSec 2>$null | Out-Host
}

$homeCandidates = @(
  'F:\Ollama\fable-home-gpu\watchdog.ps1',
  (Join-Path $env:LOCALAPPDATA 'RustBelt-Fable-HomeGpu\watchdog.ps1')
)
$wd = $homeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $wd) {
  Write-Host 'Fixed home watchdog missing. Run: powershell -File scripts\install-fable-autostart.ps1' -ForegroundColor Red
  exit 1
}

$arg = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $wd)
if ($Loop) { $arg += @('-Loop', '-IntervalSec', [string]$IntervalSec) }
if ($SkipTailscale) { $arg += '-SkipTailscale' }
if ($Port -ne 8080) { $arg += @('-Port', [string]$Port) }

& powershell.exe @arg
exit $LASTEXITCODE
