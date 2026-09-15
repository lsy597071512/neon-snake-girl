import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CombatQualityProfile } from './combatQuality';
import { texUrl } from '../utils/texUrl';

/** 战斗中模型 Y 轴朝向（90°）——默认皮肤背对相机 */
export const COMBAT_MODEL_YAW_BATTLE = Math.PI / 2;
/** 胜利结算时模型 Y 轴朝向（270°） */
export const COMBAT_MODEL_YAW_VICTORY = Math.PI + Math.PI / 2;
/** 加载时默认战斗朝向 */
export const COMBAT_MODEL_YAW = COMBAT_MODEL_YAW_BATTLE;

/**
 * 泳池派对 pifu 模型轴向与默认皮肤不同：相对默认再转 +90°，使背对相机。
 */
export function resolveCombatModelYawBattle(url: string): number {
  if (/\/pifu\/|_pifu\d+/i.test(url)) {
    return COMBAT_MODEL_YAW_BATTLE + Math.PI / 2;
  }
  return COMBAT_MODEL_YAW_BATTLE;
}

export function resolveCombatModelYawVictory(url: string): number {
  return resolveCombatModelYawBattle(url) + Math.PI;
}

export function getCombatModelYawPair(modelRoot: THREE.Group): { battle: number; victory: number } {
  return {
    battle: (modelRoot.userData.combatYawBattle as number | undefined) ?? COMBAT_MODEL_YAW_BATTLE,
    victory: (modelRoot.userData.combatYawVictory as number | undefined) ?? COMBAT_MODEL_YAW_VICTORY,
  };
}

export interface CombatModelMetrics {
  height: number;
  width: number;
  /** 归一化后模型本地空间中的炮口高度（约 0.72 * 身高） */
  muzzleY: number;
}

export interface CombatModelTemplate {
  root: THREE.Group;
  metrics: CombatModelMetrics;
}

/** 材质变更时递增，避免缓存旧模板（去法线贴图 / pifu 朝向） */
const TEMPLATE_CACHE_VERSION = 9;

const templateCache = new Map<string, Promise<CombatModelTemplate>>();
const loader = new GLTFLoader();

function applyTextureQuality(tex: THREE.Texture | null | undefined, profile: CombatQualityProfile): void {
  if (!tex) return;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = profile.quality === 'high' ? 4 : profile.quality === 'medium' ? 2 : 1;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
}

/** 透明/镂空用双面，实体网格用正面，避免 z-fighting 切线 */
function resolveMaterialSide(src: THREE.Material): THREE.Side {
  if (src.transparent || src.opacity < 1 || src.alphaTest > 0) return THREE.DoubleSide;
  return THREE.FrontSide;
}

function toLitMaterial(
  src: THREE.Material,
  profile: CombatQualityProfile,
): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  const useLambert = profile.playerUseLambert;
  let color = new THREE.Color(0xffffff);
  let map: THREE.Texture | null = null;
  let alphaMap: THREE.Texture | null = null;
  let transparent = false;
  let opacity = 1;
  let alphaTest = 0;
  let side: THREE.Side = THREE.FrontSide;

  if (src instanceof THREE.MeshStandardMaterial || src instanceof THREE.MeshLambertMaterial) {
    const mat = src.clone();
    applyTextureQuality(mat.map, profile);
    applyTextureQuality(mat.alphaMap, profile);
    if (mat instanceof THREE.MeshStandardMaterial) {
      // 角色一律去掉法线贴图，避免面部分块/噪点
      mat.normalMap = null;
      mat.bumpMap = null;
      mat.normalScale.set(1, 1);
      applyTextureQuality(mat.roughnessMap, profile);
      applyTextureQuality(mat.metalnessMap, profile);
    }
    mat.side = resolveMaterialSide(mat);
    mat.flatShading = false;

    if (useLambert && mat instanceof THREE.MeshStandardMaterial) {
      return new THREE.MeshLambertMaterial({
        map: mat.map,
        alphaMap: mat.alphaMap,
        color: mat.color,
        transparent: mat.transparent,
        opacity: mat.opacity,
        alphaTest: mat.alphaTest,
        side: mat.side,
        depthWrite: !(mat.transparent && mat.opacity < 1),
      });
    }
    if (!useLambert && mat instanceof THREE.MeshLambertMaterial) {
      return new THREE.MeshStandardMaterial({
        map: mat.map,
        alphaMap: mat.alphaMap,
        color: mat.color,
        transparent: mat.transparent,
        opacity: mat.opacity,
        alphaTest: mat.alphaTest,
        side: mat.side,
        metalness: 0,
        roughness: 0.55,
        depthWrite: !(mat.transparent && mat.opacity < 1),
      });
    }
    mat.depthWrite = !(mat.transparent && mat.opacity < 1);
    return mat;
  }

  if (src instanceof THREE.MeshBasicMaterial) {
    map = src.map;
    alphaMap = src.alphaMap;
    color = src.color?.clone() ?? color;
    transparent = src.transparent;
    opacity = src.opacity;
    alphaTest = src.alphaTest;
    side = resolveMaterialSide(src);
  } else if ('map' in src && src.map instanceof THREE.Texture) {
    map = src.map;
    side = resolveMaterialSide(src);
  }

  applyTextureQuality(map, profile);
  applyTextureQuality(alphaMap, profile);

  const litArgs = {
    map,
    alphaMap,
    color,
    transparent,
    opacity,
    alphaTest,
    side,
    depthWrite: !(transparent && opacity < 1),
  };

  return useLambert
    ? new THREE.MeshLambertMaterial(litArgs)
    : new THREE.MeshStandardMaterial({ ...litArgs, metalness: 0, roughness: 0.55 });
}

