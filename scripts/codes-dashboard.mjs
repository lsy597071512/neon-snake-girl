/**
 * 码池可视化管理面板（本地运行）：
 *   双击 码池管理.bat → 自动打开浏览器 → 网页界面点按钮操作
 * 仅监听本机 127.0.0.1，外部无法访问。数据实时来自 Cloudflare 网关。
 */
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import {
  SECRETS_PATH,
  backupSecretsToLocal,
  readSecretsFile,
  restoreSecretsFromBackup,
  secretsReady,
} from './lib/gateway-secrets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8797;

// ── 国内直连 workers.dev 常被阻断：自动检测系统代理并重跑自身 ──
if (!process.env.NODE_USE_ENV_PROXY && !process.env.HTTPS_PROXY && process.platform === 'win32') {
  try {
    const r = spawnSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'],
      { encoding: 'utf8' },
    );
    const m = (r.stdout ?? '').match(/ProxyServer\s+REG_SZ\s+(\S+)/);
    if (m) {
      console.log(`检测到系统代理 ${m[1]}，自动启用…`);
      const s = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url)],
        {
          stdio: 'inherit',
          env: { ...process.env, NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: `http://${m[1]}`, HTTP_PROXY: `http://${m[1]}` },
        },
      );
      process.exit(s.status ?? 0);
    }
  } catch {
    /* ignore */
  }
}

if (!secretsReady() && !restoreSecretsFromBackup()) {
  console.error('未找到 gateway\\.secrets.local.json —— 请重新双击 码池管理.bat 自动恢复');
  process.exit(1);
}
let url = '';
let adminKey = '';
try {
  const sec = readSecretsFile(SECRETS_PATH);
  url = sec.url;
  adminKey = sec.adminKey;
  backupSecretsToLocal();
} catch (e) {
  console.error('secrets 无效:', e?.message ?? e);
  process.exit(1);
}

function openBrowser(target) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* 手动打开 */
  }
}

// 意外异常不让服务退出（保持面板可用）
process.on('uncaughtException', (err) => console.error('[面板] 捕获异常(继续运行):', err?.message ?? err));
process.on('unhandledRejection', (err) => console.error('[面板] 捕获拒绝(继续运行):', String(err)));

