import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import type { CombatQualityProfile } from './combatQuality';
import { texUrl } from '../utils/texUrl';
import { logCombatGeometryStats, mergeFbxMeshesToGeometry } from './combatFbxMerge';

const SCATTER_MAX_TRIS = 120_000;
const fbxLoader = new FBXLoader();

export interface CombatScatterInstancedSource {
  geometry: THREE.BufferGeometry;
  targetHeight: number;
  label: string;
  /** 归一化后本地空间 X/Z 半宽（用于道路避让） */
  footHalfX: number;
  footHalfZ: number;
}

export interface ScatterLoadOptions {
  modelUrl: string;
  statsLabel: string;
  targetHeight: number;
  scaleMultiplier: number;
  material: THREE.MeshStandardMaterial;
}

function simplifyScatterGeometryIfNeeded(
  geometry: THREE.BufferGeometry,
  statsLabel: string,
): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position');
  if (!pos) return geometry;

  const idx = geometry.getIndex();
  const tris = idx ? idx.count / 3 : pos.count / 3;
  if (tris <= SCATTER_MAX_TRIS) return geometry;

  const targetVerts = Math.max(12_000, SCATTER_MAX_TRIS);
  const removeVerts = Math.max(0, pos.count - targetVerts);
  const modifier = new SimplifyModifier();
  const simplified = modifier.modify(geometry, removeVerts);
  geometry.dispose();
  simplified.computeVertexNormals();
  logCombatGeometryStats(`${statsLabel}-simplified`, simplified);
  return simplified;
}

function normalizeScatterGeometry(
  geometry: THREE.BufferGeometry,
  targetHeight: number,
  scaleMultiplier: number,
): number {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return 1;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -box.min.y, -center.z);

  const height = Math.max(0.001, size.y);
  const fit = (targetHeight * scaleMultiplier) / height;
  geometry.scale(fit, fit, fit);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return targetHeight * scaleMultiplier;
}

function readFootprint(geometry: THREE.BufferGeometry): { footHalfX: number; footHalfZ: number } {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return { footHalfX: 0.5, footHalfZ: 0.5 };
  const size = box.getSize(new THREE.Vector3());
  return { footHalfX: size.x * 0.5, footHalfZ: size.z * 0.5 };
}

/** 旋转+缩放后沿 X 轴占用半宽（朝道路内侧的最小净空距离） */
export function scatterRoadHalfWidthX(
  source: Pick<CombatScatterInstancedSource, 'footHalfX' | 'footHalfZ'>,
  rotY: number,
  scale: number,
): number {
  const c = Math.abs(Math.cos(rotY));
  const s = Math.abs(Math.sin(rotY));
  return (c * source.footHalfX + s * source.footHalfZ) * scale;
}

export async function loadScatterInstancedSource(
  options: ScatterLoadOptions,
): Promise<CombatScatterInstancedSource> {
  const { modelUrl, statsLabel, targetHeight, scaleMultiplier, material } = options;
  const fbx = await fbxLoader.loadAsync(texUrl(modelUrl));

  fbx.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = material;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
  });

  const geometry = mergeFbxMeshesToGeometry(fbx);
  logCombatGeometryStats(`${statsLabel}-raw`, geometry);
  const simplified = simplifyScatterGeometryIfNeeded(geometry, statsLabel);
  normalizeScatterGeometry(simplified, targetHeight, scaleMultiplier);
  const { footHalfX, footHalfZ } = readFootprint(simplified);

  fbx.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
  });

  return {
    geometry: simplified,
    targetHeight: targetHeight * scaleMultiplier,
    label: statsLabel,
    footHalfX,
    footHalfZ,
  };
}

export async function loadScatterModelBatch(
  modelUrls: readonly string[],
  options: Omit<ScatterLoadOptions, 'modelUrl' | 'statsLabel'> & {
    labelFromUrl?: (url: string) => string;
  },
): Promise<CombatScatterInstancedSource[]> {
  const labelFromUrl =
    options.labelFromUrl ??
    ((url: string) => {
      const m = url.match(/\/([^/]+)\.fbx$/i);
      return m?.[1] ?? 'scatter';
    });

  const results: CombatScatterInstancedSource[] = [];
  for (const modelUrl of modelUrls) {
    try {
      const source = await loadScatterInstancedSource({
        modelUrl,
        statsLabel: labelFromUrl(modelUrl),
        targetHeight: options.targetHeight,
        scaleMultiplier: options.scaleMultiplier,
        material: options.material,
      });
      results.push(source);
    } catch (err) {
      console.warn(`[combat-scatter] skip ${modelUrl}`, err);
    }
  }
  return results;
}
