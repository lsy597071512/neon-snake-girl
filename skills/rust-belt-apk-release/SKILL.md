---
name: rust-belt-apk-release
description: 锈带纪元（rust-belt-era）签名 release APK 打包。当用户要求「打 APK / 打包 / 出安装包 / 签名打包 / 发版」时使用。权威规范见项目内 docs/apk-release-build.md。包含完整合规链路（P0 瘦身、签名指纹校验、apksigner 验证、桌面输出），以及「安全软件实时扫描导致 copyFileSync 永久卡死」的诊断与 robocopy 绕行方案。
agent_created: true
---

# 锈带纪元 签名 Release APK 打包

> **本项目内的权威文档：`docs/apk-release-build.md`**（主目录 `C:\Users\admin\Desktop\neon-snake-girl\neon-snake-girl\docs\apk-release-build.md`）。
> 动手前先读它。本 Skill 是给 Agent 的可执行摘要，两者内容必须同步。

## 项目位置（第一步别搞错）

真实工程在 **`C:\Users\admin\Desktop\neon-snake-girl\neon-snake-girl`**。

WorkBuddy 的 workspace（如 `...\Worktrees\neon-snake-girl\main-76b8efb8`）是**剥离版 Git 快照**，缺 `tex/`、`tex-ship/`、`dist/`、`android/keystore/`、`key.properties`、`scripts/lib/signing-expected.cjs` 等，**打不出合规包**。必须去主目录。

## 三条绝对红线

| ❌ | 原因 |
|---|---|
| 交付 debug 包 | 签名不同，覆盖安装报 `安装失败(-7)`，玩家丢存档 |
| 随手删 `dist/` | `ensure-tex-sync` 判失同步 → 重编 4396MB 资源，几十分钟 |
| 同一卡死命令重跑 >1 次 | 第 2 次也不会好，采样 CPU 后立刻换方案 |

## 本机工具陷阱（先读，省时间）

1. **Bash 工具不可用** —— `dirname` / `ls` / `mkdir` / `sha256sum` 全部 `command not found`。只用 PowerShell。
2. **PowerShell 不回显 stdout** —— 输出必须 `Out-File` / `Set-Content` 到文件，再 Read 读回。
3. **`if(){}else{} | Out-File` 管道优先级有坑** —— 先算好字符串变量再 `Set-Content`。

## 头号故障：copyFileSync 永久卡死

### 症状（三件套同时出现即确诊）
- `vite build` 停在 `266 modules transformed.`
- `npx cap sync android` 拷几十个文件后不动
- **进程 CPU 时间完全冻结**（间隔 20s 采样两次，数值一模一样）
- 无报错、文件数不涨、日志不输出

### 30 秒确诊
```powershell
Get-Process node | Select-Object Id, CPU, StartTime
$c1=(Get-Process -Id <PID>).CPU; Start-Sleep 20; $c2=(Get-Process -Id <PID>).CPU
# c1 == c2 → 环境级 I/O 阻塞，立刻换方案，别再重试
Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct |
  Select displayName, productState      # 266240 = 实时防护开启
Get-Service WSearch, WinDefend
```
本机实测：**腾讯电脑管家系统防护开启**，Windows Defender 已 Stopped。
旁证：手动 `Move-Item` 整个 464MB 目录仅 0.01s → 无文件锁，纯注入式扫描。

## 可靠链路（默认走这条，实测约 2.5 分钟）

### 步骤 0 — 前置校验
```powershell
$root="C:\Users\admin\Desktop\neon-snake-girl\neon-snake-girl"; cd $root
node scripts/build-apk-android-signing-check.cjs   # 必须 PASS
node scripts/check-cloud-assets.mjs                # 四处 hash 必须先对齐
```
hash 不齐 → 核对本地文件 SHA-256 与 manifest 一致后，`npm run assets:sync-cloud`。

### 步骤 1 — 构建前端（~20s）
```powershell
npx vite build *>&1 | Out-File "$root\vite.log" -Encoding UTF8
```
成功标志：末行 `[vite] SHIP_P0_ONLY: 1163 P0 files + 2 manifests → dist/tex`，`dist/tex` 共 1165 文件。

- **不要用 `npm run build`**（触发嵌套 `prebuild`，可能重编资源）。类型检查单独跑 `npx tsc`。

