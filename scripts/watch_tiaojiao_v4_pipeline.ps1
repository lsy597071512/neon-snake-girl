# Persistent watchdog for tentacle discipline v4 H3 pipeline.
# - Keeps ONE ComfyUI on 127.0.0.1:8188 (Minimized, no stdout redirect)
# - Keeps the Python batch running with --character all (resume / skip done)
# - Survives Cursor chat disconnects; do NOT close the minimized Comfy window
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\watch_tiaojiao_v4_pipeline.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\watch_tiaojiao_v4_pipeline.ps1 -Characters "SSR05_1,SR01_3"

param(
  [string]$Characters = "UR04_1,UR03_1,SSR05_1,SSR04_1,SSR03_1,SSR02_1,SSR01_1,SR05_1,SR04_1,SR03_1,SR02_1,SR01_3,SR01_2",
  [string]$Python = "E:\MiniMaxH3\venv\Scripts\python.exe",
  [string]$ComfyMain = "E:\MiniMaxH3\ComfyUI\main.py",
  [string]$ComfyCwd = "E:\MiniMaxH3\ComfyUI",
  [string]$Repo = "",
  [int]$PollSeconds = 30
)

$ErrorActionPreference = "Continue"
if ([string]::IsNullOrWhiteSpace($Repo)) {
  $Repo = Split-Path -Parent $PSScriptRoot
}
$Repo = [System.IO.Path]::GetFullPath($Repo)
$OutDir = Join-Path $Repo "tex\juese\pifu\pifu_weizhi\webm_tentacle_loop_v4_stages"
$SourceDir = Join-Path $Repo "tex\juese\pifu\pifu_weizhi\webm_tentacle_loop"
$BatchScript = Join-Path $Repo "scripts\run_minimax_h3_tiaojiao_stages_v4_trial.py"
$LogDir = Join-Path $OutDir "_watch"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$WatchLog = Join-Path $LogDir ("watch_{0:yyyyMMdd_HHmmss}.log" -f (Get-Date))

function Write-Log([string]$msg) {
  $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg
  Write-Host $line
  Add-Content -Path $WatchLog -Value $line -Encoding UTF8
}

function Test-Comfy {
  try {
    Invoke-RestMethod "http://127.0.0.1:8188/system_stats" -TimeoutSec 5 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Ensure-Comfy {
  if (Test-Comfy) { return }
  Write-Log "Comfy DOWN — restarting (Minimized, no redirect)"
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match 'ComfyUI\\main.py' } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Log "killed stale Comfy pid=$($_.ProcessId)"
    }
  Start-Sleep 2
  Start-Process -FilePath $Python `
    -ArgumentList @($ComfyMain, "--listen", "127.0.0.1", "--port", "8188") `
    -WorkingDirectory $ComfyCwd `
    -WindowStyle Minimized | Out-Null
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep 5
    if (Test-Comfy) {
      Write-Log "COMFY_OK after $($i*5)s"
      return
    }
    Write-Log "waiting Comfy $($i*5)s..."
  }
  Write-Log "FAILED to start Comfy"
}

function Get-BatchProcs {
  # venv Scripts\python.exe stubs re-exec a child with the same cmdline — count roots only.
  $all = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^python(\.exe)?$' -and
    $_.CommandLine -match 'run_minimax_h3_tiaojiao_stages_v4_trial\.py'
  })
  $ids = @{}
  foreach ($p in $all) { $ids[$p.ProcessId] = $true }
  @($all | Where-Object { -not $ids.ContainsKey($_.ParentProcessId) })
}

function Test-PipelineInputs {
  if (-not (Test-Path $BatchScript)) {
    Write-Log "batch script missing: $BatchScript"
    return $false
  }
  if (-not (Test-Path $SourceDir)) {
    Write-Log "source still directory missing: $SourceDir"
    return $false
  }
  $sourceCount = @(Get-ChildItem -Path $SourceDir -Recurse -File -Include "*_tentacle_first.png", "*.png" -ErrorAction SilentlyContinue).Count
  if ($sourceCount -eq 0) {
    Write-Log "no source stills found under $SourceDir"
    return $false
  }
  return $true
}

function Ensure-Batch {
  $procs = @(Get-BatchProcs)
  if ($procs.Count -gt 0) {
    return
  }
  if (-not (Test-PipelineInputs)) {
    return
  }
  if (-not (Test-Comfy)) {
    Write-Log "skip batch start — Comfy not ready"
    return
  }
  $lock = Join-Path $LogDir "batch.start.lock"
  try {
    $fs = [System.IO.File]::Open($lock, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $fs.Close()
  } catch {
    Write-Log "batch start lock held — skip"
    return
  }
  try {
    $batchLog = Join-Path $OutDir ("_run_all_{0:yyyyMMdd_HHmmss}.log" -f (Get-Date))
    Write-Log "starting batch characters=$Characters log=$batchLog"
    $arg = @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      "& '$Python' -u '$BatchScript' --character '$Characters' --stem all 2>&1 | Tee-Object -FilePath '$batchLog'"
    )
    Start-Process -FilePath "powershell.exe" -ArgumentList $arg -WindowStyle Minimized | Out-Null
    Start-Sleep 5
    $procs = @(Get-BatchProcs)
    Write-Log "batch procs=$($procs.Count)"
  } finally {
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
  }
}

Write-Log "watch start Characters=$Characters Poll=${PollSeconds}s"
Write-Log "repo=$Repo out=$OutDir"

while ($true) {
  try {
    Ensure-Comfy
    Ensure-Batch
    $doneWebm = @(Get-ChildItem $OutDir -Filter "*_stage*_tentacle_loop.webm" -ErrorAction SilentlyContinue).Count
    $state = Join-Path $OutDir "_pipeline_state.json"
    $last = if (Test-Path $state) { (Get-Content $state -Raw | ConvertFrom-Json).last_stem } else { "-" }
    Write-Log "heartbeat webm=$doneWebm last_stem=$last comfy=$(Test-Comfy) batch=$((Get-BatchProcs).Count)"
  } catch {
    Write-Log "watch error: $_"
  }
  Start-Sleep $PollSeconds
}
