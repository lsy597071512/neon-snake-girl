/**
 * 激活许可（私测发行）：激活码 → 设备绑定 → HMAC token。
 * - token 30 天有效；在线时每 24h 向网关校验一次（吊销/解绑在此生效）
 * - 校验失败因断网 → 宽限放行（AI 功能本来就需要网络，损失可控）
 * - 网关地址支持多备用 + localStorage 'rb-gateway-urls' 临时覆盖（调试/换域名免重打包）
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';

/** 网关地址：部署后把你的 Worker 域名填在第一位（支持多个，按序尝试） */
const GATEWAY_URLS: string[] = [
  'https://license.youziligames.com',
  'https://rust-belt-license.lsy-games.workers.dev',
];

const TOKEN_KEY = 'rb-license-token';
const DEVICE_KEY = 'rb-device-id';
const LAST_VALIDATE_KEY = 'rb-license-validated-at';
const GATEWAY_OVERRIDE_KEY = 'rb-gateway-urls';

export type LicenseState = {
  licensed: boolean;
  code: string | null;
  expiresAt: number | null;
  deviceId: string;
};

function gatewayUrls(): string[] {
  try {
    const override = localStorage.getItem(GATEWAY_OVERRIDE_KEY);
    if (override?.trim()) {
      const list = override
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s.startsWith('http'));
      if (list.length) return list;
    }
  } catch {
    /* ignore */
  }
  return GATEWAY_URLS;
}

/** 网关地址列表（版本门等其它模块复用同一组备用网关 + override） */
export function gatewayBaseUrls(): string[] {
  return gatewayUrls();
}

