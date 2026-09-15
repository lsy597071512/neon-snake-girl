#!/usr/bin/env pwsh
# 下载并创建 fable-q4 Ollama 模型（普通 Q4_K_M，非 MTP）
# Usage: pwsh scripts/setup-fable-q4.ps1

$ErrorActionPreference = 'Stop'
$Repo = 'DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF'
# 普通版（非 MTP）——创意 RP / temp≈1.0 更稳
$File = 'Qwen3.8-27B-TurboFCFusion-735-882-Here-Uncen-NEO-CODER-MAX-Q4_K_M.gguf'
$OutDir = 'F:\Ollama\gguf\fable-q4'
$Py = 'E:\MiniMaxH3\venv\Scripts\python.exe'
$Root = Split-Path $PSScriptRoot -Parent
$Modelfile = Join-Path $Root 'ollama\Modelfile.fable-q4'

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Dest = Join-Path $OutDir $File

if (-not (Test-Path $Dest) -or ((Get-Item $Dest).Length -lt 1GB)) {
  Write-Host "==> Download $File (~18GB) ..." -ForegroundColor Cyan
  & $Py -c @"
from huggingface_hub import hf_hub_download
p = hf_hub_download(
    repo_id='$Repo',
    filename='$File',
    local_dir=r'$OutDir',
    local_dir_use_symlinks=False,
)
print('OK', p)
"@
  if ($LASTEXITCODE -ne 0) { throw 'download failed' }
} else {
  Write-Host "==> Already present: $Dest ($([math]::Round((Get-Item $Dest).Length/1GB,2)) GB)" -ForegroundColor Green
}

Write-Host "==> ollama create fable-q4 ..." -ForegroundColor Cyan
& ollama create fable-q4 -f $Modelfile
if ($LASTEXITCODE -ne 0) { throw 'ollama create failed' }

Write-Host "==> Ensure boot watchdog (path auto-heal)..." -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'install-fable-autostart.ps1') -Ensure

Write-Host "==> Done. Test:" -ForegroundColor Green
Write-Host "  ollama run fable-q4 `"用一句中文自我介绍`""
Write-Host "  curl http://127.0.0.1:11434/v1/chat/completions ..."
