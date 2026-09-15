import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _normPos = new THREE.Vector3();
const _normOutward = new THREE.Vector3();
const _normVec = new THREE.Vector3();

function isSkySphereMesh(mesh: THREE.Mesh): boolean {
  const name = mesh.name.toLowerCase();
  if (/sky|sphere|dome|hemisphere|ball|天空|球|env|environment/i.test(name)) return true;
  const geo = mesh.geometry;
  if (geo instanceof THREE.SphereGeometry) return true;
  if (/sphere/i.test(geo?.type ?? '')) return true;
  // 不用包围盒近似球判定 — build02 等方型大建筑会被误删
  return false;
}

function reverseGeometryWinding(geometry: THREE.BufferGeometry): void {
  const index = geometry.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      index.setXYZ(i, c, b, a);
    }
    index.needsUpdate = true;
    return;
  }

  for (const attr of Object.values(geometry.attributes)) {
    const buffer = attr as THREE.BufferAttribute;
    const itemSize = buffer.itemSize;
    const tmp = new Float32Array(itemSize);
    for (let i = 0; i < buffer.count; i += 3) {
      for (let v = 0; v < itemSize; v++) {
        tmp[v] = buffer.array[i * itemSize + v];
      }
      for (let v = 0; v < itemSize; v++) {
        buffer.array[i * itemSize + v] = buffer.array[(i + 2) * itemSize + v];
      }
      for (let v = 0; v < itemSize; v++) {
        buffer.array[(i + 2) * itemSize + v] = tmp[v];
      }
    }
    buffer.needsUpdate = true;
  }
}

/** 合并选项：角色/敌人应保留原始法线，建筑道具可重算法线并外翻 */
export interface MergeGeometryOptions {
  /** true：保留已有 normal，不重算、不外翻（角色/有机模型） */
  preserveNormals?: boolean;
}

function orientNormalsOutward(geometry: THREE.BufferGeometry): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;

  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count > 80_000) {
    geometry.computeVertexNormals();
    return;
  }

  const center = box.getCenter(new THREE.Vector3());
  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals();
  }

  const norm = geometry.getAttribute('normal') as THREE.BufferAttribute;
  if (!norm) return;

  for (let i = 0; i < pos.count; i++) {
    _normPos.fromBufferAttribute(pos, i);
    _normOutward.subVectors(_normPos, center);
    if (_normOutward.lengthSq() < 1e-8) continue;
    _normVec.fromBufferAttribute(norm, i);
    if (_normVec.dot(_normOutward) < 0) {
      norm.setXYZ(i, -_normVec.x, -_normVec.y, -_normVec.z);
    }
  }
  norm.needsUpdate = true;
}

/** 将 FBX/GLTF 层级合并为单块 BufferGeometry（战斗场景共用，减少节点树开销） */
export function mergeFbxMeshesToGeometry(
  root: THREE.Object3D,
  options: MergeGeometryOptions = {},
): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (isSkySphereMesh(mesh)) return;
    const geom = mesh.geometry.clone();
    geom.applyMatrix4(mesh.matrixWorld);
    if (mesh.matrixWorld.determinant() < 0) {
      reverseGeometryWinding(geom);
    }
    parts.push(geom);
  });

  if (parts.length === 0) return new THREE.BoxGeometry(1.2, 1.8, 0.8);
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) return new THREE.BoxGeometry(1.2, 1.8, 0.8);

  const hasNormals = !!merged.getAttribute('normal');
  if (options.preserveNormals) {
    if (!hasNormals) merged.computeVertexNormals();
  } else {
    merged.computeVertexNormals();
    orientNormalsOutward(merged);
  }
  return merged;
}

export function logCombatGeometryStats(label: string, geometry: THREE.BufferGeometry): void {
  const pos = geometry.getAttribute('position');
  const verts = pos?.count ?? 0;
  const idx = geometry.getIndex();
  const tris = idx ? idx.count / 3 : verts / 3;
  const msg = `[combat-geo] ${label}: ${Math.round(tris).toLocaleString()} tris, ${verts.toLocaleString()} verts`;
  console.info(msg);
  if (typeof window !== 'undefined') {
    const w = window as Window & { __combatGeoStats?: Record<string, string> };
    w.__combatGeoStats = { ...(w.__combatGeoStats ?? {}), [label]: `${Math.round(tris)} tris` };
  }
}
