const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(process.env.USERPROFILE || '', 'Desktop', 'rust-belt-era-preview');
const dist = path.join(root, 'dist');
const { DEFAULT_PORT, getLanAddresses } = require('./serve-utils.cjs');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function purgeStaleAssets(out) {
  const assetsDir = path.join(out, 'assets');
  if (!fs.existsSync(assetsDir)) return;
  for (const name of fs.readdirSync(assetsDir)) {
    if (/^index-[A-Za-z0-9_-]+\.(js|css)$/.test(name)) {
      try {
        fs.unlinkSync(path.join(assetsDir, name));
      } catch {
        /* 文件被占用时跳过，稍后 copyDir 会覆盖同名文件 */
      }
    }
  }
}

function prepareOutDir(out) {
  if (!fs.existsSync(out)) {
    fs.mkdirSync(out, { recursive: true });
    return false;
  }
  try {
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    return false;
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      console.warn('目标文件夹占用中，将清理旧 assets 后覆盖写入:', out);
      purgeStaleAssets(out);
      return true;
    }
    throw err;
  }
}

if (!fs.existsSync(dist)) {
  console.error('请先执行 npm run build');
  process.exit(1);
}

const partialUpdate = prepareOutDir(out);
copyDir(dist, out);

const mainJs = fs.readdirSync(path.join(dist, 'assets')).find((n) => /^index-.*\.js$/.test(n));
if (mainJs) {
  fs.writeFileSync(
    path.join(out, 'build-id.txt'),
    `${mainJs}\r\n导出时间: ${new Date().toISOString()}\r\n请先关闭旧预览窗口再双击 start-preview.bat\r\n`,
    'utf8',
  );
}
if (partialUpdate) {
  console.warn('提示: 预览文件夹曾被占用，已清理旧 JS/CSS。请关闭 start-preview.bat 后重新打开。');
}

const previewServe = fs.readFileSync(path.join(root, 'scripts', 'serve-preview.cjs'), 'utf8');
const previewUtils = fs.readFileSync(path.join(root, 'scripts', 'serve-utils.cjs'), 'utf8');
fs.mkdirSync(path.join(out, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(out, 'scripts', 'serve-utils.cjs'), previewUtils);
fs.writeFileSync(path.join(out, 'scripts', 'serve.cjs'), previewServe);

const bat = `@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE="
if exist "C:\\Program Files\\nodejs\\node.exe" set "NODE=C:\\Program Files\\nodejs\\node.exe"
if not defined NODE where node >nul 2>&1 && set "NODE=node"
if not defined NODE (
  echo 未找到 Node.js。可将本文件夹上传到 Netlify / Cloudflare Pages 静态托管。
  pause
  exit /b 1
)
set PORT=${DEFAULT_PORT}
set HOST=0.0.0.0
"%NODE%" "%~dp0scripts\\serve.cjs"
pause
`;
fs.writeFileSync(path.join(out, 'start-preview.bat'), bat);

const firewallBat = `@echo off
chcp 65001 >nul
echo 正在添加 Windows 防火墙入站规则（端口 ${DEFAULT_PORT}）...
netsh advfirewall firewall delete rule name="RustBelt Era Preview" >nul 2>&1
netsh advfirewall firewall add rule name="RustBelt Era Preview" dir=in action=allow protocol=TCP localport=${DEFAULT_PORT} profile=private
netsh advfirewall firewall add rule name="RustBelt Era Preview Public" dir=in action=allow protocol=TCP localport=${DEFAULT_PORT} profile=public
if errorlevel 1 (
  echo 需要管理员权限：请右键本文件 -^> 以管理员身份运行
  pause
  exit /b 1
)
echo 防火墙已放行端口 ${DEFAULT_PORT}，请重新运行 start-preview.bat
pause
`;
fs.writeFileSync(path.join(out, '允许防火墙.bat'), firewallBat);

fs.writeFileSync(
  path.join(out, 'README.txt'),
  `锈带纪元预览站（支持手机）

【电脑预览】
双击 start-preview.bat

【手机预览 - 同一 WiFi】
1. 双击 start-preview.bat（不要关黑窗口）
2. 若手机打不开：右键「允许防火墙.bat」→ 以管理员运行
3. 打开 mobile-url.txt，复制地址到手机浏览器（须用 WiFi，不要用流量）
4. 竖屏游玩

【上线分享（手机任意网络可玩）】
将整个文件夹上传到 Cloudflare Pages / Netlify / GitHub Pages
`,
);

console.log('预览站已导出到:', out);
const ips = getLanAddresses();
if (ips.length) {
  const url = `http://${ips[0]}:${DEFAULT_PORT}/`;
  fs.writeFileSync(path.join(out, 'mobile-url.txt'), `${url}\r\n`, 'utf8');
  console.log('手机预览地址:', url);
  console.log('（先双击 start-preview.bat，防火墙不通则运行 允许防火墙.bat）');
}
