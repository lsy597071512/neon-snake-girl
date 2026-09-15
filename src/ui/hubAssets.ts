import { UI_ASSETS } from './uiAssets';
import { getAiLiving } from '../ai/livingService';
import {
  resolveActiveCampImage,
  resolvePeriod,
  shouldShowRainOverlay,
} from '../ai/worldClock';
import { getSceneCard, resolveSceneCardImage, isCampNightPeriod } from '../ai/sceneCards';
import { resolveCharacterSceneImageId } from '../ai/livingState';
import { AI_WEATHER_OVERLAY } from '../ai/assets';
import { texUrl } from '../utils/texUrl';

let hubVideo: HTMLVideoElement | null = null;
let hubVideoMounted = false;
/**
 * 主城看板娘背景：按时段/天气切营地外景（beijing01_qingchen 等）。
 * 固定视频仅作生活系统未就绪时的兜底。
 */
let useDynamicCampBg = true;

export interface HubOverlayAssets {
  midLayer: string;
  smoke: string;
}

/** 主页中间氛围层与雾气：傍晚/深夜切夜间版 */
export function resolveHubOverlayAssets(): HubOverlayAssets {
  try {
    if (isCampNightPeriod(resolvePeriod(getAiLiving()))) {
      return {
        midLayer: UI_ASSETS.kanbanMidLayerNight,
        smoke: UI_ASSETS.kanbanSmokeNight,
      };
    }
  } catch {
    /* living 未就绪 */
  }
  return {
    midLayer: UI_ASSETS.kanbanMidLayer,
    smoke: UI_ASSETS.kanbanSmoke,
  };
}

function absTexUrl(src: string): string {
  return new URL(texUrl(src), window.location.href).href;
}

/** 时钟推进时刷新中间层 / 雾气贴图 */
export function refreshHubOverlayLayers(root: ParentNode | null): void {
  if (!root) return;
  const { midLayer, smoke } = resolveHubOverlayAssets();
  const midSrc = absTexUrl(midLayer);
  const smokeSrc = absTexUrl(smoke);
  const mid = root.querySelector<HTMLImageElement>('.hub-mid-bg');
  const smokeImg = root.querySelector<HTMLImageElement>('.hub-smoke-sprite');
  if (mid && mid.src !== midSrc) mid.src = midSrc;
  if (smokeImg && smokeImg.src !== smokeSrc) smokeImg.src = smokeSrc;
}

/** 预加载主页烟雾蒙版（时段静图按需）；视频背景已弃用为常驻路径，不再启动预载 */
export async function preloadHubAssets(onProgress?: (ratio: number) => void): Promise<void> {
  const report = (v: number) => onProgress?.(Math.min(1, Math.max(0, v)));

  report(0.05);
  // 主城默认用时段静图（useDynamicCampBg）；跳过 beijing01.mp4 全量缓冲，减启动带宽与发热
  hubVideo = null;
  await loadImage(texUrl(UI_ASSETS.kanbanSmoke)).catch(() => undefined);
  await loadImage(texUrl(UI_ASSETS.kanbanSmokeNight)).catch(() => undefined);
  report(0.55);
  await loadImage(texUrl(UI_ASSETS.kanbanMidLayer)).catch(() => undefined);
  await loadImage(texUrl(UI_ASSETS.kanbanMidLayerNight)).catch(() => undefined);
  report(0.85);
  await loadImage(texUrl(UI_ASSETS.kanbanBg)).catch(() => undefined);
  report(1);
}

function loadImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function loadHubVideo(onProgress: (ratio: number) => void): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.className = 'hub-bg hub-bg-video';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('preload', 'auto');
    video.setAttribute('aria-hidden', 'true');
    video.poster = texUrl(UI_ASSETS.kanbanBg);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      onProgress(1);
      resolve(video);
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      reject(new Error(`Failed to load hub video: ${UI_ASSETS.kanbanBgVideo}`));
    };

    const updateBuffer = () => {
      if (!video.duration || !Number.isFinite(video.duration)) return;
      if (video.buffered.length === 0) return;
      const end = video.buffered.end(video.buffered.length - 1);
      onProgress(Math.min(0.98, end / video.duration));
    };

    video.addEventListener('progress', updateBuffer);
    video.addEventListener('canplaythrough', finish, { once: true });
    video.addEventListener('loadeddata', updateBuffer);
    video.addEventListener('error', fail, { once: true });

    window.setTimeout(() => {
      if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) finish();
    }, 12000);

    video.src = UI_ASSETS.kanbanBgVideo;
    video.load();
  });
}

