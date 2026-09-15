import * as THREE from 'three';
import { roadY } from './WastelandEnvironment';

/** 战斗投射物主要飞行方向（深入战场 / 朝向敌人） */
export const COMBAT_FIRE_DIR = new THREE.Vector3(0, 0, -1);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** 沿道路坡度取弹道上前方一点，使屏幕朝向与路面透视一致（绿箭头） */
function setCombatForwardTarget(
  origin: THREE.Vector3,
  camera: THREE.Camera,
  target: THREE.Vector3,
  dist = 6,
): void {
  const camZ = camera.position.z;
  const forwardZ = origin.z - dist;
  const muzzleLift = origin.y - roadY(origin.z, camZ);
  target.set(origin.x, roadY(forwardZ, camZ) + muzzleLift, forwardZ);
}

/**
 * 让 Sprite 长轴对齐飞行方向（屏幕空间）。
 * Three.js Sprite 的朝向由 material.rotation 控制，object.rotation 无效。
 * 贴图长轴在 U（local +X），默认会横在屏幕上，需旋转到弹道方向。
 */
export function orientSpriteAlongDir(
  sprite: THREE.Sprite,
  camera: THREE.Camera,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  length: number,
  width: number,
): void {
  _a.copy(origin);
  if (dir === COMBAT_FIRE_DIR) {
    setCombatForwardTarget(origin, camera, _b);
  } else {
    _b.copy(origin).add(dir);
  }
  _a.project(camera);
  _b.project(camera);
  const ang = Math.atan2(_b.y - _a.y, _b.x - _a.x);
  const mat = sprite.material as THREE.SpriteMaterial;
  mat.rotation = ang;
  sprite.rotation.set(0, 0, 0);
  sprite.scale.set(length, width, 1);
}

/** 玩家弹幕 */
export function orientCombatBullet(
  sprite: THREE.Sprite,
  camera: THREE.Camera,
  origin: THREE.Vector3,
  length: number,
  width = 0.2,
): void {
  orientSpriteAlongDir(sprite, camera, origin, COMBAT_FIRE_DIR, length, width);
}
