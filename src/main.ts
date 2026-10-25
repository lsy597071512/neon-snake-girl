import './fonts.css';
import './style.css';
import './cc-ui.css';
import './sub-ui.css';
import './gallery.css';
import './title-screen.css';
import './ui/aiLiving.css';
import './ui/storyOverlay.css';
import './ui/recruitPage.css';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { bindViewportMetrics } from './platform/viewport';
import { initNativePlatform } from './platform/nativeInit';
import { App } from './ui/App';
import { saveManager } from './core/SaveManager';
import { recoverStaleDisciplineSession, settleActiveDisciplineSession } from './ai/disciplineSession';
import { recoverStaleBathAssistSession, settleActiveBathAssistSession } from './ai/bathAssistSession';
import { recoverStaleMiniGameSession } from './ai/miniGameSession';
import { leaveDanceSession } from './ai/danceSession';
import { leaveAnfuSession } from './ai/anfuSession';
import { quitMiniGameNow } from './ai/livingService';
import { runHubBoot } from './ui/hubBoot';
import { bindUiSounds, warmUiSound } from './ui/uiSound';
import { unlockBgm } from './audio/bgm';
import { bootAiLivingSync } from './ai/livingService';
import { loadShipManifest } from './utils/shipAssets';
import { initAssetCache } from './platform/assetDownloader';
import { ensureLicensed } from './platform/license';
import { purgeLocalGpuSettings } from './ai/providerConfig';
import { syncCharacterSkinRuntime } from './ui/characterSkinRuntime';

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
    settleActiveBathAssistSession(save, living, reason);
    // 跳舞/安抚与小游戏同规格：任何方式离开（退后台/关页/断网）都强制结算，
    // 角色脱离事件状态并通知 AI，杜绝"人走了她还卡在事件里"
    leaveDanceSession(save, living, { reason, force: true });
    leaveAnfuSession(save, living, { reason: 'close', force: true });
    save.aiLiving = living;
  });
  // 小游戏：任何方式离开（退后台/关页/断网）都强制结算并通知 AI（与其他营地事件一致）
  quitMiniGameNow(reason);
}

document.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    bindViewportMetrics();
    // P1：先加载 ship manifest，再解析立绘/背景路径（无则 noop）
    await loadShipManifest();
    // P3：恢复云端资源本地缓存索引（原生端；已下载完成的远端层资源改走 file://）
    await initAssetCache();
    // P3 版本门：强更弹迭代告示并阻断启动（装完新包重启才放行）；弱更静默后台拉资源
    const { runVersionGate } = await import('./platform/versionGate');
    if ((await runVersionGate()) === 'blocked') return;
    // 市场版不带本机模型方案：清掉旧测试包残留的家里云/Fable 配置，
    // 不再在启动时去拉 home-gpu-config.json（拉不到会弹失败，且会顶掉千问主路径）。
    purgeLocalGpuSettings();
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
    // 挂载界面前统一结束遗留事件会话，并同步刷新皮肤运行时缓存。
    saveManager.mutate((save) => {
      if (save.aiLiving) {
        const living = save.aiLiving as import('./ai/types').AiLivingSave;
        recoverStaleDisciplineSession(save, living);
        recoverStaleBathAssistSession(save, living);
        // 小游戏：杀进程/关应用后遗留的对局，启动即按玩家中途离场结算并通知 AI
        recoverStaleMiniGameSession(save, living);
      }
      // 立绘读取的是运行时皮肤缓存；启动时先用最新存档同步，避免视觉仍是原皮而 Prompt 已是营地穿搭。
      syncCharacterSkinRuntime(save);
    });

    new App();
    // P3：主页「资源下载」浮动进度入口（原生端；有待下资源或下载中时显示）
    const { bootAssetDownloadIndicator } = await import('./ui/assetDownloadUi');
    bootAssetDownloadIndicator();
    // 离线摘要只写入存档；弹窗改到本次启动后首次进入营地时再出
    void bootAiLivingSync();
  })();
});
