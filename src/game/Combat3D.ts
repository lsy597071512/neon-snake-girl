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
  createGlowTexture,
  resetBulletTextureCache,
  getCombatEnemyTexture,
  type CombatEnemyKind,
} from './textureUtils';
import { getCharAvatarSrc, getCombatPortraitSrc, getCombatModelSrc, getCombatShootIdleSrc } from '../ui/uiAssets';
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
  /** 首战技能指引： Correspondence 角色下方按钮首次就绪时冒泡提示 */
  showSkillGuide?: boolean;
  /** 技能指引展示/释放后回调（用于落存档，避免重复打扰） */
  onSkillGuideDone?: () => void;
  /** 首个 BOSS 战规则指引：限时击杀/吃控减半/超时全灭即败 */
  showBossGuide?: boolean;
  /** BOSS 指引展示后回调 */
  onBossGuideDone?: () => void;
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
  /** 定身结束时间（performance.now() 时间戳 embargo：期间不移动不攻击） */
  stunUntilMs?: number;
  /** 灼烧秒伤（释放者弹伤 x 倍率预计算） */
  burnDps?: number;
  /** 灼烧结束时间（performance.now() 时间戳） */
  burnUntilMs?: number;
  /** 灼烧跳伤累计器（秒） */
  burnTickAcc?: number;
  /** 击退速度（z 轴，负值=远离玩家，指数衰减） */
  knockbackV?: number;
  /** 受击后仰（0~1.2，击退力度越大越倒，每帧衰减，模型后旋转、贴图怪挤压） */
  topple?: number;
  boss?: boolean;
  active: boolean;
  hitHalfW: number;
  hitHalfD: number;
  centerY: number;
  instanceId?: number;
}

/** 主动技能：多段斩击队列（neoncoil 三连斩 / frostline 白夜处刑） */
interface PendingStrike {
  charId: string;
  remaining: number;
  timerMs: number;
  intervalMs: number;
  mult: number;
  color: string;
  label: string;
  /** 白夜处刑对 Boss 继承暴击加成 */
  bossCritInherit: boolean;
}

/** 主动技能：延迟爆炸（prismrift 熔城一炮） */
interface PendingBlast {
  charId: string;
  delayMs: number;
  z: number;
  radiusZ: number;
  mult: number;
  color: string;
  label: string;
  burnDpsMult: number;
  burnSec: number;
  /** 指定目标 id（被动雨幕逐发点名；不填则按半径范围） */
  targetIds?: number[];
  /** 落点反馈倍率（默认 1；熔城 1.8，被动雨幕 1.2） */
  impactMul?: number;
  /** 落点 x（默认 0 中央；点名时用目标 x） */
  x?: number;
  /** 炮弹飞行：起点/速度/已飞时间（尾迹用），飞行=蓄力 */
  startZ: number;
  startX: number;
  startY: number;
  speed: number;
  elapsedMs: number;
  trailAcc: number;
}

/** 主动技能：飞行弹体（dustblade 绯雨利爪 / outercore 爱心弹） */
interface SkillShot {
  charId: string;
  lane: number;
  x: number;
  y: number;
  z: number;
  targetZ: number;
  speed: number;
  /** 落点爆炸 z 半径（0=单体直伤） */
  radiusZ: number;
  mult: number;
  pierce: number;
  color: string;
  label: string;
  /** 爆炸时全队回血（爱心弹） */
  heal: number;
  sprite: THREE.Sprite | null;
  trailAcc: number;
  exploded: boolean;
}