async function gw(p, body, method = 'POST') {
  const res = await fetch(url + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>锈带纪元 · 码池管理</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: 'Microsoft YaHei', system-ui; background: #0d0f14; color: #e8e2d6; padding: 24px; }
  h1 { font-size: 20px; color: #e8b96a; letter-spacing: .2em; margin-bottom: 4px; }
  .sub { font-size: 12px; color: #6f6a5e; margin-bottom: 20px; }
  .cards { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .card { background: #161922; border: 1px solid #2a2d38; border-radius: 10px; padding: 14px 20px; min-width: 130px; }
  .card b { display: block; font-size: 26px; color: #e8b96a; }
  .card span { font-size: 12px; color: #8b8474; }
  .panel { background: #161922; border: 1px solid #2a2d38; border-radius: 10px; padding: 18px; margin-bottom: 20px; }
  .panel h3 { font-size: 14px; color: #b9b2a2; margin-bottom: 12px; }
  input, select { background: #11131a; border: 1px solid #3a3d47; color: #e8e2d6; border-radius: 8px; padding: 9px 12px; font-size: 14px; }
  button { cursor: pointer; border: none; border-radius: 8px; padding: 9px 18px; font-size: 14px; font-weight: 600; }
  .btn-gold { background: linear-gradient(180deg,#f0c877,#d9a24a); color: #14100a; }
  .btn-red { background: #4a2020; color: #ff9a9a; }
  .btn-blue { background: #1e3a5f; color: #9ecbff; }
  .btn-sm { padding: 4px 10px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #8b8474; font-weight: normal; padding: 8px 6px; border-bottom: 1px solid #2a2d38; }
  td { padding: 8px 6px; border-bottom: 1px solid #1d2029; }
  .ok { color: #9fd6a0; } .bad { color: #e08a8a; } .code { font-family: Consolas, monospace; color: #e8b96a; letter-spacing: .05em; }
  #toast { position: fixed; top: 16px; right: 16px; background: #233; color: #cde; padding: 10px 16px; border-radius: 8px; display: none; font-size: 13px; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .newcodes { margin-top: 10px; white-space: pre-wrap; font-family: Consolas, monospace; color: #9fd6a0; font-size: 13px; background:#11131a; padding:10px; border-radius:8px; display:none; }
</style></head><body>
<h1>锈带纪元 · 码池管理</h1>
<div class="sub">网关: ${url} · 数据实时同步 Cloudflare · <b style="color:#e08a8a">★ 请保持黑色窗口开启（关闭窗口 = 面板停止）</b></div>
<div class="cards">
  <div class="card"><b id="st-total">-</b><span>兑换码总数</span></div>
  <div class="card"><b id="st-ok">-</b><span>有效</span></div>
  <div class="card"><b id="st-revoked">-</b><span>已停用</span></div>
  <div class="card"><b id="st-dev">-</b><span>绑定设备数</span></div>
</div>
<div class="panel">
  <h3>生成新兑换码（发给玩家 / 上传自动发货）</h3>
  <div class="row">
    数量 <input id="count" type="number" value="10" min="1" max="5000" style="width:80px">
    每码设备上限 <input id="maxdev" type="number" value="3" min="1" max="10" style="width:64px">
    备注 <input id="note" type="text" value="" placeholder="如：爱发电第一批" style="width:180px">
    <button class="btn-gold" onclick="generate()">生 成</button>
    <button class="btn-blue" onclick="downloadTxt()" id="dlBtn" style="display:none">下载 txt</button>
  </div>
  <div class="newcodes" id="newcodes"></div>
</div>
<div class="panel">
  <h3>兑换码列表 <button class="btn-blue btn-sm" onclick="load()">刷新</button></h3>
  <table><thead><tr><th>兑换码</th><th>设备/上限</th><th>状态</th><th>备注</th><th>生成时间</th><th>操作</th></tr></thead>
  <tbody id="tbody"><tr><td colspan="6">加载中…</td></tr></tbody></table>
</div>
<div id="toast"></div>
<script>
let lastNew = [];
function toast(m) { const t = document.getElementById('toast'); t.textContent = m; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 2500); }
async function api(p, body) {
  try {
    const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  } catch (e) {
    toast('面板服务未运行：请重新双击 码池管理.bat（黑色窗口要保持开启）');
    throw e;
  }
}
async function load() {
  try {
    const d = await api('/api/list');
    if (!Array.isArray(d.codes)) throw new Error(d.error || '网关返回数据格式错误');
    const codes = d.codes;
    let ok = 0, rv = 0, dev = 0;
    for (const c of codes) { if (c.revoked) rv++; else ok++; dev += Number(c.devices ?? 0); }
    document.getElementById('st-total').textContent = String(codes.length);
    document.getElementById('st-ok').textContent = String(ok);
    document.getElementById('st-revoked').textContent = String(rv);
    document.getElementById('st-dev').textContent = String(dev);
    const rows = codes.map(c => '<tr>' +
      '<td class="code">' + c.code + '</td>' +
      '<td>' + (c.devices ?? 0) + ' / ' + c.max_devices + '</td>' +
      '<td class="' + (c.revoked ? 'bad' : 'ok') + '">' + (c.revoked ? '已停用' : '有效') + '</td>' +
      '<td>' + (c.note || '') + '</td>' +
      '<td>' + new Date(c.created_at).toLocaleString('zh-CN') + '</td>' +
      '<td>' + (c.revoked ? '' : '<button class="btn-red btn-sm" onclick="revoke(\\'' + c.code + '\\')">停用</button> ') +
      '<button class="btn-blue btn-sm" onclick="unbind(\\'' + c.code + '\\')">解绑设备</button></td></tr>');
    document.getElementById('tbody').innerHTML = rows.join('') || '<tr><td colspan="6">码池为空，先在上方生成</td></tr>';
  } catch (e) {
    document.getElementById('tbody').innerHTML = '<tr><td colspan="6" class="bad">加载失败：' + String(e?.message || e) + '，请点击刷新重试</td></tr>';
  }
}
async function generate() {
  const d = await api('/api/generate', { count: Number(count.value), maxDevices: Number(maxdev.value), note: note.value });
  if (!d.codes) { toast('生成失败'); return; }
  lastNew = d.codes;
  const nc = document.getElementById('newcodes');
  nc.style.display = 'block';
  nc.textContent = d.codes.join('\\n');
  document.getElementById('dlBtn').style.display = 'inline-block';
  toast('已生成 ' + d.codes.length + ' 个码');
  load();
}
function downloadTxt() {
  const blob = new Blob([lastNew.join('\\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'codes-' + new Date().toISOString().slice(0, 10) + '.txt';
  a.click();
}
async function revoke(code) {
  if (!confirm('确定停用 ' + code + '？停用后该玩家无法登录。')) return;
  await api('/api/revoke', { code }); toast('已停用 ' + code); load();
}
async function unbind(code) {
  if (!confirm('确定解绑 ' + code + ' 的全部设备？玩家可重新登录（换机用）。')) return;
  await api('/api/unbind', { code }); toast('已解绑 ' + code); load();
}
load();
setInterval(load, 60000);
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const p = (req.url ?? '/').split('?')[0];
  const send = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  if (p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }
  try {
    if (p === '/api/list' && req.method === 'POST') return send((await gw('/api/admin/codes', {}, 'GET')).data);
    if (p === '/api/generate' && req.method === 'POST') {
      const b = await new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(JSON.parse(s || '{}'))); });
      return send((await gw('/api/admin/codes', b)).data);
    }
    if (p === '/api/revoke' && req.method === 'POST') {
      const b = await new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(JSON.parse(s || '{}'))); });
      return send((await gw('/api/admin/revoke', b)).data);
    }
    if (p === '/api/unbind' && req.method === 'POST') {
      const b = await new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(JSON.parse(s || '{}'))); });
      return send((await gw('/api/admin/unbind', b)).data);
    }
    send({ error: 'NOT_FOUND' }, 404);
  } catch (err) {
    send({ error: 'UPSTREAM_FAIL', detail: String(err) }, 502);
  }
});

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。请关闭旧的「码池管理」黑色窗口后重试。`);
    console.error(`或手动访问: http://127.0.0.1:${PORT}`);
    openBrowser(`http://127.0.0.1:${PORT}`);
    process.exit(1);
  }
  console.error('[面板] 启动失败:', err?.message ?? err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const target = `http://127.0.0.1:${PORT}`;
  console.log(`码池管理面板: ${target}`);
  console.log('浏览器将自动打开；若未弹出请手动访问上面地址。');
  console.log('按 Ctrl+C 退出。');
  openBrowser(target);
});
