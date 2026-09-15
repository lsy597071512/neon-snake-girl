import { CHARACTER_MAP } from '../data/characters';
import { getCharacterSkin, SHOWER_SKIN_ID, SLEEPWEAR_SKIN_ID } from '../data/characterSkins';
import { getBathIntimateConsent, getBathIntimateIntroDone } from '../ai/bathIntimateConsent';
import { getAiLiving } from '../ai/livingService';
import { resolvePresence } from '../ai/livingState';
import { isDeepSleeping } from '../ai/sleepSystem';
import { getPortraitSeriesIndex } from './characterPortraitRuntime';
import {
  getRuntimeActiveSkinId,
  type SkinChannel,
} from './characterSkinRuntime';
import { texUrl } from '../utils/texUrl';

export type PortraitSide = 'front' | 'back';

export type PortraitResolveOpts = {
  /**
   * 皮肤通道：player=主页玩家装备；camp=营地 AI 穿搭；none=强制原皮。
   * 默认 player（主城 UI）。
   */
  skinChannel?: SkinChannel;
  /** @deprecated 使用 skinChannel: 'none' */
  ignoreRuntimeSkin?: boolean;
};

export function resolvePortraitSkinChannel(opts?: PortraitResolveOpts): SkinChannel {
  if (opts?.ignoreRuntimeSkin) return 'none';
  return opts?.skinChannel ?? 'player';
}

export type ShowerCampPortraitPhase = 'idle' | 'intro' | 'loop';

export type ShowerCampPortraitPlan = {
  phase: ShowerCampPortraitPhase;
  src: string;
  loop: boolean;
};

/** 营地对话：蒸汽毛巾三态播放（待机 / 脱巾前奏 full / 无巾循环） */
export function resolveCampShowerPortraitPlayback(
  charId: string,
  living = getAiLiving(),
): ShowerCampPortraitPlan | null {
  const skinId = getRuntimeActiveSkinId(charId, 'camp');
  if (skinId !== SHOWER_SKIN_ID) return null;
  const skin = getCharacterSkin(charId, skinId);
  if (!skin) return null;

  if (!getBathIntimateConsent(living, charId)) {
    const idle = skin.portraitLive;
    return idle ? { phase: 'idle', src: idle, loop: true } : null;
  }

  const loopSrc = skin.portraitLiveIntimate || skin.portraitLive;
  if (!loopSrc) return null;

  const introSrc = skin.portraitLiveIntimateIntro;
  if (introSrc && !getBathIntimateIntroDone(living, charId)) {
    return { phase: 'intro', src: introSrc, loop: false };
  }
  return { phase: 'loop', src: loopSrc, loop: true };
}

/** 动态立绘：透明 WebM / MP4 */
export function getLivePortraitSrc(charId: string, opts?: PortraitResolveOpts): string | null {
  const channel = resolvePortraitSkinChannel(opts);
  const skinId = getRuntimeActiveSkinId(charId, channel);
  if (skinId) {
    const skin = getCharacterSkin(charId, skinId);
    if (!skin) return CHARACTER_MAP[charId]?.portraitLive ?? null;

    // 蒸汽毛巾：仅营地；常态播 idle 待机；成人同意后才切 intimate webm
    if (skinId === SHOWER_SKIN_ID) {
      if (channel !== 'camp') return null;
      try {
        if (getBathIntimateConsent(getAiLiving(), charId)) {
          const plan = resolveCampShowerPortraitPlayback(charId);
          return plan?.src ?? (skin.portraitLiveIntimate || skin.portraitLive || null);
        }
      } catch {
        /* 未同意 / 存档未就绪 → 走待机 */
      }
      return skin.portraitLive || null;
    }

    // 星夜睡衣：完全入睡时播睡眠循环；准备入睡/醒着穿睡衣播站立 idle
    if (skinId === SLEEPWEAR_SKIN_ID && channel === 'camp' && skin.portraitLiveSleep) {
      try {
        const living = getAiLiving();
        // 只有睡眠系统确认已入睡时才切睡眠循环；作息表的残留 activity
        // 不能把清醒穿睡衣误判成睡着。
        if (isDeepSleeping(living, charId)) {
          return skin.portraitLiveSleep;
        }
      } catch {
        /* 存档未就绪 → 走 idle */
      }
    }

    // 穿特别皮肤时：有动态用动态；无动态则强制静态，勿回落到默认装甲动态
    return skin.portraitLive || null;
  }
  return CHARACTER_MAP[charId]?.portraitLive ?? null;
}

