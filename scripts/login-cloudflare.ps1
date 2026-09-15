# Cloudflare wrangler login (ASCII only)
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
  Write-Host '[ERROR] Node.js not found. https://nodejs.org/' -ForegroundColor Red
  Read-Host 'Press Enter to exit'
  exit 1
}

$wrangler = Join-Path $root 'node_modules\wrangler\bin\wrangler.js'
if (-not (Test-Path $wrangler)) {
  Write-Host '[FIRST RUN] npm install...' -ForegroundColor Cyan
  & npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host ''
Write-Host ' Opening browser for Cloudflare login. Click Allow.' -ForegroundColor Cyan
Write-Host ''
& $node $wrangler login
$err = $LASTEXITCODE
Write-Host ''
if ($err -eq 0) {
  Write-Host ' OK. Now double-click codes-dashboard.bat' -ForegroundColor Green
} else {
  Write-Host " Failed (exit $err)" -ForegroundColor Red
}
Read-Host 'Press Enter to close'
