@echo off
REM Codes pool dashboard (ASCII name - use if Chinese .bat double-click fails)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-codes-dashboard.ps1"
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" pause
exit /b %ERR%