/** 主页全部可点击互动动态立绘（按序；无皮肤时最多一条默认二级） */
export function getLivePortraitSecondarySrcs(charId: string, opts?: PortraitResolveOpts): string[] {
  const channel = resolvePortraitSkinChannel(opts);
  const skinId = getRuntimeActiveSkinId(charId, channel);
  if (skinId) {
    const skin = getCharacterSkin(charId, skinId);
    if (skin) {
      if (skin.portraitLiveSecondaries.length > 0) {
        return [...skin.portraitLiveSecondaries];
      }
      // 穿着有动态的皮肤但无专属互动：不再回落默认装甲互动（避免泳装/睡衣播装甲动作）
      if (skin.portraitLive) return [];
    }
  }
  const one = CHARACTER_MAP[charId]?.portraitLiveSecondary;
  return one ? [one] : [];
}

/** 主页二级动态立绘（兼容旧调用：取列表第一条） */
export function getLivePortraitSecondarySrc(charId: string): string | null {
  return getLivePortraitSecondarySrcs(charId)[0] ?? null;
}

export function getLivePortraitMimeType(src: string): string {
  return src.endsWith('.mp4') ? 'video/mp4' : 'video/webm';
}

/**
 * 静音立绘视频：关掉原生 controls，隐藏系统播放钮。
 * 勿在透明 WebM 下长期垫静帧图（会叠影）；勿用整视频 opacity:0（会露纯色底）。
 * 切角色靠「就地换 DOM + video poster + 保留背景槽」防闪。
 *
 * 播放钮根治：首帧真正播出（playing）前给视频加 is-awaiting-play 整体隐藏
 * （新版 Android WebView 的暂停封面播放钮已无法用伪元素去除），playing 后自动显现；
 * loadstart/emptied 时重新隐藏（原地换 src 的场景同样生效）。
 */
export function armSilentPortraitVideo(video: HTMLVideoElement): void {
  video.controls = false;
  video.removeAttribute('controls');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback');
  video.setAttribute('x-webkit-airplay', 'deny');
  try {
    video.disablePictureInPicture = true;
  } catch {
    /* ignore */
  }
  try {
    video.disableRemotePlayback = true;
  } catch {
    /* ignore */
  }
  video.setAttribute('disablepictureinpicture', '');
  video.classList.remove('is-pending-frame');

  if (video.dataset.silentPortraitArmed !== '1') {
    video.dataset.silentPortraitArmed = '1';
    const reinforce = () => {
      video.controls = false;
      video.removeAttribute('controls');
    };
    const awaitPlay = () => {
      if (!video.dataset.liveFallback) video.classList.add('is-awaiting-play');
    };
    const onPlaying = () => {
      video.classList.remove('is-awaiting-play');
      video.removeAttribute('poster');
      video.poster = '';
    };
    video.addEventListener('loadstart', reinforce);
    video.addEventListener('loadedmetadata', reinforce);
    video.addEventListener('emptied', reinforce);
    video.addEventListener('emptied', awaitPlay);
    video.addEventListener('loadstart', awaitPlay);
    video.addEventListener('playing', onPlaying);
  }
}

/** 换源前垫静帧 poster，避免加载期露出系统播放钮 */
export function applyLivePortraitPoster(
  video: HTMLVideoElement,
  charId: string,
  opts?: PortraitResolveOpts,
): void {
  const poster = getLivePortraitPosterUrl(charId, opts);
  if (poster) {
    video.poster = poster;
    video.setAttribute('poster', poster);
  } else {
    video.removeAttribute('poster');
    video.poster = '';
  }
}

/** 动态立绘加载前的静帧 poster（避免黑屏） */
export function getLivePortraitPosterUrl(
  charId: string,
  opts?: PortraitResolveOpts,
): string | null {
  const png = resolveStaticPortrait(charId, 'front', opts);
  return png ? texUrl(png) : null;
}

/** 微信 / 飞书 / UC 等内置 WebView：WebM 与 WebP 动画均易出现黑底，改用静态立绘 */
export function isRestrictedInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /MicroMessenger|UCBrowser|UCWEB|QQBrowser|MQQBrowser|Qzone|Weibo|Lark|Feishu|TBS\/\d/i.test(ua);
}

export function canPlayWebmLivePortrait(): boolean {
  return canPlayLivePortrait('./placeholder.webm');
}

/** 按资源格式检测浏览器是否可播动态立绘（MP4 含 iOS） */
export function canPlayLivePortrait(src: string | null): boolean {
  if (!src) return false;
  if (isRestrictedInAppBrowser()) return false;
  if (typeof document === 'undefined') return true;

  const probe = document.createElement('video');
  if (src.endsWith('.mp4')) {
    return probe.canPlayType('video/mp4') !== '';
  }

  if (typeof navigator === 'undefined') return true;
  const ua = navigator.userAgent;
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) return false;

  return (
    probe.canPlayType('video/webm; codecs="vp9"') !== '' ||
    probe.canPlayType('video/webm; codecs="vp8"') !== '' ||
    probe.canPlayType('video/webm') !== ''
  );
}

