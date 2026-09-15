#Requires -Version 5.1
<#
  Keep Cloudflare quick tunnel alive for abroad testing.
  - Restarts cloudflared when process dies or origin probe fails
  - Rewrites Desktop remote-url.txt + home-gpu-config.json when URL changes
  Usage: npm run watch:remote-gpu
  Stop: Ctrl+C
#>

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root 'package.json'))) { $Root = $PSScriptRoot }

$startScript = Join-Path $PSScriptRoot 'start-remote-gpu.ps1'
$deskTxt = Join-Path ([Environment]::GetFolderPath('Desktop')) 'rust-belt-era-apk\remote-url.txt'
$probeIntervalSec = 45
$failBeforeRestart = 2

Write-Host ''
Write-Host '=== Rust Belt · Cloudflare quick tunnel WATCHDOG ===' -ForegroundColor Cyan
Write-Host 'Quick tunnels have no SLA; this only auto-restarts when they die.' -ForegroundColor Yellow
Write-Host 'For a stable fixed URL, use a named Cloudflare tunnel (see docs).' -ForegroundColor Yellow
Write-Host 'Ctrl+C to stop.' -ForegroundColor DarkGray
Write-Host ''

function Get-RemoteChatUrlFromDesk {
  if (-not (Test-Path -LiteralPath $deskTxt)) { return $null }
  $m = Select-String -Path $deskTxt -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com/v1/chat/completions' | Select-Object -First 1
  if ($m) { return $m.Matches[0].Value }
  return $null
}

function Test-TunnelOk([string]$chatUrl) {
  if (-not $chatUrl) { return $false }
  $origin = ($chatUrl -replace '/v1/chat/completions$', '') + '/api/tags'
  try {
    $r = Invoke-WebRequest -Uri $origin -UseBasicParsing -TimeoutSec 12
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
  } catch {
    return $false
  }
}

function Test-CloudflaredRunning {
  $p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'cloudflared' -and $_.CommandLine -match 'tunnel --url' }
  return [bool]$p
}

# Initial start
& powershell -ExecutionPolicy Bypass -File $startScript
$fails = 0
$lastUrl = Get-RemoteChatUrlFromDesk

while ($true) {
  Start-Sleep -Seconds $probeIntervalSec
  $url = Get-RemoteChatUrlFromDesk
  $alive = (Test-CloudflaredRunning) -and (Test-TunnelOk $url)
  if ($alive) {
    if ($fails -gt 0) { Write-Host ("[OK] tunnel healthy again ({0})" -f (Get-Date -Format 'HH:mm:ss')) -ForegroundColor Green }
    $fails = 0
    if ($url -and $url -ne $lastUrl) {
      Write-Host "[!] URL changed -> $url" -ForegroundColor Yellow
      Write-Host '    Update phone Base URL (remote-url.txt).' -ForegroundColor Yellow
      $lastUrl = $url
      try { Set-Clipboard -Value $url } catch {}
    }
    continue
  }

  $fails += 1
  Write-Host ("[!] tunnel unhealthy ({0}/{1}) @ {2}" -f $fails, $failBeforeRestart, (Get-Date -Format 'HH:mm:ss')) -ForegroundColor Yellow
  if ($fails -lt $failBeforeRestart) { continue }

  Write-Host '[…] restarting start-remote-gpu.ps1 ...' -ForegroundColor Cyan
  & powershell -ExecutionPolicy Bypass -File $startScript
  $fails = 0
  $lastUrl = Get-RemoteChatUrlFromDesk
  if ($lastUrl) {
    Write-Host "[OK] new URL: $lastUrl" -ForegroundColor Green
    Write-Host '    Phone must paste the new Base URL.' -ForegroundColor Yellow
  }
}
