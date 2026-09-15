@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "dist\index.html" (
  echo [错误] 找不到 dist\index.html
  echo 请先在有 Node.js 的环境下执行: npm install ^&^& npm run build
  pause
  exit /b 1
)

set "NODE="
if exist "C:\Program Files\nodejs\node.exe" set "NODE=C:\Program Files\nodejs\node.exe"
if not defined NODE (
  where node >nul 2>&1 && set "NODE=node"
)

if not defined NODE (
  echo [错误] 未找到 Node.js。请安装后重试，或使用 PowerShell 脚本 scripts\serve.ps1
  pause
  exit /b 1
)

echo.
echo  锈带纪元 - 正在启动...
echo.

"%NODE%" "%~dp0scripts\serve.cjs"

pause
