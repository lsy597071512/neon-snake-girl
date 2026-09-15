@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
echo 锈带纪元 · Android APK 构建
echo.
echo 首次使用请先安装 Android Studio：
echo   https://developer.android.com/studio
echo.
echo SDK Manager 中安装 Android SDK Platform 36 与 Build-Tools 后执行：
echo   npm run build:apk
echo.
echo 或在 Android Studio 中打开 android 文件夹，菜单 Build ^> Build APK
echo.
pause
