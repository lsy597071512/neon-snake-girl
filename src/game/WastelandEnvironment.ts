import * as THREE from 'three';
import type { CombatQualityProfile } from './combatQuality';
import { getCombatTheme, type CombatTheme, type CombatThemeId } from './combatThemes';
import { pickCombatBackdropUrl } from './combatBackdrops';
import {
  createRoadTexture,
  COMBAT_ROAD_TEXTURE,
  COMBAT_ROAD_METERS_PER_TILE,
  configureCombatRoadTexture,
  configureCombatRoadTextureWorldSpace,
  applyWorldSpaceRoadUvs,
  getRoadTextureAspect,
} from './textureUtils';
import { texUrl } from '../utils/texUrl';
import { getBuildSideMaterial, warmupCombatBuildModels } from './combatBuildLoader';
import { warmupCombatPropModels } from './combatPropsLoader';
import type { CombatScatterInstancedSource } from './combatScatterLoader';
import { scatterRoadHalfWidthX } from './combatScatterLoader';
import {
  resetCombatBillboardWarmup,
  themeUsesBillboards,
  warmupCombatBillboards,
  type CombatBillboardSource,
} from './combatBillboardLoader';

/** 主路面 dimian01 尺寸（PlaneGeometry 宽 × 长） */
const DIMIAN01_WIDTH = 16;
const DIMIAN01_DEPTH = 1000;
/** dimian02 宽路面肩台宽度（世界单位） */
const DIMIAN02_WIDTH = 200;
/** 两层地面 Z 中心（与 dimian01 一致滚动） */
const DIMIAN_FLOOR_Z = -55;
const DIMIAN01_Y = 0.08;
/** dimian02 在 dimian01 下方（更低一层，露出宽路面肩台） */
export const DIMIAN02_Y = -0.35;
const SIDE_BUILD_Z_SPACING = 88;
/** 建筑内侧贴路肩后，再向外的随机偏移 */
const SIDE_BUILD_OUTWARD_SPREAD = 18;
/** 建筑与 dimian01 边缘的间隙（加大，避免与主路重叠） */
const BUILD_ROAD_CLEAR_MARGIN = 1.8;
/** 循环滚动时 Z 方向总跨度 */
const SIDE_BUILD_LOOP_SPAN = 360;
/** 两侧建筑脚底与 dimian02 顶面对齐（略抬高避免 z-fighting） */
const SIDE_BUILD_Y = DIMIAN02_Y + 0.02;

/** 两侧建筑实例缩放（缩小，减轻与道路重叠） */
const SIDE_BUILD_INSTANCE_SCALE = 0.62;

/** 2D 建筑面片：贴路肩后再外移的随机量 */
const SIDE_BILLBOARD_OUTWARD_SPREAD = 18;
/** 面片脚底与 dimian02 顶面对齐（几何已把脚底放在 y=0） */
const SIDE_BILLBOARD_Y = DIMIAN02_Y + 0.02;
/** 面片宽度半宽估计（相对 targetHeight）→ 用于避让主路 */
const SIDE_BILLBOARD_WIDTH_RATIO = 0.55;
const SIDE_BILLBOARD_ROAD_CLEAR = 2.2;
const SIDE_BILLBOARD_LOOP_SPAN = 360;
/** 沿路 Z 随机放置区间（相对循环带，越散越无规律） */
const SIDE_BILLBOARD_Z_NEAR = 18;
const SIDE_BILLBOARD_Z_FAR = 340;
/** 面片整体缩放 */
const SIDE_BILLBOARD_SCALE_MUL = 0.72;
/** 数量倍率（相对原先 quality 估算） */
const SIDE_BILLBOARD_COUNT_MUL = 4;

/** dimian01 主路半宽（|x| ≤ 此值为主路面，道具不得侵入） */
export const DIMIAN01_HALF_WIDTH = DIMIAN01_WIDTH / 2;

/** 道具 footprint 与 dimian01 边缘的最小间隙 */
const PROP_ROAD_CLEAR_MARGIN = 0.4;

/** 道路两侧道具 — 落在 dimian02 肩台上、仅向路外随机偏移 */
const SIDE_PROP_OUTWARD_SPREAD = 14;
const SIDE_PROP_Z_SPACING = 78;
const SIDE_PROP_Y = DIMIAN02_Y + 0.04;
/** 与 build01 相同的实例缩放系数 */
const SIDE_PROP_INSTANCE_SCALE = SIDE_BUILD_INSTANCE_SCALE;

