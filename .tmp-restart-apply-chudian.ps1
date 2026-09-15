$ErrorActionPreference = 'Continue'
$log = 'C:\Users\LiSuYan\Desktop\cursor-chudian-apply.log'
function Log($m) { "$(Get-Date -Format o) $m" | Tee-Object -FilePath $log -Append }

Log 'start apply watcher'
Start-Sleep -Seconds 2

Log 'stopping Cursor...'
Get-Process -Name 'Cursor' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Process -Name 'Cursor' -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 1
  Get-Process -Name 'Cursor' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
if (Get-Process -Name 'Cursor' -ErrorAction SilentlyContinue) {
  Log 'ERROR: Cursor still running'
  exit 1
}
Log 'Cursor stopped'

Start-Sleep -Seconds 2
Log 'writing config...'
python 'd:\neon-snake-girl\neon-snake-girl\.tmp-apply-chudian-cursor.py' 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) {
  Log "ERROR: apply exit $LASTEXITCODE"
  exit $LASTEXITCODE
}
Log 'config written'

$cursor = 'C:\Program Files\Cursor\Cursor.exe'
$project = 'd:\neon-snake-girl\neon-snake-girl'
if (Test-Path $cursor) {
  Log "relaunching $cursor $project"
  Start-Process -FilePath $cursor -ArgumentList @($project)
} else {
  Log 'ERROR: Cursor.exe not found'
  exit 1
}
Log 'done'
