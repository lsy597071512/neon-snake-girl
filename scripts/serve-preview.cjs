const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { DEFAULT_PORT, MIME, send, pickPort, printServeUrls } = require('./serve-utils.cjs');

const ROOT = path.join(__dirname, '..');
const CANDIDATE_PORTS = [DEFAULT_PORT, 5174, 8888, 3000, 9090];
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, 'Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(ROOT, 'index.html'), (err2, indexData) => {
        if (err2) {
          send(res, 404, 'Not Found');
          return;
        }
        send(res, 200, indexData, MIME['.html']);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, MIME[ext] || 'application/octet-stream');
  });
});

pickPort(CANDIDATE_PORTS, HOST).then((port) => {
  if (!port) {
    console.error('没有可用端口');
    process.exit(1);
  }
  server.listen(port, HOST, () => {
    printServeUrls('锈带纪元 预览站已启动', port, ROOT);
    exec(`start "" "http://127.0.0.1:${port}/"`);
  });
});

server.on('error', (err) => {
  console.error('启动失败:', err.message);
  process.exit(1);
});
