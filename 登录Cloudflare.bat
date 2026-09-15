@echo off
cd /d "%~dp0"
if not exist "%~dp0scripts\login-cloudflare.ps1" (
  echo.
  echo  [ERROR] Run this from the project root folder.
  echo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\login-cloudflare.ps1"
exit /b %ERRORLEVEL%
