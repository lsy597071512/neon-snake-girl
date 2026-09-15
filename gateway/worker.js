/**
 * 锈带纪元 · 兑换码网关（Cloudflare Worker + D1）
 *
 * 模式：兑换码即账号（卡密自动发货）。
 * 玩家侧：输入「兑换码 + 自己的千问 API Key」即可；码由开发者批量生成、平台自动发货。
 * 开发者侧：零逐人维护——批量生成码池 → 上传销售平台；仅对滥用/退款做吊销。
 *
 * 防共享三保险：一码限设备数（默认 3）→ 30 天一次自助换绑 → 随时吊销。
 *
 * 环境变量（wrangler secret put，由 deploy 脚本自动完成）：
 *  - LICENSE_SECRET  token 签名密钥
 *  - ADMIN_KEY       管理接口密钥
 */

const TOKEN_TTL_SEC = 30 * 24 * 3600; // token 30 天；客户端每 24h 在线校验
const SELF_UNBIND_COOLDOWN_MS = 30 * 24 * 3600 * 1000; // 自助换绑冷却 30 天
const CODE_MIN_LEN = 6;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Key',
  'Access-Control-Max-Age': '86400',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}
function cors(resp) {
  for (const [k, v] of Object.entries(CORS)) resp.headers.set(k, v);
  return resp;
}

const enc = new TextEncoder();