function resolveHubDisplaySrc(): { src: string; isIndoor: boolean; rain: boolean } {
  try {
    const living = getAiLiving();
    // 看板主页始终用营地外景时段图（清晨/正午/黄昏/傍晚/深夜/雨），不跟室内位置走
    return {
      src: texUrl(resolveActiveCampImage(living)),
      isIndoor: false,
      rain: shouldShowRainOverlay(living),
    };
  } catch {
    return { src: texUrl(UI_ASSETS.kanbanBg), isIndoor: false, rain: false };
  }
}

/** 营地主页：背景跟随看板娘当前室内位置 */
function resolveCampHubDisplaySrc(characterId: string | null): { src: string; sceneId: string } {
  try {
    const living = getAiLiving();
    const sceneId = characterId
      ? resolveCharacterSceneImageId(characterId, living)
      : living.playerLocationId.startsWith('indoor_')
        ? living.playerLocationId
        : 'indoor_dating';
    const card = getSceneCard(sceneId);
    const period = resolvePeriod(living);
    return {
      src: texUrl(
        card
          ? resolveSceneCardImage(card, period)
          : './tex/Indoor/shinei01_yilou_dating.png',
      ),
      sceneId,
    };
  } catch {
    return { src: texUrl('./tex/Indoor/shinei01_yilou_dating.png'), sceneId: 'indoor_dating' };
  }
}

function fillBgSlot(slot: HTMLElement, src: string, rain: boolean): void {
  hubVideoMounted = false;
  if (hubVideo) hubVideo.pause();
  const rainHtml = rain
    ? `<img class="hub-weather-overlay" src="${texUrl(AI_WEATHER_OVERLAY.rain)}" alt="" aria-hidden="true" onerror="this.remove()" />`
    : '';
  const abs = new URL(src, window.location.href).href;
  const existing = slot.querySelector<HTMLImageElement>('img.hub-bg-camp, img.hub-bg');
  if (existing && !slot.querySelector('video') && existing.src === abs) {
    const rainEl = slot.querySelector('.hub-weather-overlay');
    if (rain && !rainEl) {
      slot.insertAdjacentHTML('beforeend', rainHtml);
    } else if (!rain && rainEl) {
      rainEl.remove();
    }
    return;
  }

  // 新图加载完成后再替换，避免切人/重挂时露出纯色底
  let applied = false;
  const apply = () => {
    if (applied) return;
    applied = true;
    slot.innerHTML = `
    <img class="hub-bg hub-bg-camp" src="${src}" alt="" />
    ${rainHtml}
  `;
  };
  if (existing) {
    const probe = new Image();
    probe.onload = apply;
    probe.onerror = apply;
    probe.src = src;
    return;
  }
  apply();
}

/** 主城看板娘背景：挂载时段外景（或视频兜底） */
export function mountHubBackground(slot: HTMLElement | null): void {
  if (!slot) return;

  if (useDynamicCampBg) {
    const { src, rain } = resolveHubDisplaySrc();
    fillBgSlot(slot, src, rain);
    refreshHubOverlayLayers(slot.closest('.hub-screen'));
    return;
  }

  if (!hubVideo) {
    slot.innerHTML = `<img class="hub-bg" src="${texUrl(UI_ASSETS.kanbanBg)}" alt="" />`;
    return;
  }

  if (hubVideo.parentElement !== slot) {
    slot.replaceChildren(hubVideo);
  }

  hubVideoMounted = true;
  void hubVideo.play().catch(() => {
    // 自动播放失败时仍保留静态 poster / 换静态图
    if (!slot.querySelector('img.hub-bg')) {
      const img = document.createElement('img');
      img.className = 'hub-bg';
      img.src = texUrl(UI_ASSETS.kanbanBg);
      img.alt = '';
      slot.prepend(img);
    }
  });
}

/** 家园营地主页背景：按角色室内位置 */
export function mountCampHubBackground(slot: HTMLElement | null, characterId: string | null): void {
  if (!slot) return;
  const { src } = resolveCampHubDisplaySrc(characterId);
  fillBgSlot(slot, src, false);
}

/** 刷新主页背景（时钟推进时按新时段切换） */
export function refreshHubBackground(slot: HTMLElement | null): void {
  useDynamicCampBg = true;
  mountHubBackground(slot);
  refreshHubOverlayLayers(slot?.closest('.hub-screen') ?? null);
}

export function refreshCampHubBackground(slot: HTMLElement | null, characterId: string | null): void {
  mountCampHubBackground(slot, characterId);
}

/** 离开主页时暂停并卸视频，节省解码开销 */
export function pauseHubBackground(): void {
  if (hubVideo) {
    hubVideo.pause();
    try {
      hubVideo.removeAttribute('src');
      hubVideo.load();
    } catch {
      /* ignore */
    }
  }
  hubVideoMounted = false;
}
