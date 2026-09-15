# ============================================================
# 锈带纪元 · 网关一键部署（开发者专用，只需跑这一条）
#   powershell: .\scripts\deploy-gateway.ps1
# 自动完成：登录检查 → 建 D1 → 建表 → 生成并写入密钥 → 部署 →
#           保存网关地址到 gateway\.secrets.local.json → 回填客户端地址
# ============================================================
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$gw = Join-Path $root 'gateway'
$secretsFile = Join-Path $gw '.secrets.local.json'

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }

Set-Location $root

function Get-RandomSecret {
  $bytes = New-Object byte[] 36
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes).Replace('+', 'a').Replace('/', 'b').Replace('=', 'c')
}

Step '检查 wrangler（首次会自动下载，约 1 分钟）'
$npx = Join-Path $root 'node_modules\wrangler\bin\wrangler.js'
if (-not (Test-Path $npx)) {
  Write-Host '    正在安装 wrangler（约 1 分钟，请勿关闭窗口）…'
  & npm.cmd install -D wrangler --no-fund --loglevel=error | Out-Null
  if (-not (Test-Path (Join-Path $root 'node_modules\wrangler\bin\wrangler.js'))) {
    Write-Host 'wrangler 安装失败，请手动执行: npm.cmd i -D wrangler' -ForegroundColor Red
    exit 1
  }
  Write-Host '    安装完成'
}
function Wrangler { & node $npx @args; if ($LASTEXITCODE -ne 0) { throw "wrangler $args 失败" } }

Step '登录状态检查（如弹出浏览器请完成授权）'
$who = & node $npx whoami 2>&1 | Out-String
# 注意：wrangler whoami 未登录时退出码也是 0，必须按输出内容判断
if ($who -match 'not authenticated' -or $who -match 'Please run .?wrangler login') {
  Write-Host '未登录：正在打开浏览器授权（请在页面点击 Allow）…' -ForegroundColor Yellow
  $loginOut = & node $npx login 2>&1 | Out-String
  Write-Host $loginOut
  $who = & node $npx whoami 2>&1 | Out-String
  if ($who -match 'not authenticated') { throw '登录未完成：请重跑脚本，并在浏览器完成 Cloudflare 授权' }
}
Info "已登录: $($who.Trim())"

Step '创建 D1 数据库（已存在则复用）'
$d1list = & node $npx d1 list 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "d1 list 失败（未登录或网络问题）：$d1list" }
$dbId = $null
if ($d1list -match 'rust-belt-license') {
  Info '数据库已存在，复用'
  foreach ($line in ($d1list -split "`n")) {
    if ($line -match 'rust-belt-license' -and $line -match '([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})') { $dbId = $Matches[1]; break }
  }
} else {
  $created = & node $npx d1 create rust-belt-license 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "d1 create 失败：$created" }
  Info ($created.Trim())
  if ($created -match 'database_id\s*=?\s*([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})' -or $created -match '([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})') { $dbId = $Matches[1] }
}
if (-not $dbId) { Write-Host '未能获取 database_id，请手动填入 gateway\wrangler.toml 后重跑' -ForegroundColor Red; exit 1 }

Step "回填 database_id 到 wrangler.toml（$dbId）"
$toml = Join-Path $gw 'wrangler.toml'
(Get-Content $toml -Raw) -replace 'database_id = ".*"', "database_id = `"$dbId`"" | Set-Content $toml -Encoding ASCII

Step '建表'
& node $npx d1 execute rust-belt-license --remote --file=schema.sql
if ($LASTEXITCODE -ne 0) { throw '建表失败' }

Step '生成/复用密钥'
if (Test-Path $secretsFile) {
  $sec = Get-Content $secretsFile -Raw | ConvertFrom-Json
  Info '复用已保存的密钥（gateway\.secrets.local.json）'
} else {
  $sec = [PSCustomObject]@{
    LICENSE_SECRET = Get-RandomSecret
    ADMIN_KEY      = Get-RandomSecret
    url            = ''
  }
}

Step '部署 Worker（首次部署会自动创建 Worker）'
$deployOut = & node $npx deploy 2>&1 | Out-String
Write-Host $deployOut
$workerUrl = $null
foreach ($line in ($deployOut -split "`n")) {
  if ($line -match '(https://[a-z0-9-]+\.workers\.dev)') { $workerUrl = $Matches[1]; break }
}
if (-not $workerUrl) { Write-Host '未能从部署输出解析 URL，请手动查看上方输出' -ForegroundColor Yellow }
else { Info "Worker 地址: $workerUrl" }

Step '写入密钥（Worker 已存在）'
$sec.LICENSE_SECRET | & node $npx secret put LICENSE_SECRET --name rust-belt-license
if ($LASTEXITCODE -ne 0) { throw '写入 LICENSE_SECRET 失败' }
$sec.ADMIN_KEY | & node $npx secret put ADMIN_KEY --name rust-belt-license
if ($LASTEXITCODE -ne 0) { throw '写入 ADMIN_KEY 失败' }

Step '保存本地凭据（gateway\.secrets.local.json · 已被 git 忽略请勿外传）'
$sec.url = $workerUrl
$sec | ConvertTo-Json | Set-Content $secretsFile -Encoding UTF8

Step '回填客户端网关地址（src/platform/license.ts）'
if ($workerUrl) {
  $licenseTs = Join-Path $root 'src\platform\license.ts'
  $lc = Get-Content $licenseTs -Raw -Encoding UTF8
  $lc = $lc -replace "'https://rust-belt-license\.YOUR-SUBDOMAIN\.workers\.dev'", "'$workerUrl'"
  [System.IO.File]::WriteAllText($licenseTs, $lc, (New-Object System.Text.UTF8Encoding($false)))
  Info '已替换 GATEWAY_URLS'
}

Step '连通性验证'
if ($workerUrl) {
  try { $ping = Invoke-RestMethod "$workerUrl/api/ping" -TimeoutSec 20; Info "ping → $($ping | ConvertTo-Json -Compress)" }
  catch { Write-Host 'ping 失败（可能网络未通），稍后可手动验证' -ForegroundColor Yellow }
}

Write-Host ''
Write-Host '==================== 部署完成 ====================' -ForegroundColor Green
Write-Host "网关地址: $workerUrl"
Write-Host "ADMIN_KEY: $($sec.ADMIN_KEY)   （已存 gateway\.secrets.local.json，管理命令会自动读取）"
Write-Host ''
Write-Host '接下来：'
Write-Host '  1. 给玩家开户:  node scripts\manage-players.mjs --add 玩家昵称'
Write-Host '  2. 重新打包 APK（网关地址已自动回填进客户端）'
Write-Host '  3. 玩家首启输入「昵称 + 自己的千问Key」即可进入游戏'
Write-Host '==================================================' -ForegroundColor Green
