const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
  });
  res.end(body);
}

function isPortFree(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, host);
  });
}

async function pickPort(candidates, host = '0.0.0.0') {
  const envPort = Number(process.env.PORT);
  if (envPort > 0 && (await isPortFree(envPort, host))) return envPort;
  for (const port of candidates) {
    if (await isPortFree(port, host)) return port;
  }
  return 0;
}

function lanScore(ip) {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1]);
    if (second >= 16 && second <= 31) return 2;
  }
  return 9;
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const item of nets[name] || []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      const ip = item.address;
      if (ip.startsWith('169.254.') || ip.startsWith('127.')) continue;
      addrs.push(ip);
    }
  }
  return [...new Set(addrs)].sort((a, b) => lanScore(a) - lanScore(b));
}

function writeMobileUrlFile(rootDir, port) {
  const ips = getLanAddresses();
  if (!ips.length) return null;
  const url = `http://${ips[0]}:${port}/`;
  try {
    fs.writeFileSync(path.join(rootDir, 'mobile-url.txt'), `${url}\r\n`, 'utf8');
  } catch {
    /* ignore */
  }
  return url;
}

function printServeUrls(title, port, rootDir) {
  console.log('');
  console.log(`  ${title}`);
  console.log(`  本机浏览器: http://127.0.0.1:${port}/`);
  const lan = getLanAddresses();
  if (lan.length) {
    console.log('  手机预览（手机与电脑须连同一 WiFi，勿用流量）:');
    for (const ip of lan) {
      console.log(`    http://${ip}:${port}/`);
    }
    const primary = writeMobileUrlFile(rootDir, port);
    if (primary) {
      console.log('');
      console.log(`  推荐手机地址已写入: mobile-url.txt`);
      console.log(`  ${primary}`);
    }
    console.log('');
    console.log('  若手机打不开：右键「允许防火墙.bat」→ 以管理员运行，再重启预览');
  } else {
    console.log('  未检测到可用局域网 IP（请检查 WiFi 是否已连接）');
  }
  console.log('  按 Ctrl+C 停止服务器');
  console.log('');
}

module.exports = {
  DEFAULT_PORT,
  MIME,
  send,
  isPortFree,
  pickPort,
  getLanAddresses,
  printServeUrls,
};
