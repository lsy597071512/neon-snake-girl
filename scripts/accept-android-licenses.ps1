$SdkRoot = 'C:\Android\Sdk'
$sdkmanager = Join-Path $SdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot

$javaHome = 'C:\Program Files\Microsoft\jdk-17'
if (-not (Test-Path $javaHome)) {
  $found = Get-ChildItem 'C:\Program Files\Microsoft\' -Directory -Filter 'jdk-*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if ($found) { $javaHome = $found.FullName }
}
if ($javaHome -and (Test-Path $javaHome)) {
  $env:JAVA_HOME = $javaHome
}

Write-Host 'Accepting Android SDK licenses...'
$yes = ('y' * 300) -join [Environment]::NewLine
$yes | & $sdkmanager --sdk_root=$SdkRoot --licenses

Write-Host 'Installing SDK packages...'
$packages = @('platform-tools', 'platforms;android-36', 'build-tools;36.0.0')
foreach ($pkg in $packages) {
  Write-Host "Installing $pkg"
  $yes | & $sdkmanager --sdk_root=$SdkRoot $pkg
}

Write-Host 'Done.'
