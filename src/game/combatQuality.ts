export type CombatQuality = 'low' | 'medium' | 'high';

export interface CombatQualityProfile {
  quality: CombatQuality;
  maxPixelRatio: number;
  shadowMapSize: number;
  /** 是否启用阴影贴图 */
  shadowsEnabled: boolean;
  /** 玩家模型接收阴影 */
  playerReceiveShadow: boolean;
  /** 敌人投射阴影 */
  enemyCastShadow: boolean;
  /** 玩家用 Lambert 代替 Standard */
  playerUseLambert: boolean;
  parallaxLayers: number;
  /** 两侧建筑 FBX 实例数 */
  sideBuildings: number;
  /** 道路两侧道具实例数 */
  sideProps: number;
  maxVfxParticles: number;
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  bloomHalfRes: boolean;
  ambientDust: number;
}

const PROFILE: CombatQualityProfile = {
  quality: 'medium',
  maxPixelRatio: 2.2,
  shadowMapSize: 1024,
  shadowsEnabled: true,
  playerReceiveShadow: true,
  enemyCastShadow: false,
  playerUseLambert: false,
  parallaxLayers: 3,
  sideBuildings: 4,
  sideProps: 4,
  maxVfxParticles: 40,
  bloomEnabled: false,
  bloomStrength: 0,
  bloomRadius: 0.35,
  bloomThreshold: 0.82,
  bloomHalfRes: true,
  ambientDust: 24,
};

export function getCombatQualityProfile(): CombatQualityProfile {
  return PROFILE;
}
