# Thin wrapper → Node restore (avoids PowerShell Chinese encoding issues)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$proxyAddr = $null
try {
  $reg = reg.exe query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings' /v ProxyServer 2>$null
  if ($reg -match 'ProxyServer\s+REG_SZ\s+(\S+)') { $proxyAddr = $Matches[1] }
} catch {}

if ($proxyAddr) {
  $env:HTTP_PROXY = "http://$proxyAddr"
  $env:HTTPS_PROXY = "http://$proxyAddr"
  $env:NODE_USE_ENV_PROXY = '1'
}
$env:NO_PROXY = 'localhost,127.0.0.1,::1'
$env:no_proxy = 'localhost,127.0.0.1,::1'

& node "$root\scripts\restore-admin-secrets.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ''
Write-Host 'Next: double-click 码池管理.bat' -ForegroundColor Green
