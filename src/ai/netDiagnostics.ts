/**
 * 网络自检：把「连不上千问」拆成可读的分层结论。
 *
 * 只做极小的 GET（不消耗额度）。三项对照：
 * - 主域名 `dashscope.aliyuncs.com`：正常应返回 401（没带 Key）
 * - 备用域名（GTM 目标）：主域名解析失败时，App 实际会切到这里
 * - 对照组域名：区分「全局断网」和「只有千问域名解析失败」
 *
 * 玩家不需要改任何手机设置：主域名解析失败时，
 * `dashscopeFailover` 会自动换域名直连。这里只是把结果说清楚。
 */

import { dashscopeHostChain, isDnsFailure } from './dashscopeFailover';

export type NetDiagCheck = {
  label: string;
  url: string;
  /** ok=链路通；dns=域名解析失败；offline=本机无网络；error=其他 */
  status: 'ok' | 'dns' | 'offline' | 'error';
  detail: string;
};

const OFFLINE_PATTERN =
  /failed to fetch|networkerror|network error|enotfound|econnrefused|econnreset|ehostunreach|enetunreach|eai_again/i;

function classify(err: unknown): { status: 'dns' | 'offline' | 'error'; detail: string } {
  const name = (err as { name?: string } | null)?.name;
  const msg = err instanceof Error ? err.message : String(err);
  if (name === 'AbortError') return { status: 'error', detail: '超时（15 秒）' };
  if (isDnsFailure(err)) return { status: 'dns', detail: '域名解析失败（本机 DNS 拿不到 IP）' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { status: 'offline', detail: '设备显示无网络连接' };
  }
  if (OFFLINE_PATTERN.test(msg)) return { status: 'offline', detail: '连接建立失败（被拦截或无法出网）' };
  return { status: 'error', detail: msg.slice(0, 100) };
}

async function probe(label: string, url: string): Promise<NetDiagCheck> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal, cache: 'no-store' });
    // 401 / 400 / 403 / 404 都算「链路已通」——只是没带鉴权或路径不对
    if (res.status < 500) {
      return { label, url, status: 'ok', detail: `HTTP ${res.status}（链路正常）` };
    }
    return { label, url, status: 'error', detail: `HTTP ${res.status}（服务端异常）` };
  } catch (err) {
    const c = classify(err);
    return { label, url, status: c.status, detail: c.detail };
  } finally {
    clearTimeout(timer);
  }
}

export async function runNetworkDiagnostics(): Promise<NetDiagCheck[]> {
  const [primary, ...rest] = dashscopeHostChain();
  const apiPath = '/compatible-mode/v1/models';
  return Promise.all([
    probe('千问主域名', `https://${primary}${apiPath}`),
    ...(rest[0] ? [probe('千问备用域名', `https://${rest[0]}${apiPath}`)] : []),
    probe('对照域名', 'https://license.youziligames.com/health'),
  ]);
}

/** 一句话结论，直接给玩家看（不谈设置，只讲 App 已经做了什么） */
export function summarizeDiagnostics(checks: NetDiagCheck[]): string {
  const primary = checks.find((c) => c.label.includes('主域名'));
  const backup = checks.find((c) => c.label.includes('备用'));
  const other = checks.find((c) => c.label.includes('对照'));
  if (!primary) return '未执行';

  if (primary.status === 'ok') return '千问链路正常，AI 可用。';
  if (backup?.status === 'ok') {
    return '主域名在你当前网络下解析失败，App 已自动切到备用线路，AI 可正常使用。';
  }
  if (primary.status === 'offline' && other?.status === 'offline') {
    return '这台设备整体出不了网（飞行模式 / 流量被限）。联网后 AI 自动恢复，存档不受影响。';
  }
  if (primary.status === 'dns' || backup?.status === 'dns') {
    if (other && other.status === 'ok') {
      return '千问主/备域名都被当前网络拦截，但其他网站正常。请稍后重试，或切换 Wi-Fi / 流量后再试。';
    }
    return '设备 DNS 整体异常（所有域名都解析失败）。换个网络后会自动恢复。';
  }
  return `千问请求异常：${primary.detail}`;
}