interface SideScatterState {
  baseX: number;
  baseY: number;
  scale: number;
  rot: number;
  z: number;
}

interface SideScatterLayer {
  mesh: THREE.InstancedMesh;
  states: SideScatterState[];
}

interface SideScatterSpawn {
  variant: number;
  side: number;
  baseX: number;
  baseY: number;
  scale: number;
  rot: number;
  z: number;
}

interface SideBillboardState {
  mesh: THREE.Mesh;
  baseX: number;
  baseY: number;
  scale: number;
  /** 面向路心：左岸 +PI/2，右岸 -PI/2 */
  faceYaw: number;
  z: number;
}
/** 主平行光强度（覆盖主题默认值） */
const COMBAT_SUN_INTENSITY = 3;

/** 章节竖屏 2K 远景背景（跟随相机；已取消圆球天空盒） */
/** 距镜头更近（原 82） */
const THEME_BACKDROP_DIST = 52;
/** 背景面高度（缩小，避免压过角色） */
const THEME_BACKDROP_HEIGHT = 39;
const THEME_BACKDROP_ASPECT = 1152 / 2048;
/** 相对面片高度的中心上抬；再整体下移 1/3 面高 */
const THEME_BACKDROP_Y_FACTOR = 0.38 - 1 / 3;

function pickThemeBackdropUrl(themeId: CombatThemeId, stageId: number): string | null {
  return pickCombatBackdropUrl(themeId, stageId);
}

/** 两侧建筑 Y 轴朝向：等概率 90° / 180° / 270° */
function pickSideBuildYaw(): number {
  const steps = [Math.PI / 2, Math.PI, Math.PI * 1.5];
  return steps[Math.floor(Math.random() * steps.length)];
}

function pickSidePropYaw(): number {
  return Math.random() * Math.PI * 2;
}

function pickSide(index: number): number {
  return index % 2 === 0 ? -1 : 1;
}

export interface WastelandOptions {
  chapter: number;
  stageId: number;
  quality: CombatQualityProfile;
}

