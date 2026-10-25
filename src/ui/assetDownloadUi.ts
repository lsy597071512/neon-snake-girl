/**
 * P3 资源云分发 · 下载 UI
 * - showAssetDownloadOverlayIfNeeded()：登录/启动门禁后调用。有待下远端资源时弹**全屏下载面板**：
 *   展示总大小/进度条/当前文件，可随时点「进入游戏」转后台续下；下载完成自动放行，
 *   有失败文件时可重试或直接进游戏（未下完的皮肤走 CDN 在线加载，不黑图）。
 * - bootAssetDownloadIndicator()：主页浮动进度入口（body 级，不随页面重渲染丢失），
 *   点击展开详情面板，可手动开始/暂停/重试下载。
 * 仅原生（Capacitor）生效；Web/开发环境直接 noop。
 */

import { Capacitor } from '@capacitor/core';
import {
  cancelAssetDownload,
  getAssetDownloadState,
  getRemoteAssetStats,
  listPendingRemoteAssets,
  onAssetDownloadEvent,
  startAssetDownload,
} from '../platform/assetDownloader';
import {
  applyBadgePos,
  loadBadgePos,
  makeBadgeDraggable,
} from './badgeDrag';

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

function fmtMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

const GOLD = '#e8b96a';
const DIM = '#b9b2a2';
const PANEL_BG = 'rgba(16,18,24,.96)';

/* ---------------- 登录后：全屏下载面板（可转后台） ---------------- */

/**
 * 有待下载的远端资源时弹全屏下载面板；否则立即返回。
 * 面板内可暂停/继续/重试；点「进入游戏」转后台续下（主页 pill 可查进度）；
 * 下载完成自动放行，零失败才自动进入。
 */
