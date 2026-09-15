# Codes pool dashboard - one-click launcher (ASCII only for Windows encoding)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Resolve-NodeExe {
  if ($env:NODE_EXE -and (Test-Path $env:NODE_EXE)) { return $env:NODE_EXE }
  foreach ($p in @(
    'C:\Program Files\nodejs\node.exe',
    'C:\Program Files (x86)\nodejs\node.exe'
  )) {
    if (Test-Path $p) { return $p }
  }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

$node = Resolve-NodeExe
if (-not $node) {
  Write-Host ''
  Write-Host '[ERROR] Node.js not found. Install: https://nodejs.org/' -ForegroundColor Red
  Write-Host '        Then run once in this folder: npm install' -ForegroundColor Yellow
  Read-Host 'Press Enter to exit'
  exit 1
}

if (-not (Test-Path "$root\node_modules\wrangler\bin\wrangler.js")) {
  Write-Host '[FIRST RUN] npm install (includes wrangler)...' -ForegroundColor Cyan
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) {
    Write-Host '[ERROR] npm not found.' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
  }
  & npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$proxyAddr = $null
try {
  $reg = reg.exe query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings' /v ProxyServer 2>$null
  if ($reg -match 'ProxyServer\s+REG_SZ\s+(\S+)') { $proxyAddr = $Matches[1] }
} catch {}
if ($proxyAddr) {
  $env:HTTP_PROXY = "http://$proxyAddr"
  $env:HTTPS_PROXY = "http://$proxyAddr"
  $env:NODE_USE_ENV_PROXY = '1'
  Write-Host "[proxy] $proxyAddr" -ForegroundColor DarkGray
}
$env:NO_PROXY = 'localhost,127.0.0.1,::1'
$env:no_proxy = 'localhost,127.0.0.1,::1'

Write-Host ''
Write-Host ' [codes dashboard] checking credentials...' -ForegroundColor Cyan
& $node "$root\scripts\ensure-gateway-secrets.mjs"
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host ' Fix: double-click login-cloudflare.bat first, then try again.' -ForegroundColor Yellow
  Read-Host 'Press Enter to exit'
  exit $LASTEXITCODE
}

Write-Host ''
Write-Host ' [server] starting - keep this window open' -ForegroundColor Green
Write-Host '          browser -> http://127.0.0.1:8797' -ForegroundColor DarkGray
Write-Host ''
& $node "$root\scripts\codes-dashboard.mjs"
$err = $LASTEXITCODE
Write-Host ''
if ($err -ne 0) {
  Write-Host " Failed (exit $err). Try:" -ForegroundColor Red
  Write-Host '  - login-cloudflare.bat'
  Write-Host '  - close old dashboard window (port 8797)'
  Write-Host '  - scripts\restore-admin-secrets.ps1'
}
Write-Host ' Double-click codes-dashboard.bat to reopen.'
Read-Host 'Press Enter to close'
