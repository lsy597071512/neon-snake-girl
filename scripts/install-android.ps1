# Install JDK 17, Android SDK (C:\Android\Sdk), and Android Studio
$ErrorActionPreference = 'Stop'

$SdkRoot = 'C:\Android\Sdk'
$StudioDir = 'C:\Program Files\Android\Android Studio'

Write-Host '=== Step 1: OpenJDK 17 ===' -ForegroundColor Cyan
winget install -e --id Microsoft.OpenJDK.17 --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
if ($LASTEXITCODE -gt 1) { Write-Host 'JDK install skipped or already present' }

$javaHome = $null
$found = Get-ChildItem 'C:\Program Files\Microsoft\' -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if ($found) { $javaHome = $found.FullName }
if (-not $javaHome) {
  $found = Get-ChildItem 'C:\Program Files\Microsoft\' -Directory -Filter 'jdk-*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if ($found) { $javaHome = $found.FullName }
}
if ($javaHome -and (Test-Path $javaHome)) {
  [Environment]::SetEnvironmentVariable('JAVA_HOME', $javaHome, 'User')
  $env:JAVA_HOME = $javaHome
  Write-Host "JAVA_HOME=$javaHome"
}

Write-Host '=== Step 2: Android command-line tools ===' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $SdkRoot | Out-Null
$sdkmanagerPath = Join-Path $SdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path $sdkmanagerPath)) {
  $zip = Join-Path $env:TEMP 'commandlinetools-win.zip'
  $toolsUrl = 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip'
  Write-Host "Downloading $toolsUrl"
  Invoke-WebRequest -Uri $toolsUrl -OutFile $zip -UseBasicParsing
  $extract = Join-Path $env:TEMP 'android-cmdline-tools'
  if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $extract -Force
  New-Item -ItemType Directory -Force -Path (Join-Path $SdkRoot 'cmdline-tools\latest') | Out-Null
  Copy-Item -Path (Join-Path $extract 'cmdline-tools\*') -Destination (Join-Path $SdkRoot 'cmdline-tools\latest') -Recurse -Force
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
}

$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $SdkRoot, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $SdkRoot, 'User')

Write-Host '=== Step 3: SDK packages ===' -ForegroundColor Cyan
$yes = ('y' * 200) -join [Environment]::NewLine
$packages = @('platform-tools', 'platforms;android-36', 'build-tools;36.0.0')
foreach ($pkg in $packages) {
  Write-Host "Installing $pkg"
  $yes | & $sdkmanagerPath --sdk_root=$SdkRoot $pkg
}

Write-Host '=== Step 4: Android Studio ===' -ForegroundColor Cyan
if (-not (Test-Path $StudioDir)) {
  winget install -e --id Google.AndroidStudio --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
} else {
  Write-Host 'Android Studio already installed'
}

Write-Host ''
Write-Host "SDK root: $SdkRoot" -ForegroundColor Green
Write-Host "Android Studio: $StudioDir" -ForegroundColor Green