export class WastelandEnvironment {
  readonly world: THREE.Group;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly theme: CombatTheme;
  private readonly quality: CombatQualityProfile;
  private readonly stageId: number;
  private roadTex: THREE.Texture;
  private dimian02RoadTex: THREE.Texture | null = null;
  private dimian01Mesh: THREE.Mesh | null = null;
  private dimian02Mesh: THREE.Mesh | null = null;
  private dimian01Mat: THREE.MeshStandardMaterial | null = null;
  private dimian02Mat: THREE.MeshStandardMaterial | null = null;
  private scrollZ = 0;
  private readonly loader = new THREE.TextureLoader();
  private themeBackdropRoot: THREE.Group | null = null;
  private themeBackdropTextures: THREE.Texture[] = [];
  private sideScatterLayers: SideScatterLayer[] = [];
  private sideScatterLoopSpan = SIDE_BUILD_LOOP_SPAN;
  private readonly sideScatterDummy = new THREE.Object3D();
  private sideScatterMatrixDirty = false;
  private sideBillboards: SideBillboardState[] = [];
  private sideBillboardSources: CombatBillboardSource[] = [];
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly rim: THREE.DirectionalLight;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, options: WastelandOptions) {
    this.scene = scene;
    this.camera = camera;
    this.theme = getCombatTheme(options.chapter);
    this.quality = options.quality;
    this.stageId = options.stageId;
    this.world = new THREE.Group();
    scene.add(this.world);

    scene.background = new THREE.Color(this.theme.background);
    scene.fog = null;

    this.roadTex = createRoadTexture(this.theme);
    configureCombatRoadTexture(this.roadTex);
    this.syncDimian02RoadTexture(this.roadTex);

    this.hemi = new THREE.HemisphereLight(this.theme.hemiSky, this.theme.hemiGround, this.theme.hemiIntensity);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(this.theme.sunColor, COMBAT_SUN_INTENSITY);
    this.sun.position.set(-35, 55, 25);
    this.sun.castShadow = this.quality.shadowsEnabled;
    if (this.quality.shadowsEnabled) {
      const shadowSize = this.quality.shadowMapSize;
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      this.sun.shadow.camera.near = 0.5;
      this.sun.shadow.camera.far = 150;
      this.sun.shadow.camera.left = -25;
      this.sun.shadow.camera.right = 25;
      this.sun.shadow.camera.top = 25;
      this.sun.shadow.camera.bottom = -25;
      this.sun.shadow.bias = -0.0002;
    }
    scene.add(this.sun);

    this.rim = new THREE.DirectionalLight(this.theme.rimColor, this.theme.rimIntensity);
    this.rim.position.set(20, 15, -30);
    scene.add(this.rim);

    // 仅正前方竖屏远景；无图时用主题底色填边，不再挂圆球天空
    this.buildThemeBackdrops();
    this.buildScrollFloor();
    this.loadCombatRoadTexture();
    // 已配 2D 面片的章节：替换两侧 3D 建筑/道具；其余仍走 FBX scatter
    if (themeUsesBillboards(this.theme.id)) {
      void this.buildSideBillboards();
    } else if (this.quality.sideBuildings > 0 || this.quality.sideProps > 0) {
      void this.buildSideScatter();
    }
  }

  /** 当前关卡对应的一张远景（每两关换图）；仅正前方竖屏面片 */
  private buildThemeBackdrops(): void {
    const url = pickThemeBackdropUrl(this.theme.id, this.stageId);
    if (!url) return;

    const root = new THREE.Group();
    root.name = `${this.theme.id}-backdrops`;
    this.themeBackdropRoot = root;
    this.scene.add(root);

    const planeH = THEME_BACKDROP_HEIGHT;
    const planeW = planeH * THEME_BACKDROP_ASPECT;

    this.loader.load(texUrl(url), (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = this.quality.quality === 'high' ? 4 : 2;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      this.themeBackdropTextures.push(tex);

      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: 0xffffff,
        fog: false,
        depthWrite: false,
        toneMapped: true,
        side: THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
      mesh.name = `${this.theme.id}-backdrop`;
      mesh.frustumCulled = false;
      mesh.renderOrder = -40;
      mesh.position.set(0, planeH * THEME_BACKDROP_Y_FACTOR, -THEME_BACKDROP_DIST);
      mesh.updateMatrix();
      root.add(mesh);
      this.syncThemeBackdropsToCamera();
    });
  }

  private syncThemeBackdropsToCamera(): void {
    if (!this.themeBackdropRoot) return;
    // 锁在相机上，只跟位移；保持水平（不跟俯仰），远景始终铺满视野
    // Y 略抬高，让背景画面更靠上
    this.themeBackdropRoot.position.set(
      this.camera.position.x,
      this.camera.position.y * 0.15 + 8,
      this.camera.position.z,
    );
  }

  private buildScrollFloor(): void {
    const dimianRoot = new THREE.Group();
    dimianRoot.name = 'dimian-root';

    this.dimian02Mat = new THREE.MeshStandardMaterial({
      map: this.dimian02RoadTex ?? this.roadTex,
      roughness: 0.94,
      metalness: 0.05,
      color: new THREE.Color(0xb8a890),
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    this.dimian01Mat = new THREE.MeshStandardMaterial({
      map: this.roadTex,
      roughness: 0.92,
      metalness: 0.08,
      color: 0xffffff,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const dimian02Geo = new THREE.PlaneGeometry(DIMIAN02_WIDTH, DIMIAN01_DEPTH);
    applyWorldSpaceRoadUvs(dimian02Geo, COMBAT_ROAD_METERS_PER_TILE, getRoadTextureAspect(this.roadTex));

    const dimian02 = new THREE.Mesh(dimian02Geo, this.dimian02Mat);
    dimian02.name = 'dimian02';
    dimian02.rotation.x = -Math.PI / 2;
    dimian02.position.set(0, DIMIAN02_Y, DIMIAN_FLOOR_Z);
    dimian02.receiveShadow = this.quality.shadowsEnabled;
    dimian02.renderOrder = 0;
    dimian02.frustumCulled = true;
    dimian02.matrixAutoUpdate = false;
    dimian02.updateMatrix();

    const dimian01 = new THREE.Mesh(
      new THREE.PlaneGeometry(DIMIAN01_WIDTH, DIMIAN01_DEPTH),
      this.dimian01Mat,
    );
    dimian01.name = 'dimian01';
    dimian01.rotation.x = -Math.PI / 2;
    dimian01.position.set(0, DIMIAN01_Y, DIMIAN_FLOOR_Z);
    dimian01.receiveShadow = this.quality.shadowsEnabled;
    dimian01.renderOrder = 2;
    dimian01.frustumCulled = true;
    dimian01.matrixAutoUpdate = false;
    dimian01.updateMatrix();

    dimianRoot.add(dimian02);
    dimianRoot.add(dimian01);
    dimianRoot.matrixAutoUpdate = false;
    dimianRoot.updateMatrix();
    this.dimian02Mesh = dimian02;
    this.dimian01Mesh = dimian01;
    this.world.add(dimianRoot);
  }

  private syncDimian02RoadTexture(source: THREE.Texture): void {
    if (this.dimian02RoadTex) this.dimian02RoadTex.dispose();
    this.dimian02RoadTex = source.clone();
    configureCombatRoadTextureWorldSpace(this.dimian02RoadTex);
    this.dimian02RoadTex.offset.copy(source.offset);
    if (this.dimian02Mat) {
      this.dimian02Mat.map = this.dimian02RoadTex;
      this.dimian02Mat.needsUpdate = true;
    }
    if (this.dimian02Mesh) {
      applyWorldSpaceRoadUvs(
        this.dimian02Mesh.geometry,
        COMBAT_ROAD_METERS_PER_TILE,
        getRoadTextureAspect(source),
      );
    }
  }

  private applyRoadTextureToDimian(tex: THREE.Texture): void {
    configureCombatRoadTexture(tex, undefined, DIMIAN01_WIDTH, DIMIAN01_DEPTH);
    if (this.dimian01Mat) {
      this.dimian01Mat.map = tex;
      this.dimian01Mat.needsUpdate = true;
    }
    this.syncDimian02RoadTexture(tex);
  }

  private loadCombatRoadTexture(): void {
    this.loader.load(
      texUrl(COMBAT_ROAD_TEXTURE),
      (tex) => {
        configureCombatRoadTexture(tex);
        this.roadTex.dispose();
        this.roadTex = tex;
        this.applyRoadTextureToDimian(tex);
      },
      undefined,
      () => {
        /* 加载失败时保留程序化路面 */
      },
    );
  }

  /** 建筑 spawn：按 footprint + 旋转贴路肩外侧，保证竖屏 FOV 内可见且不侵入主路 */
  private planBuildSpawns(
    count: number,
    sources: CombatScatterInstancedSource[],
    zSpacing: number,
    zStart: number,
    scaleMin: number,
    scaleRange: number,
    scaleMul: number,
  ): SideScatterSpawn[] {
    if (count <= 0 || !sources.length) return [];

    const spawns: SideScatterSpawn[] = [];
    for (let i = 0; i < count; i++) {
      const laneSide = pickSide(i);
      const variant = Math.floor(Math.random() * sources.length);
      const source = sources[variant]!;
      const rot = pickSideBuildYaw();
      const scale = (scaleMin + Math.random() * scaleRange) * scaleMul;
      const roadHalf = scatterRoadHalfWidthX(source, rot, scale);
      // 用完整 footprint，避免建筑侵入主路；再叠加外移随机量
      const placeHalf = Math.max(5, roadHalf * 0.92);
      const minAbsX = DIMIAN01_HALF_WIDTH + BUILD_ROAD_CLEAR_MARGIN + placeHalf;
      const outward = Math.random() * SIDE_BUILD_OUTWARD_SPREAD;
      spawns.push({
        variant,
        side: laneSide,
        baseX: laneSide * (minAbsX + outward),
        baseY: SIDE_BUILD_Y,
        scale,
        rot,
        z: zStart - i * zSpacing,
      });
    }
    return spawns;
  }

  /** 道具 spawn：按 footprint + 旋转计算 X，保证不侵入 dimian01 */
  private planPropSpawns(
    count: number,
    sources: CombatScatterInstancedSource[],
    zSpacing: number,
    zStart: number,
    scaleMin: number,
    scaleRange: number,
    scaleMul: number,
  ): SideScatterSpawn[] {
    if (count <= 0 || !sources.length) return [];

    const spawns: SideScatterSpawn[] = [];
    for (let i = 0; i < count; i++) {
      const laneSide = pickSide(i);
      const variant = Math.floor(Math.random() * sources.length);
      const source = sources[variant]!;
      const rot = pickSidePropYaw();
      const scale = (scaleMin + Math.random() * scaleRange) * scaleMul;
      const roadHalf = scatterRoadHalfWidthX(source, rot, scale);
      const minAbsX = DIMIAN01_HALF_WIDTH + PROP_ROAD_CLEAR_MARGIN + roadHalf;
      const outward = Math.random() * SIDE_PROP_OUTWARD_SPREAD;
      spawns.push({
        variant,
        side: laneSide,
        baseX: laneSide * (minAbsX + outward),
        baseY: SIDE_PROP_Y,
        scale,
        rot,
        z: zStart - i * zSpacing,
      });
    }
    return spawns;
  }

  private mountScatterLayers(
    sources: CombatScatterInstancedSource[],
    spawns: SideScatterSpawn[],
    material: THREE.MeshStandardMaterial,
  ): void {
    if (!sources.length || !spawns.length) return;

    const grouped = new Map<number, SideScatterSpawn[]>();
    for (const spawn of spawns) {
      const variant = Math.min(spawn.variant, sources.length - 1);
      const bucket = grouped.get(variant) ?? [];
      bucket.push({ ...spawn, variant });
      grouped.set(variant, bucket);
    }

    const dummy = this.sideScatterDummy;
    for (const [variant, bucket] of grouped) {
      const source = sources[variant];
      if (!source) continue;

      const mesh = new THREE.InstancedMesh(source.geometry, material, bucket.length);
      mesh.castShadow = false;
      mesh.receiveShadow = this.quality.shadowsEnabled;
      // InstancedMesh 默认包围球不含各实例位移，滚动中易被整体误剔除
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;

      const states: SideScatterState[] = [];
      for (let i = 0; i < bucket.length; i++) {
        const p = bucket[i];
        states.push({
          baseX: p.baseX,
          baseY: p.baseY,
          scale: p.scale,
          rot: p.rot,
          z: p.z,
        });
        dummy.position.set(p.baseX, p.baseY, p.z);
        dummy.rotation.y = p.rot;
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }

      mesh.instanceMatrix.needsUpdate = true;
      mesh.updateMatrix();
      this.world.add(mesh);
      this.sideScatterLayers.push({ mesh, states });
    }
  }

  private async buildSideScatter(): Promise<void> {
    try {
      const [buildSources, propSources] = await Promise.all([
        this.quality.sideBuildings > 0 ? warmupCombatBuildModels(this.quality) : Promise.resolve([]),
        this.quality.sideProps > 0 ? warmupCombatPropModels(this.quality) : Promise.resolve([]),
      ]);
      if (!buildSources.length && !propSources.length) return;

      const mat = getBuildSideMaterial(this.quality);
      const buildSpawns = this.planBuildSpawns(
        this.quality.sideBuildings,
        buildSources,
        SIDE_BUILD_Z_SPACING,
        -25,
        0.92,
        0.16,
        SIDE_BUILD_INSTANCE_SCALE,
      );
      const propSpawns = this.planPropSpawns(
        this.quality.sideProps,
        propSources,
        SIDE_PROP_Z_SPACING,
        -35,
        0.92,
        0.16,
        SIDE_PROP_INSTANCE_SCALE,
      );

      this.sideScatterLoopSpan = SIDE_BUILD_LOOP_SPAN;
      this.mountScatterLayers(buildSources, buildSpawns, mat);
      this.mountScatterLayers(propSources, propSpawns, mat);

      if (typeof window !== 'undefined') {
        const labels = [...buildSources, ...propSources].map((s) => s.label);
        console.info(
          `[combat-scatter] builds=${buildSpawns.length} props=${propSpawns.length} variants=${labels.join(',')}`,
        );
        (window as Window & { __combatScatterStats?: string }).__combatScatterStats =
          `build ${buildSpawns.length} · prop ${propSpawns.length}`;
      }
    } catch (err) {
      console.warn('[combat-scatter] side buildings/props failed', err);
    }
  }

  /** 两侧 2D 透明建筑面片（替换 3D build/props） */
  private async buildSideBillboards(): Promise<void> {
    const count = Math.max(20, (this.quality.sideBuildings + this.quality.sideProps) * SIDE_BILLBOARD_COUNT_MUL);
    try {
      const anisotropy = this.quality.quality === 'high' ? 4 : 2;
      const sources = await warmupCombatBillboards(this.theme.id, anisotropy);
      if (!sources.length) return;
      this.sideBillboardSources = sources;

      const group = new THREE.Group();
      group.name = 'side-billboards';

      for (let i = 0; i < count; i++) {
        const source = sources[Math.floor(Math.random() * sources.length)]!;
        // 左右岸随机，不再交替整齐排队
        const side = Math.random() < 0.5 ? -1 : 1;
        const halfW = source.def.targetHeight * SIDE_BILLBOARD_WIDTH_RATIO * source.aspect * 0.5;
        const minAbsX = DIMIAN01_HALF_WIDTH + SIDE_BILLBOARD_ROAD_CLEAR + halfW;
        const outward = Math.random() * SIDE_BILLBOARD_OUTWARD_SPREAD;
        const baseX = side * (minAbsX + outward);
        const scale = (0.88 + Math.random() * 0.34) * SIDE_BILLBOARD_SCALE_MUL;
        // 旋转保持：面向路心后再 +90°；去掉 yaw 抖动，避免方向漂移
        const faceYaw = (side < 0 ? Math.PI / 2 : -Math.PI / 2) + Math.PI / 2;
        // 沿循环带无规律随机 Z
        const z = -(SIDE_BILLBOARD_Z_NEAR + Math.random() * (SIDE_BILLBOARD_Z_FAR - SIDE_BILLBOARD_Z_NEAR));
        const baseY = SIDE_BILLBOARD_Y;

        // 每实例独立 material/geometry clone，避免 dispose 互相踩
        const mat = source.material.clone();
        mat.map = source.texture;
        const mesh = new THREE.Mesh(source.geometry, mat);
        mesh.name = `billboard-${source.def.id}-${i}`;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = true;
        mesh.renderOrder = 1;
        mesh.position.set(baseX, baseY, z);
        mesh.rotation.y = faceYaw;
        mesh.scale.setScalar(scale);
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = true;
        group.add(mesh);

        this.sideBillboards.push({
          mesh,
          baseX,
          baseY,
          scale,
          faceYaw,
          z,
        });
      }

      this.world.add(group);
      this.sideScatterLoopSpan = SIDE_BILLBOARD_LOOP_SPAN;

      if (typeof window !== 'undefined') {
        console.info(
          `[combat-billboards] theme=${this.theme.id} count=${this.sideBillboards.length} variants=${sources.length}`,
        );
        (window as Window & { __combatScatterStats?: string }).__combatScatterStats =
          `billboards ${this.sideBillboards.length}`;
      }
    } catch (err) {
      console.warn('[combat-billboards] failed, falling back to 3D scatter', err);
      if (this.quality.sideBuildings > 0 || this.quality.sideProps > 0) {
        void this.buildSideScatter();
      }
    }
  }

  update(delta: number, scrollSpeed: number): void {
    this.syncThemeBackdropsToCamera();
    if (scrollSpeed <= 0) return;
    this.scrollZ += scrollSpeed * delta;
    this.roadTex.offset.y = this.scrollZ * 0.04;
    if (this.dimian02RoadTex) {
      this.dimian02RoadTex.offset.y = this.roadTex.offset.y;
    }

    if (this.sideBillboards.length) {
      const loopSpan = this.sideScatterLoopSpan;
      for (const b of this.sideBillboards) {
        b.z += scrollSpeed * delta * 0.85;
        if (b.z > 22) b.z -= loopSpan;
        b.mesh.position.set(b.baseX, b.baseY, b.z);
        b.mesh.rotation.y = b.faceYaw;
        b.mesh.scale.setScalar(b.scale);
      }
    }

    if (this.sideScatterLayers.length) {
      const dummy = this.sideScatterDummy;
      const loopSpan = this.sideScatterLoopSpan;
      for (const layer of this.sideScatterLayers) {
        for (let i = 0; i < layer.states.length; i++) {
          const p = layer.states[i];
          p.z += scrollSpeed * delta * 0.85;
          if (p.z > 22) p.z -= loopSpan;
          dummy.position.set(p.baseX, p.baseY, p.z);
          dummy.rotation.y = p.rot;
          dummy.scale.setScalar(p.scale);
          dummy.updateMatrix();
          layer.mesh.setMatrixAt(i, dummy.matrix);
          this.sideScatterMatrixDirty = true;
        }
      }
      if (this.sideScatterMatrixDirty) {
        for (const layer of this.sideScatterLayers) {
          layer.mesh.instanceMatrix.needsUpdate = true;
        }
        this.sideScatterMatrixDirty = false;
      }
    }
  }

  /** 雷电 BOSS 关：冻结路面与侧景滚动 */
  freezeScroll(): void {
    this.scrollZ = 0;
    this.roadTex.offset.y = 0;
    if (this.dimian02RoadTex) {
      this.dimian02RoadTex.offset.y = 0;
    }
  }

  /** 人头校准：隐藏全部环境几何，只留角色精灵 */
  hideAllForHeadCalibrate(): void {
    this.world.visible = false;
    if (this.themeBackdropRoot) this.themeBackdropRoot.visible = false;
    for (const layer of this.sideScatterLayers) {
      layer.mesh.visible = false;
    }
    for (const b of this.sideBillboards) {
      b.mesh.visible = false;
    }
  }

  dispose(): void {
    this.roadTex.dispose();
    this.dimian02RoadTex?.dispose();
    this.dimian02RoadTex = null;
    if (this.themeBackdropRoot) {
      this.scene.remove(this.themeBackdropRoot);
      this.themeBackdropRoot.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m.dispose());
        }
      });
      this.themeBackdropRoot = null;
    }
    for (const t of this.themeBackdropTextures) t.dispose();
    this.themeBackdropTextures = [];

    // 先卸下 2D 面片，避免与共享 geometry/texture 被 traverse 重复 dispose
    const billboardRoot = this.world.getObjectByName('side-billboards');
    if (billboardRoot) this.world.remove(billboardRoot);
    for (const b of this.sideBillboards) {
      const mat = b.mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
    this.sideBillboards = [];
    const disposedGeo = new Set<THREE.BufferGeometry>();
    const disposedTex = new Set<THREE.Texture>();
    for (const src of this.sideBillboardSources) {
      if (!disposedGeo.has(src.geometry)) {
        src.geometry.dispose();
        disposedGeo.add(src.geometry);
      }
      if (!disposedTex.has(src.texture)) {
        src.texture.dispose();
        disposedTex.add(src.texture);
      }
      src.material.dispose();
    }
    this.sideBillboardSources = [];
    resetCombatBillboardWarmup();

    const floorMats = [this.dimian01Mat, this.dimian02Mat];
    this.dimian01Mat = null;
    this.dimian02Mat = null;
    this.dimian01Mesh = null;
    this.dimian02Mesh = null;
    this.world.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m: THREE.Material) => {
          if (floorMats.includes(m as THREE.MeshStandardMaterial)) return;
          m.dispose();
        });
      }
    });
    floorMats.forEach((m) => m?.dispose());
  }
}

