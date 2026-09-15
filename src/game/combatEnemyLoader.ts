import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { CombatQualityProfile } from './combatQuality';
import { texUrl } from '../utils/texUrl';
import { billboardScale, SPAWN_Z, COMBAT_CAMERA } from './WastelandEnvironment';
import { logCombatGeometryStats, mergeFbxMeshesToGeometry } from './combatBuildLoader';

/** 与 Combat3D.COMBAT_CHARACTER_SCALE 保持一致 */
const ENEMY_CHARACTER_SCALE = 0.5;

export const COMBAT_ENEMY_MODEL = './tex/diren/diren01.fbx';
export const COMBAT_ENEMY_TEXTURE = './tex/diren/diren01_d.png';

/** 敌人模型 Y 轴朝向：面向玩家（相对背对再转 180° → 0°） */
export const COMBAT_ENEMY_YAW_BATTLE = 0;

/** 敌人模型相对默认尺寸放大倍数（直接乘到世界空间高度） */
export const COMBAT_ENEMY_SCALE_MULTIPLIER = 10;

/** 3D 模型固定参考深度（与 COMBAT_CAMERA 配套） */
const ENEMY_MODEL_REF_Z = SPAWN_Z;
const ENEMY_MODEL_REF_CAMERA_Z = COMBAT_CAMERA.z;

export interface CombatEnemyMetrics {
  height: number;
  width: number;
  depth: number;
}

export interface CombatEnemyTemplate {
  root: THREE.Group;
  metrics: CombatEnemyMetrics;
}

/** 模型朝向/缩放逻辑变更时递增，避免生产环境缓存旧模板 */
const TEMPLATE_CACHE_VERSION = 11;

const templateCache = new Map<string, Promise<CombatEnemyTemplate>>();
const fbxLoader = new FBXLoader();
const texLoader = new THREE.TextureLoader();

let sharedEnemy01Material: THREE.MeshStandardMaterial | null = null;
let warmupPromise: Promise<CombatEnemyTemplate> | null = null;

/** 敌人01 · 简易 PBR，仅颜色贴图，整体 0.5 灰度高光（roughness 0.5） */
export function getEnemy01Material(profile: CombatQualityProfile): THREE.MeshStandardMaterial {
  if (sharedEnemy01Material) return sharedEnemy01Material;

  const map = texLoader.load(texUrl(COMBAT_ENEMY_TEXTURE));
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = profile.quality === 'high' ? 4 : profile.quality === 'medium' ? 2 : 1;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;

  sharedEnemy01Material = new THREE.MeshStandardMaterial({
    name: '敌人01',
    map,
    color: new THREE.Color(0xffffff),
    metalness: 0,
    roughness: 0.5,
    envMapIntensity: 0.5,
  });

  return sharedEnemy01Material;
}

function applyEnemy01Material(
  root: THREE.Object3D,
  material: THREE.MeshStandardMaterial,
  profile: CombatQualityProfile,
): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = material;
    mesh.castShadow = profile.enemyCastShadow;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
  });
}

function normalizeCombatEnemyMesh(mesh: THREE.Mesh): CombatEnemyMetrics {
  mesh.rotation.set(0, COMBAT_ENEMY_YAW_BATTLE, 0);
  mesh.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  mesh.position.x -= center.x;
  mesh.position.y -= box.min.y;
  mesh.position.z -= center.z;
  mesh.rotation.set(0, 0, 0);
  mesh.updateMatrixWorld(true);

  return {
    height: Math.max(0.001, size.y),
    width: Math.max(0.001, size.x),
    depth: Math.max(0.001, size.z),
  };
}

async function loadTemplate(url: string, profile: CombatQualityProfile): Promise<CombatEnemyTemplate> {
  const material = getEnemy01Material(profile);
  const fbx = await fbxLoader.loadAsync(texUrl(url));
  applyEnemy01Material(fbx, material, profile);

  const geometry = mergeFbxMeshesToGeometry(fbx, { preserveNormals: true });
  logCombatGeometryStats('diren01', geometry);

  fbx.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry?.dispose();
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = profile.enemyCastShadow;
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
  const metrics = normalizeCombatEnemyMesh(mesh);

  const root = new THREE.Group();
  root.add(mesh);
  root.userData.combatMetrics = metrics;

  return { root, metrics };
}

