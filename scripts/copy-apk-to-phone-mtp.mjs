/**
 * Copy APK into phone MTP folder via Windows Shell.Application.
 * Usage: node scripts/copy-apk-to-phone-mtp.mjs [apkPath]
 * Target: Redmi K70E → internal storage → UCDownloads
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apkPath = path.resolve(
  process.argv[2] ||
    path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
);

if (!fs.existsSync(apkPath)) {
  console.error('APK not found:', apkPath);
  process.exit(1);
}

const destName = 'rust-belt-era-debug.apk';
const staging = path.join(root, 'tmp', destName);
fs.mkdirSync(path.dirname(staging), { recursive: true });
fs.copyFileSync(apkPath, staging);

const ps = `
$ErrorActionPreference = 'Stop'
$apk = '${staging.replace(/'/g, "''")}'
$shell = New-Object -ComObject Shell.Application
$computer = $shell.NameSpace(17)
$device = $null
foreach ($item in $computer.Items()) {
  $n = [string]$item.Name
  if ($n -match 'Redmi|K70|Xiaomi|Mi ') { $device = $item; break }
}
if (-not $device) { throw 'Phone not found (Redmi/K70). Keep USB file transfer mode on.' }

$storage = $null
foreach ($s in $device.GetFolder.Items()) {
  $n = [string]$s.Name
  Write-Host ('storage-candidate: ' + $n)
  if ($n -match 'Internal|shared|storage|SD') { $storage = $s; break }
  # Chinese "nei bu cun chu" may garbled; take first folder if only one
}
if (-not $storage) {
  $kids = @($device.GetFolder.Items())
  Write-Host ('storage-kids: ' + $kids.Count)
  if ($kids.Count -ge 1) { $storage = $kids[0] }
}
if (-not $storage) { throw 'Internal storage not found.' }
Write-Host ('using-storage: ' + $storage.Name)

$uc = $null
foreach ($f in $storage.GetFolder.Items()) {
  $n = [string]$f.Name
  if ($n -eq 'UCDownloads') { $uc = $f; break }
}
if (-not $uc) {
  $names = @()
  foreach ($f in $storage.GetFolder.Items()) { $names += [string]$f.Name }
  throw ('UCDownloads not found. Top folders: ' + ($names -join ', '))
}
Write-Host ('using-folder: ' + $uc.Name)

$destFolder = $uc.GetFolder
$before = @{}
foreach ($f in $destFolder.Items()) { $before[[string]$f.Name] = $true }

$destFolder.CopyHere($apk, 20)
$deadline = (Get-Date).AddMinutes(8)
$found = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  foreach ($f in $destFolder.Items()) {
    $name = [string]$f.Name
    if ($name -like '*.apk') {
      if (-not $before.ContainsKey($name) -or $name -eq 'rust-belt-era-debug.apk' -or $name -eq 'app-debug.apk') {
        $found = $name
        break
      }
    }
  }
  if ($found) { break }
  Write-Host 'waiting-mtp-copy...'
}
if (-not $found) { throw 'MTP copy timed out. Try copy manually from Desktop rust-belt-era-apk.' }
Write-Host ('OK: UCDownloads\\\\' + $found)
`;

const tmpPs1 = path.join(root, 'tmp', '_copy-apk-mtp.ps1');
// UTF-16 LE BOM so Windows PowerShell 5.x parses ASCII/Unicode safely
fs.writeFileSync(tmpPs1, `\uFEFF${ps}`, { encoding: 'utf16le' });

console.log('APK:', apkPath);
console.log('Staging:', staging);
console.log('Target: Redmi K70E / Internal / UCDownloads /', destName);

const r = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs1],
  { encoding: 'utf8', cwd: root },
);
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.status ?? 1);
