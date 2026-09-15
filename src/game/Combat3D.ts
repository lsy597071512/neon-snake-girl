import * as THREE from 'three';
import type { StageDef } from '../types';
import { CHARACTER_MAP } from '../data/characters';
import { getSkillModifiers } from '../core/formulas';
import { computeCombatPassLimit } from './combatPassBudget';
import { mutateAiLiving } from '../ai/livingService';
import { applyCombatCyberHit } from '../systems/CyberHealthSystem';
import {
  WastelandEnvironment,
  LANE_X,
  PLAYER_Z,
  SPAWN_Z,
  COMBAT_CAMERA,
  billboardScale,
  roadY,
  setupCombatCamera,
  applyCombatCameraAim,
  getPlayerCombatLayout,
  type PlayerCombatLayout,
} from './WastelandEnvironment';
import {
  createEmojiTexture,
  createCombatBulletMesh,
  resetBulletTextureCache,
  getCombatEnemyTexture,
  type CombatEnemyKind,
} from './textureUtils';
import { getCombatPortraitSrc, getCombatModelSrc, getCombatShootIdleSrc } from '../ui/uiAssets';
import {
  createCombatLiveSprite,
  disposeCombatLiveSprite,
  liveSpriteScale,
  pauseCombatLiveSprites,
  waitCombatLiveReady,
} from './combatLiveLoader';
import { getCombatLiveHeadScaleMul } from './combatLiveHeadScale';
import { pickCombatEmotionSrc } from '../data/combatEmotionPoses';
import { getCombatVoLine } from '../data/combatVoiceLines';
import { playCombatVo, stopCombatVo } from '../audio/combatVo';
import { texUrl } from '../utils/texUrl';
import { showConfirm } from '../ui/confirmDialog';
import {
  cloneCombatModel,
  disposeCombatModelInstance,
  getCombatModelTemplate,
  type CombatModelMetrics,
} from './combatModelLoader';
import {
  cloneCombatEnemy,
  createCombatEnemyInstancedMesh,
  disposeCombatEnemyInstance,
  computeEnemyModelUniform,
  warmupCombatEnemyTemplate,
  COMBAT_ENEMY_YAW_BATTLE,
  COMBAT_ENEMY_SCALE_MULTIPLIER,
  type CombatEnemyMetrics,
  type CombatEnemyTemplate,
} from './combatEnemyLoader';
import { nextWaveAfterClear, shouldEndVictory } from './combatWaveLogic';
import { applyInteractiveHit, type CombatInteractiveState } from './combatInteractives';
import { getCombatQualityProfile, type CombatQualityProfile } from './combatQuality';
import { abbreviateRenderer, getWebGLCaps, refreshWebGLPageState } from './webglCaps';
import { getCombatTheme } from './combatThemes';
import { VfxPool } from './VfxPool';
import { CombatPostFX } from './CombatPostFX';
import { CombatFloatText } from './combatFloatText';
import { CombatEnemyHpBars } from './combatEnemyHpBars';
import {
  formationOffsetX,
  formationScaleMul,
  getShotLabel,
  getSquadSkillFxList,
  type SkillFxDef,
} from './combatSkillFx';
import { SkillFx3D } from './SkillFx3D';
import {
  combatHitDamage,
  COMBAT_HEALTH_MAX,
  HELL_APPROACH_MUL,
  HELL_SCROLL_MUL,
  waveEnemyCount,
} from './combatBalance';
import {
  bossProjectileDamage,
  pickRandomBossLane,
  raidBossAttackConfig,
  spawnBossProjectile,
  updateBossProjectiles,
  type BossProjectile3D,
} from './combatRaidBoss';
import { getCyberHealth, setCyberHealth } from '../systems/CyberHealthSystem';
import type { AiLivingSave } from '../ai/types';
import { playFireSfx, playHitSfx, playKillSfx, playShieldSfx, playSkillSfx, unlockCombatAudio } from '../audio/combatSfx';

export interface CombatSceneData {
  stage: StageDef;
  tcp: number;
  squadIds: string[];
  /** 每人弹幕基础伤害（已含战力/稀有度/职业） */
  squadDamage: Record<string, number>;
  autoMode: boolean;
  /** 开战前是否已通关（用于结算文案） */
  stageWasCleared?: boolean;
  /** 调试：绿幕测人头，隐藏场景并停刷怪 */
  headCalibrate?: boolean;
  onComplete: (result: { victory: boolean; kills: number; aborted?: boolean }) => void;
}

interface Entity3D {
  id: number;
  root: THREE.Group;
  visualKind: 'model' | 'sprite';
  lane: number;
  hp: number;
  maxHp: number;
  /** 敌人推进速度倍率（技能控制效果，默认 1） */
  slowMultiplier?: number;
  /** 控制效果结束时间（performance.now() 时间戳） */
  slowUntilMs?: number;
  boss?: boolean;
  active: boolean;
  hitHalfW: number;
  hitHalfD: number;
  centerY: number;
  instanceId?: number;
}

interface Bullet3D {
  mesh: THREE.Mesh;
  active: boolean;
  remainingHits: number;
  lane: number;
  /** 发射时世界 X，保持各角色枪口分离 */
  originX: number;
  /** 角色脚底相对路面的抬高（与立绘锚点一致） */
  feetOffset: number;
  logicZ: number;
  renderStartZ: number;
  targetZ: number;
  /** 弹幕显示名 */
  shotLabel: string;
  sourceCharId: string;
  /** 编队槽位 0/1/2，用于伤害飘字分色 */
  squadSlot: number;
  /** 本发弹幕伤害 */
  damage: number;
}

interface SquadWingUnit {
  charId: string;
  root: THREE.Group;
  visual: THREE.Object3D | null;
  visualKind: 'model' | 'sprite' | null;
  offsetX: number;
  scaleMul: number;
}

interface Interactive3D {
  sprite: THREE.Sprite;
  state: CombatInteractiveState;
}

export const COMBAT_CHARACTER_SCALE = 0.5;
const PLAYER_RENDER_LIFT = 1.2;
const BASE_CAMERA_Y = COMBAT_CAMERA.y;
const BASE_CAMERA_Z = COMBAT_CAMERA.z;
const BASE_FOV = COMBAT_CAMERA.fov;
const HIT_EMOTION_MS = 2000;
const HIT_EMOTION_FADE_MS = 280;

function formatTriangleCount(tris: number): string {
  if (tris >= 1_000_000) return `${(tris / 1_000_000).toFixed(2)}M`;
  if (tris >= 10_000) return `${Math.round(tris / 1000)}K`;
  if (tris >= 1000) return `${(tris / 1000).toFixed(1)}K`;
  return String(Math.round(tris));
}

const MAX_ENEMY_INSTANCES = 40;

export function computeBulletRenderZ(
  logicZ: number,
  renderStartZ: number,
  targetZ: number,
  originLogicZ: number = PLAYER_Z - 1,
): number {
  const totalDistance = Math.max(1, originLogicZ - targetZ);
  const traveled = Math.max(0, originLogicZ - logicZ);
  const progress = Math.min(1, traveled / totalDistance);
  const alignedRenderZ = THREE.MathUtils.lerp(renderStartZ, targetZ, progress);
  if (progress < 1) return alignedRenderZ;
  return targetZ - (traveled - totalDistance);
}

export class Combat3D {
  private readonly parent: HTMLElement;
  private readonly data: CombatSceneData;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private env!: WastelandEnvironment;
  private hudEl!: HTMLDivElement;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private qualityProfile!: CombatQualityProfile;
  private vfx!: VfxPool;
  /** 角色技能 3D 几何包装层（Cylinder/Torus/Sphere 几何外壳，与 Sprite 主光效并行） */
  private skillFx3D!: SkillFx3D;
  private postFx!: CombatPostFX;

  private laneIndex = 1;
  private playerRoot = new THREE.Group();
  private playerVisual: THREE.Object3D | null = null;
  private playerVisualKind: 'model' | 'sprite' | null = null;
  private leadCharId = 'ashcrow';
  private readonly squadWings: SquadWingUnit[] = [];
  private floatText: CombatFloatText | null = null;
  private enemyHpBars: CombatEnemyHpBars | null = null;
  private activeSkillFx: SkillFxDef[] = [];
  private skillPulseTimers = new Map<string, number>();
  private skillAnnounceDone = false;
  private lastShieldFloatMs = 0;
  private hurtFlashToken = 0;
  private hurtMaterialBackup: Array<{
    mat: { color: THREE.Color; emissive?: THREE.Color };
    color: THREE.Color;
    emissive?: THREE.Color;
  }> = [];
  private playerBaseScale = { w: 4.03, h: 5.43 };
  private enemies: Entity3D[] = [];
  private bullets: Bullet3D[] = [];
  private interactives: Interactive3D[] = [];
  private nextEntityId = 1;
  private enemyTemplate: CombatEnemyTemplate | null = null;
  private enemyInstancedMesh: THREE.InstancedMesh | null = null;
  private enemyInstanceLive = 0;
  private enemyInstanceMatrixDirty = false;
  private aliveEnemyCount = 0;
  private readonly enemyFreeInstanceIds: number[] = [];
  private readonly enemyInstanceDummy = new THREE.Object3D();
  private lastDebugPerfMark = 0;

  private kills = 0;
  private timeLeft = 0;
  private wave = 1;
  private maxWaves = 0;
  private pendingSpawns = 0;
  private everSpawned = false;
  private fireTimer = 0;
  private passCount = 0;
  /** 允许通过上限；超过才判负 */
  private passLimit = 5;
  private comboKills = 0;
  private tripleCooldown = 0;
  private ironRainTimer = 0;
  private finished = false;
  private skillMods = getSkillModifiers([]);
  private scrollSpeed = 6;

  private shakeAmount = 0;
  /** 屏幕震动分级（0..1），用于调整 fov 与 y 抖动强度，让 Boss/暴击感觉更"重" */
  private shakeIntensity = 0;
  private targetLaneLean = 0;
  private laneLean = 0;
  private cameraFollowX = 0;
  private fovPulse = 0;
  /**
   * 命中减速（hit-stop / time-freeze）：>0 时 dt 被乘以 <1 的系数，让被击中瞬间画面短促停顿。
   * 单位：秒；典型 0.04~0.08。0 = 无效。
   */
  private hitLag = 0;
  /** 当前累计时间倍率（hit-lag 期间 dt 会变慢） */
  private currentTimeScale = 1;
  private dustSpawnTimer = 0;

  private timerEl!: HTMLElement;
  private passEl!: HTMLElement;
  private infoEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private hitEmotionEl: HTMLDivElement | null = null;
  private hitEmotionTimer = 0;
  /** P2：技能横幅 / 受击 vignette / 暴击闪光 */
  private skillBannerEl: HTMLElement | null = null;
  private skillBannerTimer: number | null = null;
  private vignetteEl: HTMLElement | null = null;
  private vignetteTimer: number | null = null;
  private critFlashEl: HTMLElement | null = null;
  private critFlashTimer: number | null = null;
  private fpsFrames = 0;
  private fpsAccumMs = 0;
  private readonly webglCaps = getWebGLCaps();
  private readonly debugLayoutHud: boolean;
  private cachedPlayerLayout: PlayerCombatLayout | null = null;
  private cachedPlayerLayoutLane = -1;
  private lastTimerHud = '';
  private lastPassHud = '';
  private onResize!: () => void;
  private spawnTimers: ReturnType<typeof setTimeout>[] = [];
  private headCalDirectRender = false;
  private readonly raidBossMode: boolean;
  private bossProjectiles: BossProjectile3D[] = [];
  private bossAttackTimer = 0;
  private bossBobPhase = 0;
  private raidBossEntity: Entity3D | null = null;
  private readonly combatHp: Record<string, number> = {};
  private healthEl!: HTMLElement;
  private bossHpEl: HTMLElement | null = null;
  private raidBossAttackCfg = { intervalSec: 1.35, telegraphSec: 0.88, projectileSpeed: 9.2 };

  constructor(parent: HTMLElement, data: CombatSceneData) {
    this.parent = parent;
    this.data = data;
    this.raidBossMode = data.stage.combatMode === 'raidBoss';
    this.debugLayoutHud =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('debugLayout');
  }

  start(): void {
    this.parent.innerHTML = '';
    this.initThree();
    this.initGameState();
    this.initHUD();
    this.setupInput();
    this.clock.start();
    this.lastDebugPerfMark = performance.now();
    this.animate();
    // 解锁战斗 WebAudio（必须在 start 后调用，否则安卓 WebView 会静默）
    unlockCombatAudio();
    if (this.data.headCalibrate) {
      this.setupHeadCalibrateMode();
      return;
    }
    void this.beginSpawns();
  }

