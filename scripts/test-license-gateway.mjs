/**
 * 兑换码网关本地端到端测试：mock D1，直接调用 worker.js 的 fetch。
 * 覆盖：登录/设备上限/token 签名与过期/吊销/自助换绑冷却/管理鉴权。
 * 用法：node scripts/test-license-gateway.mjs
 */
import worker from '../gateway/worker.js';

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('OK:', msg);
  else { failed++; console.error('FAIL:', msg); }
}

function makeMockDb() {
  const codes = new Map(); // code -> {code,note,max_devices,revoked,last_self_unbind_at,created_at}
  const devices = new Map(); // `${code}|${device_id}` -> {...}

  return {
    async exec() { /* schema：内存表已就绪 */ },
    prepare(sql) {
      const s = sql.replace(/\s+/g, ' ').trim();
      let bound = [];
      return {
        bind(...args) { bound = args; return this; },
        async first() {
          if (/^SELECT code, max_devices, revoked FROM codes WHERE code = \?/.test(s)) {
            const r = codes.get(bound[0]);
            return r ? { ...r } : null;
          }
          if (/^SELECT revoked FROM codes WHERE code = \?/.test(s)) {
            const r = codes.get(bound[0]);
            return r ? { revoked: r.revoked } : null;
          }
          if (/^SELECT code, revoked, last_self_unbind_at FROM codes WHERE code = \?/.test(s)) {
            const r = codes.get(bound[0]);
            return r ? { code: r.code, revoked: r.revoked, last_self_unbind_at: r.last_self_unbind_at } : null;
          }
          if (/^SELECT device_id FROM devices WHERE code = \? AND device_id = \?/.test(s)) {
            const r = devices.get(`${bound[0]}|${bound[1]}`);
            return r ? { device_id: r.device_id } : null;
          }
          if (/^SELECT code FROM codes WHERE code = \?/.test(s)) {
            return codes.get(bound[0]) ? { code: bound[0] } : null;
          }
          throw new Error('unsupported first: ' + s);
        },
        async all() {
          if (/^SELECT device_id FROM devices WHERE code = \?/.test(s)) {
            const rows = [];
            for (const [k, v] of devices) if (k.startsWith(bound[0] + '|')) rows.push({ device_id: v.device_id });
            return { results: rows };
          }
          if (/GROUP BY c.code/.test(s)) {
            const rows = [];
            for (const c of codes.values()) {
              let n = 0;
              for (const k of devices.keys()) if (k.startsWith(c.code + '|')) n++;
              rows.push({ ...c, devices: n });
            }
            return { results: rows };
          }
          throw new Error('unsupported all: ' + s);
        },
        async run() {
          if (/^(CREATE|DROP|ALTER)\s/i.test(s)) return { success: true };
          if (/INSERT INTO devices/.test(s)) {
            const [code, deviceId, name, ts] = bound;
            devices.set(`${code}|${deviceId}`, { code, device_id: deviceId, device_name: name, activated_at: ts, last_seen: ts });
            return { success: true };
          }
          if (/INSERT INTO codes/.test(s)) {
            const [code, note, maxDevices, ts] = bound;
            codes.set(code, { code, note, max_devices: maxDevices, revoked: 0, last_self_unbind_at: 0, created_at: ts });
            return { success: true };
          }
          if (/UPDATE codes SET revoked = 1/.test(s)) {
            const c = codes.get(bound[0]);
            if (c) c.revoked = 1;
            return { success: true };
          }
          if (/UPDATE codes SET last_self_unbind_at = \? WHERE code = \?/.test(s)) {
            const c = codes.get(bound[1]);
            if (c) c.last_self_unbind_at = bound[0];
            return { success: true };
          }
          if (/UPDATE devices SET last_seen/.test(s)) {
            const d = devices.get(`${bound[1]}|${bound[2]}`);
            if (d) d.last_seen = bound[0];
            return { success: true };
          }
          if (/DELETE FROM devices WHERE code = \? AND device_id = \?/.test(s)) {
            devices.delete(`${bound[0]}|${bound[1]}`);
            return { success: true };
          }
          if (/DELETE FROM devices WHERE code = \?$/.test(s)) {
            for (const k of [...devices.keys()]) if (k.startsWith(bound[0] + '|')) devices.delete(k);
            return { success: true };
          }
          throw new Error('unsupported run: ' + s);
        },
      };
    },
  };
}

const env = { DB: makeMockDb(), LICENSE_SECRET: 'test-secret-abc', ADMIN_KEY: 'test-admin' };