export const LANE_X = [-2.05, 0, 2.05] as const;
export const PLAYER_Z = 8;
export const PLAYER_RENDER_Z = 30;
export const SPAWN_Z = -75;

/** 战斗相机：窄 FOV 偏正交；角色在镜头前约 8 单位，低机位仰视 */
export const COMBAT_CAMERA = {
  fov: 34,
  y: 4,
  z: 38,
  lookAtY: 5.5,
  lookAtZ: -30,
  pitchDeg: 5,
  near: 0.1,
  far: 360,
} as const;

/** 战斗主角立绘 — 按参考图屏幕比例定位（仅玩家，不影响敌人逻辑） */
export const COMBAT_PLAYER = {
  legacyHeightScreenRatio: 0.29,
  heightScreenRatio: 0.145,
  feetScreenRatio: 0.042,
  aspect: 0.69,
  groundClearanceRatio: 0.04,
  minGroundClearance: 0.16,
  maxGroundClearance: 0.24,
} as const;

export interface PlayerCombatLayout {
  x: number;
  y: number;
  renderZ: number;
  logicZ: number;
  scaleW: number;
  scaleH: number;
  anchorScaleH: number;
  groundY: number;
  groundClearance: number;
  legacyY: number;
  translateY: number;
  logicCameraDistance: number;
  renderCameraDistance: number;
}

