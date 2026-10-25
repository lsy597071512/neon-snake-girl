# APK 打包规范与故障手册（签名 Release）

> **本文档是打包的唯一权威来源。** 任何 AI Agent / 开发者 / 新电脑接手本项目，要打 APK 请**先读完本篇再动手**。
> 本文档同时以 Skill 形式存在于 `skills/rust-belt-apk-release/SKILL.md`，两者内容必须保持一致。
>
> **最后更新**：2026-10-25（新增：玩家端云端缓存生命周期——下载索引事务 / 启动自愈 / 孤儿清理；P0 数量随标题页静帧更新为 1163）

---

## 0. 先看这三个「绝对不能做」

| ❌ 禁止 | 原因 |
|---|---|
| **交付 debug 包** | 签名与 release 不同，覆盖安装会报 `安装失败(-7)`，玩家丢存档 |
| **随手删 `dist/`** | `ensure-tex-sync.mjs` 见 `dist/tex/ship-manifest.json` 缺失即判失同步，触发 `build-tex-ship.mjs` 重编 **4396MB** 资源，一次几十分钟 |
| **同一命令连续重跑超过 1 次** | 若卡死，第 2 次也不会好。采样 CPU 确认后立刻换方案（见第 4 节） |

---

## 1. 签名规范（单一真源）

| 项目 | 值 |
|---|---|
| 期望证书 SHA-256 | `A7AC65C2EE91698133034169C9A51F526D5045BE2C76468FFC60E6293E8AF240` |
| 常量定义 | `scripts/lib/signing-expected.cjs` → `EXPECTED_RELEASE_SHA256` |
| 校验脚本 | `scripts/build-apk-android-signing-check.cjs`（`npm run android:signing:check`） |
| keystore | `android/keystore/rust-belt-era.jks`，alias `rustbelt`（PKCS12） |
| 凭据 | `android/key.properties`（**永不入库**） |
| 证书 DN | `CN=Rust Belt Era, OU=Game, O=RustBelt, L=CN, ST=CN, C=CN` · RSA 2048 |

### 为什么指纹是硬红线

全项目**只有这一个证书**。任何人换了签名，已装玩家的 APK 无法覆盖升级，必须卸载重装 —— 存档全丢。所以：

1. **没有 keystore 就不要打包**，先 `npm run android:signing:init`（该脚本**不会覆盖已有 keystore**）。
2. 换电脑打包前，必须先拷贝 `android/keystore/` + `android/key.properties` 两份文件过来。
3. 打完后**必须用 `apksigner` 独立验签**（第 5 节），不能只信构建脚本自己打印的日志。

---

## 2. 标准链路（管家的实时扫描已加入信任区时用这条）

```bash
npm run build:apk:release
```

内部顺序：

```
cloud:check            云端敏感信息检查
  → icons:apply        应用图标
  → android:signing:check   指纹校验（失败即中止）
  → assets:check-cloud      本地/云端/B2/gateway 四处 hash 对齐
  → cap:sync            prebuild（ensure-ui-assets / ensure-tex-sync / ship-gate / ship-p2）
                        + tsc + vite build + cap sync android + assets:verify:android
  → assets:verify:android
  → build-apk.cjs release
        verifyDistP0Only()   进包前确认 dist/tex 只有 P0，混入 P1/P2 直接中止
        assembleRelease      Gradle 8.14.3 + AGP 8.13 + JDK 21
        700MB 体积门禁        超过即中止（历史事故：漏设 SHIP_FULL_TEX → APK 3GB）
        apksigner 验签
        复制到桌面 + 写 build-stamp.json
```

**产物**：`C:\Users\admin\Desktop\rust-belt-era-apk\rust-belt-era-release.apk`（约 520MB）+ 同目录 `build-stamp.json`。

### 环境要求

| 项 | 要求 |
|---|---|
| JDK | **21**（用 Android Studio JBR；系统 `JAVA_HOME` 若是 17 会报 `无效的源发行版: 21`） |
| Gradle | 8.14.3（gradle-wrapper 自带） |
| Android Gradle Plugin | 8.13 |
| build-tools | 36.0.0 |
| 磁盘 | 至少 40GB 空闲（C 盘紧张时先清 `android/build`、旧 `dist`） |

---

## 3. 已知最大障碍：安全软件实时扫描导致打包永久卡死

### 3.1 症状（三件套同时出现即确诊）

1. `vite build` 停在 `266 modules transformed.` 不动
2. `npx cap sync android` 拷几十个文件后不动
3. **进程 CPU 时间完全冻结**（间隔 20–25 秒采样两次，数值一模一样）

文件数不涨、日志不输出、没有任何报错。表现为「假死」，极易误判成代码问题或文件锁。

### 3.2 30 秒确诊法

