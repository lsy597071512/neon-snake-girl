#!/usr/bin/env node
/**
 * 兑换码码池管理（生成 / 列表 / 吊销 / 手动解绑）。
 * 自动读取 gateway\.secrets.local.json（deploy 脚本生成），无需手动传参。
 *
 * 用法：
 *   node scripts/manage-codes.mjs --generate 1000 --note "爱发电第一批"
 *   node scripts/manage-codes.mjs --generate 50 --max-devices 5 --note "豪华版"
 *   node scripts/manage-codes.mjs --list
 *   node scripts/manage-codes.mjs --revoke RB-XXXX-XXXX
 *   node scripts/manage-codes.mjs --unbind RB-XXXX-XXXX [设备ID]   （手动强制解绑，不受30天冷却限制）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secretsPath = path.join(root, 'gateway', '.secrets.local.json');

const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const val = (n, fallback = '') => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback) : fallback;
};

let url = '';
let adminKey = '';
try {
  const raw = fs.readFileSync(secretsPath, 'utf8').replace(/^\uFEFF/, ''); // 去除 PS 写入的 BOM
  const sec = JSON.parse(raw);
  url = (sec.url ?? '').replace(/\/$/, '');
  adminKey = sec.ADMIN_KEY ?? '';
} catch {
  /* 未部署 */
}
if (!url || !adminKey) {
  console.error('未找到网关配置：请先运行 scripts\\deploy-gateway.ps1 完成部署。');
  process.exit(1);
}

/**
 * 国内直连 *.workers.dev 常被阻断：检测 Windows 系统代理，自动带代理重跑自身。
 * （Node 的 fetch 默认不走系统代理，需 NODE_USE_ENV_PROXY=1 + HTTPS_PROXY）
 */
function detectSystemProxy() {
  if (process.platform !== 'win32') return null;
  try {
    const r = spawnSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'],
      { encoding: 'utf8' },
    );
    const m = (r.stdout ?? '').match(/ProxyServer\s+REG_SZ\s+(\S+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

if (!process.env.NODE_USE_ENV_PROXY && !process.env.HTTPS_PROXY) {
  const proxy = detectSystemProxy();
  if (proxy) {
    console.log(`检测到系统代理 ${proxy}（workers.dev 国内直连常被阻断），自动走代理重试…`);
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_USE_ENV_PROXY: '1',
          HTTPS_PROXY: `http://${proxy}`,
          HTTP_PROXY: `http://${proxy}`,
        },
      },
    );
    process.exit(r.status ?? 0);
  }
}

async function api(p, body, method = 'POST') {
  const res = await fetch(url + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function main() {
  if (has('generate')) {
    const count = Number(val('generate', '10'));
    const maxDevices = Number(val('max-devices', '3')) || 3;
    const note = val('note', '');
    const { status, data } = await api('/api/admin/codes', { count, maxDevices, note });
    if (status !== 200) {
      console.error('生成失败:', JSON.stringify(data));
      process.exit(1);
    }
    const outFile = val('out', '');
    if (outFile) {
      fs.writeFileSync(path.resolve(root, outFile), data.codes.join('\n') + '\n', 'utf8');
      console.log(`已生成 ${data.codes.length} 个兑换码 → 已写入 ${outFile}（可直接上传销售平台自动发货）`);
    } else {
      console.log(`已生成 ${data.codes.length} 个兑换码（每码限 ${data.maxDevices} 台设备）：\n`);
      console.log(data.codes.join('\n'));
      console.log('\n提示：加 --out codes.txt 可直接输出为文件，方便上传销售平台。');
    }
    return;
  }

  if (has('list')) {
    const { status, data } = await api('/api/admin/codes', {}, 'GET');
    if (status !== 200) { console.error('查询失败:', data); process.exit(1); }
    console.log('兑换码              设备数/上限  状态    备注            生成时间');
    for (const c of data.codes ?? []) {
      const created = new Date(c.created_at).toLocaleString('zh-CN');
      console.log(
        `${c.code}   ${c.devices}/${c.max_devices}        ${c.revoked ? '已吊销' : '有效'}    ${(c.note || '').padEnd(10)}  ${created}`,
      );
    }
    const total = (data.codes ?? []).length;
    console.log(`\n共 ${total} 个码。`);
    return;
  }

  if (has('revoke')) {
    const code = val('revoke').toUpperCase();
    const { status, data } = await api('/api/admin/revoke', { code });
    console.log(status === 200 ? `已吊销 ${code}` : `失败: ${JSON.stringify(data)}`);
    if (status !== 200) process.exit(1);
    return;
  }

  if (has('unbind')) {
    const code = val('unbind').toUpperCase();
    const deviceId = (() => {
      const i = args.indexOf('--unbind');
      const v = args[i + 2];
      return v && !v.startsWith('--') ? v : '';
    })();
    const { status, data } = await api('/api/admin/unbind', { code, deviceId });
    console.log(status === 200 ? `已解绑 ${code}${deviceId ? `（设备 ${deviceId}）` : '（全部设备）'}` : `失败: ${JSON.stringify(data)}`);
    if (status !== 200) process.exit(1);
    return;
  }

  console.error('用法：node scripts/manage-codes.mjs --generate N [--out 文件] | --list | --revoke 码 | --unbind 码 [设备ID]');
  process.exit(1);
}

main();