const _footProj = new THREE.Vector3();

function getPlayerLayoutMode(): 'legacy' | 'grounded' {
  if (typeof window === 'undefined') return 'grounded';
  const mode = new URLSearchParams(window.location.search).get('debugLayout');
  return mode === 'legacy' ? 'legacy' : 'grounded';
}

export function billboardScale(z: number, cameraZ: number): number {
  const dist = Math.max(5, cameraZ - z);
  const refDist = 42;
  return refDist / dist;
}

export function worldYForScreenFooting(
  camera: THREE.PerspectiveCamera,
  x: number,
  z: number,
  feetFromBottom: number,
): number {
  camera.updateMatrixWorld(true);
  const targetNdcY = feetFromBottom * 2 - 1;
  let lo = -4;
  let hi = 12;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) * 0.5;
    _footProj.set(x, mid, z);
    _footProj.project(camera);
    if (_footProj.y > targetNdcY) hi = mid;
    else lo = mid;
  }
  return (lo + hi) * 0.5;
}

export function getPlayerCombatLayout(
  camera: THREE.PerspectiveCamera,
  lane: number,
  z: number = PLAYER_Z,
  mode?: 'legacy' | 'grounded',
): PlayerCombatLayout {
  const camZ = camera.position.z;
  const vFOV = (camera.fov * Math.PI) / 180;
  const x = LANE_X[lane];
  const logicDistance = Math.max(5, camZ - z);
  const logicViewH = 2 * Math.tan(vFOV / 2) * logicDistance;
  const groundY = roadY(z, camZ);
  const layoutMode = mode ?? getPlayerLayoutMode();
  const legacyY =
    layoutMode === 'legacy'
      ? worldYForScreenFooting(camera, x, z, COMBAT_PLAYER.feetScreenRatio)
      : groundY;
  const legacyScaleH = logicViewH * COMBAT_PLAYER.legacyHeightScreenRatio;
  const legacyScaleW = legacyScaleH * COMBAT_PLAYER.aspect;
  if (layoutMode === 'legacy') {
    return {
      x,
      y: legacyY,
      renderZ: z,
      logicZ: z,
      scaleW: legacyScaleW,
      scaleH: legacyScaleH,
      anchorScaleH: logicViewH * COMBAT_PLAYER.heightScreenRatio,
      groundY,
      groundClearance: legacyY - groundY,
      legacyY,
      translateY: 0,
      logicCameraDistance: logicDistance,
      renderCameraDistance: logicDistance,
    };
  }

  const anchorScaleH = logicViewH * COMBAT_PLAYER.heightScreenRatio;
  const renderZ = PLAYER_RENDER_Z;
  const renderDistance = Math.max(5, camZ - renderZ);
  const scaleH = anchorScaleH;
  const scaleW = scaleH * COMBAT_PLAYER.aspect;
  const groundClearance = THREE.MathUtils.clamp(
    anchorScaleH * COMBAT_PLAYER.groundClearanceRatio,
    COMBAT_PLAYER.minGroundClearance,
    COMBAT_PLAYER.maxGroundClearance,
  );
  const y = groundY + groundClearance;
  return {
    x,
    y,
    renderZ,
    logicZ: z,
    scaleW,
    scaleH,
    anchorScaleH,
    groundY,
    groundClearance,
    legacyY,
    translateY: y - legacyY,
    logicCameraDistance: logicDistance,
    renderCameraDistance: renderDistance,
  };
}

export function roadY(z: number, cameraZ: number): number {
  const t = Math.min(1, Math.max(0, (cameraZ - z) / 105));
  return 0.1 + t * 0.42;
}

export function applyCombatCameraAim(
  camera: THREE.PerspectiveCamera,
  rollZ = 0,
  lookAtX = 0,
): void {
  camera.lookAt(lookAtX, COMBAT_CAMERA.lookAtY, COMBAT_CAMERA.lookAtZ);
  camera.rotateX(THREE.MathUtils.degToRad(-COMBAT_CAMERA.pitchDeg));
  camera.rotateZ(rollZ);
}

export function setupCombatCamera(camera: THREE.PerspectiveCamera): void {
  camera.fov = COMBAT_CAMERA.fov;
  camera.near = COMBAT_CAMERA.near;
  camera.far = COMBAT_CAMERA.far;
  camera.position.set(0, COMBAT_CAMERA.y, COMBAT_CAMERA.z);
  applyCombatCameraAim(camera);
  camera.updateProjectionMatrix();
}
