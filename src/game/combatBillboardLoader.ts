import * as THREE from 'three';
import type { CombatThemeId } from './combatThemes';
import { texUrl } from '../utils/texUrl';

export interface CombatBillboardDef {
  id: string;
  /** 相对高度权重（世界单位目标高度） */
  targetHeight: number;
  /** tall = 背景楼 / mid = 中景 / low = 路肩道具感 */
  tier: 'tall' | 'mid' | 'low';
}

/** 零号月台：3×3 切图后的 9 张透明面片 */
export const STATION_BILLBOARDS: CombatBillboardDef[] = [
  { id: '01-tower', targetHeight: 16, tier: 'tall' },
  { id: '02-crane', targetHeight: 18, tier: 'tall' },
  { id: '03-factory', targetHeight: 14, tier: 'tall' },
  { id: '04-containers', targetHeight: 9, tier: 'mid' },
  { id: '05-boxcar', targetHeight: 7, tier: 'mid' },
  { id: '06-gantry', targetHeight: 12, tier: 'mid' },
  { id: '07-warehouse', targetHeight: 6.5, tier: 'low' },
  { id: '08-tank', targetHeight: 8, tier: 'low' },
  { id: '09-canopy', targetHeight: 6, tier: 'low' },
];

/** 锈带走廊：沙漠公路 / 数字门残骸（与零号月台明显区分） */
export const CORRIDOR_BILLBOARDS: CombatBillboardDef[] = [
  { id: '01-pylon', targetHeight: 18, tier: 'tall' },
  { id: '02-gate', targetHeight: 14, tier: 'tall' },
  { id: '03-crawler', targetHeight: 8, tier: 'mid' },
  { id: '04-solar', targetHeight: 7, tier: 'mid' },
  { id: '05-cyclone', targetHeight: 12, tier: 'mid' },
  { id: '06-beacon', targetHeight: 16, tier: 'tall' },
  { id: '07-bunker', targetHeight: 6, tier: 'low' },
  { id: '08-bladder', targetHeight: 7.5, tier: 'low' },
  { id: '09-checkpoint', targetHeight: 5.5, tier: 'low' },
];

/** 白棺谷：棺形冰壁 / 冰晶 / 冻结机兵残骸（勿复用月台货箱语言） */
export const FROST_BILLBOARDS: CombatBillboardDef[] = [
  { id: '01-monolith', targetHeight: 16, tier: 'tall' },
  { id: '02-iceskeleton', targetHeight: 18, tier: 'tall' },
  { id: '03-icepillar', targetHeight: 14, tier: 'tall' },
  { id: '04-icecrystal', targetHeight: 9, tier: 'mid' },
  { id: '05-cryocoffin', targetHeight: 8, tier: 'mid' },
  { id: '06-iceshield', targetHeight: 10, tier: 'mid' },
  { id: '07-icepipe', targetHeight: 6, tier: 'low' },
  { id: '08-icetruss', targetHeight: 7, tier: 'low' },
  { id: '09-icecairn', targetHeight: 5.5, tier: 'low' },
];

/** 熔炉城废墟：高炉灶口 / 坩埚 / 砖墙炉渣 */
export const FORGE_BILLBOARDS: CombatBillboardDef[] = [
  { id: '01-furnace', targetHeight: 16, tier: 'tall' },
  { id: '02-chimneys', targetHeight: 18, tier: 'tall' },
  { id: '03-hearth', targetHeight: 14, tier: 'tall' },
  { id: '04-crucible', targetHeight: 8, tier: 'mid' },
  { id: '05-moltenpipe', targetHeight: 9, tier: 'mid' },
  { id: '06-catwalk', targetHeight: 12, tier: 'mid' },
  { id: '07-brickwall', targetHeight: 6, tier: 'low' },
  { id: '08-slagtrough', targetHeight: 6, tier: 'low' },
  { id: '09-furnacemouth', targetHeight: 6.5, tier: 'low' },
];