function applySceneLighting(root: THREE.Object3D, profile: CombatQualityProfile): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    mesh.castShadow = false;
    mesh.receiveShadow = profile.playerReceiveShadow;
    mesh.frustumCulled = true;

    const src = mesh.material;
    if (Array.isArray(src)) {
      mesh.material = src.map((m) => toLitMaterial(m, profile));
    } else {
      mesh.material = toLitMaterial(src, profile);
    }
  });
}

function logPlayerGeometryStats(root: THREE.Object3D): void {
  let verts = 0;
  let tris = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.getAttribute('position');
    const v = pos?.count ?? 0;
    verts += v;
    const idx = mesh.geometry.getIndex();
    tris += idx ? idx.count / 3 : v / 3;
  });
  const msg = `[combat-geo] player: ${Math.round(tris).toLocaleString()} tris, ${verts.toLocaleString()} verts (multi-mesh)`;
  console.info(msg);
  if (typeof window !== 'undefined') {
    const w = window as Window & { __combatGeoStats?: Record<string, string> };
    w.__combatGeoStats = { ...(w.__combatGeoStats ?? {}), player: `${Math.round(tris)} tris` };
  }
}

function normalizeCombatModel(scene: THREE.Object3D, yaw: number = COMBAT_MODEL_YAW): CombatModelMetrics {
  scene.rotation.y = yaw;
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  scene.position.x -= center.x;
  scene.position.y -= box.min.y;
  scene.position.z -= center.z;
  scene.updateMatrixWorld(true);

  const height = Math.max(0.001, size.y);
  const width = Math.max(0.001, size.x);

  return {
    height,
    width,
    muzzleY: height * 0.72,
  };
}

/**
 * 角色 GLB：保留原始层级 / 多材质 / 平滑法线。
 * 不再走建筑用的 merge + computeVertexNormals + orientNormalsOutward（会导致脸部块状切割）。
 */
async function loadTemplate(url: string, profile: CombatQualityProfile): Promise<CombatModelTemplate> {
  const gltf = await loader.loadAsync(texUrl(url));
  const srcScene = gltf.scene;

  applySceneLighting(srcScene, profile);
  logPlayerGeometryStats(srcScene);

  const yawBattle = resolveCombatModelYawBattle(url);
  const yawVictory = resolveCombatModelYawVictory(url);

  const poseRoot = new THREE.Group();
  poseRoot.add(srcScene);
  const metrics = normalizeCombatModel(poseRoot, yawBattle);

  const root = new THREE.Group();
  root.add(poseRoot);
  root.userData.combatMetrics = metrics;
  root.userData.combatYawBattle = yawBattle;
  root.userData.combatYawVictory = yawVictory;
  root.userData.combatModelUrl = url;

  return { root, metrics };
}

export function getCombatModelTemplate(
  url: string,
  profile: CombatQualityProfile,
): Promise<CombatModelTemplate> {
  const cacheKey = `${url}@v${TEMPLATE_CACHE_VERSION}@${profile.quality}`;
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

export function cloneCombatModel(template: CombatModelTemplate): THREE.Group {
  const clone = template.root.clone(true);
  clone.userData.combatMetrics = { ...template.metrics };
  clone.userData.combatYawBattle = template.root.userData.combatYawBattle;
  clone.userData.combatYawVictory = template.root.userData.combatYawVictory;
  clone.userData.combatModelUrl = template.root.userData.combatModelUrl;

  clone.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => m.clone());
    } else if (mesh.material) {
      mesh.material = mesh.material.clone();
    }
  });

  return clone;
}

export function disposeCombatModelInstance(root: THREE.Group): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      mat.dispose();
    }
  });
  root.clear();
}

export function clearCombatModelCache(): void {
  templateCache.clear();
}

export function getCombatModelPoseNode(modelRoot: THREE.Group): THREE.Object3D | null {
  return modelRoot.children[0] ?? null;
}

export function setCombatModelYaw(modelRoot: THREE.Group, yaw: number): void {
  const node = getCombatModelPoseNode(modelRoot);
  if (node) node.rotation.y = yaw;
}
