import {
  bindLivePortraits,
  unloadLivePortraits,
  getLivePortraitSrc,
  getLivePortraitSecondarySrc,
  renderLivePortrait,
  resolvePortraitSkinChannel,
  type PortraitResolveOpts,
} from './livePortrait';

export {
  bindLivePortraits,
  unloadLivePortraits,
  getLivePortraitSrc,
  getLivePortraitSecondarySrc,
  renderLivePortrait,
  resolvePortraitSkinChannel,
};
export type { PortraitResolveOpts };

import { CHARACTER_MAP } from '../data/characters';
import { getCharacterSkin } from '../data/characterSkins';
import { getPortraitSeriesIndex } from './characterPortraitRuntime';
import { getRuntimeActiveSkinId } from './characterSkinRuntime';
import { texUrl } from '../utils/texUrl';

const UI = './ui';
const TEX = './tex';
const WL = `${TEX}/wasteland-ui`;

export type PortraitSide = 'front' | 'back';

/** 废土主页 UI · 从 Asset-xho8xde31z.png 切出 */
export const WASTELAND_UI = {
  avatarFrame: `${WL}/avatarFrame.png`,
  xpBar: `${WL}/xpBar.png`,
  resGold: `${WL}/resGold.png`,
  resGem: `${WL}/resGem.png`,
  resEnergy: `${WL}/resEnergy.png`,
  btnMail: `${WL}/btnMail.png`,
  btnSocial: `${WL}/btnSocial.png`,
  btnSettings: `${WL}/btnSettings.png`,
  sideShop: `${WL}/sideShop.png`,
  sideEvents: `${WL}/sideEvents.png`,
  sideTasks: `${WL}/sideTasks.png`,
  sideWarehouse: `${WL}/sideWarehouse.png`,
  sideSquad: `${WL}/sideSquad.png`,
  bannerExpedition: `${WL}/bannerExpedition.png`,
  btnExplore: `${WL}/btnExplore.png`,
  btnStartBattle: `${WL}/btnStartBattle.png`,
  bottomNav: `${WL}/bottomNav.png`,
} as const;

export const UI_ASSETS = {
  kanbanBg: `${TEX}/beijing01.png`,
  kanbanBgVideo: `${TEX}/beijing01.mp4`,
  /** 主页中间层：盖住立绘，位于 UI 之下 */
  kanbanMidLayer: `${TEX}/beijing01_1.png`,
  /** 傍晚/深夜中间氛围层 */
  kanbanMidLayerNight: `${TEX}/beijing01_1_night.png`,
  /** 主页烟雾蒙版（土黄动效） */
  kanbanSmoke: `${TEX}/beijing01_smoke.png`,
  /** 傍晚/深夜雾气蒙版 */
  kanbanSmokeNight: `${TEX}/beijing01_smoke_night.png`,
  stageHex: `${UI}/stage-hex.svg`,
  gachaBanner: `${UI}/gacha-banner.svg`,
  nav: {
    map: `${UI}/nav-map.svg`,
    home: `${UI}/nav-home.svg`,
    shop: `${UI}/nav-shop.svg`,
    squad: `${UI}/nav-squad.svg`,
  },
  res: {
    gold: `${UI}/res-gold.svg`,
    ticket: `${UI}/res-ticket.svg`,
  },
  frame: {
    SR: `${UI}/frame-sr.svg`,
    SSR: `${UI}/frame-ssr.svg`,
    UR: `${UI}/frame-ur.svg`,
  },
};

export function rarityFrame(rarity: string): string {
  return UI_ASSETS.frame[rarity as keyof typeof UI_ASSETS.frame] ?? UI_ASSETS.frame.SR;
}

export function featuredCharacterId(squad: string[], preferred?: string | null): string {
  if (preferred && squad.includes(preferred)) return preferred;
  return squad[0] ?? 'ashcrow';
}

/** 主页看板娘：仅来自上场编队；无上场角色时返回 null */
export function resolveHubFeaturedCharId(squad: string[], preferred?: string | null): string | null {
  if (!squad.length) return null;
  if (preferred && squad.includes(preferred)) return preferred;
  return squad[0] ?? null;
}

export type CharPortraitOpts = PortraitResolveOpts;

/** 同系列静态立绘列表（泳池派对多套 / 默认正背面不同时） */
export function getCharPortraitSeries(charId: string, opts?: CharPortraitOpts): string[] {
  const channel = resolvePortraitSkinChannel(opts);
  const skinId = getRuntimeActiveSkinId(charId, channel);
  if (skinId) {
    const skin = getCharacterSkin(charId, skinId);
    if (skin?.portraits.length) {
      return [...new Set(skin.portraits.filter(Boolean))];
    }
  }
  const c = CHARACTER_MAP[charId];
  if (!c) return [];
  const list = [c.portraitFront, c.portraitBack].filter((x): x is string => !!x);
  return [...new Set(list)];
}