/** 星核禁区：同心环柱 / 天环弧 / 轨道残骸 */
export const CORE_BILLBOARDS: CombatBillboardDef[] = [
  { id: '01-ringpillar', targetHeight: 16, tier: 'tall' },
  { id: '02-skyarc', targetHeight: 14, tier: 'tall' },
  { id: '03-orbithulk', targetHeight: 14, tier: 'tall' },
  { id: '04-coil', targetHeight: 8, tier: 'mid' },
  { id: '05-ringshard', targetHeight: 9, tier: 'mid' },
  { id: '06-cratertier', targetHeight: 10, tier: 'mid' },
  { id: '07-crescent', targetHeight: 6, tier: 'low' },
  { id: '08-corelantern', targetHeight: 7, tier: 'low' },
  { id: '09-orbitpanel', targetHeight: 5.5, tier: 'low' },
];

const BILLBOARD_FOLDER: Partial<Record<CombatThemeId, string>> = {
  station: 'station',
  corridor: 'corridor',
  frost: 'frost',
  forge: 'forge',
  core: 'core',
};

export function billboardUrl(themeId: CombatThemeId, id: string): string {
  const folder = BILLBOARD_FOLDER[themeId] ?? themeId;
  return `./tex/combat/billboards/${folder}/${id}.png`;
}

export function getBillboardsForTheme(themeId: CombatThemeId): CombatBillboardDef[] {
  if (themeId === 'station') return STATION_BILLBOARDS;
  if (themeId === 'corridor') return CORRIDOR_BILLBOARDS;
  if (themeId === 'frost') return FROST_BILLBOARDS;
  if (themeId === 'forge') return FORGE_BILLBOARDS;
  if (themeId === 'core') return CORE_BILLBOARDS;
  return [];
}

export function themeUsesBillboards(themeId: CombatThemeId): boolean {
  return getBillboardsForTheme(themeId).length > 0;
}

export interface CombatBillboardSource {
  def: CombatBillboardDef;
  texture: THREE.Texture;
  aspect: number;
  geometry: THREE.PlaneGeometry;
  material: THREE.MeshBasicMaterial;
}

const texLoader = new THREE.TextureLoader();
const cache = new Map<string, Promise<CombatBillboardSource[]>>();

function loadOne(
  themeId: CombatThemeId,
  def: CombatBillboardDef,
  anisotropy: number,
): Promise<CombatBillboardSource> {
  return new Promise((resolve, reject) => {
    texLoader.load(
      texUrl(billboardUrl(themeId, def.id)),
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = anisotropy;
        texture.premultiplyAlpha = false;

        const img = texture.image as { width?: number; height?: number } | undefined;
        const w = Math.max(1, img?.width ?? 1);
        const h = Math.max(1, img?.height ?? 1);
        const aspect = w / h;
        const geoH = def.targetHeight;
        const geoW = geoH * aspect;
        // 脚底对齐：几何中心抬到 height/2，spawn 时 y = ground
        const geometry = new THREE.PlaneGeometry(geoW, geoH);
        geometry.translate(0, geoH * 0.5, 0);

        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: false, // 改为false,使用alphaTest代替透明混合
          alphaTest: 0.45,    // 从0.35提升到0.45,更激进的裁剪
          depthWrite: true,   // 改为true,写入深度缓冲减少overdraw
          side: THREE.DoubleSide,
          toneMapped: true,
          fog: false,
        });

        resolve({ def, texture, aspect, geometry, material });
      },
      undefined,
      (err) => reject(err ?? new Error(`Failed to load billboard ${themeId}/${def.id}`)),
    );
  });
}

export function warmupCombatBillboards(
  themeId: CombatThemeId,
  anisotropy = 2,
): Promise<CombatBillboardSource[]> {
  const defs = getBillboardsForTheme(themeId);
  if (!defs.length) return Promise.resolve([]);
  const key = `${themeId}:${anisotropy}:${defs.map((d) => d.id).join(',')}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = Promise.all(defs.map((d) => loadOne(themeId, d, anisotropy))).catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
  }
  return pending;
}

export function resetCombatBillboardWarmup(): void {
  cache.clear();
}