/** 稳定设备 ID：原生用 Android ID（同签名重装不变）；Web 回退本地 UUID */
export async function getDeviceId(): Promise<string> {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  let id = '';
  if (Capacitor.isNativePlatform()) {
    try {
      const { Device } = await import('@capacitor/device');
      const info = await Device.getId();
      id = (info.identifier ?? '').trim();
    } catch {
      /* ignore */
    }
  }
  if (!id) {
    id = 'web-' + (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function parseTokenPayload(token: string): { c?: string; d?: string; exp?: number } | null {
  try {
    const [payload] = token.split('.');
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function tokenLocallyValid(): boolean {
  const token = readToken();
  if (!token) return false;
  const data = parseTokenPayload(token);
  if (!data?.exp) return false;
  return Date.now() / 1000 < data.exp;
}

function readTokenAccount(): string | null {
  return parseTokenPayload(readToken())?.c ?? null;
}

async function postJson(url: string, path: string, body: unknown, timeoutMs = 12000): Promise<{ status: number; data: Record<string, unknown> }> {
  const endpoint = url.replace(/\/$/, '') + path;
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({
      url: endpoint,
      headers: { 'Content-Type': 'application/json' },
      data: body,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
    return { status: res.status, data: (res.data ?? {}) as Record<string, unknown> };
  }

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, data };
  } finally {
    window.clearTimeout(timer);
  }
}

/** 依次尝试所有网关地址 */
async function postToAny(
  path: string,
  body: unknown,
  timeoutMs = 12000,
): Promise<{ status: number; data: Record<string, unknown> }> {
  let lastErr: unknown = null;
  for (const base of gatewayUrls()) {
    try {
      return await postJson(base, path, body, timeoutMs);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('网关不可达');
}

/** 登录：兑换码即账号 + 设备绑定，存储 token。错误信息已转成玩家可读文案 */
export type LoginResult = { ok: boolean; message: string; tooManyDevices?: boolean };

export async function loginWithCode(rawCode: string): Promise<LoginResult> {
  const account = rawCode.trim().toUpperCase();
  if (account.length < 6) {
    return { ok: false, message: '兑换码太短，请核对（形如 RB-XXXX-XXXX，没有数字 0 和字母 O）' };
  }
  const deviceId = await getDeviceId();
  let deviceName = '';
  try {
    if (Capacitor.isNativePlatform()) {
      const { Device } = await import('@capacitor/device');
      const info = await Device.getInfo();
      deviceName = [info.manufacturer, info.model].filter(Boolean).join(' ').slice(0, 40);
    }
  } catch {
    /* ignore */
  }

  try {
    const { status, data } = await postToAny('/api/login', { code: account, deviceId, deviceName });
    if (status === 200 && typeof data.token === 'string') {
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(LAST_VALIDATE_KEY, String(Date.now()));
      return { ok: true, message: '登录成功' };
    }
    const err = String(data.error ?? '');
    const map: Record<string, string> = {
      CODE_NOT_FOUND: '兑换码不存在，请核对（注意没有数字 0 和字母 O）',
      CODE_REVOKED: '该兑换码已被停用，请联系开发者',
      INVALID_CODE: '兑换码格式不对',
      MISSING_DEVICE_ID: '设备信息读取失败，请重启游戏重试',
    };
    if (err === 'TOO_MANY_DEVICES') {
      return {
        ok: false,
        message: `该兑换码已在 ${data.bound ?? '?'} 台设备上使用（上限 ${data.max ?? '?'} 台）。可点击下方「强制解绑旧设备」自助换机（30 天一次）。`,
        tooManyDevices: true,
      };
    }
    return { ok: false, message: map[err] ?? `登录失败（${err || status}）` };
  } catch {
    return { ok: false, message: '连不上登录服务器，请检查网络后重试' };
  }
}

/** 玩家自助换绑：清空该兑换码的全部设备（30 天一次冷却，服务端强制） */
export async function selfUnbindDevices(rawCode: string): Promise<{ ok: boolean; message: string }> {
  const code = rawCode.trim().toUpperCase();
  try {
    const { status, data } = await postToAny('/api/self-unbind', { code });
    if (status === 200) return { ok: true, message: '旧设备已全部解绑，请重新登录' };
    if (data.error === 'COOLDOWN') {
      return { ok: false, message: `换绑太频繁，约 ${data.retryAfterDays ?? 30} 天后可再次自助换绑；急请联系开发者` };
    }
    if (data.error === 'CODE_NOT_FOUND_OR_REVOKED') {
      return { ok: false, message: '兑换码不存在或已被停用' };
    }
    return { ok: false, message: `解绑失败（${String(data.error ?? status)}）` };
  } catch {
    return { ok: false, message: '连不上服务器，请检查网络后重试' };
  }
}

/** 在线校验：吊销/解绑在此生效。网络失败 → 宽限放行 */
async function revalidate(): Promise<void> {
  const token = readToken();
  if (!token) return;
  try {
    const { status, data } = await postToAny('/api/validate', { token });
    if (status === 401 || data.ok === false) {
      localStorage.removeItem(TOKEN_KEY);
      return;
    }
    localStorage.setItem(LAST_VALIDATE_KEY, String(Date.now()));
  } catch {
    /* 断网宽限 */
  }
}

export async function getLicenseState(): Promise<LicenseState> {
  const deviceId = await getDeviceId();
  if (!tokenLocallyValid()) {
    return { licensed: false, code: null, expiresAt: null, deviceId };
  }
  const data = parseTokenPayload(readToken());
  const lastValidate = Number(localStorage.getItem(LAST_VALIDATE_KEY) ?? 0);
  if (Date.now() - lastValidate > 24 * 3600 * 1000 && navigator.onLine) {
    void revalidate();
  }
  return {
    licensed: true,
    code: readTokenAccount(),
    expiresAt: data?.exp ? data.exp * 1000 : null,
    deviceId,
  };
}

/** 启动门禁：已登录 → true；未登录 → 弹「账号 + API Key」界面，成功后 resolve(true) */
export async function ensureLicensed(): Promise<boolean> {
  let state = await getLicenseState();
  if (state.licensed) {
    // 老玩家：进游戏前补齐远端资源（无待下则秒过；玩家可跳过转后台下载）
    const { showAssetDownloadOverlayIfNeeded } = await import('../ui/assetDownloadUi');
    await showAssetDownloadOverlayIfNeeded();
    return true;
  }

  const { showLoginGate } = await import('../ui/loginGate');
  const activated = await showLoginGate(loginWithCode, selfUnbindDevices);
  if (!activated) return false;
  state = await getLicenseState();
  if (!state.licensed) return false;
  // 新激活玩家：登录成功后开始 P1/P2 批量下载（可跳过转后台）
  const { showAssetDownloadOverlayIfNeeded } = await import('../ui/assetDownloadUi');
  await showAssetDownloadOverlayIfNeeded();
  return true;
}

/** 调试：临时覆盖网关地址（逗号分隔），免重打包 */
export function setGatewayOverride(urls: string): void {
  localStorage.setItem(GATEWAY_OVERRIDE_KEY, urls);
}
