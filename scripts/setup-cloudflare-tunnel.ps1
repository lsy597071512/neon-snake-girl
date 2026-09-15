#Requires -Version 5.1
# Cloudflare Tunnel: expose Ollama to internet without login.
# Run: powershell -ExecutionPolicy Bypass -File scripts/setup-cloudflare-tunnel.ps1
# Auto-updates home-gpu-config.json and prints mobile URL.

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root 'package.json'))) { $Root = $PSScriptRoot }

$OllamaExe = @(
    'F:\Ollama\ollama.exe',
    "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
    "$env:ProgramFiles\Ollama\ollama.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

$Cloudflared = @(
    "$env:ProgramFiles (x86)\cloudflared\cloudflared.exe",
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\cloudflared\cloudflared.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $Cloudflared) {
    Write-Host '[X] cloudflared not found. Run: winget install --id Cloudflare.cloudflared -e --accept-package-agreements --accept-source-agreements' -ForegroundColor Red
    exit 1
}

if (-not $OllamaExe) {
    Write-Host '[X] Ollama not found. Please ensure Ollama is installed and running.' -ForegroundColor Red
    exit 1
}

# Check Ollama is responding
try {
    $check = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5 -UseBasicParsing 2>$null
    if ($check.StatusCode -ne 200) { throw 'Ollama not ready' }
    Write-Host '[OK] Ollama is running' -ForegroundColor Green
} catch {
    Write-Host '[!] Ollama not responding on http://127.0.0.1:11434. Please start Ollama first.' -ForegroundColor Yellow
    exit 1
}

# Get current model
$modelName = 'rustbelt-stellar:latest'
try {
    $tags = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
    if ($tags.models -and $tags.models.Count -gt 0) {
        $modelName = $tags.models[0].name
        Write-Host "[OK] Using model: $modelName" -ForegroundColor Green
    }
} catch {
    Write-Host "[!] Could not list models, using default: $modelName" -ForegroundColor Yellow
}

# Kill existing cloudflared tunnels for this port
$existing = Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host '[i] Stopping existing cloudflared tunnel...' -ForegroundColor Yellow
    Stop-Process -Name 'cloudflared' -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Write-Host ''
Write-Host '=== Rust Belt · Cloudflare Tunnel (No Login Required) ===' -ForegroundColor Cyan
Write-Host '[i] Starting tunnel: http://127.0.0.1:11434 -> public URL' -ForegroundColor Cyan

# Start tunnel in background, capture output
$logFile = "$env:TEMP\cloudflared-tunnel.log"
$proc = Start-Process -FilePath $Cloudflared -ArgumentList 'tunnel','--url','http://127.0.0.1:11434','--no-autoupdate' -NoNewWindow -PassThru -RedirectStandardOutput $logFile

# Wait for URL to appear in log
$url = $null
$attempts = 0
while ($attempts -lt 30 -and $null -eq $url) {
    Start-Sleep -Seconds 2
    $attempts++
    if (Test-Path $logFile) {
        $content = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
        if ($content -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
            $url = $Matches[0]
        }
    }
}

if (-not $url) {
    Write-Host '[!] Tunnel did not start in time. Check log: ' -ForegroundColor Red -NoNewline
    Write-Host $logFile -ForegroundColor Gray
    exit 1
}

Write-Host "[OK] Tunnel ready: $url" -ForegroundColor Green

# Update home-gpu-config.json
$jsonPath = Join-Path $Root 'public\home-gpu-config.json'
$docsPath = Join-Path $Root 'docs\violet-lotus\home-gpu-config.json'
$baseUrl = $url + '/v1/chat/completions'
$timestamp = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')

# Get Tailscale IP if available
$tailscaleIp = $null
$tsExe = @(
    "$env:ProgramFiles\Tailscale\tailscale.exe",
    "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($tsExe) {
    try {
        $tailscaleIp = (& $tsExe ip -4 2>$null | Select-Object -First 1)?.Trim()
    } catch {}
}

# Get LAN IP
$lanIp = $null
try {
    $lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Sort-Object -Property InterfaceMetric |
        Select-Object -First 1 -ExpandProperty IPAddress
} catch {}

$configJson = @"
{
    "version": 2,
    "provider": "openai_compatible",
    "model": "$modelName",
    "apiKey": "ollama",
    "baseUrlLocal": "http://127.0.0.1:11434/v1/chat/completions",
    "baseUrlLan": "$($lanIp ? "http://$lanIp`:11434/v1/chat/completions" : "")",
    "baseUrlTailscale": "$($tailscaleIp ? "http://$tailscaleIp`:11434/v1/chat/completions" : "")",
    "baseUrlCloudflare": "$baseUrl",
    "preferredMode": "cloudflare",
    "ollamaHost": "0.0.0.0:11434",
    "generatedAt": "$timestamp",
    "note": "Cloudflare 隧道已就绪：手机在外网直接点击「Cloudflare 远程」按钮"
}
"@

foreach ($path in @($jsonPath, $docsPath)) {
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $configJson | Set-Content -Path $path -Encoding UTF8
    Write-Host "[OK] Updated: $path" -ForegroundColor Green
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  Cloudflare 隧道已就绪！' -ForegroundColor Green
Write-Host ''
Write-Host "  📱 手机访问（复制到手机浏览器）：" -ForegroundColor Yellow
Write-Host "     $url/api/tags" -ForegroundColor White
Write-Host ''
Write-Host "  🎮 游戏内操作：" -ForegroundColor Yellow
Write-Host "     营地生活 → Model/API → 🌐 Cloudflare 远程" -ForegroundColor White
Write-Host "     （或直接粘贴 baseUrl 到高级 Base URL）" -ForegroundColor Gray
Write-Host ''
Write-Host "  ⚠️  注意：关掉此窗口或 Ctrl+C 会断隧道。" -ForegroundColor Yellow
Write-Host "     要自动重连 → 跑：npm run watch:remote-gpu" -ForegroundColor Gray
Write-Host ''
Write-Host "  💾 配置已写入 public/home-gpu-config.json" -ForegroundColor Green
Write-Host "     运行 npm run build 后手机无需重跑此脚本。" -ForegroundColor Gray
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host "Tunnel process PID: $($proc.Id) (keep this window open)" -ForegroundColor Cyan

# Wait for tunnel process
try {
    $proc.WaitForExit()
} catch {}