/** 风刃横扫逻辑体：与 3D 刃体同速推进，撞到谁砍谁 */
interface BladeSweep {
  charId: string;
  lane: number;
  z: number;
  speed: number;
  base: number;
  hitIds: Set<number>;
  life: number;
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
  /** 命中火花覆盖色（绯雨利爪粉等特殊弹种） */
  hitColor?: string;
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
  private lastShieldFloatMs = 0;
  private lastPierceFxMs = 0;
  private lastImmuneMs = 0;
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
  /** 主动技能冷却按下档：重型核弹 8 秒 / 中型连击 7 秒 / 轻型速转 6 秒（无能量系统，纯时间+按钮触发） */
  private readonly manualSkillCooldownMs = 8000;
  private readonly manualSkillCooldowns: Record<string, number> = {};
  private readonly manualSkillButtons = new Map<string, HTMLButtonElement>();
  /** 技能跟随：按钮屏幕 X 缓存（1px 阈值写入，避免每帧刷 DOM） */
  private readonly skillBtnScreenX = new Map<string, number>();
  private readonly skillProjVec = new THREE.Vector3();
  /** 首战技能指引气泡（仅 stage1 一次，就绪才冒，释放/12秒/结算即撤） */
  private skillGuideEl: HTMLElement | null = null;
  private skillGuideFired = false;
  private skillGuideTimer = 0;
  /** 胜负规则/BOSS 规则顶栏气泡（首战与首 BOSS 各一次，先于技能泡） */
  private ruleGuideEl: HTMLElement | null = null;
  private ruleGuideTimer = 0;
  private bossGuideShown = false;
  /** 首战暂停教学：开场冻结讲解左上数值与胜负条件，点了才开打 */
  private tutorialPaused = false;
  private tutPauseEl: HTMLElement | null = null;
  /** 主动技能增益/控制时间戳（performance.now()，毫秒） */
  private shieldGuardUntilMs = 0;
  private weaveHuntUntilMs = 0;
  private riftChorusUntilMs = 0;
  private ironHasteUntilMs = 0;
  private frostDomainUntilMs = 0;
  private globalSlowUntilMs = 0;
  private globalSlowMul = 1;
  private globalStunUntilMs = 0;
  /** 延迟结算队列 */
  private readonly pendingStrikes: PendingStrike[] = [];
  private readonly pendingBlasts: PendingBlast[] = [];
  private readonly skillShots: SkillShot[] = [];
  private readonly bladeSweeps: BladeSweep[] = [];
  /** 敌人状态环：定身金 / 冰冻蓝 / 灼烧橙，挂在敌人 root 下跟随 */
  private readonly enemyStatusRings = new Map<number, { obj: THREE.Object3D; kind: 'stun' | 'frost' | 'burn' }>();
  /** 倒下变灰备份（与受击闪红备份独立，互不冲掉） */
  private readonly downDimBackup: Array<{ charId: string; mat: { color: THREE.Color }; color: THREE.Color }> = [];
  private readonly downHiddenWings = new Set<string>();
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
      ${this.buildManualSkillColumnHtml(squadIds)}
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
    this.manualSkillButtons.clear();
    this.hudEl.querySelectorAll<HTMLButtonElement>('[data-manual-skill]').forEach((button) => {
      const charId = button.dataset.manualSkill ?? '';
      if (!charId) return;
      this.manualSkillCooldowns[charId] = Math.floor(this.activeSkillCooldown(charId) / 2);
      this.manualSkillButtons.set(charId, button);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.releaseManualSkill(charId);
        if (charId === this.data.squadIds[0]) this.dismissSkillGuide();
      });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.releaseManualSkill(charId);
          if (charId === this.data.squadIds[0]) this.dismissSkillGuide();
        }
      });
    });
    this.updateManualSkillHud();
    this.layoutManualSkillButtons(true);
    this.buildSkillGuide();
    this.buildTutPause();
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
        this.enemyInstanceDummy.rotation.set(-0.55 * (entity.topple ?? 0), COMBAT_ENEMY_YAW_BATTLE, 0);
        this.enemyInstanceDummy.scale.setScalar(uniform);
        this.enemyInstanceDummy.updateMatrix();
        this.enemyInstancedMesh.setMatrixAt(entity.instanceId, this.enemyInstanceDummy.matrix);
        this.enemyInstanceMatrixDirty = true;
      } else {
        const modelRoot = entity.root.children[0] as THREE.Object3D | undefined;
        if (modelRoot) {
          modelRoot.rotation.set(-0.55 * (entity.topple ?? 0), COMBAT_ENEMY_YAW_BATTLE, 0);
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

  private buildManualSkillColumnHtml(squadIds: string[]): string {
    if (!squadIds.length) return '';
    const rarityColor: Record<string, string> = {
      UR: '#ffd54f',
      SSR: '#c07bff',
      SR: '#2ecbff',
      R: '#9fb2c8',
    };
    const buttons = squadIds
      .map((id, index) => {
        const char = CHARACTER_MAP[id];
        const skillName = char?.skillName ?? '技能';
        const short = skillName.length > 2 ? skillName.slice(-2) : skillName;
        const avatarSrc = getCharAvatarSrc(id);
        const avatar = avatarSrc ? texUrl(avatarSrc) : '';
        const frame = rarityColor[char?.rarity ?? ''] ?? '#9fb2c8';
        const icon = avatar
          ? `<img class="combat-skill-avatar" src="${avatar}" alt="" draggable="false" onerror="this.style.display='none'" />`
          : `<span class="combat-skill-name combat-skill-name--fallback">${short}</span>`;
        return `<button class="combat-active-skill" data-manual-skill="${id}" type="button" aria-label="${skillName}，冷却${Math.round(this.activeSkillCooldown(id) / 1000)}秒" style="--rarity:${frame}"><span class="combat-skill-order">${index + 1}</span>${icon}<span class="combat-skill-tag">${short}</span></button>`;
      })
      .join('');
    return `<div class="combat-skill-column" data-skill-column><div class="combat-skill-tip">技能</div>${buttons}</div>`;
  }

  private pickManualSkillTarget(): Entity3D | null {
    const actives = this.enemies.filter((enemy) => enemy.active);
    if (!actives.length) return null;
    return (
      actives
        .filter((enemy) => enemy.boss)
        .sort((a, b) => b.root.position.z - a.root.position.z)[0] ??
      actives.sort((a, b) => b.root.position.z - a.root.position.z)[0] ??
      null
    );
  }

  private releaseManualSkill(charId: string): void {
    if (this.finished || (this.manualSkillCooldowns[charId] ?? 0) > 0) return;
    if (this.isUnitDown(charId)) return;
    switch (charId) {
      case 'ashcrow': return this.execGalePierce(charId);
      case 'heartforge': return this.execAegisGuard(charId);
      case 'mirror': return this.execWeaveNet(charId);
      case 'neoncoil': return this.execTripleSlash(charId);
      case 'prismrift': return this.execMeltdownCannon(charId);
      case 'wireguard': return this.execJammerPulse(charId);
      case 'frostline': return this.execWhiteNight(charId);
      case 'pulse': return this.execSpectrumChorus(charId);
      case 'dustblade': return this.execCrimsonClaws(charId);
      case 'ironrain': return this.execHeatRelease(charId);
      case 'skyshard': return this.execFrostDomain(charId);
      case 'stellar': {
        const target = this.pickManualSkillTarget();
        if (!target) return;
        return this.execFinalLight(charId, target);
      }
      case 'outercore': return this.execHeartSeed(charId);
      default: return;
    }
  }

  private updateManualSkillHud(): void {
    for (const [charId, button] of this.manualSkillButtons) {
      const remaining = Math.max(0, this.manualSkillCooldowns[charId] ?? 0);
      const down = this.isUnitDown(charId);
      const ready = remaining <= 0 && !down;
      button.classList.toggle('is-ready', ready);
      button.classList.toggle('is-down', down);
      button.disabled = !ready;
      button.setAttribute('aria-disabled', ready ? 'false' : 'true');
    }
  }

  /**
   * 主动技能按钮跟随：每个按钮贴在对应角色正下方，左右换道时一起平移。
   * 取角色 root 世界坐标投影到屏幕只用 X；Y 固定在底部换道条上方一行（CSS 管），
   * 保证拇指可达且不挡角色。冷却/倒下/释放逻辑一律不动。
   */
  private layoutManualSkillButtons(force = false): void {
    if (!this.manualSkillButtons.size || this.finished) return;
    const w = this.renderer.domElement.clientWidth;
    if (!w) return;
    const v = this.skillProjVec;
    for (const charId of this.data.squadIds) {
      const button = this.manualSkillButtons.get(charId);
      if (!button) continue;
      const wing = this.squadWings.find((item) => item.charId === charId);
      const worldPos = wing ? wing.root.position : this.playerRoot.position;
      v.copy(worldPos).project(this.camera);
      if (v.z > 1) continue;
      const x = (v.x * 0.5 + 0.5) * w;
      const last = this.skillBtnScreenX.get(charId);
      if (!force && last !== undefined && Math.abs(last - x) < 1) continue;
      this.skillBtnScreenX.set(charId, x);
      button.style.left = `${x.toFixed(1)}px`;
      if (this.skillGuideEl && !this.skillGuideEl.hidden && charId === this.data.squadIds[0]) {
        this.skillGuideEl.style.left = `${x.toFixed(1)}px`;
      }
    }
  }

  /** 首战技能指引气泡：只建一次，首个角色技能就绪才冒泡 */
  private buildSkillGuide(): void {
    if (this.skillGuideTimer) {
      window.clearTimeout(this.skillGuideTimer);
      this.skillGuideTimer = 0;
    }
    this.skillGuideEl?.remove();
    this.skillGuideEl = null;
    this.skillGuideFired = false;
    if (!this.data.showSkillGuide || !this.data.squadIds.length) return;
    const first = CHARACTER_MAP[this.data.squadIds[0] ?? ''];
    const el = document.createElement('div');
    el.className = 'combat-skill-guide';
    el.hidden = true;
    el.innerHTML = `<span>点我释放${first?.skillName ?? '主动技'}</span><i></i>`;
    this.hudEl.appendChild(el);
    this.skillGuideEl = el;
    // BOSS 规则顶栏泡：首个 BOSS 战一次（首战规则由暂停卡讲解，不再重复顶栏泡）
    if (this.data.showBossGuide) {
      this.showRuleBubble('BOSS 战：倒计时内击杀。BOSS 不吃定身减速，击退大打折扣，灼烧直伤照收。超时或全灭即失败。', 12000, true);
    }
  }

  private showRuleBubble(text: string, timeoutMs: number, isBoss = false): void {
    if (this.ruleGuideTimer) {
      window.clearTimeout(this.ruleGuideTimer);
      this.ruleGuideTimer = 0;
    }
    this.ruleGuideEl?.remove();
    const r = document.createElement('div');
    r.className = 'combat-skill-guide combat-rule-guide';
    r.innerHTML = `<span>${text}</span>`;
    this.hudEl.appendChild(r);
    this.ruleGuideEl = r;
    if (isBoss) this.bossGuideShown = true;
    this.ruleGuideTimer = window.setTimeout(() => {
      this.ruleGuideEl?.remove();
      this.ruleGuideEl = null;
      if (isBoss && this.bossGuideShown) {
        this.bossGuideShown = false;
        this.data.onBossGuideDone?.();
      }
    }, timeoutMs);
  }

  /** 撤规则泡（技能泡接棒/手动清理，不落 BOSS 档，结算另行处理） */
  private clearRuleBubble(): void {
    if (this.ruleGuideTimer) {
      window.clearTimeout(this.ruleGuideTimer);
      this.ruleGuideTimer = 0;
    }
    if (this.ruleGuideEl) {
      this.ruleGuideEl.remove();
      this.ruleGuideEl = null;
    }
  }

  /**
   * 首战暂停教学：开场即冻结整条世界时间线（渲染继续），全屏面板讲左上数值与胜负条件。
   * 点“继续”才开打；附退出战斗口，避免与强制引导叠加时无路可退。
   */
  private buildTutPause(): void {
    if (!this.data.showSkillGuide || this.data.stage.id !== 1) return;
    this.tutPauseEl?.remove();
    const el = document.createElement('div');
    el.className = 'combat-tut-pause';
    el.innerHTML = `<div class="combat-tut-card">
      <strong>战斗暂停 · 先看左上角</strong>
      <p><b>倒计时</b>本关剩余时间，归零即失败</p>
      <p><b>通过</b>已击破 / 目标数，<b>波次</b>当前 / 总共</p>
      <p><b>义体最低</b>全队最低血量，有人归零即倒下</p>
      <p>胜利：打完所有波次且有人站着。失败：全员倒下或倒计时走完。</p>
      <div class="combat-tut-actions">
        <button type="button" data-tut-go>知道了，继续战斗</button>
        <button type="button" data-tut-exit>退出战斗</button>
      </div>
    </div>`;
    // 挂到战斗根（而非 HUD 内）：HUD 根 z-index 低于敌方血条层，暂停卡必须盖过一切
    this.parent.appendChild(el);
    this.tutPauseEl = el;
    this.tutorialPaused = true;
    el.querySelector('[data-tut-go]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.tutorialPaused = false;
      el.remove();
      if (this.tutPauseEl === el) this.tutPauseEl = null;
    });
    el.querySelector('[data-tut-exit]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.tutorialPaused = false;
      el.remove();
      if (this.tutPauseEl === el) this.tutPauseEl = null;
      this.abortCombat();
    });
  }

  private updateSkillGuide(): void {
    if (this.finished) {
      this.dismissSkillGuide();
      const hadBoss = this.bossGuideShown;
      this.clearRuleBubble();
      if (hadBoss) {
        this.bossGuideShown = false;
        this.data.onBossGuideDone?.();
      }
      return;
    }
    const el = this.skillGuideEl;
    if (!el || this.skillGuideFired || !el.hidden) return;
    const firstId = this.data.squadIds[0];
    if (!firstId) return;
    if ((this.manualSkillCooldowns[firstId] ?? 1) > 0 || this.isUnitDown(firstId)) return;
    this.skillGuideFired = true;
    el.hidden = false;
    // 技能泡接棒：普通规则泡撤下；BOSS 泡保留到计时/结算（规则不同屏打架）
    if (!this.bossGuideShown) this.clearRuleBubble();
    this.skillGuideTimer = window.setTimeout(() => this.dismissSkillGuide(), 12000);
  }

  private dismissSkillGuide(): void {
    if (this.skillGuideTimer) {
      window.clearTimeout(this.skillGuideTimer);
      this.skillGuideTimer = 0;
    }
    const had = this.skillGuideEl != null || this.skillGuideFired;
    if (this.skillGuideEl) {
      this.skillGuideEl.remove();
      this.skillGuideEl = null;
    }
    if (had) this.data.onSkillGuideDone?.();
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
      hp: boss
        ? this.data.stage.enemyHp * 8 * (this.data.stage.isBoss && !this.raidBossMode ? 1.25 : 1)
        : this.data.stage.enemyHp,
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
    if (!this.isUnitDown(this.leadCharId)) {
      this.fireFromUnit(
        this.leadCharId,
        this.playerRoot.position.x,
        this.getPlayerMuzzleY(),
        this.playerRoot.position.y,
        this.playerRoot.position.z,
        remainingHits,
        opts?.fromTriple ? '翠翼连闪' : undefined,
      );
    }
    for (const wing of this.squadWings) {
      if (this.isUnitDown(wing.charId)) continue;
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
    // 增益中的普攻要有视觉变化：齐鸣=绿、织网=金（织网优先度低），否则默认蓝
    const nowMs = performance.now();
    const inChorus = nowMs < this.riftChorusUntilMs;
    const inWeave = nowMs < this.weaveHuntUntilMs;
    const muzzleColor = inChorus ? '#7CFF4A' : inWeave ? '#ffd54f' : charId === 'dustblade' ? '#ff5e8a' : '#2ecbff';
    this.vfx.spawnMuzzle(this.camera, muzzleOrigin, muzzleColor);
    if (inChorus) {
      this.vfx.spawnImpactSparks(muzzleOrigin.x, muzzleOrigin.y, muzzleOrigin.z, '#7CFF4A', 1);
    }
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
    // 首战暂停教学：时间冻结（渲染继续），点了继续才推进
    if (this.tutorialPaused) deltaMs = 0;
    // P2：命中/暴击的短促减速（hit-lag）：命中瞬间把"世界时间"放慢 6x
    if (this.hitLag > 0 && deltaMs > 0) {
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
    let skillHudDirty = false;
    for (const charId of Object.keys(this.manualSkillCooldowns)) {
      if (this.manualSkillCooldowns[charId] > 0) {
        this.manualSkillCooldowns[charId] = Math.max(0, this.manualSkillCooldowns[charId] - delta);
        skillHudDirty = true;
      }
    }
    if (skillHudDirty) this.updateManualSkillHud();
    this.layoutManualSkillButtons();
    this.updateSkillGuide();
    this.processSkillQueues(delta);
    this.syncStatusRings(performance.now(), dt);
    if (!this.finished && this.data.squadIds.length > 0) this.checkSquadHealthFail();

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
      this.skillFx3D.update(dt);
      this.floatText?.update(dt);
      this.applyCameraEffects(dt);
      this.updateRaidBoss(dt);
      this.updatePlayerBullets(dt);
      this.checkHits();
      this.tickRaidSkillSystems(dt);
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

    const chorusBonus = performance.now() < this.riftChorusUntilMs ? 0.4 : 0;
    const fireRate = 350 / (1 + this.skillMods.attackSpeedBonus + chorusBonus);
    this.fireTimer += delta;
    if (this.fireTimer >= fireRate) {
      this.fireTimer = 0;
      const remainingHits = this.skillMods.projectilePierce;
      this.fire(remainingHits);
      if (
        this.skillMods.tripleShotEnabled &&
        this.tripleCooldown <= 0 &&
        this.comboKills >= (performance.now() < this.riftChorusUntilMs ? 2 : this.skillMods.tripleShotTriggerKills)
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
        this.showSkillBanner('翠翼连闪', '被动触发 · 连击3杀自动三连射', '#7CFF4A');
        playSkillSfx('resonance_burst');
        // 连闪包装：施法者三线齐射最近三敌 + 绿色落点（伤害仍走三次齐射子弹，数值不动）
        // 被动连闪=小规格（手动技能才用大规格）：线细、无十字、不抢风头
        this.skillImpactFx(this.playerRoot.position.x, muzzleY, this.playerRoot.position.z, '#7CFF4A', 0.7);
        {
          const tripleFx = this.enemies
            .filter((enemy) => enemy.active && enemy.lane === this.laneIndex)
            .sort((a, b) => b.root.position.z - a.root.position.z)
            .slice(0, 3);
          for (const e of tripleFx) {
            this.skillFx3D.spawnSlashLine(
              this.playerRoot.position.x, muzzleY, this.playerRoot.position.z,
              e.root.position.x, e.centerY, e.root.position.z,
              '#7CFF4A', 0.3, 0.4,
            );
            this.vfx.spawnHalo(e.root.position.x, e.centerY + 0.3, e.root.position.z, '#7CFF4A', 4, 0.7, 0.8);
          }
          // （被动连闪不画十字，十字是手动大招规格）
        }
        this.triggerScreenShake({ shake: 0.06, intensity: 0.1, fov: 0.08, hitLagSeconds: 0.01 });
        setTimeout(() => !this.finished && this.fire(remainingHits, { fromTriple: true }), 100);
        setTimeout(() => !this.finished && this.fire(remainingHits, { fromTriple: true }), 200);
        this.tripleCooldown = this.skillMods.tripleShotCooldown;
        this.comboKills = 0;
      }
    }
    if (this.tripleCooldown > 0) this.tripleCooldown -= delta;

    if (this.skillMods.ironRainEnabled && !this.isUnitDown(this.data.squadIds.find((id) => CHARACTER_MAP[id]?.skillId === 'iron_rain') ?? '')) {
      this.ironRainTimer += delta;
      const rainInterval = performance.now() < this.ironHasteUntilMs ? 4000 : this.skillMods.ironRainInterval;
      if (this.ironRainTimer >= rainInterval) {
        this.ironRainTimer = 0;
        this.triggerIronRain();
      }
    }

    this.floatText?.update(dt);

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
      let controlMul = e.slowMultiplier ?? 1;
      if (!e.boss && now < this.globalStunUntilMs) controlMul = 0;
      else if (!e.boss && now < this.globalSlowUntilMs) controlMul = Math.min(controlMul, this.globalSlowMul);
      e.root.position.z += approachSpeed * controlMul * dt;
      if (e.knockbackV) {
        e.root.position.z += e.knockbackV * dt;
        e.knockbackV *= Math.max(0, 1 - dt * 6);
        if (Math.abs(e.knockbackV) < 0.2) e.knockbackV = 0;
        if (e.root.position.z < SPAWN_Z - 15) e.root.position.z = SPAWN_Z - 15;
      }
      if (e.burnUntilMs !== undefined && now < e.burnUntilMs && (e.burnDps ?? 0) > 0) {
        e.burnTickAcc = (e.burnTickAcc ?? 0) + dt;
        if (e.burnTickAcc >= 0.5) {
          const tickDmg = (e.burnDps ?? 0) * e.burnTickAcc;
          e.burnTickAcc = 0;
          this.vfx.spawnImpactSparks(e.root.position.x, e.centerY, e.root.position.z, '#ff5522', 2);
          this.dealSkillDamage(e, tickDmg, { quiet: true, noShatter: true });
        }
      } else if (e.burnUntilMs !== undefined && now >= e.burnUntilMs) {
        e.burnUntilMs = undefined;
        e.burnDps = 0;
      }
      if ((e.topple ?? 0) > 0) e.topple = Math.max(0, (e.topple ?? 0) - dt * 1.8);
      this.updateEnemyTransform(e, e.lane, e.root.position.z);
      if ((e.topple ?? 0) > 0 && e.visualKind === 'sprite') {
        const sp = e.root.children[0] as THREE.Sprite | undefined;
        if (sp) {
          sp.scale.x *= 1 + 0.35 * (e.topple ?? 0);
          sp.scale.y *= 1 - 0.2 * (e.topple ?? 0);
        }
      }

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
          const nowHitMs = performance.now();
          const weaving = nowHitMs < this.weaveHuntUntilMs;
          const chorusing = nowHitMs < this.riftChorusUntilMs;
          // 绯尾在场时她的子弹全程粉色：存在感拉满，穿不穿都认得出来
          const dustBullet = b.sourceCharId === 'dustblade';
          const damage = b.damage * critMul * (weaving ? 1.35 : 1);
          e.hp -= damage;
          if (weaving) this.applyEnemyKnockback(e, -8);
          b.remainingHits -= 1;
          const piercedThrough = b.remainingHits >= 0;
          if (b.remainingHits < 0) {
            b.active = false;
            this.scene.remove(b.mesh);
          }

          // P2：命中主视觉 = 中心 glow + 火花（取消环波，纯火花残片感）
          this.vfx.spawnHit(e.root.position.x, e.centerY, e.root.position.z, e.boss);
          this.vfx.spawnImpactSparks(e.root.position.x, e.centerY, e.root.position.z, chorusing ? '#7CFF4A' : weaving ? '#ffd54f' : b.hitColor ?? (dustBullet ? '#ff5e8a' : e.boss ? '#ff8866' : '#a8e8ff'), 4);
          this.vfx.spawnImpactSparks(e.root.position.x, e.centerY + 0.6, e.root.position.z, '#ffffff', 2);

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

          const pierceNow = performance.now();
          if (piercedThrough && this.skillMods.projectilePierce > 0 && pierceNow - this.lastPierceFxMs > 250) {
            this.lastPierceFxMs = pierceNow;
            this.vfx.spawnPierceTrail(e.root.position.x, e.centerY, e.root.position.z);
            // 贯穿包装：粉色穿刺线纵穿敌身 + 粉环（横幅飘字降频，意义一次讲清）
            this.skillFx3D.spawnSlashLine(
              e.root.position.x, e.centerY, e.root.position.z + 2.5,
              e.root.position.x, e.centerY, e.root.position.z - 2.5,
              '#ff5e8a', 0.5, 0.45,
            );
            this.vfx.spawnShockRing(e.root.position.x, Math.max(0.02, e.centerY - 1.2), e.root.position.z, '#ff5e8a', 3.5, 0.3, 1);
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

  private triggerStellarJudgment(enemy: Entity3D): void {
    const casterId =
      this.data.squadIds.find((id) => CHARACTER_MAP[id]?.skillId === 'stellar_judgment') ?? this.leadCharId;
    if ((this.manualSkillCooldowns[casterId] ?? 0) > 0 || !enemy.active) return;
    this.manualSkillCooldowns[casterId] = this.manualSkillCooldownMs;
    this.updateManualSkillHud();

    const caster = this.getSquadMemberWorldPos(casterId);
    const target = {
      x: enemy.root.position.x,
      y: enemy.centerY,
      z: enemy.root.position.z,
    };
    const referenceHeight = this.getCasterRenderHeight(casterId);

    this.vfx.spawnSkillEffect('stellar_judgment', this.camera, caster.x, caster.y + 0.7, caster.z, target);
    this.skillFx3D.spawn(
      'stellar_judgment',
      caster.x,
      caster.y + 0.7,
      caster.z,
      '#ffd54f',
      '#fff0a8',
      target,
      referenceHeight,
      () => (enemy.active ? { x: enemy.root.position.x, y: 0, z: enemy.root.position.z } : null),
    );
    this.floatText?.spawnWorld(target, '光轮裁决', 'skill');
    this.showSkillBanner('光轮裁决', enemy.boss ? '锁定 Boss · 天罚落点' : '光轮裁决 · 天罚落点', '#ffd54f');
    playSkillSfx('stellar_judgment');
    this.triggerScreenShake({ shake: 0.16, intensity: 0.28, fov: 0.2, hitLagSeconds: 0.045 });
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

  private triggerGenericSkill(charId: string, enemy: Entity3D): void {
    if (!enemy.active) return;
    this.manualSkillCooldowns[charId] = this.manualSkillCooldownMs;
    this.updateManualSkillHud();

    const skillName = CHARACTER_MAP[charId]?.skillName ?? '技能';
    const base = this.data.squadDamage[charId] ?? Math.max(1, this.data.tcp / 10);
    const damage = Math.max(1, Math.round(base * 6));
    enemy.hp -= damage;
    const hitPoint = {
      x: enemy.root.position.x,
      y: enemy.centerY,
      z: enemy.root.position.z,
    };
    this.vfx.spawnHalo(hitPoint.x, hitPoint.y + 0.4, hitPoint.z, '#ffd54f', 8.4, 0.8, 0.84);
    this.vfx.spawnShockRing(hitPoint.x, Math.max(0.02, hitPoint.y - 1.2), hitPoint.z, '#ffd54f', 5.6, 0.4, 1);
    this.vfx.spawnLightPillar(hitPoint.x, Math.max(0.02, hitPoint.y - 1.2), hitPoint.z, '#ffd54f', 10, 0.45, 0.8);
    this.vfx.spawnHit(enemy.root.position.x, enemy.centerY, enemy.root.position.z, enemy.boss);
    this.vfx.spawnImpactSparks(enemy.root.position.x, enemy.centerY, enemy.root.position.z, '#ffd54f', 8);
    this.floatText?.spawnWorld(
      { x: enemy.root.position.x, y: enemy.centerY + 0.9, z: enemy.root.position.z },
      `${skillName} ${damage}`,
      'skill',
    );
    this.showSkillBanner(skillName, `小队技 · 命中伤害 ${damage}`, '#ffd54f');
    playSkillSfx('resonance_burst');
    this.triggerScreenShake({ shake: 0.16, intensity: 0.28, fov: 0.2, hitLagSeconds: 0.045 });
    if (enemy.hp <= 0) {
      this.vfx.spawnKillBurst(enemy.root.position.x, enemy.centerY, enemy.root.position.z, enemy.boss);
      this.removeEnemy(enemy);
      this.kills++;
      this.comboKills++;
      playKillSfx(enemy.boss);
    }
  }

  /* ================= 主动技能系统（方案A，无能量，左侧按钮+20秒CD） ================= */

  private shotBase(charId: string): number {
    return this.data.squadDamage[charId] ?? Math.max(1, this.data.tcp / 10);
  }

  /**
   * 各技能独立 CD（毫秒）：
   * 8 秒档——单发价值约 2~3.5 秒团队火力或带长效增益（终审/熔城/织网/齐鸣/庇护）；
   * 7 秒档——价值约 1.5~3 秒火力或强控（白夜/绯爪/爱心/静域/干扰）；
   * 6 秒档——价值约 1~2 秒火力、速转节奏（风刃/三连/热雨）。
   * 纯 4 秒会导致增益类 100% 覆盖、核弹类 DPS 翻倍，故下限取 6 秒。
   */
  private activeSkillCooldown(charId: string): number {
    switch (charId) {
      case 'stellar':
      case 'prismrift':
      case 'mirror':
      case 'pulse':
      case 'heartforge':
        return 8000;
      case 'frostline':
      case 'dustblade':
      case 'outercore':
      case 'skyshard':
      case 'wireguard':
        return 7000;
      case 'ashcrow':
      case 'neoncoil':
      case 'ironrain':
      default:
        return 6000;
    }
  }

  private consumeSkill(charId: string): void {
    this.manualSkillCooldowns[charId] = this.activeSkillCooldown(charId);
    this.updateManualSkillHud();
  }

  private pickHighestHpTarget(): Entity3D | null {
    const actives = this.enemies.filter((enemy) => enemy.active);
    if (!actives.length) return null;
    return actives.sort((a, b) => b.hp - a.hp)[0] ?? null;
  }

  /** 全队回血（health=义体=血量，上限100，写回存档） */
  private healSquad(amount: number, label: string): void {
    for (const id of this.data.squadIds) {
      mutateAiLiving((living) => {
        const cur = getCyberHealth(living as AiLivingSave, id);
        setCyberHealth(living as AiLivingSave, id, Math.min(100, cur + amount), label);
      });
      this.combatHp[id] = Math.min(100, (this.combatHp[id] ?? 0) + amount);
      const pos = this.getSquadMemberWorldPos(id);
      this.floatText?.spawnWorld(pos, `+${amount} 义体`, 'info');
    }
    for (const id of this.data.squadIds) {
      if ((this.combatHp[id] ?? 0) > 0) this.restoreDownVisual(id);
    }
    this.refreshHealthHud();
    this.updateManualSkillHud();
  }

  private immuneText(e: Entity3D): void {
    const now = performance.now();
    if (now - this.lastImmuneMs < 1200) return;
    this.lastImmuneMs = now;
    this.floatText?.spawnWorld(
      { x: e.root.position.x, y: e.centerY + 1.6, z: e.root.position.z },
      '免疫',
      'info',
    );
  }

  private applyEnemySlow(e: Entity3D, mul: number, sec: number, tintLabel?: string): void {
    // Boss 免疫减速：只飘字，不挂 slow（否则状态环与行为对不上）
    if (e.boss) {
      this.immuneText(e);
      return;
    }
    const now = performance.now();
    e.slowMultiplier = Math.min(e.slowMultiplier ?? 1, mul);
    e.slowUntilMs = Math.max(e.slowUntilMs ?? 0, now + sec * 1000);
    if (tintLabel) {
      this.floatText?.spawnWorld(
        { x: e.root.position.x, y: e.centerY + 0.9, z: e.root.position.z },
        tintLabel,
        'info',
      );
    }
  }

  private applyEnemyStun(e: Entity3D, sec: number): void {
    e.stunUntilMs = Math.max(e.stunUntilMs ?? 0, performance.now() + sec * 1000);
  }

  private applyEnemyBurn(e: Entity3D, dps: number, sec: number): void {
    const now = performance.now();
    e.burnDps = Math.max(e.burnDps ?? 0, dps);
    e.burnUntilMs = Math.max(e.burnUntilMs ?? 0, now + sec * 1000);
    this.floatText?.spawnWorld(
      { x: e.root.position.x, y: e.centerY + 0.9, z: e.root.position.z },
      '灼烧',
      'info',
    );
  }

  private applyEnemyKnockback(e: Entity3D, velocity: number): void {
    // Boss 吨位：击退只吃 15%，后仰封顶 0.25（栽一下即回，不许翻倒）
    if (e.boss) {
      e.knockbackV = (e.knockbackV ?? 0) + velocity * 0.15;
      e.topple = Math.min(0.25, Math.max(e.topple ?? 0, Math.min(1, Math.abs(velocity) / 20) * 0.25));
      return;
    }
    e.knockbackV = (e.knockbackV ?? 0) + velocity;
    e.topple = Math.min(1.2, Math.max(e.topple ?? 0, Math.min(1, Math.abs(velocity) / 20)));
  }

  /**
   * 敌人状态环组：地面圆环 + 通天光柱，直接挂场景、每帧跟随敌人坐标。
   * 注意不能挂 e.root：实例化敌人的 root 根本不在场景图里（走 InstancedMesh 矩阵渲染），
   * 挂过去永远看不见——这就是之前状态环全灭的原因。
   */
  private ensureStatusRing(e: Entity3D, kind: 'stun' | 'frost' | 'burn'): void {
    const cur = this.enemyStatusRings.get(e.id);
    if (cur) {
      if (cur.kind === kind) return;
      this.clearStatusRing(e.id);
    }
    const color = kind === 'stun' ? '#ffe94a' : kind === 'frost' ? '#b8e0ff' : '#ff6a3d';
    const radius = (e.boss ? 3.4 : 2.6) * 1.5;
    const g = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.3, 8, 48), ringMat);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.35, 5.5, 12), beamMat);
    beam.position.y = 2.75;
    g.add(beam);
    g.position.set(e.root.position.x, Math.max(e.root.position.y + 1.0, e.centerY), e.root.position.z);
    this.scene.add(g);
    this.enemyStatusRings.set(e.id, { obj: g, kind });
  }

  private clearStatusRing(id: number): void {
    const cur = this.enemyStatusRings.get(id);
    if (!cur) return;
    this.enemyStatusRings.delete(id);
    cur.obj.removeFromParent();
    cur.obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
  }

  /** 每帧同步：定身优先于冰冻优先于灼烧；状态结束或敌人消失即摘环 */
  private syncStatusRings(now: number, dt: number): void {
    for (const e of this.enemies) {
      if (!e.active) {
        this.clearStatusRing(e.id);
        continue;
      }
      const stunned = !e.boss && (now < this.globalStunUntilMs || now < (e.stunUntilMs ?? 0));
      const frozen = !e.boss && !stunned && now < (e.slowUntilMs ?? 0) && (e.slowMultiplier ?? 1) < 1;
      const burning = !stunned && !frozen && now < (e.burnUntilMs ?? 0) && (e.burnDps ?? 0) > 0;
      if (stunned) this.ensureStatusRing(e, 'stun');
      else if (frozen) this.ensureStatusRing(e, 'frost');
      else if (burning) this.ensureStatusRing(e, 'burn');
      else this.clearStatusRing(e.id);
    }
    for (const [id, ring] of this.enemyStatusRings) {
      const e = this.enemies.find((enemy) => enemy.id === id);
      if (!e || !e.active) {
        this.clearStatusRing(id);
        continue;
      }
      ring.obj.position.set(e.root.position.x, Math.max(e.root.position.y + 1.0, e.centerY), e.root.position.z);
      ring.obj.rotation.y += dt * 2.2;
      ring.obj.scale.setScalar(1 + 0.1 * Math.sin(now / 150 + id));
    }
  }

  /**
   * 技能统一结算：扣血 → 受击反馈 → 死亡处理（含冰爆连锁）→ 击杀计数。
   * 返回是否击杀。
   */
  private dealSkillDamage(
    e: Entity3D,
    damage: number,
    opts?: { quiet?: boolean; noShatter?: boolean; casterId?: string; color?: string; haloSize?: number },
  ): boolean {
    if (!e.active || this.finished) return false;
    e.hp -= damage;
    if (!opts?.quiet) {
      this.vfx.spawnHit(e.root.position.x, e.centerY, e.root.position.z, e.boss);
      // Boss 距离远（83 米外）：火花与光晕同步放大 1.8 倍，否则缩成看不见
      const bossFxMul = e.boss ? 1.8 : 1;
      this.vfx.spawnImpactSparks(
        e.root.position.x, e.centerY, e.root.position.z,
        opts?.color ?? (e.boss ? '#ff8866' : '#a8e8ff'), Math.round(8 * bossFxMul),
      );
      this.vfx.spawnHalo(e.root.position.x, e.centerY + 0.3, e.root.position.z, opts?.color ?? '#ffd54f', (opts?.haloSize ?? 5) * bossFxMul, 0.7, 0.8);
    }
    if (e.hp > 0) return false;
    if (e.boss) {
      this.vfx.spawnHeavyKillBurst(e.root.position.x, e.centerY, e.root.position.z, '#ff8866');
    } else {
      this.vfx.spawnKillBurst(e.root.position.x, e.centerY, e.root.position.z, e.boss);
    }
    const deadPos = { x: e.root.position.x, y: e.centerY, z: e.root.position.z };
    this.removeEnemy(e);
    this.kills++;
    this.comboKills++;
    if (e.boss) {
      this.triggerScreenShake({ shake: 0.32, intensity: 0.7, fov: 0.6, hitLagSeconds: 0.08 });
    } else {
      this.triggerScreenShake({ shake: 0.14, intensity: 0.2, fov: 0.18, hitLagSeconds: 0.02 });
    }
    playKillSfx(e.boss);
    if (!opts?.noShatter && performance.now() < this.frostDomainUntilMs) {
      const casterBase = opts?.casterId ? this.shotBase(opts.casterId) : damage / 4;
      for (const other of [...this.enemies]) {
        if (!other.active || other === e) continue;
        if (Math.abs(other.root.position.z - deadPos.z) > 2.5) continue;
        this.vfx.spawnFrostShards(other.root.position.x, other.centerY, other.root.position.z, '#ffffff', 8);
        this.skillImpactFx(other.root.position.x, other.centerY, other.root.position.z, '#b8e0ff', 0.7);
        this.dealSkillDamage(other, casterBase * 4, { noShatter: true, casterId: opts?.casterId, color: '#b8e0ff' });
      }
    }
    return true;
  }

  /**
   * 施法者释放标记：按钮点下后，释放角色脚下炸开双环 + 光晕 + 光柱 + 技能名，
   * 一眼看出“是谁发的技能”。每个主动技能开头必调。
   */
  private casterBurstFx(charId: string, color: string, accent: string, skillName: string): void {
    const c = this.getSquadMemberWorldPos(charId);
    const groundY = Math.max(0.02, c.y - 2.0);
    this.vfx.spawnShockRing(c.x, groundY, c.z, color, 4.5, 0.5, 1);
    this.vfx.spawnShockRing(c.x, groundY + 0.2, c.z, accent, 3.0, 0.6, 0.9);
    this.vfx.spawnHalo(c.x, c.y, c.z, color, 6, 0.7, 0.7);
    this.vfx.spawnLightPillar(c.x, groundY, c.z, color, 7, 0.5, 0.7);
    this.vfx.spawnImpactSparks(c.x, c.y, c.z, color, 6);
    this.floatText?.spawnWorld({ x: c.x, y: c.y + 1.6, z: c.z }, skillName, 'skill');
  }

  /**
   * 技能落点统一重型反馈（2x 标准，与光轮裁决同级）：
   * 光晕直径 8（不透明 0.84）+ 扩散环半径 5（不透明 1）+ 光柱高 10（不透明 0.8）+ 8 粒火花。
   * sizeMul 缩放整组，用于多段连击等高频落点。
   */
  private skillImpactFx(x: number, y: number, z: number, color: string, sizeMul = 1): void {
    const groundY = Math.max(0.02, y - 1.2);
    this.vfx.spawnHalo(x, y + 0.4, z, color, 8 * sizeMul, 0.8, 0.84);
    this.vfx.spawnShockRing(x, groundY, z, color, 5 * sizeMul, 0.45, 1);
    this.vfx.spawnLightPillar(x, groundY, z, color, 10 * sizeMul, 0.5, 0.8);
    this.vfx.spawnImpactSparks(x, y, z, color, 8);
  }

  /** 4.1 苍羽·澪 —— 破风突贯：本道 8x 全体，存活者击退 */
  private execGalePierce(charId: string): void {
    const targets = this.enemies
      .filter((enemy) => enemy.active && enemy.lane === this.laneIndex)
      .sort((a, b) => b.root.position.z - a.root.position.z);
    if (!targets.length) return;
    this.consumeSkill(charId);
    this.casterBurstFx(charId, '#8fd8ff', '#d8f4ff', '破风突贯');
    const base = this.shotBase(charId);
    const px = this.playerRoot.position.x;
    const py = this.playerRoot.position.y + 1.2;
    const pz = this.playerRoot.position.z - 2;
    this.vfx.spawnEnergyArc(px, py, pz, '#8fd8ff', 6.0, -1);
    this.skillFx3D.spawnBladeSweep(px, py, pz, '#8fd8ff', '#d8f4ff', 1);
    this.skillImpactFx(px, py, pz, '#8fd8ff', 2.5);
    // 伤害不再开场瞬间结算：风刃逻辑体与 3D 刃体同速（34/秒）推进，劈到谁砍谁
    this.bladeSweeps.push({ charId, lane: this.laneIndex, z: pz, speed: 34, base, hitIds: new Set(), life: 3.0 });
    this.showSkillBanner('破风突贯', `本道贯穿 · 8x弹伤 · 风刃横扫中`, '#8fd8ff');
    playSkillSfx('sand_pierce');
    this.triggerScreenShake({ shake: 0.12, intensity: 0.15, fov: 0.2, hitLagSeconds: 0.02 });
  }

  /** 4.2 白楯·芹奈 —— 楯影庇护：6秒全队减伤50% + 全队回血15 */
  private execAegisGuard(charId: string): void {
    this.consumeSkill(charId);
    this.casterBurstFx(charId, '#e8c48a', '#fff2d8', '楯影庇护');
    this.shieldGuardUntilMs = performance.now() + 6000;
    this.healSquad(15, '楯影庇护');
    for (const id of this.data.squadIds) {
      this.skillFx3D.spawnAegisDome(
        () => {
          const p = this.getSquadMemberWorldPos(id);
          return { x: p.x, y: 0, z: p.z };
        },
        '#e8c48a',
        '#fff2d8',
        1,
        6,
      );
    }
    this.skillImpactFx(this.playerRoot.position.x, this.playerRoot.position.y + 1, this.playerRoot.position.z, '#e8c48a', 0.7);
    this.vfx.spawnShieldPulse(this.playerRoot.position.x, this.playerRoot.position.y + 1.2, this.playerRoot.position.z, '#e8c48a');
    this.showSkillBanner('楯影庇护', '全队减伤50%(6秒) · 义体+15', '#e8c48a');
    playShieldSfx();
    this.triggerScreenShake({ shake: 0.06, intensity: 0.05, fov: 0, hitLagSeconds: 0 });
  }

  /** 4.3 银绯·玲 —— 弹道织网：5秒全队弹伤+35%，命中击退 */
  private execWeaveNet(charId: string): void {
    this.consumeSkill(charId);
    this.casterBurstFx(charId, '#ffd54f', '#fff3c0', '弹道织网');
    this.skillFx3D.spawnWeaveDome(
      this.playerRoot.position.x, this.playerRoot.position.y + 1.2, this.playerRoot.position.z,
      '#ffd54f', '#fff3c0', 0.75,
    );
    this.weaveHuntUntilMs = performance.now() + 5000;
    for (const e of this.enemies.slice(0, 8)) {
      if (!e.active) continue;
      this.vfx.spawnHalo(e.root.position.x, e.centerY + 0.4, e.root.position.z, '#ffd54f', 3, 0.8, 0.8);
    }
    this.skillImpactFx(this.playerRoot.position.x, this.playerRoot.position.y + 1, this.playerRoot.position.z, '#ffd54f', 0.9);
    for (const e of this.enemies) {
      if (!e.active) continue;
      this.floatText?.spawnWorld(
        { x: e.root.position.x, y: e.centerY + 2.2, z: e.root.position.z },
        '标记',
        'info',
      );
    }
    this.showSkillBanner('弹道织网', '5秒全队子弹伤害+35% · 命中击退', '#ffd54f');
    playSkillSfx('resonance_burst');
  }

  /** 4.4 苍斩·凛 —— 无痕三连斩：锁最高血，3段各6x，间隔0.12秒 */
  private execTripleSlash(charId: string): void {
    if (!this.pickHighestHpTarget()) return;
    this.consumeSkill(charId);
    this.casterBurstFx(charId, '#b8e0ff', '#e8f7ff', '无痕三连斩');
    this.pendingStrikes.push({
      charId, remaining: 3, timerMs: 0, intervalMs: 120,
      mult: 6, color: '#b8e0ff', label: '无痕三连斩', bossCritInherit: false,
    });
    this.showSkillBanner('无痕三连斩', '3段 · 每段6x弹伤', '#b8e0ff');
    playSkillSfx('sand_pierce');
  }

  /** 4.5 焰甲·朱里 —— 熔城一炮：0.6秒后敌阵最密集点爆炸，半径4，20x + 灼烧2秒 */
  private execMeltdownCannon(charId: string): void {
    const actives = this.enemies.filter((enemy) => enemy.active);
    if (!actives.length) return;
    let bestZ = actives[0].root.position.z;
    let bestCount = 0;
    for (const e of actives) {
      const count = actives.filter((o) => Math.abs(o.root.position.z - e.root.position.z) <= 4).length;
      if (count > bestCount) {
        bestCount = count;
        bestZ = e.root.position.z;
      }
    }
    this.consumeSkill(charId);
    this.casterBurstFx(charId, '#ff8840', '#ffd0a8', '熔城一炮');
    const startX = this.playerRoot.position.x;
    const startY = this.getPlayerMuzzleY();
    const startZ = this.playerRoot.position.z - 1;
    const shellSpeed = Math.max(20, (startZ - bestZ) / 0.6);
    this.pendingBlasts.push({
      charId, delayMs: 600, z: bestZ, radiusZ: 4, mult: 20,
      color: '#ff8840', label: '熔城一炮', burnDpsMult: 2, burnSec: 2,
      startZ, startX, startY, speed: shellSpeed, elapsedMs: 0, trailAcc: 0, impactMul: 1.8,
    });
    this.skillFx3D.spawnCannonShell(startX, startY, startZ, '#ff8840', '#ffd0a8', shellSpeed, 1.4);
    this.vfx.spawnHalo(
      this.playerRoot.position.x, this.getPlayerMuzzleY(), this.playerRoot.position.z,
      '#ff8840', 5.0, 0.6, 0.84,
    );
    this.showSkillBanner('熔城一炮', '蓄力0.6秒 · 20x范围', '#ff8840');
    playSkillSfx('iron_rain');
  }

  /** 4.6 黄狐·萤 —— 荧惑干扰：全场定身3秒（无伤害） */
  private execJammerPulse(charId: string): void {
    if (!this.enemies.some((enemy) => enemy.active)) return;
    this.consumeSkill(charId);
    this.casterBurstFx(charId, '#ffe94a', '#fffbd0', '荧惑干扰');
    this.globalStunUntilMs = performance.now() + 3000;
    this.skillImpactFx(this.playerRoot.position.x, this.playerRoot.position.y + 1, this.playerRoot.position.z, '#ffe94a', 0.9);
    for (const e of this.enemies) {
      if (e.active && e.boss) this.immuneText(e);
    }
    for (const e of this.enemies.slice(0, 8)) {
      if (!e.active) continue;
      this.vfx.spawnImpactSparks(e.root.position.x, e.centerY + 1.6, e.root.position.z, '#ffe94a', 2);
      this.floatText?.spawnWorld(
        { x: e.root.position.x, y: e.centerY + 2.4, z: e.root.position.z },
        '定身',
        'info',
      );
    }
    this.vfx.spawnImpactSparks(
      this.playerRoot.position.x, this.playerRoot.position.y + 1.2, this.playerRoot.position.z,
      '#ffe94a', 8,
    );
    this.floatText?.spawnWorld(
      { x: this.playerRoot.position.x, y: this.playerRoot.position.y + 2.6, z: this.playerRoot.position.z },
      '干扰中',
      'info',
    );
    this.showSkillBanner('荧惑干扰', '全场定身3秒', '#ffe94a');
    playSkillSfx('outer_pulse');
  }

  /** 4.7 夜爪·黑织 —— 白夜处刑：8段各3x，间隔0.09秒，对Boss继承暴击 */
  private execWhiteNight(charId: string): void {
    if (!this.pickHighestHpTarget()) return;
    this.consumeSkill(charId);
    this.casterBurstFx(charId, '#5ee7ff', '#d8f8ff', '白夜处刑');
    this.pendingStrikes.push({
      charId, remaining: 8, timerMs: 0, intervalMs: 90,
      mult: 3, color: '#5ee7ff', label: '白夜处刑', bossCritInherit: true,
    });
    this.triggerVignette();
    this.showSkillBanner('白夜处刑', '8段 · 每段3x弹伤', '#5ee7ff');
    playSkillSfx('frost_overload');
  }

  /** 4.8 翠翼·铃 —— 频谱齐鸣：5秒全队攻速+40%，三连发门槛3杀→2杀 */
  private execSpectrumChorus(charId: string): void {
    this.consumeSkill(charId);
    this.casterBurstFx(charId, '#7CFF4A', '#dcffcc', '频谱齐鸣');
    this.riftChorusUntilMs = performance.now() + 5000;
    this.skillImpactFx(this.playerRoot.position.x, this.playerRoot.position.y + 1, this.playerRoot.position.z, '#7CFF4A', 1.0);
    this.showSkillBanner('频谱齐鸣', '攻速+40%(5秒) · 连闪2杀触发', '#7CFF4A');
    playSkillSfx('resonance_burst');
  }

  /** 4.9 绯尾·椿 —— 绯雨三连爪：三道各3枚利爪炮，每枚3x并继承穿透 */
  private execCrimsonClaws(charId: string): void {
    if (!this.enemies.some((enemy) => enemy.active)) return;
    this.consumeSkill(charId);
    this.casterBurstFx(charId, '#ff5e8a', '#ffd0dd', '绯雨三连爪');
    const base = this.shotBase(charId);
    const camZ = this.camera.position.z;
    for (let lane = 0; lane <= 2; lane++) {
      for (let i = 0; i < 3; i++) {
        const x = LANE_X[lane];
        const rootZ = PLAYER_Z - 1 - i * 2.5;
        const feetOffset = this.playerRoot.position.y - roadY(rootZ, camZ);
        const mesh = createCombatBulletMesh();
        this.placeBulletMesh(mesh, x, rootZ - 0.45, feetOffset, 0.55);
        this.scene.add(mesh);
        this.vfx.spawnMuzzle(
          this.camera,
          new THREE.Vector3(x, this.getBulletBeamY(rootZ - 0.45, feetOffset), rootZ - 0.45),
          '#ff5e8a',
        );
        this.bullets.push({
          mesh,
          active: true,
          remainingHits: this.skillMods.projectilePierce,
          lane,
          originX: x,
          feetOffset,
          logicZ: PLAYER_Z - 1 - i * 2.5,
          renderStartZ: rootZ - 0.45,
          targetZ: SPAWN_Z,
          shotLabel: '绯雨利爪',
          sourceCharId: charId,
          squadSlot: Math.max(0, this.data.squadIds.indexOf(charId)),
          damage: base * 3,
          hitColor: '#ff5e8a',
        });
      }
    }
    this.skillImpactFx(this.playerRoot.position.x, this.playerRoot.position.y + 1.2, this.playerRoot.position.z, '#ff5e8a', 0.7);
    this.showSkillBanner('绯雨三连爪', '三道9爪 · 每枚3x弹伤', '#ff5e8a');
    playSkillSfx('sand_pierce');
    this.triggerScreenShake({ shake: 0.15, intensity: 0.2, fov: 0.25, hitLagSeconds: 0.02 });
  }

  /** 4.10 橙铠·琥珀 —— 热平衡释放：立即200%强化雨幕 + 5秒被动雨幕加速到4秒 */
  private execHeatRelease(charId: string): void {
    const targets = this.enemies
      .filter((enemy) => enemy.active && enemy.lane === this.laneIndex)
      .sort((a, b) => b.root.position.z - a.root.position.z)
      .slice(0, 5);
    if (!targets.length) return;
    this.consumeSkill(charId);
    this.casterBurstFx(charId, '#ff8840', '#ffd0a8', '热平衡释放');
    this.ironHasteUntilMs = performance.now() + 5000;
    const base = this.shotBase(charId);
    for (const e of targets) {
      this.vfx.spawnShards(e.root.position.x, e.centerY + 0.3, e.root.position.z, '#ff8840', 6);
      this.dealSkillDamage(e, base * 2.0, { casterId: charId, color: '#ff8840' });
    }
    this.skillImpactFx(this.playerRoot.position.x, this.playerRoot.position.y + 1, this.playerRoot.position.z, '#ff8840', 1.0);
    this.showSkillBanner('热平衡释放', `200%熔渣 · 命中 ${targets.length} · 5秒急速雨幕`, '#ff8840');
    playSkillSfx('iron_rain');
    this.triggerScreenShake({ shake: 0.18, intensity: 0.35, fov: 0.25, hitLagSeconds: 0.03 });
  }

  /** 4.11 冰华·雫 —— 极寒静域：全场减速50%持续4秒，期间击杀冰爆4x（半径2.5，可连锁1层） */
  private execFrostDomain(charId: string): void {
    if (!this.enemies.some((enemy) => enemy.active)) return;
    this.consumeSkill(charId);
    this.casterBurstFx(charId, '#b8e0ff', '#eef8ff', '极寒静域');
    const now = performance.now();
    const midZ = PLAYER_Z - 14;
    this.skillFx3D.spawnShardRing(0, roadY(midZ, this.camera.position.z), midZ, '#b8e0ff', '#eef8ff', 1);
    this.frostDomainUntilMs = now + 4000;
    this.globalSlowUntilMs = now + 4000;
    this.globalSlowMul = 0.5;
    const camZ = this.camera.position.z;
    for (let i = 0; i < 16; i++) {
      const x = (Math.random() - 0.5) * 14;
      const z = PLAYER_Z - 4 - Math.random() * 26;
      this.vfx.spawnFrostShards(x, roadY(z, camZ) + 6, z, '#b8e0ff', 1);
    }
    for (const e of this.enemies) {
      if (!e.active) continue;
      this.applyEnemySlow(e, 0.5, 4, '冻结');
    }
    this.skillImpactFx(this.playerRoot.position.x, this.playerRoot.position.y + 1, this.playerRoot.position.z, '#b8e0ff', 0.8);
    this.showSkillBanner('极寒静域', '全场减速4秒 · 击杀冰爆', '#b8e0ff');
    playSkillSfx('shard_shell');
    this.triggerScreenShake({ shake: 0.1, intensity: 0.1, fov: 0.1, hitLagSeconds: 0.02 });
  }

  /** 4.12 光轮·天音 —— 终审之光：30x最高血敌人，对Boss 45x */
  private execFinalLight(charId: string, target: Entity3D): void {
    // 注意：triggerStellarJudgment 自带“冷却中直接 return”守卫并自己写 CD，
    // 这里不能先 consumeSkill，否则守卫拦截导致整套视觉被跳过（只剩伤害）。
    this.casterBurstFx(charId, '#ffd54f', '#fff0a8', '终审之光');
    this.triggerStellarJudgment(target);
    const mult = target.boss ? 45 : 30;
    const dmg = Math.max(1, Math.round(this.shotBase(charId) * mult));
    this.floatText?.spawnWorld(
      { x: target.root.position.x, y: target.centerY + 1.4, z: target.root.position.z },
      `终审之光 ${dmg}`,
      'skill',
    );
    this.dealSkillDamage(target, dmg, { quiet: true, casterId: charId, color: '#ffd54f' });
    if (target.boss) {
      this.skillImpactFx(target.root.position.x, target.centerY, target.root.position.z, '#ffd54f', 2.0);
      this.triggerScreenShake({ shake: 0.22, intensity: 0.4, fov: 0.3, hitLagSeconds: 0.05 });
    }
  }

  /** 4.13 橙兔·美羽 —— 星种爱心弹：缓慢推进后爆炸，半径5，15x + 全队回血8 */
  private execHeartSeed(charId: string): void {
    const actives = this.enemies.filter((enemy) => enemy.active);
    if (!actives.length) return;
    this.consumeSkill(charId);
    this.casterBurstFx(charId, '#ff9ac2', '#ffd8e8', '星种爱心弹');
    const farthestZ = Math.min(...actives.map((e) => e.root.position.z));
    const targetZ = farthestZ * 0.7 + PLAYER_Z * 0.3;
    const mat = new THREE.SpriteMaterial({
      map: createGlowTexture('#ff9ac2'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.6, 2.6, 1);
    sprite.position.set(
      this.playerRoot.position.x,
      this.playerRoot.position.y + 1.2,
      this.playerRoot.position.z - 1,
    );
    this.scene.add(sprite);
    this.skillShots.push({
      charId,
      lane: this.laneIndex,
      x: this.playerRoot.position.x,
      y: this.playerRoot.position.y + 1.2,
      z: this.playerRoot.position.z - 1,
      targetZ,
      speed: 10,
      radiusZ: 5,
      mult: 15,
      pierce: 0,
      color: '#ff9ac2',
      label: '星种爱心弹',
      heal: 8,
      sprite,
      trailAcc: 0,
      exploded: false,
    });
    this.showSkillBanner('星种爱心弹', '15x范围 · 全队义体+8', '#ff9ac2');
    playSkillSfx('outer_pulse');
  }

  /** 延迟队列推进：风刃横扫 / 多段斩 / 延迟爆 / 飞行弹 */
  private processSkillQueues(deltaMs: number): void {
    const dt = deltaMs / 1000;
    for (let i = this.bladeSweeps.length - 1; i >= 0; i--) {
      const sweep = this.bladeSweeps[i];
      sweep.z -= sweep.speed * dt;
      sweep.life -= dt;
      for (const e of this.enemies) {
        if (!e.active || e.lane !== sweep.lane || sweep.hitIds.has(e.id)) continue;
        if (Math.abs(e.root.position.z - sweep.z) > 2.5) continue;
        sweep.hitIds.add(e.id);
        const died = this.dealSkillDamage(e, sweep.base * 8, { casterId: sweep.charId, color: '#8fd8ff', haloSize: 12.5 });
        if (!died) {
          this.applyEnemyKnockback(e, -26);
          this.floatText?.spawnWorld(
            { x: e.root.position.x, y: e.centerY + 0.9, z: e.root.position.z },
            '击退',
            'info',
          );
        }
        this.triggerScreenShake({ shake: 0.1, intensity: 0.12, fov: 0.12, hitLagSeconds: 0.015 });
      }
      if (sweep.life <= 0 || sweep.z < SPAWN_Z - 25) this.bladeSweeps.splice(i, 1);
    }
    for (let i = this.pendingStrikes.length - 1; i >= 0; i--) {
      const strike = this.pendingStrikes[i];
      strike.timerMs -= deltaMs;
      if (strike.timerMs > 0) continue;
      strike.timerMs = strike.intervalMs;
      const target = this.pickHighestHpTarget();
      if (!target) {
        this.pendingStrikes.splice(i, 1);
        continue;
      }
      let mult = strike.mult;
      if (strike.bossCritInherit && target.boss) mult *= 1 + this.skillMods.bossCritBonus;
      const base = this.shotBase(strike.charId);
      const casterPos = this.getSquadMemberWorldPos(strike.charId);
      const bossStrikeMul = target.boss ? 1.8 : 1;
      this.skillFx3D.spawnSlashLine(
        casterPos.x, casterPos.y - 1.0, casterPos.z,
        target.root.position.x, target.centerY, target.root.position.z,
        strike.color, target.boss ? 0.6 : 0.35,
      );
      this.vfx.spawnLightningBolt(target.root.position.x, target.centerY + 2, target.root.position.z, strike.color, 11, 2.6 * bossStrikeMul);
      this.skillImpactFx(target.root.position.x, target.centerY, target.root.position.z, strike.color, 0.7 * bossStrikeMul);
      if (strike.color === '#5ee7ff') {
        this.vfx.spawnFrostShards(target.root.position.x, target.centerY, target.root.position.z, '#b8e0ff', 3);
      }
      this.floatText?.spawnWorld(
        { x: target.root.position.x, y: target.centerY + 1.2, z: target.root.position.z },
        `${strike.label} ${Math.round(base * mult)}`,
        'skill',
      );
      this.dealSkillDamage(target, base * mult, { quiet: true, casterId: strike.charId, color: strike.color });
      this.triggerScreenShake({ shake: 0.08, intensity: 0.1, fov: 0.08, hitLagSeconds: 0.015 });
      strike.remaining -= 1;
      if (strike.remaining <= 0) this.pendingStrikes.splice(i, 1);
    }
    for (let i = this.pendingBlasts.length - 1; i >= 0; i--) {
      const blast = this.pendingBlasts[i];
      blast.delayMs -= deltaMs;
      blast.elapsedMs += deltaMs;
      blast.trailAcc += dt;
      if (blast.delayMs > 0) {
        if (blast.trailAcc >= 0.08) {
          blast.trailAcc = 0;
          const tz = blast.startZ - blast.speed * (blast.elapsedMs / 1000);
          this.vfx.spawnImpactSparks(blast.startX, blast.startY, tz, blast.color, 1);
        }
        continue;
      }
      this.pendingBlasts.splice(i, 1);
      const base = this.shotBase(blast.charId);
      const victims = blast.targetIds?.length
        ? this.enemies.filter((enemy) => enemy.active && blast.targetIds!.includes(enemy.id))
        : this.enemies.filter(
          (enemy) => enemy.active && Math.abs(enemy.root.position.z - blast.z) <= blast.radiusZ,
        );
      const bx = blast.x ?? 0;
      const gy = roadY(blast.z, this.camera.position.z);
      const blastMul = (blast.impactMul ?? 1) * (victims.some((v) => v.boss) ? 1.5 : 1);
      this.skillImpactFx(bx, gy + 1.5, blast.z, blast.color, blastMul);
      this.vfx.spawnShards(bx, gy + 0.5, blast.z, blast.color, 8);
      for (const e of victims) {
        const died = this.dealSkillDamage(e, base * blast.mult, { casterId: blast.charId, color: blast.color });
        if (!died && blast.burnDpsMult > 0) this.applyEnemyBurn(e, base * blast.burnDpsMult, blast.burnSec);
      }
      this.floatText?.spawnWorld(
        { x: bx, y: gy + 2.4, z: blast.z },
        `${blast.label} ${victims.length}中`,
        'skill',
      );
      this.triggerScreenShake({ shake: 0.25, intensity: 0.4, fov: 0.35, hitLagSeconds: 0.05 });
    }
    for (let i = this.skillShots.length - 1; i >= 0; i--) {
      const shot = this.skillShots[i];
      shot.z -= shot.speed * dt;
      shot.trailAcc += dt;
      if (shot.sprite) {
        shot.sprite.position.set(shot.x, shot.y, shot.z);
        shot.sprite.material.rotation += 2 * dt;
      }
      if (shot.trailAcc >= 0.08) {
        shot.trailAcc = 0;
        this.vfx.spawnImpactSparks(shot.x, shot.y, shot.z, shot.color, 2);
      }
      if (shot.z > shot.targetZ) continue;
      this.skillShots.splice(i, 1);
      if (shot.sprite) {
        this.scene.remove(shot.sprite);
        shot.sprite.material.dispose();
      }
      const base = this.shotBase(shot.charId);
      const victims = this.enemies.filter(
        (enemy) => enemy.active && Math.abs(enemy.root.position.z - shot.targetZ) <= shot.radiusZ,
      );
      const gy = roadY(shot.targetZ, this.camera.position.z);
      const heartMul = 1.1 * (victims.some((v) => v.boss) ? 1.5 : 1);
      this.skillImpactFx(shot.x, gy + 1.5, shot.targetZ, shot.color, heartMul);
      this.vfx.spawnShockRing(shot.x, gy + 0.2, shot.targetZ, '#ff5e8a', 4.5, 0.6, 1);
      this.vfx.spawnShards(shot.x, gy + 0.5, shot.targetZ, shot.color, 8);
      for (const e of victims) {
        this.dealSkillDamage(e, base * shot.mult, { casterId: shot.charId, color: shot.color });
      }
      if (shot.heal > 0) this.healSquad(shot.heal, shot.label);
      this.triggerScreenShake({ shake: 0.2, intensity: 0.3, fov: 0.3, hitLagSeconds: 0.04 });
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
    this.casterBurstFx(casterId ?? '', '#ff8840', '#ffaa50', '锻渣雨幕');
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

    for (let bi = 0; bi < activeEnemies.length; bi++) {
      const enemy = activeEnemies[bi];
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
      // 熔渣分三发依次砸落： spike 从天而降 → 落点爆炸 → 结算（伤害时机=砸落瞬间）
      // 开场伤害数字改为“锁定”预告，实际扣血走落点 dealSkillDamage
      this.pendingBlasts.push({
        charId: casterId ?? '', delayMs: 150 + bi * 150, z: enemy.root.position.z, x: enemy.root.position.x,
        radiusZ: 1.5, mult: this.skillMods.ironRainDamageMultiplier,
        color: '#ff8840', label: '锻渣雨幕', burnDpsMult: 0, burnSec: 0,
        startZ: enemy.root.position.z, startX: enemy.root.position.x, startY: enemy.centerY,
        speed: 0, elapsedMs: 0, trailAcc: -99, targetIds: [enemy.id], impactMul: 1.2,
      });
      const airTime = (150 + bi * 150) / 1000 + 0.45;
      this.skillFx3D.spawnRainSpike(enemy.root.position.x, enemy.centerY + 22 * airTime, enemy.root.position.z, '#ff8840', '#ffaa50', 22, airTime + 0.05);
      this.floatText?.spawnWorld(
        { x: enemy.root.position.x, y: enemy.centerY + 1.0, z: enemy.root.position.z },
        `${Math.round(damage)}`,
        'damage',
        slot,
      );
    }
  }

  /** 敌人碰撞或漏过：各计 1 次通过；超过 passLimit 才判负。碰撞时被撞角色义体扣血 */
  private registerEnemyPass(e: Entity3D, reason: 'hit' | 'leak'): void {
    if (!e.active || this.finished) return;
    this.removeEnemy(e);
    this.passCount += 1;

    const py = this.playerRoot.position.y + 2.2;
    if (reason === 'hit') {
      const dmg = Math.max(1, Math.ceil(combatHitDamage(this.data.stage, 'grunt') * (1 - Math.min(0.35, this.skillMods.shieldBonus)) * (performance.now() < this.shieldGuardUntilMs ? 0.5 : 1)));
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

  /** 角色倒下=该角色停火+禁技能；全员倒下才判负 */
  private isUnitDown(charId: string): boolean {
    return (this.combatHp[charId] ?? 0) <= 0;
  }

  /** 倒下外观：僚机直接隐藏，队长整机压暗（存档备份，回血即还原） */
  private applyDownVisual(charId: string): void {
    const name = CHARACTER_MAP[charId]?.name ?? charId;
    const wing = this.squadWings.find((w) => w.charId === charId);
    if (wing) {
      wing.root.visible = false;
      this.downHiddenWings.add(charId);
    } else if (charId === this.leadCharId && this.playerVisual) {
      this.playerVisual.traverse((obj) => {
        const mat = (obj as THREE.Mesh).material as { color?: THREE.Color } | undefined;
        if (!mat || Array.isArray(mat) || !mat.color) return;
        if (this.downDimBackup.some((entry) => entry.mat === mat)) return;
        this.downDimBackup.push({ charId, mat: mat as { color: THREE.Color }, color: mat.color.clone() });
        mat.color.multiplyScalar(0.3);
      });
    }
    const pos = this.getSquadMemberWorldPos(charId);
    this.floatText?.spawnWorld(pos, `${name}倒下`, 'info');
  }

  private restoreDownVisual(charId: string): void {
    const wing = this.squadWings.find((w) => w.charId === charId);
    if (wing && this.downHiddenWings.has(charId)) {
      wing.root.visible = true;
      this.downHiddenWings.delete(charId);
    }
    for (let i = this.downDimBackup.length - 1; i >= 0; i--) {
      const entry = this.downDimBackup[i];
      if (entry.charId !== charId) continue;
      entry.mat.color.copy(entry.color);
      this.downDimBackup.splice(i, 1);
    }
  }

  private checkSquadHealthFail(): void {
    if (this.finished) return;
    const anyAlive = this.data.squadIds.some((id) => !this.isUnitDown(id));
    if (!anyAlive) this.endCombat(false);
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

    this.flashSquadHurt(this.data.squadIds.filter((id) => !this.isUnitDown(id)));
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

  /**
   * Raid Boss 关技能系统补齐：主循环 update() 在 raid 模式下提前 return，
   * CD/多段斩/炮弹/雨幕计时/状态环不走主路，这里每帧手动推进。
   * Boss 控制抗性：定身/减速/击退/后仰只吃 30%，灼烧照常。
   */
  private tickRaidSkillSystems(dt: number): void {
    const deltaMs = dt * 1000;
    let skillHudDirty = false;
    for (const id of Object.keys(this.manualSkillCooldowns)) {
      const remaining = this.manualSkillCooldowns[id] ?? 0;
      if (remaining > 0) {
        this.manualSkillCooldowns[id] = Math.max(0, remaining - deltaMs);
        skillHudDirty = true;
      }
    }
    if (skillHudDirty) this.updateManualSkillHud();
    if (this.tripleCooldown > 0) this.tripleCooldown -= deltaMs;
    if (this.skillMods.ironRainEnabled && !this.isUnitDown(this.data.squadIds.find((id) => CHARACTER_MAP[id]?.skillId === 'iron_rain') ?? '')) {
      this.ironRainTimer += deltaMs;
      const rainInterval = performance.now() < this.ironHasteUntilMs ? 4000 : this.skillMods.ironRainInterval;
      if (this.ironRainTimer >= rainInterval) {
        this.ironRainTimer = 0;
        this.triggerIronRain();
      }
    }
    this.processSkillQueues(deltaMs);
    const boss = this.raidBossEntity;
    if (boss?.active) this.decayBossControl(boss, dt);
    this.syncStatusRings(performance.now(), dt);
  }

  /** Raid Boss 每帧衰减控制态：视觉保留 0.5 秒即清，不影响本体 */
  private decayBossControl(boss: Entity3D, dt: number): void {
    if ((boss.topple ?? 0) > 0) boss.topple = Math.max(0, (boss.topple ?? 0) - dt * 3.5);
    if (boss.knockbackV) {
      boss.knockbackV = 0;
    }
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
      if (from > 0 && to <= 0) this.applyDownVisual(characterId);
      this.updateManualSkillHud();
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
    this.clearStatusRing(e.id);
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
    this.downDimBackup.length = 0;
    this.downHiddenWings.clear();
    for (const id of [...this.enemyStatusRings.keys()]) this.clearStatusRing(id);
    this.bladeSweeps.length = 0;
    this.pendingStrikes.length = 0;
    this.pendingBlasts.length = 0;
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