function resolveStaticPortrait(
  charId: string,
  side: PortraitSide,
  opts?: PortraitResolveOpts,
): string | null {
  const channel = resolvePortraitSkinChannel(opts);
  const skinId = getRuntimeActiveSkinId(charId, channel);
  if (skinId) {
    const skin = getCharacterSkin(charId, skinId);
    if (skin?.portraits.length) {
      if (skin.portraits.length > 1) {
        const idx = getPortraitSeriesIndex(charId) % skin.portraits.length;
        return skin.portraits[idx] ?? skin.portraits[0] ?? null;
      }
      return skin.portraits[0] ?? null;
    }
  }
  const c = CHARACTER_MAP[charId];
  return side === 'front' ? (c?.portraitFront ?? null) : (c?.portraitBack ?? null);
}

function staticPortraitImg(charId: string, imgClass: string, opts?: PortraitResolveOpts): string {
  const c = CHARACTER_MAP[charId];
  const png = resolveStaticPortrait(charId, 'front', opts);
  if (png) return `<img class="${imgClass}" src="${texUrl(png)}" alt="" />`;
  return `<span class="${imgClass}-emoji">${c?.icon ?? '?'}</span>`;
}

export function renderLivePortrait(
  charId: string,
  imgClass: string,
  opts?: PortraitResolveOpts,
): string {
  const liveSrc = getLivePortraitSrc(charId, opts);
  if (!liveSrc) return staticPortraitImg(charId, imgClass, opts);

  if (canPlayLivePortrait(liveSrc)) {
    const videoSrc = texUrl(liveSrc);
    const mime = getLivePortraitMimeType(liveSrc);
    const poster = getLivePortraitPosterUrl(charId, opts);
    const posterAttr = poster ? ` poster="${poster}"` : '';
    return `<video class="${imgClass} char-live-portrait is-awaiting-play" data-char-id="${charId}" autoplay muted loop playsinline webkit-playsinline disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback" preload="auto"${posterAttr} aria-label="动态立绘"><source src="${videoSrc}" type="${mime}" /></video>`;
  }

  return staticPortraitImg(charId, imgClass, opts);
}

function bindLivePortraitVideo(video: HTMLVideoElement, portraitSide: PortraitSide): void {
  if (video.dataset.liveBound === '1') return;
  video.dataset.liveBound = '1';
  armSilentPortraitVideo(video);

  const charId = video.dataset.charId!;
  const channel = (video.dataset.skinChannel as SkinChannel | undefined) ?? 'player';

  const fallbackToStatic = () => {
    if (video.dataset.liveFallback === '1') return;
    video.dataset.liveFallback = '1';
    const png = resolveStaticPortrait(charId, portraitSide, { skinChannel: channel });
    if (!png) return;
    const img = document.createElement('img');
    img.className = video.className
      .replace(/\s*char-live-portrait\s*/g, ' ')
      .replace(/\s*is-awaiting-play\s*/g, ' ')
      .trim();
    img.src = texUrl(png);
    img.alt = '';
    video.replaceWith(img);
  };

  const tryPlay = () => {
    void video.play().catch(fallbackToStatic);
  };

  video.addEventListener('error', fallbackToStatic, { once: true });
  video.addEventListener('canplay', tryPlay, { once: true });
  video.addEventListener('loadeddata', tryPlay);
  video.addEventListener('playing', () => {
    video.removeAttribute('poster');
    video.poster = '';
  });
  tryPlay();
}

/** 绑定动态立绘 WebM：播放失败回退静态 PNG */
export function bindLivePortraits(root: ParentNode, portraitSide: PortraitSide = 'front'): void {
  root.querySelectorAll('video.char-live-portrait[data-char-id]').forEach((node) => {
    bindLivePortraitVideo(node as HTMLVideoElement, portraitSide);
  });
}

/** 卸载页面内动态立绘：暂停并清 src，降低离屏解码发热 */
export function unloadLivePortraits(root: ParentNode): void {
  root.querySelectorAll('video.char-live-portrait, video[data-ai-live-portrait], video.hub-portrait-primary, video.hub-portrait-secondary').forEach((node) => {
    const video = node as HTMLVideoElement;
    try {
      video.pause();
      video.removeAttribute('src');
      video.querySelectorAll('source').forEach((s) => s.remove());
      video.load();
    } catch {
      /* ignore */
    }
  });
}
