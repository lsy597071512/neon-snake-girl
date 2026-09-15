import * as THREE from 'three';
import { texUrl } from '../utils/texUrl';

/** 待机射击成片分辨率 768×1344 */
export const COMBAT_LIVE_ASPECT = 768 / 1344;

export function createCombatLiveSprite(url: string, height: number): THREE.Sprite {
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = texUrl(url);
  void video.play().catch(() => {});

  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    alphaTest: 0.04,
    toneMapped: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(0.5, 0);
  sprite.scale.set(height * COMBAT_LIVE_ASPECT, height, 1);
  sprite.userData.combatLiveVideo = video;
  sprite.userData.combatLiveAspect = COMBAT_LIVE_ASPECT;
  return sprite;
}

export function waitCombatLiveReady(sprite: THREE.Sprite, timeoutMs = 8000): Promise<boolean> {
  const video = sprite.userData.combatLiveVideo as HTMLVideoElement | undefined;
  if (!video) return Promise.resolve(false);
  if (video.readyState >= 2) {
    void video.play().catch(() => {});
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    video.addEventListener(
      'loadeddata',
      () => {
        void video.play().catch(() => {});
        finish(true);
      },
      { once: true },
    );
    video.addEventListener('error', () => finish(false), { once: true });
  });
}

/** 结算时停循环，定格最后一帧；受击不要调用。 */
export function pauseCombatLiveSprite(root: THREE.Object3D | null | undefined): void {
  if (!root) return;
  root.traverse((obj) => {
    const video = obj.userData.combatLiveVideo as HTMLVideoElement | undefined;
    if (!video) return;
    video.loop = false;
    video.pause();
  });
}

export function pauseCombatLiveSprites(roots: Array<THREE.Object3D | null | undefined>): void {
  for (const root of roots) pauseCombatLiveSprite(root);
}

export function disposeCombatLiveSprite(sprite: THREE.Sprite): boolean {
  const video = sprite.userData.combatLiveVideo as HTMLVideoElement | undefined;
  if (!video) return false;
  video.pause();
  video.removeAttribute('src');
  video.load();
  sprite.userData.combatLiveVideo = undefined;
  const mat = sprite.material as THREE.SpriteMaterial;
  mat.map?.dispose();
  mat.dispose();
  return true;
}

/**
 * @param height 布局目标身高
 * @param headScaleMul 人头占屏归一化系数（见 combatLiveHeadScale）
 */
export function liveSpriteScale(
  height: number,
  sprite?: THREE.Object3D | null,
  headScaleMul = 1,
): { w: number; h: number } {
  const aspect =
    (sprite?.userData.combatLiveAspect as number | undefined) ?? COMBAT_LIVE_ASPECT;
  const h = height * headScaleMul;
  return { w: h * aspect, h };
}
