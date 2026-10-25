/**
 * P3 启动版本门（仅原生生效，Web/开发环境直接放行）
 *
 * 判定规则（服务端 GET /api/version，配置见 gateway/worker.js /api/admin/release）：
 *  - 强更：本地 versionCode < minBuild → 弹迭代告示，只能去下载新 APK，阻断进入游戏。
 *    （系统逻辑/玩家流程变更走这条路：玩家必须装完新包、重启后才能进，杜绝边玩边出 BUG）
 *  - 弱更：assetHash ≠ 包内清单 contentHash → 静默拉远端分层清单，后台下载差异资源
 *    （美术-only 更新：边玩边下，sha256 校验通过才替换，不打断玩家）
 * 网关不可达 / 未配置 → 放行，不拦玩家。
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { gatewayBaseUrls } from './license';
import { applyRemoteCdnManifest, getAssetCdnBase, getBundledCdnManifest } from '../utils/shipAssets';
import { pruneOrphanCacheFiles, startAssetDownload } from './assetDownloader';

export type ReleaseInfo = {
  latestBuild: number;
  minBuild: number;
  apkUrl: string;
  notes: string;
  assetHash: string;
};

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/** 多网关依次尝试拉版本信息；全部失败返回 null（放行） */
export async function fetchReleaseInfo(timeoutMs = 10000): Promise<ReleaseInfo | null> {
  for (const base of gatewayBaseUrls()) {
    try {
      const url = `${base.replace(/\/$/, '')}/api/version`;
      let data: Record<string, unknown> | null = null;
      if (isNative()) {
        const res = await CapacitorHttp.get({ url, connectTimeout: timeoutMs, readTimeout: timeoutMs });
        if (res.status !== 200) continue;
        data = (res.data ?? null) as Record<string, unknown> | null;
      } else {
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
          if (!res.ok) continue;
          data = (await res.json()) as Record<string, unknown>;
        } finally {
          window.clearTimeout(timer);
        }
      }
      if (!data) continue;
      return {
        latestBuild: Number(data.latestBuild) || 0,
        minBuild: Number(data.minBuild) || 0,
        apkUrl: String(data.apkUrl ?? ''),
        notes: String(data.notes ?? ''),
        assetHash: String(data.assetHash ?? ''),
      };
    } catch {
      /* 尝试下一个网关 */
    }
  }
  return null;
}

/** 弱更：拉远端分层清单替换内存表，然后后台静默下载差异 */
async function pullRemoteManifestAndSync(): Promise<void> {
  try {
    const url = `${getAssetCdnBase()}ship-manifest-cdn.json?t=${Date.now()}`;
    let data: unknown = null;
    if (isNative()) {
      const res = await CapacitorHttp.get({ url, connectTimeout: 12000, readTimeout: 12000 });
      if (res.status !== 200) return;
      data = res.data;
    } else {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) return;
      data = await res.json();
    }
    const changed = applyRemoteCdnManifest(data as Parameters<typeof applyRemoteCdnManifest>[0]);
    if (changed) {
      void startAssetDownload().catch(() => undefined);
      // 远端清单已生效（含开发侧删除的资源条目）→ 清理缓存里的孤儿文件
      void pruneOrphanCacheFiles().catch(() => undefined);
    }
  } catch {
    /* 弱更失败本次跳过，下次启动再试 */
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** 强更拦截弹窗：无关闭按钮，只能去下载新包；装完重启自然过门 */
function showForceUpdateOverlay(info: ReleaseInfo): void {
  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '版本更新');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 10000;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 14px; padding: 24px; text-align: center; overflow-y: auto;
    background: radial-gradient(120% 90% at 50% 12%, #171a22 0%, #0a0b0f 62%, #06070a 100%);
    color: #e8e2d6; font-family: 'Rajdhani','Noto Sans SC',system-ui,sans-serif;`;

  const notesHtml = info.notes.trim()
    ? `<div style="width:min(340px,86vw);max-height:34vh;overflow-y:auto;text-align:left;font-size:13px;line-height:1.8;
                  color:#d8d2c4;background:rgba(232,185,106,.06);border:1px solid rgba(232,185,106,.25);
                  border-radius:10px;padding:12px 14px;white-space:pre-wrap;">${escapeHtml(info.notes)}</div>`
    : '';

  overlay.innerHTML = `
    <div style="font-size:12px;letter-spacing:.5em;color:#8b8474;text-transform:uppercase;">Rust Belt Era</div>
    <h1 style="margin:0;font-size:24px;letter-spacing:.14em;color:#e8b96a;text-shadow:0 0 22px rgba(232,185,106,.25);">版本更新</h1>
    <p style="margin:0;font-size:13px;color:#b9b2a2;max-width:340px;line-height:1.8;">
      本次更新包含<b style="color:#e8b96a">系统与玩法调整</b>，为确保存档与体验一致，<br />
      需要下载并安装新版本后才能进入游戏。
    </p>
    ${notesHtml}
    <button data-dl type="button"
      style="width:min(340px,86vw);padding:13px 16px;font-size:16px;letter-spacing:.24em;cursor:pointer;
             color:#14100a;background:linear-gradient(180deg,#f0c877,#d9a24a);border:none;border-radius:10px;font-weight:700;">
      下 载 新 版 本
    </button>
    <p style="margin:0;font-size:12px;color:#6f6a5e;line-height:1.7;">安装完成后重新打开游戏即可</p>`;

  overlay.querySelector('[data-dl]')?.addEventListener('click', () => {
    if (info.apkUrl) window.open(info.apkUrl, '_system');
  });
  document.body.appendChild(overlay);
}

/**
 * 启动版本门。返回 'blocked' 时调用方必须中止启动（玩家被强更拦截）。
 * 应在 loadShipManifest() 之后、进游戏之前调用。
 */
export async function runVersionGate(): Promise<'ok' | 'blocked'> {
  if (!isNative()) return 'ok';
  const info = await fetchReleaseInfo();
  if (!info) return 'ok';

  // 本地 versionCode
  let build = 0;
  try {
    const { App } = await import('@capacitor/app');
    const i = await App.getInfo();
    build = Number(i.build) || 0;
  } catch {
    /* 读不到则不做强更判定 */
  }

  if (info.minBuild > 0 && build > 0 && build < info.minBuild) {
    showForceUpdateOverlay(info);
    return 'blocked';
  }

  // 弱更：资源 hash 不一致 → 静默更新（后台，不阻塞启动）
  const bundled = getBundledCdnManifest();
  if (info.assetHash && bundled && info.assetHash !== bundled.contentHash) {
    void pullRemoteManifestAndSync();
  } else if (info.assetHash && bundled && info.assetHash === bundled.contentHash) {
    // 服务端确认包内清单即最新 → 清理缓存里的历史孤儿（开发侧已删除的资源）
    void pruneOrphanCacheFiles().catch(() => undefined);
  }
  return 'ok';
}
