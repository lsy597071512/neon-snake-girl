#Requires -Version 5.1
<#
.SYNOPSIS
  启动 Fable Q4 llama-server（固定安装目录版，不依赖游戏仓库）。
#>
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
  [switch]$Mtp,
  [switch]$NoMtp,
  [int]$SpecDraftNMax = 2,
  [string]$MtpGguf = 'F:\Ollama\gguf\fable-q4\Qwen3.8-27B-TurboFCFusion-735-882-Here-Uncen-NEO-CODER-MAX-MTP-Q4_K_M.gguf'
)

$ErrorActionPreference = 'Stop'
$HomeDir = $PSScriptRoot
$logDir = Join-Path $HomeDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logOut = Join-Path $logDir 'llamacpp-fable.out.log'
$logErr = Join-Path $logDir 'llamacpp-fable.err.log'

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

# 已有健康实例则跳过
try {
  $h = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $Port) -TimeoutSec 3
  if ($null -ne $h) {
    Write-Host ("==> already healthy :{0}, skip start" -f $Port) -ForegroundColor Green
    exit 0
  }
} catch {}

# 清掉僵死实例
Get-Process llama-server -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

$workDir = Split-Path -Parent $LlamaServer
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
Write-Host ("    home  : {0}" -f $HomeDir)
Write-Host ("    mtp={0}" -f $useMtp)

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
    Write-Host '!! process exited early' -ForegroundColor Red
    if (Test-Path -LiteralPath $logErr) { Get-Content -LiteralPath $logErr -Tail 40 }
    throw ("llama-server exited early code={0}" -f $proc.ExitCode)
  }
  try {
    $r = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $Port) -TimeoutSec 2
    if ($null -ne $r) { $ok = $true; break }
  } catch {}
}

if (-not $ok) {
  throw 'llama-server health timeout'
}

Write-Host ("==> healthy :{0}" -f $Port) -ForegroundColor Green
exit 0
