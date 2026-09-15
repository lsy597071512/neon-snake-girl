const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'android');
const mode = (process.argv[2] || 'debug').toLowerCase();
const task = mode === 'release' ? 'assembleRelease' : 'assembleDebug';
const apkRel =
  mode === 'release'
    ? path.join('app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk')
    : path.join('app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

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

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
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

const builtApk = path.join(androidDir, apkRel);
if (!fs.existsSync(builtApk)) {
  console.error('未找到输出 APK:', builtApk);
  process.exit(1);
}

const outDir = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop', 'rust-belt-era-apk');
fs.mkdirSync(outDir, { recursive: true });
const outName = mode === 'release' ? 'rust-belt-era-release.apk' : 'rust-belt-era-debug.apk';
const outApk = path.join(outDir, outName);
fs.copyFileSync(builtApk, outApk);

console.log('');
console.log('APK 构建成功');
console.log('输出:', outApk);
console.log('');
if (mode === 'debug') {
  console.log('调试包可直接 adb install 或传到手机安装（需允许未知来源）。');
} else {
  console.log('Release 包为 unsigned，上架前需签名；本地测试建议用 npm run build:apk。');
}