  /** 绿幕校准：停战斗、藏场景，等 WebM 就绪后标记 window */
  private setupHeadCalibrateMode(): void {
    this.finished = true;
    this.scrollSpeed = 0;
    this.env.hideAllForHeadCalibrate();
    this.scene.background = new THREE.Color(0x00b140);
    this.scene.fog = null;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.headCalDirectRender = true;
    this.hudEl.style.visibility = 'hidden';
    if (this.hitEmotionEl) this.hitEmotionEl.hidden = true;
    this.parent.dataset.headCalReady = '0';

    const markReady = () => {
      const w = window as Window & {
        __combatHeadCal?: { ready: boolean; charId: string; scaleY: number };
      };
      this.updatePlayerTransform();
      const scaleY =
        this.playerVisualKind === 'sprite' && this.playerVisual
          ? (this.playerVisual as THREE.Sprite).scale.y
          : 0;
      w.__combatHeadCal = { ready: true, charId: this.leadCharId, scaleY };
      this.parent.dataset.headCalReady = '1';
      this.parent.dataset.headCalChar = this.leadCharId;
    };

    const started = performance.now();
    const poll = () => {
      if (this.disposed) return;
      const live = this.playerVisual as THREE.Sprite | null;
      const isLive = !!(live?.userData.combatLiveAspect && live.userData.combatLiveVideo);
      if (isLive) {
        void waitCombatLiveReady(live!, 12000).then(() => {
          if (this.disposed) return;
          requestAnimationFrame(() => requestAnimationFrame(markReady));
        });
        return;
      }
      if (performance.now() - started > 15000) {
        markReady();
        return;
      }
      window.setTimeout(poll, 100);
    };
    poll();
  }

  /** 
   * 渐进式加载：先加载核心资源快速进入战斗，装饰资源后台加载
   * 优化前：同步等待所有资源(8-12秒) → 开始战斗
   * 优化后：核心资源(1-2秒) → 开始战斗 → 后台加载装饰(无感)
   */
  private async beginSpawns(): Promise<void> {
    // 第一阶段：核心资源(必须，阻塞战斗开始)
    try {
      const template = await warmupCombatEnemyTemplate(this.qualityProfile);
      if (this.disposed) return;
      this.enemyTemplate = template;
      this.setupEnemyInstancing(template);
      this.upgradeSpriteEnemiesToModels();
    } catch {
      /* 加载失败时 createEnemyEntity 仍走 Sprite 兜底 */
    }
    
    if (this.disposed) return;
    
    // 立即开始战斗！(不等billboard/build/props加载完成)
    if (this.raidBossMode) {
      this.spawnRaidBoss();
    } else {
      this.spawnWave();
      if (this.data.stage.type === 'door') this.spawnDoors();
      if (this.data.stage.type === 'barrel') this.spawnBarrels();
    }
    
    // 第二阶段：装饰资源(可选，后台异步加载，不阻塞玩法)
    // 建筑/道具会在加载完成后自动淡入场景
    this.loadDecorativeAssetsAsync();
  }

  /**
   * 后台异步加载装饰资源(billboard/建筑/道具)
   * 加载完成后直接添加到场景，不影响正在进行的战斗
   */
  private loadDecorativeAssetsAsync(): void {
    // 注意：env.buildSideScatter 和 env.buildSideBillboards 
    // 已在 WastelandEnvironment 构造时调用，此处无需重复
    // 这里只是一个占位，表明装饰加载策略
    
    // 如果需要进一步优化，可以将 WastelandEnvironment 的装饰资源
    // 延迟到战斗开始后再加载，但当前架构已经在构造时异步处理了
  }

  private initThree(): void {
    const { squadIds, stage } = this.data;
    this.qualityProfile = getCombatQualityProfile();
    this.parent.dataset.combatQuality = this.qualityProfile.quality;
    this.parent.dataset.combatBuild = 'sky120-dimian02-wsuv';
    resetBulletTextureCache();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      COMBAT_CAMERA.fov,
      720 / 1280,
      COMBAT_CAMERA.near,
      COMBAT_CAMERA.far,
    );
    setupCombatCamera(this.camera);

    this.env = new WastelandEnvironment(this.scene, this.camera, {
      chapter: stage.chapter,
      stageId: stage.id,
      quality: this.qualityProfile,
    });

