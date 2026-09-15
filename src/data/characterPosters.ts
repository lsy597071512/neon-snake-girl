/** 机械少女角色海报（竖屏 / 横屏），资源在 tex/storyboards/char-posters/ */

export type CharacterPosters = {
  portrait: string;
  landscape: string;
};

const BASE = './tex/storyboards/char-posters';

/**
 * 全员海报映射。竖屏用于档案详情背景；横/竖均可在海报查看器切换。
 */
export const CHARACTER_POSTERS: Record<string, CharacterPosters> = {
  ashcrow: {
    portrait: `${BASE}/ashcrow-portrait.png`,
    landscape: `${BASE}/ashcrow-landscape.png`,
  },
  heartforge: {
    portrait: `${BASE}/heartforge-portrait.png`,
    landscape: `${BASE}/heartforge-landscape.png`,
  },
  mirror: {
    portrait: `${BASE}/mirror-portrait.png`,
    landscape: `${BASE}/mirror-landscape.png`,
  },
  neoncoil: {
    portrait: `${BASE}/neoncoil-portrait.png`,
    landscape: `${BASE}/neoncoil-landscape.png`,
  },
  prismrift: {
    portrait: `${BASE}/prismrift-portrait.png`,
    landscape: `${BASE}/prismrift-landscape.png`,
  },
  wireguard: {
    portrait: `${BASE}/wireguard-portrait.png`,
    landscape: `${BASE}/wireguard-landscape.png`,
  },
  frostline: {
    portrait: `${BASE}/frostline-portrait.png`,
    landscape: `${BASE}/frostline-landscape.png`,
  },
  pulse: {
    portrait: `${BASE}/pulse-portrait.png`,
    landscape: `${BASE}/pulse-landscape.png`,
  },
  dustblade: {
    portrait: `${BASE}/dustblade-portrait.png`,
    landscape: `${BASE}/dustblade-landscape.png`,
  },
  ironrain: {
    portrait: `${BASE}/ironrain-portrait.png`,
    landscape: `${BASE}/ironrain-landscape.png`,
  },
  skyshard: {
    portrait: `${BASE}/skyshard-portrait.png`,
    landscape: `${BASE}/skyshard-landscape.png`,
  },
  stellar: {
    portrait: `${BASE}/stellar-portrait.png`,
    landscape: `${BASE}/stellar-landscape.png`,
  },
  outercore: {
    portrait: `${BASE}/outercore-portrait.png`,
    landscape: `${BASE}/outercore-landscape.png`,
  },
};

export function getCharacterPosters(characterId: string): CharacterPosters | null {
  return CHARACTER_POSTERS[characterId] ?? null;
}