function b64urlFromBuf(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlFromStr(str) {
  return b64urlFromBuf(enc.encode(str));
}
function bufFromB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

async function signToken(payloadObj, secret) {
  const payload = b64urlFromStr(JSON.stringify(payloadObj));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return `${payload}.${b64urlFromBuf(sig)}`;
}

async function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify('HMAC', key, bufFromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(bufFromB64url(payload)));
    if (typeof data.exp !== 'number' || Date.now() / 1000 > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function genCode() {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = (n) =>
    Array.from(crypto.getRandomValues(new Uint8Array(n)))
      .map((b) => cs[b % cs.length])
      .join('');
  return `RB-${seg(4)}-${seg(4)}`;
}

function normalizeCode(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

async function ensureSchema(env) {
  // D1 的 exec 对多语句支持不稳，改为逐条执行（幂等）
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS codes (
       code TEXT PRIMARY KEY,
       note TEXT DEFAULT '',
       max_devices INTEGER DEFAULT 3,
       revoked INTEGER DEFAULT 0,
       last_self_unbind_at INTEGER DEFAULT 0,
       created_at INTEGER
     )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS devices (
       code TEXT NOT NULL,
       device_id TEXT NOT NULL,
       device_name TEXT DEFAULT '',
       activated_at INTEGER,
       last_seen INTEGER,
       PRIMARY KEY (code, device_id)
     )`,
  ).run();
}

async function requireAdmin(request, env) {
  const key = request.headers.get('x-admin-key') ?? '';
  return Boolean(env.ADMIN_KEY) && key === env.ADMIN_KEY;
}

/** 爱发电开放接口签名需要 MD5（Web Crypto 不提供，内置标准实现） */
function md5(str) {
  function safeAdd(x, y) { const lsw = (x & 0xffff) + (y & 0xffff); const msw = (x >> 16) + (y >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
  function bitRol(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  function md5cmn(q, a, b, x, s, t) { return safeAdd(bitRol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
  function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
  function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }
  function binlMD5(x, len) {
    x[len >> 5] |= 0x80 << (len % 32);
    x[(((len + 64) >>> 9) << 4) + 14] = len;
    let olda, oldb, oldc, oldd;
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < x.length; i += 16) {
      olda = a; oldb = b; oldc = c; oldd = d;
      a = md5ff(a, b, c, d, x[i], 7, -680876936); d = md5ff(d, a, b, c, x[i + 1], 12, -389564586); c = md5ff(c, d, a, b, x[i + 2], 17, 606105819); b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = md5ff(a, b, c, d, x[i + 4], 7, -176418897); d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426); c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341); b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416); d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417); c = md5ff(c, d, a, b, x[i + 10], 17, -42063); b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
      a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682); d = md5ff(d, a, b, c, x[i + 13], 12, -40341101); c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290); b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);
      a = md5gg(a, b, c, d, x[i + 1], 5, -165796510); d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632); c = md5gg(c, d, a, b, x[i + 11], 14, 643717713); b = md5gg(b, c, d, a, x[i], 20, -373897302);
      a = md5gg(a, b, c, d, x[i + 5], 5, -701558691); d = md5gg(d, a, b, c, x[i + 10], 9, 38016083); c = md5gg(c, d, a, b, x[i + 15], 14, -660478335); b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = md5gg(a, b, c, d, x[i + 9], 5, 568446438); d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690); c = md5gg(c, d, a, b, x[i + 3], 14, -187363961); b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
      a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467); d = md5gg(d, a, b, c, x[i + 2], 9, -51403784); c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473); b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);
      a = md5hh(a, b, c, d, x[i + 5], 4, -378558); d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463); c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562); b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
      a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060); d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353); c = md5hh(c, d, a, b, x[i + 7], 16, -155497632); b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
      a = md5hh(a, b, c, d, x[i + 13], 4, 681279174); d = md5hh(d, a, b, c, x[i], 11, -358537222); c = md5hh(c, d, a, b, x[i + 3], 16, -722521979); b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
      a = md5hh(a, b, c, d, x[i + 9], 4, -640364487); d = md5hh(d, a, b, c, x[i + 12], 11, -421815835); c = md5hh(c, d, a, b, x[i + 15], 16, 530742520); b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);
      a = md5ii(a, b, c, d, x[i], 6, -198630844); d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415); c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905); b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571); d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606); c = md5ii(c, d, a, b, x[i + 10], 15, -1051523); b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359); d = md5ii(d, a, b, c, x[i + 15], 10, -30611744); c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380); b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
      a = md5ii(a, b, c, d, x[i + 4], 6, -145523070); d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379); c = md5ii(c, d, a, b, x[i + 2], 15, 718787259); b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);
      a = safeAdd(a, olda); b = safeAdd(b, oldb); c = safeAdd(c, oldc); d = safeAdd(d, oldd);
    }
    return [a, b, c, d];
  }
  function binl2hex(binarray) {
    const hexTab = '0123456789abcdef';
    let str = '';
    for (let i = 0; i < binarray.length * 4; i++) {
      str += hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8 + 4)) & 15) + hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8)) & 15);
    }
    return str;
  }
  function str2binl(str) {
    const bin = [];
    const mask = 255;
    for (let i = 0; i < str.length * 8; i += 8) bin[i >> 5] = (bin[i >> 5] || 0) | (str.charCodeAt(i / 8) & mask);
    return bin;
  }
  return binl2hex(binlMD5(str2binl(str), str.length * 8));
}

/** 爱发电订单验证：返回 true=订单真实且已支付 */
async function verifyAfdianOrder(env, orderNo) {
  if (!env.AFDIAN_TOKEN || !env.AFDIAN_USER_ID) return false;
  const ts = Math.floor(Date.now() / 1000);
  const params = JSON.stringify({ out_biz_no: orderNo });
  const sign = md5(env.AFDIAN_TOKEN + params + ts);
  const res = await fetch('https://afdian.com/api/open/query-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: env.AFDIAN_USER_ID, params, ts, sign }),
  });
  const j = await res.json().catch(() => null);
  if (!j || j.ec !== 200) return false;
  const list = j.data?.list ?? [];
  return list.some((o) => String(o.out_biz_no) === String(orderNo) && (o.status === 2 || o.status === undefined));
}

async function handleLogin(request, env) {
  const body = await request.json().catch(() => null);
  let code = normalizeCode(body?.code);
  const deviceId = String(body?.deviceId ?? '').trim().slice(0, 128);
  const deviceName = String(body?.deviceName ?? '').trim().slice(0, 60);
  if (!deviceId) return json({ error: 'MISSING_DEVICE_ID' }, 400);

  // 爱发电订单号登录（纯数字 ≥12 位）：验证订单 → 自动开通许可，零人工发货
  if (/^\d{12,}$/.test(code)) {
    const okOrder = await verifyAfdianOrder(env, code);
    if (!okOrder) return json({ error: 'ORDER_NOT_FOUND' }, 404);
    const key = 'afdian:' + code;
    await env.DB.prepare(
      `INSERT INTO codes (code, note, max_devices, revoked, created_at) VALUES (?1, '爱发电订单自动开通', 3, 0, ?2)
       ON CONFLICT(code) DO NOTHING`,
    )
      .bind(key, Date.now())
      .run();
    code = key;
  }

  if (code.length < CODE_MIN_LEN) return json({ error: 'INVALID_CODE' }, 400);

  const row = await env.DB.prepare('SELECT code, max_devices, revoked FROM codes WHERE code = ?')
    .bind(code)
    .first();
  if (!row) return json({ error: 'CODE_NOT_FOUND' }, 404);
  if (row.revoked) return json({ error: 'CODE_REVOKED' }, 403);

  const bound = await env.DB.prepare('SELECT device_id FROM devices WHERE code = ?').bind(code).all();
  const ids = (bound.results ?? []).map((r) => r.device_id);
  if (!ids.includes(deviceId) && ids.length >= (row.max_devices ?? 3)) {
    return json(
      { error: 'TOO_MANY_DEVICES', bound: ids.length, max: row.max_devices ?? 3, canSelfUnbind: true },
      403,
    );
  }

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO devices (code, device_id, device_name, activated_at, last_seen)
     VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(code, device_id) DO UPDATE SET last_seen = ?4, device_name = ?3`,
  )
    .bind(code, deviceId, deviceName, now)
    .run();

  const exp = Math.floor(now / 1000) + TOKEN_TTL_SEC;
  const token = await signToken({ c: code, d: deviceId, exp, iat: Math.floor(now / 1000) }, env.LICENSE_SECRET);
  return json({ token, exp, code });
}

async function handleValidate(request, env) {
  const body = await request.json().catch(() => null);
  const data = await verifyToken(body?.token, env.LICENSE_SECRET);
  if (!data) return json({ ok: false, reason: 'TOKEN_INVALID_OR_EXPIRED' }, 401);

  const row = await env.DB.prepare('SELECT revoked FROM codes WHERE code = ?')
    .bind(data.c)
    .first();
  if (!row || row.revoked) return json({ ok: false, reason: 'CODE_REVOKED' }, 401);

  const dev = await env.DB.prepare('SELECT device_id FROM devices WHERE code = ? AND device_id = ?')
    .bind(data.c, data.d)
    .first();
  if (!dev) return json({ ok: false, reason: 'DEVICE_UNBOUND' }, 401);

  await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE code = ? AND device_id = ?')
    .bind(Date.now(), data.c, data.d)
    .run();

  return json({ ok: true, code: data.c, exp: data.exp });
}

/** 玩家自助换绑：清空该码全部设备，30 天冷却（防滥用/防恶意解绑他人） */
async function handleSelfUnbind(request, env) {
  const body = await request.json().catch(() => null);
  const code = normalizeCode(body?.code);
  if (code.length < CODE_MIN_LEN) return json({ error: 'INVALID_CODE' }, 400);

  const row = await env.DB.prepare(
    'SELECT code, revoked, last_self_unbind_at FROM codes WHERE code = ?',
  )
    .bind(code)
    .first();
  if (!row || row.revoked) return json({ error: 'CODE_NOT_FOUND_OR_REVOKED' }, 404);

  const last = row.last_self_unbind_at ?? 0;
  const waitMs = SELF_UNBIND_COOLDOWN_MS - (Date.now() - last);
  if (waitMs > 0) {
    return json(
      { error: 'COOLDOWN', retryAfterDays: Math.ceil(waitMs / 86400000) },
      429,
    );
  }

  await env.DB.prepare('DELETE FROM devices WHERE code = ?').bind(code).run();
  await env.DB.prepare('UPDATE codes SET last_self_unbind_at = ? WHERE code = ?')
    .bind(Date.now(), code)
    .run();
  return json({ ok: true, message: '旧设备已全部解绑，请重新登录' });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (!env.DB || !env.LICENSE_SECRET || !env.ADMIN_KEY) {
        return json({ error: 'GATEWAY_NOT_CONFIGURED' }, 500);
      }
      await ensureSchema(env);

      if (request.method === 'GET' && path === '/api/ping') {
        return json({ ok: true, service: 'rust-belt-license', time: Date.now() });
      }
      if (request.method === 'POST' && path === '/api/login') {
        return cors(await handleLogin(request, env));
      }
      if (request.method === 'POST' && path === '/api/validate') {
        return cors(await handleValidate(request, env));
      }
      if (request.method === 'POST' && path === '/api/self-unbind') {
        return cors(await handleSelfUnbind(request, env));
      }

      // ── 管理端 ──
      if (!(await requireAdmin(request, env))) return json({ error: 'FORBIDDEN' }, 403);

      if (request.method === 'POST' && path === '/api/admin/codes') {
        const body = await request.json().catch(() => ({}));
        const count = Math.max(1, Math.min(5000, Number(body?.count) || 1));
        const maxDevices = Math.max(1, Math.min(10, Number(body?.maxDevices) || 3));
        const note = String(body?.note ?? '').slice(0, 120);
        const codes = [];
        for (let i = 0; i < count; i++) {
          let code = genCode();
          for (let t = 0; t < 5; t++) {
            const exists = await env.DB.prepare('SELECT code FROM codes WHERE code = ?').bind(code).first();
            if (!exists) break;
            code = genCode();
          }
          await env.DB.prepare('INSERT INTO codes (code, note, max_devices, revoked, created_at) VALUES (?1, ?2, ?3, 0, ?4)')
            .bind(code, note, maxDevices, Date.now())
            .run();
          codes.push(code);
        }
        return json({ codes, maxDevices, note });
      }

      if (request.method === 'GET' && path === '/api/admin/codes') {
        const res = await env.DB.prepare(
          `SELECT c.code, c.note, c.max_devices, c.revoked, c.created_at, c.last_self_unbind_at,
                  COUNT(d.device_id) AS devices
           FROM codes c LEFT JOIN devices d ON d.code = c.code
           GROUP BY c.code ORDER BY c.created_at DESC LIMIT 1000`,
        ).all();
        return json({ codes: res.results ?? [] });
      }

      if (request.method === 'POST' && path === '/api/admin/revoke') {
        const body = await request.json().catch(() => ({}));
        const code = normalizeCode(body?.code);
        if (!code) return json({ error: 'MISSING_CODE' }, 400);
        await env.DB.prepare('UPDATE codes SET revoked = 1 WHERE code = ?').bind(code).run();
        return json({ ok: true, code });
      }

      if (request.method === 'POST' && path === '/api/admin/unbind') {
        const body = await request.json().catch(() => ({}));
        const code = normalizeCode(body?.code);
        const deviceId = String(body?.deviceId ?? '').trim();
        if (!code) return json({ error: 'MISSING_CODE' }, 400);
        if (deviceId) {
          await env.DB.prepare('DELETE FROM devices WHERE code = ? AND device_id = ?').bind(code, deviceId).run();
        } else {
          await env.DB.prepare('DELETE FROM devices WHERE code = ?').bind(code).run();
        }
        return json({ ok: true, code });
      }

      return json({ error: 'NOT_FOUND' }, 404);
    } catch (err) {
      return json({ error: 'SERVER_ERROR', detail: String(err) }, 500);
    }
  },
};
