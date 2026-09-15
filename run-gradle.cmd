@echo off
cd /d "%~dp0android"
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot"
set "ANDROID_HOME=C:\Android\Sdk"
set "ANDROID_SDK_ROOT=C:\Android\Sdk"
set "PATH=%JAVA_HOME%\bin;%PATH%"
call gradlew.bat assembleDebug --console=plain > "D:\ruanjian\neon-snake-girl\neon-snake-girl\gradle-build.log" 2>&1
set RC=%ERRORLEVEL%
echo GRADLE_EXIT_CODE=%RC% >> "D:\ruanjian\neon-snake-girl\neon-snake-girl\gradle-build.log"
