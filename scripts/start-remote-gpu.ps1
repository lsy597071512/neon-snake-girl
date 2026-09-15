#Requires -Version 5.1
# Abroad remote GPU via Cloudflare quick tunnel.
# Usage: npm run start:remote-gpu

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root 'package.json'))) { $Root = $PSScriptRoot }

function Find-Cloudflared {
  $cands = @(
    (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'),
    (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe'),
    (Join-Path $env:LOCALAPPDATA 'cloudflared\cloudflared.exe')
  )
  foreach ($c in $cands) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  return $null
}

function Find-Ollama {
  $cands = @(
    'F:\Ollama\ollama.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
    (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
  )
  foreach ($c in $cands) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  return $null
}

Write-Host ''
Write-Host '=== Rust Belt · Abroad Remote GPU (Cloudflare) ===' -ForegroundColor Cyan

$Cloudflared = Find-Cloudflared
if (-not $Cloudflared) {
  Write-Host '[!] cloudflared missing; trying winget install...' -ForegroundColor Yellow
  winget install --id Cloudflare.cloudflared -e --accept-package-agreements --accept-source-agreements | Out-Null
  $machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machinePath;$userPath"
  $Cloudflared = Find-Cloudflared
  if (-not $Cloudflared) {
    Write-Host '[X] cloudflared install failed' -ForegroundColor Red
    exit 1
  }
}

try {
  $null = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 5
  Write-Host '[OK] Ollama :11434' -ForegroundColor Green
} catch {
  Write-Host '[X] Ollama not responding. Start F:\Ollama\ollama app.exe first.' -ForegroundColor Red
  exit 1
}

$model = 'violet-lotus-q8:latest'
$OllamaExe = Find-Ollama
if ($OllamaExe) {
  try {
    $list = & $OllamaExe list 2>&1 | Out-String
    if ($list -match '(violet-lotus-q8[^\s]*)') { $model = $Matches[1].Trim() }
  } catch {}
}

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'cloudflared' -and $_.CommandLine -match 'tunnel --url' } |
  ForEach-Object {
    Write-Host ("[i] stop old tunnel PID {0}" -f $_.ProcessId) -ForegroundColor Yellow
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 1

$logDir = Join-Path $Root 'tools\tailscale'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir 'cloudflared-quick.log'
if (Test-Path $logFile) { Remove-Item $logFile -Force -ErrorAction SilentlyContinue }

Write-Host '[...] starting Cloudflare quick tunnel (keep process alive)...' -ForegroundColor Cyan
$p = Start-Process -FilePath $Cloudflared `
  -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:11434') `
  -RedirectStandardError $logFile `
  -PassThru `
  -WindowStyle Minimized

$url = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $logFile) {
    $txt = Get-Content -LiteralPath $logFile -Raw -ErrorAction SilentlyContinue
    if ($txt -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
      $url = $Matches[0]
      break
    }
  }
  if ($p.HasExited) { break }
}

if (-not $url) {
  Write-Host '[X] could not parse tunnel URL. See log:' -ForegroundColor Red
  Write-Host "    $logFile"
  exit 1
}

$chatUrl = "$url/v1/chat/completions"
Write-Host "[OK] tunnel $url" -ForegroundColor Green

$lanIp = $null
try {
  $lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike '127.*' -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.PrefixOrigin -ne 'WellKnown'
    } |
    Sort-Object InterfaceMetric |
    Select-Object -First 1 -ExpandProperty IPAddress
} catch {}

$config = [ordered]@{
  version         = 1
  provider        = 'openai_compatible'
  model           = $model
  apiKey          = 'ollama'
  baseUrlLocal    = 'http://127.0.0.1:11434/v1/chat/completions'
  baseUrlLan      = if ($lanIp) { "http://${lanIp}:11434/v1/chat/completions" } else { $null }
  baseUrlRemote   = $chatUrl
  preferredMode   = 'tailscale'
  ollamaHost      = '0.0.0.0:11434'
  generatedAt     = (Get-Date).ToString('s')
  note            = 'Abroad: paste baseUrlRemote into phone Camp Living advanced Base URL'
  cloudflareQuick = $url
}

foreach ($d in @((Join-Path $Root 'public'), (Join-Path $Root 'docs\violet-lotus'))) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  $path = Join-Path $d 'home-gpu-config.json'
  [System.IO.File]::WriteAllText($path, ($config | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
  Write-Host "[OK] wrote $path" -ForegroundColor Green
}

$deskDir = Join-Path ([Environment]::GetFolderPath('Desktop')) 'rust-belt-era-apk'
if (-not (Test-Path $deskDir)) { New-Item -ItemType Directory -Path $deskDir -Force | Out-Null }
$deskTxt = Join-Path $deskDir 'remote-url.txt'
$lines = @(
  'Rust Belt Era - Home GPU remote URL',
  ("Generated: {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
  ("Model: {0}" -f $model),
  '',
  'Phone: Camp Living -> Home GPU -> Advanced -> paste Base URL below',
  'Bearer: ollama',
  '',
  $chatUrl,
  '',
  ("Keep cloudflared PID {0} running; PC must not sleep." -f $p.Id),
  'Re-run npm run start:remote-gpu if URL expires.'
)
[System.IO.File]::WriteAllLines($deskTxt, $lines, [System.Text.UTF8Encoding]::new($false))
try { Set-Clipboard -Value $chatUrl } catch {}
Write-Host "[OK] clipboard + $deskTxt" -ForegroundColor Green

Write-Host ''
Write-Host 'Phone steps:' -ForegroundColor Cyan
Write-Host '1) Open Desktop\rust-belt-era-apk\remote-url.txt (send URL to phone)'
Write-Host '2) Game -> Camp Living -> Home GPU -> Advanced -> paste Base URL'
Write-Host '3) Test connection'
Write-Host ("cloudflared PID={0}" -f $p.Id) -ForegroundColor Yellow
Write-Host $chatUrl -ForegroundColor White

# Warm model in VRAM so first phone turn is not a cold load
try {
  Write-Host '[...] warming model in VRAM (keep_alive forever)...' -ForegroundColor Cyan
  $warm = @{
    model = $model
    messages = @(@{ role = 'user'; content = 'ping' })
    stream = $false
    keep_alive = -1
    options = @{ num_predict = 2 }
  } | ConvertTo-Json -Depth 6 -Compress
  Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/chat' -Method POST -Body $warm -ContentType 'application/json; charset=utf-8' | Out-Null
  Write-Host '[OK] model warm' -ForegroundColor Green
} catch {
  Write-Host '[!] warm skipped (Ollama busy?)' -ForegroundColor Yellow
}

Write-Host ''
