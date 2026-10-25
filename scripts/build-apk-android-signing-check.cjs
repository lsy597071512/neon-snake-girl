/**
 * 打印并校验当前 release 签名指纹（跨机器比对用）。
 * 所有打包机输出必须完全一致 = EXPECTED_RELEASE_SHA256，否则玩家无法热更。
 *
 * 为免依赖 Gradle/JDK，这里直接用 keytool 读取 keystore 证书指纹。
 * 退出码：0 = 一致；1 = 不一致 / 缺 key.properties / keystore / 读不出指纹。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EXPECTED_RELEASE_SHA256 } = require('./lib/signing-expected.cjs');

const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'android');
const propsPath = path.join(androidDir, 'key.properties');

if (!fs.existsSync(propsPath)) {
  console.error('未找到 android/key.properties。请先运行: npm run android:signing:init');
  process.exit(1);
}

/** 解析 key.properties（key=value，# 注释） */
function readProps(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

/** 定位 keytool：优先 Android Studio JBR，其次 JAVA_HOME，再 PATH */
function findKeytool() {
  const cands = [
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'keytool.exe') : null,
    path.join(process.env.ProgramFiles || '', 'Android', 'Android Studio', 'jbr', 'bin', 'keytool.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Android', 'Android Studio', 'jbr', 'bin', 'keytool.exe'),
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return 'keytool';
}

const props = readProps(propsPath);
const storeRel = props.storeFile;
const storePass = props.storePassword;
const alias = props.keyAlias;
if (!storeRel || !storePass || !alias) {
  console.error('key.properties 缺少 storeFile / storePassword / keyAlias，无法校验。');
  process.exit(1);
}

const ksPath = path.isAbsolute(storeRel) ? storeRel : path.join(androidDir, storeRel);
if (!fs.existsSync(ksPath)) {
  console.error(`key.properties 指向的 keystore 不存在: ${ksPath}`);
  process.exit(1);
}

const keytool = findKeytool();
let out = '';
try {
  out = execFileSync(
    keytool,
    ['-list', '-v', '-keystore', ksPath, '-storepass', storePass, '-alias', alias],
    { encoding: 'utf8' },
  );
} catch (e) {
  console.error('keytool 读取 keystore 失败。请检查 storePassword / keyAlias 是否正确。');
  if (e && e.stderr) process.stderr.write(String(e.stderr));
  process.exit(1);
}

const m = out.match(/SHA256:\s*([0-9a-fA-F:]+)/);
if (!m) {
  console.error('无法从 keytool 输出中解析 SHA256 指纹。');
  process.exit(1);
}
const actual = m[1].replace(/:/g, '').toUpperCase();

console.log(`keystore : ${ksPath}`);
console.log(`alias    : ${alias}`);
console.log(`SHA-256  : ${actual}`);

if (actual !== EXPECTED_RELEASE_SHA256) {
  console.error(`
签名指纹不一致！这台机器打出的包玩家无法覆盖安装。

  实际: ${actual}
  必须: ${EXPECTED_RELEASE_SHA256}

原因通常是：换电脑后没有把旧的 rust-belt-era.jks + key.properties 带过来，
        本机用 android:signing:init 又生成了新钥匙。

修复：从 keybackup-xiudai-2026-10-18 取回正确的 rust-belt-era.jks，
      放到 android/keystore/ 下，重跑 npm run android:signing:init。
文档: android/keystore/README.md
`);
  process.exit(1);
}
console.log('签名指纹校验通过（与本项目所有打包机一致）。');
