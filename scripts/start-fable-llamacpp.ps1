#Requires -Version 5.1
# Start Fable Q4 via llama.cpp (OpenAI-compatible :8080)
# ctx=16384, KV=q8_0, flash-attn=on, cache-reuse=256, reasoning=off
# Default: auto-enable MTP when MTP-Q4_K_M.gguf is present
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-fable-llamacpp.ps1
#   ... -Mtp / -NoMtp / -Reasoning auto
# Stop Ollama model first if VRAM is full:
#   ollama stop fable-q4

param(
  [int]$Port = 8080,
  [int]$Ctx = 16384,
  [string]$BindHost = '0.0.0.0',
  [string]$Gguf = 'F:\Ollama\gguf\fable-q4\Qwen3.8-27B-TurboFCFusion-735-882-Here-Uncen-NEO-CODER-MAX-Q4_K_M.gguf',
  [string]$LlamaServer = 'F:\llama-cpp-cuda\llama-server.exe',
  [string]$Alias = 'fable-q4:latest',
  [int]$GpuLayers = 99,
  [int]$CacheReuse = 256,
  [int]$Parallel = 1,
  [ValidateSet('off', 'on', 'auto')]
  [string]$Reasoning = 'auto',
  # MTP speculative: MTP-Q4_K_M GGUF + --spec-type draft-mtp
  [switch]$Mtp,
  [switch]$NoMtp,
  [int]$SpecDraftNMax = 2,
  [string]$MtpGguf = 'F:\Ollama\gguf\fable-q4\Qwen3.8-27B-TurboFCFusion-735-882-Here-Uncen-NEO-CODER-MAX-MTP-Q4_K_M.gguf'
)

$ErrorActionPreference = 'Stop'

# 自愈：把开机任务绑到固定目录 F:\Ollama\fable-home-gpu（与游戏仓库路径无关）
try {
  $ensure = Join-Path $PSScriptRoot 'install-fable-autostart.ps1'
  if (Test-Path -LiteralPath $ensure) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ensure -Ensure 2>$null | Out-Host
  }
} catch {
  Write-Host ("autostart ensure skipped: {0}" -f $_.Exception.Message) -ForegroundColor DarkYellow
}

# 若固定家目录已部署，优先用家目录启动（日志也落在家目录；与游戏仓库无关）
$homeStart = @(
  'F:\Ollama\fable-home-gpu\start-fable.ps1',
  (Join-Path $env:LOCALAPPDATA 'RustBelt-Fable-HomeGpu\start-fable.ps1')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($homeStart) {
  $forward = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $homeStart,
    '-Port', [string]$Port, '-Ctx', [string]$Ctx, '-Reasoning', $Reasoning,
    '-Gguf', $Gguf, '-LlamaServer', $LlamaServer, '-MtpGguf', $MtpGguf,
    '-Alias', $Alias, '-GpuLayers', [string]$GpuLayers
  )
  if ($Mtp) { $forward += '-Mtp' }
  if ($NoMtp) { $forward += '-NoMtp' }
  & powershell.exe @forward
  exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath $LlamaServer)) {
  throw "llama-server not found: $LlamaServer"
}

$useMtp = $false
if ($NoMtp) {
  $useMtp = $false
} elseif ($Mtp) {
  $useMtp = $true
} elseif (Test-Path -LiteralPath $MtpGguf) {
  $useMtp = $true
}

$modelPath = if ($useMtp) { $MtpGguf } else { $Gguf }
if (-not (Test-Path -LiteralPath $modelPath)) {
  throw "GGUF not found: $modelPath"
}

Write-Host '==> tip: ollama stop fable-q4 (free VRAM)' -ForegroundColor Yellow
try { & ollama stop fable-q4 2>$null } catch {}

$workDir = Split-Path -Parent $LlamaServer
$root = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $root 'tmp'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logOut = Join-Path $logDir 'llamacpp-fable.out.log'
$logErr = Join-Path $logDir 'llamacpp-fable.err.log'

$budget = if ($Reasoning -eq 'off') { '0' } else { '256' }

$argList = @(
  '-m', $modelPath,
  '-c', [string]$Ctx,
  '-ngl', [string]$GpuLayers,
  '-fa', 'on',
  '-ctk', 'q8_0',
  '-ctv', 'q8_0',
  '--cache-reuse', [string]$CacheReuse,
  '--parallel', [string]$Parallel,
  '--jinja',
  '--reasoning', $Reasoning,
  '--reasoning-budget', $budget,
  '-a', $Alias,
  '--host', $BindHost,
  '--port', [string]$Port
)

if ($useMtp) {
  $argList += @('--spec-type', 'draft-mtp', '--spec-draft-n-max', [string]$SpecDraftNMax)
}

$argLine = ($argList | ForEach-Object {
  $s = [string]$_
  if ($s -match '[\s"]') { '"' + ($s -replace '"', '\"') + '"' } else { $s }
}) -join ' '

Write-Host '==> starting llama-server' -ForegroundColor Cyan
Write-Host ("    model : {0}" -f $modelPath)
Write-Host ("    listen: http://{0}:{1}/v1/chat/completions" -f $BindHost, $Port)
Write-Host ("    alias : {0}" -f $Alias)
Write-Host ("    ctx={0} kv=q8_0 fa=on cache-reuse={1} reasoning={2} mtp={3} draft-n={4}" -f $Ctx, $CacheReuse, $Reasoning, $useMtp, $SpecDraftNMax)
Write-Host ("    args  : {0}" -f $argLine)

$proc = Start-Process -FilePath $LlamaServer `
  -ArgumentList $argLine `
  -WorkingDirectory $workDir `
  -RedirectStandardOutput $logOut `
  -RedirectStandardError $logErr `
  -PassThru `
  -WindowStyle Hidden

Write-Host ("==> pid={0} waiting /health ..." -f $proc.Id) -ForegroundColor Cyan

$ok = $false
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Seconds 2
  if ($proc.HasExited) {
    Write-Host '!! process exited, err log:' -ForegroundColor Red
    Get-Content $logErr -Tail 50 -ErrorAction SilentlyContinue
    throw ("llama-server exited early code={0}" -f $proc.ExitCode)
  }
  try {
    $null = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $Port) -TimeoutSec 2
    $ok = $true
    break
  } catch {}
  if (($i + 1) % 5 -eq 0) {
    Write-Host ("    loading... {0}s" -f (($i + 1) * 2))
  }
}

if (-not $ok) {
  Write-Host '!! health timeout, err log:' -ForegroundColor Red
  Get-Content $logErr -Tail 80 -ErrorAction SilentlyContinue
  throw 'llama-server health timeout'
}

Write-Host '==> Ready.' -ForegroundColor Green
Write-Host ("  models: http://{0}:{1}/v1/models" -f $BindHost, $Port)
Write-Host ("  stop  : Stop-Process -Id {0}" -f $proc.Id)
