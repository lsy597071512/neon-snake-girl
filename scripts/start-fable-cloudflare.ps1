#Requires -Version 5.1
# Cloudflare quick tunnel → llama.cpp Fable (:8080) + write public/home-gpu-config.json
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-fable-cloudflare.ps1
# Requires: llama.cpp already up (scripts\start-fable-llamacpp.ps1)

param(
  [int]$LocalPort = 8080,
  [string]$Model = 'fable-q4:latest',
  [switch]$SkipApkHint
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

function Find-Cloudflared {
  foreach ($c in @(
    (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'),
    (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe'),
    (Join-Path $env:LOCALAPPDATA 'cloudflared\cloudflared.exe')
  )) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  return $null
}

Write-Host '=== Fable · Cloudflare tunnel → llama.cpp ===' -ForegroundColor Cyan

try {
  $null = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $LocalPort) -TimeoutSec 3
  Write-Host ("[OK] llama.cpp :{0}" -f $LocalPort) -ForegroundColor Green
} catch {
  throw ("llama.cpp not healthy on :{0}. Run scripts\start-fable-llamacpp.ps1 first." -f $LocalPort)
}

$Cloudflared = Find-Cloudflared
if (-not $Cloudflared) { throw 'cloudflared.exe not found' }

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'cloudflared' -and $_.CommandLine -match 'tunnel --url' } |
  ForEach-Object {
    Write-Host ("[i] stop old tunnel PID {0}" -f $_.ProcessId) -ForegroundColor Yellow
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 1

$logDir = Join-Path $Root 'tmp'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'cloudflared-fable.log'
if (Test-Path $logFile) { Remove-Item $logFile -Force -ErrorAction SilentlyContinue }

$origin = "http://127.0.0.1:$LocalPort"
Write-Host ("[...] tunnel → {0}" -f $origin) -ForegroundColor Cyan
$p = Start-Process -FilePath $Cloudflared `
  -ArgumentList @('tunnel', '--url', $origin) `
  -RedirectStandardError $logFile `
  -PassThru `
  -WindowStyle Minimized

$url = $null
for ($i = 0; $i -lt 90; $i++) {
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
  Write-Host $logFile
  Get-Content $logFile -Tail 40 -ErrorAction SilentlyContinue
  throw 'could not parse trycloudflare.com URL'
}

$chatUrl = "$url/v1/chat/completions"
Write-Host "[OK] $chatUrl" -ForegroundColor Green

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

$shipId = '2026-09-10-fable-cf-' + (Get-Date -Format 'HHmmss')
$config = [ordered]@{
  version            = 9
  shipId             = $shipId
  provider           = 'openai_compatible'
  model              = $Model
  apiKey             = 'llamacpp'
  baseUrlLocal       = "http://127.0.0.1:$LocalPort/v1/chat/completions"
  baseUrlLan         = if ($lanIp) { "http://${lanIp}:$LocalPort/v1/chat/completions" } else { $null }
  baseUrlRemote      = $chatUrl
  baseUrlCloudflare  = $chatUrl
  preferredMode      = 'cloudflare'
  ollamaHost         = ''
  character          = 'ashcrow'
  backend            = 'llamacpp-fable-q4-mtp'
  generatedAt        = (Get-Date).ToString('s')
  note               = 'Phone auto: preferredMode=cloudflare. Keep cloudflared + llama.cpp running; PC awake. Quick tunnel URL changes each restart.'
  cloudflareQuick    = $url
  llamaCpp           = [ordered]@{
    port             = $LocalPort
    ctx              = 16384
    kv               = 'q8_0'
    flashAttn        = $true
    cacheReuse       = 256
    reasoning        = 'off'
    maxTokensClient  = 480
    mtp              = $true
    specDraftNMax    = 2
  }
}

$publicPath = Join-Path $Root 'public\home-gpu-config.json'
[System.IO.File]::WriteAllText(
  $publicPath,
  ($config | ConvertTo-Json -Depth 6),
  [System.Text.UTF8Encoding]::new($false)
)
Write-Host "[OK] wrote $publicPath shipId=$shipId" -ForegroundColor Green

$deskDir = Join-Path ([Environment]::GetFolderPath('Desktop')) 'rust-belt-era-apk'
New-Item -ItemType Directory -Force -Path $deskDir | Out-Null
$deskTxt = Join-Path $deskDir 'remote-url.txt'
@(
  'Rust Belt Era - Fable llama.cpp Cloudflare URL',
  ("Generated: {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
  ("Model: {0}" -f $Model),
  ("shipId: {0}" -f $shipId),
  ("cloudflared PID: {0}" -f $p.Id),
  '',
  $chatUrl,
  '',
  'APK packs this URL via public/home-gpu-config.json (preferredMode=cloudflare).',
  'PC must stay awake; keep llama.cpp + this cloudflared process.'
) | Set-Content -LiteralPath $deskTxt -Encoding UTF8
try { Set-Clipboard -Value $chatUrl } catch {}

# smoke through tunnel
Write-Host '[...] smoke /v1/models via tunnel...' -ForegroundColor Cyan
try {
  $models = Invoke-RestMethod -Uri "$url/v1/models" -TimeoutSec 30
  Write-Host ("[OK] tunnel models: {0}" -f (($models.data | ForEach-Object { $_.id }) -join ', ')) -ForegroundColor Green
} catch {
  Write-Host ("[!] tunnel smoke failed: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
}

Write-Host ''
Write-Host ("cloudflared PID={0}" -f $p.Id) -ForegroundColor Yellow
Write-Host $chatUrl -ForegroundColor White
if (-not $SkipApkHint) {
  Write-Host 'Next: npm run build:apk  (so phone ships this shipId/URL)' -ForegroundColor Cyan
}
