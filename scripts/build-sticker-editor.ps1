# Rebuild webm sticker editor -> tools\WebmStickerEditor.exe
# Run after editing scripts\webm_sticker_editor.py:
#   powershell -ExecutionPolicy Bypass -File scripts\build-sticker-editor.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$distExe = Join-Path $root 'dist\WebmStickerEditor.exe'
$toolExe = Join-Path $root 'tools\WebmStickerEditor.exe'

Write-Host '[1/4] syntax check' -ForegroundColor Cyan
python -m py_compile scripts\webm_sticker_editor.py
if ($LASTEXITCODE -ne 0) { throw 'py_compile failed' }

Write-Host '[2/4] clean old artifacts' -ForegroundColor Cyan
if (Test-Path $toolExe) {
    Remove-Item -Force $toolExe -ErrorAction Stop
}
Remove-Item -Recurse -Force build\WebmStickerEditor -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force dist\WebmStickerEditor -ErrorAction SilentlyContinue

Write-Host '[3/4] PyInstaller build' -ForegroundColor Cyan
python -m PyInstaller WebmStickerEditor.spec --noconfirm --clean --distpath dist --workpath build --log-level WARN
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed' }

if (-not (Test-Path $distExe)) { throw 'dist exe missing' }
$built = Get-Item $distExe
$builtKB = [math]::Round($built.Length / 1KB)
Write-Host "[3/4] new exe: $($built.LastWriteTime)  $builtKB KB" -ForegroundColor Cyan

Write-Host '[4/4] deploy to tools\' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $toolExe) | Out-Null
Copy-Item $distExe $toolExe -Force

$final = Get-Item $toolExe
$finalKB = [math]::Round($final.Length / 1KB)
if ($final.LastWriteTime -lt $built.LastWriteTime.AddSeconds(-2)) { throw 'timestamp mismatch after copy' }
Write-Host "[done] tools\WebmStickerEditor.exe  $finalKB KB  $($final.LastWriteTime)" -ForegroundColor Green