```powershell
# 1) 找 node 进程并采样两次 CPU
Get-Process node | Select-Object Id, CPU, StartTime
$c1 = (Get-Process -Id <PID>).CPU; Start-Sleep 20; $c2 = (Get-Process -Id <PID>).CPU
#    c1 == c2 → 判定为「环境级 I/O 阻塞」，不是项目问题，立刻换方案

# 2) 确认是哪个安全软件在拦
Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct |
    Select-Object displayName, productState
Get-Service WSearch, WinDefend
```

`productState = 266240` 表示**实时防护开启**。本机实测为**腾讯电脑管家系统防护开启**、Windows Defender 已 Stopped。

**旁证（可选）**：手动 `Move-Item` 整个 464MB 的 `dist/tex` 只需 **0.01 秒** —— 证明没有任何文件锁，纯粹是注入式扫描在阻塞 `copyFileSync`。

### 3.3 根因

`fs.copyFileSync` 与 Capacitor 的递归拷贝会产生大量密集写操作，被实时扫描逐个拦截。文件越多、越大，卡得越确定。vite 一次写 1161 个文件、cap sync 要写 500MB+，正好踩满。

---

## 4. 绕行链路（默认用这条，实测约 2.5 分钟）

当 `npm run build:apk:release` 卡死时，**不要再重试**，拆分执行：

### 步骤 0 — 前置校验

```powershell
cd C:\Users\admin\Desktop\neon-snake-girl\neon-snake-girl
node scripts/build-apk-android-signing-check.cjs   # 必须通过，指纹见第 1 节
node scripts/check-cloud-assets.mjs                # 四处 hash 必须对齐
```
hash 不齐时：确认本地文件 SHA-256 与 manifest 一致后，跑 `npm run assets:sync-cloud`（会上传并改写 `assetHash`）。

### 步骤 1 — 构建前端（约 20 秒）

```powershell
npx vite build
```

成功标志：末行 `[vite] SHIP_P0_ONLY: 1163 P0 files + 2 manifests → dist/tex`，`dist/tex` 共 **1165** 个文件。

- **不要用 `npm run build`**：它会触发嵌套 `prebuild`，在串联场景下会让 `ensure-tex-sync` 重复判断，可能重编资源。
- 类型检查单独跑：`npx tsc`（应 `exit 0`）。

### 步骤 2 — 同步到 Android（robocopy，约 40 秒）

```powershell
robocopy "$root\dist" "$root\android\app\src\main\assets\public" `
    /MIR /R:2 /W:1 /MT:8 /NFL /NDL /NJH /NJS /NP
```

- **用 robocopy 替代 `npx cap sync android`**，这是绕开扫描卡死的核心手法。
- `rc=3` 是**正常成功码**（表示有文件被复制），不是错误。
- 校验：dst 与 src 均应 **1830 files / 525.9MB**（android public 侧因 capacitor 配置文件为 1832），且 `...\public\tex\ship-manifest.json` 存在。
- `capacitor.config.json` 通常已由历史成功的 sync 写好；若缺失，可先跑一次 `npx cap sync android` 让配置阶段完成（中断在拷贝阶段无妨）。

### 步骤 3 — 美术门禁（约 5 秒）

```powershell
node scripts/verify-ship-gate.mjs --android
```

必须出现三行 `OK`：

```
[verify-ship-gate] OK tex-ship: map=1066, policy=P2-mobile-ship
[verify-ship-gate] OK dist/tex: map=1066, policy=P2-mobile-ship
[verify-ship-gate] OK android public tex: map=1066, policy=P2-mobile-ship
```

第三行是关键 —— 它校验 robocopy 产物同样合规，绕行不会降低标准。

### 步骤 4 — 打包（约 35 秒）

```powershell
node scripts/build-apk.cjs release
```

期望末尾：`BUILD SUCCESSFUL` + `APK 体积: 520.0 MB（上限 700MB，通过）` + `签名指纹校验通过: A7AC65C2...` + 输出路径。

### 长期解法（推荐，一次性配置）

把以下目录加入安全软件「信任区 / 白名单」（腾讯电脑管家 → 病毒查杀 → 信任区）：

- `C:\Users\admin\Desktop\neon-snake-girl\neon-snake-girl`（整目录）
- 或至少 `dist`、`android\build`、`android\app\build`、`android\app\src\main\assets`

配好后第 2 节的一条命令即可跑通。

---

## 5. 验收（每次发版都要做）

### 5.1 独立验签（不信构建脚本的自证）

```powershell
$bt = Get-ChildItem "C:\Users\admin\AppData\Local\Android\Sdk\build-tools" -Directory |
      Sort-Object Name -Descending | Select-Object -First 1
$jbr = "C:\Program Files\Android\Android Studio\jbr"
$env:JAVA_HOME = $jbr; $env:PATH = "$jbr\bin;$env:PATH"
& "$($bt.FullName)\apksigner.bat" verify --verbose --print-certs `
    "C:\Users\admin\Desktop\rust-belt-era-apk\rust-belt-era-release.apk"
```

