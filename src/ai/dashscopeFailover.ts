/**
 * DashScope 域名自救（玩家零设置）
 *
 * 背景：`dashscope.aliyuncs.com` 是阿里云 GTM 调度名（CNAME →
 * `gtm-cn-xxxx.dashscope.aliyuncs.com`）。少数手机/运营商 DNS 不跟随
 * 这条 CNAME，直接返回 NODATA，Android 原生 Http 就抛
 * `Unable to resolve host ... No address associated with hostname`。
 * 这不是玩家该去改「私人 DNS」的事，必须由 App 自己兜住。
 *
 * 策略（全部自动，无设置项）：
 * 1. 仍先试主域名（正常网络下零额外开销）。
 * 2. 解析失败时，改用 GTM 目标域名直连（它是直接 A 记录，不依赖 CNAME 跟随；
 *    证书覆盖 `*.dashscope.aliyuncs.com`）。
 * 3. GTM 目标名会变，因此运行期用 **DoH over IP**（`https://223.5.5.5`，
 *    连域名解析都不需要）发现当前真实目标名，并缓存到 localStorage。
 * 4. 全部失败才认为真的没网。
 */

const PRIMARY_HOST = 'dashscope.aliyuncs.com';
/** 构建期已知的 GTM 目标，作为 DoH 不可用时的兜底 */
const GTM_FALLBACK_HOST = 'gtm-cn-rt54j1mlg03.dashscope.aliyuncs.com';
const GTM_HOST_STORAGE = 'rust-belt-dashscope-gtm-host';
/** AliDNS 的 DoH 端点：直接用 IP，避免「解析域名来修域名解析」的死循环 */
const DOH_ENDPOINTS = ['https://223.5.5.5/resolve', 'https://223.6.6.6/resolve'];

const DNS_FAILURE_PATTERN =
  /unable to resolve host|no address associated|unknownhost|enotfound|eai_again|eai_nodata|name or service not known/i;

export function isDnsFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return DNS_FAILURE_PATTERN.test(msg);
}

function readCachedGtmHost(): string {
  try {
    const raw = localStorage.getItem(GTM_HOST_STORAGE) ?? '';
    return /^[a-z0-9.-]+\.dashscope\.aliyuncs\.com$/i.test(raw) ? raw : '';
  } catch {
    return '';
  }
}

function writeCachedGtmHost(host: string): void {
  try {
    localStorage.setItem(GTM_HOST_STORAGE, host);
  } catch {
    /* ignore */
  }
}

type DohAnswer = { Status?: number; Answer?: { type: number; data: string }[] };

/**
 * 用 DoH 查主域名的 CNAME 目标。全程只连 IP，不依赖系统 DNS。
 * 失败返回 ''（调用方继续用兜底名）。
 */
async function discoverGtmHost(timeoutMs = 6000): Promise<string> {
  for (const endpoint of DOH_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${endpoint}?name=${PRIMARY_HOST}&type=A`, {
        headers: { accept: 'application/dns-json' },
        signal: ctrl.signal,
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const data = (await res.json()) as DohAnswer;
      if (data.Status !== 0) continue;
      const cname = (data.Answer ?? []).find((a) => a.type === 5)?.data?.replace(/\.$/, '');
      if (cname && cname !== PRIMARY_HOST && cname.endsWith('.dashscope.aliyuncs.com')) {
        writeCachedGtmHost(cname);
        return cname;
      }
    } catch {
      /* 换下一个 DoH 端点 */
    } finally {
      clearTimeout(timer);
    }
  }
  return '';
}

function replaceHost(url: string, host: string): string {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('aliyuncs.com')) return url;
    u.hostname = host;
    return u.toString();
  } catch {
    return url;
  }
}

let discoveredHost = '';
let discoveryInFlight: Promise<string> | null = null;

async function resolveAlternateHost(): Promise<string> {
  if (discoveredHost) return discoveredHost;
  const cached = readCachedGtmHost();
  if (cached) {
    discoveredHost = cached;
    return cached;
  }
  if (!discoveryInFlight) {
    discoveryInFlight = discoverGtmHost()
      .then((host) => {
        discoveredHost = host || GTM_FALLBACK_HOST;
        return discoveredHost;
      })
      .finally(() => {
        discoveryInFlight = null;
      });
  }
  return discoveryInFlight;
}

/**
 * 通用自救执行器：先按原 URL 跑，只有「DNS 解析失败」才换 GTM 域名重跑。
 * 兼容 fetch / CapacitorHttp / XHR 等各种执行方式（只要能抛出原生报错）。
 */
export async function runWithDashscopeFailover<T>(
  url: string,
  run: (finalUrl: string) => Promise<T>,
): Promise<T> {
  let dnsError: unknown;
  try {
    return await run(url);
  } catch (err) {
    if (!isDnsFailure(err)) throw err;
    dnsError = err;
  }

  const alternateHost = await resolveAlternateHost();
  if (!alternateHost || alternateHost === PRIMARY_HOST) throw dnsError;

  const alternateUrl = replaceHost(url, alternateHost);
  if (alternateUrl === url) throw dnsError;

  try {
    return await run(alternateUrl);
  } catch (err) {
    if (!isDnsFailure(err)) throw err;
    // 缓存的 GTM 名可能已轮换：强制重新发现一次再试
    discoveredHost = '';
    try {
      localStorage.removeItem(GTM_HOST_STORAGE);
    } catch {
      /* ignore */
    }
    const fresh = await resolveAlternateHost();
    const freshUrl = fresh ? replaceHost(url, fresh) : url;
    if (!fresh || fresh === alternateHost || freshUrl === url) throw err;
    return run(freshUrl);
  }
}

/**
 * 带域名自救的 fetch。其他错误（超时、鉴权、业务错）原样抛给上层，不掩盖真实原因。
 */
export async function fetchDashscope(
  url: string,
  init: RequestInit,
): Promise<Response> {
  return runWithDashscopeFailover(url, async (finalUrl) => {
    const res = await fetch(finalUrl, init);
    // 同一连接可能已失效：仅在 DNS 场景下重跑，这里不需要额外处理
    return res;
  });
}

/** 只用于诊断展示：当前会尝试的域名顺序 */
export function dashscopeHostChain(): string[] {
  const chain = [PRIMARY_HOST];
  const cached = readCachedGtmHost() || GTM_FALLBACK_HOST;
  if (cached && !chain.includes(cached)) chain.push(cached);
  return chain;
}
