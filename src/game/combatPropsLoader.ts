import type { CombatQualityProfile } from './combatQuality';
import {
  COMBAT_BUILD_SCALE_MULTIPLIER,
  COMBAT_BUILD_TARGET_HEIGHT,
  getBuildSideMaterial,
} from './combatBuildLoader';
import {
  loadScatterModelBatch,
  type CombatScatterInstancedSource,
} from './combatScatterLoader';

/** 仅加载已存在的 props（props03 缺失时自动跳过） */
export const COMBAT_PROP_MODELS = [
  './tex/build/props01.fbx',
  './tex/build/props02.fbx',
  './tex/build/props04.fbx',
  './tex/build/props05.fbx',
  './tex/build/props06.fbx',
] as const;

/**
 * 道具归一化与 build01 同一套公式（targetHeight × scaleMultiplier），
 * 仅 targetHeight 更小，避免 roadside 道具与建筑同高。
 */
export const COMBAT_PROP_TARGET_HEIGHT = COMBAT_BUILD_TARGET_HEIGHT / 4.5;

const PROPS_CACHE_VERSION = 4;

let warmupPromise: Promise<CombatScatterInstancedSource[]> | null = null;
let warmupKey = '';

export function warmupCombatPropModels(
  profile: CombatQualityProfile,
): Promise<CombatScatterInstancedSource[]> {
  const key = `${PROPS_CACHE_VERSION}:${profile.quality}`;
  if (!warmupPromise || warmupKey !== key) {
    warmupKey = key;
    const material = getBuildSideMaterial(profile);
    warmupPromise = loadScatterModelBatch(COMBAT_PROP_MODELS, {
      targetHeight: COMBAT_PROP_TARGET_HEIGHT,
      scaleMultiplier: COMBAT_BUILD_SCALE_MULTIPLIER,
      material,
    }).catch((err) => {
      warmupPromise = null;
      throw err;
    });
  }
  return warmupPromise;
}

export function resetCombatPropWarmup(): void {
  warmupPromise = null;
}
