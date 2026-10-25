const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'android');
const mode = (process.argv[2] || 'debug').toLowerCase();
const task = mode === 'release' ? ':app:assembleRelease' : ':app:assembleDebug';

// 发布包绝不允许全量 tex（会把 P1 皮肤 2.5GB 打进包，APK 膨胀到 3GB+）
if (mode === 'release' && process.env.SHIP_FULL_TEX === '1') {
  console.error(`
禁止用 SHIP_FULL_TEX=1 打 release 包。

  全量 tex 是本地排障开关，发布会产出 3GB+ 的废包。
  请直接跑：npm run build:apk:release（默认只打 P0 首包）
  文档: docs/asset-ship-pipeline.md §0.4
`);
  process.exit(1);
}

// 配置了固定签名后产物为 app-release.apk，否则为 app-release-unsigned.apk
const apkRelCandidates =
  mode === 'release'
    ? [
        path.join('app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
        path.join('app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk'),
      ]
    : [path.join('app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')];

function findAndroidSdk() {
  const env = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (env && fs.existsSync(env)) return env;

  const localProps = path.join(androidDir, 'local.properties');
  if (fs.existsSync(localProps)) {
    const match = fs.readFileSync(localProps, 'utf8').match(/sdk\.dir=(.+)/);
    if (match) {
      const sdk = match[1].replace(/\\\\/g, '\\').replace(/\\:/g, ':');
      if (fs.existsSync(sdk)) return sdk;
    }
  }

  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
    path.join(process.env.ProgramFiles || '', 'Android', 'android-sdk'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

/** Capacitor 8 / AGP 需要 JDK 21；优先 Android Studio JBR，避免系统 JAVA_HOME=17 导致编译失败 */
function findJdk21() {
  const candidates = [
    process.env.JAVA_HOME,
    path.join(process.env.ProgramFiles || '', 'Android', 'Android Studio', 'jbr'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Android', 'Android Studio', 'jbr'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'jdk-21'),
    path.join(process.env.ProgramFiles || '', 'Eclipse Adoptium'),
  ].filter(Boolean);

  for (const c of candidates) {
    if (!c || !fs.existsSync(c)) continue;
    // Expand jdk-21* / Adoptium dirs
    const roots = fs.existsSync(path.join(c, 'bin', 'java.exe')) || fs.existsSync(path.join(c, 'bin', 'java'))
      ? [c]
      : fs.existsSync(c) && fs.statSync(c).isDirectory()
        ? fs
            .readdirSync(c)
            .filter((n) => /jdk-?21/i.test(n))
            .map((n) => path.join(c, n))
        : [];
    for (const rootDir of roots) {
      const release = path.join(rootDir, 'release');
      if (!fs.existsSync(release)) continue;
      const ver = fs.readFileSync(release, 'utf8').match(/JAVA_VERSION="([^"]+)"/);
      if (ver && /^21\b/.test(ver[1])) return rootDir;
    }
  }
  return null;
}

/**
 * 签名指纹锁：所有 release 包必须由这一把证书签名，否则玩家无法覆盖安装（热更），
 * 只能卸载重装 → 存档丢失。来源：android/keystore/README.md「首次启用纪要」。
 * 换钥匙是不可逆操作——旧玩家永远无法升级，必须走这道门禁。
 */
const { EXPECTED_RELEASE_SHA256 } = require('./lib/signing-expected.cjs');

/** 用 build-tools 的 apksigner 读出 APK 的签名者 SHA-256，读不出/不匹配都算失败 */
function verifyReleaseSignature(apkPath, buildToolsDir) {
  const apksigner = path.join(buildToolsDir, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner');
  let out;
  try {
    out = execSync(`"${apksigner}" verify --print-certs "${apkPath}"`, { encoding: 'utf8' });
  } catch (e) {
    console.error('apksigner 验签执行失败:', String(e && e.message ? e.message : e));
    return false;
  }
  const m = out.match(/SHA-256 digest:\s*([0-9a-fA-F:]+)/);
  if (!m) {
    console.error('无法从 apksigner 输出中解析签名指纹。');
    return false;
  }
  const actual = m[1].replace(/:/g, '').toUpperCase();
  if (actual !== EXPECTED_RELEASE_SHA256) {
    console.error(`
签名指纹不匹配！产物已被拦截，不会拷贝到输出目录。

  实际: ${actual}
  必须: ${EXPECTED_RELEASE_SHA256}

可能原因：
  1. android/key.properties 指向了另一把 keystore（换电脑时没带回旧钥匙）
  2. 有人动了 keystore 文件

解决：从 keybackup-xiudai-2026-10-18 取回正确的 rust-belt-era.jks，
放到 android/keystore/ 下，重新运行 npm run android:signing:init，再打包。
文档: android/keystore/README.md
`);
    return false;
  }
  console.log('签名指纹校验通过:', actual);
  return true;
}

const sdk = findAndroidSdk();
if (!sdk) {
  console.error(`
未找到 Android SDK。

请先安装 Android Studio，并在 SDK Manager 中安装：
  - Android SDK Platform 36
  - Android SDK Build-Tools
  - Android SDK Platform-Tools

安装后任选其一：
  1. 设置环境变量 ANDROID_HOME 指向 SDK 目录
  2. 用 Android Studio 打开 android 文件夹，它会自动生成 local.properties
  3. 运行 npm run cap:open 在 Android Studio 里 Build > Build APK
`);
  process.exit(1);
}

const localProps = path.join(androidDir, 'local.properties');
if (!fs.existsSync(localProps)) {
  const escaped = sdk.replace(/\\/g, '\\\\');
  fs.writeFileSync(localProps, `sdk.dir=${escaped}\n`, 'utf8');
  console.log('已写入 local.properties:', sdk);
}

const jdk21 = findJdk21();
if (!jdk21) {
  console.error(`
未找到 JDK 21。当前 Capacitor Android 工程需要 Java 21。

推荐：安装 Android Studio（自带 jbr），或设置 JAVA_HOME 指向 JDK 21。
`);
  process.exit(1);
}
console.log('使用 JDK:', jdk21);

/**
 * capacitor-edge-tts：始终用仓库 patches 覆盖官方插件。
 * 修复 Sec-MS-GEC / Chromium 版本 / MUID / 403 时钟偏移重试，以及 JSArray.put 编译问题。
 */
function patchEdgeTtsPlugin() {
  const target = path.join(
    root,
    'node_modules',
    'capacitor-edge-tts',
    'android',
    'src',
    'main',
    'java',
    'com',
    'capacitor',
    'edgetts',
    'EdgeTTSPlugin.java',
  );
  const patch = path.join(root, 'patches', 'capacitor-edge-tts', 'EdgeTTSPlugin.java');
  if (!fs.existsSync(patch)) {
    console.warn('缺少 patches/capacitor-edge-tts/EdgeTTSPlugin.java，跳过 Edge TTS 修补');
    return;
  }
  if (!fs.existsSync(target)) {
    console.warn('未安装 capacitor-edge-tts，跳过 Edge TTS 修补');
    return;
  }
  fs.copyFileSync(patch, target);
  console.log('已应用 patches/capacitor-edge-tts/EdgeTTSPlugin.java（Sec-MS-GEC / 403 重试）');
}

patchEdgeTtsPlugin();

// 强制：APK 内必须已是标准 ship 资源（见 docs/asset-ship-pipeline.md）
try {
  execSync('node scripts/verify-ship-gate.mjs --android', {
    cwd: root,
    stdio: 'inherit',
  });
} catch {
  console.error('美术进包门禁失败，已中止 APK 构建。文档: docs/asset-ship-pipeline.md');
  process.exit(1);
}

// release 包必须用固定 keystore 签名，否则换机器签名冲突，玩家只能卸载重装丢档
if (mode === 'release') {
  const propsPath = path.join(androidDir, 'key.properties');
  if (!fs.existsSync(propsPath)) {
    console.error(`
未找到 android/key.properties，release 包无法获得稳定签名。

风险：签名每次都可能不同 → 玩家手机上会报「安装失败(-7) 与已安装应用签名不同」
      → 被迫卸载重装 → 存档全部丢失、无法热更。

请先执行：  powershell scripts/android-signing-init.ps1
（换电脑时把旧的 android/keystore/rust-belt-era.jks 带过来，该脚本会复用旧签名，
  不会新建，从而保持与线上版本一致。）
`);
    process.exit(1);
  }
}

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

/**
 * 前置闸门（2026-10-24）：进包前就确认 dist/tex 只有 P0。
 * 体积闸门要等 gradle 跑完 3 分钟才触发，太晚；这里先扫一遍，超集立刻中止。
 */
function verifyDistP0Only() {
  const distTex = path.join(root, 'dist', 'tex');
  const cdnManifest = path.join(root, 'tex-ship', 'ship-manifest-cdn.json');
  if (!fs.existsSync(distTex) || !fs.existsSync(cdnManifest)) return;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(cdnManifest, 'utf8'));
  } catch {
    return;
  }
  const files = manifest.files ?? {};
  const remoteTier = Object.keys(files).filter((k) => files[k].tier !== 'P0');
  const leaked = remoteTier.filter((k) => fs.existsSync(path.join(distTex, k)));
  if (leaked.length && process.env.SHIP_FULL_TEX !== '1') {
    console.error(`
进包资源超集，已中止！

  dist/tex 里混入了 ${leaked.length} 个远端层(P1/P2)文件，例如:
    ${leaked.slice(0, 5).join('\n    ')}

这会让 APK 膨胀到 3GB+。请清理 dist 后重试：
  Remove-Item -Recurse -Force dist
  npm run build:apk:release

文档: docs/asset-ship-pipeline.md §0.4
`);
    process.exit(1);
  }
  if (!leaked.length) console.log(`进包资源校验通过：dist/tex 无 P1/P2 泄漏（P0-only，远端层 ${remoteTier.length} 个文件在云端）`);
}

verifyDistP0Only();

console.log(`正在构建 ${mode} APK（${task}）…`);

try {
  execSync(`${gradlew} ${task}`, {
    cwd: androidDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ANDROID_HOME: sdk,
      ANDROID_SDK_ROOT: sdk,
      JAVA_HOME: jdk21,
      PATH: `${path.join(jdk21, 'bin')}${path.delimiter}${process.env.PATH || ''}`,
    },
  });
} catch {
  console.error('Gradle 构建失败。若首次构建，请用 Android Studio 打开 android 目录同步 Gradle 后重试。');
  process.exit(1);
}

const builtApk = apkRelCandidates.map((rel) => path.join(androidDir, rel)).find((p) => fs.existsSync(p));
if (!builtApk) {
  console.error('未找到输出 APK，候选路径:', apkRelCandidates.join(', '));
  process.exit(1);
}

/**
 * 体积闸门（2026-10-24）：P0 瘦身包必须 ≤ 700MB。
 * 历史事故：漏设 SHIP_P0_ONLY 走全量拷贝，P1 皮肤 2.5GB 全进包 → APK 3.13GB，
 * 玩家装不下、上传也传不动。超限一律中止，不拷贝到桌面。
 * 若确实需要全量（仅本地排障），显式设 ALLOW_FAT_APK=1 绕过。
 */
const MAX_APK_BYTES = 700 * 1024 * 1024;
const apkBytes = fs.statSync(builtApk).size;
const apkMb = (apkBytes / 1024 / 1024).toFixed(1);
if (apkBytes > MAX_APK_BYTES && process.env.ALLOW_FAT_APK !== '1') {
  console.error(`
APK 体积超限，已拦截！

  产物: ${apkMb} MB (${apkBytes} 字节)
  上限: 700 MB（P0 瘦身包规范 ~450MB）

说明：这几乎一定是 dist/tex 把 P1/P2 远端层也拷进去了。
  正确路径：npm run build:apk:release（默认 SHIP_P0_ONLY，只打 P0 首包）
  检查分层：node scripts/check-cloud-assets.mjs
  仅本地排障需全量时：set SHIP_FULL_TEX=1 且 set ALLOW_FAT_APK=1

文档: docs/asset-ship-pipeline.md §0.4 / §0.6
`);
  process.exit(1);
}
if (apkBytes > MAX_APK_BYTES) {
  console.warn(`⚠ ALLOW_FAT_APK=1：跳过体积闸门，产物 ${apkMb} MB（禁止发布）`);
} else {
  console.log(`APK 体积: ${apkMb} MB（上限 700MB，通过）`);
}


// 出厂前最后一道闸：release 包必须验签通过才允许分发
if (mode === 'release') {
  const buildToolsRoot = path.join(sdk, 'build-tools');
  const bt = fs.existsSync(buildToolsRoot)
    ? fs
        .readdirSync(buildToolsRoot)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map((n) => path.join(buildToolsRoot, n))
        .find((d) => fs.existsSync(path.join(d, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner')))
    : null;
  if (!bt) {
    console.error('未找到 apksigner，无法验签。已中止（SDK build-tools 缺失）。');
    process.exit(1);
  }
  if (!verifyReleaseSignature(builtApk, bt)) process.exit(1);
}

const outDir = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop', 'rust-belt-era-apk');
fs.mkdirSync(outDir, { recursive: true });
const outName = mode === 'release' ? 'rust-belt-era-release.apk' : 'rust-belt-era-debug.apk';
const outApk = path.join(outDir, outName);
fs.copyFileSync(builtApk, outApk);

/**
 * 构建戳记（2026-10-24）：Windows 的 copyFileSync 会保留源文件写入时间，
 * 叠加 gradle UP-TO-DATE 时 APK 的 mtime 根本反映不了本次打包，check:build 会误报。
 * 这里落一份真实构建记录，check-build-stale 以它为准。
 */
try {
  const contentHash = (() => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(root, 'tex-ship', 'ship-manifest-cdn.json'), 'utf8'));
      return m.contentHash ?? '';
    } catch {
      return '';
    }
  })();
  const sha256 = require('crypto').createHash('sha256').update(fs.readFileSync(outApk)).digest('hex');
  fs.writeFileSync(
    path.join(outDir, 'build-stamp.json'),
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        mode,
        file: outName,
        bytes: fs.statSync(outApk).size,
        sha256,
        bundledContentHash: contentHash,
        versionCode: (() => {
          try {
            const g = fs.readFileSync(path.join(androidDir, 'app', 'build.gradle'), 'utf8');
            const m = g.match(/versionCode\s+(\d+)/);
            return m ? Number(m[1]) : null;
          } catch {
            return null;
          }
        })(),
      },
      null,
      2,
    ),
    'utf8',
  );
} catch (e) {
  console.warn('构建戳记写入失败（不影响产物）:', String(e && e.message ? e.message : e));
}

console.log('');
console.log('APK 构建成功');
console.log('输出:', outApk);
console.log('');
if (mode === 'debug') {
  console.log('调试包直接覆盖安装也可能因签名不同被拒，测真机请用 release 包。');
} else {
  console.log('已使用 android/key.properties 的固定 keystore 签名 —— 可直接覆盖安装，玩家存档保留。');
  console.log('换电脑打包前请确认携带了同一个 keystore 文件。');
}
