import { texUrl } from '../utils/texUrl';

export const SHOP_CHEST_VIDEO_SRC = './tex/shop.mp4';

export interface ShopChestCutsceneOptions {
  allowSkip: boolean;
  onComplete: () => void;
}

let cleanupActive: (() => void) | null = null;

export function isShopChestCutsceneActive(): boolean {
  return cleanupActive !== null;
}

function finish(onComplete: () => void, overlay: HTMLElement): void {
  overlay.classList.add('is-closing');
  window.setTimeout(() => {
    overlay.remove();
    cleanupActive = null;
    onComplete();
  }, 220);
}

/** 全屏播放军械箱开箱视频；首次不可跳过，之后右上角可跳过 */
export function playShopChestCutscene(options: ShopChestCutsceneOptions): void {
  cleanupActive?.();
  const { allowSkip, onComplete } = options;

  const overlay = document.createElement('div');
  overlay.className = 'shop-chest-cutscene';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '军械箱开启');

  const video = document.createElement('video');
  video.className = 'shop-chest-cutscene-video';
  video.src = texUrl(SHOP_CHEST_VIDEO_SRC);
  video.playsInline = true;
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('preload', 'auto');
  video.muted = false;
  video.defaultMuted = false;

  overlay.appendChild(video);

  if (allowSkip) {
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'shop-chest-cutscene-skip';
    skip.textContent = '跳过';
    skip.setAttribute('aria-label', '跳过开箱动画');
    overlay.appendChild(skip);
    skip.addEventListener('click', () => {
      video.pause();
      finish(onComplete, overlay);
    });
  }

  let done = false;
  const complete = () => {
    if (done) return;
    done = true;
    finish(onComplete, overlay);
  };

  video.addEventListener('ended', complete, { once: true });
  video.addEventListener('error', complete, { once: true });

  document.body.appendChild(overlay);
  cleanupActive = () => {
    if (done) return;
    done = true;
    overlay.remove();
    cleanupActive = null;
  };

  requestAnimationFrame(() => {
    overlay.classList.add('is-visible');
    void video.play().catch(() => {
      video.muted = true;
      void video.play().catch(complete);
    });
  });
}

/** 进入商店页时预加载开箱视频 */
export function preloadShopChestVideo(): void {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'video';
  link.href = texUrl(SHOP_CHEST_VIDEO_SRC);
  link.type = 'video/mp4';
  document.head.appendChild(link);
}
