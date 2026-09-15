#Requires -Version 5.1
param([int]$Port = 8080)
$ErrorActionPreference = 'SilentlyContinue'
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) {
  Write-Host ("port {0} not listening" -f $Port)
  exit 0
}
$procIds = $conns.OwningProcess | Sort-Object -Unique
foreach ($procId in $procIds) {
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  Write-Host ("Stop pid={0} ({1})" -f $procId, $p.ProcessName)
  Stop-Process -Id $procId -Force
}
Write-Host 'done'