export function hasPortraitSeriesSwitch(charId: string, opts?: CharPortraitOpts): boolean {
  return getCharPortraitSeries(charId, opts).length > 1;
}

export function getCharPortraitSrcByIndex(
  charId: string,
  index: number,
  opts?: CharPortraitOpts,
): string | null {
  const series = getCharPortraitSeries(charId, opts);
  if (!series.length) return null;
  const i = ((index % series.length) + series.length) % series.length;
  return series[i] ?? null;
}

export function getCharPortraitSrc(
  charId: string,
  side: PortraitSide,
  opts?: CharPortraitOpts,
): string | null {
  const series = getCharPortraitSeries(charId, opts);
  if (series.length > 1) {
    const idx = getPortraitSeriesIndex(charId) % series.length;
    return series[idx] ?? series[0] ?? null;
  }
  if (series.length === 1) return series[0] ?? null;
  const c = CHARACTER_MAP[charId];
  if (!c) return null;
  return side === 'front' ? (c.portraitFront ?? null) : (c.portraitBack ?? null);
}

/** 头像始终使用角色专用头像图集，不随主立绘皮肤切换。 */
export function getCharAvatarSrc(charId: string, opts?: CharPortraitOpts): string | null {
  if (!CHARACTER_MAP[charId]?.portraitFront) return null;
  return `./tex/juese/avatars/${charId}.png`;
}

/** 战斗关卡固定使用背面默认原皮立绘 */
export function getCombatPortraitSrc(charId: string): string | null {
  return getCharPortraitSrc(charId, 'back', { skinChannel: 'none' });
}

/** 立绘文件名 stem，如 SR01_2 */
export function getCharacterArtStem(charId: string): string | null {
  const c = CHARACTER_MAP[charId];
  const src = c?.combatLive ?? c?.portraitFront ?? c?.portraitBack;
  const m = src?.match(/\/([A-Za-z0-9_]+)\.(?:png|webm|glb)$/i);
  const file = m?.[1];
  if (!file) return null;
  return file.replace(/_pifu00_shoot_idle$/i, '');
}

/** 战斗待机射击 WebM（默认装甲背影） */
export function getCombatShootIdleSrc(charId: string): string | null {
  const c = CHARACTER_MAP[charId];
  if (c?.combatLive) return c.combatLive;
  const stem = getCharacterArtStem(charId);
  if (!stem) return null;
  return `./tex/juese/combat-back/${stem}_pifu00_shoot_idle.webm`;
}

/** 战斗 GLB：默认原皮模型（特别外覆不带出征）。有待机射击 WebM 时战斗场景优先用 WebM。 */
export function getCombatModelSrc(charId: string): string | null {
  return CHARACTER_MAP[charId]?.combatModel ?? null;
}

export function hasPortraitFlip(charId: string, opts?: CharPortraitOpts): boolean {
  return hasPortraitSeriesSwitch(charId, opts);
}

export function renderCharPortrait(
  charId: string,
  side: PortraitSide,
  imgClass: string,
  emojiClass: string,
  extraClass = '',
  opts?: CharPortraitOpts,
): string {
  const cls = extraClass ? `${imgClass} ${extraClass}` : imgClass;
  const src = getCharPortraitSrc(charId, side, opts);
  if (src) return `<img class="${cls}" src="${texUrl(src)}" alt="" />`;
  const c = CHARACTER_MAP[charId];
  return `<span class="${emojiClass}">${c?.icon ?? '?'}</span>`;
}

export function featuredCharDisplay(
  squad: string[],
  preferred?: string | null,
): {
  id: string;
  icon: string;
  name: string;
  rarity: string;
  tag: string;
  tagShort: string;
} {
  const id = featuredCharacterId(squad, preferred);
  const c = CHARACTER_MAP[id];
  const tagShort = c.tag.split('/')[0]?.trim() ?? c.tag;
  return { id, icon: c.icon, name: c.name, rarity: c.rarity, tag: c.tag, tagShort };
}

export function hubFeaturedCharDisplay(
  squad: string[],
  preferred?: string | null,
): {
  id: string;
  icon: string;
  name: string;
  rarity: string;
  tag: string;
  tagShort: string;
} | null {
  const id = resolveHubFeaturedCharId(squad, preferred);
  if (!id) return null;
  return featuredCharDisplay(squad, id);
}