async function call(path, { method = 'POST', body, adminKey } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminKey) headers['X-Admin-Key'] = adminKey;
  const req = new Request('https://gw.test' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const res = await worker.fetch(req, env);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// 1 ping + 管理鉴权
assert((await call('/api/ping', { method: 'GET' })).data.ok === true, 'ping 可用');
assert((await call('/api/admin/codes', { body: { count: 1 } })).status === 403, '无 Admin Key → 403');

// 2 校验
assert((await call('/api/login', { body: { code: 'RB-AB', deviceId: 'd1' } })).status === 400, '码过短 → 400');
assert((await call('/api/login', { body: { code: 'RB-ZZZZ-ZZZZ', deviceId: 'd1' } })).status === 404, '不存在码 → 404');

// 3 生成码池（限 2 设备）
const gen = await call('/api/admin/codes', { body: { count: 2, maxDevices: 2, note: 'test' }, adminKey: 'test-admin' });
assert(gen.status === 200 && gen.data.codes?.length === 2, '批量生成 2 码');
const [CODE_A, CODE_B] = gen.data.codes;

// 4 设备绑定与上限
const a1 = await call('/api/login', { body: { code: CODE_A, deviceId: 'dev-A1', deviceName: '机1' } });
assert(a1.status === 200 && typeof a1.data.token === 'string', '设备1 登录成功');
const a2 = await call('/api/login', { body: { code: CODE_A, deviceId: 'dev-A2' } });
assert(a2.status === 200, '设备2 登录成功');
const a3 = await call('/api/login', { body: { code: CODE_A, deviceId: 'dev-A3' } });
assert(a3.status === 403 && a3.data.error === 'TOO_MANY_DEVICES' && a3.data.canSelfUnbind === true, '第 3 台 → 403 且提示可自助换绑');
const a1b = await call('/api/login', { body: { code: CODE_A, deviceId: 'dev-A1' } });
assert(a1b.status === 200, '同设备重复登录 OK');

// 5 token 校验 / 篡改 / 过期
const v1 = await call('/api/validate', { body: { token: a1.data.token } });
assert(v1.status === 200 && v1.data.ok === true && v1.data.code === CODE_A, 'token 校验通过');
assert((await call('/api/validate', { body: { token: a1.data.token.slice(0, -3) + 'aaa' } })).status === 401, '篡改签名 → 401');
{
  const enc = new TextEncoder();
  const b64 = (buf) => Buffer.from(buf).toString('base64url');
  const payload = b64(enc.encode(JSON.stringify({ c: CODE_A, d: 'dev-A1', exp: Math.floor(Date.now() / 1000) - 10, iat: 0 })));
  const key = await crypto.subtle.importKey('raw', enc.encode('test-secret-abc'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  assert((await call('/api/validate', { body: { token: `${payload}.${sig}` } })).status === 401, '过期 token → 401');
}

// 6 吊销
await call('/api/admin/revoke', { body: { code: CODE_B }, adminKey: 'test-admin' });
assert((await call('/api/login', { body: { code: CODE_B, deviceId: 'dev-B1' } })).data.error === 'CODE_REVOKED', '吊销后登录被拒');
assert((await call('/api/validate', { body: { token: a1.data.token } })).status === 200, '吊销不影响另一码');

// 7 自助换绑：首次成功 → 立即再来触发 30 天冷却 → 换绑后新设备可登录
const su1 = await call('/api/self-unbind', { body: { code: CODE_A } });
assert(su1.status === 200 && su1.data.ok === true, '自助换绑成功（清空设备）');
const su2 = await call('/api/self-unbind', { body: { code: CODE_A } });
assert(su2.status === 429 && su2.data.error === 'COOLDOWN', '30 天冷却内再换 → 429');
const a3b = await call('/api/login', { body: { code: CODE_A, deviceId: 'dev-A3' } });
assert(a3b.status === 200, '换绑后第 3 台设备可登录');

// 8 管理强制解绑（不受冷却限制）
await call('/api/admin/unbind', { body: { code: CODE_A }, adminKey: 'test-admin' });
assert((await call('/api/login', { body: { code: CODE_A, deviceId: 'dev-A1' } })).status === 200, '管理解绑后旧设备可重新登录');

// 9 管理列表
const list = await call('/api/admin/codes', { method: 'GET', adminKey: 'test-admin' });
assert(list.status === 200 && Array.isArray(list.data.codes) && list.data.codes.length === 2, '管理列表返回 2 码');

console.log(failed === 0 ? '\n网关端到端测试全部通过。' : `\n${failed} 项失败。`);
process.exit(failed ? 1 : 0);
