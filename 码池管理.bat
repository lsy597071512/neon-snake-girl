@echo off
cd /d "%~dp0"
if not exist "%~dp0scripts\start-codes-dashboard.ps1" (
  echo.
  echo  [ERROR] Run this from the project root folder.
  echo          Need scripts\start-codes-dashboard.ps1 next to this file.
  echo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-codes-dashboard.ps1"
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" pause
exit /b %ERR%