### 步骤 2 — 同步到 Android（robocopy，~40s）
```powershell
robocopy "$root\dist" "$root\android\app\src\main\assets\public" /MIR /R:2 /W:1 /MT:8 /NFL /NDL /NJH /NJS /NP
```
- **用 robocopy 替代 `npx cap sync android`**，这是绕开扫描的核心手法。
- `rc=3` 是**正常成功码**（有文件被复制），不是错误。
- 校验：dst 与 src 均 **1830 files / 525.9MB**（android public 侧 1832），且 `...\public\tex\ship-manifest.json` 存在。
- `capacitor.config.json` 一般已由历史 sync 写好；若缺，可先跑一次 `npx cap sync android` 让配置阶段完成，中断在拷贝阶段无妨。

### 步骤 3 — 美术门禁（~5s）
```powershell
node scripts/verify-ship-gate.mjs --android
```
必须三行 `OK`：`tex-ship` / `dist/tex` / **`android public tex`**。第三行是关键，证明 robocopy 产物同样合规。

### 步骤 4 — 打包（~35s）
```powershell
node scripts/build-apk.cjs release
```
内部：`verifyDistP0Only()` → `assembleRelease` → 700MB 门禁 → `apksigner` 验签 → 复制桌面 → 写 `build-stamp.json`。

## 产物与验收

- 路径：`C:\Users\admin\Desktop\rust-belt-era-apk\rust-belt-era-release.apk`（约 520MB，上限 700MB）
- 戳记：同目录 `build-stamp.json`（sha256 / versionCode / bundledContentHash）
- **独立验签**（不能只信构建脚本自证）：
```powershell
$bt=Get-ChildItem "C:\Users\admin\AppData\Local\Android\Sdk\build-tools" -Directory |
    Sort-Object Name -Descending | Select-Object -First 1
$jbr="C:\Program Files\Android\Android Studio\jbr"
$env:JAVA_HOME=$jbr; $env:PATH="$jbr\bin;$env:PATH"
& "$($bt.FullName)\apksigner.bat" verify --verbose --print-certs `
  "C:\Users\admin\Desktop\rust-belt-era-apk\rust-belt-era-release.apk"
```
期望：`Verifies` + `Number of signers: 1` + `SHA-256 digest: a7ac65c2ee91698133034169c9a51f526d5045be2c76468ffc60e6293e8af240`

## 玩家端云端缓存生命周期（2026-10-25 起）

P1/P2 玩家缓存三道一致性机制（详见 `docs/apk-release-build.md` § 6.1）：

- **下载索引事务**（`withIndex`）：并发索引读改写串行化，杜绝"下载 100% 但索引丢条目 → 覆盖安装后重下 2.5GB"
- **启动自愈**（`initAssetCache`）：盘上有、索引无的成品按清单 size 采纳，换包不重下
- **孤儿清理**（`pruneOrphanCacheFiles`）：缓存里不在当前生效清单中的文件自动删除；仅版本门确认清单权威后触发（服务端不可达/远端清单拉取失败绝不清理）

开发侧删除 P1/P2 资源 → 走通道③ `npm run assets:sync-cloud` → 玩家下次启动自动清理，无需额外机制。

## 签名（单一真源）

- 指纹常量：`scripts/lib/signing-expected.cjs` → `EXPECTED_RELEASE_SHA256`
- keystore：`android/keystore/rust-belt-era.jks`，alias `rustbelt`（PKCS12，RSA 2048）
- 凭据：`android/key.properties`（**永不入库**）
- DN：`CN=Rust Belt Era, OU=Game, O=RustBelt, L=CN, ST=CN, C=CN`
- 换电脑打包前，必须拷贝 `android/keystore/` + `android/key.properties` 两份文件
- 没有 keystore 时先 `npm run android:signing:init`（不会覆盖已有 keystore）
- 发版前递增 `android/app/build.gradle` 的 `versionCode`

## 环境要求

JDK **21**（Android Studio JBR；系统 JAVA_HOME 为 17 会报 `无效的源发行版: 21`）· Gradle 8.14.3 · AGP 8.13 · build-tools 36.0.0 · 磁盘 ≥40GB 空闲。

## 长期解法

把 `C:\Users\admin\Desktop\neon-snake-girl\neon-snake-girl`（或至少 `dist`、`android\build`、`android\app\build`、`android\app\src\main\assets`）加入腾讯电脑管家**信任区**，之后 `npm run build:apk:release` 一条命令即可跑通。