export async function showAssetDownloadOverlayIfNeeded(): Promise<void> {
  if (!isNative()) return;
  let pending;
  try {
    pending = await listPendingRemoteAssets();
  } catch {
    return;
  }
  if (!pending.length) return;
  const totalBytes = pending.reduce((s, e) => s + e.size, 0);

  await new Promise<void>((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '资源下载');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9400; display: flex; align-items: center; justify-content: center;
      background: radial-gradient(120% 90% at 50% 12%, #171a22 0%, #0a0b0f 62%, #06070a 100%);
      font-family: 'Rajdhani','Noto Sans SC',system-ui,sans-serif;`;

    overlay.innerHTML = `
      <div style="width:min(360px,90vw);padding:24px 20px;border-radius:14px;background:${PANEL_BG};border:1px solid #3a3d47;
                  color:#e8e2d6;display:flex;flex-direction:column;gap:10px;text-align:center;">
        <div style="font-size:12px;letter-spacing:.5em;color:#8b8474;text-transform:uppercase;">Rust Belt Era</div>
        <div style="font-size:17px;letter-spacing:.12em;color:${GOLD};font-weight:700;">资源下载</div>
        <div data-g-line style="font-size:13px;color:${DIM};line-height:1.7;">
          皮肤等美术资源共 ${fmtMb(totalBytes)} MB<br />下载后可离线游玩；也可先进入游戏边玩边下
        </div>
        <div style="width:100%;height:10px;border-radius:6px;background:#20232c;border:1px solid #3a3d47;overflow:hidden;">
          <div data-g-fill style="height:100%;width:0%;border-radius:6px;background:linear-gradient(90deg,#d9a24a,#f0c877);transition:width .2s ease;"></div>
        </div>
        <div data-g-file style="font-size:11px;color:#6f6a5e;min-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:6px;">
          <button data-g-enter type="button" style="flex:1;padding:12px 14px;font-size:15px;letter-spacing:.2em;cursor:pointer;color:#14100a;
            background:linear-gradient(180deg,#f0c877,#d9a24a);border:none;border-radius:10px;font-weight:700;">进入游戏</button>
          <button data-g-toggle type="button" style="padding:12px 14px;font-size:13px;cursor:pointer;color:${DIM};
            background:rgba(232,185,106,.08);border:1px solid rgba(232,185,106,.35);border-radius:10px;">暂停</button>
        </div>
        <div style="font-size:11px;color:#6f6a5e;">进入游戏后下载在后台继续，点屏幕左侧浮动图标可查看/管理</div>
      </div>`;

    const fill = overlay.querySelector<HTMLElement>('[data-g-fill]')!;
    const line = overlay.querySelector<HTMLElement>('[data-g-line]')!;
    const fileLine = overlay.querySelector<HTMLElement>('[data-g-file]')!;
    const enterBtn = overlay.querySelector<HTMLButtonElement>('[data-g-enter]')!;
    const toggleBtn = overlay.querySelector<HTMLButtonElement>('[data-g-toggle]')!;

    const finish = () => {
      off();
      overlay.remove();
      resolve();
    };

    const off = onAssetDownloadEvent((e) => {
      const s = e.state;
      if (e.type === 'queue-done') {
        if (e.failed.length === 0) {
          fill.style.width = '100%';
          line.innerHTML = '资源就绪，正在进入…';
          fileLine.textContent = '';
          toggleBtn.disabled = true;
          window.setTimeout(finish, 900);
        } else {
          line.innerHTML = `已下载 ${fmtMb(s.queueLoaded)} / ${fmtMb(s.queueTotal)} MB<br /><span style="color:#e08a8a;">${e.failed.length} 个文件失败，可重试（不 retry 也可先进游戏）</span>`;
          toggleBtn.textContent = '重试';
          toggleBtn.disabled = false;
        }
        return;
      }
      fill.style.width = `${s.queuePercent.toFixed(1)}%`;
      line.innerHTML = `下载中 ${s.queuePercent.toFixed(1)}% · ${fmtMb(s.queueLoaded)} / ${fmtMb(s.queueTotal)} MB`;
      fileLine.textContent = s.currentFile ?? '';
    });

    enterBtn.addEventListener('click', finish);
    toggleBtn.addEventListener('click', () => {
      if (getAssetDownloadState().running) {
        cancelAssetDownload();
        toggleBtn.textContent = '继续';
        fileLine.textContent = '已暂停';
      } else {
        toggleBtn.textContent = '暂停';
        void startAssetDownload().catch(() => undefined);
      }
    });

    document.body.appendChild(overlay);
    void startAssetDownload(pending).catch(() => undefined);
  });
}

/* ---------------- 主页浮动进度入口 ---------------- */

const INDICATOR_ID = 'asset-dl-indicator';
const MODAL_ID = 'asset-dl-modal';
/** 拖动位置持久化键（rb-ui-badge-pos- 前缀，见 badgeDrag.ts） */
const INDICATOR_BADGE_KEY = 'asset-download';

async function refreshIndicator(): Promise<void> {
  const pill = document.getElementById(INDICATOR_ID);
  if (!pill) return;
  const s = getAssetDownloadState();
  if (s.running) return; // 运行中由事件驱动刷新
  try {
    const stats = await getRemoteAssetStats();
    if (stats.total === 0 || stats.cached >= stats.total) {
      pill.hidden = true;
      return;
    }
    pill.hidden = false;
    const pct = stats.totalBytes > 0 ? Math.round((stats.cachedBytes / stats.totalBytes) * 100) : 0;
    pill.textContent = `资源下载 ${pct}%（${stats.cached}/${stats.total}）`;
  } catch {
    /* ignore */
  }
}

function openDownloadModal(): void {
  if (document.getElementById(MODAL_ID)) return;
  const modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', '资源下载详情');
  modal.style.cssText = `
    position: fixed; inset: 0; z-index: 9500; display: flex; align-items: center; justify-content: center;
    background: rgba(4,5,8,.72); font-family: 'Rajdhani','Noto Sans SC',system-ui,sans-serif;`;

  modal.innerHTML = `
    <div style="width:min(360px,90vw);padding:20px;border-radius:14px;background:${PANEL_BG};border:1px solid #3a3d47;
                color:#e8e2d6;display:flex;flex-direction:column;gap:10px;text-align:center;">
      <div style="font-size:17px;letter-spacing:.12em;color:${GOLD};font-weight:700;">资源下载</div>
      <div data-m-line style="font-size:13px;color:${DIM};">读取中…</div>
      <div style="width:100%;height:10px;border-radius:6px;background:#20232c;border:1px solid #3a3d47;overflow:hidden;">
        <div data-m-fill style="height:100%;width:0%;border-radius:6px;background:linear-gradient(90deg,#d9a24a,#f0c877);transition:width .2s ease;"></div>
      </div>
      <div data-m-file style="font-size:11px;color:#6f6a5e;min-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:4px;">
        <button data-m-start type="button" style="padding:9px 14px;font-size:13px;cursor:pointer;color:#14100a;
          background:linear-gradient(180deg,#f0c877,#d9a24a);border:none;border-radius:8px;font-weight:700;">开始下载</button>
        <button data-m-close type="button" style="padding:9px 14px;font-size:13px;cursor:pointer;color:${DIM};
          background:rgba(232,185,106,.08);border:1px solid rgba(232,185,106,.35);border-radius:8px;">关 闭</button>
      </div>
    </div>`;

  const fill = modal.querySelector<HTMLElement>('[data-m-fill]')!;
  const line = modal.querySelector<HTMLElement>('[data-m-line]')!;
  const fileLine = modal.querySelector<HTMLElement>('[data-m-file]')!;
  const startBtn = modal.querySelector<HTMLButtonElement>('[data-m-start]')!;

  const close = () => {
    off();
    modal.remove();
  };

  const render = async () => {
    const s = getAssetDownloadState();
    if (s.running) {
      fill.style.width = `${s.queuePercent.toFixed(1)}%`;
      line.textContent = `下载中 ${s.queuePercent.toFixed(1)}% · ${fmtMb(s.queueLoaded)} / ${fmtMb(s.queueTotal)} MB`;
      fileLine.textContent = s.currentFile ?? '';
      startBtn.textContent = '暂停下载';
      startBtn.disabled = false;
      return;
    }
    const stats = await getRemoteAssetStats();
    if (stats.total === 0 || stats.cached >= stats.total) {
      fill.style.width = '100%';
      line.textContent = '全部资源已就绪';
      fileLine.textContent = '';
      startBtn.disabled = true;
      startBtn.textContent = '已完成';
      return;
    }
    const pct = stats.totalBytes > 0 ? (stats.cachedBytes / stats.totalBytes) * 100 : 0;
    fill.style.width = `${pct.toFixed(1)}%`;
    line.textContent = `已下载 ${fmtMb(stats.cachedBytes)} / ${fmtMb(stats.totalBytes)} MB（${stats.cached}/${stats.total} 个文件）`;
    fileLine.textContent = '';
    startBtn.disabled = false;
    startBtn.textContent = '继续下载';
  };

  const off = onAssetDownloadEvent((e) => {
    if (e.type === 'queue-done') void refreshIndicator();
    void render();
  });

  startBtn.addEventListener('click', () => {
    if (getAssetDownloadState().running) {
      cancelAssetDownload();
      void refreshIndicator();
      void render();
    } else {
      void startAssetDownload().catch(() => undefined);
    }
  });
  modal.querySelector('[data-m-close]')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  document.body.appendChild(modal);
  void render();
}

/** 主页浮动入口：有待下资源或下载进行中时显示；点击展开详情。挂载一次即可（body 级）。 */
export function bootAssetDownloadIndicator(): void {
  if (!isNative() || document.getElementById(INDICATOR_ID)) return;

  const pill = document.createElement('button');
  pill.id = INDICATOR_ID;
  pill.type = 'button';
  pill.hidden = true;
  pill.style.cssText = `
    position: fixed; left: 12px; top: 15%; z-index: 9000;
    padding: 8px 12px; font-size: 12px; letter-spacing: .04em; cursor: pointer;
    color: ${GOLD}; background: ${PANEL_BG}; border: 1px solid rgba(232,185,106,.45); border-radius: 999px;
    font-family: 'Rajdhani','Noto Sans SC',system-ui,sans-serif;
    box-shadow: 0 2px 12px rgba(0,0,0,.45);`;
  pill.addEventListener('click', openDownloadModal);
  // 玩家可自行拖动 pill 避让面板文字；位置持久化，重进自动恢复
  const savedPos = loadBadgePos(INDICATOR_BADGE_KEY);
  if (savedPos) applyBadgePos(pill, savedPos);
  makeBadgeDraggable(pill, INDICATOR_BADGE_KEY);
  document.body.appendChild(pill);

  onAssetDownloadEvent((e) => {
    const s = e.state;
    pill.hidden = false;
    pill.textContent = s.running
      ? `资源下载 ${s.queuePercent.toFixed(0)}%`
      : `资源下载 ${s.queuePercent.toFixed(0)}% · 完成`;
    if (e.type === 'queue-done') {
      window.setTimeout(() => void refreshIndicator(), 1200);
    }
  });

  void refreshIndicator();
}
