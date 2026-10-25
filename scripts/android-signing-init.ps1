<#
  android-signing-init.ps1
  Generate / restore the Android release keystore + android/key.properties.

  Rule:
    - keystore exists -> reuse it (NEVER overwrite), only regenerate key.properties
    - keystore missing -> create one ONCE, then back it up immediately

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android-signing-init.ps1 `
      -StorePassword "xxx" -KeyPassword "xxx"
#>
[CmdletBinding()]
param(
  [string]$StorePassword,
  [string]$KeyPassword,
  [string]$Alias = 'rustbelt',
  [string]$ValidityDays = '10000'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$ksDir = Join-Path $repoRoot 'android\keystore'
$ksPath = Join-Path $ksDir 'rust-belt-era.jks'
$propsPath = Join-Path $repoRoot 'android\key.properties'

function Read-Secret {
  param([string]$Value, [string]$Prompt)
  if ($Value) { return $Value }
  $secure = Read-Host $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}

$StorePassword = Read-Secret $StorePassword 'keystore password'
$KeyPassword = Read-Secret $KeyPassword 'key password'

# locate keytool
$keytool = $null
$jdkCandidates = @()
if ($env:JAVA_HOME) { $jdkCandidates += (Join-Path $env:JAVA_HOME 'bin\keytool.exe') }
if ($env:ProgramFiles) { $jdkCandidates += (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr\bin\keytool.exe') }
if ($env:LOCALAPPDATA) { $jdkCandidates += (Join-Path $env:LOCALAPPDATA 'Programs\Android\Android Studio\jbr\bin\keytool.exe') }
$keytool = $jdkCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $keytool) { $keytool = (Get-Command keytool -ErrorAction SilentlyContinue).Source }
if (-not $keytool) {
  throw 'keytool not found. Install Android Studio or set JAVA_HOME to JDK 17+.'
}

if (Test-Path $ksPath) {
  Write-Host "[=] keystore already exists, keep it (do NOT recreate): $ksPath"
  Write-Host '[=] If this came from the old machine, the signature matches the live build. Safe to build overlay installs.'
} else {
  # 防呆：如果仓库里存在已知正确的备份钥匙，却要新建，极可能是「换电脑忘带钥匙」。
  # 新建 = 生成一把全新签名 = 所有老玩家无法覆盖安装。这里必须强提醒。
  $backupCandidates = @(
    (Join-Path $repoRoot 'keybackup-xiudai-2026-10-18\rust-belt-era.jks'),
    (Join-Path $repoRoot 'keybackup\rust-belt-era.jks')
  )
  $existingBackup = $backupCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($existingBackup) {
    Write-Host ''
    Write-Host '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' -ForegroundColor Red
    Write-Host "[!] 检测到正确签名的备份钥匙: $existingBackup" -ForegroundColor Yellow
    Write-Host '    但 android/keystore/ 下没有钥匙。' -ForegroundColor Yellow
    Write-Host '    直接新建会生成一把【全新签名】→ 所有老玩家无法覆盖安装、只能重装丢档！' -ForegroundColor Yellow
    Write-Host '    正确做法：从上面的备份恢复，而不是新建。' -ForegroundColor Yellow
    Write-Host '    若你确认这是一台全新项目的首发机（没有任何线上玩家），可忽略此警告。' -ForegroundColor Yellow
    Write-Host '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' -ForegroundColor Red
    Write-Host ''
  }

  New-Item -ItemType Directory -Force -Path $ksDir | Out-Null
  Write-Host "[+] creating new keystore: $ksPath"
  Write-Host '[!] THIS HAPPENS ONLY ONCE. Back it up now; losing it means overlay updates are impossible forever.'
  & $keytool -genkeypair -v `
    -keystore $ksPath `
    -alias $Alias `
    -keyalg RSA -keysize 2048 -validity $ValidityDays `
    -storetype PKCS12 `
    -storepass $StorePassword -keypass $KeyPassword `
    -dname 'CN=Rust Belt Era, OU=Game, O=RustBelt, L=CN, ST=CN, C=CN' | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'keytool failed to create keystore.' }
}

$relKs = 'keystore/rust-belt-era.jks'

if (Test-Path $propsPath) {
  Copy-Item $propsPath "$propsPath.bak" -Force
  Write-Host '[=] existing key.properties backed up to key.properties.bak'
}

$nl = [Environment]::NewLine
$props = '# private file, never commit. Move android\keystore\rust-belt-era.jks + this file to a new machine to keep the same signature.' + $nl `
  + "storeFile=$relKs" + $nl `
  + "storePassword=$StorePassword" + $nl `
  + "keyAlias=$Alias" + $nl `
  + "keyPassword=$KeyPassword" + $nl
[System.IO.File]::WriteAllText($propsPath, $props, [System.Text.Encoding]::UTF8)
Write-Host "[+] wrote $propsPath"

Write-Host ''
Write-Host 'Next: verify the fingerprint on every build machine:'
Write-Host '  cd android; .\gradlew.bat :app:printReleaseSigning'
Write-Host 'All machines must print the exact same SHA-256.'