    const theme = getCombatTheme(stage.chapter);
    this.vfx = new VfxPool(this.scene, this.qualityProfile, theme);
    this.skillFx3D = new SkillFx3D(this.scene);
    if (this.qualityProfile.ambientDust > 0) {
      this.vfx.spawnAmbientDust(Math.min(12, this.qualityProfile.ambientDust));
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.qualityProfile.quality !== 'low',
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.info.autoReset = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.qualityProfile.maxPixelRatio));
    this.renderer.shadowMap.enabled = this.qualityProfile.shadowsEnabled;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.qualityProfile.quality === 'high' ? 1.12 : 1.06;
    this.renderer.domElement.className = 'combat-canvas';
    this.parent.appendChild(this.renderer.domElement);

    this.postFx = new CombatPostFX(this.renderer, this.scene, this.camera, this.qualityProfile);

    this.onResize = () => {
      const w = this.parent.clientWidth || 720;
      const h = this.parent.clientHeight || 1280;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
      this.postFx.setSize(w, h);
    };
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('scroll', this.onResize);
    this.onResize();

    const leadId = squadIds[0] ?? 'ashcrow';
    this.leadCharId = leadId;
    this.laneIndex = 1;
    const leadChar = CHARACTER_MAP[leadId];
    this.scene.add(this.playerRoot);
    this.updatePlayerTransform();
    void this.loadPlayerVisual(leadId, leadChar);
    this.spawnSquadWings(squadIds);

    this.floatText = new CombatFloatText(this.parent, this.camera);
    this.enemyHpBars = new CombatEnemyHpBars(this.parent, this.camera);
    this.activeSkillFx = getSquadSkillFxList(squadIds);
    for (const fx of this.activeSkillFx) {
      if (fx.pulseInterval > 0) this.skillPulseTimers.set(fx.id, fx.pulseInterval * 0.35);
    }

    this.scrollSpeed = stage.isBoss && !this.raidBossMode ? 5 : this.raidBossMode ? 0 : 7;
    if (stage.mode === 'hell' && !this.raidBossMode) {
      this.scrollSpeed *= HELL_SCROLL_MUL;
    }
    if (this.raidBossMode) {
      this.env.freezeScroll();
    }

    this.parent.dataset.enemyYawDeg = String(Math.round((COMBAT_ENEMY_YAW_BATTLE * 180) / Math.PI));
    this.parent.dataset.enemyScaleMul = String(COMBAT_ENEMY_SCALE_MULTIPLIER);
    void warmupCombatEnemyTemplate(this.qualityProfile)
      .then((template) => {
        if (this.disposed) return;
        this.enemyTemplate = template;
        this.upgradeSpriteEnemiesToModels();
      })
      .catch(() => {});
  }

  private async loadPlayerVisual(charId: string, char: (typeof CHARACTER_MAP)[string]): Promise<void> {
    this.attachPlayerSpriteFallback(charId, char);

    const liveSrc = getCombatShootIdleSrc(charId);
    if (liveSrc) {
      const live = createCombatLiveSprite(liveSrc, this.playerBaseScale.h);
      const ok = await waitCombatLiveReady(live);
      if (this.disposed) {
        disposeCombatLiveSprite(live);
        return;
      }
      if (ok) {
        this.setPlayerSprite(live);
        this.parent.dataset.playerVisual = 'live';
        return;
      }
      disposeCombatLiveSprite(live);
    }

    const modelSrc = getCombatModelSrc(charId);
    if (!modelSrc) return;

    try {
      const template = await getCombatModelTemplate(modelSrc, this.qualityProfile);
      if (this.disposed) return;
      this.setPlayerModel(cloneCombatModel(template));
    } catch {
      /* 保持立绘面片 */
    }
  }

  /** 关卡可上场多人时，除队长外生成翼机视觉体 */
  private spawnSquadWings(squadIds: string[]): void {
    const total = Math.max(1, squadIds.length);
    for (let i = 1; i < squadIds.length; i++) {
      const charId = squadIds[i];
      const root = new THREE.Group();
      this.scene.add(root);
      const wing: SquadWingUnit = {
        charId,
        root,
        visual: null,
        visualKind: null,
        offsetX: formationOffsetX(i, total),
        scaleMul: formationScaleMul(i, total),
      };
      this.squadWings.push(wing);
      void this.loadWingVisual(wing);
    }
  }

  private async loadWingVisual(wing: SquadWingUnit): Promise<void> {
    const char = CHARACTER_MAP[wing.charId];
    if (!char) return;

    const combatPortrait = getCombatPortraitSrc(wing.charId);
    if (combatPortrait) {
      const sprite = this.makeImageSprite(combatPortrait, this.playerBaseScale.w, this.playerBaseScale.h);
      sprite.center.set(0.5, 0);
      wing.visual = sprite;
      wing.visualKind = 'sprite';
      wing.root.add(sprite);
    } else {
      const sprite = this.makeSprite(char.icon, '#1a4060', '#2ecbff', this.playerBaseScale.w, this.playerBaseScale.h);
      sprite.center.set(0.5, 0);
      wing.visual = sprite;
      wing.visualKind = 'sprite';
      wing.root.add(sprite);
    }

    const liveSrc = getCombatShootIdleSrc(wing.charId);
    if (liveSrc) {
      const live = createCombatLiveSprite(liveSrc, this.playerBaseScale.h);
      const ok = await waitCombatLiveReady(live);
      if (this.disposed) {
        disposeCombatLiveSprite(live);
        return;
      }
      if (ok) {
        if (wing.visualKind === 'sprite' && wing.visual) {
          this.disposeSprite(wing.visual as THREE.Sprite);
          wing.root.remove(wing.visual);
        }
        live.center.set(0.5, 0);
        wing.visual = live;
        wing.visualKind = 'sprite';
        wing.root.add(live);
        this.updateSquadWingTransforms();
        return;
      }
      disposeCombatLiveSprite(live);
    }

    const modelSrc = getCombatModelSrc(wing.charId);
    if (!modelSrc) {
      this.updateSquadWingTransforms();
      return;
    }
    try {
      const template = await getCombatModelTemplate(modelSrc, this.qualityProfile);
      if (this.disposed) return;
      if (wing.visualKind === 'sprite' && wing.visual) {
        this.disposeSprite(wing.visual as THREE.Sprite);
        wing.root.remove(wing.visual);
      }
      const model = cloneCombatModel(template);
      wing.visual = model;
      wing.visualKind = 'model';
      wing.root.add(model);
      this.updateSquadWingTransforms();
    } catch {
      this.updateSquadWingTransforms();
    }
  }

  private updateSquadWingTransforms(): void {
    const layout = this.getPlayerLayout();
    const renderLift = PLAYER_RENDER_LIFT;
    const baseScaleH = layout.scaleH * COMBAT_CHARACTER_SCALE;
    const baseScaleW = layout.scaleW * COMBAT_CHARACTER_SCALE;

    for (const wing of this.squadWings) {
      wing.root.position.set(
        this.cameraFollowX + wing.offsetX,
        layout.y + renderLift,
        layout.renderZ + 0.35,
      );
      const scaleH = baseScaleH * wing.scaleMul;
      const scaleW = baseScaleW * wing.scaleMul;
      if (wing.visualKind === 'model' && wing.visual) {
        const metrics = (wing.visual.userData.combatMetrics as CombatModelMetrics | undefined) ?? null;
        if (metrics) {
          const uniform = Math.min(scaleH / metrics.height, scaleW / metrics.width);
          wing.visual.scale.setScalar(uniform);
        }
      } else if (wing.visualKind === 'sprite' && wing.visual) {
        if (wing.visual.userData.combatLiveAspect) {
          const headMul = getCombatLiveHeadScaleMul(wing.charId);
          const live = liveSpriteScale(baseScaleH, wing.visual, headMul);
          (wing.visual as THREE.Sprite).scale.set(live.w, live.h, 1);
        } else {
          (wing.visual as THREE.Sprite).scale.set(scaleW, scaleH, 1);
        }
      }
    }
  }

  private getWingMuzzleY(wing: SquadWingUnit): number {
    if (wing.visualKind === 'model' && wing.visual) {
      const metrics = (wing.visual.userData.combatMetrics as CombatModelMetrics | undefined) ?? null;
      if (metrics) {
        return wing.root.position.y + metrics.muzzleY * wing.visual.scale.y;
      }
    }
    const crouchMul = wing.visual?.userData.combatLiveAspect ? 0.58 : 0.72;
    const headMul = wing.visual?.userData.combatLiveAspect
      ? getCombatLiveHeadScaleMul(wing.charId)
      : 1;
    return wing.root.position.y + this.getPlayerLayout().scaleH * COMBAT_CHARACTER_SCALE * headMul * crouchMul;
  }

  private attachPlayerSpriteFallback(charId: string, char: (typeof CHARACTER_MAP)[string]): void {
    const combatPortrait = getCombatPortraitSrc(charId);
    if (combatPortrait) {
      this.setPlayerSprite(this.makeImageSprite(combatPortrait, this.playerBaseScale.w, this.playerBaseScale.h));
    } else {
      this.setPlayerSprite(this.makeSprite(char.icon, '#1a4060', '#2ecbff', this.playerBaseScale.w, this.playerBaseScale.h));
    }
  }

  private clearPlayerVisual(): void {
    if (!this.playerVisual) return;
    if (this.playerVisualKind === 'sprite') {
      this.disposeSprite(this.playerVisual as THREE.Sprite);
    } else if (this.playerVisualKind === 'model') {
      disposeCombatModelInstance(this.playerVisual as THREE.Group);
    }
    this.playerRoot.remove(this.playerVisual);
    this.playerVisual = null;
    this.playerVisualKind = null;
  }

  private setPlayerModel(model: THREE.Group): void {
    this.clearPlayerVisual();
    this.playerVisual = model;
    this.playerVisualKind = 'model';
    this.playerRoot.add(model);
    this.parent.dataset.playerVisual = 'model';
    this.updatePlayerTransform();
  }

  private setPlayerSprite(sprite: THREE.Sprite): void {
    this.clearPlayerVisual();
    sprite.center.set(0.5, 0);
    this.playerVisual = sprite;
    this.playerVisualKind = 'sprite';
    this.playerRoot.add(sprite);
    this.parent.dataset.playerVisual = 'sprite';
    this.updatePlayerTransform();
  }

  private getPlayerMetrics(): CombatModelMetrics | null {
    if (this.playerVisualKind !== 'model' || !this.playerVisual) return null;
    return (this.playerVisual.userData.combatMetrics as CombatModelMetrics | undefined) ?? null;
  }

  private getPlayerRenderHeight(): number {
    const layout = getPlayerCombatLayout(this.camera, this.laneIndex, PLAYER_Z);
    if (this.playerVisualKind === 'model') {
      const metrics = this.getPlayerMetrics();
      if (metrics) {
        const scaleH = layout.scaleH * COMBAT_CHARACTER_SCALE;
        const scaleW = layout.scaleW * COMBAT_CHARACTER_SCALE;
        const scale = Math.min(scaleH / metrics.height, scaleW / metrics.width);
        return metrics.height * scale;
      }
    }
    const base = layout.scaleH * COMBAT_CHARACTER_SCALE;
    if (this.playerVisual?.userData.combatLiveAspect) {
      return base * getCombatLiveHeadScaleMul(this.leadCharId);
    }
    return base;
  }

  private getPlayerMuzzleY(): number {
    const metrics = this.getPlayerMetrics();
    if (metrics && this.playerVisual) {
      return this.playerRoot.position.y + metrics.muzzleY * this.playerVisual.scale.y;
    }
    const crouchMul = this.playerVisual?.userData.combatLiveAspect ? 0.58 : 0.72;
    return this.playerRoot.position.y + this.getPlayerRenderHeight() * crouchMul;
  }

  private initHUD(): void {
    const { stage, tcp, autoMode, squadIds } = this.data;
    this.hudEl = document.createElement('div');
    this.hudEl.className = 'combat-hud';
    this.hudEl.innerHTML = `
      <div class="combat-fps-debug" data-hud="fps">FPS -- · -- TRI · ${this.qualityProfile.quality.toUpperCase()}</div>
      <div class="combat-hud-top">
        <div class="combat-hud-left">
          <div class="combat-timer" data-hud="timer">⏱ ${stage.timer}s</div>
          <div class="combat-pass" data-hud="pass">通过 0/0</div>
          <div class="combat-wave" data-hud="wave">波次 1/${stage.waves}</div>
        </div>
        <div class="combat-stage" data-hud="info">${stage.name}</div>
        <div class="combat-tcp">TCP ${tcp}</div>
      </div>
      <div class="combat-squad-badge" data-hud="squad">上场 ${squadIds.length} 人</div>
      <div class="combat-health" data-hud="health">义体 ${this.formatSquadHealthHud()}</div>
      ${this.raidBossMode ? '<div class="combat-boss-hp" data-hud="boss-hp">BOSS --%</div>' : ''}
      <div class="combat-hint">◀ 左半屏换道 &nbsp;|&nbsp; 右半屏换道 ▶</div>
      <div class="combat-emotion combat-emotion--hit" data-combat-emotion-hit hidden>
        <img alt="" />
        <span class="combat-vo-line" data-combat-vo-hit hidden></span>
      </div>
      <button class="combat-exit-btn" data-combat-exit type="button" aria-label="退出关卡">退出</button>
      <!-- P2：技能触发横幅（替代原 showSkillBanner 空实现） -->
      <div class="combat-skill-banner-v2" data-skill-banner aria-hidden="true">
        <strong data-skill-banner-title></strong>
        <span data-skill-banner-detail></span>
      </div>
      <!-- P2：受击 / 暴击全屏震动层（CSS-driven vignette flash） -->
      <div class="combat-vignette" data-combat-vignette aria-hidden="true"></div>
      <div class="combat-crit-flash" data-combat-crit-flash aria-hidden="true"></div>
    `;
    this.parent.appendChild(this.hudEl);

    this.timerEl = this.hudEl.querySelector('[data-hud="timer"]')!;
    this.passEl = this.hudEl.querySelector('[data-hud="pass"]')!;
    this.infoEl = this.hudEl.querySelector('[data-hud="info"]')!;
    this.fpsEl = this.hudEl.querySelector('[data-hud="fps"]')!;
    this.hitEmotionEl = this.hudEl.querySelector('[data-combat-emotion-hit]');
    this.healthEl = this.hudEl.querySelector('[data-hud="health"]')!;
    this.bossHpEl = this.hudEl.querySelector('[data-hud="boss-hp"]');
    this.skillBannerEl = this.hudEl.querySelector<HTMLElement>('[data-skill-banner]');
    this.vignetteEl = this.hudEl.querySelector<HTMLElement>('[data-combat-vignette]');
    this.critFlashEl = this.hudEl.querySelector<HTMLElement>('[data-combat-crit-flash]');

    this.hudEl.querySelector('[data-combat-exit]')?.addEventListener('click', () => this.abortCombat());

    if (autoMode) {
      this.infoEl.textContent = `${stage.name} [自动]`;
      this.infoEl.classList.add('auto');
    }
  }

  /** P2：受击 vignette 闪（CSS 触发，0.2s 自动消失） */
  private triggerVignette(): void {
    if (!this.vignetteEl) return;
    this.vignetteEl.classList.remove('is-show');
    void this.vignetteEl.offsetWidth;
    this.vignetteEl.classList.add('is-show');
    this.vignetteTimer = window.setTimeout(() => {
      this.vignetteEl?.classList.remove('is-show');
    }, 220);
  }

  /** P2+：暴击 / boss 击杀全屏闪光 —— **已完全移除**。
   *  用户反馈"一闪而过的特效全部移除" —— 这里直接 no-op。
   *  保留方法签名便于未来想恢复。triggerCritFlash 不再触发任何 CSS 类，
   *  crit-flash DOM 元素保留（不破坏查询），但永不点亮。
   *  击杀震感由 screenShake + kill burst sprite + 数字飘字共同承担，已足够。 */
  private triggerCritFlash(): void {
    void this.critFlashEl; // 故意空操作
  }

  private initGameState(): void {
    const { stage, tcp, squadIds, squadDamage } = this.data;
    this.skillMods = getSkillModifiers(squadIds);
    const dmgValues = squadIds.map((id) => squadDamage[id] ?? 1);
    const avgShotDamage =
      dmgValues.length > 0 ? dmgValues.reduce((a, b) => a + b, 0) / dmgValues.length : 1;

    this.initCombatHealth(squadIds);

    if (this.raidBossMode) {
      this.raidBossAttackCfg = raidBossAttackConfig(stage);
      this.bossAttackTimer = 0.23;
      this.timeLeft = stage.timer;
      this.maxWaves = 1;
      this.wave = 1;
      this.passLimit = 999;
      return;
    }

    this.passLimit = computeCombatPassLimit({
      stageId: stage.id,
      waves: stage.waves,
      isBoss: stage.isBoss,
      enemyDamage: stage.enemyDamage,
      recommendedTcp: stage.recommendedTcp,
      tcp,
      shieldBonus: this.skillMods.shieldBonus,
      attackSpeedBonus: this.skillMods.attackSpeedBonus,
      projectilePierce: this.skillMods.projectilePierce,
      ironRainEnabled: this.skillMods.ironRainEnabled,
      squadSize: squadIds.length,
      avgShotDamage,
    });
    this.passCount = 0;
    this.timeLeft = stage.timer;
    this.maxWaves = stage.waves;
    this.wave = 1;
  }

  private getLeadFormationOffsetX(): number {
    return formationOffsetX(0, Math.max(1, this.data.squadIds.length));
  }

  private applyCameraEffects(dt: number): void {
    const targetX = LANE_X[this.laneIndex];
    const moveT = 1 - Math.exp(-9.5 * dt);
    const leanInT = 1 - Math.exp(-2.0 * dt);
    const leanOutT = 1 - Math.exp(-1.35 * dt);
    this.cameraFollowX = THREE.MathUtils.lerp(this.cameraFollowX, targetX, moveT);
    this.playerRoot.position.x = this.cameraFollowX + this.getLeadFormationOffsetX();
    for (const wing of this.squadWings) {
      wing.root.position.x = this.cameraFollowX + wing.offsetX;
    }

    // shakeAmount 衰减（用 hitLag 期间的真实 dt；hitLag 由外层循环乘到 dt 上）
    if (this.shakeAmount > 0) {
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 6);
    }
    if (this.shakeIntensity > 0) {
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 4);
    }
    // 速度越快 = 抖动越剧烈；shaker 通过 shakeAmount（衰减）* shakeIntensity（可叠加）
    const shakeMag = Math.min(0.45, this.shakeAmount * (1 + this.shakeIntensity));
    if (shakeMag > 0.0001) {
      const t = Date.now() * 0.001;
      this.camera.position.x = this.cameraFollowX + Math.sin(t * 70) * shakeMag * 0.45;
      this.camera.position.y =
        BASE_CAMERA_Y +
        Math.sin(t * 90) * shakeMag * 0.25 +
        Math.sin(t * 1.8) * 0.03;
      this.camera.position.z =
        BASE_CAMERA_Z + Math.sin(t * 110) * shakeMag * 0.18;
    } else {
      this.camera.position.x = this.cameraFollowX;
      this.camera.position.y = BASE_CAMERA_Y + Math.sin(Date.now() * 0.0018) * 0.03;
      this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, BASE_CAMERA_Z, 0.12);
    }

    this.laneLean = THREE.MathUtils.lerp(this.laneLean, this.targetLaneLean, leanInT);
    applyCombatCameraAim(this.camera, this.laneLean, this.cameraFollowX);
    this.targetLaneLean = THREE.MathUtils.lerp(this.targetLaneLean, 0, leanOutT);

    if (this.fovPulse > 0) {
      this.fovPulse = Math.max(0, this.fovPulse - dt * 1.4);
      // 命中冲击时给个近距推近（仅 fov 改变，不调 position），让"被怼一下"有体感
      this.camera.fov = BASE_FOV - this.fovPulse * 4.5;
      this.camera.updateProjectionMatrix();
    } else if (this.camera.fov !== BASE_FOV) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, BASE_FOV, 0.12);
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * 触发屏幕冲击（命中/暴击/重型技能）。
   * shakeAmount 计入 camera-shake 衰减；shakeIntensity 是叠加态（重型）/fovPulse 推送近距。
   * hitLagSeconds > 0 启用短促减速（hit-stop）；0.04~0.08 区间体验最好。
   */
  private triggerScreenShake(opts: {
    shake: number;
    intensity?: number;
    fov?: number;
    hitLagSeconds?: number;
  }): void {
    this.shakeAmount = Math.max(this.shakeAmount, opts.shake);
    if (opts.intensity) {
      this.shakeIntensity = Math.max(this.shakeIntensity, opts.intensity);
    }
    if (opts.fov) this.fovPulse = Math.max(this.fovPulse, opts.fov);
    if (opts.hitLagSeconds && opts.hitLagSeconds > 0) {
      this.hitLag = Math.max(this.hitLag, opts.hitLagSeconds);
    }
  }

  private setupEnemyInstancing(template: CombatEnemyTemplate): void {
    if (this.enemyInstancedMesh) return;

    this.enemyInstancedMesh = createCombatEnemyInstancedMesh(template, this.qualityProfile, MAX_ENEMY_INSTANCES);
    this.enemyInstanceDummy.position.set(0, -9999, 0);
    this.enemyInstanceDummy.scale.setScalar(0);
    this.enemyInstanceDummy.updateMatrix();
    for (let i = 0; i < MAX_ENEMY_INSTANCES; i++) {
      this.enemyInstancedMesh.setMatrixAt(i, this.enemyInstanceDummy.matrix);
    }
    this.enemyInstancedMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.enemyInstancedMesh);
  }

  private allocateEnemyInstanceId(): number {
    if (this.enemyFreeInstanceIds.length) return this.enemyFreeInstanceIds.pop()!;
    const id = this.enemyInstanceLive;
    if (id >= MAX_ENEMY_INSTANCES) return MAX_ENEMY_INSTANCES - 1;
    this.enemyInstanceLive += 1;
    if (this.enemyInstancedMesh) this.enemyInstancedMesh.count = this.enemyInstanceLive;
    return id;
  }

  private releaseEnemyInstanceId(id: number): void {
    if (!this.enemyInstancedMesh) return;
    this.enemyInstanceDummy.position.set(0, -9999, 0);
    this.enemyInstanceDummy.scale.setScalar(0);
    this.enemyInstanceDummy.updateMatrix();
    this.enemyInstancedMesh.setMatrixAt(id, this.enemyInstanceDummy.matrix);
    this.enemyInstanceMatrixDirty = true;
    this.enemyFreeInstanceIds.push(id);
  }

  private updateEnemyTransform(entity: Entity3D, lane: number, z: number): void {
    const camZ = this.camera.position.z;
    const gy = roadY(z, camZ);
    entity.root.position.set(LANE_X[lane], gy, z);

    if (entity.visualKind === 'model') {
      const metrics = (entity.root.userData.combatMetrics as CombatEnemyMetrics | undefined) ?? {
        height: 1,
        width: 1,
        depth: 1,
      };
      const uniform = computeEnemyModelUniform(metrics, !!entity.boss);
      entity.hitHalfW = Math.max(0.65, metrics.width * uniform * 0.5);
      entity.hitHalfD = Math.max(0.9, Math.max(metrics.depth, metrics.width * 0.6) * uniform * 0.5);
      entity.centerY = gy + metrics.height * uniform * 0.5;

      if (entity.instanceId !== undefined && this.enemyInstancedMesh) {
        this.enemyInstanceDummy.position.set(LANE_X[lane], gy, z);
        this.enemyInstanceDummy.rotation.set(0, COMBAT_ENEMY_YAW_BATTLE, 0);
        this.enemyInstanceDummy.scale.setScalar(uniform);
        this.enemyInstanceDummy.updateMatrix();
        this.enemyInstancedMesh.setMatrixAt(entity.instanceId, this.enemyInstanceDummy.matrix);
        this.enemyInstanceMatrixDirty = true;
      } else {
        const modelRoot = entity.root.children[0] as THREE.Object3D | undefined;
        if (modelRoot) {
          modelRoot.rotation.set(0, COMBAT_ENEMY_YAW_BATTLE, 0);
          modelRoot.scale.setScalar(uniform);
          entity.root.scale.set(1, 1, 1);
        }
      }
      return;
    }

    const sprite = entity.root.children[0] as THREE.Sprite | undefined;
    if (!sprite) return;
    const s = billboardScale(z, camZ);
    sprite.center.set(0.5, 0.5);
    const scaleW = (entity.boss ? 3 * 1.35 : 1.8) * s * COMBAT_CHARACTER_SCALE * COMBAT_ENEMY_SCALE_MULTIPLIER;
    const scaleH = (entity.boss ? 4 * 1.35 : 2.4) * s * COMBAT_CHARACTER_SCALE * COMBAT_ENEMY_SCALE_MULTIPLIER;
    sprite.scale.set(scaleW, scaleH, 1);
    entity.hitHalfW = scaleW * 0.5;
    entity.hitHalfD = scaleH * 0.45;
    entity.centerY = gy;
  }

  private updateEntityTransform(sprite: THREE.Sprite, lane: number, z: number): void {
    const camZ = this.camera.position.z;
    const s = billboardScale(z, camZ);
    sprite.center.set(0.5, 0.5);
    sprite.position.set(LANE_X[lane], roadY(z, camZ), z);
    sprite.scale.set(1.8 * s * COMBAT_CHARACTER_SCALE, 2.4 * s * COMBAT_CHARACTER_SCALE, 1);
  }

  private getPlayerLayout(): PlayerCombatLayout {
    if (this.cachedPlayerLayout && this.cachedPlayerLayoutLane === this.laneIndex) {
      return this.cachedPlayerLayout;
    }
    const layout = getPlayerCombatLayout(this.camera, this.laneIndex, PLAYER_Z);
    this.cachedPlayerLayout = layout;
    this.cachedPlayerLayoutLane = this.laneIndex;
    return layout;
  }

  private updatePlayerTransform(): void {
    const layout = this.getPlayerLayout();
    const renderLift = PLAYER_RENDER_LIFT;
    this.playerRoot.position.set(
      this.cameraFollowX + this.getLeadFormationOffsetX(),
      layout.y + renderLift,
      layout.renderZ,
    );

    const scaleH = layout.scaleH * COMBAT_CHARACTER_SCALE;
    const scaleW = layout.scaleW * COMBAT_CHARACTER_SCALE;

    if (this.playerVisualKind === 'model' && this.playerVisual) {
      const metrics = this.getPlayerMetrics();
      if (metrics) {
        const uniform = Math.min(scaleH / metrics.height, scaleW / metrics.width);
        this.playerVisual.scale.setScalar(uniform);
      }
    } else if (this.playerVisualKind === 'sprite' && this.playerVisual) {
      if (this.playerVisual.userData.combatLiveAspect) {
        const headMul = getCombatLiveHeadScaleMul(this.leadCharId);
        const live = liveSpriteScale(scaleH, this.playerVisual, headMul);
        (this.playerVisual as THREE.Sprite).scale.set(live.w, live.h, 1);
      } else {
        (this.playerVisual as THREE.Sprite).scale.set(scaleW, scaleH, 1);
      }
    }

    this.playerRoot.userData.layoutMetrics = layout;
    if (this.debugLayoutHud) {
      this.parent.dataset.playerGroundY = layout.groundY.toFixed(3);
      this.parent.dataset.playerGroundClearance = layout.groundClearance.toFixed(3);
      this.parent.dataset.playerTranslateY = layout.translateY.toFixed(3);
      this.parent.dataset.playerRenderLift = renderLift.toFixed(3);
      this.parent.dataset.playerRenderZ = layout.renderZ.toFixed(3);
      this.parent.dataset.playerLogicZ = layout.logicZ.toFixed(3);
      this.parent.dataset.playerCharacterScale = COMBAT_CHARACTER_SCALE.toFixed(2);
    }
    this.playerBaseScale = {
      w: (layout.scaleW * COMBAT_CHARACTER_SCALE) / billboardScale(layout.renderZ, this.camera.position.z),
      h: (layout.scaleH * COMBAT_CHARACTER_SCALE) / billboardScale(layout.renderZ, this.camera.position.z),
    };
    this.updateSquadWingTransforms();
  }

  private makeSprite(emoji: string, bg: string, border: string, w: number, h: number): THREE.Sprite {
    const tex = createEmojiTexture(emoji, bg, border);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(w, h, 1);
    return sprite;
  }

  private makeCombatSprite(kind: CombatEnemyKind, w: number, h: number): THREE.Sprite {
    const tex = getCombatEnemyTexture(kind);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(w, h, 1);
    return sprite;
  }

  private makeImageSprite(url: string, w: number, h: number): THREE.Sprite {
    const tex = new THREE.TextureLoader().load(texUrl(url));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(w, h, 1);
    return sprite;
  }

  private setupInput(): void {
    const move = (dir: number) => this.moveLane(dir);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') move(-1);
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') move(1);
    };
    window.addEventListener('keydown', onKey);
    (this as any)._onKey = onKey;

    const canvas = this.renderer.domElement;
    const onPointer = (e: PointerEvent) => {
      if (this.tryHitInteractive(e)) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < rect.width / 2) move(-1);
      else move(1);
    };
    canvas.addEventListener('pointerdown', onPointer);
    (this as any)._onPointer = onPointer;
  }

  private tryHitInteractive(e: PointerEvent): boolean {
    const activeSprites = this.interactives.filter((item) => item.state.active).map((item) => item.sprite);
    if (!activeSprites.length) return false;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const hit = this.raycaster.intersectObjects(activeSprites, false)[0];
    if (!hit) return false;

    const target = this.interactives.find((item) => item.sprite === hit.object);
    if (!target) return false;

    const result = applyInteractiveHit(target.state);
    this.skillMods.attackSpeedBonus += result.attackSpeedBonus;

    if (target.state.kind === 'door') {
      const mat = target.sprite.material as THREE.SpriteMaterial;
      mat.color.set(result.consumed ? '#5dffa8' : '#b57dff');
    } else if (target.state.kind === 'barrel' && target.state.active === false) {
      this.vfx.spawnKillBurst(target.sprite.position.x, target.sprite.position.y, target.sprite.position.z);
      this.scene.remove(target.sprite);
      this.disposeSprite(target.sprite);
    }

    return true;
  }

  private moveLane(dir: number): void {
    if (this.finished) return;
    this.laneIndex = Math.max(0, Math.min(2, this.laneIndex + dir));
    this.targetLaneLean = dir * -0.022;
    this.cachedPlayerLayout = null;
    this.updatePlayerTransform();
  }

  private spawnWave(): void {
    const { stage } = this.data;
    const count = waveEnemyCount(this.wave, stage.tier, this.data.squadIds.length, stage.mode === 'hell');
    this.pendingSpawns += count;

    for (let i = 0; i < count; i++) {
      const t = setTimeout(() => {
        this.spawnEnemy();
        this.pendingSpawns = Math.max(0, this.pendingSpawns - 1);
      }, i * 320);
      this.spawnTimers.push(t);
    }

    if (stage.isBoss && this.wave === this.maxWaves && stage.combatMode !== 'raidBoss') {
      this.pendingSpawns++;
      const t = setTimeout(() => {
        this.spawnBoss();
        this.pendingSpawns = Math.max(0, this.pendingSpawns - 1);
      }, 1600);
      this.spawnTimers.push(t);
    }

    this.updateWaveHUD();
  }

  private updateWaveHUD(): void {
    const el = this.hudEl.querySelector('[data-hud="wave"]');
    if (el) el.textContent = `波次 ${this.wave}/${this.maxWaves}`;
  }

  private spawnEnemy(): void {
    if (this.disposed || this.finished) return;
    const lane = Math.floor(Math.random() * 3);
    const z = SPAWN_Z - Math.random() * 25;
    const entity = this.createEnemyEntity(lane, z, false);
    if (entity.visualKind === 'sprite') this.scene.add(entity.root);
    this.enemies.push(entity);
    this.everSpawned = true;
  }

  private spawnBoss(): void {
    if (this.disposed || this.finished) return;
    const z = SPAWN_Z - 8;
    const entity = this.createEnemyEntity(1, z, true);
    if (entity.visualKind === 'sprite') this.scene.add(entity.root);
    this.enemies.push(entity);
    this.everSpawned = true;
    this.fovPulse = 1;
    this.parent.dataset.combatBoss = 'true';
    this.infoEl.textContent = '⚠ BOSS';
    this.infoEl.classList.add('boss');
  }

  private upgradeSpriteEnemiesToModels(): void {
    if (!this.enemyTemplate) return;
    for (const entity of this.enemies) {
      if (entity.visualKind !== 'sprite' || !entity.active) continue;
      const sprite = entity.root.children[0] as THREE.Sprite | undefined;
      if (sprite) {
        this.disposeSprite(sprite);
        this.scene.remove(entity.root);
      }
      entity.root.clear();
      entity.root.userData.combatMetrics = { ...this.enemyTemplate.metrics };
      entity.visualKind = 'model';
      if (this.enemyInstancedMesh) {
        entity.instanceId = this.allocateEnemyInstanceId();
      } else {
        const model = cloneCombatEnemy(this.enemyTemplate);
        entity.root.add(model);
        this.scene.add(entity.root);
      }
      this.updateEnemyTransform(entity, entity.lane, entity.root.position.z);
      this.aliveEnemyCount += 1;
    }
  }

  private createEnemyEntity(lane: number, z: number, boss: boolean): Entity3D {
    const root = new THREE.Group();
    let visualKind: Entity3D['visualKind'] = 'model';
    let instanceId: number | undefined;

    if (this.enemyTemplate && this.enemyInstancedMesh) {
      root.userData.combatMetrics = { ...this.enemyTemplate.metrics };
      instanceId = this.allocateEnemyInstanceId();
    } else if (this.enemyTemplate) {
      root.userData.combatMetrics = { ...this.enemyTemplate.metrics };
      root.add(cloneCombatEnemy(this.enemyTemplate));
    } else {
      visualKind = 'sprite';
      root.add(this.makeCombatSprite(boss ? 'boss' : 'drone', boss ? 3 : 1.8, boss ? 4 : 2.4));
    }

    const entity: Entity3D = {
      id: this.nextEntityId++,
      root,
      visualKind,
      lane,
      hp: boss ? this.data.stage.enemyHp * 8 : this.data.stage.enemyHp,
      maxHp: 0,
      boss,
      active: true,
      hitHalfW: 1.4,
      hitHalfD: 2.2,
      centerY: roadY(z, this.camera.position.z),
      instanceId,
    };
    entity.maxHp = entity.hp;
    this.updateEnemyTransform(entity, lane, z);
    if (visualKind === 'model') this.aliveEnemyCount += 1;
    return entity;
  }

  private spawnDoors(): void {
    const opts = [
      { bonus: 0.2, lane: 0 },
      { bonus: 0.35, lane: 2 },
    ];
    opts.forEach((o) => {
      const z = -35;
      const sprite = this.makeCombatSprite('door', 2, 2.5);
      this.updateEntityTransform(sprite, o.lane, z);
      this.scene.add(sprite);
      this.interactives.push({
        sprite,
        state: {
          kind: 'door',
          attackSpeedBonus: o.bonus,
          active: true,
        },
      });
    });
  }

  private spawnBarrels(): void {
    for (let i = 0; i < 3; i++) {
      const lane = i;
      const z = -30 - i * 12;
      const sprite = this.makeCombatSprite('barrel', 1.6, 2);
      this.updateEntityTransform(sprite, lane, z);
      this.scene.add(sprite);
      this.interactives.push({
        sprite,
        state: {
          kind: 'barrel',
          hitsRemaining: 3,
          active: true,
        },
      });
    }
  }

  private fire(remainingHits = 0, opts?: { fromTriple?: boolean }): void {
    // 一次开火统一个强音（避免三人小队同帧开火三个 fire SFX 互相打架）
    playFireSfx(opts?.fromTriple ? 2 : 1);
    this.fireFromUnit(
      this.leadCharId,
      this.playerRoot.position.x,
      this.getPlayerMuzzleY(),
      this.playerRoot.position.y,
      this.playerRoot.position.z,
      remainingHits,
      opts?.fromTriple ? '翠翼连闪' : undefined,
    );
    for (const wing of this.squadWings) {
      this.fireFromUnit(
        wing.charId,
        wing.root.position.x,
        this.getWingMuzzleY(wing),
        wing.root.position.y,
        wing.root.position.z,
        remainingHits,
        opts?.fromTriple ? '翠翼连闪' : undefined,
      );
    }
  }

  /** 贴地弹幕高度：跟随路面坡度，并保持与发射角色脚底同一抬高 */
  private getBulletBeamY(renderZ: number, feetOffset: number): number {
    const camZ = this.camera.position.z;
    return roadY(renderZ, camZ) + feetOffset + 0.05;
  }

  private placeBulletMesh(mesh: THREE.Mesh, x: number, renderZ: number, feetOffset: number, stretch: number): void {
    mesh.position.set(x, this.getBulletBeamY(renderZ, feetOffset), renderZ);
    mesh.scale.set(1, stretch, 1);
  }

  private fireFromUnit(
    charId: string,
    x: number,
    muzzleY: number,
    rootY: number,
    rootZ: number,
    remainingHits: number,
    overrideLabel?: string,
  ): void {
    const mesh = createCombatBulletMesh();
    const camZ = this.camera.position.z;
    const feetOffset = rootY - roadY(rootZ, camZ);
    const renderStartZ = rootZ - 0.45;
    const logicZ = PLAYER_Z - 1;
    const targetZ = this.findBulletTargetZ();
    this.placeBulletMesh(mesh, x, renderStartZ, feetOffset, 0.55);
    this.scene.add(mesh);
    const muzzleOrigin = new THREE.Vector3(x, muzzleY, renderStartZ);
    const shotLabel = overrideLabel ?? getShotLabel(charId);
    const squadSlot = Math.max(0, this.data.squadIds.indexOf(charId));
    const damage = this.data.squadDamage[charId] ?? Math.max(1, this.data.tcp / 10 / Math.max(1, this.data.squadIds.length));
    this.bullets.push({
      mesh,
      active: true,
      remainingHits,
      lane: this.laneIndex,
      originX: x,
      feetOffset,
      logicZ,
      renderStartZ,
      targetZ,
      shotLabel,
      sourceCharId: charId,
      squadSlot,
      damage,
    });
    this.vfx.spawnMuzzle(this.camera, muzzleOrigin);
  }

  private findBulletTargetZ(): number {
    let bestZ = -Infinity;
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (enemy.lane !== this.laneIndex) continue;
      if (enemy.root.position.z <= PLAYER_Z && enemy.root.position.z > bestZ) {
        bestZ = enemy.root.position.z;
      }
    }
    return bestZ > -Infinity ? bestZ : SPAWN_Z;
  }

  private findBulletRenderTargetZ(bullet: Bullet3D): number {
    let bestZ = -Infinity;
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (enemy.lane !== bullet.lane) continue;
      if (enemy.root.position.z > bullet.logicZ) continue;
      if (enemy.root.position.z > bestZ) {
        bestZ = enemy.root.position.z;
      }
    }
    return bestZ > -Infinity ? bestZ : bullet.targetZ;
  }

  private getBulletRenderZ(bullet: Bullet3D): number {
    const targetZ = this.findBulletRenderTargetZ(bullet);
    return computeBulletRenderZ(bullet.logicZ, bullet.renderStartZ, targetZ);
  }

  private autoMove(): void {
    let best: Entity3D | null = null;
    let bestZ = -Infinity;
    for (const e of this.enemies) {
      if (!e.active) continue;
      if (e.root.position.z > bestZ) {
        bestZ = e.root.position.z;
        best = e;
      }
    }
    if (best && best.lane !== this.laneIndex) {
      this.moveLane(best.lane > this.laneIndex ? 1 : -1);
    }
  }

  private getDebugSceneTriCount(): number {
    const geo = (typeof window !== 'undefined'
      ? (window as Window & { __combatGeoStats?: Record<string, string> }).__combatGeoStats
      : undefined) ?? {};
    const parseTri = (key: string) => {
      const raw = geo[key];
      if (!raw) return 0;
      const n = Number.parseInt(raw.split(/\s+/)[0]?.replace(/,/g, '') ?? '0', 10);
      return Number.isFinite(n) ? n : 0;
    };

    const avgTri = (keys: string[]) => {
      const vals = keys.map(parseTri).filter((n) => n > 0);
      if (!vals.length) return 0;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    const buildPer = avgTri([
      'build01-simplified',
      'build01-raw',
      'build02-simplified',
      'build02-raw',
    ]);
    const propPer = avgTri([
      'props01-simplified',
      'props01-raw',
      'props02-simplified',
      'props02-raw',
      'props03-simplified',
      'props03-raw',
      'props04-simplified',
      'props04-raw',
      'props05-simplified',
      'props05-raw',
      'props06-simplified',
      'props06-raw',
    ]);
    const enemyPer = parseTri('diren01');
    const playerPer = parseTri('player');
    const buildCount = this.qualityProfile.sideBuildings;
    const propCount = this.qualityProfile.sideProps;
    const enemyCount = this.aliveEnemyCount;

    return Math.round(
      buildPer * buildCount + propPer * propCount + enemyPer * enemyCount + playerPer + 4,
    );
  }

  private updateDebugHud(): void {
    const now = performance.now();
    const dt = now - (this.lastDebugPerfMark || now);
    this.lastDebugPerfMark = now;
    this.fpsFrames += 1;
    this.fpsAccumMs += dt;
    if (this.fpsAccumMs < 250) return;

    const fps = Math.round((this.fpsFrames * 1000) / this.fpsAccumMs);
    const quality = this.qualityProfile.quality.toUpperCase();
    const tris = formatTriangleCount(this.getDebugSceneTriCount());
    const page = refreshWebGLPageState();
    const glTag = abbreviateRenderer(this.webglCaps.renderer);
    const warnTags: string[] = [];
    if (this.webglCaps.softwareRenderer) warnTags.push('CPU渲染');
    if (page.pageHidden) warnTags.push('页面不可见');
    const warn = warnTags.length ? ` · ⚠ ${warnTags.join('/')}` : '';
    this.fpsEl.textContent = `FPS ${fps} · ${tris} TRI · ${quality} · ${glTag}${warn}`;
    this.fpsFrames = 0;
    this.fpsAccumMs = 0;
    this.renderer.info.reset();
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    let deltaMs = Math.min(this.clock.getDelta() * 1000, 100);
    // P2：命中/暴击的短促减速（hit-lag）：命中瞬间把"世界时间"放慢 6x
    if (this.hitLag > 0) {
      const lagAmount = Math.min(this.hitLag, deltaMs * 0.6); // 单帧最多吃掉 60% 的真实 dt
      this.hitLag = Math.max(0, this.hitLag - lagAmount);
      // 攻击者/技能仍正常推进（用 deltaMs 不被压），但游戏世界（敌人接近、子弹推进、震屏）
      // 用较慢的 dt（deltaMs - lagAmount）——这样命中瞬间能看出"顿一下"
      this.currentTimeScale = Math.max(0.18, (deltaMs - lagAmount) / deltaMs);
      // 把"世界 dt"缩小：等价于 clock.getDelta 自带减速
      deltaMs = deltaMs - lagAmount;
      if (this.hitLag <= 0) this.currentTimeScale = 1;
    } else {
      this.currentTimeScale = 1;
    }
    if (!this.finished) {
      this.update(deltaMs);
      this.syncEnemyHpBars();
    }
    if (this.headCalDirectRender) {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.postFx.render();
    }
    this.updateDebugHud();
  };

  private getEnemyHpBarAnchor(entity: Entity3D): { x: number; y: number; z: number } {
    const lift = entity.boss
      ? Math.max(1.6, entity.hitHalfW * 1.35)
      : Math.max(0.85, entity.hitHalfW * 1.05);
    return {
      x: entity.root.position.x,
      y: entity.centerY + lift,
      z: entity.root.position.z,
    };
  }

  private syncEnemyHpBars(): void {
    if (!this.enemyHpBars) return;
    const targets = this.enemies
      .filter((e) => e.active)
      .map((e) => {
        const anchor = this.getEnemyHpBarAnchor(e);
        return {
          id: e.id,
          hp: e.hp,
          maxHp: e.maxHp,
          boss: e.boss,
          active: e.active,
          worldX: anchor.x,
          worldY: anchor.y,
          worldZ: anchor.z,
        };
      });
    this.enemyHpBars.sync(targets);
  }

  private update(delta: number): void {
    if (this.finished) return;
    const { stage, autoMode } = this.data;
    const dt = delta / 1000;

    this.timeLeft -= dt;
    const timerHud = `⏱ ${Math.ceil(Math.max(0, this.timeLeft))}s`;
    if (timerHud !== this.lastTimerHud) {
      this.timerEl.textContent = timerHud;
      this.lastTimerHud = timerHud;
    }
    const passHud = this.raidBossMode
      ? this.bossHpEl?.textContent ?? ''
      : `通过 ${this.passCount}/${this.passLimit}`;
    if (passHud !== this.lastPassHud) {
      if (this.raidBossMode && this.bossHpEl) {
        /* boss hp updated in updateRaidBoss */
      } else {
        this.passEl.textContent = passHud;
      }
      this.lastPassHud = passHud;
    }

    if (this.raidBossMode) {
      if (this.timeLeft <= 0) {
        this.endCombat(false);
        return;
      }
      this.env.update(dt, 0);
      this.vfx.update(dt);
      this.floatText?.update(dt);
      this.applyCameraEffects(dt);
      this.updateRaidBoss(dt);
      this.updatePlayerBullets(dt);
      this.checkHits();
      if (this.raidBossEntity && this.raidBossEntity.hp <= 0) {
        this.endCombat(true);
      }
      return;
    }

    // 义体健康：碰撞/弹幕命中按关卡规则扣血

    if (autoMode) this.autoMove();
    this.env.update(dt, this.scrollSpeed);
    this.vfx.update(dt);
    this.skillFx3D.update(dt);
    this.applyCameraEffects(dt);

    if (this.qualityProfile.ambientDust > 0) {
      this.dustSpawnTimer += dt;
      if (this.dustSpawnTimer > 0.45) {
        this.dustSpawnTimer = 0;
        this.vfx.spawnAmbientDust(1);
      }
    }

    const fireRate = 350 / (1 + this.skillMods.attackSpeedBonus);
    this.fireTimer += delta;
    if (this.fireTimer >= fireRate) {
      this.fireTimer = 0;
      const remainingHits = this.skillMods.projectilePierce;
      this.fire(remainingHits);
      if (
        this.skillMods.tripleShotEnabled &&
        this.tripleCooldown <= 0 &&
        this.comboKills >= this.skillMods.tripleShotTriggerKills
      ) {
        const muzzleY = this.getPlayerMuzzleY();
        this.vfx.spawnSkillEffect(
          'resonance_burst',
          this.camera,
          this.playerRoot.position.x,
          muzzleY,
          this.playerRoot.position.z,
        );
        const sparkCasterId = this.leadCharId;
        const sparkPos = this.getSquadMemberWorldPos(sparkCasterId);
        const sparkRefH = this.getCasterRenderHeight(sparkCasterId);
        this.skillFx3D.spawn(
          'resonance_burst',
          sparkPos.x,
          sparkPos.y + 0.68,
          sparkPos.z,
          '#7CFF4A',
          '#aaff66',
          undefined,
          sparkRefH,
          () => {
            const p = this.getSquadMemberWorldPos(sparkCasterId);
            return { x: p.x, y: p.y + 0.68, z: p.z };
          },
        );
        this.floatText?.spawnWorld(
          { x: this.playerRoot.position.x, y: muzzleY + 0.8, z: this.playerRoot.position.z },
          '翠翼连闪',
          'skill',
        );
        this.showSkillBanner('翠翼连闪', '连击达成 · 三连射击释放', '#7CFF4A');
        playSkillSfx('resonance_burst');
        // 小幅触发屏幕冲击
        this.triggerScreenShake({ shake: 0.04, intensity: 0.1, fov: 0.06 });
        setTimeout(() => !this.finished && this.fire(remainingHits, { fromTriple: true }), 100);
        setTimeout(() => !this.finished && this.fire(remainingHits, { fromTriple: true }), 200);
        this.tripleCooldown = this.skillMods.tripleShotCooldown;
        this.comboKills = 0;
      }
    }
    if (this.tripleCooldown > 0) this.tripleCooldown -= delta;

    if (this.skillMods.ironRainEnabled) {
      this.ironRainTimer += delta;
      if (this.ironRainTimer >= this.skillMods.ironRainInterval) {
        this.ironRainTimer = 0;
        this.triggerIronRain();
      }
    }

    this.updateSkillPulses(dt);
    this.floatText?.update(dt);

    if (!this.skillAnnounceDone) {
      this.skillAnnounceDone = true;
      this.announceSkills();
    }

    const approachMul = stage.mode === 'hell' ? HELL_APPROACH_MUL : 1;
    // 进度压力：逼近速度随全局关卡数最高 +35%，后期不给白给输出窗口
    const tierPush = 1 + Math.min(0.35, stage.tier * 0.006);
    const approachSpeed = (stage.isBoss ? 7 : 10) * (1 + this.scrollSpeed * 0.04) * approachMul * tierPush;
    for (const e of this.enemies) {
      if (!e.active) continue;
      const now = performance.now();
      if (e.slowUntilMs !== undefined && now >= e.slowUntilMs) {
        e.slowUntilMs = undefined;
        e.slowMultiplier = undefined;
      }
      const controlMul = e.slowMultiplier ?? 1;
      e.root.position.z += approachSpeed * controlMul * dt;
      this.updateEnemyTransform(e, e.lane, e.root.position.z);

      const dx = Math.abs(e.root.position.x - this.playerRoot.position.x);
      const dz = Math.abs(e.root.position.z - PLAYER_Z);
      // 碰撞 = 通过一次：被撞角色义体 -1、材质闪红、移除该敌
      if (e.lane === this.laneIndex && dx < e.hitHalfW + 0.9 && dz < e.hitHalfD + 1.2) {
        this.registerEnemyPass(e, 'hit');
        continue;
      }
      if (e.root.position.z > PLAYER_Z + 6) {
        this.registerEnemyPass(e, 'leak');
      }
    }

    this.updatePlayerBullets(dt);

    const alive = this.aliveEnemyCount;

    const nextWave = nextWaveAfterClear(alive, this.pendingSpawns, this.wave, this.maxWaves);
    if (nextWave !== null) {
      this.wave = nextWave;
      this.spawnWave();
    } else if (
      shouldEndVictory(alive, this.pendingSpawns, this.wave, this.maxWaves, this.everSpawned)
    ) {
      this.endCombat(true);
    }

    if (this.enemyInstanceMatrixDirty && this.enemyInstancedMesh) {
      this.enemyInstancedMesh.instanceMatrix.needsUpdate = true;
      this.enemyInstanceMatrixDirty = false;
    }
  }

  private updatePlayerBullets(dt: number): void {
    const bulletSpeed = 28;
    for (const b of this.bullets) {
      if (!b.active) continue;
      b.logicZ -= bulletSpeed * dt;
      const renderZ = this.getBulletRenderZ(b);
      const stretch = 0.65 + Math.min(0.45, (PLAYER_Z - b.logicZ) * 0.025);
      this.placeBulletMesh(b.mesh, b.originX, renderZ, b.feetOffset, stretch);
      if (b.logicZ < SPAWN_Z - 20) {
        b.active = false;
        this.scene.remove(b.mesh);
      }
    }
    this.checkHits();
  }

  private checkHits(): void {
    const { stage } = this.data;
    const critMul = stage.isBoss ? 1 + this.skillMods.bossCritBonus : 1;
    const isCrit = stage.isBoss && this.skillMods.bossCritBonus > 0;

    for (const b of this.bullets) {
      if (!b.active) continue;
      for (const e of this.enemies) {
        if (!e.active) continue;
        if (e.lane !== b.lane) continue;
        const dz = Math.abs(b.logicZ - e.root.position.z);
        if (dz < e.hitHalfD + 0.45) {
          const damage = b.damage * critMul;
          e.hp -= damage;
          b.remainingHits -= 1;
          const piercedThrough = b.remainingHits >= 0;
          if (b.remainingHits < 0) {
            b.active = false;
            this.scene.remove(b.mesh);
          }

          // P2：命中主视觉 = 中心 glow + 火花（取消环波，纯火花残片感）
          this.vfx.spawnHit(e.root.position.x, e.centerY, e.root.position.z, e.boss);
          this.vfx.spawnImpactSparks(e.root.position.x, e.centerY, e.root.position.z, e.boss ? '#ff8866' : '#a8e8ff', 4);

          // P2：屏幕冲击 + FOV 推近 + 暴击 hit-lag
          if (e.boss) {
            this.triggerScreenShake({
              shake: 0.16,
              intensity: 0.35,
              fov: 0.32,
              hitLagSeconds: isCrit ? 0.07 : 0.04,
            });
          } else {
            this.triggerScreenShake({
              shake: 0.08,
              intensity: 0.0,
              fov: 0.0,
              hitLagSeconds: isCrit ? 0.045 : 0.0,
            });
          }
          // 敌人被击退（轻微）：让命中"歪一下"
          if (!e.boss) {
            e.root.position.z += 0.06 + Math.random() * 0.06;
          } else {
            e.root.position.z += 0.04;
          }

          const dmgText = isCrit
            ? `${b.shotLabel} ${Math.round(damage)}!`
            : `${b.shotLabel} ${Math.round(damage)}`;
          this.floatText?.spawnWorld(
            { x: e.root.position.x, y: e.centerY + 0.9, z: e.root.position.z },
            dmgText,
            isCrit ? 'crit' : 'damage',
            b.squadSlot,
          );

          if (piercedThrough && this.skillMods.projectilePierce > 0) {
            this.vfx.spawnPierceTrail(e.root.position.x, e.centerY, e.root.position.z);
            this.floatText?.spawnWorld(
              { x: e.root.position.x, y: e.centerY + 2.0, z: e.root.position.z },
              '绯尾贯穿',
              'skill',
            );
            this.showSkillBanner('绯尾贯穿', '穿透 +1 · 本次攻击继续命中', '#ff5e8a');
            playSkillSfx('sand_pierce');
          }

          // 命中 SFX（暴击走更重的音）
          playHitSfx(isCrit);

          if (e.hp <= 0) {
            // P2：重型击杀 = 重型 burst + 重型音 + 重型 hit-lag
            const killColor = e.boss ? '#ff8866' : '#88eeff';
            if (e.boss) {
              this.vfx.spawnHeavyKillBurst(e.root.position.x, e.centerY, e.root.position.z, killColor);
            } else {
              this.vfx.spawnKillBurst(e.root.position.x, e.centerY, e.root.position.z, e.boss);
            }
            this.removeEnemy(e);
            this.kills++;
            this.comboKills++;
            // 大击杀震屏
            if (e.boss) {
              this.triggerScreenShake({
                shake: 0.32,
                intensity: 0.7,
                fov: 0.6,
                hitLagSeconds: 0.08,
              });
            } else {
              this.triggerScreenShake({
                shake: 0.14,
                intensity: 0.2,
                fov: 0.18,
                hitLagSeconds: 0.02,
              });
            }
            // 击杀 SFX
            playKillSfx(e.boss);
          }
          break;
        }
      }
    }
  }

  private showSkillBanner(title: string, detail: string, color: string): void {
    // 实际显示在 HUD 上：弹出 → 停留 → 自动消失
    if (!this.skillBannerEl) return;
    const el = this.skillBannerEl;
    el.style.setProperty('--skill-color', color);
    el.style.setProperty('--skill-color-rgb', hexToRgbStr(color));
    const titleEl = el.querySelector<HTMLElement>('[data-skill-banner-title]');
    const detailEl = el.querySelector<HTMLElement>('[data-skill-banner-detail]');
    if (titleEl) titleEl.textContent = title;
    if (detailEl) detailEl.textContent = detail;
    el.classList.remove('is-show');
    void el.offsetWidth;
    el.classList.add('is-show');
    if (this.skillBannerTimer) window.clearTimeout(this.skillBannerTimer);
    this.skillBannerTimer = window.setTimeout(() => {
      el.classList.remove('is-show');
    }, 1200);
  }

  private announceSkills(): void {
    if (!this.activeSkillFx.length) return;
    let delay = 0;
    for (const fx of this.activeSkillFx) {
      const wait = delay;
      window.setTimeout(() => {
        if (this.finished || this.disposed) return;
        const casterId =
          this.data.squadIds.find((id) => CHARACTER_MAP[id]?.skillId === fx.id) ?? this.leadCharId;
        const pos = this.getSquadMemberWorldPos(casterId);
        const refH = this.getCasterRenderHeight(casterId);
        this.vfx.spawnSkillEffect(fx.id, this.camera, pos.x, pos.y, pos.z);
        this.skillFx3D.spawn(
          fx.id,
          pos.x,
          pos.y,
          pos.z,
          fx.color,
          fx.accentColor,
          undefined,
          refH,
          () => {
            const p = this.getSquadMemberWorldPos(casterId);
            return { x: p.x, y: p.y, z: p.z };
          },
        );
        // 入场宣告：banner + 短促音
        this.showSkillBanner(fx.bannerTitle, fx.bannerDetail, fx.bannerColor);
        playSkillSfx(fx.id);
      }, wait);
      delay += 420;
    }
  }

  private updateSkillPulses(dt: number): void {
    for (const fx of this.activeSkillFx) {
      if (fx.pulseInterval <= 0) continue;
      const left = (this.skillPulseTimers.get(fx.id) ?? fx.pulseInterval) - dt;
      if (left > 0) {
        this.skillPulseTimers.set(fx.id, left);
        continue;
      }
      this.skillPulseTimers.set(fx.id, fx.pulseInterval);
      const y = this.playerRoot.position.y + 1.4;
      if (fx.id === 'frost_overload') {
        const now = performance.now();
        const affected = this.enemies.filter((enemy) => enemy.active);
        for (const enemy of affected) {
          enemy.slowMultiplier = 0.58;
          enemy.slowUntilMs = now + 2400;
        }
        const frostCasterId =
          this.data.squadIds.find((id) => CHARACTER_MAP[id]?.skillId === fx.id) ?? this.leadCharId;
        const pos = this.getSquadMemberWorldPos(frostCasterId);
        const refH = this.getCasterRenderHeight(frostCasterId);
        this.vfx.spawnSkillEffect(fx.id, this.camera, pos.x, pos.y, pos.z);
        this.skillFx3D.spawn(
          fx.id,
          pos.x,
          pos.y,
          pos.z,
          fx.color,
          fx.accentColor,
          undefined,
          refH,
          () => {
            const p = this.getSquadMemberWorldPos(frostCasterId);
            return { x: p.x, y: p.y, z: p.z };
          },
        );
        this.showSkillBanner(fx.bannerTitle, '全场减速 42% · 持续 2.4 秒', fx.bannerColor);
        playSkillSfx(fx.id);
      } else if (fx.id === 'shard_shell' || fx.id === 'outer_pulse') {
        const shardCasterId =
          this.data.squadIds.find((id) => CHARACTER_MAP[id]?.skillId === fx.id) ?? this.leadCharId;
        const pos = this.getSquadMemberWorldPos(shardCasterId);
        const refH = this.getCasterRenderHeight(shardCasterId);
        this.vfx.spawnSkillEffect(fx.id, this.camera, pos.x, pos.y, pos.z);
        this.skillFx3D.spawn(
          fx.id,
          pos.x,
          pos.y,
          pos.z,
          fx.color,
          fx.accentColor,
          undefined,
          refH,
          () => {
            const p = this.getSquadMemberWorldPos(shardCasterId);
            return { x: p.x, y: p.y, z: p.z };
          },
        );
        this.showSkillBanner(
          fx.bannerTitle,
          fx.id === 'shard_shell' ? '晶体壁障 · 减伤 +12% · 攻速 +10%' : '义体脉冲 · 攻速 +20% · 减伤 +8%',
          fx.bannerColor,
        );
        playSkillSfx(fx.id);
        if (fx.id === 'outer_pulse') {
          mutateAiLiving((living) => {
            for (const id of this.data.squadIds) {
              const next = Math.min(COMBAT_HEALTH_MAX, getCyberHealth(living as AiLivingSave, id) + 2);
              setCyberHealth(living as AiLivingSave, id, next, '兔械同调脉冲修复');
              this.combatHp[id] = next;
            }
          });
          this.refreshHealthHud();
        }
      } else if (fx.id === 'stellar_judgment') {
        const target = this.enemies
          .filter((enemy) => enemy.active)
          .sort((a, b) => b.root.position.z - a.root.position.z)[0];
        if (target) {
          const casterId = this.data.squadIds.find((id) => CHARACTER_MAP[id]?.skillId === fx.id) ?? this.data.squadIds[0];
          const damage = (this.data.squadDamage[casterId ?? ''] ?? this.data.tcp / 10) * 1.8;
          target.hp -= damage;
          const judgmentCasterId = casterId ?? this.leadCharId;
          const caster = this.getSquadMemberWorldPos(judgmentCasterId);
          this.vfx.spawnSkillEffect(fx.id, this.camera, caster.x, caster.y, caster.z, {
            x: target.root.position.x,
            y: target.centerY,
            z: target.root.position.z,
          });
          const judgmentRefH = this.getCasterRenderHeight(judgmentCasterId);
          // judgment 的"锚点"是目标敌人 —— 特效要钉在目标头上。
          // 所以这里 follow 用敌人位置（敌人被打死前不会立刻被 remove），不是 caster 位置。
          const tRoot = target.root;
          this.skillFx3D.spawn(
            fx.id,
            caster.x,
            caster.y,
            caster.z,
            fx.color,
            fx.accentColor,
            {
              x: tRoot.position.x,
              y: target.centerY,
              z: tRoot.position.z,
            },
            judgmentRefH,
            () => ({
              x: tRoot.position.x,
              y: target.centerY,
              z: tRoot.position.z,
            }),
          );
          this.showSkillBanner(fx.bannerTitle, `天罚一击 · 命中伤害 ${Math.round(damage)}`, fx.bannerColor);
          playSkillSfx(fx.id);
          // P2：重型一击（boss/大数字）触发屏幕冲击 + 暴击闪
          this.triggerScreenShake({
            shake: 0.2,
            intensity: 0.45,
            fov: 0.45,
            hitLagSeconds: 0.05,
          });
          this.triggerCritFlash();
          if (target.hp <= 0) {
            this.vfx.spawnHeavyKillBurst(
              target.root.position.x,
              target.centerY,
              target.root.position.z,
              '#ffd54f',
            );
            this.removeEnemy(target);
            this.kills++;
            this.comboKills++;
            playKillSfx(target.boss);
          }
        }
      } else {
        const elseCasterId =
          this.data.squadIds.find((id) => CHARACTER_MAP[id]?.skillId === fx.id) ?? this.leadCharId;
        const pos = this.getSquadMemberWorldPos(elseCasterId);
        const refH = this.getCasterRenderHeight(elseCasterId);
        this.vfx.spawnSkillEffect(fx.id, this.camera, pos.x, pos.y, pos.z);
        this.skillFx3D.spawn(
          fx.id,
          pos.x,
          pos.y,
          pos.z,
          fx.color,
          fx.accentColor,
          undefined,
          refH,
          () => {
            const p = this.getSquadMemberWorldPos(elseCasterId);
            return { x: p.x, y: p.y, z: p.z };
          },
        );
      }
    }
  }

  private triggerIronRain(): void {
    const activeEnemies = this.enemies
      .filter((enemy) => enemy.active && enemy.lane === this.laneIndex)
      .sort((a, b) => b.root.position.z - a.root.position.z)
      .slice(0, 3);

    if (!activeEnemies.length) return;

    const casterId =
      this.data.squadIds.find((id) => CHARACTER_MAP[id]?.skillId === 'iron_rain') ?? this.data.squadIds[0];
    const base = this.data.squadDamage[casterId ?? ''] ?? this.data.tcp / 10;
    const damage = base * this.skillMods.ironRainDamageMultiplier;
    const slot = Math.max(0, this.data.squadIds.indexOf(casterId ?? ''));
    this.floatText?.spawnWorld(
      {
        x: this.playerRoot.position.x,
        y: this.playerRoot.position.y + 2.4,
        z: this.playerRoot.position.z,
      },
      '锻渣雨幕',
      'skill',
    );
    this.showSkillBanner(
      '锻渣雨幕',
      `熔渣倾泻 · 命中 ${activeEnemies.length} · 伤害 ${Math.round(damage)}`,
      '#ff8840',
    );
    playSkillSfx('iron_rain');
    // P2+：删除原 spawnSkillBurst(scale=1.7) —— 这是铁雨触发瞬间的"白色爆闪"主源。
    // 改为单色环波（无白色中心）作为震感。
    this.vfx.spawnShockRingStack(
      this.playerRoot.position.x,
      this.playerRoot.position.y + 1.2,
      this.playerRoot.position.z,
      '#ff8840',
      '#ffaa50',
    );
    this.triggerScreenShake({ shake: 0.18, intensity: 0.35, fov: 0.25, hitLagSeconds: 0.03 });

    let kills = 0;
    for (const enemy of activeEnemies) {
      const camZ = this.camera.position.z;
      const gy = roadY(enemy.root.position.z, camZ);
      const enemyRefH = Math.max(0.6, (enemy.centerY - gy) * 2);
      this.vfx.spawnIronRainBeam(enemy.root.position.x, enemy.root.position.z, gy);
      // iron_rain 特效锚点 = 敌人位置（钉在目标头上，跟随敌人移动直到 maxLife 结束）。
      this.skillFx3D.spawn(
        'iron_rain',
        enemy.root.position.x,
        gy,
        enemy.root.position.z,
        '#ff8840',
        '#ffaa50',
        undefined,
        enemyRefH,
        () => {
          // 敌人可能中途死掉导致 root.position 异常，保守防御
          if (!enemy.active) return null;
          const camZ2 = this.camera.position.z;
          const gy2 = roadY(enemy.root.position.z, camZ2);
          return { x: enemy.root.position.x, y: gy2, z: enemy.root.position.z };
        },
      );
      enemy.hp -= damage;
      this.floatText?.spawnWorld(
        { x: enemy.root.position.x, y: enemy.centerY + 1.0, z: enemy.root.position.z },
        `${Math.round(damage)}`,
        'damage',
        slot,
      );
      if (enemy.hp <= 0) {
        if (enemy.boss) {
          this.vfx.spawnHeavyKillBurst(enemy.root.position.x, enemy.centerY, enemy.root.position.z, '#ff8866');
        } else {
          this.vfx.spawnKillBurst(enemy.root.position.x, enemy.centerY, enemy.root.position.z, enemy.boss);
        }
        this.removeEnemy(enemy);
        this.kills++;
        this.comboKills++;
        kills++;
      }
    }
    if (kills > 0) playKillSfx(kills > 1 || activeEnemies.some((e) => e.boss));
  }

  /** 敌人碰撞或漏过：各计 1 次通过；超过 passLimit 才判负。碰撞时被撞角色义体扣血 */
  private registerEnemyPass(e: Entity3D, reason: 'hit' | 'leak'): void {
    if (!e.active || this.finished) return;
    this.removeEnemy(e);
    this.passCount += 1;

    const py = this.playerRoot.position.y + 2.2;
    if (reason === 'hit') {
      const dmg = Math.max(1, Math.ceil(combatHitDamage(this.data.stage, 'grunt') * (1 - Math.min(0.35, this.skillMods.shieldBonus))));
      this.applyLaneSquadHits(dmg);
      const py = this.playerRoot.position.y + 2.2;
      this.floatText?.spawnWorld(
        { x: this.playerRoot.position.x, y: py + 0.55, z: this.playerRoot.position.z },
        '通过 +1',
        'info',
      );
      if (this.skillMods.shieldBonus > 0) {
        const now = performance.now();
        if (now - this.lastShieldFloatMs > 700) {
          this.lastShieldFloatMs = now;
          this.vfx.spawnShieldPulse(
            this.playerRoot.position.x,
            this.playerRoot.position.y + 1.2,
            this.playerRoot.position.z,
          );
          // 护盾抵消：明显金属 ping
          playShieldSfx();
        }
      } else {
        // 没护盾 → 只跑视觉 vignette，不放语音（用户要求：去掉并删除所有战斗场景中角色受击的语音）
        this.triggerVignette();
      }
    } else {
      this.floatText?.spawnWorld(
        { x: this.playerRoot.position.x, y: py, z: this.playerRoot.position.z },
        '漏过 +1',
        'info',
      );
    }

    this.passEl.classList.toggle('low', this.passCount >= this.passLimit);
    if (this.passCount > this.passLimit) this.endCombat(false);
    this.checkSquadHealthFail();
  }

  private initCombatHealth(squadIds: string[]): void {
    mutateAiLiving((living) => {
      for (const id of squadIds) {
        this.combatHp[id] = getCyberHealth(living as AiLivingSave, id);
      }
    });
    this.refreshHealthHud();
  }

  private formatSquadHealthHud(): string {
    const vals = this.data.squadIds.map((id) => this.combatHp[id] ?? 0);
    if (!vals.length) return '—';
    const min = Math.min(...vals);
    return `最低 ${min}`;
  }

  private refreshHealthHud(): void {
    if (!this.healthEl) return;
    this.healthEl.textContent = `义体 ${this.formatSquadHealthHud()}`;
  }

  private checkSquadHealthFail(): void {
    for (const id of this.data.squadIds) {
      if ((this.combatHp[id] ?? 0) <= 0) {
        this.endCombat(false);
        return;
      }
    }
  }

  private getSquadMemberWorldPos(charId: string): { x: number; y: number; z: number } {
    if (charId === this.leadCharId) {
      return {
        x: this.playerRoot.position.x,
        y: this.playerRoot.position.y + 2.2,
        z: this.playerRoot.position.z,
      };
    }
    const wing = this.squadWings.find((w) => w.charId === charId);
    if (wing) {
      return {
        x: wing.root.position.x,
        y: wing.root.position.y + 2.2,
        z: wing.root.position.z,
      };
    }
    return {
      x: this.playerRoot.position.x,
      y: this.playerRoot.position.y + 2.2,
      z: this.playerRoot.position.z,
    };
  }

  /**
   * 施法角色在场景中的真实渲染身高（米）。给 SkillFx3D 用于按角色体型缩放特效。
   * lead 用 `getPlayerRenderHeight()`；wing 取其 visual.scale.y 与 metrics.height；
   * 兜底返回 2.2。
   */
  private getCasterRenderHeight(charId: string): number {
    if (charId === this.leadCharId) {
      const h = this.getPlayerRenderHeight();
      return h > 0 ? h : 2.2;
    }
    const wing = this.squadWings.find((w) => w.charId === charId);
    if (wing?.visual && wing.visualKind === 'model') {
      const metrics = (wing.visual.userData.combatMetrics as CombatModelMetrics | undefined) ?? null;
      if (metrics) {
        const h = metrics.height * wing.visual.scale.y;
        return h > 0 ? h : 2.2;
      }
    }
    return 2.2;
  }

  /**
   * 当前战线上全体出战角色同时受击：每人闪红 + 扣血飘字；语音/立绘只播一次（队长优先）。
   */
  private applyLaneSquadHits(damage: number, voiceCharId?: string): void {
    const voId = voiceCharId ?? this.leadCharId;
    let voiced = false;

    for (const id of this.data.squadIds) {
      const wear = this.applyHitCyberWear(id, damage);
      const pos = this.getSquadMemberWorldPos(id);
      const name = CHARACTER_MAP[id]?.name ?? id;
      const wearLabel =
        wear.to >= 0 ? `${name} 义体 ${wear.from}→${wear.to}` : `${name} 义体 -${damage}`;
      this.floatText?.spawnWorld(pos, wearLabel, 'info');
      if (!voiced) {
        this.showHitEmotion(voId);
        voiced = true;
      }
    }

    this.flashSquadHurt();
    this.shakeAmount = Math.max(this.shakeAmount, 0.14);
    this.checkSquadHealthFail();
  }

  private applySquadLaneDamage(damage: number): void {
    this.applyLaneSquadHits(damage);
  }

  private spawnRaidBoss(): void {
    const { stage } = this.data;
    const z = SPAWN_Z - 16;
    const entity = this.createEnemyEntity(1, z, true);
    entity.hp = stage.raidBossHp ?? stage.enemyHp * 12;
    entity.maxHp = entity.hp;
    entity.hitHalfW = 2.4;
    entity.hitHalfD = 2.8;
    entity.root.scale.setScalar(2.05);
    entity.centerY = roadY(z, this.camera.position.z) + 3.2;
    this.updateEnemyTransform(entity, 1, z);
    entity.root.position.y = entity.centerY;
    if (entity.visualKind === 'sprite') this.scene.add(entity.root);
    this.enemies.push(entity);
    this.raidBossEntity = entity;
    this.everSpawned = true;
    this.parent.dataset.combatBoss = 'raid';
    this.infoEl.textContent = '⚠ 限时 BOSS';
    this.infoEl.classList.add('boss');
    this.updateBossHpHud();
  }

  private updateRaidBoss(dt: number): void {
    const boss = this.raidBossEntity;
    if (!boss?.active) return;

    this.bossBobPhase += dt * 2.4;
    boss.root.position.y = boss.centerY + Math.sin(this.bossBobPhase) * 0.65;
    this.updateEnemyTransform(boss, boss.lane, boss.root.position.z);

    if (!this.data.autoMode) {
      /* 手动操作换道 */
    } else {
      this.autoMove();
    }

    const fireRate = 320 / (1 + this.skillMods.attackSpeedBonus);
    this.fireTimer += dt * 1000;
    if (this.fireTimer >= fireRate) {
      this.fireTimer = 0;
      this.fire(this.skillMods.projectilePierce);
    }

    this.bossAttackTimer -= dt;
    if (this.bossAttackTimer <= 0) {
      this.bossAttackTimer = this.raidBossAttackCfg.intervalSec;
      const lane = pickRandomBossLane();
      const laneLabel = ['左路', '中路', '右路'][lane] ?? '';
      this.floatText?.spawnWorld(
        { x: LANE_X[lane], y: 5.5, z: boss.root.position.z - 2 },
        `${laneLabel}来袭`,
        'info',
      );
      const delayMs = Math.floor(this.raidBossAttackCfg.telegraphSec * 1000);
      const t = window.setTimeout(() => {
        if (this.finished || this.disposed || !boss.active) return;
        const dmg = bossProjectileDamage(this.data.stage);
        const proj = spawnBossProjectile(
          this.scene,
          lane,
          boss.root.position.z + 2,
          dmg,
          this.raidBossAttackCfg.projectileSpeed,
          this.camera.position.z,
        );
        this.bossProjectiles.push(proj);
        // P2+：删除原 spawnSkillBurst(scale=1.4) —— 这是 boss 攻击瞬间的"白色爆闪"主源。
        // 改为单色环波 + 火花作为震感。
        this.vfx.spawnShockRing(LANE_X[lane], 5.5, boss.root.position.z + 1, '#ff6622', 1.8, 0.3);
        this.vfx.spawnImpactSparks(LANE_X[lane], 5.5, boss.root.position.z + 1, '#ff6622', 4);
      }, delayMs);
      this.spawnTimers.push(t as unknown as ReturnType<typeof setTimeout>);
    }

    updateBossProjectiles(this.bossProjectiles, dt, this.laneIndex, this.camera.position.z, (damage) => {
      this.applyLaneSquadHits(damage);
    });
    this.bossProjectiles = this.bossProjectiles.filter((p) => p.active);

    this.updateBossHpHud();
  }

  private updateBossHpHud(): void {
    if (!this.bossHpEl || !this.raidBossEntity) return;
    const max = this.data.stage.raidBossHp ?? 1;
    const pct = Math.max(0, Math.min(100, Math.round((this.raidBossEntity.hp / max) * 100)));
    this.bossHpEl.textContent = `BOSS ${pct}%`;
    this.lastPassHud = this.bossHpEl.textContent;
  }

  /** 编队中距敌人最近的角色视为被撞目标 */
  private resolveHitCharacterId(enemyX: number): string {
    let bestId = this.leadCharId;
    let bestDist = Math.abs(this.playerRoot.position.x - enemyX);
    for (const wing of this.squadWings) {
      const d = Math.abs(wing.root.position.x - enemyX);
      if (d < bestDist) {
        bestDist = d;
        bestId = wing.charId;
      }
    }
    return bestId;
  }

  private applyHitCyberWear(characterId: string, damage = 1): { from: number; to: number } {
    let from = 0;
    let to = 0;
    const loss = Math.max(1, Math.floor(damage));
    mutateAiLiving((living) => {
      const r = applyCombatCyberHit(living, characterId, this.data.stage.name, loss);
      from = r.from;
      to = r.to;
    });
    if (characterId in this.combatHp) {
      this.combatHp[characterId] = Math.max(0, to);
      this.refreshHealthHud();
    }
    return { from, to };
  }

  private restoreHurtMaterials(): void {
    for (const entry of this.hurtMaterialBackup) {
      entry.mat.color.copy(entry.color);
      if (entry.emissive && 'emissive' in entry.mat && entry.mat.emissive) {
        entry.mat.emissive.copy(entry.emissive);
      }
    }
    this.hurtMaterialBackup = [];
  }

  private collectHurtRoots(characterId?: string): THREE.Object3D[] {
    const roots: THREE.Object3D[] = [];
    if (!characterId) {
      if (this.playerVisual) roots.push(this.playerVisual);
      for (const wing of this.squadWings) {
        if (wing.visual) roots.push(wing.visual);
      }
      return roots;
    }
    if (characterId === this.leadCharId) {
      if (this.playerVisual) roots.push(this.playerVisual);
      return roots;
    }
    for (const wing of this.squadWings) {
      if (wing.charId === characterId && wing.visual) roots.push(wing.visual);
    }
    if (!roots.length && this.playerVisual) roots.push(this.playerVisual);
    return roots;
  }

  private combatEmotionMarkup(kind: 'victory' | 'defeat', characterId = this.leadCharId): string {
    const src = pickCombatEmotionSrc(characterId, kind);
    const vo = kind === 'victory' ? getCombatVoLine(characterId, 'victory') : null;
    const img = src ? `<img src="${texUrl(src)}" alt="" />` : '';
    const line = vo?.text ? `<span class="combat-vo-line">${vo.text}</span>` : '';
    if (!img && !line) return '';
    return `<div class="combat-emotion combat-emotion--${kind}">${img}${line}</div>`;
  }

  private pauseSquadLiveSprites(): void {
    pauseCombatLiveSprites([
      this.playerVisual,
      this.playerRoot,
      ...this.squadWings.map((wing) => wing.visual),
      ...this.squadWings.map((wing) => wing.root),
    ]);
    const fadeLive = (root: THREE.Object3D | null | undefined) => {
      root?.traverse((obj) => {
        if (!obj.userData.combatLiveVideo) return;
        const sprite = obj as THREE.Sprite;
        if (!sprite.isSprite) return;
        (sprite.material as THREE.SpriteMaterial).opacity = 0.12;
      });
    };
    fadeLive(this.playerVisual);
    for (const wing of this.squadWings) fadeLive(wing.visual);
  }

  private hideHitEmotion(immediate = false): void {
    window.clearTimeout(this.hitEmotionTimer);
    this.hitEmotionTimer = 0;
    if (!this.hitEmotionEl) return;

    const finishHide = () => {
      if (!this.hitEmotionEl) return;
      this.hitEmotionEl.classList.remove('is-show', 'is-hiding');
      this.hitEmotionEl.hidden = true;
      this.hitEmotionTimer = 0;
    };

    if (immediate || this.hitEmotionEl.hidden || !this.hitEmotionEl.classList.contains('is-show')) {
      finishHide();
      return;
    }

    this.hitEmotionEl.classList.remove('is-show');
    this.hitEmotionEl.classList.add('is-hiding');
    this.hitEmotionTimer = window.setTimeout(finishHide, HIT_EMOTION_FADE_MS);
  }

  private showHitEmotion(characterId: string): void {
    if (!this.hitEmotionEl || this.finished) return;
    const src = pickCombatEmotionSrc(characterId, 'hit');
    if (!src) return;
    const img = this.hitEmotionEl.querySelector('img');
    if (!img) return;
    img.src = texUrl(src);
    const vo = getCombatVoLine(characterId, 'hit');
    const lineEl = this.hitEmotionEl.querySelector<HTMLElement>('[data-combat-vo-hit]');
    if (lineEl) {
      if (vo?.text) {
        lineEl.textContent = vo.text;
        lineEl.hidden = false;
      } else {
        lineEl.textContent = '';
        lineEl.hidden = true;
      }
    }
    if (vo?.src) {
      // 用户要求：删除敌人接触角色时的声音，但保留表情图片
      // playCombatVo(vo.src);
    }
    this.hitEmotionEl.hidden = false;
    this.hitEmotionEl.classList.remove('is-hiding');
    // 强制重触发入场动画，避免连击时卡在 is-show 终态
    this.hitEmotionEl.classList.remove('is-show');
    void this.hitEmotionEl.offsetWidth;
    this.hitEmotionEl.classList.add('is-show');
    window.clearTimeout(this.hitEmotionTimer);
    this.hitEmotionTimer = window.setTimeout(() => {
      if (this.disposed) return;
      this.hideHitEmotion();
    }, HIT_EMOTION_MS);
  }

  private flashSquadHurt(characterIds: string[] = this.data.squadIds): void {
    this.hurtFlashToken += 1;
    const token = this.hurtFlashToken;
    this.restoreHurtMaterials();
    this.passEl.classList.add('hurt');

    for (const id of characterIds) {
      for (const root of this.collectHurtRoots(id)) {
        root.traverse((obj) => {
          const sprite = obj as THREE.Sprite;
          if (sprite.isSprite) {
            const mat = sprite.material as THREE.SpriteMaterial;
            this.hurtMaterialBackup.push({ mat, color: mat.color.clone() });
            mat.color.setHex(0xff2a2a);
            return;
          }
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh || !mesh.material) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const raw of mats) {
            if (!raw || !('color' in raw) || !(raw as { color?: unknown }).color) continue;
            const mat = raw as THREE.MeshStandardMaterial;
            if (!(mat.color instanceof THREE.Color)) continue;
            const emissive = mat.emissive instanceof THREE.Color ? mat.emissive.clone() : undefined;
            this.hurtMaterialBackup.push({ mat, color: mat.color.clone(), emissive });
            mat.color.setHex(0xff3333);
            if (emissive) mat.emissive.setHex(0xaa0000);
          }
        });
      }
    }

    window.setTimeout(() => {
      if (this.disposed || token !== this.hurtFlashToken) return;
      this.restoreHurtMaterials();
      this.passEl.classList.remove('hurt');
    }, 180);
  }

  private flashPlayerHurt(characterId?: string): void {
    this.flashSquadHurt(characterId ? [characterId] : this.data.squadIds);
  }

  private removeEnemy(e: Entity3D): void {
    if (e.active && e.visualKind === 'model') this.aliveEnemyCount = Math.max(0, this.aliveEnemyCount - 1);
    e.active = false;
    if (e.visualKind === 'model') {
      if (e.instanceId !== undefined) {
        this.releaseEnemyInstanceId(e.instanceId);
      } else {
        this.scene.remove(e.root);
        disposeCombatEnemyInstance(e.root);
        e.root.clear();
      }
    } else {
      this.scene.remove(e.root);
      const sprite = e.root.children[0] as THREE.Sprite | undefined;
      if (sprite) this.disposeSprite(sprite);
      e.root.clear();
    }
  }

  private disposeSprite(sprite: THREE.Sprite): void {
    if (disposeCombatLiveSprite(sprite)) return;
    const mat = sprite.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.dispose();
  }

  private endCombat(victory: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.spawnTimers.forEach(clearTimeout);
    delete this.parent.dataset.combatBoss;

    if (victory) {
      this.showVictoryOverlay();
      return;
    }

    this.showDefeatOverlay();
  }

  /** 强制退出：不结算奖励、进度与损失 */
  private abortCombat(): void {
    void this.confirmAbort();
  }

  private async confirmAbort(): Promise<void> {
    if (this.finished || this.disposed) return;
    const ok = await showConfirm({
      title: '退出关卡',
      message: '确定退出当前关卡？\n不会获得奖励，也不会记录进度或损失。',
      confirmLabel: '退出',
      danger: true,
    });
    if (!ok) return;

    this.finished = true;
    this.spawnTimers.forEach(clearTimeout);
    delete this.parent.dataset.combatBoss;
    this.data.onComplete({ victory: false, kills: 0, aborted: true });
    this.dispose();
  }

  private showDefeatOverlay(): void {
    this.hideHitEmotion(true);
    this.pauseSquadLiveSprites();
    const overlay = document.createElement('div');
    overlay.className = 'combat-result combat-result-panel';
    overlay.innerHTML = `
      ${this.combatEmotionMarkup('defeat')}
      <div class="combat-result-panel-body">
        <div class="lose">❌ 失败</div>
        <div class="combat-result-sub">击杀 ${this.kills} · 义体 ${this.formatSquadHealthHud()}</div>
        <p class="combat-result-hint">${this.raidBossMode ? '限时内未击破 BOSS 或义体耗尽' : '敌人通过次数超限，强化武器或调整走位后再来'}</p>
        <button class="btn btn-primary" data-close-combat-result type="button">确认</button>
      </div>`;
    this.parent.appendChild(overlay);
    overlay.querySelector('[data-close-combat-result]')?.addEventListener(
      'click',
      () => {
        this.data.onComplete({ victory: false, kills: this.kills });
        this.dispose();
      },
      { once: true },
    );
  }

  private showVictoryOverlay(): void {
    this.hideHitEmotion(true);
    this.pauseSquadLiveSprites();
    this.clearCombatProjectiles();
    const { stage, stageWasCleared } = this.data;
    const rewardLine = stageWasCleared
      ? '重复通关无首通奖励'
      : `首通 +${stage.firstClearGold} 锈币`;
    const overlay = document.createElement('div');
    overlay.className = 'combat-result combat-result-panel';
    overlay.innerHTML = `
      ${this.combatEmotionMarkup('victory')}
      <div class="combat-result-panel-body">
        <div class="win">✅ 胜利</div>
        <div class="combat-result-sub">击杀 ${this.kills}</div>
        <div class="combat-result-reward">${rewardLine}</div>
        <button class="btn btn-primary" data-close-combat-result type="button">确认</button>
      </div>`;
    this.parent.appendChild(overlay);
    const victoryVo = getCombatVoLine(this.leadCharId, 'victory');
    if (victoryVo?.src) playCombatVo(victoryVo.src);
    overlay.querySelector('[data-close-combat-result]')?.addEventListener(
      'click',
      () => {
        this.data.onComplete({ victory: true, kills: this.kills });
        this.dispose();
      },
      { once: true },
    );
  }

  private clearCombatProjectiles(): void {
    for (const bullet of this.bullets) {
      if (!bullet.active) continue;
      bullet.active = false;
      this.scene.remove(bullet.mesh);
    }
    this.bullets = [];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.restoreHurtMaterials();
    this.hideHitEmotion(true);
    stopCombatVo();
    this.spawnTimers.forEach(clearTimeout);
    if (this.skillBannerTimer) window.clearTimeout(this.skillBannerTimer);
    if (this.vignetteTimer) window.clearTimeout(this.vignetteTimer);
    if (this.critFlashTimer) window.clearTimeout(this.critFlashTimer);
    cancelAnimationFrame(this.raf);

    const onKey = (this as any)._onKey;
    if (onKey) window.removeEventListener('keydown', onKey);
    const onPointer = (this as any)._onPointer;
    if (onPointer) this.renderer?.domElement.removeEventListener('pointerdown', onPointer);
    if (this.onResize) {
      window.removeEventListener('resize', this.onResize);
      window.visualViewport?.removeEventListener('resize', this.onResize);
      window.visualViewport?.removeEventListener('scroll', this.onResize);
    }

    this.vfx?.dispose();
    this.skillFx3D?.dispose();
    this.postFx?.dispose();
    this.env?.dispose();
    this.floatText?.dispose();
    this.floatText = null;
    this.enemyHpBars?.dispose();
    this.enemyHpBars = null;
    if (this.enemyInstancedMesh) {
      this.scene.remove(this.enemyInstancedMesh);
      this.enemyInstancedMesh = null;
    }
    this.renderer?.dispose();
    this.clearPlayerVisual();
    for (const wing of this.squadWings) {
      if (wing.visualKind === 'sprite' && wing.visual) this.disposeSprite(wing.visual as THREE.Sprite);
      if (wing.visualKind === 'model' && wing.visual) disposeCombatModelInstance(wing.visual as THREE.Group);
      this.scene?.remove(wing.root);
      wing.root.clear();
    }
    this.squadWings.length = 0;
    delete this.parent.dataset.combatQuality;
    delete this.parent.dataset.combatBoss;
    delete this.parent.dataset.playerVisual;
    this.parent.innerHTML = '';
  }
}

export function startCombat3D(parent: HTMLElement, data: CombatSceneData): Combat3D {
  const combat = new Combat3D(parent, data);
  combat.start();
  return combat;
}

export type { CombatSceneData as Combat3DData };

/** "#rrggbb" -> "r, g, b"，用于 CSS color-mix / rgba(var(--skill-color-rgb), 0.3) */
function hexToRgbStr(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '255, 255, 255';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}`;
}
