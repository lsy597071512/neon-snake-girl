/**
 * 世界同步资产预加载：换装/切景「意图」出现的第一拍就预热目标资源，
 * 让协议到点（FINISH_CHANGE / MOVE_TO 落地）时的视觉切换零加载黑窗。
 * 只做预热，不改任何运行时逻辑；失败静默（预载失败≠不可用）。
 */
import { getCharacterSkin, getCharacterSkins } from '../data/characterSkins';
import { CAMP_ROOM_MAP } from '../data/campLayout';
import { getSceneCard, resolveSceneCardImage } from './sceneCards';
import { resolvePeriod } from './worldClock';
import type { AiLivingSave } from './types';

/** 测试钩子：记录已预载的 URL（生产无副作用） */
export const __preloadedUrls: string[] = [];
const preloaded = new Set<string>();

function preloadVideo(url: string): void {
  if (!url || preloaded.has(url)) return;
  preloaded.add(url);
  __preloadedUrls.push(url);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.setAttribute('playsinline', '');
    v.src = url;
    // 不 append：仅触发拉取；error 静默（预载失败≠不可用）
    void v.load();
    window.setTimeout(() => {
      try {
        v.removeAttribute('src');
        v.load();
      } catch {
        /* ignore */
      }
    }, 20_000);
  } catch {
    /* ignore */
  }
}

function preloadImage(url: string): void {
  if (!url || preloaded.has(url)) return;
  preloaded.add(url);
  __preloadedUrls.push(url);
  try {
    const img = new Image();
    img.src = url;
  } catch {
    /* ignore */
  }
}

/** 预载某皮肤的立绘动态 + 静帧（换装 START 时调用） */
export function preloadSkinAssets(characterId: string, skinId: string | null): void {
  try {
    if (!skinId || skinId === 'default') return;
    const skin = getCharacterSkin(characterId, skinId);
    if (!skin) return;
    if (skin.portraitLive) preloadVideo(skin.portraitLive);
    for (const sec of skin.portraitLiveSecondaries?.slice(0, 2) ?? []) preloadVideo(sec);
    for (const loop of skin.portraitLiveSecondaryLoops ?? []) {
      if (loop) preloadVideo(loop);
    }
    const still = skin.portraits?.[0];
    if (still) preloadImage(still);
  } catch {
    /* ignore */
  }
}

/** 预载某房间当前时段的场景图（move_to 意图出现时调用） */
export function preloadRoomSceneImage(roomId: string, living: AiLivingSave): void {
  try {
    const room = CAMP_ROOM_MAP[roomId];
    if (!room?.sceneId) return;
    const card = getSceneCard(room.sceneId);
    const url = card ? resolveSceneCardImage(card, resolvePeriod(living)) : null;
    if (url) preloadImage(url);
  } catch {
    /* ignore */
  }
}

/** 角色全部已知皮肤预热（开营地页等低峰时刻可选调用） */
export function preloadAllCharacterSkins(characterId: string): void {
  try {
    for (const skin of getCharacterSkins(characterId)) {
      if (skin.portraitLive) preloadVideo(skin.portraitLive);
    }
  } catch {
    /* ignore */
  }
}
