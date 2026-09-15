const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'dist');
const port = 4173;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.normalize(path.join(root, reqPath));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(root, 'index.html'), (indexErr, indexData) => {
        if (indexErr) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': mime['.html'] || 'text/html; charset=utf-8' });
        res.end(indexData);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`STATIC_SERVER_READY http://127.0.0.1:${port}/`);
});

server.on('error', (err) => {
  console.error(`STATIC_SERVER_ERROR ${err.message}`);
  process.exit(1);
});
