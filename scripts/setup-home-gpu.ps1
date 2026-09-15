#Requires -Version 5.1
# One-click: configure Ollama as home GPU + write game import JSON.
# Run: powershell -ExecutionPolicy Bypass -File scripts/setup-home-gpu.ps1

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root 'package.json'))) { $Root = $PSScriptRoot }

$OllamaExe = @(
    'F:\Ollama\ollama.exe',
    "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
    "$env:ProgramFiles\Ollama\ollama.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

Write-Host ''
Write-Host '=== Rust Belt · Home GPU setup ===' -ForegroundColor Cyan

$desiredHost = '0.0.0.0:11434'
$cur = [Environment]::GetEnvironmentVariable('OLLAMA_HOST', 'User')
if ($cur -ne $desiredHost) {
    [Environment]::SetEnvironmentVariable('OLLAMA_HOST', $desiredHost, 'User')
    Write-Host "[OK] OLLAMA_HOST=$desiredHost (restart Ollama app after this)" -ForegroundColor Green
} else {
    Write-Host "[OK] OLLAMA_HOST already $desiredHost" -ForegroundColor Green
}

# Get current model (prefer rustbelt, fallback to violet)
$model = 'rustbelt-stellar:latest'
if ($OllamaExe) {
    Write-Host "[OK] Ollama: $OllamaExe" -ForegroundColor Green
    try {
        $list = & $OllamaExe list 2>&1 | Out-String
        # Prefer rustbelt models
        $rustbeltMatch = $list -match '(rustbelt-stellar[^\s]*)'
        if ($rustbeltMatch) {
            $model = $Matches[1].Trim()
        } else {
            $rb = $list -match '(rustbelt-[a-z]+[^\s]*)'
            if ($rb) { $model = $Matches[1].Trim() }
        }
        if (-not ($list -match 'rustbelt')) {
            $vl = $list -match '(violet[^\s]*)'
            if ($vl) { $model = $Matches[1].Trim() }
        }
        Write-Host "[OK] model: $model" -ForegroundColor Green
    } catch {
        Write-Host "[!] list failed, keep $model" -ForegroundColor Yellow
    }
} else {
    Write-Host '[!] ollama.exe not found' -ForegroundColor Yellow
}

# Tailscale
$tailscaleIp = $null
$ts = @(
    "$env:ProgramFiles\Tailscale\tailscale.exe",
    "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe",
    "$env:LOCALAPPDATA\Tailscale\tailscale.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($ts) {
    try {
        $tailscaleIp = (& $ts ip -4 2>$null | Select-Object -First 1)?.Trim()
        if ($tailscaleIp) {
            Write-Host "[OK] Tailscale IP: $tailscaleIp" -ForegroundColor Green
        }
    } catch {}
} else {
    Write-Host '[i] Tailscale not installed. For travel phone: https://tailscale.com/download' -ForegroundColor Yellow
}

# LAN IP
$lanIp = $null
try {
    $lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike '127.*' -and
            $_.IPAddress -notlike '169.254.*' -and
            $_.PrefixOrigin -ne 'WellKnown'
        } |
        Sort-Object -Property InterfaceMetric |
        Select-Object -First 1 -ExpandProperty IPAddress
} catch {}

if ($lanIp) { Write-Host "[OK] LAN IP: $lanIp" -ForegroundColor Green }

# Cloudflare tunnel URL (check if cloudflared is running)
$cloudflareUrl = $null
$cfLog = "$env:TEMP\cloudflared-tunnel.log"
if (Test-Path $cfLog) {
    $logContent = Get-Content $cfLog -Raw -ErrorAction SilentlyContinue
    if ($logContent -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
        $cloudflareUrl = $Matches[0]
        Write-Host "[OK] Cloudflare tunnel: $cloudflareUrl" -ForegroundColor Green
    }
}

# Firewall
try {
    $ruleName = 'RustBelt-Ollama-11434'
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 11434 -Action Allow -Profile Private -ErrorAction SilentlyContinue | Out-Null
        Write-Host '[OK] firewall rule added (Private / 11434)' -ForegroundColor Green
    } else {
        Write-Host '[OK] firewall rule exists' -ForegroundColor Green
    }
} catch {
    Write-Host '[i] firewall skip (may need admin)' -ForegroundColor Yellow
}

# Determine preferred mode
$preferredMode = 'cloudflare'
if ($cloudflareUrl) {
    $preferredMode = 'cloudflare'
} elseif ($tailscaleIp) {
    $preferredMode = 'tailscale'
} elseif ($lanIp) {
    $preferredMode = 'lan'
} else {
    $preferredMode = 'localhost'
}

$config = [ordered]@{
    version            = 2
    provider           = 'openai_compatible'
    model              = $model
    apiKey             = 'ollama'
    baseUrlLocal       = 'http://127.0.0.1:11434/v1/chat/completions'
    baseUrlLan         = if ($lanIp) { "http://${lanIp}:11434/v1/chat/completions" } else { $null }
    baseUrlTailscale   = if ($tailscaleIp) { "http://${tailscaleIp}:11434/v1/chat/completions" } else { $null }
    baseUrlCloudflare  = if ($cloudflareUrl) { "$cloudflareUrl/v1/chat/completions" } else { $null }
    preferredMode      = $preferredMode
    ollamaHost         = $desiredHost
    generatedAt        = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
    note               = '营地生活 → Model/API → 一键启用本机/局域网/Tailscale/Cloudflare'
}

$publicDir = Join-Path $Root 'public'
$docsDir = Join-Path $Root 'docs\violet-lotus'
foreach ($d in @($publicDir, $docsDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    $path = Join-Path $d 'home-gpu-config.json'
    [System.IO.File]::WriteAllText($path, ($config | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
    Write-Host "[OK] wrote $path" -ForegroundColor Green
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  Home GPU 配置完成！' -ForegroundColor Green
Write-Host ''
Write-Host "  当前模式: $preferredMode" -ForegroundColor White
Write-Host "  模型: $model" -ForegroundColor White
Write-Host "  Tailscale: $($tailscaleIp ? $tailscaleIp : '未检测到')" -ForegroundColor White
Write-Host "  Cloudflare: $($cloudflareUrl ? $cloudflareUrl : '未运行（跑 setup-cloudflare-tunnel.ps1 启动）')" -ForegroundColor White
Write-Host ''
Write-Host '  下一步：' -ForegroundColor Yellow
Write-Host "  1. 游戏 → 营地生活 → Model/API → 选模式按钮" -ForegroundColor White
Write-Host "  2. 外出用 → 跑 scripts/setup-cloudflare-tunnel.ps1 → 手机访问 URL" -ForegroundColor White
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''
