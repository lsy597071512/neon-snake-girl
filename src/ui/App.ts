import { saveManager } from "../core/SaveManager";
import { STAGES, STAGE_MAP, ECONOMY, STARTER, CHAPTERS } from "../data/stages";
import { CHARACTER_MAP, CHARACTERS, GACHA_PITY } from "../data/characters";
import {
  WEAPON_MAP,
  WEAPONS,
  PACK_PRICES,
  ARMORY_UPGRADE_COST,
  ARMORY_UPGRADE_MINUTES,
} from "../data/weapons";
import { ACHIEVEMENTS, rankingScore } from "../data/achievements";
import {
  getTeamTcp,
  getFullSquadTcp,
  getDeployIds,
  canManualWin,
  updateLegendaryStat,
  getCharacterPower,
  getCharacterShotDamage,
  getSquadShotDamageMap,
  getRoleDamageMul,
  RARITY_DAMAGE_MUL,
} from "../core/formulas";
import {
  rollWeapon,
  rollPack,
  getOpenCost,
  canUpgradeArmory,
  startArmoryUpgrade,
  finishArmoryUpgradeIfReady,
  skipArmoryUpgrade,
  getUpgradeRemainingMs,
  equipWeapon,
  getWeaponInventory,
  sellWeapon,
  compareAndMaybeEquip,
} from "../systems/ArmorySystem";
import { consumeSweepCharge, getSweepStatus } from "../systems/SweepSystem";
import {
  claimAchievement,
  getClaimableAchievements,
} from "../systems/AchievementSystem";
import {
  TASKS,
  claimAllTasks,
  claimTask,
  describeTaskRewards,
  getClaimableTasks,
  getTaskProgress,
  isTaskClaimed,
} from "../systems/TaskSystem";
import {
  dismantleWeaponCopy,
  getCharacterShardCount,
  getCharacterShardUpgradeInfo,
  getWeaponShardCount,
  getWeaponShardUpgradeInfo,
  useCharacterShards,
  useWeaponShards,
} from "../systems/ShardSystem";
import { startCombat } from "../game/Game";
import { squadSlotsForStage } from "../data/stages";
import {
  isChapterHellUnlocked,
  hellStageId,
  normalStageId,
} from "../game/combatBalance";
import {
  UI_ASSETS,
  WASTELAND_UI,
  rarityFrame,
  hubFeaturedCharDisplay,
  resolveHubFeaturedCharId,
  renderCharPortrait,
  getCharAvatarSrc,
  hasPortraitFlip,
  hasPortraitSeriesSwitch,
  getCharPortraitSeries,
  getCombatModelSrc,
  getCombatShootIdleSrc,
  bindLivePortraits,
  unloadLivePortraits,
  type PortraitSide,
} from "./uiAssets";
import { cyclePortraitSeriesIndex } from "./characterPortraitRuntime";
import { getCombatQualityProfile } from "../game/combatQuality";
import { getCombatModelTemplate } from "../game/combatModelLoader";
import { warmupCombatEnemyTemplate } from "../game/combatEnemyLoader";
import { warmupCombatBuildModels } from "../game/combatBuildLoader";
import { warmupCombatPropModels } from "../game/combatPropsLoader";
import { cssAssetUrl, texUrl } from "../utils/texUrl";
import {
  mountHubBackground,
  pauseHubBackground,
  refreshHubBackground,
  resolveHubOverlayAssets,
} from "./hubAssets";
import { SUB_UI, subUi } from "./subUiAssets";
import {
  CAMP_SHOPKEEPER_ART,
  CAMP_SHOPKEEPER_NAME,
} from "../data/campShopkeeper";
import {
  playShopChestCutscene,
  preloadShopChestVideo,
  isShopChestCutsceneActive,
} from "./shopChestCutscene";
import {
  bindHubPortraitStages,
  renderHubPortraitStage,
  resetHubPortraitStage,
  syncHubPortraitPicker,
  ensureHubHoldPicker,
  isHubPortraitInteractionLocked,
} from "./hubPortraitStage";
import {
  armSilentPortraitVideo,
  applyLivePortraitPoster,
  canPlayLivePortrait,
  getLivePortraitSrc,
  getLivePortraitSecondarySrcs,
} from "./livePortrait";
import { showAlert, showConfirm } from "./confirmDialog";
import {
  applyBadgePos,
  loadBadgePos,
  makeBadgeDraggable,
} from "./badgeDrag";
import { showCharacterDetail } from "./characterDetailDialog";
import { playWorldIntro } from "./worldIntro";
import { playStoryBeat } from "./storyDialogueOverlay";
import {
  advanceGuideConfirm,
  checkGuideDeploy,
  getCampIntroBeat,
  getGuideRequiredDeploy,
  getGuideStep,
  getGuideMaxFightStageId,
  getHubFollowBeat,
  getStageStoryBeat,
  grantGuideArmoryPityWeapon,
  hasSeenStoryBeat,
  isCampLockedByStory,
  isStoryGuideDone,
  markGuideArmoryOpened,
  markHubFollowSeen,
  markStoryBeatSeen,
  recordStoryChoice,
  syncGuideProgress,
} from "../systems/StoryGuideSystem";
import { resolveGuideTarget } from "../systems/GuideTargets";
import type { GuideStepDef } from "../data/storyBeats";
import { pickCombatBackdropUrl } from "../game/combatBackdrops";
import { getCombatTheme } from "../game/combatThemes";
import { exitGame } from "../platform/exitGame";
import {
  refreshFestiveCampDialogueBgm,
  registerBgmBaseRestore,
  syncBgmForView,
  unlockBgm,
} from "../audio/bgm";
import { pickTitlePoster } from "./titlePoster";
import { titleVideoFx } from "./titleVideoFx";
import { bindGalleryPage, renderSceneGalleryHtml } from "./galleryPage";
import { getChapterMapSelectBg } from "../data/sceneGallery";
import { showCampLivingPanel } from "./campLivingPanel";
import { showCampWarehousePanel } from "./campWarehousePanel";
import { showAiDialogue } from "./aiDialogueOverlay";
import {
  renderCampFloorMapHtml,
  renderCampFloorTabsHtml,
  resolveFocusSceneForCharacter,
  refreshCampFloorMapPins,
  bindCampFloorMapPan,
} from "./campFloorMap";
import { formatGameClock } from "../ai/worldClock";
import type { CampFloor } from "../data/campLayout";
import {
  getAiLiving,
  recordCombatReturn,
  runHeartbeatOnce,
  runPlayerOutreachOnce,
  peekPendingAiMessages,
  acceptPendingAiMessage,
  dismissPendingAiMessage,
  setPlayerLocation,
  tickWorldOnly,
  tickDueOutfitChanges,
  ensureAiLivingBooted,
  takeOfflineBanner,
} from "../ai/livingService";
import { prepareSquadDefaultArmor } from "../ai/emotionOutfit";
import { recordArmoryGameplay } from "../ai/gameplayConsequences";
import {
  startLifePathDirector,
  stopLifePathDirector,
} from "../ai/lifePathDirector";
import { tickCampAgents } from "../ai/campAgents";
import { gameMinToRealSec, listActiveCampEventsForUi } from "../ai/campEvents";
import type { AiLivingSave, AiMessageEvent } from "../ai/types";
import { getCyberHealth } from "../systems/CyberHealthSystem";
import {
  showRecruitPage,
  preloadRecruitCutscene,
  RECRUIT_BG_SRC,
} from "./recruitPage";
import type { SaveData } from "../types";
import { playUiSound } from "./uiSound";

type Module =
  "map" | "home" | "shop" | "squad" | "tasks" | "weapons" | "gallery" | "camp";
type HomeSubTab = "archive" | "bag";
type View = "title" | "hub" | Module;
type WeaponsTab = "loadout" | "bag" | "shards";

const CHAR_ARCHIVE_COLS = 5;
const CHAR_ARCHIVE_ROWS = 3;
const CHAR_ARCHIVE_PAGE_SIZE = CHAR_ARCHIVE_COLS * CHAR_ARCHIVE_ROWS;

interface RewardPopup {
  title: string;
  lines: string[];
}

interface PendingBoxOpen {
  times: number;
  free: boolean;
  charId: string;
}

interface BagCharUpgradeFx {
  charId: string;
  fromPower: number;
  toPower: number;
}

const BAG_UPGRADE_FX_MS = 720;

/** 引导坞拖动位置持久化键（rb-ui-badge-pos- 前缀，见 badgeDrag.ts） */
const GUIDE_DOCK_BADGE_KEY = "story-guide-dock";

export class App {
  private uiRoot: HTMLElement;
  private gameRoot: HTMLElement;
  private view: View = "title";
  private selectedStage = 1;
  private mapStageMode: "normal" | "hell" = "normal";
  private lastRollMsg = "";
  private rewardPopup: RewardPopup | null = null;
  private pendingBoxOpen: PendingBoxOpen | null = null;
  private inCombat = false;
  private storyBootRunning = false;
  private storySpotScrollBound = false;
  private storySpotSettleTimer = 0;
  private storySpotLastLayout = "";
  private guideDockCollapsed = false;
  private guideEnforceBound = false;
  private guideDockTimer = 0;
  private guideDockStepKey = "";
  /** ?guide= 调试参数只应用一次，避免覆盖正常推进 */
  private guideDebugApplied = false;
  /** 武器页换装自定义下拉：当前展开哪张角色卡（替代原生 select，手机白底问题） */
  private equipMenuFor: string | null = null;
  /** 巡览点读队列：同一步内一次只讲一个，点发光处步进 */
  private tourStepKey = "";
  private tourIndex = 0;
  /**
   * 有序引导步的点击进度（只记运行时，不入存档）。
   * key = `${stepId}@${view}`，value = 已点过的目标 id 集合。
   * 视口/重渲染不丢；换步/换页自动过期（getGuideSeqDone 里做键校验）。
   */
  private guideSeqKey = "";
  private guideSeqDone = new Set<string>();

  /**
   * P2 调试开关：URL 带 ?guide=g_squad 可空降到任意引导步，不用重打全流程。
   * 只在引导未完成时生效，老玩家（已完成）不受影响。
   */
  private applyGuideDebugParam(): void {
    if (this.guideDebugApplied) return;
    this.guideDebugApplied = true;
    let param: string | null = null;
    try {
      param = new URLSearchParams(window.location.search).get("guide");
    } catch {
      return;
    }
    if (!param) return;
    void import("../data/storyBeats").then(({ GUIDE_STEP_ORDER }) => {
      if (!(GUIDE_STEP_ORDER as string[]).includes(param!)) return;
      saveManager.mutate((d) => {
        if (d.tutorialFlags.storyGuideDone) return;
        d.tutorialFlags.storyHubFollowSeen = true;
        d.tutorialFlags.storyGuideDone = false;
        d.tutorialFlags.storyGuideStep = param!;
      });
      this.render();
    });
  }

  /**
   * P2 懒加载一句话说明：用时再讲、只讲一次、可手动关。
   * 与强制引导互斥：引导期不出现（避免和老板娘牌子打架），引导完成后才出现。
   */
  private lazyHintHtml(key: "sweep" | "hell" | "weapon", text: string): string {
    return `<div class="lazy-hint" data-lazy-hint="${key}"><span>${text}</span><button type="button" data-lazy-dismiss="${key}">知道了</button></div>`;
  }

  /**
   * 老板娘提示坞：每步首次弹出完整版，可手动点坞收回，3 秒无操作自动收成头像圆钮。
   * 高亮指引不受影响（聚光独立），确认键在坞内，点坞即展开，不会卡死。
   */
  private armGuideDockAutocollapse(): void {
    const step = getGuideStep(this.save());
    const key =
      step && this.save().tutorialFlags.storyHubFollowSeen
        ? `${this.view}:${step.id}`
        : "";
    if (key !== this.guideDockStepKey) {
      this.guideDockStepKey = key;
      this.guideDockCollapsed = false;
      if (this.guideDockTimer) {
        window.clearTimeout(this.guideDockTimer);
        this.guideDockTimer = 0;
      }
      const dock = this.uiRoot.querySelector("[data-story-guide-dock]");
      // P1 规则：纯确认步（无 tour 点读）永不自动折叠；有 tour 的 g_tour 允许折叠——
      // 玩家靠点发光处推进，牌子缩成小圆钮后点读牌和确认键都不受影响
      if (
        dock &&
        key &&
        (!step?.confirmLabel || (step.tour?.length ?? 0) > 0)
      ) {
        dock.classList.remove("is-collapsed");
        this.guideDockTimer = window.setTimeout(() => {
          this.guideDockCollapsed = true;
          this.uiRoot
            .querySelector("[data-story-guide-dock]")
            ?.classList.add("is-collapsed");
        }, 3000);
      }
    }
  }
  private campIntroRunning = false;
  private portraitSide: PortraitSide = "front";
  private homeCharPage = 0;
  private homeSubTab: HomeSubTab = "archive";
  /** 场景图库当前大类（世界图 / 各战区） */
  private galleryCategoryId = "world";
  private weaponsTab: WeaponsTab = "loadout";
  private bagCharUpgradeFx: BagCharUpgradeFx | null = null;
  private bagUpgradeFxTimer: number | null = null;
  private lastPlayTick = Date.now();
  /** 编队：点选可用机体后，再点出战槽替换 */
  private squadPickId: string | null = null;
  /** 触控拖拽完成后抑制同一指针产生的 click */
  private squadTouchDragClickGuard = false;
  /** 主页齿轮设置菜单是否展开 */
  private hubSettingsOpen = false;
  /** 营地主页当前查看楼层 */
  private campFloor: CampFloor = 1;
  /** 营地平面图点选角色（可含非编队拥有角色） */
  private campFocusCharId: string | null = null;
  private hubSwipeAbort: AbortController | null = null;
  /** 子页重绘前记住滚动位置，避免背包等同页操作跳回顶部 */
  private lastRenderedView: View | null = null;
  private preservedSubScrollTop = 0;
  private debugCombatBooted = false;
  /** 标题页进入流程中，防止连点 */
  private titleEntering = false;
  /** 本次启动：离线/近日摘要弹窗只尝试一次（仅首次进营地） */
  private offlineCampBannerStarted = false;

  constructor() {
    this.uiRoot = document.getElementById("ui-root")!;
    this.gameRoot = document.getElementById("game-root")!;
    finishArmoryUpgradeIfReady(saveManager.get());
    this.view = this.resolveBootView();
    registerBgmBaseRestore(() => syncBgmForView(this.view, this.inCombat));
    this.render();
    this.preloadCombatModels();
    this.maybeBootDebugCombat();
    this.maybeBootDebugGold();
    // 换装到点穿上（含事件临时外覆）：营地/Hub 也要及时显形，不等下一轮心跳
    window.setInterval(() => {
      if (this.inCombat) return;
      if (this.view !== "hub" && this.view !== "camp") return;
      tickDueOutfitChanges();
    }, 1500);
    window.setInterval(() => this.tickPlayTime(), 30000);
    window.setInterval(() => {
      if (this.inCombat || (this.view !== "hub" && this.view !== "camp"))
        return;
      tickWorldOnly();
      this.syncBgm(); // hub/营地视图下保持 BGM 与界面一致
      void runHeartbeatOnce().then(() => {
        if (this.view === "hub") {
          refreshHubBackground(this.uiRoot.querySelector("[data-hub-bg-slot]"));
          const chip = this.uiRoot.querySelector("[data-hub-clock]");
          if (chip) chip.textContent = formatGameClock(getAiLiving());
        } else if (this.view === "camp") {
          const chip = this.uiRoot.querySelector("[data-hub-clock]");
          if (chip) chip.textContent = formatGameClock(getAiLiving());
          this.refreshCampLifePathUi(false);
        }
        this.syncBgm();
      });
    }, 120000);
    // 主动消息：hub / 营地轮询（战斗页不跑）
    window.setInterval(() => {
      void this.tickHubPlayerOutreach();
    }, 40000);
    // 倒计时秒数刷新（仅有 dock 时）
    window.setInterval(() => {
      if (this.canShowAiMsgDock()) this.refreshHubAiMsgDock();
    }, 5000);
  }

  /** 启动视图：默认标题页；调试战斗直达地图 */
  private resolveBootView(): View {
    if (typeof window === "undefined") return "title";
    const params = new URLSearchParams(window.location.search);
    if (params.has("debugCombat")) return "map";
    if (params.has("skipTitle")) return "hub";
    return "title";
  }

  private tickPlayTime(): void {
    if (this.inCombat) return;
    const now = Date.now();
    const delta = Math.floor((now - this.lastPlayTick) / 1000);
    if (delta <= 0) return;
    this.lastPlayTick = now;
    saveManager.mutate((d) => {
      d.stats.playTimeSeconds += delta;
    });
  }

  private preloadCombatModels(): void {
    const profile = getCombatQualityProfile();
    const seen = new Set<string>();
    for (const charId of saveManager.get().squad) {
      if (getCombatShootIdleSrc(charId)) continue;
      const src = getCombatModelSrc(charId);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      void getCombatModelTemplate(src, profile).catch(() => {});
    }
    void warmupCombatEnemyTemplate(profile).catch(() => {});
    void warmupCombatBuildModels(profile).catch(() => {});
    void warmupCombatPropModels(profile).catch(() => {});
  }

