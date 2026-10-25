#Requires -Version 5.1
param([int]$Port = 8080)
$ErrorActionPreference = 'SilentlyContinue'
Get-Process llama-server -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host ("Stop llama-server pid={0}" -f $_.Id)
  Stop-Process -Id $_.Id -Force
}
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($procId in @($conns.OwningProcess | Sort-Object -Unique)) {
  if (-not $procId) { continue }
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  Write-Host ("Stop pid={0} ({1})" -f $procId, $p.ProcessName)
  Stop-Process -Id $procId -Force
}
Write-Host 'done'
