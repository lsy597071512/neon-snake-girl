import * as THREE from 'three';
import type { CombatQualityProfile } from './combatQuality';
import { texUrl } from '../utils/texUrl';
import {
  loadScatterInstancedSource,
  loadScatterModelBatch,
  type CombatScatterInstancedSource,
} from './combatScatterLoader';

export { logCombatGeometryStats, mergeFbxMeshesToGeometry } from './combatFbxMerge';

export const COMBAT_BUILD_MODELS = [
  './tex/build/build01.fbx',
  './tex/build/build02.fbx',
] as const;

/** @deprecated 使用 COMBAT_BUILD_MODELS */
export const COMBAT_BUILD_MODEL = COMBAT_BUILD_MODELS[0];
export const COMBAT_BUILD_TEXTURE = './tex/build/build01_d.png';

/** 归一化后建筑目标高度（世界单位） */
export const COMBAT_BUILD_TARGET_HEIGHT = 4.5;

/** 建筑整体放大倍数（实例化前烘焙进 Geometry） */
export const COMBAT_BUILD_SCALE_MULTIPLIER = 12;

export const BUILD_CACHE_VERSION = 12;

const texLoader = new THREE.TextureLoader();

let sharedBuildMaterial: THREE.MeshStandardMaterial | null = null;
let warmupPromise: Promise<CombatScatterInstancedSource[]> | null = null;
let warmupKey = '';

/** @deprecated 使用 CombatScatterInstancedSource */
export type CombatBuildInstancedSource = CombatScatterInstancedSource;

function applyTextureQuality(tex: THREE.Texture, profile: CombatQualityProfile): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = profile.quality === 'high' ? 4 : profile.quality === 'medium' ? 2 : 1;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
}

/** 两侧建筑 / 道具共用 PBR 贴图（build01_d） */
export function getBuildSideMaterial(profile: CombatQualityProfile): THREE.MeshStandardMaterial {
  if (sharedBuildMaterial) return sharedBuildMaterial;

  const map = texLoader.load(texUrl(COMBAT_BUILD_TEXTURE));
  applyTextureQuality(map, profile);

  sharedBuildMaterial = new THREE.MeshStandardMaterial({
    name: 'buildSideMAT',
    map,
    color: new THREE.Color(0xffffff),
    metalness: 0.05,
    roughness: 0.88,
    envMapIntensity: 0.35,
    side: THREE.FrontSide,
  });

  return sharedBuildMaterial;
}

/** @deprecated 使用 getBuildSideMaterial */
export function getBuild01Material(profile: CombatQualityProfile): THREE.MeshStandardMaterial {
  return getBuildSideMaterial(profile);
}

export function warmupCombatBuildModels(
  profile: CombatQualityProfile,
): Promise<CombatScatterInstancedSource[]> {
  const key = `${BUILD_CACHE_VERSION}:${profile.quality}`;
  if (!warmupPromise || warmupKey !== key) {
    warmupKey = key;
    const material = getBuildSideMaterial(profile);
    warmupPromise = loadScatterModelBatch(COMBAT_BUILD_MODELS, {
      targetHeight: COMBAT_BUILD_TARGET_HEIGHT,
      scaleMultiplier: COMBAT_BUILD_SCALE_MULTIPLIER,
      material,
    }).catch((err) => {
      warmupPromise = null;
      throw err;
    });
  }
  return warmupPromise;
}

/** @deprecated 使用 warmupCombatBuildModels */
export function warmupCombatBuildModel(
  profile: CombatQualityProfile,
): Promise<CombatScatterInstancedSource> {
  return warmupCombatBuildModels(profile).then((list) => {
    if (!list.length) throw new Error('No combat build models loaded');
    return list[0];
  });
}

export function getCombatBuildInstancedSource(
  profile: CombatQualityProfile,
): Promise<CombatScatterInstancedSource> {
  return warmupCombatBuildModel(profile);
}

export function clearCombatBuildCache(): void {
  warmupPromise = null;
  warmupKey = '';
  sharedBuildMaterial?.map?.dispose();
  sharedBuildMaterial?.dispose();
  sharedBuildMaterial = null;
}

export function resetCombatBuildWarmup(): void {
  warmupPromise = null;
  warmupKey = '';
}
