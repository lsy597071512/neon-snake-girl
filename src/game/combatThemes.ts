import { CHAPTERS } from '../data/chapters';

export type CombatThemeId = 'station' | 'corridor' | 'frost' | 'forge' | 'core';

export interface CombatTheme {
  id: CombatThemeId;
  background: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  rimColor: number;
  rimIntensity: number;
  neonLane: string;
  neonCenter: string;
  vistaTint: number;
  skyTop: string;
  skyBottom: string;
  dustColor: string;
  dustHex: string;
}

/**
 * 环境光 / 场景底色按各章竖屏远景图采样主色对齐
 *（sky≈图上半、ground≈图下半、background≈整图均值）。
 */
const THEMES: Record<CombatThemeId, CombatTheme> = {
  station: {
    id: 'station',
    background: 0x9f9d97,
    fogNear: 65,
    fogFar: 220,
    hemiSky: 0xb0bcc4,
    hemiGround: 0x8a8377,
    hemiIntensity: 0.88,
    sunColor: 0xece6dc,
    sunIntensity: 1.35,
    rimColor: 0xa8b8c8,
    rimIntensity: 0.28,
    neonLane: 'rgba(0, 229, 255, 0.45)',
    neonCenter: 'rgba(255, 255, 255, 0.85)',
    vistaTint: 0xffffff,
    skyTop: '#89a0b2',
    skyBottom: '#9f9d97',
    dustColor: 'rgba(180, 190, 200, 0.32)',
    dustHex: '#b0bcc4',
  },
  corridor: {
    id: 'corridor',
    background: 0xae7940,
    fogNear: 58,
    fogFar: 210,
    hemiSky: 0xb88850,
    hemiGround: 0xa06a38,
    hemiIntensity: 0.86,
    sunColor: 0xffd090,
    sunIntensity: 1.4,
    rimColor: 0xe09850,
    rimIntensity: 0.26,
    neonLane: 'rgba(255, 176, 32, 0.45)',
    neonCenter: 'rgba(255, 240, 200, 0.82)',
    vistaTint: 0xffe0b8,
    skyTop: '#b5834b',
    skyBottom: '#a77238',
    dustColor: 'rgba(210, 150, 90, 0.38)',
    dustHex: '#c48848',
  },
  frost: {
    id: 'frost',
    background: 0x98b4cc,
    fogNear: 55,
    fogFar: 200,
    hemiSky: 0x93b6d6,
    hemiGround: 0x9db1c4,
    hemiIntensity: 0.9,
    sunColor: 0xd8ecff,
    sunIntensity: 1.3,
    rimColor: 0x88c8e8,
    rimIntensity: 0.34,
    neonLane: 'rgba(136, 220, 255, 0.5)',
    neonCenter: 'rgba(230, 248, 255, 0.88)',
    vistaTint: 0xe0f0ff,
    skyTop: '#719fc4',
    skyBottom: '#9db1c4',
    dustColor: 'rgba(190, 220, 240, 0.32)',
    dustHex: '#a8c8e0',
  },
  forge: {
    id: 'forge',
    background: 0x3f2015,
    fogNear: 50,
    fogFar: 190,
    hemiSky: 0x49261a,
    hemiGround: 0x371a10,
    hemiIntensity: 0.78,
    sunColor: 0xff8840,
    sunIntensity: 1.5,
    rimColor: 0xff5530,
    rimIntensity: 0.32,
    neonLane: 'rgba(255, 100, 40, 0.5)',
    neonCenter: 'rgba(255, 200, 140, 0.82)',
    vistaTint: 0xffc8a0,
    skyTop: '#49261a',
    skyBottom: '#371a10',
    dustColor: 'rgba(255, 120, 60, 0.3)',
    dustHex: '#ff7840',
  },
  core: {
    id: 'core',
    // 当前远景为灰褐日景，不再用旧夜色紫调
    background: 0x898078,
    fogNear: 48,
    fogFar: 185,
    hemiSky: 0xbbb8b4,
    hemiGround: 0x605043,
    hemiIntensity: 0.86,
    sunColor: 0xe8e0d4,
    sunIntensity: 1.35,
    rimColor: 0xc8b8a8,
    rimIntensity: 0.3,
    neonLane: 'rgba(200, 160, 120, 0.4)',
    neonCenter: 'rgba(255, 236, 220, 0.85)',
    vistaTint: 0xffffff,
    skyTop: '#bbbab9',
    skyBottom: '#605043',
    dustColor: 'rgba(180, 170, 155, 0.3)',
    dustHex: '#b0a898',
  },
};

export function getCombatTheme(chapter: number): CombatTheme {
  const def = CHAPTERS.find((c) => c.id === chapter);
  const themeId = (def?.theme ?? 'station') as CombatThemeId;
  return THEMES[themeId] ?? THEMES.station;
}
