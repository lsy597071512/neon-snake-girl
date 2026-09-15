@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>&1
if errorlevel 1 (
  echo [提示] 未找到 npm。开发模式需要先安装 Node.js 并执行 npm install
  echo 若只想游玩，请双击 start-play.bat
  pause
  exit /b 1
)
if not exist node_modules (
  echo 首次开发：正在安装依赖（仅开发者需要，玩家不需要）...
  call npm install
)
echo 启动开发服务器...
call npm run dev
pause
