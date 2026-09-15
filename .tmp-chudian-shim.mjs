/**
 * Local Cursor → 触点 shim.
 * Rewrites Cursor built-in Kimi ids to 触点 `kimi-k3`.
 */
import http from 'http';
import https from 'https';
import { URL } from 'url';

const LISTEN = 8787;
const UPSTREAM = 'https://llm.chudian.site';
const KEY = 'sk-ag-62511855539c02cd9738dd2b345d7230';
const REWRITE = {
  'kimi-k3-max': 'kimi-k3',
  'kimi-k3-high': 'kimi-k3',
  'kimi-k3-low': 'kimi-k3',
  'kimi-k3': 'kimi-k3',
};

function rewriteBody(buf, contentType) {
  if (!contentType || !contentType.includes('application/json')) return buf;
  try {
    const j = JSON.parse(buf.toString('utf8'));
    if (j && typeof j.model === 'string' && REWRITE[j.model]) {
      const from = j.model;
      j.model = REWRITE[from];
      console.log(`[shim] model ${from} -> ${j.model}`);
      return Buffer.from(JSON.stringify(j));
    }
  } catch {
    /* pass through */
  }
  return buf;
}

function proxy(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const body = rewriteBody(raw, req.headers['content-type']);
    const u = new URL(req.url || '/', UPSTREAM);
    const headers = { ...req.headers, host: u.host };
    delete headers['content-length'];
    headers['content-length'] = String(body.length);
    if (!headers.authorization) headers.authorization = `Bearer ${KEY}`;
    // force our key for Cursor BYOK path consistency
    headers.authorization = `Bearer ${KEY}`;

    const preq = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: req.method,
        headers,
      },
      (pres) => {
        res.writeHead(pres.statusCode || 502, pres.headers);
        pres.pipe(res);
      },
    );
    preq.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: e.message } }));
    });
    preq.end(body);
  });
}

const server = http.createServer((req, res) => {
  // health
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rewrite: REWRITE }));
    return;
  }
  proxy(req, res);
});

server.listen(LISTEN, '127.0.0.1', () => {
  console.log(`[shim] http://127.0.0.1:${LISTEN}/v1 -> ${UPSTREAM}/v1`);
});