function templateCacheKey(url: string): string {
  return `${TEMPLATE_CACHE_VERSION}:${url}`;
}

export function getCombatEnemyTemplate(
  url: string,
  profile: CombatQualityProfile,
): Promise<CombatEnemyTemplate> {
  const cacheKey = templateCacheKey(url);
  let pending = templateCache.get(cacheKey);
  if (!pending) {
    pending = loadTemplate(url, profile).catch((err) => {
      templateCache.delete(cacheKey);
      throw err;
    });
    templateCache.set(cacheKey, pending);
  }
  return pending;
}

/** 应用启动与战斗场景共用的预加载 Promise，避免首波敌人仍用 Sprite 兜底 */
export function warmupCombatEnemyTemplate(profile: CombatQualityProfile): Promise<CombatEnemyTemplate> {
  if (!warmupPromise) {
    warmupPromise = getCombatEnemyTemplate(COMBAT_ENEMY_MODEL, profile).catch((err) => {
      warmupPromise = null;
      throw err;
    });
  }
  return warmupPromise;
}

export function createCombatEnemyInstancedMesh(
  template: CombatEnemyTemplate,
  profile: CombatQualityProfile,
  capacity: number,
): THREE.InstancedMesh {
  const srcMesh = template.root.children[0] as THREE.Mesh;
  const mesh = new THREE.InstancedMesh(srcMesh.geometry, getEnemy01Material(profile), capacity);
  mesh.name = 'enemy-instances';
  mesh.frustumCulled = true;
  mesh.castShadow = profile.enemyCastShadow;
  mesh.receiveShadow = false;
  mesh.count = 0;
  return mesh;
}

export function cloneCombatEnemy(template: CombatEnemyTemplate): THREE.Group {
  const clone = template.root.clone(true);
  clone.userData.combatMetrics = { ...template.metrics };
  return clone;
}

export function disposeCombatEnemyInstance(root: THREE.Group): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.material !== sharedEnemy01Material && mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) mat.dispose();
    }
  });
  root.clear();
}

export function resetCombatEnemyWarmup(): void {
  warmupPromise = null;
}

export function clearCombatEnemyCache(): void {
  templateCache.clear();
  warmupPromise = null;
  sharedEnemy01Material?.map?.dispose();
  sharedEnemy01Material?.dispose();
  sharedEnemy01Material = null;
}

/** 根据模型 metrics 计算世界空间 uniform 缩放（含 COMBAT_ENEMY_SCALE_MULTIPLIER） */
export function computeEnemyModelUniform(metrics: CombatEnemyMetrics, boss = false): number {
  const refScale = billboardScale(ENEMY_MODEL_REF_Z, ENEMY_MODEL_REF_CAMERA_Z) * ENEMY_CHARACTER_SCALE;
  const targetH = (boss ? 4 * 1.35 : 2.4) * refScale * COMBAT_ENEMY_SCALE_MULTIPLIER;
  return targetH / Math.max(0.001, metrics.height);
}

/** 3D 模型用固定世界尺寸（不含 COMBAT_ENEMY_SCALE_MULTIPLIER，倍数在 computeEnemyModelUniform 中乘） */
export function getEnemyModelBaseSize(boss = false): { w: number; h: number } {
  const s = billboardScale(ENEMY_MODEL_REF_Z, ENEMY_MODEL_REF_CAMERA_Z) * ENEMY_CHARACTER_SCALE;
  if (boss) {
    return { w: 3 * 1.35 * s, h: 4 * 1.35 * s };
  }
  return { w: 1.8 * s, h: 2.4 * s };
}

/** Sprite 敌人：随距离做 billboard 缩放 */
export function getEnemyTargetSize(z: number, cameraZ: number, boss = false): { w: number; h: number } {
  const s = billboardScale(z, cameraZ) * ENEMY_CHARACTER_SCALE * COMBAT_ENEMY_SCALE_MULTIPLIER;
  if (boss) {
    return { w: 3 * 1.35 * s, h: 4 * 1.35 * s };
  }
  return { w: 1.8 * s, h: 2.4 * s };
}
