import * as THREE from 'three';
import type { StageDef } from '../types';
import { LANE_X, PLAYER_Z, roadY } from './WastelandEnvironment';
import { combatHitDamage } from './combatBalance';

export interface BossProjectile3D {
  sprite: THREE.Sprite;
  lane: number;
  z: number;
  speed: number;
  damage: number;
  active: boolean;
}

export interface RaidBossAttackConfig {
  intervalSec: number;
  telegraphSec: number;
  projectileSpeed: number;
}

let bossProjectileMaterialCache: THREE.SpriteMaterial | null = null;

/** P2+：高对比 BOSS 弹幕贴图。
 * 之前中心是 #ffffff，additive 下整颗 boss 弹幕头部刺眼白爆。
 * 现在中心用 #ffe49a 暖金，去除任何 #ffffff 像素。 */
export function getBossProjectileMaterial(): THREE.SpriteMaterial {
  if (bossProjectileMaterialCache) return bossProjectileMaterialCache;
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const grd = ctx.createRadialGradient(cx, cx, 4, cx, cx, cx - 2);
  grd.addColorStop(0, '#ffe49a');
  grd.addColorStop(0.25, '#ffcc44');
  grd.addColorStop(0.55, '#ff5522');
  grd.addColorStop(1, 'rgba(255, 60, 0, 0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 200, 120, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cx, cx * 0.35, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  bossProjectileMaterialCache = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.85,
    toneMapped: false,
  });
  return bossProjectileMaterialCache;
}

export function raidBossAttackConfig(stage: StageDef): RaidBossAttackConfig {
  const hell = stage.mode === 'hell';
  return {
    intervalSec: hell ? 0.48 : 0.58,
    telegraphSec: hell ? 0.28 : 0.35,
    projectileSpeed: hell ? 39 : 32,
  };
}

export function spawnBossProjectile(
  scene: THREE.Scene,
  lane: number,
  startZ: number,
  damage: number,
  speed: number,
  cameraZ: number,
): BossProjectile3D {
  const mat = getBossProjectileMaterial().clone();
  const sprite = new THREE.Sprite(mat);
  const y = roadY(startZ, cameraZ) + 2.8;
  sprite.scale.set(2.4, 2.4, 1);
  sprite.position.set(LANE_X[lane], y, startZ);
  sprite.renderOrder = 12;
  scene.add(sprite);
  return { sprite, lane, z: startZ, speed, damage, active: true };
}

export function updateBossProjectiles(
  projectiles: BossProjectile3D[],
  dt: number,
  playerLane: number,
  cameraZ: number,
  onHit: (damage: number) => void,
): void {
  for (const p of projectiles) {
    if (!p.active) continue;
    p.z += p.speed * dt;
    const y = roadY(p.z, cameraZ) + 2.8;
    p.sprite.position.set(LANE_X[p.lane], y, p.z);
    if (p.z >= PLAYER_Z - 0.5 && p.lane === playerLane) {
      p.active = false;
      p.sprite.parent?.remove(p.sprite);
      (p.sprite.material as THREE.SpriteMaterial).dispose();
      onHit(p.damage);
    } else if (p.z > PLAYER_Z + 6) {
      p.active = false;
      p.sprite.parent?.remove(p.sprite);
      (p.sprite.material as THREE.SpriteMaterial).dispose();
    }
  }
}

export function pickRandomBossLane(): number {
  return Math.floor(Math.random() * 3);
}

export function bossProjectileDamage(stage: StageDef): number {
  return combatHitDamage(stage, 'raidBoss');
}
