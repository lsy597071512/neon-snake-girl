@echo off
REM Cloudflare login (ASCII name - use if Chinese .bat double-click fails)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\login-cloudflare.ps1"
exit /b %ERRORLEVEL%