必须看到：

```
Verifies
Number of signers: 1
Signer #1 certificate SHA-256 digest: a7ac65c2ee91698133034169c9a51f526d5045be2c76468ffc60e6293e8af240
```

### 5.2 体积

≤ 700MB。历史正常值约 520MB。若明显膨胀，几乎一定是 `dist/tex` 混进了 P1/P2 —— 检查 `verifyDistP0Only` 是否被绕过。

### 5.3 构建戳记

读 `C:\Users\admin\Desktop\rust-belt-era-apk\build-stamp.json`，确认 `mode=release`、`versionCode`、`sha256`、`bundledContentHash` 与本次构建一致。

### 5.4 版本号

发版前确认 `android/app/build.gradle` 的 `versionCode` 已递增（每次发布都要加 1，否则无法覆盖升级）。

---

## 6. 资源分层速查（与 `asset-ship-pipeline.md` 配合）

| 层级 | 去向 | 说明 |
|---|---|---|
| P0 | **进 APK** | 首包必需，1163 个文件 |
| P1 / P2 | Backblaze B2 + CDN | 皮肤、视频等大件，运行时下载 |

- 分层依据：`tex-ship/ship-manifest-cdn.json` 的 `tier` 字段
- 源 `tex/`（只读）→ `tex-ship/`（优化产物）→ `dist/tex/`（进包）
- 逃生开关 `SHIP_FULL_TEX=1` / `ALLOW_FAT_APK=1` **仅限本地排障，禁止用于发布**

### 6.1 玩家端云端缓存生命周期（`src/platform/assetDownloader.ts`）

P1/P2 下载到玩家手机的缓存由三道机制保证一致性（2026-10-25 起）：

| 机制 | 作用 | 触发时机 |
|---|---|---|
| **下载索引事务**（`withIndex`） | 6 并发 worker 的索引"读改写"串行排队，杜绝并发丢写（历史事故：下载 100% 但索引丢条目 → 覆盖安装后全量重下 2.5GB） | 每次下载/校验/注册内部自动走 |
| **启动自愈**（`initAssetCache`） | 递归扫盘，"盘上存在、索引缺失"且 size 与清单一致的成品文件直接采纳进索引——换包/丢索引后不重下 | 每次 App 启动 |
| **孤儿清理**（`pruneOrphanCacheFiles`） | 删除缓存里**不在当前生效清单**中的成品文件——开发侧删除资源后，玩家更新时自动清理 | 版本门确认清单权威后（见下） |

**孤儿清理的安全铁律**（实现于 `src/platform/versionGate.ts`，改这块前必读）：

1. 只在两处"清单权威性确认点"触发：服务端 `assetHash === 包内 contentHash`（包内清单即最新），或弱更远端清单**拉取并应用成功**；
2. 服务端不可达 / 远端清单拉取失败时**绝不清理**（防止拿旧包内清单误杀弱更下发的资源）；
3. 生效清单为空表视为数据异常，直接放弃（宁可留垃圾不清仓）；
4. `.part` 传输中文件与 `index.json` 天然跳过；正在下载的目标必在清单内，不受影响。

**开发侧删除资源的发布操作**：删掉 `tex/` 中的 P1/P2 文件后，正常走通道③ `npm run assets:sync-cloud`（清单少条目 + `assetHash` 变化），玩家下次启动版本门检测差异 → 拉新清单 → 下载差异 + 自动清理孤儿。**无需任何额外下发机制。**

---

## 7. 耗时复盘（2026-10-24，反面教材，务必看）

某次打包耗时数小时，而 TRAE / Cursor 同类任务几分钟完成。**有效动作只有 4 步、合计约 2 分半**（vite 20s + robocopy 40s + 门禁 5s + gradle 35s）。时间全花在：

1. **反复验证错误假设**：先后怀疑 `dist/tex` 删除死锁、`prebuild` 嵌套、vite 配置问题，把同一个卡死的命令重跑了四遍。
2. **自造事故**：一次探测命令里把 `Remove-Item dist` 写在了 `vite build` 之前，把刚建好的成果自己删了，白跑一轮。

**教训（已写进第 3.2 节）**：遇到「无报错 + CPU 冻结」，采样两次 CPU 即可确诊是环境阻塞，**立刻换方案，不要重试，不要为了"确认根因"再做重复实验**。

---

## 8. 工具环境备注（Windows + WorkBuddy 特有）

| 现象 | 处理 |
|---|---|
| Bash 工具不可用（`dirname`/`ls`/`mkdir` 全 `command not found`） | 改用 PowerShell |
| PowerShell 工具不回显 stdout | 输出 `Out-File` / `Set-Content` 到文件，再用 Read 读回 |
| `if(){}else{} \| Out-File` 行为异常 | 先算好字符串变量，再 `Set-Content` |

以上仅为工具层适配，不影响构建本身。
