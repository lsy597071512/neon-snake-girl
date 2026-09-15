import './fonts.css';
import './style.css';
import './cc-ui.css';
import './sub-ui.css';
import './gallery.css';
import './title-screen.css';
import './ui/aiLiving.css';
import './ui/storyOverlay.css';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { bindViewportMetrics } from './platform/viewport';
import { initNativePlatform } from './platform/nativeInit';
import { App } from './ui/App';
import { saveManager } from './core/SaveManager';
import { recoverStaleDisciplineSession, settleActiveDisciplineSession } from './ai/disciplineSession';
import { runHubBoot } from './ui/hubBoot';
import { bindUiSounds, warmUiSound } from './ui/uiSound';
import { unlockBgm } from './audio/bgm';
import { bootAiLivingSync } from './ai/livingService';
import { loadShipManifest } from './utils/shipAssets';
import { ensureLicensed } from './platform/license';
import { forceApplyShippedHomeGpuConfig } from './ai/providerConfig';

function unlockAudioOnce(): void {
  warmUiSound();
  unlockBgm();
}

/** 页面卸载、断网或原生退后台时同步落盘，不能依赖下一次启动才恢复。 */
function settleDisciplineForLifecycle(reason: string): void {
  saveManager.mutate((save) => {
    if (!save.aiLiving) return;
    const living = save.aiLiving as import('./ai/types').AiLivingSave;
    settleActiveDisciplineSession(save, living, reason);
    save.aiLiving = living;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    bindViewportMetrics();
    // P1：先加载 ship manifest，再解析立绘/背景路径（无则 noop）
    await loadShipManifest();
    // 包内 home-gpu-config 若带新 shipId / Cloudflare，启动即套用（免选手动点营地）
    void forceApplyShippedHomeGpuConfig().catch(() => undefined);
    await initNativePlatform();
    await runHubBoot();
    const appRoot = document.getElementById('app')!;
    bindUiSounds(appRoot);

    // 多事件解锁：安卓 WebView 常要等手势；同时在原生侧关闭了 requiresUserGesture
    const unlockEvents: Array<keyof DocumentEventMap> = [
      'pointerdown',
      'touchstart',
      'mousedown',
      'click',
      'keydown',
    ];
    const onUnlock = () => {
      for (const ev of unlockEvents) {
        document.removeEventListener(ev, onUnlock);
      }
      unlockAudioOnce();
    };
    for (const ev of unlockEvents) {
      document.addEventListener(ev, onUnlock, { once: true, passive: true });
    }

    // 原生：退到后台即视为中断当前调教会话；回前台再尝试解锁/恢复
    if (Capacitor.isNativePlatform()) {
      void CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) unlockAudioOnce();
        else settleDisciplineForLifecycle('应用退到后台');
      });
      // 启动后立刻尝试（配合 MainActivity 关闭手势限制）
      window.setTimeout(() => unlockAudioOnce(), 80);
    }

    const onPageLeave = () => settleDisciplineForLifecycle('退出或重启游戏');
    const onNetworkDisconnect = () => settleDisciplineForLifecycle('网络断开');
    window.addEventListener('pagehide', onPageLeave);
    window.addEventListener('beforeunload', onPageLeave);
    window.addEventListener('offline', onNetworkDisconnect);

    // 私测发行门禁：未激活（激活码+设备绑定）不挂载游戏
    const licensed = await ensureLicensed();
    if (!licensed) return;

    // 标题页重新进入和热更新可能复用内存存档，不会重新走 SaveManager.load。
    // 挂载界面前统一结束遗留的小黑屋会话，并同步刷新皮肤运行时缓存。
    saveManager.mutate((save) => {
      if (save.aiLiving) {
        recoverStaleDisciplineSession(save, save.aiLiving as import('./ai/types').AiLivingSave);
      }
    });

    new App();
    // 离线摘要只写入存档；弹窗改到本次启动后首次进入营地时再出
    void bootAiLivingSync();
  })();
});