  private maybeBootDebugGold(): void {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("debugGold")) return;
    saveManager.mutate((d) => {
      d.settings.debugInfiniteGold = true;
    });
    this.render();
  }

  private maybeBootDebugCombat(): void {
    if (this.debugCombatBooted || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("debugCombat")) return;
    this.debugCombatBooted = true;

    const stage = Number(params.get("debugStage") ?? "1");
    this.selectedStage = Number.isFinite(stage) && stage > 0 ? stage : 1;
    this.view = "map";
    this.render();

    window.setTimeout(() => {
      if (!this.inCombat) void this.startFight();
    }, 250);
  }

  private save(): SaveData {
    return saveManager.get();
  }

  private refresh(): void {
    this.tickPlayTime();
    finishArmoryUpgradeIfReady(saveManager.get());
    updateLegendaryStat(saveManager.get());
    saveManager.save();
    if (!this.inCombat) this.render();
  }

  private render(): void {
    this.applyGuideDebugParam();
    const wasHub = this.uiRoot.querySelector(".wl-hub") !== null;
    if (wasHub) pauseHubBackground();
    // P0：切页前卸下动态立绘解码，降低离屏发热
    unloadLivePortraits(this.uiRoot);

    const preserveScroll =
      this.view !== "hub" &&
      this.view !== "camp" &&
      this.view !== "title" &&
      this.view === this.lastRenderedView;
    if (preserveScroll) {
      const content = this.uiRoot.querySelector(
        ".content.content-sub",
      ) as HTMLElement | null;
      const subBody = this.uiRoot.querySelector(
        ".wl-sub-body",
      ) as HTMLElement | null;
      this.preservedSubScrollTop = Math.max(
        content?.scrollTop ?? 0,
        subBody?.scrollTop ?? 0,
      );
    } else {
      this.preservedSubScrollTop = 0;
    }

    const s = this.save();
    const isTitle = this.view === "title";
    const isHub = this.view === "hub" || this.view === "camp";
    const showGlobalHeader = !isTitle && !isHub;
    const shellClass = isTitle
      ? "shell-title"
      : isHub
        ? "shell-hub"
        : "shell-sub";
    const contentClass = isTitle
      ? "content-title"
      : isHub
        ? "content-hub"
        : "content-sub";
    const mapChapter = STAGE_MAP[this.selectedStage]?.chapter;
    const mapSelectBg =
      this.view === "map" && mapChapter
        ? getChapterMapSelectBg(mapChapter)
        : null;
    const subBgSrc = mapSelectBg ?? SUB_UI.subBg;
    const subShellStyle =
      !isTitle && !isHub
        ? ` style="--wl-sub-bg:url('${cssAssetUrl(subBgSrc)}');--wl-sub-btn-primary:url('${cssAssetUrl(SUB_UI.btnPrimary)}');--wl-sub-btn-secondary:url('${cssAssetUrl(SUB_UI.btnSecondary)}');--wl-sub-btn-ad:url('${cssAssetUrl(SUB_UI.btnAdWide)}');--wl-sub-btn-ad-sm:url('${cssAssetUrl(SUB_UI.btnTinyAd)}')"`
        : "";
    const guideDockHtml = this.renderStoryGuideDock();
    this.uiRoot.innerHTML = `
      <div class="shell ${shellClass}${guideDockHtml ? " has-story-guide" : ""}"${subShellStyle}>
        <div class="bg-layer" aria-hidden="true"></div>
        <div class="scanlines" aria-hidden="true"></div>
        ${showGlobalHeader ? this.renderSubHeader(s) : ""}
        <main class="content cc-content ${contentClass}">${this.renderContent()}</main>
      </div>
      ${this.renderRewardPopup()}
      ${guideDockHtml}
      <div class="story-spotlight is-hidden" data-story-spotlight></div>
    `;
    this.bindEvents();
    this.applyStoryGuideHighlights();
    this.armGuideDockAutocollapse();
    this.lastRenderedView = this.view;
    this.restoreSubScroll();
    this.syncBgm();
    // 开始页视频状态机：标题页挂载舞台（首次 diyici→xunhuan；返回时由 playExitThen 接管 chuqu）；离开则暂停省电
    if (isTitle) {
      const stage = this.uiRoot.querySelector<HTMLElement>(
        "[data-title-video-stage]",
      );
      if (stage) titleVideoFx.mountStage(stage);
    } else {
      titleVideoFx.pauseStage();
    }
    void this.maybeRunStoryBoot();
    void this.maybeRunCampIntro();
  }

  /**
   * 返回开始页统一收口：先切开始页（BGM/海报/按钮立即就位），再盖 chuqu 过场，播完进循环。
   * @param animated true=带 chuqu 过场（游戏内返回）；false=直接切（重置存档等瞬态）
   */
  private async returnToTitle(animated: boolean): Promise<void> {
    this.hubSettingsOpen = false;
    this.squadPickId = null;
    this.lastRollMsg = "";
    if (animated) {
      await titleVideoFx.playExitThen(() => {
        this.view = "title";
        this.render();
      });
      return;
    }
    this.view = "title";
    this.render();
  }

  /** 首次进入营地：播放老板娘的营地初见引导（只播一次，可跳过） */
  private async maybeRunCampIntro(): Promise<void> {
    if (this.campIntroRunning || this.view !== "camp" || this.inCombat) return;
    const s = this.save();
    if (!isStoryGuideDone(s)) return;
    if (hasSeenStoryBeat(s, "camp_intro")) return;
    this.campIntroRunning = true;
    try {
      const result = await playStoryBeat(getCampIntroBeat(), {
        backdropUrl: "./tex/Indoor/shinei01_yilou_dating.png",
      });
      saveManager.mutate((d) => {
        markStoryBeatSeen(d, "camp_intro");
        for (const [k, v] of Object.entries(result.choices)) {
          recordStoryChoice(d, `camp_intro:${k}`, v);
        }
      });
    } finally {
      this.campIntroRunning = false;
    }
  }

  private restoreSubScroll(): void {
    if (
      this.view === "hub" ||
      this.view === "camp" ||
      this.view === "title" ||
      this.preservedSubScrollTop <= 0
    )
      return;
    const top = this.preservedSubScrollTop;
    requestAnimationFrame(() => {
      const content = this.uiRoot.querySelector(
        ".content.content-sub",
      ) as HTMLElement | null;
      const subBody = this.uiRoot.querySelector(
        ".wl-sub-body",
      ) as HTMLElement | null;
      if (content) content.scrollTop = top;
      if (subBody) subBody.scrollTop = top;
    });
  }

  private renderRewardPopup(): string {
    if (!this.rewardPopup) return "";
    const lines = this.rewardPopup.lines.map((l) => `<li>${l}</li>`).join("");
    return `
      <div class="reward-overlay" data-reward-overlay>
        <div class="reward-modal card hud-card">
          <div class="modal-corner tl"></div><div class="modal-corner tr"></div>
          <div class="modal-corner bl"></div><div class="modal-corner br"></div>
          <h3>${this.rewardPopup.title}</h3>
          <ul class="reward-list">${lines}</ul>
          <button class="btn btn-primary" data-close-reward>确认领取</button>
        </div>
      </div>
    `;
  }

  private sectionHead(title: string, sub: string): string {
    return `<div class="section-head"><span class="section-line"></span><h2>${title}</h2><span class="section-sub">${sub}</span></div>`;
  }

  private hubNavBtn(
    id: Module,
    iconSrc: string,
    label: string,
    sub: string,
    primary = false,
    badge = 0,
  ): string {
    if (primary) {
      return `<button class="hub-nav-btn hub-nav-ops" data-goto="${id}">
        <img class="hub-nav-ops-icon" src="${iconSrc}" alt="" />
        <span class="hub-nav-ops-body">
          <span class="hub-nav-label">${label}</span>
          <span class="hub-nav-sub">${sub}</span>
        </span>
      </button>`;
    }
    return `<button class="hub-nav-btn hub-nav-square" data-goto="${id}">
      ${badge > 0 ? `<span class="hub-badge">${badge}</span>` : ""}
      <img src="${iconSrc}" alt="" />
      <span class="hub-nav-label">${label}</span>
      <span class="hub-nav-sub">${sub}</span>
    </button>`;
  }

  private renderSubHeader(_s: SaveData): string {
    return `
      <header class="wl-sub-header">
        <img class="wl-sub-header-bg" src="${subUi(SUB_UI.headerBar)}" alt="" />
        <div class="wl-sub-header-inner wl-sub-header-inner--brand-only">
          <div class="wl-sub-header-brand">
            <span class="wl-sub-header-title">锈带纪元</span>
            <span class="wl-sub-header-tag">COMMANDER · 总队长</span>
          </div>
        </div>
      </header>`;
  }

  private wrapSub(title: string, sub: string, inner: string): string {
    const noTitle = !title && !sub;
    return `
      <div class="sub-screen wl-sub-screen">
        <div class="wl-sub-toolbar${noTitle ? " wl-sub-toolbar--no-title" : ""}">
          <button class="wl-sub-back" data-back-hub type="button">
            <img class="wl-sub-back-bg" src="${subUi(SUB_UI.backBtn)}" alt="" />
            <span class="wl-sub-back-label">返回指挥部</span>
          </button>
          ${
            noTitle
              ? ""
              : `<div class="wl-sub-title-block" data-tour="page-title">
            <h2 class="wl-sub-title">${title}</h2>
            <span class="wl-sub-title-en">${sub}</span>
          </div>`
          }
        </div>
        <div class="sub-body wl-sub-body">${inner}</div>
      </div>
    `;
  }

  private subHero(artSrc: string, title: string, subtitle: string): string {
    return `
      <div class="wl-sub-hero">
        <img class="wl-sub-hero-frame" src="${subUi(SUB_UI.panelMain)}" alt="" />
        <div class="wl-sub-hero-body">
          <img class="wl-sub-hero-art" src="${texUrl(artSrc)}" alt="" />
          <div class="wl-sub-hero-label">
            <strong>${title}</strong>
            <small>${subtitle}</small>
          </div>
        </div>
      </div>`;
  }

  private subPanel(
    body: string,
    kind: "main" | "lower" | "map" | "map-grid" | "map-detail" = "main",
    crt = false,
    frameKind?: "main" | "lower" | "main2" | "adWide",
  ): string {
    const resolvedFrame = frameKind ?? kind;
    const frame =
      resolvedFrame === "lower" || kind === "map-detail"
        ? SUB_UI.panelLower
        : resolvedFrame === "main2"
          ? SUB_UI.panelMain2
          : resolvedFrame === "adWide"
            ? SUB_UI.btnAdWide
            : SUB_UI.panelMain;
    const kindClass =
      kind === "map"
        ? "wl-sub-panel wl-sub-panel--map"
        : kind === "map-grid"
          ? "wl-sub-panel wl-sub-panel--map-grid"
          : kind === "map-detail"
            ? "wl-sub-panel wl-sub-panel--map-detail"
            : `wl-sub-panel wl-sub-panel--${kind}${crt ? " wl-sub-panel--crt" : ""}`;
    return `
      <div class="${kindClass}">
        <img class="wl-sub-panel-frame" src="${subUi(frame)}" alt="" />
        <div class="wl-sub-panel-body">${body}</div>
        ${crt ? `<img class="wl-sub-crt" src="${subUi(SUB_UI.crtMonitor)}" alt="" />` : ""}
      </div>`;
  }

  private subSectionBar(title: string, hint?: string): string {
    return `
      <div class="wl-section-bar">
        <img class="wl-section-bar-bg" src="${subUi(SUB_UI.sectionBar)}" alt="" />
        <div class="wl-section-bar-body">
          <h3 class="sub-head wl-sub-panel-title wl-section-bar-title">${title}</h3>
          ${hint ? `<p class="muted wl-section-bar-hint task-page-hint">${hint}</p>` : ""}
        </div>
      </div>`;
  }

  private subBtn(
    label: string,
    className: string,
    attrs: string,
    variant: "primary" | "secondary" | "ad" | "ad-wide" | "tiny",
  ): string {
    const bg =
      variant === "primary"
        ? SUB_UI.btnPrimary
        : variant === "secondary"
          ? SUB_UI.btnSecondary
          : variant === "ad-wide"
            ? SUB_UI.btnAdWide
            : variant === "tiny"
              ? SUB_UI.btnTinyAd
              : SUB_UI.btnTinyAd;
    const wide = variant === "ad-wide" ? " wl-sub-btn-ad-wide" : "";
    const tiny = variant === "tiny" ? " wl-sub-btn--tiny" : "";
    return `<button class="btn ${className}${wide}${tiny}" ${attrs}><img class="btn-bg" src="${subUi(bg)}" alt="" /><span class="btn-text">${label}</span></button>`;
  }

  private portraitFlipBtn(charId: string): string {
    const hubOpts =
      this.view === "hub" ? { skinChannel: "player" as const } : undefined;
    if (
      !hasPortraitFlip(charId, hubOpts) &&
      !hasPortraitSeriesSwitch(charId, hubOpts)
    )
      return "";
    const series = getCharPortraitSeries(charId, hubOpts);
    const label =
      series.length > 1
        ? "切换立绘"
        : this.portraitSide === "front"
          ? "背面"
          : "正面";
    return `<button class="portrait-flip-btn" data-flip-portrait type="button">${label}</button>`;
  }

  private shouldUseLivePortrait(_charId: string): boolean {
    return false;
  }

  private shouldUseHubMainLivePortrait(charId: string): boolean {
    const s = this.save();
    return (
      this.view === "hub" &&
      !!getLivePortraitSrc(charId, { skinChannel: "player" }) &&
      this.portraitSide === "front" &&
      s.settings.useLivePortrait
    );
  }

  private renderHubPortrait(charId: string): string {
    const hubOpts = { skinChannel: "player" as const };
    if (this.shouldUseHubMainLivePortrait(charId)) {
      return renderHubPortraitStage(
        charId,
        "hub-char-portrait",
        "hub-char-icon",
      );
    }
    const canCycle = hasPortraitSeriesSwitch(charId, hubOpts);
    const portrait = renderCharPortrait(
      charId,
      this.portraitSide,
      "hub-char-portrait",
      "hub-char-icon",
      "",
      hubOpts,
    );
    if (!canCycle) return portrait;
    return `<button type="button" class="hub-static-portrait-hit" data-cycle-static-portrait aria-label="切换同系列立绘">${portrait}</button>`;
  }

  private livePortraitToggle(charId: string): string {
    if (!getLivePortraitSrc(charId, { skinChannel: "player" })) return "";
    const enabled = this.save().settings.useLivePortrait;
    return `<button class="wl-settings-item live-portrait-toggle ${enabled ? "is-on" : ""}" data-toggle-live-portrait type="button">动态立绘 ${enabled ? "开" : "关"}</button>`;
  }

  private wl(src: string): string {
    return texUrl(src);
  }

  private wlSideBtn(
    img: string,
    label: string,
    goto: Module,
    badge?: { text: string; title: string; kind?: "slots" | "claim" },
  ): string {
    const tip = badge?.title ?? "";
    const aria = tip ? `${label}（${tip}）` : label;
    const badgeKind = badge?.kind ?? "claim";
    return `<button class="wl-side-btn" type="button" data-goto="${goto}" aria-label="${aria}"${tip ? ` title="${tip}"` : ""}>
      <img src="${img}" alt="" />
      <span class="wl-side-text"><span class="wl-side-label">${label}</span></span>
      ${badge ? `<span class="wl-badge wl-badge--${badgeKind}">${badge.text}</span>` : ""}
    </button>`;
  }

  private renderBottomNavTab(
    goto: "hub" | "home" | "weapons" | "camp",
    label: string,
  ): string {
    const active =
      (goto === "hub" && this.view === "hub") ||
      (goto === "home" && this.view === "home") ||
      (goto === "weapons" && this.view === "weapons") ||
      (goto === "camp" && this.view === "camp");
    const locked = goto === "camp" && isCampLockedByStory(this.save());
    return `<button class="wl-nav-tab${active ? " is-active" : ""}${locked ? " is-locked" : ""}" type="button" data-goto="${goto}" aria-label="${label}${locked ? "（引导完成后解锁）" : ""}"${locked ? ' data-story-locked="camp"' : ""}>
      <span class="wl-nav-label">${label}</span>
    </button>`;
  }

  private renderHubAvatar(charId: string): string {
    const avatarSrc = getCharAvatarSrc(charId);
    const inner = avatarSrc
      ? `<img class="wl-avatar-portrait" src="${texUrl(avatarSrc)}" alt="" />`
      : `<span class="wl-avatar-emoji">${CHARACTER_MAP[charId]?.icon ?? "?"}</span>`;
    return `<div class="wl-avatar-inner">${inner}</div>`;
  }

  private renderHub(): string {
    const s = this.save();
    const feat = hubFeaturedCharDisplay(s.squad, s.settings.hubFeaturedCharId);
    const highest = s.stats.highestStage;
    const sweep = getSweepStatus(s);
    const claimableTasks = getClaimableTasks(s).length;
    const taskBadge =
      claimableTasks > 0
        ? {
            text: String(claimableTasks),
            title: `${claimableTasks} 项任务奖励可领取`,
            kind: "claim" as const,
          }
        : undefined;
    const level = Math.max(1, Math.floor(highest / 2) + 1);
    const xpPct = Math.min(100, Math.round((highest / 40) * 100));
    const midVisible = s.settings.hubMidUiVisible !== false;
    const canSwitch = s.squad.length > 1;
    let clockLabel = "";
    try {
      tickWorldOnly();
      clockLabel = formatGameClock(getAiLiving());
    } catch {
      clockLabel = "";
    }

    const portraitBlock = feat
      ? `
          <div class="hub-char-zone${canSwitch ? " is-swipeable" : ""}"${canSwitch ? " data-hub-char-swipe" : ""}>
            ${canSwitch ? `<button class="hub-char-arrow hub-char-arrow-prev" type="button" data-hub-feat-prev aria-label="上一个上场角色">‹</button>` : ""}
            ${this.renderHubPortrait(feat.id)}
            ${canSwitch ? `<button class="hub-char-arrow hub-char-arrow-next" type="button" data-hub-feat-next aria-label="下一个上场角色">›</button>` : ""}
          </div>`
      : `<div class="hub-char-zone hub-char-zone-empty" data-hub-commander><div class="hub-char-zone-commander"><img class="hub-commander-portrait" src="${texUrl("./tex/zhujue_portrait.png")}" alt="指挥官" /></div></div>`;

    const hubOverlay = resolveHubOverlayAssets();

    return `
      <section class="hub-screen wl-hub${midVisible ? "" : " hub-mid-ui-hidden"}" style="--wl-hub-btn-secondary:url('${cssAssetUrl(SUB_UI.btnSecondary)}')">
        <div class="hub-stage">
          <div class="hub-bg-slot" data-hub-bg-slot>
            <img class="hub-bg" src="${texUrl(UI_ASSETS.kanbanBg)}" alt="" decoding="async" />
          </div>
          ${portraitBlock}

          <div class="hub-mid-ui${midVisible ? "" : " is-hidden"}" data-hub-mid-ui>
            <img class="hub-mid-bg" src="${texUrl(hubOverlay.midLayer)}" alt="" onerror="this.remove()" />
            <nav class="wl-sidebar" aria-label="侧边菜单">
              ${this.wlSideBtn(this.wl(WASTELAND_UI.sideShop), "商城", "shop")}
              ${this.wlSideBtn(this.wl(WASTELAND_UI.sideEvents), "活动", "gallery")}
              ${this.wlSideBtn(this.wl(WASTELAND_UI.sideTasks), "任务", "tasks", taskBadge)}
              ${this.wlSideBtn(this.wl(WASTELAND_UI.sideSquad), "编队", "squad")}
            </nav>
            <button class="wl-expedition" type="button" data-goto="map" aria-label="废土远征">
              <img src="${this.wl(WASTELAND_UI.bannerExpedition)}" alt="" />
            </button>
          </div>

          ${clockLabel ? `<div class="hub-clock-chip" data-hub-clock>${clockLabel}</div>` : ""}

          <header class="wl-top">
            <div class="wl-top-left">
              <div class="wl-profile">
                <div class="wl-avatar">
                  ${feat ? this.renderHubAvatar(feat.id) : `<img class="wl-avatar-inner" src="${texUrl("./tex/zhujue_portrait.png")}" alt="指挥官" style="width:100%;height:100%;object-fit:cover;object-position:center top;border-radius:50%;" />`}
                  <img class="wl-avatar-frame" src="${this.wl(WASTELAND_UI.avatarFrame)}" alt="" />
                </div>
                <div class="wl-profile-meta">
                  <div class="wl-level">Lv. ${level}</div>
                  <div class="wl-name">${feat ? feat.name : ""}</div>
                  <div class="wl-xp-track">
                    <img class="wl-xp-bg" src="${this.wl(WASTELAND_UI.xpBar)}" alt="" />
                    <span class="wl-xp-fill" style="width:${xpPct}%"></span>
                  </div>
                </div>
              </div>
              <div class="wl-quick-btns">
                <div class="wl-settings-wrap${this.hubSettingsOpen ? " is-open" : ""}">
                  <button class="wl-icon-btn wl-settings-btn" type="button" aria-label="设置" data-hub-settings>
                    <img src="${this.wl(WASTELAND_UI.btnSettings)}" alt="" />
                  </button>
                  <div class="wl-settings-menu" data-hub-settings-menu${this.hubSettingsOpen ? "" : " hidden"}>
                    ${feat ? this.livePortraitToggle(feat.id) : ""}
                    <button class="wl-settings-item${midVisible ? " is-on" : ""}" type="button" data-toggle-hub-mid-ui>
                      中间 UI ${midVisible ? "开" : "关"}
                    </button>
                    <button class="wl-settings-item" type="button" data-back-title>
                      返回开始主页
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div class="wl-resources">
              <div class="wl-res">
                <img src="${this.wl(WASTELAND_UI.resGold)}" alt="" />
                <span class="wl-res-val">${s.gold}</span>
              </div>
              <div class="wl-res">
                <img src="${this.wl(WASTELAND_UI.resGem)}" alt="" />
                <span class="wl-res-val">${s.tickets}</span>
              </div>
              <div class="wl-res wl-res-sweep" title="扫荡次数 · 每 15 分钟恢复 1 次">
                <img src="${this.wl(WASTELAND_UI.resEnergy)}" alt="" />
                <span class="wl-res-val">${sweep.current}/${sweep.max}</span>
              </div>
            </div>
          </header>

          <nav class="wl-bottom-nav" aria-label="底部导航">
            <img class="wl-bottom-nav-bg" src="${this.wl(WASTELAND_UI.bottomNav)}" alt="" />
            ${this.renderBottomNavTab("hub", "主城")}
            ${this.renderBottomNavTab("home", "角色")}
            ${this.renderBottomNavTab("weapons", "武器")}
            ${this.renderBottomNavTab("camp", "营地")}
          </nav>

          <div class="hub-smoke-layer" aria-hidden="true">
            <img class="hub-smoke-sprite" src="${texUrl(hubOverlay.smoke)}" alt="" onerror="this.remove()" />
          </div>
        </div>
      </section>
    `;
  }

  private renderTitle(): string {
    const poster = texUrl(pickTitlePoster());
    const btnBg = subUi(SUB_UI.btnSecondary);
    const showWorldIntro = this.save().tutorialFlags.worldIntroSeen;
    return `
      <section class="title-screen" aria-label="开始游戏">
        <img class="title-poster" src="${poster}" alt="锈带纪元 游戏海报" draggable="false" />
        <div class="title-video-stage" data-title-video-stage aria-hidden="true"></div>
        <div class="title-veil" aria-hidden="true"></div>
        <div class="title-footer">
          <div class="title-actions">
            <button type="button" class="title-btn" data-title-start>
              <img class="btn-bg" src="${btnBg}" alt="" />
              <span class="btn-text">开始游戏</span>
            </button>
            ${
              showWorldIntro
                ? `<button type="button" class="title-btn" data-title-world-intro>
              <img class="btn-bg" src="${btnBg}" alt="" />
              <span class="btn-text">世界观介绍</span>
            </button>`
                : ""
            }
            <button type="button" class="title-btn" data-title-exit>
              <img class="btn-bg" src="${btnBg}" alt="" />
              <span class="btn-text">退出游戏</span>
            </button>
          </div>
          <p class="title-hint">Rust Belt Era</p>
        </div>
      </section>
    `;
  }

  /** 标题页 → 首次世界观介绍（可选）→ 主页 */
  private async enterFromTitle(): Promise<void> {
    if (this.titleEntering || this.view !== "title") return;
    this.titleEntering = true;
    try {
      unlockBgm();
      const needIntro = !this.save().tutorialFlags.worldIntroSeen;
      if (needIntro) {
        await playWorldIntro();
        saveManager.mutate((d) => {
          d.tutorialFlags.worldIntroSeen = true;
        });
      }
      this.view = "hub";
      this.hubSettingsOpen = false;
      this.render(); // syncBgm → hub；story boot 在 render 末尾
    } finally {
      this.titleEntering = false;
    }
  }

  private renderStoryGuideDock(): string {
    if (this.view === "title" || this.inCombat) return "";
    const step = getGuideStep(this.save());
    if (!step || !this.save().tutorialFlags.storyHubFollowSeen) return "";
    const art =
      step.shopkeeperFacing === "back"
        ? CAMP_SHOPKEEPER_ART.back
        : CAMP_SHOPKEEPER_ART.front;
    // 兜底：condition 步在 hub 且远征按钮异常不可见时，引导坞自带前往操作，避免卡死
    const isHubStageStep = step.id === "g_stage1" && this.view === "hub";
    const fallbackAction = isHubStageStep
      ? `<div class="story-guide-actions"><button type="button" class="btn btn-primary story-guide-confirm" data-story-guide-goto-map><img class="btn-bg" src="${subUi(SUB_UI.btnPrimary)}" alt="" /><span class="btn-text">前往前线</span></button></div>`
      : "";
    const confirm = step.confirmLabel
      ? `<div class="story-guide-actions"><button type="button" class="btn btn-primary story-guide-confirm" data-story-guide-confirm><img class="btn-bg" src="${subUi(SUB_UI.btnPrimary)}" alt="" /><span class="btn-text">${step.confirmLabel}</span></button></div>`
      : fallbackAction;
    // 子页（编队/任务/商城等）引导坞置顶：底部是操作区，不能被挡（编队卡死根因）。
    // hub 主页在「g_stage1 前往第 1 关」步也置顶：右下角远征按钮不能被挡。
    const topDock =
      (this.view !== "hub" && this.view !== "camp") ||
      (this.view === "hub" &&
        (step.id === "g_stage1" ||
          step.id === "g_tour" ||
          step.id === "g_roster"));
    return `
      <aside class="story-guide-dock${topDock ? " story-guide-dock--top" : ""}${this.guideDockCollapsed ? " is-collapsed" : ""}" data-story-guide-dock>
        <img class="story-guide-frame" src="${subUi(SUB_UI.panelLower)}" alt="" />
        <div class="story-guide-art"><img src="${texUrl(art)}" alt="" /></div>
        <div class="story-guide-body">
          <div class="story-guide-name">${CAMP_SHOPKEEPER_NAME}</div>
          <p class="story-guide-text">${step.text}</p>
          ${confirm}
        </div>
      </aside>`;
  }

  /** 信息位巡览全表：当前引导步要求“看一眼”的位置（只看不点，不进点击白名单） */
  private tourList(): {
    el: HTMLElement;
    label: string;
    text: string;
    showValue?: boolean;
  }[] {
    const step = getGuideStep(this.save());
    if (!step?.tour?.length || !this.save().tutorialFlags.storyHubFollowSeen)
      return [];
    const out: {
      el: HTMLElement;
      label: string;
      text: string;
      showValue?: boolean;
    }[] = [];
    for (const t of step.tour) {
      // 上限 6：g_tour 有 5 个信息位，旧上限 4 会把最后一个（营地）永久吞掉
      if (out.length >= 6) break;
      const el = this.uiRoot.querySelector<HTMLElement>(t.sel);
      if (el && el.getBoundingClientRect().width > 0)
        out.push({ el, label: t.label, text: t.text, showValue: t.showValue });
    }
    return out;
  }

  /** 本次只讲一个：按队列序号取当前位，越界钳住 */
  private collectTourMarks(): {
    el: HTMLElement;
    label: string;
    text: string;
    showValue?: boolean;
    idx: number;
    total: number;
  }[] {
    const list = this.tourList();
    if (!list.length) return [];
    if (this.tourIndex >= list.length)
      this.tourIndex = Math.max(0, list.length - 1);
    const one = list[this.tourIndex]!;
    return [{ ...one, idx: this.tourIndex, total: list.length }];
  }

  /** 巡览点读步进：还有下一个则切之并返回 true；已到末位返回 false（交回正常判定） */
  private advanceTour(): boolean {
    const list = this.tourList();
    if (this.tourIndex < list.length - 1) {
      this.tourIndex++;
      this.render();
      const one = this.collectTourMarks()[0];
      try {
        one?.el.scrollIntoView({ block: "nearest" });
      } catch {
        /* 忽略滚动异常 */
      }
      return true;
    }
    return false;
  }

  /** 引导高亮目标（带稳定 id，供有序步判断点没点过） */
  private collectGuideTargetEntries(): { id: string; el: HTMLElement }[] {
    const step = getGuideStep(this.save());
    if (!step || !this.save().tutorialFlags.storyHubFollowSeen) return [];
    const out: { id: string; el: HTMLElement }[] = [];
    const push = (id: string, el: HTMLElement | null) => {
      if (!el || el.getBoundingClientRect().width <= 0) return;
      out.push({ id, el });
    };
    // 新管线：step.targets 引用的注册表 id（支持 'stage-node:1' 这种带参写法），只在对应页面生效
    if (step.targets?.length) {
      for (const raw of step.targets) {
        const arg = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : "";
        const tid = raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : raw;
        // 关卡节点带参：stage-node:1 → [data-stage="1"]
        if (tid === "stage-node") {
          if (this.view !== "map") continue;
          push(
            raw,
            this.uiRoot.querySelector<HTMLElement>(`[data-stage="${arg}"]`),
          );
          continue;
        }
        const def = resolveGuideTarget(tid);
        if (!def || !def.pages.includes(this.view)) continue;
        this.uiRoot
          .querySelectorAll<HTMLElement>(def.selector)
          .forEach((el, i) => push(`${raw}#${i}`, el));
      }
      // tour 步（g_tour）在 hub 全程有目标，不再落入回退
      if (out.length) {
        // g_equip 且芹奈换装菜单已展开：高亮从「下拉按钮」换成「可装的武器行」——
        // 下拉已经拉开，玩家要按的是武器（开箱所得新枪），继续指下拉没有意义。
        // 只取未 disabled 的行（空闲>0 且非使用中），排除「卸下武器」空选项。
        if (step.id === "g_equip" && this.equipMenuFor === "heartforge") {
          const rows = [
            ...this.uiRoot.querySelectorAll<HTMLElement>(
              '[data-equip-menu="heartforge"] [data-equip-pick]:not([disabled])',
            ),
          ].filter((el) => el.dataset.equipPick?.split("|")[1]);
          if (rows.length) {
            return rows.map((el, i) => ({ id: `equip-row#${i}`, el }));
          }
        }
        return out;
      }
    }
    const map: Record<string, string> = {
      hub_commander: "[data-hub-commander]",
      squad: '[data-goto="squad"]',
      tasks: '[data-goto="tasks"]',
      shop: '[data-goto="shop"]',
      weapons: '[data-goto="weapons"]',
      camp: '[data-goto="camp"]',
      map: '[data-goto="map"]',
      stage: '[data-goto="map"]',
    };
    // 高亮目标所在页面：已在该页时不再高亮导航入口（否则画错位置/无意义）
    const highlightView: Record<string, string> = {
      squad: "squad",
      tasks: "tasks",
      shop: "shop",
      weapons: "weapons",
      map: "map",
      stage: "map",
      camp: "camp",
    };
    const sel = map[step.highlight];
    if (sel && highlightView[step.highlight] !== this.view) {
      this.uiRoot
        .querySelectorAll<HTMLElement>(sel)
        .forEach((el, i) => push(`highlight#${i}`, el));
    }

    // 编队页：高亮必选机体与空槽
    if (
      this.view === "squad" &&
      (step.id === "g_squad" || step.id === "g_squad2")
    ) {
      const need =
        step.id === "g_squad" ? ["ashcrow"] : ["ashcrow", "heartforge"];
      const squad = this.save().squad;
      for (let i = 0; i < need.length; i++) {
        const cid = need[i]!;
        if (squad[i] !== cid) {
          push(
            `squad-pick-${cid}`,
            this.uiRoot.querySelector<HTMLElement>(
              `[data-squad-pick="${cid}"]`,
            ),
          );
          push(
            `squad-slot-${i}`,
            this.uiRoot.querySelector<HTMLElement>(
              `[data-squad-slot="${i}"]`,
            ),
          );
        }
      }
    }

    // 商城：高亮开箱按钮
    if (this.view === "shop" && step.id === "g_shop") {
      push(
        "open-box",
        this.uiRoot.querySelector<HTMLElement>('[data-action="open-box"]'),
      );
    }

    // 武器页：高亮芹奈的换装下拉（引导步 g_equip 要求把开箱所得武器装给芹奈）；
    // 缺了它会落入下方「返回指挥部」兜底，把玩家错误带离武器页
    if (this.view === "weapons" && step.id === "g_equip") {
      push(
        "equip-heartforge",
        this.uiRoot.querySelector<HTMLElement>('[data-equip-btn="heartforge"]'),
      );
    }

    // 作战图：引导打指定关 → 高亮关卡节点 + 出战按钮
    if (
      this.view === "map" &&
      (step.id === "g_stage1" ||
        step.id === "g_stage2" ||
        step.id === "g_stage3")
    ) {
      const stageId =
        step.id === "g_stage1" ? 1 : step.id === "g_stage2" ? 2 : 3;
      push(
        `stage-node:${stageId}`,
        this.uiRoot.querySelector<HTMLElement>(`[data-stage="${stageId}"]`),
      );
      push(
        "fight-btn",
        this.uiRoot.querySelector<HTMLElement>('[data-action="fight"]'),
      );
    }

    // 任务页：高亮该领的那条任务的领取按钮（而非返回指挥部）
    if (this.view === "tasks" && step.id === "g_task") {
      push(
        "claim-t1",
        this.uiRoot.querySelector<HTMLElement>(
          '[data-claim-task="t1_stage"]',
        ),
      );
    }

    // 跨页回退指引：目标不在当前页（如战斗后停在作战图）→ 高亮「返回指挥部」带玩家回主页
    if (
      !out.length &&
      this.view !== "hub" &&
      this.view !== "camp" &&
      this.view !== "title" &&
      !this.inCombat
    ) {
      push(
        "back-hub",
        this.uiRoot.querySelector<HTMLElement>("[data-back-hub]"),
      );
    }
    return out;
  }

  /** 有序步的进度键：换步/换页即重置（切页后重新按 1→2 点） */
  private guideSeqStepKey(): string {
    const step = getGuideStep(this.save());
    return step ? `${step.id}@${this.view}` : "";
  }

  /** 有序步：已点过的目标 id 集合（运行时态，不入存档） */
  private guideSeqDoneIds(): Set<string> {
    const key = this.guideSeqStepKey();
    if (key !== this.guideSeqKey) {
      this.guideSeqKey = key;
      this.guideSeqDone.clear();
    }
    return this.guideSeqDone;
  }

  /** 有序步当前该点的目标 id：按理论顺序找第一个「本页已渲染且还没点过」的 */
  private guideSeqNextId(
    expected: string[],
    presentIds: Set<string>,
    done: Set<string>,
  ): string {
    for (const id of expected) {
      if (!presentIds.has(id)) continue;
      if (!done.has(id)) return id;
    }
    return "";
  }

  /** 有序步理论上的点击顺序（与元素是否已渲染无关，避免节点图未加载就被绕过） */
  private guideSeqExpectedIds(step: GuideStepDef): string[] {
    const out: string[] = [];
    for (const raw of step.targets ?? []) {
      const tid = raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : raw;
      if (tid === "stage-node") {
        if (this.view === "map") out.push(raw);
        continue;
      }
      const def = resolveGuideTarget(tid);
      if (!def || !def.pages.includes(this.view)) continue;
      if (!out.includes(raw)) out.push(raw);
    }
    return out;
  }

  /**
   * 有序步的点击闸门：只允许点「第一个还没点过的目标」。
   * 返回 'allow'（放行）/ 'deny'（不是当前该点的）/ 'off'（非有序步或非目标）。
   */
  private guideSeqGate(el: HTMLElement): "allow" | "deny" | "off" {
    const step = getGuideStep(this.save());
    if (!step?.ordered) return "off";
    const expected = this.guideSeqExpectedIds(step);
    if (expected.length < 2) return "off";
    const allEntries = this.collectGuideTargetEntries();
    const present = allEntries.filter((e) =>
      expected.includes(e.id.split("#")[0]!),
    );
    // 当前页只渲染出一个顺序目标（另一个还没加载/不可见）：不做顺序拦截，避免卡死
    if (present.length < 2) return "off";
    const hit = allEntries.find((e) => e.el === el || e.el.contains(el));
    if (!hit) return "off";
    // 同一选择器命中多个元素时会带 #i 后缀，比较顺序时按原始 id
    const hitId = hit.id.split("#")[0]!;
    if (!expected.includes(hitId)) return "off";
    const done = this.guideSeqDoneIds();
    // 已点过的目标再次点：幂等放行（避免重复点同一个按钮被误判为“顺序错误”）
    if (done.has(hitId)) return "allow";
    const presentIds = new Set(present.map((e) => e.id.split("#")[0]!));
    const nextId = this.guideSeqNextId(expected, presentIds, done);
    if (!nextId) return "allow";
    if (hitId === nextId) {
      done.add(hitId);
      return "allow";
    }
    return "deny";
  }

  /** 误触（非目标 / 顺序不对）时的摇框提示 */
  private guideDenyShake(): void {
    const spot = this.uiRoot.querySelector("[data-story-spotlight]");
    if (!spot) return;
    spot.classList.remove("deny-shake");
    void (spot as HTMLElement).offsetWidth;
    spot.classList.add("deny-shake");
    window.setTimeout(() => spot.classList.remove("deny-shake"), 400);
  }

  /**
   * 引导拦截器的「附带放行区」：高亮控件展开后、内部必须可点的二级区域。
   * 与 collectGuideTargetEntries 区分——这里只影响点击白名单，不挖洞、不打顺序徽章，
   * 避免把菜单里每个选项都标成独立引导步骤。
   */
  private collectGuideClickRegions(): HTMLElement[] {
    const out: HTMLElement[] = [];
    // 换装下拉：展开时菜单整块放行（含其中被 disabled 的不可选行，交给按钮自身语义处理）
    if (this.equipMenuFor) {
      this.uiRoot
        .querySelectorAll<HTMLElement>(
          `[data-equip-menu="${this.equipMenuFor}"]`,
        )
        .forEach((el) => out.push(el));
    }
    return out;
  }

  /** 暗幕挖洞聚光：按目标元素实际渲染矩形挖洞，不与视觉轮廓错位 */
  private applyStoryGuideHighlights(): void {
    const spot = this.uiRoot.querySelector(
      "[data-story-spotlight]",
    ) as HTMLElement | null;
    if (!spot) return;
    // 巡览队列跟随步骤：切步/切页即从第 1 个讲起
    const tourKey = `${this.view}:${getGuideStep(this.save())?.id ?? ""}`;
    if (tourKey !== this.tourStepKey) {
      this.tourStepKey = tourKey;
      this.tourIndex = 0;
    }
    const entries = this.collectGuideTargetEntries();
    const targets = entries.map((t) => t.el);
    const step = getGuideStep(this.save());
    const orderedExpected =
      step?.ordered && step.targets?.length ? this.guideSeqExpectedIds(step) : [];
    // 只有「当前页实际渲染出 ≥2 个顺序目标」才启用有序态；
    // 跨页导航入口（如 hub 上的「前线」）不算，不能把它置灰锁死。
    const orderedCount = entries.filter((e) =>
      orderedExpected.includes(e.id.split("#")[0]!),
    ).length;
    const ordered = orderedCount > 1;
    const doneIds = ordered ? this.guideSeqDoneIds() : null;
    const nextId = ordered
      ? this.guideSeqNextId(
          orderedExpected,
          new Set(entries.map((e) => e.id.split("#")[0]!)),
          doneIds!,
        )
      : "";
    // 有序步：已点过的打勾、还没轮到置灰，让玩家一眼看出只能按 1→2 来。
    // 每次重画都先摘掉所有旧状态类再按当前进度重加（换步/换页后旧元素会残留）。
    this.uiRoot.querySelectorAll(".story-guide-done").forEach((el) => el.classList.remove("story-guide-done"));
    this.uiRoot.querySelectorAll(".story-guide-locked").forEach((el) => el.classList.remove("story-guide-locked"));
    targets.forEach((el, i) => {
      const id = entries[i]!.id.split("#")[0]!;
      el.classList.toggle("story-guide-done", Boolean(ordered && doneIds!.has(id)));
      el.classList.toggle(
        "story-guide-locked",
        Boolean(ordered && id !== nextId && !doneIds!.has(id)),
      );
    });
    // 同步目标描边类：纯视觉，不影响点击/玩法逻辑
    this.uiRoot
      .querySelectorAll(".story-guide-target")
      .forEach((el) => el.classList.remove("story-guide-target"));
    targets.forEach((el) => el.classList.add("story-guide-target"));
    // 信息位巡览：描边+小标签指示位置，不进点击白名单（扫荡耗次数、地狱切页，不让误触）
    const tourMarks = this.collectTourMarks();
    tourMarks.forEach((m) => m.el.classList.add("story-guide-target"));
    if (!targets.length) {
      spot.classList.add("is-hidden");
      spot.innerHTML = "";
      this.uiRoot
        .querySelectorAll(".story-guide-target")
        .forEach((el) => el.classList.remove("story-guide-target"));
      this.storySpotLastLayout = "";
      if (this.storySpotSettleTimer) {
        window.clearInterval(this.storySpotSettleTimer);
        this.storySpotSettleTimer = 0;
      }
      return;
    }

    // 布局签名：目标矩形与视口都没变就不重画，避免重建 DOM 打断呼吸动画
    // 签名里带上有序进度：点过 1 之后 2 要从「锁」变「亮」，必须重画
    const layout = [
      `${window.innerWidth}x${window.innerHeight}`,
      ...entries.map((e) => {
        const r = e.el.getBoundingClientRect();
        const q = (n: number) => Math.round(n / 2) * 2;
        const base = e.id.split("#")[0]!;
        const st = doneIds?.has(base) ? "d" : base === nextId ? "n" : "l";
        return `${st}${q(r.left)},${q(r.top)},${q(r.width)},${q(r.height)}`;
      }),
      ...tourMarks.map((m) => {
        const r = m.el.getBoundingClientRect();
        return `t${Math.round(r.left / 2) * 2},${Math.round(r.top / 2) * 2}`;
      }),
    ].join("|");
    if (
      layout === this.storySpotLastLayout &&
      !spot.classList.contains("is-hidden")
    )
      return;
    this.storySpotLastLayout = layout;

    spot.classList.remove("is-hidden");
    const pad = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 高亮框要外扩 pad + 2px 描边；目标贴屏幕边（如地图页底部「手动战斗」按钮）
    // 时把洞口钳回视口内，保证描边四边完整可见，不再被屏幕边缘裁掉
    const edgeInset = pad + 2;
    const clampN = (n: number, min: number, max: number) =>
      Math.min(max, Math.max(min, n));
    const measured = entries
      .map((e) => ({ id: e.id, el: e.el, raw: e.el.getBoundingClientRect() }))
      .filter((m) => m.raw.width > 0 && m.raw.height > 0);
    const rects = measured.map((m) => {
      const r = m.raw;
      const q = (n: number) => Math.round(n / 2) * 2;
      const left = clampN(q(r.left), edgeInset, vw - edgeInset - 2);
      const top = clampN(q(r.top), edgeInset, vh - edgeInset - 2);
      const right = clampN(q(r.right), left + 2, vw - edgeInset);
      const bottom = clampN(q(r.bottom), top + 2, vh - edgeInset);
      return {
        id: m.id,
        left,
        top,
        width: right - left,
        height: bottom - top,
        right,
        bottom,
      };
    });
    // 零尺寸目标（资源未加载/被移除）时暗幕不挖洞会遮全屏；先隐藏聚光，
    // 但保留 settle timer 让图片加载完成后能重新出现。
    if (!rects.length) {
      spot.classList.add("is-hidden");
      spot.innerHTML = "";
      this.storySpotLastLayout = "";
      if (!this.storySpotSettleTimer) {
        this.storySpotSettleTimer = window.setInterval(() => {
          const alive = this.uiRoot.querySelector("[data-story-spotlight]");
          if (!alive) {
            window.clearInterval(this.storySpotSettleTimer);
            this.storySpotSettleTimer = 0;
            return;
          }
          this.applyStoryGuideHighlights();
        }, 200);
      }
      return;
    }
    // 指引目标在可视区外（需向下滑动的长页面，如商店/任务）：自动滚到目标处，
    // 只在新布局第一次出现时滚一次，滚后由 scroll 监听重对洞口；纯视觉辅助，不改任何逻辑。
    // 注意要逐个目标检查：原实现只看第一个（关卡节点），第二个（出战按钮）
    // 贴底边被裁时永远没人滚它。判定用未钳制的 raw 矩形，钳制后的永远「在界内」。
    for (let i = 0; i < measured.length; i++) {
      const m = measured[i]!;
      const r = m.raw;
      // 首个目标保留原底部余量（避让底部提示条）；后续目标只要求完整可见
      const bottomLimit = i === 0 ? vh - 140 : vh - 24;
      const outOfView = r.top < 70 || r.bottom > bottomLimit;
      if (!outOfView || m.el.dataset.guideScrolled) continue;
      m.el.dataset.guideScrolled = "1";
      try {
        m.el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {
        m.el.scrollIntoView();
      }
      // 平滑滚动结束后强制重挖洞：滚动动画中的 rect 是过程值，
      // 洞会短暂错位，落定后按最终位置重贴
      window.setTimeout(() => {
        if (!this.uiRoot.querySelector("[data-story-spotlight]")) return;
        this.storySpotLastLayout = "";
        this.applyStoryGuideHighlights();
      }, 600);
      break;
    }
    // 暗幕用单个 SVG evenodd 路径一次挖全部洞：
    // 旧实现让每个洞各投一层 9999px 全屏阴影，多目标时互相盖住对方的目标（要按的地方看着也被遮罩挡住）
    let veilPath = `M0 0H${vw}V${vh}H0Z`;
    for (const r of rects) {
      const w = r.width + pad * 2;
      const h = r.height + pad * 2;
      veilPath += `M${r.left - pad} ${r.top - pad}h${w}v${h}h${-w}Z`;
    }
    // 序号徽章标记操作顺序（entries 顺序即引导要求的点击顺序，如先关卡后出战）；
    // 有序步把「已点过」的洞淡出、把「还没轮到」的洞标成锁态，保证按 1→2 点
    const holes = rects
      .map((r, i) => {
        const base = r.id.split("#")[0]!;
        const isDone = Boolean(doneIds?.has(base));
        const isNext = Boolean(ordered && base === nextId);
        const cls = `story-spotlight-hole${isDone ? " is-done" : ""}${
          ordered && !isDone && !isNext ? " is-locked" : ""
        }${isNext ? " is-next" : ""}`;
        // 编号按「理论顺序」取，避免某目标暂未渲染时后面的徽章编号前移
        const orderIdx = ordered ? orderedExpected.indexOf(base) + 1 : i + 1;
        const label = isDone ? "✓" : String(orderIdx);
        return `<div class="${cls}" style="left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px"><i class="story-spotlight-arrow"></i><b class="story-spotlight-order">${label}</b></div>`;
      })
      .join("");
    const tourChips = tourMarks
      .map((m) => {
        const r = m.el.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.max(2, Math.round(r.top) - 34);
        const val = m.showValue
          ? (m.el.textContent ?? "").trim().slice(0, 12)
          : "";
        const head = val ? `${m.label} ${val}` : m.label;
        const tail =
          m.idx + 1 < m.total
            ? "轻点发光处继续"
            : step?.confirmLabel
              ? "读完点右下确认"
              : "读完照①→②继续";
        return `<span class="story-tour-chip" style="left:${cx}px;top:${cy}px"><b>${m.idx + 1}/${m.total}</b>${head}：${m.text}<em>${tail}</em></span>`;
      })
      .join("");
    spot.innerHTML = `<svg class="story-spotlight-veil" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="none" aria-hidden="true"><path d="${veilPath}" fill-rule="evenodd"></path></svg>${holes}${tourChips}`;

    // 常驻对齐：地图页图片/字体异步加载、节点呼吸动画都会推移目标，400ms 核一次签名，
    // 一致直接返回，无目标时由上方分支清掉计时器
    if (!this.storySpotSettleTimer) {
      this.storySpotSettleTimer = window.setInterval(() => {
        if (!this.uiRoot.querySelector("[data-story-spotlight]")) return;
        this.applyStoryGuideHighlights();
      }, 400);
    }

    // 滚动/旋转时让挖洞实时跟随（document 捕获阶段监听，覆盖 .content 与 .wl-sub-body 等所有滚动容器）
    if (!this.storySpotScrollBound) {
      this.storySpotScrollBound = true;
      document.addEventListener(
        "scroll",
        () => this.applyStoryGuideHighlights(),
        true,
      );
      window.addEventListener("resize", () => this.applyStoryGuideHighlights());
    }

    // 异步布局（立绘/字体加载、子页滚动恢复）会把目标推离初始位置：
    // 聚光期间定期对齐，位置漂移后 200ms 内贴回目标。隐藏时也不自毁，
    // 以便图片等资源异步加载完成后能重新点亮高亮。
    if (!this.storySpotSettleTimer) {
      this.storySpotSettleTimer = window.setInterval(() => {
        const alive = this.uiRoot.querySelector("[data-story-spotlight]");
        if (!alive) {
          window.clearInterval(this.storySpotSettleTimer);
          this.storySpotSettleTimer = 0;
          return;
        }
        this.applyStoryGuideHighlights();
      }, 200);
    }
  }

  private async maybeRunStoryBoot(): Promise<void> {
    if (this.storyBootRunning || this.view !== "hub" || this.inCombat) return;
    const s = this.save();
    if (!s.tutorialFlags.worldIntroSeen) return;
    if (s.tutorialFlags.storyHubFollowSeen) return;
    this.storyBootRunning = true;
    try {
      const beat = getHubFollowBeat();
      // 开场看板跟随同样盖场景远景，避免纯黑背景（开场黑屏）
      const backdropUrl = pickCombatBackdropUrl(getCombatTheme(1).id, 1);
      const result = await playStoryBeat(beat, { backdropUrl });
      saveManager.mutate((d) => {
        markHubFollowSeen(d);
        markStoryBeatSeen(d, beat.id);
        for (const [k, v] of Object.entries(result.choices)) {
          recordStoryChoice(d, `${beat.id}:${k}`, v);
        }
        syncGuideProgress(d);
      });
      this.render();
    } finally {
      this.storyBootRunning = false;
    }
  }

  /** 开始页重看世界观（仅已看过序章后显示） */
  private async replayWorldIntroFromTitle(): Promise<void> {
    if (this.titleEntering || this.view !== "title") return;
    if (!this.save().tutorialFlags.worldIntroSeen) return;
    this.titleEntering = true;
    try {
      unlockBgm();
      await playWorldIntro();
      this.syncBgm(); // 回到标题曲，避免介绍曲残留
    } finally {
      this.titleEntering = false;
    }
  }

  private syncBgm(): void {
    try {
      refreshFestiveCampDialogueBgm(getAiLiving());
    } catch {
      /* ignore */
    }
    syncBgmForView(this.view, this.inCombat);
  }

  private async requestExitGame(): Promise<void> {
    const ok = await showConfirm({
      title: "退出游戏",
      message: "确定要退出锈带纪元吗？",
      confirmLabel: "退出",
      cancelLabel: "取消",
      danger: true,
    });
    if (ok) await exitGame();
  }

  private renderContent(): string {
    if (this.view === "title") return this.renderTitle();
    if (this.view === "hub") return this.renderHub();
    if (this.view === "camp") return this.renderCampHub();
    switch (this.view) {
      case "map":
        return this.wrapSub("星系作战", "OPERATION MAP", this.renderMap());
      case "gallery":
        return this.wrapSub("锈带图库", "SCENE CODEX", this.renderGallery());
      case "home":
        return this.wrapSub("", "", this.renderHome());
      case "shop":
        return this.wrapSub("", "", this.renderShop());
      case "weapons":
        return this.wrapSub("武器库", "ARMORY", this.renderWeapons());
      case "squad":
        return this.wrapSub(
          `战术编队 · TCP ${getFullSquadTcp(this.save())}`,
          "COMBAT UNIT",
          this.renderSquad(),
        );
      case "tasks":
        return this.wrapSub("前线任务", "COMBAT ORDERS", this.renderTasks());
    }
  }

  /** 家园营地：全屏平面图；点头像 → 沉浸对话（角色+场景） */
  private renderCampHub(): string {
    const s = this.save();
    const focusId =
      this.campFocusCharId &&
      s.ownedCharacters.some((o) => o.characterId === this.campFocusCharId)
        ? this.campFocusCharId
        : null;
    let clockLabel = "";
    let locHint = "";
    let mapHtml = "";
    let eventBanner = "";
    try {
      tickWorldOnly();
      const living = getAiLiving();
      clockLabel = formatGameClock(living);
      const owned = s.ownedCharacters.map((o) => o.characterId);
      mapHtml = renderCampFloorMapHtml(living, owned, this.campFloor, focusId);
      const onFloor = owned.filter((id) => {
        try {
          const rid = resolveFocusSceneForCharacter(id, living).roomId;
          return (
            rid.includes(this.campFloor === 2 ? "2f" : "1f") ||
            (this.campFloor === 1 &&
              (rid === "room_yard" ||
                rid === "room_1f_pool" ||
                rid === "room_1f_tower" ||
                rid === "room_1f_shop" ||
                rid === "room_1f_armory" ||
                rid === "room_1f_shop_bed"))
          );
        } catch {
          return false;
        }
      });
      locHint = `${this.campFloor}楼 · 在营 ${owned.length} 人 · 本层约 ${onFloor.length} 人`;
      eventBanner = this.renderCampEventBannerHtml(living);
    } catch {
      clockLabel = "";
    }

    return `
      <section class="hub-screen wl-hub camp-hub camp-map-mode hub-mid-ui-hidden">
        <div class="hub-stage" style="--camp-hub-bg: url('${cssAssetUrl(UI_ASSETS.kanbanBg)}')">
          <div class="hub-bg-slot" data-hub-bg-slot>
            <img class="hub-bg" src="${texUrl(UI_ASSETS.kanbanBg)}" alt="" />
          </div>
          <div class="camp-hub-bg-dim" aria-hidden="true"></div>
          <div class="camp-map-dock">${mapHtml}</div>

          ${locHint ? `<div class="camp-hub-loc-chip" data-camp-loc>${locHint}</div>` : ""}
          ${this.renderHubAiMsgDockHtml()}

          <div class="camp-topbar">
            <button class="camp-hub-back" type="button" data-goto="hub" aria-label="返回主城">返回主城</button>
            ${clockLabel ? `<div class="hub-clock-chip" data-hub-clock>${clockLabel}</div>` : '<span class="camp-topbar-filler"></span>'}
            <nav class="camp-hub-sys-bar" aria-label="营地系统">
              <button type="button" class="camp-hub-sys-btn" data-camp-warehouse>仓库</button>
              <button type="button" class="camp-hub-sys-btn" data-camp-shop>商店</button>
              <button type="button" class="camp-hub-sys-btn" data-camp-armory>武器库</button>
            </nav>
            ${renderCampFloorTabsHtml(this.campFloor)}
            ${eventBanner}
          </div>

          <button class="hub-living-fab" type="button" data-camp-living>营地生活</button>
        </div>
      </section>
    `;
  }

  private renderCampEventBannerHtml(
    living: ReturnType<typeof getAiLiving>,
  ): string {
    const events = listActiveCampEventsForUi(living);
    if (!events.length) {
      return `<div class="camp-event-banner is-empty" data-camp-event-banner hidden></div>`;
    }
    const rows = events
      .map((e) => {
        const realSec = gameMinToRealSec(e.remainGameMin);
        const mm = String(Math.floor(realSec / 60)).padStart(2, "0");
        const ss = String(realSec % 60).padStart(2, "0");
        const phaseClass = e.phase === "warn" ? "is-warn" : "is-active";
        const co =
          e.coScreenActive && e.coScreenIds.length >= 2
            ? `<span class="camp-event-co">同屏×${e.coScreenIds.length}${e.topic ? ` · ${e.topic}` : ""}</span>`
            : "";
        return `<div class="camp-event-banner-row ${phaseClass}" data-event-id="${e.instanceId}">
          <strong>${e.name}</strong>
          <span class="camp-event-phase">${e.phaseLabel}</span>
          <span class="camp-event-focus">焦点·${e.focusLabel}</span>
          ${co}
          <span class="camp-event-cd" data-remain-game="${e.remainGameMin}">倒计时 ${e.remainGameMin}分 · ~${mm}:${ss}</span>
        </div>`;
      })
      .join("");
    return `<div class="camp-event-banner" data-camp-event-banner role="status" aria-live="polite">${rows}</div>`;
  }

  private renderGallery(): string {
    return renderSceneGalleryHtml(this.galleryCategoryId);
  }

  private renderMap(): string {
    const s = this.save();
    const stage = STAGE_MAP[this.selectedStage];
    const slots = squadSlotsForStage(this.selectedStage, s);
    const battleTcp = getTeamTcp(s, this.selectedStage);
    const squadTcp = getFullSquadTcp(s);
    const deployIds = getDeployIds(s, this.selectedStage);
    const cleared = s.clearedStages.includes(this.selectedStage);
    const winnable = canManualWin(
      battleTcp,
      stage.recommendedTcp,
      stage.isBoss,
    );
    const hellUnlocked = isChapterHellUnlocked(stage.chapter, s.clearedStages);

    const deployList = deployIds
      .map((cid) => {
        const c = CHARACTER_MAP[cid];
        const oc = s.ownedCharacters.find((o) => o.characterId === cid);
        const p = oc ? getCharacterPower(cid, oc.weaponId, s) : 0;
        return `${c.icon}${c.name}(${p})`;
      })
      .join("、");

    const chapterStages = STAGES.filter(
      (st) => st.chapter === stage.chapter && st.mode === this.mapStageMode,
    );

    const chapterMeta = CHAPTERS.find((c) => c.id === stage.chapter);
    const chapterLabel = chapterMeta?.name ?? `第 ${stage.chapter} 章`;
    const modeLabel = this.mapStageMode === "hell" ? "地狱" : "普通";
    const sweep = getSweepStatus(s);
    const sweepRecoverHint =
      sweep.current >= sweep.max
        ? "已满"
        : `${Math.ceil(sweep.nextRecoverMs / 60000)} 分钟后 +1`;
    const stageTypeLabel =
      stage.combatMode === "raidBoss" ? "雷电BOSS" : stage.type;

    return `
      <section class="panel panel-map cc-panel wl-sub-page wl-map-page">
        <div class="wl-map-sweep-bar" title="扫荡次数 · 每 15 分钟恢复 1 次（普通/地狱共用）">
          <img class="wl-map-sweep-icon" src="${this.wl(WASTELAND_UI.resEnergy)}" alt="" />
          <span class="wl-map-sweep-label">扫荡次数</span>
          <strong class="wl-map-sweep-val" data-tour="sweep-count">${sweep.current}/${sweep.max}</strong>
          <span class="wl-map-sweep-hint">${sweepRecoverHint}</span>
        </div>
        ${isStoryGuideDone(s) && !s.tutorialFlags.sweepGuideSeen && s.clearedStages.length > 0 ? this.lazyHintHtml("sweep", "打过的关不用重打：选已通关的关，点「扫荡」耗次数直接领奖。") : ""}
        <div class="wl-map-chapters-row">
          <div class="chapter-tabs cc-chapters wl-map-chapters">
            ${CHAPTERS.map(
              (c) =>
                `<button type="button" class="chip ${c.id === stage.chapter ? "active" : ""}" data-chapter="${c.id}">${c.name}</button>`,
            ).join("")}
          </div>
        </div>
        <div class="wl-map-mode-row">
          <button type="button" class="chip ${this.mapStageMode === "normal" ? "active" : ""}" data-map-mode="normal">普通</button>
          <button type="button" class="chip ${this.mapStageMode === "hell" ? "active" : ""}" data-map-mode="hell" data-tour="hell-tab" ${hellUnlocked ? "" : "disabled"}>地狱${hellUnlocked ? "" : "（通关本章普通后解锁）"}</button>
        </div>
        ${isStoryGuideDone(s) && !s.tutorialFlags.hellGuideSeen && hellUnlocked ? this.lazyHintHtml("hell", "地狱开了：更难、奖更多，普通和地狱共用扫荡次数。") : ""}

        ${this.subPanel(
          `
          <h3 class="wl-sub-panel-title wl-map-grid-title"><span class="block-icon">◈</span>${chapterLabel} · ${modeLabel} · 关卡矩阵</h3>
          <div class="stage-grid wl-stage-grid wl-stage-grid--12">
            ${chapterStages
              .map((st) => {
                const done = s.clearedStages.includes(st.id);
                const cur = st.id === this.selectedStage;
                const raid = st.combatMode === "raidBoss";
                return `<button type="button" class="stage-btn cc-hex wl-stage-node ${done ? "done" : ""} ${cur ? "cur" : ""} ${st.isBoss ? "boss" : ""} ${raid ? "raid-boss" : ""}" data-stage="${st.id}">
                  <img class="stage-hex-bg" src="${UI_ASSETS.stageHex}" alt="" />
                  <span class="stage-num">${st.chapterIndex}${raid ? "⚡" : st.isBoss ? "★" : ""}</span>
                </button>`;
              })
              .join("")}
          </div>`,
          "map-grid",
        )}

        ${this.subPanel(
          `
          <h3 class="wl-sub-panel-title wl-map-detail-title">${stage.name}</h3>
          <div class="wl-map-detail-layout">
            <div class="wl-map-detail-info">
              <div class="stage-detail stage-brief wl-map-brief">
                <p>本关可出战 <strong>${slots}</strong> 人 · 推荐 TCP <strong data-tour="rec-tcp">${stage.recommendedTcp}</strong></p>
                <p>出战 TCP：<strong data-tour="battle-tcp" class="${battleTcp >= stage.recommendedTcp ? "good" : "warn"}">${battleTcp}</strong>
                  ${squadTcp !== battleTcp ? ` · 编队总战力 <strong>${squadTcp}</strong>（本关仅计前 ${slots} 人）` : ""}
                </p>
                <p class="muted">出战：${deployList || "未编队"}</p>
                <p>类型：${stageTypeLabel} · 限时 ${stage.timer}s · ${stage.combatMode === "raidBoss" ? "击破 BOSS" : `${stage.waves} 波`} · 首通 ${stage.firstClearGold} 币</p>
                ${cleared ? '<span class="badge done-badge">已通关</span>' : winnable ? '<span class="badge ok-badge">可挑战</span>' : '<span class="badge bad-badge">战力不足</span>'}
              </div>
            </div>
            <div class="actions wl-sub-actions wl-map-actions wl-map-actions--side">
            ${
              cleared
                ? `${this.subBtn("手动战斗", "btn-primary", 'data-action="fight"', "primary")}
                   ${this.subBtn("扫荡", "btn-secondary", `data-action="sweep"${sweep.current <= 0 ? " disabled" : ""}`, "secondary")}`
                : `${this.subBtn("手动战斗", "btn-primary", `data-action="fight"${!winnable ? " disabled" : ""}`, "primary")}`
            }
            </div>
          </div>`,
          "map-detail",
        )}
      </section>
    `;
  }

  private renderHome(): string {
    const s = this.save();
    const score = rankingScore(s.stats);
    const claimable = getClaimableAchievements(s);
    const owned = s.ownedCharacters;
    const totalPages = Math.max(
      1,
      Math.ceil(owned.length / CHAR_ARCHIVE_PAGE_SIZE),
    );
    const page = Math.min(this.homeCharPage, totalPages - 1);
    const pageItems = owned.slice(
      page * CHAR_ARCHIVE_PAGE_SIZE,
      (page + 1) * CHAR_ARCHIVE_PAGE_SIZE,
    );
    const subTab = this.homeSubTab;
    const tabBtn = (id: HomeSubTab, label: string) =>
      `<button type="button" class="bag-tab-btn home-sub-tab-btn${subTab === id ? " is-active" : ""}" data-home-tab="${id}">${label}</button>`;

    const archivePanels =
      subTab === "archive"
        ? `
        ${this.subPanel(
          `
        <div class="char-archive-head">
          <h3 class="sub-head wl-sub-panel-title char-archive-title">◈ 机械少女档案</h3>
          <span class="char-archive-pager-label">${owned.length ? `第 ${page + 1} / ${totalPages} 页` : "暂无角色"}</span>
        </div>
        <div class="char-archive-grid">
          ${pageItems
            .map((oc) => {
              const c = CHARACTER_MAP[oc.characterId];
              const power = getCharacterPower(oc.characterId, oc.weaponId, s);
              return `
                <article class="card char-archive-card hud-card cc-char-card" role="button" tabindex="0" data-char-detail="${oc.characterId}" title="查看档案">
                  <div class="char-archive-portrait">
                    <span class="rarity char-archive-rarity ${c.rarity}">${c.rarity}</span>
                    <img class="char-frame-bg" src="${rarityFrame(c.rarity)}" alt="" />
                    ${renderCharPortrait(
                      oc.characterId,
                      "front",
                      "char-portrait-img char-portrait-upper",
                      "char-icon-frame",
                    )}
                  </div>
                  <div class="char-archive-body">
                    <strong class="char-archive-name" title="${c.name}">${c.name}</strong>
                    <p class="char-archive-power">战力 ${power}</p>
                  </div>
                </article>`;
            })
            .join("")}
        </div>
        ${
          totalPages > 1
            ? `<div class="char-archive-pager">
                ${this.subBtn("上一页", "btn-secondary", `data-char-page="prev"${page <= 0 ? " disabled" : ""}`, "secondary")}
                ${this.subBtn("下一页", "btn-secondary", `data-char-page="next"${page >= totalPages - 1 ? " disabled" : ""}`, "secondary")}
              </div>`
            : ""
        }`,
          "lower",
          false,
          "main",
        )}
        ${this.subPanel(
          `
        <h3 class="sub-head wl-sub-panel-title">◈ 成就系统 ${claimable.length ? `<em class="highlight">${claimable.length} 可领</em>` : ""}</h3>
        <div class="ach-list">
          ${ACHIEVEMENTS.map((a) => {
            const done = a.check(s.stats);
            const claimed = s.achievementsClaimed.includes(a.id);
            return `<div class="card ach-card ${claimed ? "claimed" : done ? "ready" : ""}">
              <strong>${a.name}</strong>
              <p>${a.desc}</p>
              <small>🪙${a.rewardGold} 🎫${a.rewardTickets}</small>
              ${done && !claimed ? this.subBtn("领取", "btn-sm btn-primary", `data-claim="${a.id}"`, "tiny") : claimed ? "✅" : "🔒"}
            </div>`;
          }).join("")}
        </div>
        <div class="actions wl-sub-actions">
          ${this.subBtn(s.settings.debugInfiniteGold ? "DEBUG · 无限锈币 ON" : "DEBUG · 无限锈币", `btn-secondary ${s.settings.debugInfiniteGold ? "debug-gold-on" : ""}`, 'data-action="debug-gold" type="button"', "secondary")}
          ${this.subBtn("重置存档", "btn-danger btn-secondary", 'data-action="reset"', "secondary")}
        </div>`,
          "lower",
          false,
          "main",
        )}`
        : this.renderHomeBagPanel();

    return `
      <section class="panel panel-home cc-panel wl-sub-page wl-home-page${subTab === "bag" ? " wl-home-bag-tab" : ""}">
        ${this.lastRollMsg && subTab === "bag" ? `<div class="toast hud-toast">${this.lastRollMsg}</div>` : ""}
        ${this.subPanel(
          `
        <div class="stats-row card hud-card home-stats-compact">
          <div><b>${score}</b><small>排行积分</small></div>
          <div><b>${s.stats.stagesCleared}</b><small>通关数</small></div>
          <div><b>${s.stats.totalKills}</b><small>击杀数</small></div>
          <div><b>${s.stats.charactersOwned}</b><small>角色数</small></div>
        </div>
        <div class="bag-tab-row home-sub-tab-row">
          ${tabBtn("archive", "档案")}
          ${tabBtn("bag", "背包")}
        </div>`,
          "main",
          false,
          "lower",
        )}
        ${archivePanels}
      </section>
    `;
  }

  private renderTasks(): string {
    const s = this.save();
    const claimable = getClaimableTasks(s).length;
    const playMin = Math.floor(s.stats.playTimeSeconds / 60);

    const levelBlocks = Array.from({ length: 10 }, (_, i) => i + 1)
      .map((level) => {
        const tasks = TASKS.filter((t) => t.level === level);
        const cards = tasks
          .map((task) => {
            const progress = getTaskProgress(task, s);
            const claimed = isTaskClaimed(s, task.id);
            const pct =
              task.target > 0
                ? Math.min(
                    100,
                    Math.round((progress.current / task.target) * 100),
                  )
                : 0;
            const statusClass = claimed
              ? "is-claimed"
              : progress.done
                ? "is-ready"
                : "";
            return `
              <article class="card task-card hud-card ${statusClass}">
                <div class="task-card-head">
                  <span class="task-level-badge">Lv.${task.level}</span>
                  <strong class="task-name">${task.name}</strong>
                </div>
                <p class="task-desc">${task.desc}</p>
                <div class="task-progress-wrap">
                  <div class="task-progress-bar"><span style="width:${pct}%"></span></div>
                  <span class="task-progress-text">${progress.current} / ${progress.target}</span>
                </div>
                <p class="task-reward-line">奖励：${describeTaskRewards(task)}</p>
                <div class="task-card-actions">
                  ${
                    claimed
                      ? '<span class="task-done-tag">已领取</span>'
                      : progress.done
                        ? this.subBtn(
                            "领取奖励",
                            "btn-sm btn-primary",
                            `data-claim-task="${task.id}"`,
                            "tiny",
                          )
                        : '<span class="task-lock-tag">进行中</span>'
                  }
                </div>
              </article>`;
          })
          .join("");

        return `
          <section class="task-level-block">
            <h4 class="task-level-title">难度 ${level} 级</h4>
            <div class="task-grid">${cards}</div>
          </section>`;
      })
      .join("");

    return `
      <section class="panel panel-tasks cc-panel wl-sub-page wl-tasks-page">
        ${this.subPanel(
          `
          <div class="task-summary-row">
            <div><b>${claimable}</b><small>可领取</small></div>
            <div><b>${s.tasksClaimed.length}</b><small>已完成</small></div>
            <div><b>${playMin}</b><small>游玩分钟</small></div>
            <div><b>${rankingScore(s.stats)}</b><small>排行积分</small></div>
          </div>`,
          "main",
          false,
          "adWide",
        )}
        ${this.subPanel(
          `
          ${this.subSectionBar(
            "◈ 任务清单 · 1–10 级",
            "依据通关、排行、营地对话与干员羁绊分段解锁。难度逐级提升。",
          )}
          <div class="task-level-list">${levelBlocks}</div>`,
          "lower",
          false,
          "main2",
        )}
        <div class="task-claim-all-bar">
          ${this.subBtn(
            claimable > 0 ? `一键领取（${claimable}）` : "一键领取",
            "btn-secondary task-claim-all-btn",
            `type="button" data-claim-all-tasks${claimable > 0 ? "" : " disabled"}`,
            "secondary",
          )}
        </div>
      </section>
    `;
  }

  private renderHomeBagPanel(): string {
    const s = this.save();

    const charShardCards = s.ownedCharacters
      .map((oc) => {
        const c = CHARACTER_MAP[oc.characterId];
        const info = getCharacterShardUpgradeInfo(s, oc.characterId);
        if (!info) return "";
        const shards = getCharacterShardCount(s, oc.characterId);
        const canUse = shards >= info.required;
        const power = getCharacterPower(oc.characterId, oc.weaponId, s);
        const fx =
          this.bagCharUpgradeFx?.charId === oc.characterId
            ? this.bagCharUpgradeFx
            : null;
        const displayPower = fx ? fx.fromPower : power;
        return `
          <article class="card bag-shard-card hud-card${fx ? " is-upgrade-fx-pending" : ""}" data-bag-char-card="${oc.characterId}">
            <div class="bag-shard-visual">
              <div class="bag-shard-portrait">
                <img class="char-frame-bg" src="${rarityFrame(c.rarity)}" alt="" />
                ${renderCharPortrait(oc.characterId, "front", "char-portrait-img char-portrait-upper", "char-icon-frame")}
              </div>
              <p class="bag-shard-power" data-bag-power>${displayPower}</p>
            </div>
            <div class="bag-shard-body">
              <div class="bag-shard-name-row">
                <strong>${c.name}</strong>
                <span class="rarity ${c.rarity}">${c.rarity}</span>
              </div>
              <p class="bag-shard-count">碎片 ${shards} · 需 ${info.required} 升级</p>
              <p class="bag-shard-meta">已强化 ${info.uses} 次 · 碎片战力 +${oc.shardPowerBonus ?? 0}</p>
              <p class="bag-shard-meta">下次 +${info.powerGain} 战力</p>
              ${this.subBtn(canUse ? "使用碎片" : "碎片不足", "btn-sm btn-primary", `data-use-char-shard="${oc.characterId}"${canUse ? "" : " disabled"}`, "tiny")}
            </div>
          </article>`;
      })
      .join("");

    return this.subPanel(
      `
          <h3 class="sub-head wl-sub-panel-title">◈ 角色碎片</h3>
          <p class="muted bag-page-hint">SR 首次需 3 碎片 +10 战力；SSR 2 碎片 +50；UR 1 碎片 +100。每次使用后需求 +1。武器相关请前往「武器」页。</p>
          <div class="bag-shard-grid">${charShardCards || '<p class="muted bag-empty">暂无角色碎片。重复招募同名角色可获得其专属碎片。</p>'}</div>`,
      "main",
    );
  }

  private renderWeapons(): string {
    const s = this.save();
    const tab = this.weaponsTab;
    const weaponInventory = getWeaponInventory(s);
    const tabBtn = (id: WeaponsTab, label: string) =>
      `<button type="button" class="bag-tab-btn${tab === id ? " is-active" : ""}" data-weapons-tab="${id}">${label}</button>`;

    const equippedByWeapon = new Map<string, string[]>();
    for (const oc of s.ownedCharacters) {
      if (!oc.weaponId) continue;
      const list = equippedByWeapon.get(oc.weaponId) ?? [];
      list.push(CHARACTER_MAP[oc.characterId]?.name ?? oc.characterId);
      equippedByWeapon.set(oc.weaponId, list);
    }

    const loadoutCards = s.ownedCharacters
      .map((oc) => {
        const c = CHARACTER_MAP[oc.characterId];
        const w = oc.weaponId ? WEAPON_MAP[oc.weaponId] : null;
        const power = getCharacterPower(oc.characterId, oc.weaponId, s);
        const enhance = oc.weaponId
          ? (s.weaponEnhanceBonus[oc.weaponId] ?? 0)
          : 0;
        const shotDmg =
          Math.round(
            getCharacterShotDamage(oc.characterId, oc.weaponId, s) * 10,
          ) / 10;
        const rarityMul = RARITY_DAMAGE_MUL[c.rarity];
        const roleMul = getRoleDamageMul(c.tag);
        return `
          <article class="card bag-shard-card hud-card ${c.rarity}">
            <div class="bag-shard-visual">
              <div class="bag-shard-portrait">
                <img class="char-frame-bg" src="${rarityFrame(c.rarity)}" alt="" />
                ${renderCharPortrait(oc.characterId, "front", "char-portrait-img char-portrait-upper", "char-icon-frame")}
              </div>
              <p class="bag-shard-power">${power}</p>
            </div>
            <div class="bag-shard-body">
              <div class="bag-shard-name-row">
                <strong>${c.name}</strong>
                <span class="rarity ${c.rarity}">${c.rarity}</span>
              </div>
              <p class="bag-shard-meta">${c.tag}</p>
              <p class="bag-shard-meta">弹伤 <strong>${shotDmg}</strong> · 职级×${rarityMul} · 职业×${roleMul}${w ? "" : " · 裸装×0.7"}</p>
              <p class="bag-shard-meta">武装：${w ? `${w.icon}${w.name}（${w.power}${enhance ? `+${enhance}` : ""}）` : "未装备"}</p>
              <div class="equip-inline">
                <span>换装</span>
                <button type="button" class="equip-inline-btn" data-equip-btn="${oc.characterId}">${w ? `${w.icon}${w.name}` : "未装备，点击选择"} ▾</button>
                ${
                  this.equipMenuFor === oc.characterId
                    ? `<div class="equip-menu" data-equip-menu="${oc.characterId}">
                  ${w ? `<button type="button" data-equip-pick="${oc.characterId}|">卸下武器</button>` : ""}
                  ${weaponInventory
                    .map((entry) => {
                      const ww = WEAPON_MAP[entry.weaponId];
                      const freeForChar =
                        entry.free + (oc.weaponId === entry.weaponId ? 1 : 0);
                      const cur = oc.weaponId === entry.weaponId;
                      return `<button type="button" data-equip-pick="${oc.characterId}|${entry.weaponId}"${freeForChar <= 0 || cur ? " disabled" : ""}>${ww.icon} ${ww.name} (${ww.power}) · 空闲${freeForChar}${cur ? " · 使用中" : ""}</button>`;
                    })
                    .join("")}
                </div>`
                    : ""
                }
              </div>
            </div>
          </article>`;
      })
      .join("");

    const bagCards = weaponInventory
      .map((entry) => {
        const w = WEAPON_MAP[entry.weaponId];
        const enhance = s.weaponEnhanceBonus[entry.weaponId] ?? 0;
        const holders = equippedByWeapon.get(entry.weaponId) ?? [];
        return `<div class="card weapon-card ${w.rarity}">
          <div>${w.icon}</div>
          <strong>${w.name}</strong>
          <span>基础 ${w.power}${enhance ? ` · 强化 +${enhance}` : ""} · 总战力 ${w.power + enhance}</span>
          <small>${w.rarity} · 持有 ${entry.total} · 售 ${w.sellPrice}</small>
          ${holders.length ? `<em>装备中：${holders.join("、")}</em>` : entry.equipped ? `<em>已装备 ${entry.equipped}/${entry.total}</em>` : "<em>空闲</em>"}
          ${entry.free > 0 ? this.subBtn("出售 1 把", "btn-sm btn-secondary", `data-sell="${entry.weaponId}"`, "tiny") : ""}
          ${entry.free > 0 ? this.subBtn("分解 1 把", "btn-sm btn-secondary", `data-dismantle-weapon="${entry.weaponId}"`, "tiny") : ""}
        </div>`;
      })
      .join("");

    const weaponShardEntries = WEAPONS.filter(
      (w) =>
        getWeaponShardCount(s, w.id) > 0 ||
        (s.weaponEnhanceBonus[w.id] ?? 0) > 0,
    );
    const shardCards =
      weaponShardEntries.length > 0
        ? weaponShardEntries
            .map((w) => {
              const info = getWeaponShardUpgradeInfo(s, w.id)!;
              const shards = getWeaponShardCount(s, w.id);
              const canUse = shards >= info.required;
              return `
          <article class="card bag-shard-card hud-card weapon ${w.rarity}">
            <div class="bag-shard-icon">${w.icon}</div>
            <div class="bag-shard-body">
              <div class="bag-shard-name-row">
                <strong>${w.name}</strong>
                <span class="rarity ${w.rarity}">${w.rarity}</span>
              </div>
              <p class="bag-shard-count">碎片 ${shards} · 需 ${info.required} 强化</p>
              <p class="bag-shard-meta">已强化 ${info.uses} 次 · 武器等级 ${info.uses + 1} · 额外战力 +${info.enhanceBonus}</p>
              <p class="bag-shard-meta">下次 +${info.powerGain} 战力（成长强化）</p>
              ${this.subBtn(canUse ? "强化武器" : "碎片不足", "btn-sm btn-primary", `data-use-weapon-shard="${w.id}"${canUse ? "" : " disabled"}`, "tiny")}
            </div>
          </article>`;
            })
            .join("")
        : '<p class="muted bag-empty">暂无武器碎片。重复获得同种武器（军械箱/补给）时会转化为专属碎片。</p>';

    let tabBody = "";
    if (tab === "loadout") {
      tabBody = `<div class="bag-shard-grid">${loadoutCards || '<p class="muted bag-empty">暂无角色。</p>'}</div>`;
    } else if (tab === "bag") {
      tabBody = `<div class="weapon-grid">${bagCards || '<p class="muted bag-empty">武器背包为空。前往工坊开启军械箱或补给包获取。</p>'}</div>`;
    } else {
      tabBody = `<div class="bag-shard-grid">${shardCards}</div>`;
    }

    return `
      <section class="panel panel-weapons cc-panel wl-sub-page wl-bag-page">
        ${this.lastRollMsg ? `<div class="toast hud-toast">${this.lastRollMsg}</div>` : ""}
        ${!s.tutorialFlags.weaponGuideSeen ? this.lazyHintHtml("weapon", "枪装给谁、谁的战力就涨：每张角色卡点「换装」下拉框换人，闲置的枪可以出售或分解。") : ""}
        ${this.subPanel(
          `
          <div class="bag-tab-row">
            ${tabBtn("loadout", "角色武装")}
            ${tabBtn("bag", "武器背包")}
            ${tabBtn("shards", "碎片强化")}
          </div>
          <p class="muted bag-page-hint">
            ${
              tab === "loadout"
                ? "战斗弹伤 = 角色战斗面板/8 × 职级(SR1 / SSR1.14 / UR1.30) × 职业系数 × 武装；角色基础面板已按职级归一化，武器碎片强化提供递增成长。"
                : tab === "bag"
                  ? "查看持有武器、装备对象；出售或分解空闲复制体。已装备的不可出售/分解。"
                  : "消耗武器碎片强化枪械，永久提升该武器战力；每次强化都会随武器等级小幅增加收益，旧强化进度自动保留。"
            }
          </p>
          ${tabBody}`,
          "main",
          false,
          "main2",
        )}
      </section>
    `;
  }

  /** 商店 hero：老板娘立绘 + 店内场景底层（打包后背景不丢失） */
  private shopHero(): string {
    return `
      <div class="wl-sub-hero shop-hero">
        <img class="wl-sub-hero-frame" src="${subUi(SUB_UI.panelMain)}" alt="" />
        <div class="wl-sub-hero-body">
          <img class="shop-hero-bg" src="${texUrl("./tex/Indoor/shinei01_shop.png")}" alt="" aria-hidden="true" />
          <span class="shop-hero-tint" aria-hidden="true"></span>
          <img class="shop-hero-keeper" src="${texUrl(CAMP_SHOPKEEPER_ART.front)}" alt="${CAMP_SHOPKEEPER_NAME}" />
          <div class="wl-sub-hero-label">
            <strong>营地铁柜 · 商店</strong>
            <small>CAMP SHOPKEEPER</small>
          </div>
        </div>
      </div>`;
  }

  /** 商店招募入口：醒目图标徽记按钮 → 构装体招募页 */
  private recruitEntryBtn(variant: "shop" | "keeper"): string {
    return `
      <button type="button" class="recruit-entry recruit-entry--${variant}" data-action="open-recruit" data-tour="recruit-entry" aria-label="前往唤醒协议招募">
        <img class="recruit-entry-bg" src="${texUrl(RECRUIT_BG_SRC)}" alt="" aria-hidden="true" />
        <span class="recruit-entry-veil" aria-hidden="true"></span>
        <span class="recruit-entry-sigil" aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none">
            <polygon points="32,3 58,18 58,46 32,61 6,46 6,18" stroke="currentColor" stroke-width="2.5" />
            <polygon points="32,11 51,22 51,42 32,53 13,42 13,22" stroke="currentColor" stroke-width="1.2" opacity="0.65" />
            <circle cx="32" cy="32" r="8" stroke="currentColor" stroke-width="2.5" />
            <circle cx="32" cy="32" r="3.2" fill="currentColor" />
            <path d="M32 3v8M32 53v8M6 18l7 4M51 42l7 4M58 18l-7 4M13 42l-7 4" stroke="currentColor" stroke-width="2" />
          </svg>
        </span>
        <span class="recruit-entry-body">
          <strong>唤醒协议 · 构装体招募</strong>
          <small>SR 86% · SSR 12.5% · UR 1.5% · 保底 ${GACHA_PITY}（当前 ${this.save().gachaPity}）</small>
        </span>
        <span class="recruit-entry-go">进入 ❯</span>
      </button>`;
  }

  private renderShop(): string {
    const s = this.save();
    finishArmoryUpgradeIfReady(s);
    const upgrading = s.armoryUpgradeEnd !== null;
    const remain = getUpgradeRemainingMs(s);
    const mins = Math.ceil(remain / 60000);
    const openPrice = getOpenCost(s, false);
    const nextCost = s.armoryLevel < 8 ? ARMORY_UPGRADE_COST[s.armoryLevel] : 0;

    return `
      <section class="panel panel-shop cc-panel wl-sub-page">
        ${this.lastRollMsg ? `<div class="toast hud-toast">${this.lastRollMsg}</div>` : ""}
        ${this.shopHero()}

        ${this.recruitEntryBtn("shop")}

        ${this.subPanel(
          `
          <h3 class="block-title wl-sub-panel-title"><span class="block-icon">📦</span>军械箱 · ARMORY Lv.${s.armoryLevel} <span class="wl-sub-info">INFO</span></h3>
          <p>开箱 ${openPrice}🪙</p>
          ${
            upgrading
              ? `<p>升级中… 剩余约 ${mins} 分钟</p>`
              : s.armoryLevel < 8
                ? `<p>升级至 Lv.${s.armoryLevel + 1}：${nextCost}🪙 · ${ARMORY_UPGRADE_MINUTES[s.armoryLevel]} 分钟</p>
                   ${this.subBtn("升级军械箱", "btn-secondary", `data-action="upgrade-box"${!canUpgradeArmory(s) || s.gold < nextCost ? " disabled" : ""}`, "secondary")}`
                : "<p>已满级</p>"
          }
          <div class="actions wl-sub-actions wl-sub-actions--row">
            ${this.subBtn("开启军械箱", "btn-primary", `data-action="open-box"${s.gold < openPrice ? " disabled" : ""}`, "primary")}
            ${this.subBtn("十连", "btn-secondary", `data-action="open-box-10"${s.gold < openPrice * 10 ? " disabled" : ""}`, "secondary")}
          </div>
          <p class="muted bag-page-hint" style="margin-top:10px">获得的武器进入「武器」页；可在该页装备、强化或分解。</p>`,
          "lower",
          true,
        )}

        ${this.subPanel(
          `
          <h3 class="block-title wl-sub-panel-title"><span class="block-icon">🎁</span>前线补给 · SUPPLY</h3>
          <div class="actions wl-sub-actions">
            ${this.subBtn(`普通 ${PACK_PRICES.normal}🪙`, "btn-secondary", 'data-action="pack-normal"', "secondary")}
            ${this.subBtn(`高级 ${PACK_PRICES.advanced}🪙`, "btn-secondary", 'data-action="pack-advanced"', "secondary")}
            ${this.subBtn(`传说 ${PACK_PRICES.legendary}🪙`, "btn-secondary", 'data-action="pack-legend"', "secondary")}
          </div>`,
          "main",
        )}
      </section>
    `;
  }

  private renderSquad(): string {
    const s = this.save();
    const living = (s as { aiLiving?: AiLivingSave }).aiLiving ?? null;
    const stageSlots = squadSlotsForStage(this.selectedStage, s);
    const battleTcp = getTeamTcp(s, this.selectedStage);
    const pickId =
      this.squadPickId &&
      s.ownedCharacters.some((o) => o.characterId === this.squadPickId)
        ? this.squadPickId
        : null;
    if (this.squadPickId && !pickId) this.squadPickId = null;
    const pickName = pickId ? (CHARACTER_MAP[pickId]?.name ?? pickId) : "";

    return `
      <section class="panel panel-squad cc-panel wl-sub-page">
        ${this.subHero(UI_ASSETS.kanbanBg, "编队", "COMBAT UNIT")}
        ${this.subPanel(
          `
        <p class="muted">关 1-5 出战 1 人 · 6-15 出战 2 人 · 16+ 出战 3 人</p>
        <p class="muted">当前选中关 ${this.selectedStage}：可出战 ${stageSlots} 人 · 出战 TCP <strong>${battleTcp}</strong></p>
        <p class="muted">武器装配与强化请前往底部「武器」页。</p>
        <div class="squad-toolbar">
          <div class="squad-leader-callout">
            <span class="squad-leader-mark">队长</span>
            <span>${s.squad[0] ? `${CHARACTER_MAP[s.squad[0]]?.icon ?? ""} ${CHARACTER_MAP[s.squad[0]]?.name ?? s.squad[0]}` : "暂无队长"} · 队列第 1 位</span>
          </div>
          <button type="button" class="btn btn-primary squad-auto-btn" data-auto-squad ${s.ownedCharacters.length ? "" : "disabled"}>一键上场最高战力</button>
        </div>
        <p class="muted squad-replace-hint">${
          pickId
            ? `已选择 <strong>${pickName}</strong>：点击上方出战槽替换，或再次点击机体取消`
            : "拖动下方可用机体到出战槽，或先点选机体再点出战槽进行替换"
        }</p>
        <div class="squad-slots${pickId ? " is-picking" : ""}">
          ${[0, 1, 2]
            .map((i) => {
              const cid = s.squad[i];
              const deploysThisStage = i < stageSlots;
              if (!cid) {
                return `<div class="card slot empty${pickId ? " is-replace-target" : ""}" data-squad-slot="${i}" data-squad-drop data-squad-slot-drag="">
                  空槽 ${i + 1}${pickId ? " · 点击放入" : ""}
                </div>`;
              }
              const c = CHARACTER_MAP[cid];
              const oc = s.ownedCharacters.find((o) => o.characterId === cid)!;
              const w = oc.weaponId ? WEAPON_MAP[oc.weaponId] : null;
              const shotDmg =
                Math.round(getCharacterShotDamage(cid, oc.weaponId, s) * 10) /
                10;
              return `<div class="card slot ${deploysThisStage ? "deploy-active" : "deploy-bench"}${pickId ? " is-replace-target" : ""}" data-squad-slot="${i}" data-squad-drop data-squad-char="${cid}" data-squad-slot-drag="${cid}" draggable="true">
                <span class="slot-char-head">${c.icon} ${c.name} <span class="rarity ${c.rarity}">${c.rarity}</span> ${cid === pickId ? '<em class="deploy-tag is-selected">已选择</em>' : deploysThisStage ? '<em class="deploy-tag">本关出战</em>' : '<em class="deploy-tag bench">替补</em>'}</span>
                <span data-tour="char-tcp">战力 ${getCharacterPower(cid, oc.weaponId, s)} · 弹伤 ${shotDmg}</span>
                <span>${w ? w.icon + w.name : "无武器"}</span>
                ${this.subBtn("移除", "btn-sm btn-secondary", `data-remove-squad="${cid}"`, "tiny")}
              </div>`;
            })
            .join("")}
        </div>`,
          "main",
        )}
        ${this.subPanel(
          `
        <h3 class="sub-head wl-sub-panel-title">◈ 可用机体</h3>
        <div class="char-pick squad-bench-zone" data-squad-bench-drop>
          <span class="squad-bench-label">候补区 · 拖到这里下场</span>
          ${s.ownedCharacters
            .map((oc) => {
              const c = CHARACTER_MAP[oc.characterId];
              const inSquad = s.squad.includes(oc.characterId);
              const isPick = pickId === oc.characterId;
              const benchHp = living
                ? getCyberHealth(living, oc.characterId)
                : 100;
              const benchDown = benchHp <= 0;
              if (inSquad) {
                return `<button class="btn active squad-bench-card" type="button" disabled data-squad-bench-card>
                  ${c.icon} ${c.name} <span class="rarity ${c.rarity}">${c.rarity}</span> · 已上场
                </button>`;
              }
              return `<button class="btn squad-pick-btn${isPick ? " is-pick" : ""}${benchDown ? " is-down" : ""}" type="button"
                data-squad-pick="${oc.characterId}"
                draggable="true"
                data-squad-drag="${oc.characterId}"${benchDown ? " disabled" : ""}>
                ${c.icon} ${c.name} <span class="rarity ${c.rarity}">${c.rarity}</span>
                <span class="squad-hp-tag${benchDown ? " is-zero" : ""}">义体${benchHp}</span>
              </button>`;
            })
            .join("")}
        </div>`,
          "lower",
        )}
      </section>
    `;
  }

  /** 新手强制引导：引导期内只能点高亮目标/引导坞，战斗中与标题页不限（避免卡死） */
  private shouldEnforceGuide(): boolean {
    if (this.inCombat || this.view === "title") return false;
    const s = this.save();
    if (!s.tutorialFlags.storyHubFollowSeen || isStoryGuideDone(s))
      return false;
    return getGuideStep(s) != null;
  }

  private bindEvents(): void {
    this.uiRoot
      .querySelector("[data-title-start]")
      ?.addEventListener("click", () => {
        // 开始页任一按钮：先播 jinru 过场，结束再执行动作
        titleVideoFx.playClick(() => void this.enterFromTitle());
      });
    this.uiRoot
      .querySelector("[data-title-world-intro]")
      ?.addEventListener("click", () => {
        titleVideoFx.playClick(() => void this.replayWorldIntroFromTitle());
      });
    this.uiRoot
      .querySelector("[data-title-exit]")
      ?.addEventListener("click", () => {
        // 退出游戏不播过场：直接弹确认框，避免开始页残留动画
        void this.requestExitGame();
      });

    // 新手强制引导：引导期内拦截一切非目标点击（捕获阶段，先于各按钮自身 handler）。
    // 放行：引导坞（含确认/折叠）、高亮目标及其子元素；系统弹窗挂在 body，不受影响。
    // uiRoot 常驻，只绑一次，避免重复 render 叠加。
    if (!this.guideEnforceBound) {
      this.guideEnforceBound = true;
      this.uiRoot.addEventListener(
        "click",
        (e) => {
          if (!this.shouldEnforceGuide()) return;
          const t = e.target as HTMLElement;
          if (t.closest("[data-story-guide-dock]")) return;
          // P2 懒加载说明条一律放行：只是看一眼、可手动关，不会绕过引导
          if (t.closest("[data-lazy-hint]")) return;
          const entries = this.collectGuideTargetEntries();
          const hit = entries.find((x) => x.el === t || x.el.contains(t));
          // 巡览点读（只看不点）：点发光的信息位即“知道了”，切下一个并吞掉本次点击。
          // - 例外 1：该信息位本身是本步高亮目标（商城「开启军械箱」），要真正执行；
          // - 例外 2：g_tour 是纯认路 confirm 步，导航牌点了只算“读过了”，
          //   绝不能真的跳走（跳走后目标消失，玩家会被自己的点击困在别的页面）。
          const isTourMark = this.tourList().some(
            (m) => m.el === t || m.el.contains(t) || t.contains(m.el),
          );
          if (
            isTourMark &&
            (!hit || getGuideStep(this.save())?.mode === "confirm")
          ) {
            this.advanceTour();
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (hit) {
            // 有序步（如作战图「先选第 1 关，再点出战」）：只有徽章 1 可点，
            // 直接点 2 会被拦下并摇框，绝不能跳过前置步骤。
            if (this.guideSeqGate(t) === "deny") {
              e.preventDefault();
              e.stopPropagation();
              this.guideDenyShake();
              return;
            }
            return;
          }
          // 弹窗层一律放行：奖励/确认/角色详情等瞬态弹窗若被拦必定卡死，
          // 且弹窗本身就是强制流程的一环（如任务奖励确认领取），不存在“绕过引导”问题
          if (
            t.closest(
              '[data-reward-overlay],[data-confirm-overlay],[role="dialog"],[data-modal],[class*="overlay"],[class*="modal"]',
            )
          )
            return;
          // 高亮控件展开出来的二级区域也要放行（如换装下拉里的武器行）：
          // 只放行触发器的话，引导要求「给芹奈装枪」却点不动菜单项，流程会直接软锁。
          // 这些区域不参与聚光挖洞/顺序徽章，纯属「完成本步必须能点到的配套设施」。
          for (const region of this.collectGuideClickRegions()) {
            if (region === t || region.contains(t)) return;
          }
          e.preventDefault();
          e.stopPropagation();
          this.guideDenyShake();
        },
        true,
      );
    }

    this.uiRoot.querySelectorAll("[data-goto]").forEach((el) => {
      el.addEventListener("click", () => {
        const goto = (el as HTMLElement).dataset.goto!;

        if (goto === "camp" && isCampLockedByStory(this.save())) {
          // 引导终点 g_camp：玩家点营地 = 老板娘开营确认，直接完成引导进营地
          // （进营地后 maybeRunCampIntro 会播 camp_intro 老板娘开营对话），不再弹“未开放”
          if (getGuideStep(this.save())?.id === "g_camp") {
            saveManager.mutate((d) => {
              advanceGuideConfirm(d);
              syncGuideProgress(d);
            });
            this.view = "camp";
            this.hubSettingsOpen = false;
            this.render();
            return;
          }
          void showAlert(
            "营地未开放",
            "先跟着商店老板娘把教学走完（打到第 3 关）。营地之后会解锁。",
          );
          return;
        }

        if (goto === "hub") {
          if (this.view === "hub") return;
          this.view = "hub";
        } else if (goto === "bag") {
          if (this.view === "home" && this.homeSubTab === "bag") return;
          this.view = "home";
          this.homeSubTab = "bag";
        } else if (goto === "home") {
          if (this.view === "home" && this.homeSubTab === "archive") return;
          this.view = "home";
          this.homeCharPage = 0;
          this.homeSubTab = "archive";
        } else {
          const target = goto as Module;
          if (this.view === target) return;
          this.view = target;
          this.homeCharPage = 0;
        }
        if (goto !== "squad") this.squadPickId = null;
        if (goto !== "hub") this.hubSettingsOpen = false;
        this.lastRollMsg = "";
        // 引导「前往前线」确认步（g_squad_ok）：聚光高亮的是「进入战斗」按钮本身，
        // 玩家直接点它进图时视为完成该确认步并锁定第 1 关——否则引导停在 g_squad_ok，
        // 作战图上聚光会错误指向「返回指挥部」，且不提示选第 1 关
        if (goto === "map" && getGuideStep(this.save())?.id === "g_squad_ok") {
          saveManager.mutate((d) => {
            advanceGuideConfirm(d);
            syncGuideProgress(d);
          });
          this.selectedStage = 1;
        } else {
          saveManager.mutate((d) => syncGuideProgress(d));
        }
        this.render();
      });
    });

    // 引导坞点击空白处 → 折叠成头像小圆钮（再点展开）；避免遮挡出战/开箱等操作区。
    // 玩家可整坞拖动避让文字：拖动距离超阈值才算拖（不误触折叠），位置持久化，重渲染后恢复。
    const guideDock = this.uiRoot.querySelector<HTMLElement>(
      "[data-story-guide-dock]",
    );
    if (guideDock) {
      const dockPos = loadBadgePos(GUIDE_DOCK_BADGE_KEY);
      if (dockPos) applyBadgePos(guideDock, dockPos);
      makeBadgeDraggable(guideDock, GUIDE_DOCK_BADGE_KEY);
      guideDock.addEventListener("click", (e) => {
        if (
          (e.target as HTMLElement).closest(
            "[data-story-guide-confirm], [data-story-guide-goto-map]",
          )
        )
          return;
        this.guideDockCollapsed = !this.guideDockCollapsed;
        guideDock.classList.toggle("is-collapsed", this.guideDockCollapsed);
      });
    }

    this.uiRoot
      .querySelector("[data-story-guide-confirm]")
      ?.addEventListener("click", () => {
        let gotoMap = false;
        let gotoSquad = false;
        let done = false;
        saveManager.mutate((d) => {
          const r = advanceGuideConfirm(d);
          gotoMap = Boolean(r.gotoMap);
          gotoSquad = Boolean((r as { gotoSquad?: boolean }).gotoSquad);
          done = Boolean(r.done);
          syncGuideProgress(d);
        });
        if (gotoMap) {
          this.view = "map";
          this.selectedStage = 1;
        } else if (gotoSquad) {
          this.view = "squad";
        } else if (done) {
          this.view = "camp";
        }
        this.render();
      });

    // P2 懒加载说明关闭：只讲一次，点「知道了」永久关闭
    this.uiRoot.querySelectorAll("[data-lazy-dismiss]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const key = (el as HTMLElement).dataset.lazyDismiss!;
        saveManager.mutate((d) => {
          if (key === "sweep") d.tutorialFlags.sweepGuideSeen = true;
          else if (key === "hell") d.tutorialFlags.hellGuideSeen = true;
          else if (key === "weapon") d.tutorialFlags.weaponGuideSeen = true;
        });
        this.render();
      });
    });

    // 兜底：g_stage1 在 hub 时远征按钮异常不可见，提供直达地图入口
    this.uiRoot
      .querySelector("[data-story-guide-goto-map]")
      ?.addEventListener("click", () => {
        this.view = "map";
        this.selectedStage = 1;
        this.render();
      });

    this.uiRoot.querySelectorAll("[data-home-tab]").forEach((el) => {
      el.addEventListener("click", () => {
        const tab = (el as HTMLElement).dataset.homeTab as HomeSubTab;
        if (!tab || tab === this.homeSubTab) return;
        this.homeSubTab = tab;
        this.homeCharPage = 0;
        this.lastRollMsg = "";
        this.render();
      });
    });

    this.uiRoot
      .querySelector("[data-hub-settings]")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.hubSettingsOpen = !this.hubSettingsOpen;
        this.render();
      });

    this.uiRoot
      .querySelector("[data-hub-settings-menu]")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
      });

    this.uiRoot
      .querySelector("[data-back-hub]")
      ?.addEventListener("click", () => {
        this.view = "hub";
        this.squadPickId = null;
        this.hubSettingsOpen = false;
        this.lastRollMsg = "";
        this.render();
      });

    if (this.view === "gallery") {
      bindGalleryPage(this.uiRoot, {
        activeCategoryId: this.galleryCategoryId,
        onSelectCategory: (id) => {
          this.galleryCategoryId = id;
          this.render();
        },
      });
    }

    this.uiRoot
      .querySelector("[data-flip-portrait]")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        const featId =
          resolveHubFeaturedCharId(
            this.save().squad,
            this.save().settings.hubFeaturedCharId,
          ) ?? this.save().squad[0];
        const hubOpts =
          this.view === "hub" ? { skinChannel: "player" as const } : undefined;
        if (featId && hasPortraitSeriesSwitch(featId, hubOpts)) {
          cyclePortraitSeriesIndex(
            featId,
            getCharPortraitSeries(featId, hubOpts).length,
          );
        } else {
          this.portraitSide = this.portraitSide === "front" ? "back" : "front";
        }
        this.render();
      });

    this.uiRoot
      .querySelector("[data-cycle-static-portrait]")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        const featId =
          resolveHubFeaturedCharId(
            this.save().squad,
            this.save().settings.hubFeaturedCharId,
          ) ?? this.save().squad[0];
        const hubOpts =
          this.view === "hub" ? { skinChannel: "player" as const } : undefined;
        if (!featId || !hasPortraitSeriesSwitch(featId, hubOpts)) return;
        cyclePortraitSeriesIndex(
          featId,
          getCharPortraitSeries(featId, hubOpts).length,
        );
        this.render();
      });

    this.uiRoot
      .querySelectorAll("[data-toggle-live-portrait]")
      .forEach((el) => {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          saveManager.mutate((d) => {
            d.settings.useLivePortrait = !d.settings.useLivePortrait;
          });
          this.hubSettingsOpen = true;
          this.render();
        });
      });

    this.uiRoot
      .querySelector("[data-toggle-hub-mid-ui]")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        saveManager.mutate((d) => {
          d.settings.hubMidUiVisible = !(d.settings.hubMidUiVisible !== false);
        });
        this.hubSettingsOpen = true;
        this.render();
      });

    this.uiRoot
      .querySelector("[data-back-title]")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.returnToTitle(true);
      });

    this.uiRoot
      .querySelector("[data-hub-feat-prev]")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cycleHubFeatured(-1);
      });
    this.uiRoot
      .querySelector("[data-hub-feat-next]")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cycleHubFeatured(1);
      });
    this.bindHubFeaturedSwipe();

    this.uiRoot.querySelectorAll("[data-chapter]").forEach((el) => {
      el.addEventListener("click", () => {
        const ch = Number((el as HTMLElement).dataset.chapter);
        this.selectedStage =
          this.mapStageMode === "hell"
            ? hellStageId(ch, 1)
            : normalStageId(ch, 1);
        this.render();
      });
    });

    this.uiRoot.querySelectorAll("[data-map-mode]").forEach((el) => {
      el.addEventListener("click", () => {
        const mode = (el as HTMLElement).dataset.mapMode as "normal" | "hell";
        if (mode === "hell") {
          const ch = STAGE_MAP[this.selectedStage]?.chapter ?? 1;
          if (!isChapterHellUnlocked(ch, this.save().clearedStages)) return;
        }
        this.mapStageMode = mode;
        const ch = STAGE_MAP[this.selectedStage]?.chapter ?? 1;
        this.selectedStage =
          mode === "hell" ? hellStageId(ch, 1) : normalStageId(ch, 1);
        this.render();
      });
    });

    this.uiRoot.querySelectorAll("[data-stage]").forEach((el) => {
      el.addEventListener("click", () => {
        this.selectedStage = Number((el as HTMLElement).dataset.stage);
        this.render();
      });
    });

    this.uiRoot
      .querySelector('[data-action="fight"]')
      ?.addEventListener("click", () => {
        void this.startFight();
      });
    this.uiRoot
      .querySelector('[data-action="sweep"]')
      ?.addEventListener("click", () => this.sweep());
    this.uiRoot
      .querySelector('[data-action="reset"]')
      ?.addEventListener("click", () => {
        void showConfirm({
          title: "重置存档",
          message: "确定重置存档？所有进度将被清除，且无法恢复。",
          confirmLabel: "重置",
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          saveManager.reset();
          this.homeCharPage = 0;
          void this.returnToTitle(false);
        });
      });
    this.uiRoot
      .querySelector('[data-action="debug-gold"]')
      ?.addEventListener("click", () => {
        saveManager.mutate((d) => {
          d.settings.debugInfiniteGold = !d.settings.debugInfiniteGold;
        });
        this.render();
      });

    this.uiRoot.querySelectorAll("[data-claim]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = (el as HTMLElement).dataset.claim!;
        saveManager.mutate((d) => claimAchievement(d, id));
        this.render();
      });
    });

    this.uiRoot.querySelectorAll("[data-claim-task]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = (el as HTMLElement).dataset.claimTask!;
        let lines: string[] = [];
        saveManager.mutate((d) => {
          const r = claimTask(d, id);
          if (r.ok) lines = r.lines;
          else this.lastRollMsg = r.msg;
          syncGuideProgress(d);
        });
        if (lines.length) {
          this.rewardPopup = { title: "任务奖励", lines };
        }
        this.render();
      });
    });

    this.uiRoot
      .querySelector("[data-claim-all-tasks]")
      ?.addEventListener("click", (el) => {
        if ((el.currentTarget as HTMLButtonElement).disabled) return;
        let lines: string[] = [];
        saveManager.mutate((d) => {
          const r = claimAllTasks(d);
          if (r.ok) lines = r.lines;
          else this.lastRollMsg = r.msg;
          syncGuideProgress(d);
        });
        if (lines.length) {
          this.rewardPopup = { title: "任务奖励", lines };
        }
        this.render();
      });

    this.uiRoot.querySelectorAll("[data-weapons-tab]").forEach((el) => {
      el.addEventListener("click", () => {
        this.weaponsTab = (el as HTMLElement).dataset.weaponsTab as WeaponsTab;
        this.render();
      });
    });

    this.uiRoot.querySelectorAll("[data-use-char-shard]").forEach((el) => {
      el.addEventListener("click", () => {
        const charId = (el as HTMLElement).dataset.useCharShard!;
        let upgraded = false;
        saveManager.mutate((d) => {
          const oc = d.ownedCharacters.find((o) => o.characterId === charId);
          const fromPower = oc
            ? getCharacterPower(oc.characterId, oc.weaponId, d)
            : 0;
          const r = useCharacterShards(d, charId);
          if (r.ok) {
            const ocAfter = d.ownedCharacters.find(
              (o) => o.characterId === charId,
            );
            const toPower = ocAfter
              ? getCharacterPower(ocAfter.characterId, ocAfter.weaponId, d)
              : fromPower;
            this.bagCharUpgradeFx = { charId, fromPower, toPower };
            upgraded = true;
          }
          this.lastRollMsg = r.msg;
        });
        this.render();
        if (upgraded) this.playBagCharUpgradeFx();
      });
    });

    this.uiRoot.querySelectorAll("[data-use-weapon-shard]").forEach((el) => {
      el.addEventListener("click", () => {
        const weaponId = (el as HTMLElement).dataset.useWeaponShard!;
        saveManager.mutate((d) => {
          const r = useWeaponShards(d, weaponId);
          this.lastRollMsg = r.msg;
        });
        this.render();
      });
    });

    this.uiRoot.querySelectorAll("[data-dismantle-weapon]").forEach((el) => {
      el.addEventListener("click", () => {
        const weaponId = (el as HTMLElement).dataset.dismantleWeapon!;
        saveManager.mutate((d) => {
          const r = dismantleWeaponCopy(d, weaponId);
          this.lastRollMsg = r.msg;
        });
        this.render();
      });
    });

    this.uiRoot.querySelectorAll("[data-char-detail]").forEach((el) => {
      const open = () => {
        const charId = (el as HTMLElement).dataset.charDetail!;
        const firstOpen = !this.save().tutorialFlags.charGuideSeen;
        if (firstOpen) {
          saveManager.mutate((d) => {
            d.tutorialFlags.charGuideSeen = true;
          });
        }
        showCharacterDetail(charId, this.save(), {
          onChanged: () => this.render(),
          guideHint: firstOpen
            ? "每个人的招式、冷却和战力都写在这里，换武器会涨战力。"
            : undefined,
        });
      };
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => {
        const ke = e as KeyboardEvent;
        if (ke.key === "Enter" || ke.key === " ") {
          ke.preventDefault();
          open();
        }
      });
    });

    this.uiRoot
      .querySelector('[data-char-page="prev"]')
      ?.addEventListener("click", () => {
        if (this.homeCharPage > 0) {
          this.homeCharPage--;
          this.render();
        }
      });
    this.uiRoot
      .querySelector('[data-char-page="next"]')
      ?.addEventListener("click", () => {
        const totalPages = Math.max(
          1,
          Math.ceil(
            this.save().ownedCharacters.length / CHAR_ARCHIVE_PAGE_SIZE,
          ),
        );
        if (this.homeCharPage < totalPages - 1) {
          this.homeCharPage++;
          this.render();
        }
      });

    this.uiRoot
      .querySelector('[data-action="open-recruit"]')
      ?.addEventListener("click", () => {
        // 进入征召大厅（引导 g_shop 巡览到此处；不阻断军械箱主线）
        preloadRecruitCutscene();
        showRecruitPage({ onExit: () => this.render() });
      });
    if (this.view === "shop") preloadRecruitCutscene();
    this.uiRoot
      .querySelector('[data-action="open-box"]')
      ?.addEventListener("click", () => this.requestOpenBox(1));
    this.uiRoot
      .querySelector('[data-action="open-box-10"]')
      ?.addEventListener("click", () => this.requestOpenBox(10));
    this.uiRoot
      .querySelector('[data-action="upgrade-box"]')
      ?.addEventListener("click", () => {
        saveManager.mutate((d) => startArmoryUpgrade(d));
        this.render();
      });
    this.uiRoot
      .querySelector('[data-action="pack-normal"]')
      ?.addEventListener("click", () => this.buyPack("normal"));
    this.uiRoot
      .querySelector('[data-action="pack-advanced"]')
      ?.addEventListener("click", () => this.buyPack("advanced"));
    this.uiRoot
      .querySelector('[data-action="pack-legend"]')
      ?.addEventListener("click", () => this.buyPack("legendary"));

    this.uiRoot.querySelectorAll("[data-sell]").forEach((el) => {
      el.addEventListener("click", () => {
        const wid = (el as HTMLElement).dataset.sell!;
        saveManager.mutate((d) => {
          const r = sellWeapon(d, wid);
          this.lastRollMsg = r.msg;
        });
        this.render();
      });
    });

    this.uiRoot.querySelectorAll("[data-squad-pick]").forEach((el) => {
      el.addEventListener("click", () => {
        if (this.squadTouchDragClickGuard) {
          this.squadTouchDragClickGuard = false;
          return;
        }
        const cid = (el as HTMLElement).dataset.squadPick!;
        this.squadPickId = this.squadPickId === cid ? null : cid;
        this.render();
      });
    });

    this.uiRoot
      .querySelector("[data-auto-squad]")
      ?.addEventListener("click", () => {
        saveManager.mutate((d) => {
          const required = getGuideRequiredDeploy(d, this.selectedStage) ?? [];
          const ranked = d.ownedCharacters
            .filter((oc) => {
              const lv = (d as { aiLiving?: AiLivingSave }).aiLiving;
              return !lv || getCyberHealth(lv, oc.characterId) > 0;
            })
            .map((oc, index) => ({
              id: oc.characterId,
              power: getCharacterPower(oc.characterId, oc.weaponId, d),
              index,
            }))
            .sort((a, b) => b.power - a.power || a.index - b.index)
            .map((entry) => entry.id);
          const forced = required.filter(
            (id) =>
              ranked.includes(id) ||
              d.ownedCharacters.some((o) => o.characterId === id),
          );
          const rest = ranked.filter((id) => !forced.includes(id));
          d.squad = [...forced, ...rest].slice(0, 3);
          this.syncHubFeatured(d);
          syncGuideProgress(d);
        });
        this.squadPickId = null;
        this.render();
      });

    this.uiRoot.querySelectorAll("[data-squad-slot]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (this.squadTouchDragClickGuard) {
          this.squadTouchDragClickGuard = false;
          return;
        }
        if ((e.target as HTMLElement).closest("[data-remove-squad]")) return;
        const slot = Number((el as HTMLElement).dataset.squadSlot);
        if (!Number.isFinite(slot)) return;
        const cid = (el as HTMLElement).dataset.squadChar;
        if (!this.squadPickId && cid) {
          this.squadPickId = cid;
          this.render();
          return;
        }
        if (this.squadPickId)
          this.applySquadSlotChar(
            slot,
            this.squadPickId,
            this.save().squad.includes(this.squadPickId),
          );
      });
    });

    this.uiRoot.querySelectorAll("[data-squad-drag]").forEach((el) => {
      el.addEventListener("dragstart", (e) => {
        const cid = (el as HTMLElement).dataset.squadDrag!;
        const de = e as DragEvent;
        de.dataTransfer?.setData("text/squad-char", cid);
        de.dataTransfer?.setData("text/plain", cid);
        if (de.dataTransfer) de.dataTransfer.effectAllowed = "move";
        (el as HTMLElement).classList.add("is-dragging");
      });
      el.addEventListener("dragend", () => {
        (el as HTMLElement).classList.remove("is-dragging");
        this.uiRoot
          .querySelectorAll(".slot.is-drag-over")
          .forEach((s) => s.classList.remove("is-drag-over"));
      });
    });

    this.uiRoot.querySelectorAll("[data-squad-slot-drag]").forEach((el) => {
      el.addEventListener("dragstart", (e) => {
        const cid = (el as HTMLElement).dataset.squadSlotDrag ?? "";
        if (!cid) return;
        const de = e as DragEvent;
        de.dataTransfer?.setData("text/squad-char", cid);
        de.dataTransfer?.setData("text/squad-source", "slot");
        if (de.dataTransfer) de.dataTransfer.effectAllowed = "move";
        (el as HTMLElement).classList.add("is-dragging");
      });
      el.addEventListener("dragend", () =>
        (el as HTMLElement).classList.remove("is-dragging"),
      );
    });

    this.uiRoot.querySelectorAll("[data-squad-drop]").forEach((el) => {
      el.addEventListener("dragover", (e) => {
        e.preventDefault();
        const de = e as DragEvent;
        if (de.dataTransfer) de.dataTransfer.dropEffect = "move";
        (el as HTMLElement).classList.add("is-drag-over");
      });
      el.addEventListener("dragleave", () => {
        (el as HTMLElement).classList.remove("is-drag-over");
      });
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        (el as HTMLElement).classList.remove("is-drag-over");
        const de = e as DragEvent;
        const cid =
          de.dataTransfer?.getData("text/squad-char") ||
          de.dataTransfer?.getData("text/plain") ||
          "";
        const source = de.dataTransfer?.getData("text/squad-source") || "bench";
        const slot = Number((el as HTMLElement).dataset.squadSlot);
        if (!cid || !Number.isFinite(slot)) return;
        this.applySquadSlotChar(slot, cid, source === "slot");
      });
    });

    this.uiRoot
      .querySelector("[data-squad-bench-drop]")
      ?.addEventListener("dragover", (e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).classList.add("is-drag-over");
      });
    this.uiRoot
      .querySelector("[data-squad-bench-drop]")
      ?.addEventListener("dragleave", (e) => {
        (e.currentTarget as HTMLElement).classList.remove("is-drag-over");
      });
    this.uiRoot
      .querySelector("[data-squad-bench-drop]")
      ?.addEventListener("drop", (e) => {
        e.preventDefault();
        const zone = e.currentTarget as HTMLElement;
        zone.classList.remove("is-drag-over");
        const cid =
          (e as DragEvent).dataTransfer?.getData("text/squad-char") ?? "";
        const source =
          (e as DragEvent).dataTransfer?.getData("text/squad-source") ?? "";
        if (!cid || source !== "slot") return;
        saveManager.mutate((d) => {
          d.squad = d.squad.filter((id) => id !== cid);
          this.syncHubFeatured(d);
        });
        this.render();
      });

    // HTML5 drag events are unavailable or inconsistent in mobile WebViews.
    // Pointer Events provide the same drag/drop flow for a finger or stylus.
    // 滚动与拖拽共存：卡片 touch-action: pan-y，纵向短划交给浏览器滚动；
    // 长按 ≥220ms 才激活拖拽，激活后用非被动 touchmove preventDefault 压住滚动。
    let touchDrag: {
      cid: string;
      source: "slot" | "bench";
      startX: number;
      startY: number;
      active: boolean;
      origin: HTMLElement;
      holdTimer: number;
      touchBlock: ((e: TouchEvent) => void) | null;
    } | null = null;
    let touchTarget: HTMLElement | null = null;
    const blockPageScroll = (e: TouchEvent) => {
      e.preventDefault();
    };
    const clearTouchDrag = () => {
      if (touchDrag) {
        window.clearTimeout(touchDrag.holdTimer);
        if (touchDrag.touchBlock)
          document.removeEventListener("touchmove", touchDrag.touchBlock);
        touchDrag.origin.classList.remove("is-dragging");
      }
      touchTarget?.classList.remove("is-drag-over");
      touchDrag = null;
      touchTarget = null;
      document.removeEventListener("pointermove", onTouchMove);
      document.removeEventListener("pointerup", onTouchEnd);
      document.removeEventListener("pointercancel", onTouchEnd);
    };
    const armTouchDrag = (drag: NonNullable<typeof touchDrag>) => {
      if (drag.active) return;
      drag.active = true;
      drag.origin.classList.add("is-dragging");
      // 长按期间无滚动发生，此时 touchmove 仍可取消：拦住后续默认滚动，拖拽幽灵才能跟手
      document.addEventListener("touchmove", blockPageScroll, {
        passive: false,
      });
      drag.touchBlock = blockPageScroll;
    };
    const onTouchMove = (event: PointerEvent) => {
      if (!touchDrag || event.pointerType === "mouse") return;
      if (!touchDrag.active) {
        // 长按成立前手指已位移 → 这是滚动手势：放弃拖拽，绝不拦截默认滚动
        const distance = Math.hypot(
          event.clientX - touchDrag.startX,
          event.clientY - touchDrag.startY,
        );
        if (distance >= 8) {
          clearTouchDrag();
        }
        return;
      }
      event.preventDefault();
      const hit = document.elementFromPoint(
        event.clientX,
        event.clientY,
      ) as HTMLElement | null;
      const nextTarget = hit?.closest(
        "[data-squad-drop], [data-squad-bench-drop]",
      ) as HTMLElement | null;
      if (touchTarget !== nextTarget) {
        touchTarget?.classList.remove("is-drag-over");
        touchTarget = nextTarget;
        touchTarget?.classList.add("is-drag-over");
      }
    };
    const onTouchEnd = (event: PointerEvent) => {
      if (!touchDrag || event.pointerType === "mouse") return;
      const drag = touchDrag;
      const target = touchTarget;
      if (drag.active) {
        this.squadTouchDragClickGuard = true;
        window.setTimeout(() => {
          this.squadTouchDragClickGuard = false;
        }, 120);
        if (target?.matches("[data-squad-drop]")) {
          const slot = Number(target.dataset.squadSlot);
          if (Number.isFinite(slot))
            this.applySquadSlotChar(slot, drag.cid, drag.source === "slot");
        } else if (
          target?.matches("[data-squad-bench-drop]") &&
          drag.source === "slot"
        ) {
          saveManager.mutate((d) => {
            d.squad = d.squad.filter((id) => id !== drag.cid);
            this.syncHubFeatured(d);
          });
          this.render();
        }
      }
      clearTouchDrag();
    };
    const bindTouchDrag = (
      el: Element,
      cid: string,
      source: "slot" | "bench",
    ) => {
      el.addEventListener("pointerdown", (event) => {
        const pointer = event as PointerEvent;
        if (pointer.pointerType === "mouse") return;
        if ((event.target as HTMLElement).closest("[data-remove-squad]"))
          return;
        const drag = {
          cid,
          source,
          startX: pointer.clientX,
          startY: pointer.clientY,
          active: false,
          origin: el as HTMLElement,
          holdTimer: 0,
          touchBlock: null as ((e: TouchEvent) => void) | null,
        };
        touchDrag = drag;
        drag.holdTimer = window.setTimeout(() => armTouchDrag(drag), 220);
        document.addEventListener("pointermove", onTouchMove, {
          passive: false,
        });
        document.addEventListener("pointerup", onTouchEnd);
        document.addEventListener("pointercancel", onTouchEnd);
      });
    };
    this.uiRoot
      .querySelectorAll("[data-squad-drag]")
      .forEach((el) =>
        bindTouchDrag(el, (el as HTMLElement).dataset.squadDrag!, "bench"),
      );
    this.uiRoot.querySelectorAll("[data-squad-slot-drag]").forEach((el) => {
      const cid = (el as HTMLElement).dataset.squadSlotDrag;
      if (cid) bindTouchDrag(el, cid, "slot");
    });

    this.uiRoot.querySelectorAll("[data-remove-squad]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const cid = (el as HTMLElement).dataset.removeSquad!;
        saveManager.mutate((d) => {
          d.squad = d.squad.filter((id) => id !== cid);
          this.syncHubFeatured(d);
          syncGuideProgress(d);
        });
        if (this.squadPickId === cid) this.squadPickId = null;
        this.render();
      });
    });

    this.uiRoot.querySelectorAll("[data-equip-btn]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const cid = (el as HTMLElement).dataset.equipBtn!;
        this.equipMenuFor = this.equipMenuFor === cid ? null : cid;
        this.render();
        // 展开后滚到菜单处，避免被底部遮挡
        this.uiRoot
          .querySelector(`[data-equip-menu="${cid}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    });

    this.uiRoot.querySelectorAll("[data-equip-pick]").forEach((el) => {
      el.addEventListener("click", () => {
        const [char, wid] = (el as HTMLElement).dataset.equipPick!.split("|");
        this.equipMenuFor = null;
        saveManager.mutate((d) => {
          if (wid) {
            const result = equipWeapon(d, char!, wid);
            if (!result.ok) this.lastRollMsg = result.msg;
          } else {
            const oc = d.ownedCharacters.find((c) => c.characterId === char);
            if (oc) oc.weaponId = null;
          }
          updateLegendaryStat(d);
          syncGuideProgress(d);
        });
        this.render();
      });
    });

    this.uiRoot
      .querySelector("[data-close-reward]")
      ?.addEventListener("click", () => {
        this.rewardPopup = null;
        this.render();
      });
    this.uiRoot
      .querySelector("[data-reward-overlay]")
      ?.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).dataset.rewardOverlay) {
          this.rewardPopup = null;
          this.render();
        }
      });

    bindLivePortraits(this.uiRoot, this.portraitSide);
    if (this.view === "hub") this.bindHubMedia();
    if (this.view === "camp") this.bindCampHubMedia();
    if (this.view === "shop") preloadShopChestVideo();
    this.syncLifePathDirector();
  }

  /** 营地页：生活路径（25s 批量）+ rAF 位移；离开营地即停 */
  private campMotionRaf = 0;

  private syncLifePathDirector(): void {
    if (this.view === "camp" && !this.inCombat) {
      this.startCampMotionLoop();
      startLifePathDirector({
        getOwnedIds: () =>
          this.save().ownedCharacters.map((o) => o.characterId),
        getLiving: () => getAiLiving(),
        onTick: () => this.refreshCampLifePathUi(false),
      });
    } else {
      stopLifePathDirector();
      this.stopCampMotionLoop();
    }
  }

  private startCampMotionLoop(): void {
    if (this.campMotionRaf) return;
    const frame = () => {
      // 对话打开时冻结走动，避免「状态已到泳池、立绘还在卧室走」
      if (!document.querySelector("[data-ai-dialogue]")) {
        tickCampAgents();
        this.refreshCampLifePathUi(true);
      }
      this.campMotionRaf = requestAnimationFrame(frame);
    };
    this.campMotionRaf = requestAnimationFrame(frame);
  }

  private stopCampMotionLoop(): void {
    if (this.campMotionRaf) {
      cancelAnimationFrame(this.campMotionRaf);
      this.campMotionRaf = 0;
    }
  }

  private lastPinRefreshAt = 0;

  /** 生活路径 / 运动帧刷新平面图落点 */
  private refreshCampLifePathUi(fromMotionFrame: boolean): void {
    if (this.view !== "camp" || this.inCombat) return;
    if (fromMotionFrame) {
      const now = performance.now();
      if (now - this.lastPinRefreshAt < 80) return;
      this.lastPinRefreshAt = now;
    } else {
      tickWorldOnly();
      this.syncBgm();
    }

    const s = this.save();
    const living = getAiLiving();
    const owned = s.ownedCharacters.map((o) => o.characterId);
    const focusId =
      this.campFocusCharId && owned.includes(this.campFocusCharId)
        ? this.campFocusCharId
        : null;

    refreshCampFloorMapPins(
      this.uiRoot,
      living,
      owned,
      this.campFloor,
      focusId,
      !fromMotionFrame,
    );
    if (!fromMotionFrame) this.bindCampPinClicks();

    const chip = this.uiRoot.querySelector("[data-hub-clock]");
    if (chip) chip.textContent = formatGameClock(living);
    const loc = this.uiRoot.querySelector("[data-camp-loc]");
    if (loc) {
      loc.textContent = `${this.campFloor}楼 · 在营 ${owned.length} 人`;
    }

    const bannerHost = this.uiRoot.querySelector("[data-camp-event-banner]");
    if (bannerHost) {
      const html = this.renderCampEventBannerHtml(living);
      const tmp = document.createElement("div");
      tmp.innerHTML = html.trim();
      const next = tmp.firstElementChild;
      if (next) bannerHost.replaceWith(next);
    }
  }

  private bindCampPinClicks(): void {
    this.uiRoot.querySelectorAll("[data-camp-pin]").forEach((el) => {
      const node = el as HTMLElement;
      if (node.dataset.boundPin === "1") return;
      node.dataset.boundPin = "1";
      node.addEventListener("click", () => {
        const id = node.dataset.campPin;
        if (!id) return;
        if (!this.save().ownedCharacters.some((o) => o.characterId === id))
          return;
        this.campFocusCharId = id;
        const living = getAiLiving();
        const focus = resolveFocusSceneForCharacter(id, living);
        setPlayerLocation(focus.sceneId);
        if (this.save().squad.includes(id)) {
          saveManager.mutate((d) => {
            d.settings.hubFeaturedCharId = id;
          });
        }
        this.campFloor = (
          focus.roomId.startsWith("room_2f")
            ? 2
            : focus.roomId.startsWith("room_b1")
              ? -1
              : 1
        ) as CampFloor;
        // 点头像 → 角色+场景沉浸对话
        showAiDialogue(id, { fromCamp: true, onClose: () => this.render() });
      });
    });
  }

  private bindHubMedia(): void {
    mountHubBackground(this.uiRoot.querySelector("[data-hub-bg-slot]"));
    bindHubPortraitStages(this.uiRoot);
    this.bindHubAiMsgDock();
    // 进入主页立刻尝试一次（有冷却，不会连发）
    void this.tickHubPlayerOutreach();
  }

  private kindLabel(kind: AiMessageEvent["kind"]): string {
    switch (kind) {
      case "ask_help":
        return "求助";
      case "share":
        return "分享";
      case "invite":
        return "邀请";
      case "vent":
        return "倾诉";
      case "report":
        return "汇报";
      default:
        return "闲聊";
    }
  }

  private renderHubAiMsgDockHtml(): string {
    let msgs: AiMessageEvent[] = [];
    try {
      msgs = peekPendingAiMessages();
    } catch {
      msgs = [];
    }
    if (!msgs.length)
      return `<div class="hub-ai-msg-dock" data-hub-ai-msg-dock></div>`;
    const cards = msgs
      .map((m) => {
        const name = CHARACTER_MAP[m.characterId]?.name ?? m.characterId;
        const remainSec = Math.max(
          0,
          Math.ceil((m.expiresAt - Date.now()) / 1000),
        );
        return `<div class="hub-ai-msg-card" data-hub-ai-msg="${m.messageId}" role="button" tabindex="0">
          <div class="hub-ai-msg-name">${name} · ${this.kindLabel(m.kind)}</div>
          <div class="hub-ai-msg-preview">${m.preview.replace(/</g, "&lt;")}</div>
          <div class="hub-ai-msg-meta"><span>分量 ${m.significance}</span><span>${remainSec}s</span></div>
          <button type="button" class="hub-ai-msg-dismiss" data-hub-ai-msg-dismiss="${m.messageId}">忽略</button>
        </div>`;
      })
      .join("");
    return `<div class="hub-ai-msg-dock" data-hub-ai-msg-dock>${cards}</div>`;
  }

  private canShowAiMsgDock(): boolean {
    return !this.inCombat && this.view === "camp";
  }

  /**
   * 离线/近日营地摘要：启动时已写入 pending，
   * 仅在本次打开游戏后第一次进入营地时弹窗一次。
   */
  private async maybeShowOfflineCampBanner(): Promise<void> {
    if (this.offlineCampBannerStarted || this.inCombat || this.view !== "camp")
      return;
    this.offlineCampBannerStarted = true;
    try {
      await ensureAiLivingBooted();
      if (this.view !== "camp" || this.inCombat) {
        // 等摘要时已离开营地：保留 pending，下次再进营地再试
        this.offlineCampBannerStarted = false;
        return;
      }
      const text = takeOfflineBanner();
      if (!text) return;
      await showAlert("营地近况", text, "知道了");
    } catch {
      this.offlineCampBannerStarted = false;
    }
  }

  private refreshHubAiMsgDock(): void {
    if (!this.canShowAiMsgDock()) return;
    const host = this.uiRoot.querySelector("[data-hub-ai-msg-dock]");
    if (!host) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = this.renderHubAiMsgDockHtml().trim();
    const next = wrap.firstElementChild;
    if (next) {
      host.replaceWith(next);
      this.bindHubAiMsgDock();
    }
  }

  private bindHubAiMsgDock(): void {
    this.uiRoot
      .querySelectorAll<HTMLElement>("[data-hub-ai-msg]")
      .forEach((card) => {
        if (card.dataset.boundAiMsg === "1") return;
        card.dataset.boundAiMsg = "1";
        card.addEventListener("click", (e) => {
          const t = e.target as HTMLElement | null;
          if (t?.closest("[data-hub-ai-msg-dismiss]")) return;
          const id = card.dataset.hubAiMsg;
          if (!id) return;
          this.openAiMessage(id);
        });
      });
    this.uiRoot
      .querySelectorAll<HTMLElement>("[data-hub-ai-msg-dismiss]")
      .forEach((btn) => {
        if (btn.dataset.boundAiDismiss === "1") return;
        btn.dataset.boundAiDismiss = "1";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.dataset.hubAiMsgDismiss;
          if (!id) return;
          playUiSound("cancel");
          dismissPendingAiMessage(id);
          this.refreshHubAiMsgDock();
        });
      });
  }

  private openAiMessage(messageId: string): void {
    const accepted = acceptPendingAiMessage(messageId);
    if (!accepted) {
      this.refreshHubAiMsgDock();
      return;
    }
    playUiSound("tap");
    // 点开后切换看板娘到该角色（若已拥有）
    if (
      this.save().ownedCharacters.some(
        (o) => o.characterId === accepted.characterId,
      )
    ) {
      saveManager.mutate((d) => {
        if (d.squad.includes(accepted.characterId)) {
          d.settings.hubFeaturedCharId = accepted.characterId;
        }
      });
    }
    this.refreshHubAiMsgDock();
    showAiDialogue(accepted.characterId, {
      fromCamp: true,
      fromOutreach: true,
      outreachPreview: accepted.preview,
      onClose: () => this.render(),
    });
  }

  private async tickHubPlayerOutreach(): Promise<void> {
    // 主动消息弹窗仅营地页；主城不轮询、不展示
    if (!this.canShowAiMsgDock()) return;
    const s = this.save();
    if (!s.ownedCharacters.length) return;
    // 对话 overlay 打开时不抢戏
    if (document.querySelector("[data-ai-dialogue]")) return;
    try {
      await runPlayerOutreachOnce();
      this.refreshHubAiMsgDock();
    } catch {
      /* ignore */
    }
  }

  private bindCampHubMedia(): void {
    mountHubBackground(this.uiRoot.querySelector("[data-hub-bg-slot]"));
    this.bindCampPinClicks();
    bindCampFloorMapPan(this.uiRoot);
    this.bindHubAiMsgDock();
    void this.tickHubPlayerOutreach();
    void this.maybeShowOfflineCampBanner();

    this.uiRoot.querySelectorAll("[data-camp-floor]").forEach((el) => {
      el.addEventListener("click", () => {
        const f = Number((el as HTMLElement).dataset.campFloor) as CampFloor;
        if (f === 1 || f === 2 || f === -1) {
          this.campFloor = f;
          this.render();
        }
      });
    });

    this.uiRoot
      .querySelector("[data-camp-living]")
      ?.addEventListener("click", () => {
        showCampLivingPanel({
          onChanged: () => {
            this.render();
          },
        });
      });

    this.uiRoot
      .querySelector("[data-camp-warehouse]")
      ?.addEventListener("click", () => {
        playUiSound("tap");
        showCampWarehousePanel({
          initialMode: "warehouse",
          onChanged: () => this.render(),
        });
      });

    this.uiRoot
      .querySelector("[data-camp-shop]")
      ?.addEventListener("click", () => {
        playUiSound("tap");
        showCampWarehousePanel({
          initialMode: "shop",
          onChanged: () => this.render(),
        });
      });

    this.uiRoot
      .querySelector("[data-camp-armory]")
      ?.addEventListener("click", () => {
        playUiSound("tap");
        this.view = "weapons";
        this.render();
      });
  }

  /** 保证看板娘指向上场编队内角色（或清空） */
  private syncHubFeatured(d: SaveData): void {
    d.settings.hubFeaturedCharId = resolveHubFeaturedCharId(
      d.squad,
      d.settings.hubFeaturedCharId,
    );
  }

  /** 将机体放入/替换指定出战槽（拖拽或点选） */
  private applySquadSlotChar(
    slotIndex: number,
    charId: string,
    fromSlot = false,
  ): void {
    if (slotIndex < 0 || slotIndex > 2) return;
    const living = (this.save() as { aiLiving?: AiLivingSave }).aiLiving;
    if (living && getCyberHealth(living, charId) <= 0) {
      void showAlert(
        "无法上阵",
        `${CHARACTER_MAP[charId]?.name ?? charId}义体健康为 0（重伤），请先在营地修复后再上阵。`,
      );
      return;
    }
    saveManager.mutate((d) => {
      if (!d.ownedCharacters.some((o) => o.characterId === charId)) return;
      const sourceIndex = d.squad.indexOf(charId);
      if (fromSlot && sourceIndex >= 0) {
        if (sourceIndex === slotIndex) return;
        if (slotIndex < d.squad.length) {
          [d.squad[sourceIndex], d.squad[slotIndex]] = [
            d.squad[slotIndex],
            d.squad[sourceIndex],
          ];
        } else {
          d.squad.splice(sourceIndex, 1);
          d.squad.push(charId);
        }
        this.syncHubFeatured(d);
        syncGuideProgress(d);
        return;
      }
      if (sourceIndex >= 0) return;

      if (slotIndex < d.squad.length) {
        d.squad[slotIndex] = charId;
      } else if (d.squad.length < 3) {
        d.squad.push(charId);
      } else {
        return;
      }
      this.syncHubFeatured(d);
      syncGuideProgress(d);
    });
    this.squadPickId = null;
    this.render();
  }

  private cycleHubFeatured(dir: -1 | 1): void {
    // 交互动画播放 / 过渡 / 按住选片期间禁止切人
    if (isHubPortraitInteractionLocked(this.uiRoot)) return;
    saveManager.mutate((d) => {
      if (d.squad.length < 2) return;
      const current = resolveHubFeaturedCharId(
        d.squad,
        d.settings.hubFeaturedCharId,
      );
      if (!current) return;
      const idx = d.squad.indexOf(current);
      const next = d.squad[(idx + dir + d.squad.length) % d.squad.length];
      d.settings.hubFeaturedCharId = next;
    });
    // 就地换看板娘，避免整页 render 清空 bg-slot 露出纯色底
    if (this.view === "hub" && this.refreshHubFeaturedInPlace()) return;
    this.render();
  }

  /** 主城切上场角色：优先原地换 video.src（保留上一帧/poster，避免叠影与黑闪） */
  private refreshHubFeaturedInPlace(): boolean {
    const s = this.save();
    const feat = hubFeaturedCharDisplay(s.squad, s.settings.hubFeaturedCharId);
    if (!feat) return false;
    const zone = this.uiRoot.querySelector<HTMLElement>(".hub-char-zone");
    if (!zone) return false;

    const hubOpts = { skinChannel: "player" as const };
    const liveSrc = getLivePortraitSrc(feat.id, hubOpts);
    const stage = zone.querySelector<HTMLElement>("[data-hub-portrait]");
    const primary = stage?.querySelector<HTMLVideoElement>(
      '[data-role="primary"]',
    );
    const canInPlace =
      !!stage &&
      !!primary &&
      !!liveSrc &&
      canPlayLivePortrait(liveSrc) &&
      this.shouldUseHubMainLivePortrait(feat.id);

    if (canInPlace && stage && primary) {
      resetHubPortraitStage(stage);
      zone
        .querySelectorAll("img.hub-char-portrait, .hub-static-portrait-hit")
        .forEach((el) => el.remove());

      const secondaries = getLivePortraitSecondarySrcs(feat.id, hubOpts);
      const absLive = texUrl(liveSrc!);
      stage.dataset.charId = feat.id;
      primary.dataset.charId = feat.id;
      armSilentPortraitVideo(primary);
      applyLivePortraitPoster(primary, feat.id, hubOpts);
      primary.pause();
      primary.classList.remove("is-hidden", "is-exiting", "is-entering");
      primary.src = absLive;
      primary.load();
      void primary.play().catch(() => {});

      const secondary = stage.querySelector<HTMLVideoElement>(
        '[data-role="secondary"]',
      );
      syncHubPortraitPicker(stage, secondaries);
      if (secondaries.length) {
        if (!secondary) {
          const vid = document.createElement("video");
          vid.className = primary.className;
          vid.dataset.role = "secondary";
          vid.dataset.skinSrc = secondaries[0]!;
          vid.src = texUrl(secondaries[0]!);
          vid.hidden = true;
          vid.muted = true;
          vid.setAttribute("playsinline", "");
          vid.setAttribute("webkit-playsinline", "");
          vid.setAttribute("disablepictureinpicture", "");
          vid.setAttribute(
            "controlslist",
            "nodownload nofullscreen noremoteplayback",
          );
          vid.preload = "metadata";
          armSilentPortraitVideo(vid);
          stage.insertBefore(vid, stage.querySelector("[data-live-picker]"));
        } else {
          secondary.dataset.skinSrc = secondaries[0]!;
          armSilentPortraitVideo(secondary);
          secondary.src = texUrl(secondaries[0]!);
          applyLivePortraitPoster(secondary, feat.id, hubOpts);
          secondary.setAttribute("hidden", "");
          secondary.load();
        }
      } else {
        secondary?.setAttribute("hidden", "");
      }
      ensureHubHoldPicker(stage);

      const avatar = this.uiRoot.querySelector(".wl-avatar");
      if (avatar) {
        const frame = avatar.querySelector(".wl-avatar-frame");
        const frameHtml = frame ? frame.outerHTML : "";
        avatar.innerHTML = `${this.renderHubAvatar(feat.id)}${frameHtml}`;
      }
      const nameEl = this.uiRoot.querySelector(".wl-name");
      if (nameEl) nameEl.textContent = feat.name;
      return true;
    }

    // 无动态立绘或结构不匹配：重建立绘区（背景槽仍不碰）
    const canSwitch = s.squad.length > 1;
    zone.classList.toggle("is-swipeable", canSwitch);
    if (canSwitch) zone.setAttribute("data-hub-char-swipe", "");
    else zone.removeAttribute("data-hub-char-swipe");

    zone.innerHTML = `
      ${canSwitch ? `<button class="hub-char-arrow hub-char-arrow-prev" type="button" data-hub-feat-prev aria-label="上一个上场角色">‹</button>` : ""}
      ${this.renderHubPortrait(feat.id)}
      ${canSwitch ? `<button class="hub-char-arrow hub-char-arrow-next" type="button" data-hub-feat-next aria-label="下一个上场角色">›</button>` : ""}
    `;

    const avatar = this.uiRoot.querySelector(".wl-avatar");
    if (avatar) {
      const frame = avatar.querySelector(".wl-avatar-frame");
      const frameHtml = frame ? frame.outerHTML : "";
      avatar.innerHTML = `${this.renderHubAvatar(feat.id)}${frameHtml}`;
    }
    const nameEl = this.uiRoot.querySelector(".wl-name");
    if (nameEl) nameEl.textContent = feat.name;

    this.uiRoot
      .querySelector("[data-hub-feat-prev]")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cycleHubFeatured(-1);
      });
    this.uiRoot
      .querySelector("[data-hub-feat-next]")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cycleHubFeatured(1);
      });
    bindHubPortraitStages(zone);
    this.bindHubFeaturedSwipe();
    return true;
  }

  /** 主页立绘区左右滑动切换上场看板娘（与左右箭头一致） */
  private bindHubFeaturedSwipe(): void {
    this.hubSwipeAbort?.abort();
    this.hubSwipeAbort = new AbortController();
    const { signal } = this.hubSwipeAbort;

    const zone = this.uiRoot.querySelector<HTMLElement>(
      "[data-hub-char-swipe]",
    );
    if (!zone) return;

    const THRESH_X = 56;
    const RATIO = 1.2;
    let tracking = false;
    let swiped = false;
    let startX = 0;
    let startY = 0;
    let pointerId: number | null = null;

    const endTrack = () => {
      tracking = false;
      pointerId = null;
    };

    zone.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const t = e.target as HTMLElement | null;
        if (t?.closest("[data-hub-feat-prev],[data-hub-feat-next]")) return;
        tracking = true;
        swiped = false;
        startX = e.clientX;
        startY = e.clientY;
        pointerId = e.pointerId;
      },
      { passive: true, signal },
    );

    const onMove = (e: PointerEvent) => {
      if (!tracking || swiped) return;
      if (pointerId !== null && e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) < THRESH_X) return;
      if (Math.abs(dx) < Math.abs(dy) * RATIO) return;
      // 交互动画播放 / 过渡 / 按住选片时，禁止横向切人
      if (isHubPortraitInteractionLocked(zone)) return;
      swiped = true;
      zone.dataset.hubSwiped = "1";
      // 通知动态立绘舞台取消本次按住
      zone
        .querySelectorAll<HTMLElement>("[data-hub-portrait]")
        .forEach((stage) => {
          stage.dataset.swipeCancel = "1";
        });
      // 左滑 → 下一个；右滑 → 上一个
      this.cycleHubFeatured(dx < 0 ? 1 : -1);
      endTrack();
    };

    const onUp = (e: PointerEvent) => {
      if (pointerId !== null && e.pointerId !== pointerId) return;
      if (swiped) {
        const blockClick = (ev: Event) => {
          ev.preventDefault();
          ev.stopPropagation();
          zone.removeEventListener("click", blockClick, true);
        };
        zone.addEventListener("click", blockClick, true);
        window.setTimeout(
          () => zone.removeEventListener("click", blockClick, true),
          0,
        );
      }
      endTrack();
    };

    window.addEventListener("pointermove", onMove, { passive: true, signal });
    window.addEventListener("pointerup", onUp, { signal });
    window.addEventListener("pointercancel", onUp, { signal });
  }

  /** 背包角色碎片升级：边框闪光 + 战力数字放大闪光后跳变（≤0.75s） */
  private playBagCharUpgradeFx(): void {
    const fx = this.bagCharUpgradeFx;
    if (!fx) return;

    if (this.bagUpgradeFxTimer !== null) {
      window.clearTimeout(this.bagUpgradeFxTimer);
      this.bagUpgradeFxTimer = null;
    }

    const card = this.uiRoot.querySelector<HTMLElement>(
      `[data-bag-char-card="${fx.charId}"]`,
    );
    const powerEl = card?.querySelector<HTMLElement>("[data-bag-power]");
    if (!card || !powerEl) {
      this.bagCharUpgradeFx = null;
      return;
    }

    powerEl.textContent = String(fx.fromPower);
    card.classList.remove("is-upgrade-fx-pending");
    card.classList.add("is-upgrade-fx");
    powerEl.classList.remove("is-power-land");
    powerEl.classList.add("is-power-bump");

    window.setTimeout(
      () => {
        powerEl.textContent = String(fx.toPower);
        powerEl.classList.add("is-power-land");
      },
      Math.round(BAG_UPGRADE_FX_MS * 0.48),
    );

    this.bagUpgradeFxTimer = window.setTimeout(() => {
      card.classList.remove("is-upgrade-fx");
      powerEl.classList.remove("is-power-bump", "is-power-land");
      this.bagCharUpgradeFx = null;
      this.bagUpgradeFxTimer = null;
    }, BAG_UPGRADE_FX_MS);
  }

  private requestOpenBox(times: number, free = false): void {
    if (isShopChestCutsceneActive()) return;

    const d = saveManager.get();
    const charId = d.squad[0] ?? d.ownedCharacters[0]?.characterId;
    if (!charId) {
      this.lastRollMsg = "无可用角色";
      this.render();
      return;
    }

    if (!free) {
      const cost = getOpenCost(d, false);
      if (d.gold < cost * times) {
        this.lastRollMsg = "锈币不足";
        this.render();
        return;
      }
    }

    this.pendingBoxOpen = { times, free, charId };
    playShopChestCutscene({
      allowSkip: d.tutorialFlags.armoryVideoSeen,
      onComplete: () => this.completeOpenBox(),
    });
  }

  private completeOpenBox(): void {
    const pending = this.pendingBoxOpen;
    this.pendingBoxOpen = null;
    if (!pending) return;

    const lines: string[] = [];
    let opened = 0;

    saveManager.mutate((d) => {
      d.tutorialFlags.armoryVideoSeen = true;

      const guideStep = getGuideStep(d);
      const needGuidePity =
        Boolean(d.tutorialFlags.storyHubFollowSeen) &&
        !d.tutorialFlags.storyGuideDone &&
        !d.tutorialFlags.storyGuideArmoryOpened &&
        guideStep?.id === "g_shop";

      for (let i = 0; i < pending.times; i++) {
        if (!pending.free) {
          const cost = getOpenCost(d, false);
          if (d.gold < cost) break;
          d.gold -= cost;
        }
        if (needGuidePity && i === 0) {
          const pity = grantGuideArmoryPityWeapon(d);
          if (pity) {
            lines.push(`🔧 引导保底 · ${pity.name}`);
            opened++;
            continue;
          }
        }
        const weapon = rollWeapon(d.armoryLevel);
        const w = WEAPON_MAP[weapon.id];
        lines.push(
          `${w.icon} ${compareAndMaybeEquip(d, pending.charId, weapon)}`,
        );
        opened++;
        markGuideArmoryOpened(d);
      }
      updateLegendaryStat(d);
      syncGuideProgress(d);
      if (opened > 0 && d.aiLiving) {
        recordArmoryGameplay(d, d.aiLiving as AiLivingSave, {
          characterId: pending.charId,
          lines,
          kind: "box",
        });
      }
    });

    if (opened === 0) {
      this.lastRollMsg = "开箱失败";
      this.render();
      return;
    }

    this.rewardPopup = {
      title: opened > 1 ? `军械箱开启 ×${opened}` : "军械箱开启",
      lines,
    };
    this.render();
  }

  private buyPack(type: "normal" | "advanced" | "legendary"): void {
    saveManager.mutate((d) => {
      const price = PACK_PRICES[type];
      if (d.gold < price) {
        this.lastRollMsg = "锈币不足";
        return;
      }
      d.gold -= price;
      const char = d.squad[0] ?? d.ownedCharacters[0]?.characterId;
      const weapon = rollPack(type);
      this.lastRollMsg = compareAndMaybeEquip(d, char!, weapon);
      updateLegendaryStat(d);
      if (char && d.aiLiving) {
        recordArmoryGameplay(d, d.aiLiving as AiLivingSave, {
          characterId: char,
          lines: [this.lastRollMsg],
          kind: "pack",
        });
      }
    });
    this.render();
  }

  private sweep(): void {
    const stage = STAGE_MAP[this.selectedStage];
    let lines: string[] = [];
    saveManager.mutate((d) => {
      const used = consumeSweepCharge(d);
      if (!used.ok) {
        this.lastRollMsg = used.msg;
        return;
      }
      d.gold += stage.sweepGold;
      const sweep = getSweepStatus(d);
      lines = [
        `关卡：${stage.name}`,
        `🪙 锈币 +${stage.sweepGold}`,
        `扫荡次数剩余 ${sweep.current}/${sweep.max}`,
        `当前锈币：${d.gold}`,
      ];
    });
    if (this.lastRollMsg) {
      this.render();
      return;
    }
    this.rewardPopup = {
      title: "扫荡完成",
      lines,
    };
    this.render();
  }

  private async startFight(): Promise<void> {
    const s = this.save();
    const stage = STAGE_MAP[this.selectedStage];
    const tcp = getTeamTcp(s, this.selectedStage);
    const cleared = s.clearedStages.includes(this.selectedStage);

    const slots = squadSlotsForStage(this.selectedStage, s);
    const squadIds = s.squad.slice(0, slots);
    if (!squadIds.length) {
      void showAlert("无法出战", "请先编队，至少选择一名角色加入小队。").then(
        () => {
          this.view = "squad";
          this.render();
        },
      );
      return;
    }

    const guideDeploy = checkGuideDeploy(this.save(), stage.id, squadIds);
    if (!guideDeploy.ok) {
      void showAlert("教学编队不对", guideDeploy.message).then(() => {
        this.view = "squad";
        this.render();
      });
      return;
    }

    // Phase D：出征前换回默认甲（无 aiLiving 也清皮肤）
    saveManager.mutate((d) => {
      prepareSquadDefaultArmor(
        d,
        (d.aiLiving as AiLivingSave | undefined) ?? null,
        squadIds,
      );
    });

    // 义体健康预校验：义体 ≤ 0 的角色不能上战场（与 Combat3D.checkSquadHealthFail 一致）。
    // 否则进入战斗后会被敌人撞一下就瞬间判负，0/0 通过也直接失败。
    const living = (this.save() as { aiLiving?: AiLivingSave }).aiLiving;
    if (living) {
      const dead: string[] = [];
      for (const id of squadIds) {
        const hp = getCyberHealth(living, id);
        if (hp <= 0) dead.push(CHARACTER_MAP[id]?.name ?? id);
      }
      if (dead.length) {
        void showAlert(
          "义体失效，无法出战",
          `以下角色义体已彻底损毁，必须先恢复才能上战场：\n\n${dead.join("、")}\n\n恢复方式：① 在营地生活让角色自主休息恢复；② 前往军械库为角色购置新义体。`,
        );
        return;
      }
    }

    if (!cleared && !canManualWin(tcp, stage.recommendedTcp, stage.isBoss)) {
      void showAlert(
        "战力不足",
        "当前小队 TCP 低于推荐值，请升级武器或抽卡后再挑战。",
      );
      return;
    }

    const guideMax = getGuideMaxFightStageId(this.save());
    if (guideMax != null && stage.mode === "normal" && stage.id > guideMax) {
      void showAlert(
        "先跟着教学走",
        `商店老板娘还在带你。请先完成第 ${guideMax} 关相关步骤，再挑战更后面的关卡。`,
      );
      return;
    }

    // 开战前剧情（仅普通模式首次）——背景用章节远景，不透出关卡 UI
    const beat = getStageStoryBeat(this.save(), stage);
    if (beat) {
      const theme = getCombatTheme(stage.chapter);
      const backdropUrl = pickCombatBackdropUrl(theme.id, stage.id);
      const result = await playStoryBeat(beat, { backdropUrl });
      saveManager.mutate((d) => {
        markStoryBeatSeen(d, beat.id);
        for (const [k, v] of Object.entries(result.choices)) {
          recordStoryChoice(d, `${beat.id}:${k}`, v);
        }
      });
    }

    this.inCombat = true;
    stopLifePathDirector();
    this.stopCampMotionLoop();
    this.syncBgm();
    this.uiRoot.classList.add("hidden");
    this.gameRoot.classList.add("visible");

    const headCalibrate =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("debugHeadCal");

    startCombat(this.gameRoot, {
      stage,
      tcp,
      squadIds,
      squadDamage: getSquadShotDamageMap(s, squadIds),
      autoMode: false,
      stageWasCleared: s.clearedStages.includes(stage.id),
      headCalibrate,
      showSkillGuide: stage.id === 1 && !s.tutorialFlags.combatSkillGuideSeen,
      onSkillGuideDone: () =>
        saveManager.mutate((d) => {
          d.tutorialFlags.combatSkillGuideSeen = true;
        }),
      showBossGuide: stage.isBoss && !s.tutorialFlags.combatBossGuideSeen,
      onBossGuideDone: () =>
        saveManager.mutate((d) => {
          d.tutorialFlags.combatBossGuideSeen = true;
        }),
      onComplete: (result) =>
        this.onCombatDone(result.victory, result.kills, stage, result.aborted),
    });
  }

  private async onCombatDone(
    victory: boolean,
    kills: number,
    stage: (typeof STAGE_MAP)[number],
    aborted = false,
  ): Promise<void> {
    this.inCombat = false;
    this.gameRoot.classList.remove("visible");
    this.uiRoot.classList.remove("hidden");
    this.syncBgm();

    if (aborted) {
      this.view = "map";
      this.render();
      return;
    }

    if (victory) {
      saveManager.mutate((d) => {
        if (!d.clearedStages.includes(stage.id)) {
          d.clearedStages.push(stage.id);
          d.gold += stage.firstClearGold;
          for (const bonus of STARTER.bonusTickets) {
            if (bonus.stage === stage.id) d.tickets += bonus.amount;
          }
        }
        d.stats.totalKills += kills;
        updateLegendaryStat(d);
        syncGuideProgress(d);
      });
    } else {
      saveManager.mutate((d) => {
        d.stats.totalKills += kills;
      });
    }

    recordCombatReturn(
      victory,
      {
        id: stage.id,
        name: stage.name,
        chapter: stage.chapter,
      },
      { kills },
    );
    this.render();
  }
}
