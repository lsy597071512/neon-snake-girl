@echo off
chcp 65001 >nul
title 锈带纪元 - 网关部署
cd /d %~dp0
echo.
echo  即将部署激活网关（只需一次）。
echo  注意：稍后会弹出浏览器打开 Cloudflare 授权页，请点击 [Allow / 授权]。
echo  授权后此窗口会自动继续，全程约 2-3 分钟，请不要关闭窗口。
echo.
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\deploy-gateway.ps1"
echo.
echo  ================ 以上为部署结果 ================
echo  如果看到「部署完成」和网关地址：成功，回到对话告诉开发者即可。
echo  如果出现红色报错：把整个窗口截图或复制文字发给开发者。
echo.
pause
