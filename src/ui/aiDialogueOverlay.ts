/**
 * 沉浸式对话：单人 / 多人事件同屏
 * 同屏仅当角色处于活跃多人事件赴约组；偶然同房不开同屏
 */
import {
  enterAnfuBgm,
  enterDanceBgm,
  enterFestiveCampDialogueBgm,
  exitAnfuBgm,
  exitDanceBgm,
  exitFestiveCampDialogueBgm,
  notifyBgmStateChanged,
  shouldPlayFestiveCampDialogueBgm,
} from '../audio/bgm';
import { syncDisciplineOverlayMusic } from '../audio/disciplineOverlay';
import { getTravelStageKey } from '../ai/travel';

/** 语音故障提示去重（2 分钟一次） */
let lastVoiceWarnAt = 0;
import {
  setAnfuBreathDucked,
  stopAnfuBreathAudio,
  syncAnfuBreathAudio,
  unlockAnfuBreathAudio,
} from '../audio/anfuBreath';
import { playUiSound } from './uiSound';
import { CHARACTER_MAP } from '../data/characters';
import { CAMP_ROOM_MAP } from '../data/campLayout';
import { AI_BUBBLE_STYLE, AI_PARTICLE } from '../ai/assets';
import {
  acceptPendingDanceInviteNow,
  acceptPendingMiniGameInviteNow,
  getAiLiving,
  getAnfuClips,
  getDanceSoloClips,
  getOutfitChangeCountdownMs,
  leaveAnfuNow,
  observeAnfuStateForUi,
  observeBathStateForUi,
  observeDanceStateForUi,
  observeMiniGameStateForUi,
  openDialogueSession,
  peekAffinity,
  acceptPendingAnfuInviteNow,
  acceptPendingBathAssistInviteNow,
  enterAnfuNow,
  finishAnfuDressingNow,
  quitMiniGameNow,
  rejectPendingAnfuInviteNow,
  rejectPendingBathAssistInviteNow,
  rejectPendingDanceInviteNow,
  rejectPendingMiniGameInviteNow,
  releaseDialogueSceneSession,
  requestAnfuAttackNow,
  requestPlayerAnfu,
  requestPlayerBathAssist,
  requestPlayerDance,
  requestPlayerMiniGame,
  settleDueOutfitChangeNow,
  settleSleepOnDialogueClose,
  stopDanceNow,
  endDanceNow,
  finishDanceDressingNow,
  finishDanceUnveilNow,
  finishBathAssistPrepareNow,
  processTravelArrivalsNow,
  takeAnfuUiFlash,
  takeBathAssistUiFlash,
  takeDanceUiFlash,
  takeMiniGameUiFlash,
  talkToCharacter,
} from '../ai/livingService';
import { syncMiniGamePanel, unmountMiniGamePanel } from './miniGamePanel';
import { leaveAnfuSession as leaveAnfuSessionDirect, acceptAnfuInvite } from '../ai/anfuSession';
import { planProactiveSpeak } from '../ai/dialogueProactive';
import { proactiveContactBlockReason } from '../ai/sleepSystem';
import { warmupCharacterModel } from '../ai/providerConfig';
import {
  OUTFIT_REVEAL_MOTIVE,
  remainingOutfitChangeMs,
} from '../ai/outfitChangeProcess';
import type { DialogueCommittedPayload } from '../ai/dialogueEngine';
import type { LlmDialogueResult } from '../ai/types';
import { resolvePresence, resolveCharacterSceneImageId } from '../ai/livingState';
import {
  describeAffinity,
  describeRelation,
  getRelation,
  listRelationPairs,
} from '../ai/relationship';
import { resolvePeriod } from '../ai/worldClock';
import { getSceneCard, resolveSceneCardImage } from '../ai/sceneCards';
import { hasDialogueApiKey } from '../ai/llmRouter';
import { describeLlmFailure } from '../ai/llmClient';
import {
  capCoScreenMemberIds,
  describeCoScreenMembers,
  getCoScreenGroupForCharacter,
  syncCoScreenParticipantWorld,
  type CoScreenGroup,
} from '../ai/campEvents';
import { texUrl } from '../utils/texUrl';
import {
  applyDialogueEmotionPose,
  bindDialoguePortraitInteractions,
  buildDialoguePortraitStageHtml,
  findDialoguePortraitStage,
  playDialogueAnfuClip,
  playDialogueSkinClip,
  playDialogueDanceSoloLoop,
  refreshDialogueSkinLayer,
  setDialogueDisciplinePose,
  stopDialogueAnfuClip,
  stopDialogueDanceSoloLoop,
  dialogueSkinMatchesCharacter,
} from './dialoguePortraitStage';
import { armSilentPortraitVideo } from './livePortrait';
import {
  isSpeechInputSupported,
  onVoiceSpeakingChange,
  speakDialogue,
  stopSpeechInput,
  stopVoicePlayback,
  toggleSpeechInput,
  unlockAudioPlayback,
  clearDialogueVoiceSession,
  getVoiceExpressionMode,
  setVoiceExpressionMode,
} from '../ai/voice';
import {
  inferAsrEmotionHint,
  listeningEmotionHint,
} from '../ai/voice/asrEmotionHint';
import { applyMoodImpulse } from '../ai/moodContinuum';
import { saveManager } from '../core/SaveManager';
import { getCampProp } from '../data/campProps';
import {
  buildItemOfferPlayerMessage,
  offerItemFromWarehouse,
  releasePendingItemOffer,
} from '../systems/CampWarehouseSystem';
import { closeDialogueItemPicker, showDialogueItemPicker } from './dialogueItemPicker';
import { showDialogueItemOfferFx } from './dialogueItemOfferFx';
import {
  DISCIPLINE_BG_PATH,
  DISCIPLINE_ENTER_REACT_MOTIVE,
  DISCIPLINE_LEAVE_REACT_MOTIVE,
  acceptDisciplineInvite,
  applyDisciplineIdleReset,
  applyDisciplinePoseSwitch,
  detectDisciplineThreat,
  enterDisciplineSession,
  getDisciplinePoseCooldownRemainingMs,
  getDisciplineSession,
  isDisciplineActiveFor,
  isDisciplineEnabled,
  isDisciplinePoseUiLocked,
  leaveDisciplineSession,
  rejectDisciplineInvite,
  requestDisciplineSettleValence,
  settleActiveDisciplineSession,
  type DisciplineEntrySource,
} from '../ai/disciplineSession';
import { getDisciplinePoseCount, getDisciplinePoseNote } from '../ai/disciplinePoseNotes';
import { syncCharacterSkinRuntime } from './characterSkinRuntime';
import { ANFU_DONE_SKIN_ID, DISCIPLINE_SKIN_ID, getCharacterSkin } from '../data/characterSkins';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type AiDialogueOptions = {
  onClose?: () => void;
  /** 从营地页打开（欢乐事件 BGM 仅在此入口生效） */
  fromCamp?: boolean;
  /** 强制同屏成员（调试）；默认从活跃多人事件解析 */
  forceCoScreenIds?: string[];
  forceEventName?: string;
  /** 由主动消息点开：用于 chip 提示 */
  fromOutreach?: boolean;
  outreachPreview?: string;
  /** 打开后自动递交指定仓库道具（escrow） */
  initialOfferPropId?: string;
  /** 打开后弹出迷你仓库选择器 */
  openItemPicker?: boolean;
  /** 迷你仓库默认分类（gift/food/…） */
  itemPickerTab?: string;
};

function spawnParticles(root: HTMLElement, type: 'heart' | 'star' | 'sweat', count: number): void {
  const src = AI_PARTICLE[type];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('img');
    el.className = 'ai-particle';
    el.src = src;
    el.alt = '';
    el.style.left = `${40 + Math.random() * 40}%`;
    el.style.animationDelay = `${i * 0.08}s`;
    root.appendChild(el);
    window.setTimeout(() => el.remove(), 1200);
  }
}

/** 围圈布局：焦点靠前中央，其余环绕；随人数缩放 */
function layoutCoScreenSlots(
  count: number,
): { x: number; y: number; scale: number; z: number }[] {
  const scale =
    count <= 2 ? 1 : count <= 3 ? 0.88 : count <= 5 ? 0.72 : count <= 7 ? 0.58 : 0.46;
  const slots: { x: number; y: number; scale: number; z: number }[] = [];
  // index 0 = focus（调用方会把焦点放首位再映射）
  slots.push({ x: 50, y: 58, scale: scale * 1.12, z: 40 });
  const others = count - 1;
  if (others <= 0) return slots;
  const radiusX = count <= 3 ? 28 : count <= 5 ? 34 : 38;
  const radiusY = count <= 3 ? 16 : count <= 5 ? 20 : 24;
  for (let i = 0; i < others; i++) {
    // 上方半环 + 两侧，避免挡住底部对话框
    const t = others === 1 ? 0.5 : i / (others - 1 || 1);
    const angle = Math.PI * 0.15 + t * Math.PI * 0.7; // 约 27°~153°
    const x = 50 + Math.cos(angle) * radiusX;
    const y = 42 - Math.sin(angle) * radiusY * 0.35;
    slots.push({ x, y, scale: scale * 0.92, z: 10 + i });
  }
  return slots;
}

function playLiveVideos(root: ParentNode): void {
  root.querySelectorAll<HTMLVideoElement>('[data-ai-live-portrait]').forEach((v) => {
    armSilentPortraitVideo(v);
    void v.play().catch(() => {});
  });
}

/** 背景刷新序号：慢图 onload 晚到时不得用旧景覆盖新景（网络延迟乱序防护） */
let bgRefreshSeq = 0;

function resolveDialogueBackgroundSceneId(
  overlay: HTMLElement,
  characterId: string,
  living: ReturnType<typeof getAiLiving>,
): string {
  if (isDisciplineActiveFor(living, characterId)) return 'indoor_tiaojiaoshi';
  if (overlay.dataset.coScreen === 'true') {
    const co = getCoScreenGroupForCharacter(living, characterId);
    if (co?.focusRoomId) {
      const sid = CAMP_ROOM_MAP[co.focusRoomId]?.sceneId;
      if (sid) return sid;
    }
  }
  const presence = resolvePresence(characterId, living);
  return resolveCharacterSceneImageId(characterId, living) || presence.locationId;
}

function refreshCoScreenPortraitLayers(overlay: HTMLElement, memberIds: string[]): void {
  for (const id of memberIds) {
    const btn = overlay.querySelector<HTMLElement>(`[data-co-actor="${id}"]`);
    const stage =
      btn?.querySelector<HTMLElement>('[data-ai-portrait-stage]') ??
      findDialoguePortraitStage(overlay, id);
    if (stage) refreshDialogueSkinLayer(stage, id);
  }
  playLiveVideos(overlay);
}

/**
 * 开场/切人后：用最新 living 刷新背景、chip、状态图标、立绘皮肤。
 * 解决「状态已到泳池、背景睡衣还停在卧室」的错位。
 */
function refreshDialogueVisualContext(
  overlay: HTMLElement,
  characterId: string,
  opts?: {
    clock?: string;
    fromOutreach?: boolean;
    presenceLabel?: string;
    /** 对话打开后强制刷新立绘（睡眠/换装账本已变） */
    forcePortraitRefresh?: boolean;
  },
): void {
  const living = getAiLiving();
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const presence = resolvePresence(characterId, living);
  const inDiscipline = isDisciplineActiveFor(living, characterId);
  const sceneId = resolveDialogueBackgroundSceneId(overlay, characterId, living);
  const scene = getSceneCard(sceneId);
  const bgSrc = texUrl(
    inDiscipline
      ? DISCIPLINE_BG_PATH
      : scene
        ? resolveSceneCardImage(scene, resolvePeriod(living))
        : './tex/Indoor/shinei01_yilou_dating.png',
  );

  const bg = overlay.querySelector<HTMLImageElement>('.ai-immersive-bg');
  if (bg) {
    const abs = new URL(bgSrc, window.location.href).href;
    if (bg.src !== abs) {
      const mySeq = ++bgRefreshSeq;
      const probe = new Image();
      const applyIfCurrent = () => {
        if (mySeq === bgRefreshSeq) bg.src = bgSrc;
      };
      probe.onload = applyIfCurrent;
      probe.onerror = applyIfCurrent;
      probe.src = bgSrc;
    } else if (!bg.getAttribute('src')) {
      bg.src = bgSrc;
    }
  }

  const chip = overlay.querySelector<HTMLElement>('[data-ai-chip]');
  if (chip && !overlay.dataset.coScreen) {
    const label = opts?.presenceLabel || presence.label;
    const outreachBit = opts?.fromOutreach ? ' · 主动来信' : '';
    const discBit = '';
    // 角色聊天页面顶部 UI 不再显示时间（聊天页面沉浸感优先；时间在营地页/主页单独展示）
    chip.textContent = `${name} · ${label} · 好感 ${peekAffinity(characterId)}${discBit}${outreachBit}`;
  }

  const stage = findDialoguePortraitStage(overlay, characterId);
  if (stage) {
    // 同皮勿整层重建：每轮对话重 load 透明 webm 会导致立绘卡没 + 主线程卡顿（音乐掉帧）
    if (opts?.forcePortraitRefresh || !dialogueSkinMatchesCharacter(stage, characterId)) {
      refreshDialogueSkinLayer(stage, characterId);
      playLiveVideos(overlay);
    } else {
      // 仅确保 idle 主循环在播；粘住姿势由下方 setDialogueDisciplinePose 续上
      const primary = stage.querySelector<HTMLVideoElement>(
        '[data-role="skin"] video[data-ai-live-portrait]',
      );
      if (primary && !(stage.dataset.skinPhase === 'discipline-sticky')) {
        armSilentPortraitVideo(primary);
        void primary.play().catch(() => {});
      }
    }
    if (inDiscipline) {
      const pose = getDisciplineSession(living)?.poseIndex ?? null;
      void setDialogueDisciplinePose(stage, pose);
    }
  }

  if (overlay.dataset.coScreen === 'true') {
    const co = getCoScreenGroupForCharacter(living, characterId);
    if (co) refreshCoScreenPortraitLayers(overlay, co.memberIds);
  }

  syncDisciplineChrome(overlay, characterId);
  syncDanceChrome(overlay, characterId);
  ensureDanceLoop(overlay, characterId);
  syncAnfuChrome(overlay, characterId);
  syncBathChrome(overlay, characterId);
  syncMiniGameChrome(overlay, characterId);
}

/** 安抚室：主按钮 + 邀请确认条 + 安抚条（进度/攻击/离开） */
function syncAnfuChrome(overlay: HTMLElement, characterId: string): void {
  const state = observeAnfuStateForUi(characterId);
  const coScreen = overlay.dataset.coScreen === 'true';
  const ended = overlay.classList.contains('is-ended');

  const anfuBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-anfu]');
  if (anfuBtn) {
    const usable = state.hasAssets && !coScreen;
    anfuBtn.hidden = !usable;
    anfuBtn.disabled = !usable || ended;
    anfuBtn.classList.toggle('is-active', state.active);
    anfuBtn.title = state.active
      ? '安抚进行中'
      : state.playedToday
        ? '今天已经安抚过一次了，明天再来'
        : '邀请去安抚室玩棉花游戏';
  }

  // 角色主动邀请确认条
  let inviteBar = overlay.querySelector<HTMLElement>('[data-ai-anfu-invite]');
  const living = getAiLiving();
  const pending = living.pendingAnfuInvite;
  const showInvite =
    pending && pending.characterId === characterId && !state.active && !coScreen;
  if (showInvite && pending) {
    if (!inviteBar) {
      inviteBar = document.createElement('div');
      inviteBar.className = 'ai-anfu-invite';
      inviteBar.dataset.aiAnfuInvite = '1';
      const menuEl = overlay.querySelector<HTMLElement>('[data-ai-dance-menu]');
      (menuEl ?? overlay.querySelector('[data-ai-form]'))?.parentElement?.insertBefore(
        inviteBar,
        menuEl ?? overlay.querySelector('[data-ai-form]'),
      );
    }
    inviteBar.hidden = false;
    // 1s 心跳会反复调用本函数：内容没变就**不要重建 DOM**，否则点击会落在被替换的旧按钮上（按钮"失效"）
    const inviteKey = `${pending.characterId}|${pending.proposedAt}|${pending.preview}`;
    if (inviteBar.dataset.inviteKey !== inviteKey) {
      inviteBar.dataset.inviteKey = inviteKey;
      inviteBar.innerHTML = `
      <p class="ai-anfu-invite-text">${escapeHtml(pending.preview)}</p>
      <div class="ai-anfu-invite-actions">
        <button type="button" class="ai-anfu-invite-yes" data-ai-anfu-invite-yes>去安抚室</button>
        <button type="button" class="ai-anfu-invite-no" data-ai-anfu-invite-no>下次吧</button>
      </div>`;
    }
  } else if (inviteBar) {
    inviteBar.hidden = true;
    inviteBar.innerHTML = '';
    delete inviteBar.dataset.inviteKey;
  }

  // 安抚条：进行中显示（进度 + 棉花攻击 + 离开）
  let bar = overlay.querySelector<HTMLElement>('[data-ai-anfu-bar]');
  const showBar = state.active && !coScreen;
  if (showBar) {
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'ai-anfu-bar';
      bar.dataset.aiAnfuBar = '1';
      const form = overlay.querySelector<HTMLElement>('[data-ai-form]');
      form?.parentElement?.insertBefore(bar, form);
    }
    const phaseLabel =
      state.phase === 'dressing'
        ? '换装中…'
        : state.phase === 'travel'
          ? '赶路中…'
          : state.phase === 'standby'
            ? '安抚待机'
            : state.phase === 'soothing'
              ? '安抚中'
              : '心满意足';
    const attackDisabled =
      ended ||
      state.phase === 'dressing' ||
      state.phase === 'travel' ||
      state.phase === 'exhausted' ||
      state.awaitingReply ||
      (state.phase === 'soothing' && state.attackCoolingMs > 0);
    const attackLabel =
      state.phase === 'dressing'
        ? '换装中…'
        : state.phase === 'travel'
          ? '赶路中…'
          : state.phase === 'standby'
            ? '发射第一团棉花'
            : state.phase === 'exhausted'
              ? '棉花已停'
              : state.awaitingReply
                ? '棉花飞行中…'
                : state.attackCoolingMs > 0
                  ? `装填中 ${Math.ceil(state.attackCoolingMs / 1000)}s`
                  : '发射棉花';
    const leaveLabel = state.phase === 'exhausted' ? '离开安抚室' : '结束安抚';
    bar.hidden = false;
    bar.innerHTML = `
      <div class="ai-anfu-meter">
        <span class="ai-anfu-meter-label">${escapeHtml(phaseLabel)}</span>
        <div class="ai-anfu-meter-track"><div class="ai-anfu-meter-fill" style="width:${Math.max(0, Math.min(100, state.value))}%"></div></div>
        <span class="ai-anfu-meter-value">${state.value}/100</span>
      </div>
      <div class="ai-anfu-actions">
        <button type="button" class="ai-anfu-attack" data-ai-anfu-attack ${attackDisabled ? 'disabled' : ''}>☁️ ${escapeHtml(attackLabel)}</button>
        <button type="button" class="ai-anfu-leave" data-ai-anfu-leave ${ended ? 'disabled' : ''}>${escapeHtml(leaveLabel)}</button>
      </div>`;
  } else if (bar) {
    bar.hidden = true;
    bar.innerHTML = '';
  }

  // 喘息声：安抚中按安抚值切档；疲惫态回 1 级；其余相停止
  // 安抚室 BGM：进入会话（换装起）即切安抚专用曲，离开后交回主曲。
  // syncBgmForView 里 anfu 优先级最高，不会被营地欢乐曲/主曲抢回。
  if (state.active) enterAnfuBgm();
  else exitAnfuBgm();

  // 喘息声：安抚中按安抚值切档；疲惫态回 1 级；其余相停止
  unlockAnfuBreathAudio();
  syncAnfuBreathAudio(characterId, state.active ? state.phase : null, state.value);
}

/**
 * 安抚会话是否正在占用立绘（安抚中播安抚片段；换装/待机/疲惫播各自的相位皮）。
 * 用于让情绪立绘 / AI skin_clip 让位，避免多层争抢同一块画面。
 */
export function isAnfuPortraitLocked(characterId: string): boolean {
  const s = getAiLiving().anfuSession;
  return !!s?.active && s.characterId === characterId;
}

/**
 * 画面完全由安抚会话状态驱动（唯一真源）：
 * - soothing：播 clipIndex 对应的安抚片段
 * - dressing/standby/exhausted：交回皮肤层（待机皮 / 换装过程皮 / 疲惫皮）
 * 每次对话刷新、攻击、被动涨幅后都调用，天然幂等，不会跳段或回退第一段。
 */
function syncAnfuPortraitFromSession(overlay: HTMLElement, characterId: string): void {
  const stage = findDialoguePortraitStage(overlay, characterId);
  if (!stage) return;
  const s = getAiLiving().anfuSession;
  const mine = s?.active && s.characterId === characterId ? s : null;
  if (!mine || mine.phase !== 'soothing') {
    // 非安抚中：确保安抚层已交回
    if (stage.dataset.anfuClipSrc) clearAnfuClip(overlay, characterId);
    return;
  }
  const clips = getAnfuClips(characterId);
  const src = clips[mine.clipIndex];
  if (!src) return;
  void playDialogueAnfuClip(stage, src, mine.clipIndex).catch(() => {});
}

function clearAnfuClip(overlay: HTMLElement, characterId: string): void {
  const stage = findDialoguePortraitStage(overlay, characterId);
  if (!stage) return;
  stopDialogueAnfuClip(stage);
}

/**
 * 满值疲惫皮预载（无缝切换修复）：
 * 安抚值过半即后台拉起 ANFU_DONE_SKIN 的静帧 + 动态视频。此前满值切皮时才开始
 * 加载 CDN 资源（几 MB 的 webm + 静帧 PNG），期间立绘层空窗——玩家看到
 * "满值后很长时间空场景，疲惫皮才慢慢出来"。预载后满值切皮即时上屏。
 */
const anfuDonePreloaded = new Set<string>();
const anfuDonePreloadKeep: Array<HTMLImageElement | HTMLVideoElement> = [];

function preloadAnfuDoneSkin(characterId: string): void {
  if (anfuDonePreloaded.has(characterId)) return;
  anfuDonePreloaded.add(characterId);
  const skin = getCharacterSkin(characterId, ANFU_DONE_SKIN_ID);
  if (!skin) return;
  const poster = skin.portraits[0];
  if (poster) {
    const img = new Image();
    img.decoding = 'async';
    img.src = texUrl(poster);
    anfuDonePreloadKeep.push(img);
  }
  const live = skin.portraitLive;
  if (live) {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.setAttribute('playsinline', '');
    v.src = texUrl(live);
    // 保留引用防止 GC 在加载完成前回收元素、静默中断预载
    anfuDonePreloadKeep.push(v);
    try {
      v.load();
    } catch {
      /* ignore */
    }
  }
}

/** 该功能已下线：确保相关入口不出现（无成人文本） */
function syncDisciplineChrome(overlay: HTMLElement, characterId: string): void {
  void characterId;
  const discBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-discipline]');
  if (discBtn) discBtn.hidden = true;
  let poseBar = overlay.querySelector<HTMLElement>('[data-ai-discipline-poses]');
  if (poseBar) {
    poseBar.hidden = true;
    poseBar.innerHTML = '';
  }
  let inviteBar = overlay.querySelector<HTMLElement>('[data-ai-discipline-invite]');
  if (inviteBar) {
    inviteBar.hidden = true;
    inviteBar.innerHTML = '';
  }
  const itemsBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-items]');
  if (
    itemsBtn &&
    !overlay.classList.contains('is-ended') &&
    !overlay.querySelector('[name="msg"]')?.hasAttribute('disabled')
  ) {
    itemsBtn.disabled = false;
    itemsBtn.title = '从仓库递交物品';
  }
}

/** 舞蹈：主按钮可用性 + 事件内动态按钮（开始/停下/结束）+ 角色主动邀请确认条 */
function syncDanceChrome(overlay: HTMLElement, characterId: string): void {
  const state = observeDanceStateForUi(characterId);
  const danceBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-dance]');
  const menu = overlay.querySelector<HTMLElement>('[data-ai-dance-menu]');
  const usable = state.hasAssets && overlay.dataset.coScreen !== 'true';
  if (danceBtn) {
    danceBtn.hidden = !usable;
    danceBtn.disabled = !usable || overlay.classList.contains('is-ended');
    danceBtn.classList.toggle('is-active', state.active);
    danceBtn.title =
      state.phase === 'dressing'
        ? '换舞装中…'
        : state.phase === 'travel'
          ? '正在去大厅的路上…'
          : state.phase === 'unveil'
            ? '换演出服…马上起舞'
            : state.active
              ? '开始舞蹈 / 停下 / 结束'
              : '邀请一同跳舞 / 想看你跳舞（仅大厅）';
  }

  // 事件内：菜单常显，按钮语义随相位变化（同意后就是「开始舞蹈」，不是邀请）
  if (menu) {
    if (!usable) {
      menu.hidden = true;
    } else if (state.active) {
      const mode = state.mode ?? 'solo';
      const altMode = mode === 'co' ? 'solo' : 'co';
      const altLabel = altMode === 'co' ? '一起跳' : '跳给我看';
      let html = '';
      if (state.phase === 'dressing') {
        html += `<button class="ai-dance-choice" type="button" disabled>换舞装中…</button>`;
      } else if (state.phase === 'travel') {
        html += `<button class="ai-dance-choice" type="button" disabled>去大厅路上…</button>`;
      } else if (state.phase === 'unveil') {
        html += `<button class="ai-dance-choice" type="button" disabled>换演出服…马上起舞</button>`;
      } else if (state.phase === 'dancing') {
        html += `<button class="ai-dance-choice" type="button" data-ai-dance-stop>停下（回待机）</button>`;
        html += `<button class="ai-dance-choice" type="button" data-ai-dance-alt="${altMode}">换${altLabel}</button>`;
      } else {
        html += `<button class="ai-dance-choice" type="button" data-ai-dance-start="${mode}">开始舞蹈</button>`;
        html += `<button class="ai-dance-choice" type="button" data-ai-dance-alt="${altMode}">换${altLabel}</button>`;
      }
      html += `<button class="ai-dance-choice" type="button" data-ai-dance-end>结束舞蹈</button>`;
      menu.innerHTML = html;
      menu.hidden = false;
    } else if (menu.dataset.danceInviteMode !== '1') {
      if (!menu.querySelector('[data-ai-dance-co]')) {
        menu.innerHTML =
          '<button class="ai-dance-choice" type="button" data-ai-dance-co>邀请一同跳舞</button>' +
          '<button class="ai-dance-choice" type="button" data-ai-dance-solo>想看你跳舞</button>';
      }
    }
  }

  let inviteBar = overlay.querySelector<HTMLElement>('[data-ai-dance-invite]');
  const living = getAiLiving();
  const pending = living.pendingDanceInvite;
  const show =
    pending &&
    pending.characterId === characterId &&
    !state.active &&
    overlay.dataset.coScreen !== 'true';
  if (show && pending) {
    if (!inviteBar) {
      inviteBar = document.createElement('div');
      inviteBar.className = 'ai-dance-invite';
      inviteBar.dataset.aiDanceInvite = '1';
      const menuEl = overlay.querySelector<HTMLElement>('[data-ai-dance-menu]');
      menuEl?.parentElement?.insertBefore(inviteBar, menuEl);
    }
    inviteBar.hidden = false;
    const danceInviteKey = `${pending.characterId}|${pending.proposedAt}|${pending.preview}`;
    if (inviteBar.dataset.inviteKey !== danceInviteKey) {
      inviteBar.dataset.inviteKey = danceInviteKey;
      inviteBar.innerHTML = `
      <p class="ai-dance-invite-text">${escapeHtml(pending.preview)}</p>
      <div class="ai-dance-invite-actions">
        <button type="button" class="ai-dance-invite-yes" data-ai-dance-invite-yes>去大厅</button>
        <button type="button" class="ai-dance-invite-no" data-ai-dance-invite-no>下次吧</button>
      </div>`;
    }
  } else if (inviteBar) {
    inviteBar.hidden = true;
    inviteBar.innerHTML = '';
    delete inviteBar.dataset.inviteKey;
  }
}

/** 面板交互产生的系统行直接落聊天日志（模块层拿不到 wire 内的 appendLog） */
function appendMiniGameSysLog(overlay: HTMLElement, who: string, text: string): void {
  const logEl = overlay.querySelector<HTMLElement>('[data-ai-log]');
  if (!logEl) return;
  const line = document.createElement('div');
  line.className = 'ai-immersive-line';
  line.innerHTML = [
    `<span class="ai-immersive-who">${escapeHtml(who)}</span>`,
    `<span class="ai-immersive-msg">${escapeHtml(text)}</span>`,
  ].join('');
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

/** 小游戏：主按钮 + 菜单（五子棋/猜拳）+ 角色主动邀请确认条 + 对局浮层面板 */
function syncMiniGameChrome(overlay: HTMLElement, characterId: string): void {
  const state = observeMiniGameStateForUi(characterId);
  const coScreen = overlay.dataset.coScreen === 'true';
  const ended = overlay.classList.contains('is-ended');

  const mgBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-minigame]');
  const menu = overlay.querySelector<HTMLElement>('[data-ai-minigame-menu]');
  const usable = state.available && !coScreen;
  if (mgBtn) {
    mgBtn.hidden = !usable;
    mgBtn.disabled = !usable || ended;
    mgBtn.classList.toggle('is-active', state.active);
    mgBtn.title = state.active
      ? '对局进行中（左侧浮层可落子/出拳/退出）'
      : '来盘五子棋 / 猜拳（需她在娱乐间或大厅）';
  }
  if (menu && (!usable || state.active)) {
    menu.hidden = true;
  }

  // 角色主动邀请确认条
  let inviteBar = overlay.querySelector<HTMLElement>('[data-ai-minigame-invite]');
  const living = getAiLiving();
  const pending = living.pendingMiniGameInvite;
  const show =
    !!pending &&
    pending.characterId === characterId &&
    !state.active &&
    !coScreen;
  if (show && pending) {
    if (!inviteBar) {
      inviteBar = document.createElement('div');
      inviteBar.className = 'ai-minigame-invite';
      inviteBar.dataset.aiMinigameInvite = '1';
      const menuEl = overlay.querySelector<HTMLElement>('[data-ai-minigame-menu]');
      menuEl?.parentElement?.insertBefore(inviteBar, menuEl);
    }
    inviteBar.hidden = false;
    const inviteKey = `${pending.characterId}|${pending.proposedAt}|${pending.preview}`;
    if (inviteBar.dataset.inviteKey !== inviteKey) {
      inviteBar.dataset.inviteKey = inviteKey;
      inviteBar.innerHTML = `
      <p class="ai-minigame-invite-text">${escapeHtml(pending.preview)}</p>
      <div class="ai-minigame-invite-actions">
        <button type="button" class="ai-minigame-invite-yes" data-ai-minigame-invite-yes>来玩</button>
        <button type="button" class="ai-minigame-invite-no" data-ai-minigame-invite-no>下次吧</button>
      </div>`;
    }
  } else if (inviteBar) {
    inviteBar.hidden = true;
    inviteBar.innerHTML = '';
    delete inviteBar.dataset.inviteKey;
  }

  // 对局浮层面板（同屏对话不挂）
  if (!coScreen) {
    syncMiniGamePanel(overlay, characterId, {
      appendLog: (who, text) => appendMiniGameSysLog(overlay, who, text),
    });
  }
}

/**
 * 洗浴：主按钮 + 两选项菜单（帮我冲澡 / 一同泡澡）+ 角色主动邀请确认条。
 * 与舞蹈同构：点主按钮开菜单 → 点选项把请求发进聊天 → 角色答复 → 确认条 → 进浴室。
 */
function syncBathChrome(overlay: HTMLElement, characterId: string): void {
  const state = observeBathStateForUi(characterId);
  const coScreen = overlay.dataset.coScreen === 'true';
  const ended = overlay.classList.contains('is-ended');

  const bathBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-bath]');
  const menu = overlay.querySelector<HTMLElement>('[data-ai-bath-menu]');
  const usable = state.available && !coScreen;
  if (bathBtn) {
    bathBtn.hidden = !usable;
    bathBtn.disabled = !usable || ended;
    bathBtn.classList.toggle('is-active', state.active);
    bathBtn.title = state.active
      ? state.mode === 'co_bath'
        ? '共浴中：点此切换为「帮我冲澡」'
        : '帮洗中：点此切换为「一同泡澡」'
      : '帮我（指挥官冲澡） / 一同泡澡';
  }
  if (menu) {
    if (!usable) {
      menu.hidden = true;
    } else if (state.active) {
      // 事件进行中：菜单常显，当前模式禁用，另一个是可切换的目标
      const altMode = state.mode === 'co_bath' ? 'help_wash' : 'co_bath';
      menu.hidden = false;
      const helpBtn = menu.querySelector<HTMLButtonElement>('[data-ai-bath-help]');
      const coBtn = menu.querySelector<HTMLButtonElement>('[data-ai-bath-co]');
      if (helpBtn) {
        helpBtn.disabled = state.mode === 'help_wash';
        helpBtn.textContent = '帮我（指挥官冲澡）';
      }
      if (coBtn) {
        coBtn.disabled = state.mode === 'co_bath';
        coBtn.textContent = '一同泡澡';
      }
      menu.dataset.bathAltMode = altMode;
    } else {
      menu.hidden = true;
    }
  }

  // 角色主动邀请 / 指挥官已提出待确认 → 确认条
  let inviteBar = overlay.querySelector<HTMLElement>('[data-ai-bath-invite]');
  const living = getAiLiving();
  const pending = living.pendingBathAssistInvite;
  const show = pending && pending.characterId === characterId && !coScreen;
  if (show && pending) {
    if (!inviteBar) {
      inviteBar = document.createElement('div');
      inviteBar.className = 'ai-bath-invite';
      inviteBar.dataset.aiBathInvite = '1';
      const menuEl = overlay.querySelector<HTMLElement>('[data-ai-bath-menu]');
      menuEl?.parentElement?.insertBefore(inviteBar, menuEl);
    }
    inviteBar.hidden = false;
    const key = `${pending.characterId}|${pending.proposedAt}|${pending.preview}`;
    if (inviteBar.dataset.inviteKey !== key) {
      inviteBar.dataset.inviteKey = key;
      inviteBar.innerHTML = `
      <p class="ai-bath-invite-text">${escapeHtml(pending.preview)}</p>
      <div class="ai-bath-invite-actions">
        <button type="button" class="ai-bath-invite-yes" data-ai-bath-invite-yes>去浴室</button>
        <button type="button" class="ai-bath-invite-no" data-ai-bath-invite-no>下次吧</button>
      </div>`;
    }
  } else if (inviteBar) {
    inviteBar.hidden = true;
    inviteBar.innerHTML = '';
    delete inviteBar.dataset.inviteKey;
  }
}

const danceLoopState = new WeakMap<HTMLElement, { cid: string; ctrl: AbortController }>();

/**
 * 独舞无缝循环驱动器：ended 事件链式按序播放 [主, _1, _2 …]，首尾相接、画面一直在跳；
 * 暂停/结束/切皮时中止链式（由 stage.dataset.skinPhase 守卫 + AbortController 双保险）。
 */
function ensureDanceLoop(overlay: HTMLElement, characterId: string): void {
  const state = observeDanceStateForUi(characterId);
  const existing = danceLoopState.get(overlay);
  const shouldRun =
    state.active &&
    state.mode === 'solo' &&
    state.phase === 'dancing' &&
    !state.soloPaused &&
    overlay.dataset.coScreen !== 'true';

  if (!shouldRun) {
    if (existing) {
      existing.ctrl.abort();
      danceLoopState.delete(overlay);
      const stage = findDialoguePortraitStage(overlay, existing.cid);
      if (stage) stopDialogueDanceSoloLoop(stage);
    }
    return;
  }
  if (existing && existing.cid === characterId) return;
  if (existing) {
    existing.ctrl.abort();
    const stage = findDialoguePortraitStage(overlay, existing.cid);
    if (stage) stopDialogueDanceSoloLoop(stage);
  }

  const clips = getDanceSoloClips(characterId);
  if (!clips.length) return;
  const stage = findDialoguePortraitStage(overlay, characterId);
  if (!stage) return;

  const ctrl = new AbortController();
  danceLoopState.set(overlay, { cid: characterId, ctrl });
  void playDialogueDanceSoloLoop(stage, clips, { signal: ctrl.signal }).then((ok) => {
    if (!ok) {
      danceLoopState.delete(overlay);
      // 链式起不来才退回原有按段时间切换；ended 链式成功时不走 timer
      legacyDanceTimerStep(overlay, characterId);
    }
  });
}

/**
 * 兜底：链式播放器起不来（缺段/被占用）时，按段时间切换，至少保证画面在跳。
 * 独舞不论是否有「主循环」文件：有几段播几段，按序循环，与命名后缀数无关。
 */
function legacyDanceTimerStep(overlay: HTMLElement, characterId: string): void {
  const clips = getDanceSoloClips(characterId);
  if (!clips.length) return;
  const step = () => {
    const st = observeDanceStateForUi(characterId);
    if (!st.active || st.mode !== 'solo' || st.phase !== 'dancing' || st.soloPaused) return;
    const stage = findDialoguePortraitStage(overlay, characterId);
    if (!stage) return;
    const cur = Number(stage.dataset.danceSoloIdx ?? '-1');
    const next = (cur + 1) % clips.length;
    stage.dataset.danceSoloIdx = String(next);
    refreshDialogueSkinLayer(stage, characterId);
    if (next > 0) void playDialogueSkinClip(stage, next).catch(() => {});
    window.setTimeout(step, 5200);
  };
  step();
}

/** 黑屏淡入 → 换景换皮 → 淡出 */
function runDisciplineBlackout(
  overlay: HTMLElement,
  mid: () => void,
  ms = 2200,
): Promise<void> {
  return new Promise((resolve) => {
    let veil = overlay.querySelector<HTMLElement>('.ai-discipline-blackout');
    if (!veil) {
      veil = document.createElement('div');
      veil.className = 'ai-discipline-blackout';
      veil.setAttribute('aria-hidden', 'true');
      overlay.querySelector('.ai-immersive-stage')?.appendChild(veil);
    }
    overlay.dataset.disciplineBusy = '1';
    veil.classList.remove('is-out');
    veil.classList.add('is-on');
    const half = Math.max(400, Math.floor(ms / 2));
    window.setTimeout(() => {
      try {
        mid();
      } catch {
        /* mid 失败仍淡出 */
      }
      veil!.classList.add('is-out');
      window.setTimeout(() => {
        veil!.classList.remove('is-on', 'is-out');
        delete overlay.dataset.disciplineBusy;
        resolve();
      }, half);
    }, half);
  });
}

function settleDisciplineOnDialogueInterruption(reason: string): void {
  saveManager.mutate((save) => {
    const living = getAiLiving();
    settleActiveDisciplineSession(save, living, reason);
    save.aiLiving = living;
  });
  syncCharacterSkinRuntime(saveManager.get());
}

/**
 * 打开对话：若角色在活跃多人事件同屏组内 → 同屏模式；否则单人。
 */
export function showAiDialogue(characterId: string, opts: AiDialogueOptions = {}): void {
  const def = CHARACTER_MAP[characterId];
  if (!def) return;

  // 后台预热当前角色模型（冷启动 13GB GGUF 加载到 GPU 需 30-60s）
  // 不阻塞 UI；如果本地模型被切到云端 provider，会自动 noop
  void warmupCharacterModel(characterId);

  const prev = document.querySelector<HTMLElement>('[data-ai-dialogue]');
  if (prev) {
    settleDisciplineOnDialogueInterruption('切换对话');
    if (prev.dataset.festiveBgm === '1') {
      exitFestiveCampDialogueBgm();
      notifyBgmStateChanged();
    }
    prev.remove();
    releaseDialogueSceneSession();
  } else {
    releaseDialogueSceneSession();
  }

  const livingQuick = getAiLiving();
  let coGroup: CoScreenGroup | null = getCoScreenGroupForCharacter(livingQuick, characterId);
  if (opts.forceCoScreenIds && opts.forceCoScreenIds.length >= 2) {
    coGroup = {
      instanceId: 'forced',
      defId: 'forced',
      eventName: opts.forceEventName ?? '多人场景',
      focusRoomId: '',
      focusLabel: '',
      memberIds: capCoScreenMemberIds(opts.forceCoScreenIds),
      topic: undefined,
    };
  }

  const festiveBgm = shouldPlayFestiveCampDialogueBgm(characterId, livingQuick, opts, coGroup);
  if (festiveBgm) enterFestiveCampDialogueBgm();

  if (coGroup && coGroup.memberIds.length >= 2) {
    showCoScreenDialogue(characterId, coGroup, opts, festiveBgm);
    return;
  }

  showSoloDialogue(characterId, opts, festiveBgm);
}

function tagFestiveDialogueOverlay(
  overlay: HTMLElement,
  characterId: string,
  opts: AiDialogueOptions,
  festiveBgm: boolean,
  coDefId?: string,
): void {
  overlay.dataset.aiDialogueChar = characterId;
  if (opts.fromCamp) overlay.dataset.aiFromCamp = '1';
  if (festiveBgm) overlay.dataset.festiveBgm = '1';
  if (coDefId) overlay.dataset.coEventDef = coDefId;
}

/** 首次打开聊天页的引导标记（一次性） */
const DIALOGUE_GUIDE_KEY = 'ai_dlg_guide_v1';

/** 玩家第一次进聊天页：简易按钮引导说明，点「开始聊天」后不再出现 */
function maybeShowDialogueGuide(overlay: HTMLElement): void {
  let seen = false;
  try {
    seen = localStorage.getItem(DIALOGUE_GUIDE_KEY) === '1';
  } catch {
    /* 隐私模式等场景忽略 */
  }
  if (seen) return;
  try {
    localStorage.setItem(DIALOGUE_GUIDE_KEY, '1');
  } catch {
    /* ignore */
  }

  const guide = document.createElement('div');
  guide.className = 'ai-dlg-guide';
  guide.innerHTML = `
    <div class="ai-dlg-guide-card" role="alertdialog" aria-label="聊天页引导">
      <h3 class="ai-dlg-guide-title">和她聊天 · 小贴士</h3>
      <ul class="ai-dlg-guide-list">
        <li><span class="ai-dlg-guide-ico">🎛️</span>左下竖排按钮：邀请她跳舞 / 洗浴 / 小游戏 / 安抚，或递交物品</li>
        <li><span class="ai-dlg-guide-ico">⌨️</span>底部输入框打字发送；点麦克风说话，她会语音回复</li>
        <li><span class="ai-dlg-guide-ico">👆</span>长按她的立绘：挑选互动片段播放（有片段时）</li>
        <li><span class="ai-dlg-guide-ico">🤏</span>双指张开立绘：临时放大细看（最大 1.3 倍），松手自动复原</li>
      </ul>
      <button type="button" class="ai-dlg-guide-ok" data-ai-guide-ok>开始聊天</button>
    </div>
  `;
  overlay.appendChild(guide);
  const dismiss = () => {
    guide.classList.add('is-leaving');
    window.setTimeout(() => guide.remove(), 320);
  };
  guide.querySelector('[data-ai-guide-ok]')?.addEventListener('click', dismiss);
  guide.addEventListener('click', (e) => {
    if (e.target === guide) dismiss();
  });
}

function showSoloDialogue(characterId: string, opts: AiDialogueOptions, festiveBgm: boolean): void {
  const def = CHARACTER_MAP[characterId]!;
  const livingQuick = getAiLiving();
  const sceneId = resolveCharacterSceneImageId(characterId, livingQuick);
  const scene = getSceneCard(sceneId);
  const bgSrc = texUrl(
    scene
      ? resolveSceneCardImage(scene, resolvePeriod(livingQuick))
      : './tex/Indoor/shinei01_yilou_dating.png',
  );
  const presence = resolvePresence(characterId, livingQuick);
  const affinity = peekAffinity(characterId);

  const overlay = document.createElement('div');
  overlay.className = 'ai-dialogue-overlay ai-immersive';
  overlay.dataset.aiDialogue = 'true';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `与${def.name}对话`);

  overlay.innerHTML = `
    <div class="ai-immersive-stage">
      <img class="ai-immersive-bg" src="${bgSrc}" alt="" />
      <div class="ai-immersive-veil" aria-hidden="true"></div>
      <button type="button" class="ai-immersive-voice-mode" data-ai-voice-mode aria-label="切换语音/文字表达"></button>
      <button type="button" class="ai-immersive-close" data-ai-close aria-label="关闭">×</button>
      <div class="ai-immersive-chip" data-ai-chip>
        ${escapeHtml(def.name)} · ${escapeHtml(presence.label)} · 好感 ${affinity}${
          opts.fromOutreach ? ' · 主动来信' : ''
        }
      </div>
      <div class="ai-immersive-char">
        <div class="ai-immersive-portrait" data-ai-portrait>
          ${buildDialoguePortraitStageHtml(characterId)}
        </div>
        <p class="ai-outfit-hint" data-outfit-hint hidden></p>
      </div>
      <div class="ai-immersive-dock">
        <div class="ai-immersive-log" data-ai-log></div>
        <div class="ai-immersive-bubble" data-ai-bubble-row hidden>
          <img class="ai-immersive-bubble-bg" data-ai-bubble-bg src="${AI_BUBBLE_STYLE.dialogue}" alt="" />
          <p class="ai-immersive-bubble-text" data-ai-bubble-text></p>
        </div>
        <p class="ai-immersive-action" data-ai-action hidden></p>
        ${
          hasDialogueApiKey()
            ? ''
            : '<p class="ai-immersive-warn">尚未配置对话接口：千问请填 DashScope Key；家里 GPU/Fable 请在营地生活选择兼容口并填 Base URL。</p>'
        }
        <div class="ai-immersive-rail" data-ai-rail aria-label="互动按钮">
          <button type="button" class="ai-immersive-dance" data-ai-dance aria-label="舞蹈" title="邀请一同跳舞 / 想看你跳舞（仅大厅）">💃</button>
          <button type="button" class="ai-immersive-bath" data-ai-bath aria-label="洗浴" title="帮我（指挥官冲澡） / 一同泡澡">🛁</button>
          <button type="button" class="ai-immersive-minigame" data-ai-minigame aria-label="小游戏" title="来盘五子棋 / 猜拳（她会来娱乐间赴局）">🎲</button>
          <button type="button" class="ai-immersive-anfu" data-ai-anfu aria-label="安抚" title="邀请去安抚室玩棉花游戏">🧸</button>
          <button type="button" class="ai-immersive-items" data-ai-items aria-label="物品" title="从仓库递交物品">📦</button>
        </div>
        <form class="ai-immersive-form" data-ai-form>
          <button type="button" class="ai-immersive-mic" data-ai-mic aria-label="语音输入" title="语音输入：角色将语音回复">🎤</button>
          <input class="ai-immersive-input" name="msg" type="text" maxlength="200" placeholder="打字=文字回复 · 麦克风=语音回复" autocomplete="off" disabled />
          <button class="ai-immersive-send" type="submit" data-ai-send disabled>发送</button>
        </form>
        <div class="ai-dance-menu" data-ai-dance-menu hidden>
          <button type="button" class="ai-dance-choice" data-ai-dance-co>邀请一同跳舞</button>
          <button type="button" class="ai-dance-choice" data-ai-dance-solo>想看你跳舞</button>
        </div>
        <div class="ai-bath-menu" data-ai-bath-menu hidden>
          <button type="button" class="ai-bath-choice" data-ai-bath-help>帮我（指挥官冲澡）</button>
          <button type="button" class="ai-bath-choice" data-ai-bath-co>一同泡澡</button>
        </div>
        <div class="ai-minigame-menu" data-ai-minigame-menu hidden>
          <button type="button" class="ai-minigame-choice" data-ai-minigame-kind="gomoku">来盘五子棋</button>
          <button type="button" class="ai-minigame-choice" data-ai-minigame-kind="rps">猜拳</button>
        </div>
      </div>
      <div class="ai-particle-layer" data-ai-particles></div>
    </div>
  `;

  wireDialogueChrome(overlay, characterId, def.name, opts, null);
  tagFestiveDialogueOverlay(overlay, characterId, opts, festiveBgm);
  document.body.appendChild(overlay);
  bindDialoguePortraitInteractions(overlay);
  playLiveVideos(overlay);
  maybeShowDialogueGuide(overlay);
}

function showCoScreenDialogue(
  focusId: string,
  group: CoScreenGroup,
  opts: AiDialogueOptions,
  festiveBgm: boolean,
): void {
  const livingQuick = getAiLiving();
  const focusScene =
    (group.focusRoomId && CAMP_ROOM_MAP[group.focusRoomId]?.sceneId) ||
    resolveCharacterSceneImageId(focusId, livingQuick);
  const scene = getSceneCard(focusScene);
  const bgSrc = texUrl(
    scene
      ? resolveSceneCardImage(scene, resolvePeriod(livingQuick))
      : './tex/Indoor/shinei01_yilou_dating.png',
  );

  const overlay = document.createElement('div');
  overlay.className = 'ai-dialogue-overlay ai-immersive ai-coscreen';
  overlay.dataset.aiDialogue = 'true';
  overlay.dataset.coScreen = 'true';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${group.eventName}同屏对话`);

  const members = [...group.memberIds];
  // 焦点放第一位用于布局映射
  const ordered = [focusId, ...members.filter((id) => id !== focusId)];
  const slots = layoutCoScreenSlots(ordered.length);

  const portraits = ordered
    .map((id, i) => {
      const d = CHARACTER_MAP[id];
      const slot = slots[i] ?? slots[0];
      const isFocus = id === focusId;
      return `
        <button type="button" class="ai-coscreen-actor${isFocus ? ' is-focus' : ' is-dim'}"
          data-co-actor="${id}"
          style="left:${slot.x}%;top:${slot.y}%;--co-scale:${slot.scale};z-index:${isFocus ? 50 : slot.z}"
          aria-label="${escapeHtml(d?.name ?? id)}${isFocus ? '（当前对话）' : '（点击切换）'}">
          <span class="ai-coscreen-name">${escapeHtml(d?.name ?? id)}</span>
          <div class="ai-coscreen-portrait">${buildDialoguePortraitStageHtml(id)}</div>
        </button>`;
    })
    .join('');

  const focusDef = CHARACTER_MAP[focusId]!;
  const presence = resolvePresence(focusId, livingQuick);
  const others = members
    .filter((id) => id !== focusId)
    .map((id) => {
      const rel = getRelation(livingQuick, focusId, id);
      return `${CHARACTER_MAP[id]?.name ?? id}${describeRelation(rel)}`;
    })
    .slice(0, 4)
    .join(' · ');

  overlay.innerHTML = `
    <div class="ai-immersive-stage">
      <img class="ai-immersive-bg" src="${bgSrc}" alt="" />
      <div class="ai-immersive-veil" aria-hidden="true"></div>
      <button type="button" class="ai-immersive-voice-mode" data-ai-voice-mode aria-label="切换语音/文字表达"></button>
      <button type="button" class="ai-immersive-close" data-ai-close aria-label="关闭">×</button>
      <div class="ai-immersive-chip" data-ai-chip>
        【${escapeHtml(group.eventName)}】同屏 · ${escapeHtml(focusDef.name)} · 好感 ${peekAffinity(focusId)}
        ${group.topic ? ` · 话题「${escapeHtml(group.topic)}」` : ''}
      </div>
      <p class="ai-coscreen-hint" data-co-hint>同场：${escapeHtml(describeCoScreenMembers(members))}。点灰色角色可切换对话。</p>
      <div class="ai-coscreen-stage" data-co-stage>${portraits}</div>
      <div class="ai-immersive-dock">
        <div class="ai-immersive-log" data-ai-log></div>
        <div class="ai-immersive-bubble" data-ai-bubble-row hidden>
          <img class="ai-immersive-bubble-bg" data-ai-bubble-bg src="${AI_BUBBLE_STYLE.dialogue}" alt="" />
          <p class="ai-immersive-bubble-text" data-ai-bubble-text></p>
        </div>
        <p class="ai-immersive-action" data-ai-action hidden></p>
        <p class="ai-coscreen-rel" data-co-rel>${escapeHtml(others ? `与同伴：${others}` : '')}</p>
        ${
          hasDialogueApiKey()
            ? ''
            : '<p class="ai-immersive-warn">尚未配置对话接口：千问请填 DashScope Key；家里 GPU/Fable 请在营地生活选择兼容口并填 Base URL。</p>'
        }
        <div class="ai-immersive-rail" data-ai-rail aria-label="互动按钮">
          <button type="button" class="ai-immersive-items" data-ai-items aria-label="物品" title="从仓库递交物品">📦</button>
        </div>
        <form class="ai-immersive-form" data-ai-form>
          <button type="button" class="ai-immersive-mic" data-ai-mic aria-label="语音输入" title="语音输入：角色将语音回复">🎤</button>
          <input class="ai-immersive-input" name="msg" type="text" maxlength="200" placeholder="对 ${escapeHtml(focusDef.name)} · 打字文字 / 麦克风语音" autocomplete="off" disabled />
          <button class="ai-immersive-send" type="submit" data-ai-send disabled>发送</button>
        </form>
      </div>
      <div class="ai-particle-layer" data-ai-particles></div>
    </div>
  `;

  let currentFocus = focusId;
  const restyleActors = (nextFocus: string) => {
    currentFocus = nextFocus;
    const orderedNow = [nextFocus, ...members.filter((id) => id !== nextFocus)];
    const slotsNow = layoutCoScreenSlots(orderedNow.length);
    orderedNow.forEach((id, i) => {
      const btn = overlay.querySelector<HTMLElement>(`[data-co-actor="${id}"]`);
      if (!btn) return;
      const slot = slotsNow[i] ?? slotsNow[0];
      const isFocus = id === nextFocus;
      btn.classList.toggle('is-focus', isFocus);
      btn.classList.toggle('is-dim', !isFocus);
      btn.style.left = `${slot.x}%`;
      btn.style.top = `${slot.y}%`;
      btn.style.setProperty('--co-scale', String(isFocus ? slot.scale : slot.scale * 0.92));
      btn.style.zIndex = String(isFocus ? 50 : slot.z);
    });
    const d = CHARACTER_MAP[nextFocus];
    const input = overlay.querySelector<HTMLInputElement>('[name="msg"]');
    if (input) input.placeholder = `对 ${d?.name ?? nextFocus} 说…`;
    const living = getAiLiving();
    const chip = overlay.querySelector<HTMLElement>('[data-ai-chip]');
    if (chip) {
      chip.textContent = `【${group.eventName}】同屏 · ${d?.name ?? nextFocus} · 好感 ${peekAffinity(nextFocus)}${group.topic ? ` · 话题「${group.topic}」` : ''}`;
    }
    const relEl = overlay.querySelector<HTMLElement>('[data-co-rel]');
    if (relEl) {
      const o = members
        .filter((id) => id !== nextFocus)
        .map((id) => `${CHARACTER_MAP[id]?.name ?? id}${describeRelation(getRelation(living, nextFocus, id))}`)
        .slice(0, 4)
        .join(' · ');
      relEl.textContent = o ? `与同伴：${o}` : '';
    }
  };

  overlay.querySelectorAll<HTMLElement>('[data-co-actor]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.coActor;
      if (!id || id === currentFocus) return;
      playUiSound('tap');
      restyleActors(id);
      // 无缝切换：重载该角色对话历史
      reloadSession(overlay, id, CHARACTER_MAP[id]?.name ?? id);
    });
  });

  saveManager.mutate((d) => {
    const living = getAiLiving();
    const ev = (living.activeCampEvents ?? []).find((e) => e.instanceId === group.instanceId);
    if (ev) syncCoScreenParticipantWorld(d, living, ev);
    d.aiLiving = living;
  });
  syncCharacterSkinRuntime(saveManager.get());

  wireDialogueChrome(overlay, focusId, focusDef.name, opts, () => currentFocus);
  tagFestiveDialogueOverlay(overlay, focusId, opts, festiveBgm, group.defId);
  document.body.appendChild(overlay);
  refreshDialogueVisualContext(overlay, focusId);
  refreshCoScreenPortraitLayers(overlay, members);
}

function reloadSession(overlay: HTMLElement, characterId: string, name: string): void {
  let releaseMsg = '';
  saveManager.mutate((d) => {
    const living = getAiLiving();
    const pending = living.pendingItemOffer;
    if (pending && pending.toCharacterId !== characterId) {
      const r = releasePendingItemOffer(d, living);
      releaseMsg = r.msg;
      d.aiLiving = living;
    }
  });
  const logEl = overlay.querySelector<HTMLElement>('[data-ai-log]');
  if (releaseMsg) {
    const line = document.createElement('div');
    line.className = 'ai-immersive-line';
    line.innerHTML = `<span class="ai-immersive-who">系统</span><span class="ai-immersive-msg">${escapeHtml(releaseMsg)}</span>`;
    if (logEl) {
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }
    closeDialogueItemPicker(overlay);
  }
  const bubbleRow = overlay.querySelector<HTMLElement>('[data-ai-bubble-row]');
  const bubbleText = overlay.querySelector<HTMLElement>('[data-ai-bubble-text]');
  const input = overlay.querySelector<HTMLInputElement>('[name="msg"]');
  const sendBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-send]');
  if (!logEl) return;
  logEl.innerHTML = '<div class="ai-immersive-line"><span class="ai-immersive-msg">切换中…</span></div>';
  if (input) input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  void openDialogueSession(characterId).then((session) => {
    syncCharacterSkinRuntime(saveManager.get());
    refreshDialogueVisualContext(overlay, characterId, {
      clock: session.clock,
      presenceLabel: session.presenceLabel,
      forcePortraitRefresh: true,
    });
    logEl.innerHTML = '';
    for (const m of session.history) {
      const line = document.createElement('div');
      line.className = `ai-immersive-line${m.role === 'user' ? ' is-self' : ''}`;
      const bits = [
        `<span class="ai-immersive-who">${escapeHtml(m.role === 'user' ? '你' : name)}</span>`,
        `<span class="ai-immersive-msg">${escapeHtml(m.text)}</span>`,
      ];
      // 动作/心里只显示在底部 stage 一次，不塞进日志行（避免重复）
      line.innerHTML = bits.join('');
      logEl.appendChild(line);
    }
    logEl.scrollTop = logEl.scrollHeight;
    if (session.history.length) {
      const last = session.history[session.history.length - 1];
      if (last.role === 'assistant' && bubbleRow && bubbleText) {
        bubbleRow.hidden = true;
        bubbleText.textContent = last.text;
        const actionEl = overlay.querySelector<HTMLElement>('[data-ai-action]');
        if (actionEl) {
          const stageBits: string[] = [];
          if (last.action?.trim()) stageBits.push(last.action.trim());
          if (last.innerThought?.trim()) stageBits.push(`心里：${last.innerThought.trim()}`);
          if (stageBits.length) {
            actionEl.hidden = false;
            actionEl.textContent = `（${stageBits.join(' · ')}）`;
          } else {
            actionEl.hidden = true;
          }
        }
      }
    } else if (bubbleRow) {
      bubbleRow.hidden = true;
    }
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    input?.focus();
  });
}

function wireDialogueChrome(
  overlay: HTMLElement,
  initialCharacterId: string,
  initialName: string,
  opts: AiDialogueOptions,
  getFocusId: (() => string) | null,
): void {
  const logEl = overlay.querySelector<HTMLElement>('[data-ai-log]')!;
  const bubbleRow = overlay.querySelector<HTMLElement>('[data-ai-bubble-row]')!;
  const bubbleText = overlay.querySelector<HTMLElement>('[data-ai-bubble-text]')!;
  const bubbleBg = overlay.querySelector<HTMLImageElement>('[data-ai-bubble-bg]')!;
  const actionEl = overlay.querySelector<HTMLElement>('[data-ai-action]')!;
  const particles = overlay.querySelector<HTMLElement>('[data-ai-particles]')!;
  const sendBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-send]')!;
  const input = overlay.querySelector<HTMLInputElement>('[name="msg"]')!;
  const chip = overlay.querySelector<HTMLElement>('[data-ai-chip]')!;

  const activeId = () => getFocusId?.() ?? initialCharacterId;
  const activeName = () => CHARACTER_MAP[activeId()]?.name ?? activeId();

  const appendLog = (who: string, text: string, asSelf = false) => {
    const line = document.createElement('div');
    line.className = `ai-immersive-line${asSelf ? ' is-self' : ''}`;
    line.innerHTML = [
      `<span class="ai-immersive-who">${escapeHtml(who)}</span>`,
      `<span class="ai-immersive-msg">${escapeHtml(text)}</span>`,
    ].join('');
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    return line;
  };

  /**
   * 系统提示去重：同一句（如断网/超时）在短窗口内只落一次，
   * 避免营地心跳 + 流式回退连续失败把聊天面板刷成同一行复读。
   */
  let lastSysNoteText = '';
  let lastSysNoteAt = 0;
  const appendSystemNote = (text: string, dedupeMs = 15_000) => {
    const now = Date.now();
    if (text === lastSysNoteText && now - lastSysNoteAt < dedupeMs) return null;
    lastSysNoteText = text;
    lastSysNoteAt = now;
    return appendLog('系统', text);
  };


  const updateLastAssistantLog = (name: string, dialogue: string) => {
    const lines = [...logEl.querySelectorAll<HTMLElement>('.ai-immersive-line')].reverse();
    for (const line of lines) {
      if (line.classList.contains('is-self')) continue;
      const who = line.querySelector('.ai-immersive-who');
      if (who?.textContent !== name) continue;
      const msg = line.querySelector('.ai-immersive-msg');
      if (msg) msg.textContent = dialogue;
      logEl.scrollTop = logEl.scrollHeight;
      return;
    }
    appendLog(name, dialogue, false);
  };

  const paintStageBits = (result: Pick<LlmDialogueResult, 'action' | 'inner_thought' | 'camp_item_result'>) => {
    const stageBits: string[] = [];
    if (result.action?.trim()) stageBits.push(result.action.trim());
    if (result.inner_thought?.trim()) stageBits.push(`心里：${result.inner_thought.trim()}`);
    if (result.camp_item_result?.trim()) {
      stageBits.push(`营地：${result.camp_item_result.trim()}`);
    }
    if (stageBits.length) {
      actionEl.hidden = false;
      actionEl.textContent = `（${stageBits.join(' · ')}）`;
    } else {
      actionEl.hidden = true;
    }
  };

  let endCountdownTimer: number | null = null;

  /** 防止语音识别迟到结果叠发 / 连点重复发送；主动发言调度 */
  let sending = false;
  let dialogueEnded = false;
  let proactiveTimer: number | null = null;
  let proactiveAbort: AbortController | null = null;
  let consecutiveProactive = 0;
  let lastPlayerTypedAt = 0;
  /** 强制中断时抬升，丢弃在途对白结果 */
  let speakEpoch = 0;
  /** 玩家用语音发起后：后续角色句也朗读，且等播完再续聊，避免文案超前语音 */
  let voiceChatActive = false;
  const MAX_PROACTIVE_STREAK = 3;

  const clearProactive = () => {
    if (proactiveTimer != null) {
      window.clearTimeout(proactiveTimer);
      proactiveTimer = null;
    }
    if (proactiveAbort) {
      proactiveAbort.abort();
      proactiveAbort = null;
    }
  };

  const bumpSpeakEpoch = () => {
    speakEpoch += 1;
    clearProactive();
    consecutiveProactive = 0;
  };

  const clearEndTimers = () => {
    if (endCountdownTimer != null) {
      window.clearInterval(endCountdownTimer);
      endCountdownTimer = null;
    }
  };

  /** P3 更衣中提示：换装协议进行中给玩家可见的等待预期（现实逻辑：听见她在里屋换衣服） */
  let outfitHintTimer: number | null = null;
  const stopOutfitHint = () => {
    if (outfitHintTimer != null) {
      window.clearInterval(outfitHintTimer);
      outfitHintTimer = null;
    }
    overlay.querySelector<HTMLElement>('[data-outfit-hint]')?.setAttribute('hidden', '');
  };
  const updateOutfitHint = (characterId: string) => {
    const hint = overlay.querySelector<HTMLElement>('[data-outfit-hint]');
    if (!hint) return;
    const wait = getOutfitChangeCountdownMs(characterId);
    if (wait <= 0) {
      stopOutfitHint();
      return;
    }
    hint.hidden = false;
    hint.textContent = `换装中…约 ${Math.ceil(wait / 1000)} 秒`;
    if (outfitHintTimer == null) {
      outfitHintTimer = window.setInterval(() => {
        const w = getOutfitChangeCountdownMs(activeId());
        if (w <= 0) {
          stopOutfitHint();
          // 到点即落皮肤（不等 LLM），reveal 叙述由 scheduleOutfitRevealIfNeeded 驱动
          const r = settleDueOutfitChangeNow(activeId());
          if (r.applied && document.body.contains(overlay)) {
            refreshDialogueVisualContext(overlay, activeId());
          }
        } else {
          hint.textContent = `换装中…约 ${Math.ceil(w / 1000)} 秒`;
        }
      }, 1000);
    }
  };

  const unsubVoice = onVoiceSpeakingChange((on) => {
    overlay.classList.toggle('is-speaking', on);
    // 角色语音播报期间临时压低/恢复喘息声（不改档位）
    setAnfuBreathDucked('voice', on);
  });

  /**
   * 安抚会话统一心跳（1s）：驱动换装完成 → 待机皮的相位推进。
   *
   * 历史上换装完成只挂在 tickAnfuSession（由世界时钟/对话轮驱动），
   * 于是「玩家不发言时」dressing 永远不会结束 —— 立绘一直停在换装过程皮，
   * 玩家看到的就是「进安抚室没换装 / 不切待机皮肤」。这里用墙钟兜底，
   * 保证到点必然切到安抚待机皮。
   */
  let anfuBreathTimer = 0;
  let anfuLastPhase = '';
  const anfuTick = () => {
    if (!document.body.contains(overlay)) return;
    const s = getAiLiving().anfuSession;
    if (!s?.active) {
      anfuLastPhase = '';
      syncAnfuBreathAudio(null, null, 0);
      exitAnfuBgm();
      return;
    }
    // 换装到点 → 推进到 standby 并立即刷新立绘（不等玩家发言）
    if (s.phase === 'dressing' && Date.now() >= s.dressReadyAtMs) {
      if (finishAnfuDressingNow(s.characterId)) {
        syncCharacterSkinRuntime(saveManager.get());
        refreshDialogueVisualContext(overlay, s.characterId);
        const after = getAiLiving().anfuSession;
        const name = CHARACTER_MAP[s.characterId]?.name ?? s.characterId;
        if (after?.phase === 'travel') {
          appendLog('系统', `${name}换好了动物服装，正在走去安抚室（有路程，到了才能发射）。`);
        } else {
          appendLog('系统', `${name}换好了动物服装，等你发射第一团棉花。`);
        }
      }
    }
    // 相位变化 → 立即刷新皮肤层（不等玩家下一轮发言）。
    // 修复"安抚值满后长时间空场景"：被动涨值满 100 时 soothing→exhausted 的
    // 切皮此前只改数据，立绘要等玩家下次发言才刷新，期间画面无角色。
    if (s.phase !== anfuLastPhase) {
      const first = anfuLastPhase === '';
      anfuLastPhase = s.phase;
      if (!first) {
        syncCharacterSkinRuntime(saveManager.get());
        refreshDialogueVisualContext(overlay, s.characterId);
      }
    }
    // 疲惫皮预载：安抚值过半即后台拉起 ANFU_DONE_SKIN 静帧+动态，
    // 满值切皮时资源已在本地缓存，即时上屏（无缝）
    if (s.phase === 'soothing' && s.value >= 50) preloadAnfuDoneSkin(s.characterId);
    syncAnfuPortraitFromSession(overlay, s.characterId);
    syncAnfuBreathAudio(s.characterId, s.phase, s.value);
  };
  anfuBreathTimer = window.setInterval(anfuTick, 1000);

  /** 舞蹈会话心跳：换舞装到点 → 切待机；舞曲跟随「真正起舞」启停 */
  let danceTickTimer = 0;
  const danceTick = () => {
    if (!document.body.contains(overlay)) {
      exitDanceBgm();
      return;
    }
    const s = getAiLiving().danceSession;
    // 浴室：帮洗前的「先换浴巾」倒计时到点 → 切帮洗立绘（与舞蹈事件无关，独立结算）
    const bathPrep = finishBathAssistPrepareNow();
    if (bathPrep) {
      syncCharacterSkinRuntime(saveManager.get());
      refreshDialogueVisualContext(overlay, activeId());
      appendLog('系统', bathPrep);
      syncBathChrome(overlay, activeId());
    }
    // 小游戏：AI 落子/超时结算的系统行即时上屏 + 按钮/邀请条/面板同步（对局 tick 由世界心跳驱动）
    const mgFlashTick = takeMiniGameUiFlash();
    if (mgFlashTick) appendLog('系统', mgFlashTick);
    syncMiniGameChrome(overlay, activeId());
    // 行走阶段实时换景：起点→楼梯/大厅→目的地，背景与立绘随时刷新
    const travelStage = getTravelStageKey(getAiLiving(), activeId());
    if ((overlay.dataset.aiTravelStage ?? '') !== travelStage) {
      overlay.dataset.aiTravelStage = travelStage;
      syncCharacterSkinRuntime(saveManager.get());
      refreshDialogueVisualContext(overlay, activeId());
    }
    if (!s?.active) {
      exitDanceBgm();
      // 没有舞蹈事件也可能在赶路（安抚/移房）：到点照样落点并刷新
      const arrivals = processTravelArrivalsNow();
      if (arrivals.length) {
        syncCharacterSkinRuntime(saveManager.get());
        refreshDialogueVisualContext(overlay, activeId());
        for (const line of arrivals) appendLog('系统', line);
      }
      return;
    }
    // 舞蹈赶路到点：落点并切待机
    const travelLines = processTravelArrivalsNow();
    if (travelLines.length) {
      syncCharacterSkinRuntime(saveManager.get());
      refreshDialogueVisualContext(overlay, activeId());
      for (const line of travelLines) appendLog('系统', line);
    }
    // 音乐以角色正视起舞为准（pifu10/pifu11），而不是事件开始
    if (s.phase === 'dancing') enterDanceBgm();
    else exitDanceBgm();
    const r = finishDanceDressingNow();
    if (r) {
      syncCharacterSkinRuntime(saveManager.get());
      refreshDialogueVisualContext(overlay, r.characterId);
      appendLog('系统', r.systemLine);
      syncDanceChrome(overlay, r.characterId);
    }
    const u = finishDanceUnveilNow();
    if (u) {
      syncCharacterSkinRuntime(saveManager.get());
      refreshDialogueVisualContext(overlay, u.characterId);
      appendLog('系统', u.systemLine);
      syncDanceChrome(overlay, u.characterId);
    }
    syncDanceChrome(overlay, activeId());
    ensureDanceLoop(overlay, activeId());
  };
  danceTickTimer = window.setInterval(danceTick, 1000);

  const micBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-mic]');
  const itemsBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-items]');

  const setMicUi = (on: boolean) => {
    if (!micBtn) return;
    micBtn.classList.toggle('is-on', on);
    micBtn.textContent = on ? '●' : '🎤';
  };

  /** 语音会话中：合成并播完当前句后再返回（文本已先上屏） */
  const speakSynced = async (result: LlmDialogueResult, characterId: string) => {
    if (!voiceChatActive) return;
    try {
      const r = await speakDialogue({
        characterId,
        text: result.dialogue,
        emotion: result.emotion,
        type: result.type,
        interruptReaction: result.interrupt_reaction,
        wantSpeak: true,
      });
      if (!r.ok && !r.skipped) {
        // 同一类语音故障只提示一次，避免每句都刷屏；后台会在下一轮自动重试云端
        const nowMs = Date.now();
        if (nowMs - lastVoiceWarnAt > 120_000) {
          lastVoiceWarnAt = nowMs;
          appendLog('系统', '语音暂时不可用，先用文字（下一句会自动重试）。');
        }
        console.warn('[voice] speak failed:', r.reason);
      }
    } catch {
      /* 语音失败不阻断对话 */
    }
  };

  const syncPortraitEmotion = (
    characterId: string,
    poseKey?: string | null,
    emotion?: string,
    hold?: 'commit' | 'sticky' | 'preview',
  ) => {
    const stage = findDialoguePortraitStage(overlay, characterId);
    if (!stage) return;
    // 事件皮也要情绪图表达表情；结束后由 fadeToSkin 续播 idle
    void applyDialogueEmotionPose(stage, characterId, poseKey, { emotion, hold });
  };

  const buildDialogueTalkOpts = (
    epoch: number,
    turnMode: 'reply' | 'proactive' | 'continue' | 'outfit_reveal',
    turnState: { committed: boolean },
    signal?: AbortSignal,
  ) => {
    const characterId = activeId();
    const name = activeName();
    return {
      turnMode,
      signal,
      onWorldSynced: () => {
        if (!document.body.contains(overlay) || epoch !== speakEpoch) return;
        refreshDialogueVisualContext(overlay, characterId);
      },
      onDialoguePartial: (partial: string) => {
        if (!document.body.contains(overlay) || epoch !== speakEpoch || turnState.committed) return;
        bubbleRow.hidden = false;
        bubbleText.textContent = partial || '……';
      },
      onDialogueRegenerating: () => {
        if (!document.body.contains(overlay) || epoch !== speakEpoch || turnState.committed) return;
        bubbleRow.hidden = false;
        // 不把已经流出来的字清空重来（玩家会看到文字「换了几次」），
        // 只在还没有任何内容时显示等待态。
        if (!bubbleText.textContent || bubbleText.textContent === '……') {
          bubbleText.textContent = '……';
        }
      },
      onDialogueCommitted: (payload: DialogueCommittedPayload) => {
        if (!document.body.contains(overlay) || epoch !== speakEpoch || turnState.committed) return;
        turnState.committed = true;
        bubbleBg.src = AI_BUBBLE_STYLE[payload.type || 'dialogue'] ?? AI_BUBBLE_STYLE.dialogue;
        bubbleText.textContent = payload.dialogue;
        bubbleRow.hidden = true;
        appendLog(name, payload.dialogue, false);
        paintStageBits(payload);
        syncPortraitEmotion(characterId, payload.emotion_pose, payload.emotion, 'commit');
      },
    };
  };

  const reactToAsrText = (characterId: string, text: string, isFinal: boolean) => {
    const hint = isFinal
      ? inferAsrEmotionHint(characterId, text) || listeningEmotionHint(characterId)
      : inferAsrEmotionHint(characterId, text);
    if (!hint) return;
    syncPortraitEmotion(characterId, hint.pose, hint.emotion, isFinal ? 'preview' : 'sticky');
    if (isFinal && (hint.valenceDelta || hint.arousalDelta)) {
      try {
        saveManager.mutate((d) => {
          if (!d.aiLiving) return;
          applyMoodImpulse(d.aiLiving as ReturnType<typeof getAiLiving>, characterId, {
            kind: 'asr_hint',
            valenceDelta: hint.valenceDelta,
            arousalDelta: hint.arousalDelta,
          });
        });
      } catch {
        /* ignore */
      }
    }
  };

  const close = () => {
    clearEndTimers();
    clearProactive();
    stopOutfitHint();
    window.clearInterval(anfuBreathTimer);
    window.clearInterval(danceTickTimer);
    exitDanceBgm();
    dialogueEnded = true;
    voiceChatActive = false;
    clearDialogueVoiceSession();
    closeDialogueItemPicker(overlay);
    unmountMiniGamePanel(overlay);
    const focusCid = activeId();
    saveManager.mutate((d) => {
      const living = getAiLiving();
      releasePendingItemOffer(d, living, { silent: true });
      settleActiveDisciplineSession(d, living, '关闭对话页');
      // 安抚室关页 = 离开安抚室（按 phase 分流：待机中性 / 安抚中扣好感 / 疲惫结算）
      const anfuOn = living.anfuSession?.active === true;
      if (anfuOn) {
        const r = leaveAnfuSessionDirect(d, living, { reason: 'close', force: true });
        if (r.systemLine) living.anfuUiFlash = r.systemLine;
      }
      d.aiLiving = living;
    });
    // 小游戏关页 = 中途退出（判负 + 扣好感，用户定稿规则）
    quitMiniGameNow('关闭对话页');
    // 玩家离开＝没人陪：刚被叫醒且仍困的话，她会窝回去睡
    settleSleepOnDialogueClose(getFocusId?.() ?? initialCharacterId);
    // 关页：彻底停止喘息声 + 安抚 BGM（重进从 1 级重开；BGM 交回营地/主曲）
    stopAnfuBreathAudio();
    exitAnfuBgm();
    syncCharacterSkinRuntime(saveManager.get());
    playUiSound('cancel');
    stopSpeechInput();
    stopVoicePlayback();
    unsubVoice();
    overlay.querySelectorAll('video').forEach((v) => {
      v.pause();
      v.removeAttribute('src');
      v.load();
    });
    releaseDialogueSceneSession([getFocusId?.() ?? initialCharacterId]);
    if (overlay.dataset.festiveBgm === '1') {
      exitFestiveCampDialogueBgm();
      notifyBgmStateChanged();
    }
    overlay.remove();
    opts.onClose?.();
  };

  /** AI 主动结束：倒计时提示，期间禁输入，到点关窗 */
  const beginEndCountdown = (charName: string, endHint: string) => {
    clearEndTimers();
    clearProactive();
    stopOutfitHint();
    dialogueEnded = true;
    voiceChatActive = false;
    clearDialogueVoiceSession();
    input.disabled = true;
    sendBtn.disabled = true;
    if (micBtn) micBtn.disabled = true;
    if (itemsBtn) itemsBtn.disabled = true;
    stopSpeechInput();
    overlay.classList.add('is-ended');
    chip.classList.add('is-ended');
    const form = overlay.querySelector<HTMLElement>('[data-ai-form]');
    form?.classList.add('is-ended');

    let left = 3;
    const reason = endHint.trim() || '已经不想继续聊了';
    const paint = () => {
      chip.textContent = `${charName}已离开 · ${reason} · ${left} 秒后关闭`;
      let banner = logEl.querySelector<HTMLElement>('.ai-immersive-end-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'ai-immersive-line is-end ai-immersive-end-banner';
        banner.innerHTML = `<span class="ai-immersive-end-chip"></span>`;
        logEl.appendChild(banner);
      }
      const chipEl = banner.querySelector('.ai-immersive-end-chip') ?? banner;
      chipEl.textContent = `${charName}已离开 / 不想继续聊天 · 窗口将在 ${left} 秒后关闭（暂不可发言）`;
      logEl.scrollTop = logEl.scrollHeight;
    };
    paint();
    endCountdownTimer = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearEndTimers();
        close();
        return;
      }
      paint();
    }, 1000);
  };

  overlay.querySelector('[data-ai-close]')?.addEventListener('click', close);

  /**
   * 角色表达模式开关（右上角）：语音模式 = 无论怎么输入都用语音回复（默认）；
   * 文本模式 = 一律纯文字。切换即时生效并持久化（localStorage）。
   */
  const voiceModeBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-voice-mode]');
  const paintVoiceModeBtn = () => {
    if (!voiceModeBtn) return;
    const voice = getVoiceExpressionMode() === 'voice';
    voiceModeBtn.textContent = voice ? '🔊' : '💬';
    voiceModeBtn.classList.toggle('is-text-mode', !voice);
    voiceModeBtn.title = voice
      ? '表达模式：语音（她所有回复都出声）。点击切换为纯文字。'
      : '表达模式：文字（她所有回复都纯文字）。点击切换为语音。';
  };
  paintVoiceModeBtn();
  voiceModeBtn?.addEventListener('click', () => {
    const next = getVoiceExpressionMode() === 'voice' ? 'text' : 'voice';
    setVoiceExpressionMode(next);
    // 切到文字：立刻停掉正在播的语音；切到语音：下一轮起出声
    if (next === 'text') stopVoicePlayback();
    voiceChatActive = next === 'voice';
    paintVoiceModeBtn();
    playUiSound('tap');
    appendLog('系统', next === 'voice' ? '表达模式：语音（她的回复都会说出来）' : '表达模式：文字（她的回复只用文字）');
  });

  const unlockInput = () => {
    if (!document.body.contains(overlay)) return;
    if (overlay.querySelector<HTMLInputElement>('[name="msg"]')?.disabled) return;
    sendBtn.disabled = false;
    if (micBtn) micBtn.disabled = false;
    if (itemsBtn) {
      itemsBtn.disabled = isDisciplineActiveFor(getAiLiving(), activeId());
    }
    syncDisciplineChrome(overlay, activeId());
  };

  const paintResult = (
    result: LlmDialogueResult,
    characterId: string,
    name: string,
    turnCommitted: boolean,
  ) => {
    bubbleBg.src = AI_BUBBLE_STYLE[result.type || 'dialogue'] ?? AI_BUBBLE_STYLE.dialogue;
    bubbleRow.hidden = true;
    if (!turnCommitted) {
      bubbleText.textContent = result.dialogue;
      appendLog(name, result.dialogue, false);
    } else if (result.dialogue) {
      updateLastAssistantLog(name, result.dialogue);
    }
    paintStageBits(result);

    // 每轮对话后强制刷新场景背景+顶栏+皮肤立绘（与 AI 世界同步同拍）
    refreshDialogueVisualContext(overlay, characterId);
    // 安抚片段必须由会话状态唯一驱动（refresh 会复位可见性，keep 逻辑负责恢复；
    // 这里再兜一次，保证「刷新后仍停在攻击选中的那一段」而不是回第一段）
    syncAnfuPortraitFromSession(overlay, characterId);
    updateOutfitHint(characterId);
    // 安抚进行中：安抚片段由会话状态驱动；情绪表情仍要出（两套逻辑分开），
    // 只在安抚片段层上方短暂叠表情图，不做整层替换（避免打断片段播放）。
    const anfuLive = isAnfuPortraitLocked(characterId);
    syncPortraitEmotion(characterId, result.emotion_pose, result.emotion, 'commit');
    if (!anfuLive) {
      const clipRaw = result.skin_clip;
      const clip =
        typeof clipRaw === 'number'
          ? clipRaw
          : typeof clipRaw === 'string' && clipRaw.trim()
            ? Number(clipRaw.trim())
            : NaN;
      if (Number.isFinite(clip) && clip >= 1) {
        const livingNow = getAiLiving();
        // 事件姿势由 UI 粘住驱动，忽略 AI skin_clip 以免打断
        if (!isDisciplineActiveFor(livingNow, characterId)) {
          const stage = findDialoguePortraitStage(overlay, characterId);
          if (stage) void playDialogueSkinClip(stage, clip);
        }
      }
    }

    const living = getAiLiving();
    const p = resolvePresence(characterId, living);
    if (!overlay.dataset.coScreen) {
      chip.textContent = `${name} · ${p.label} · 好感 ${peekAffinity(characterId)}（${describeAffinity(peekAffinity(characterId))}）`;
    } else {
      chip.textContent = `${chip.textContent?.split('·')[0] ?? ''}· ${name} · 好感 ${peekAffinity(characterId)}`;
    }

    const delta = result.affection_change ?? 0;
    if (delta > 2) spawnParticles(particles, 'star', 5);
    else if (delta > 0) spawnParticles(particles, 'heart', 3);
    else if (delta < 0) spawnParticles(particles, 'sweat', 2);

    syncDisciplineChrome(overlay, characterId);
    syncDanceChrome(overlay, characterId);
    syncAnfuChrome(overlay, characterId);
    syncMiniGameChrome(overlay, characterId);

    // 安抚/舞蹈系统事实（愿意去/婉拒/必须点按钮离开等）必须落在聊天面板上
    const anfuFlash = takeAnfuUiFlash();
    if (anfuFlash) appendLog('系统', anfuFlash);
    const danceFlash = takeDanceUiFlash();
    if (danceFlash) appendLog('系统', danceFlash);
    const mgFlash = takeMiniGameUiFlash();
    if (mgFlash) appendLog('系统', mgFlash);
  };

  const scheduleOutfitRevealIfNeeded = (characterId: string): boolean => {
    const wait = remainingOutfitChangeMs(getAiLiving(), characterId);
    if (wait <= 0) return false;
    if (proactiveTimer != null) {
      window.clearTimeout(proactiveTimer);
      proactiveTimer = null;
    }
    consecutiveProactive = 0;
    proactiveTimer = window.setTimeout(() => {
      void runCharacterSpeak('outfit_reveal', OUTFIT_REVEAL_MOTIVE);
    }, Math.max(900, wait + 350));
    return true;
  };

  const blocksProactiveSpeak = (characterId: string): boolean =>
    proactiveContactBlockReason(getAiLiving(), characterId) != null;

  const scheduleProactive = (mode: 'idle' | 'continue' = 'idle') => {
    if (dialogueEnded || !document.body.contains(overlay) || overlay.classList.contains('is-ended')) {
      return;
    }
    if (overlay.dataset.disciplineBusy === '1') return;
    const characterId = activeId();
    if (blocksProactiveSpeak(characterId)) return;
    const pending = getAiLiving().pendingItemOffer;
    if (pending?.toCharacterId === characterId) {
      if (proactiveTimer != null) window.clearTimeout(proactiveTimer);
      proactiveTimer = window.setTimeout(() => scheduleProactive(mode), 2500);
      return;
    }
    if (proactiveTimer != null) {
      window.clearTimeout(proactiveTimer);
      proactiveTimer = null;
    }
    const plan = planProactiveSpeak(getAiLiving(), characterId);
    if (mode === 'idle' && !plan.allow) {
      // 性格/环境不想开口：拉长再试一次机会
      proactiveTimer = window.setTimeout(() => scheduleProactive('idle'), plan.idleDelayMs + 10_000);
      return;
    }
    const typingBoost = Date.now() - lastPlayerTypedAt < 2800 ? 4500 : 0;
    const delay =
      (mode === 'continue' ? plan.continueDelayMs : plan.idleDelayMs) + typingBoost;
    proactiveTimer = window.setTimeout(() => {
      void runCharacterSpeak(mode === 'continue' ? 'continue' : 'proactive', plan.motive);
    }, delay);
  };

  const runCharacterSpeak = async (
    turnMode: 'proactive' | 'continue' | 'outfit_reveal',
    motive: string,
  ) => {
    if (sending || dialogueEnded || !document.body.contains(overlay)) return;
    if (overlay.classList.contains('is-ended')) return;
    if (overlay.dataset.disciplineBusy === '1') return;
    if (
      (turnMode === 'proactive' || turnMode === 'continue') &&
      blocksProactiveSpeak(activeId())
    ) {
      return;
    }
    if (input.value.trim()) {
      // 指挥官正在打字：稍后再探，避免抢话
      scheduleProactive('idle');
      return;
    }
    if (consecutiveProactive >= MAX_PROACTIVE_STREAK) {
      consecutiveProactive = 0;
      scheduleProactive('idle');
      return;
    }

    const epoch = speakEpoch;
    const turnState = { committed: false };
    sending = true;
    sendBtn.disabled = true;
    if (micBtn) micBtn.disabled = true;
    if (itemsBtn) itemsBtn.disabled = true;
    const characterId = activeId();
    const name = activeName();
    bubbleRow.hidden = false;
    bubbleText.textContent = '……';
    proactiveAbort = new AbortController();
    const signal = proactiveAbort.signal;
    try {
      const result = await talkToCharacter(
        characterId,
        motive,
        buildDialogueTalkOpts(epoch, turnMode, turnState, signal),
      );
      if (!document.body.contains(overlay) || dialogueEnded || epoch !== speakEpoch) return;
      paintResult(result, characterId, name, turnState.committed);
      consecutiveProactive += 1;

      // 语音会话：先播完本句，再决定续聊，避免下一句文本抢跑
      await speakSynced(result, characterId);
      if (!document.body.contains(overlay) || dialogueEnded || epoch !== speakEpoch) return;

      if (result.end_conversation && !isDisciplineActiveFor(getAiLiving(), characterId)) {
        const endHint = result.end_reason?.trim() || '已经不想继续聊了';
        beginEndCountdown(name, endHint);
        return;
      }

      if (scheduleOutfitRevealIfNeeded(characterId)) return;

      const plan = planProactiveSpeak(getAiLiving(), characterId);
      // 与千问一致：续说/冷场插话由模型 want_continue + 性格计划决定（本地模型自主性优先）
      const keepGoing =
        result.want_continue === true ||
        (turnMode !== 'outfit_reveal' && Math.random() < plan.continueChance * 0.85);
      if (keepGoing && consecutiveProactive < MAX_PROACTIVE_STREAK) {
        scheduleProactive('continue');
      } else {
        consecutiveProactive = 0;
        scheduleProactive('idle');
      }
    } catch (err) {
      if (epoch !== speakEpoch) return;
      const failure = describeLlmFailure(err);
      console.warn('[dialogue] speak failed:', err);
      bubbleText.textContent = failure.text;
      appendSystemNote(failure.text);
      if (failure.network) {
        // 断网时不要按性格节奏每几秒重试一次（只会继续刷错误行）：等冷却结束再探
        if (proactiveTimer != null) window.clearTimeout(proactiveTimer);
        proactiveTimer = window.setTimeout(() => scheduleProactive('idle'), 30_000);
      } else {
        scheduleProactive('idle');
      }
    } finally {
      if (epoch === speakEpoch) sending = false;
      proactiveAbort = null;
      unlockInput();
      if (document.body.contains(overlay) && !overlay.classList.contains('is-ended') && epoch === speakEpoch) {
        input.focus();
      }
    }
  };

  /** wantSpeak：仅语音输入为 true（与 cyber 交互一致） */
  const sendOffer = async (propId: string) => {
    if (sending || dialogueEnded) return;
    const characterId = activeId();
    const prop = getCampProp(propId);
    if (!prop) return;
    let msg = '';
    saveManager.mutate((d) => {
      const living = getAiLiving();
      const r = offerItemFromWarehouse(d, living, propId, characterId);
      if (r.ok) {
        msg = buildItemOfferPlayerMessage(
          prop,
          characterId,
          living.pendingItemOffer?.intent ?? 'show',
        );
      } else {
        msg = r.msg;
      }
      d.aiLiving = living;
    });
    if (!msg.startsWith('（')) {
      appendLog('系统', msg);
      playUiSound('cancel');
      return;
    }
    showDialogueItemOfferFx(overlay, propId);
    await send(msg, false);
  };

  const send = async (msg: string, wantSpeak = false) => {
    const text = msg.trim();
    if (!text || sending) return;
    if (overlay.dataset.disciplineBusy === '1') return;
    clearProactive();
    consecutiveProactive = 0;
    stopVoicePlayback();
    // 表达模式（右上角开关，默认语音）：语音模式一律 TTS 回复（无论输入方式）；
    // 文本模式一律纯文字。wantSpeak（语音输入）不再决定回复形式。
    voiceChatActive = getVoiceExpressionMode() === 'voice';
    if (voiceChatActive) {
      // 新一轮语音会话：清掉上一局路径锁，本局内再锁定
      clearDialogueVoiceSession(activeId());
    }
    const epoch = speakEpoch;
    const turnState = { committed: false };
    sending = true;
    stopSpeechInput();
    setMicUi(false);
    unlockAudioPlayback();
    const characterId = activeId();
    const name = activeName();
    playUiSound('tap');
    appendLog('你', text, true);
    input.value = '';
    sendBtn.disabled = true;
    if (micBtn) micBtn.disabled = true;
    if (itemsBtn) itemsBtn.disabled = true;
    bubbleRow.hidden = false;
    bubbleText.textContent = '……';
    // 看门狗：请求链任何一环（LLM 请求 / 语音合成）无限挂起时，
    // 必须在有界时间内释放 sending 锁并给出可见反馈，
    // 否则气泡会永远停在「……」、后续所有消息被静默吞掉。
    let watchdogTimer: number | undefined;
    const watchdog = new Promise<void>((resolve) => {
      watchdogTimer = window.setTimeout(resolve, 150_000);
    });
    const turnDone = { done: false };
    const runTurn = async () => {
      try {
        const result = await talkToCharacter(
          characterId,
          text,
          buildDialogueTalkOpts(epoch, 'reply', turnState),
        );
        if (!document.body.contains(overlay) || dialogueEnded || epoch !== speakEpoch) return;
        paintResult(result, characterId, name, turnState.committed);

        // 等本句语音合成并播完，再调度续聊/主动开口（避免文本领先语音 4–6 秒）
        await speakSynced(result, characterId);
        if (!document.body.contains(overlay) || dialogueEnded || epoch !== speakEpoch) return;

        if (result.end_conversation && !isDisciplineActiveFor(getAiLiving(), characterId)) {
          const endHint = result.end_reason?.trim() || '已经不想继续聊了';
          beginEndCountdown(name, endHint);
          return;
        }

        if (scheduleOutfitRevealIfNeeded(characterId)) return;

        if (result.want_continue) {
          scheduleProactive('continue');
        } else {
          scheduleProactive('idle');
        }
      } finally {
        turnDone.done = true;
      }
    };
    const turnPromise = runTurn();
    turnPromise.catch(() => undefined); // 看门狗先触发时，避免迟到的拒绝成为未处理异常
    try {
      await Promise.race([turnPromise, watchdog]);
      if (!turnDone.done) {
        // 看门狗触发：作废本轮并恢复输入，让玩家能立刻重发
        bumpSpeakEpoch();
        sending = false;
        sendBtn.disabled = false;
        if (micBtn) micBtn.disabled = false;
        if (itemsBtn) itemsBtn.disabled = false;
        bubbleText.textContent = '这一句等太久没有回应（请求卡住了），已自动重置——请再发一次。';
        appendSystemNote('对话看门狗：本轮请求超时，已重置发送状态。');
        return;
      }
    } catch (err) {
      if (epoch !== speakEpoch) return;
      const failure = describeLlmFailure(err);
      bubbleText.textContent = failure.text;
      appendSystemNote(failure.text);
      if (failure.network) {
        if (proactiveTimer != null) window.clearTimeout(proactiveTimer);
        proactiveTimer = window.setTimeout(() => scheduleProactive('idle'), 30_000);
      } else {
        scheduleProactive('idle');
      }
    } finally {
      if (watchdogTimer != null) window.clearTimeout(watchdogTimer);
      if (epoch === speakEpoch) sending = false;
      if (!document.body.contains(overlay)) return;
      if (overlay.querySelector<HTMLInputElement>('[name="msg"]')?.disabled) return;
      if (epoch !== speakEpoch) return;
      sendBtn.disabled = false;
      if (micBtn) micBtn.disabled = false;
      if (itemsBtn) {
        itemsBtn.disabled = isDisciplineActiveFor(getAiLiving(), activeId());
      }
      syncDisciplineChrome(overlay, activeId());
      input.focus();
    }
  };

  // 中文输入法：组词期间的 Enter 是「选字确认」，不能当成发送，
  // 否则会把还没定稿的半句抢先发出去（表现为「文字换了/没打完就发了」）。
  let composing = false;
  input.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    lastPlayerTypedAt = Date.now();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (composing || e.isComposing || e.keyCode === 229) e.preventDefault();
  });

  input.addEventListener('input', () => {
    lastPlayerTypedAt = Date.now();
  });

  overlay.querySelector<HTMLFormElement>('[data-ai-form]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (composing) return;
    unlockAudioPlayback();
    void send(input.value, false);
  });

  itemsBtn?.addEventListener('click', () => {
    if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
    unlockAudioPlayback();
    playUiSound('tap');
    if (overlay.querySelector('[data-ai-item-picker]')) {
      closeDialogueItemPicker(overlay);
      return;
    }
    showDialogueItemPicker({
      overlay,
      characterId: activeId(),
      initialTab: opts.itemPickerTab,
      onOffer: (propId) => {
        void sendOffer(propId);
      },
    });
  });

  const disciplineBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-discipline]');
  disciplineBtn?.addEventListener('click', () => {
    if (dialogueEnded || overlay.classList.contains('is-ended')) return;
    if (overlay.dataset.disciplineBusy === '1') return;
    if (overlay.dataset.coScreen === 'true') return;
    unlockAudioPlayback();
    playUiSound('tap');
    const characterId = activeId();
    const livingNow = getAiLiving();
    const active = isDisciplineActiveFor(livingNow, characterId);

    if (active) {
      void (async () => {
        bumpSpeakEpoch();
        sending = false;
        overlay.dataset.disciplineBusy = '1';
        syncDisciplineChrome(overlay, characterId);
        // 清掉上一句事件态 action
        actionEl.hidden = true;
        actionEl.textContent = '';
        appendLog('系统', '正在收尾…');
        let settleValence: 'tragic' | 'mixed' | 'joyful' | undefined;
        let oneLine: string | undefined;
        try {
          const settled = await requestDisciplineSettleValence(getAiLiving(), characterId);
          if (settled) {
            settleValence = settled.valence;
            oneLine = settled.one_line_memory;
          }
        } catch {
          /* 回落 hints */
        }
        // 结算期间若仍卡在 active+settling，强制完成离开
        await runDisciplineBlackout(overlay, () => {
          let systemLine = '';
          saveManager.mutate((d) => {
            const living = getAiLiving();
            if (living.disciplineSession?.settling) {
              living.disciplineSession.settling = false;
            }
            const r = leaveDisciplineSession(d, living, {
              reason: '玩家离开',
              valence: settleValence,
              oneLineMemory: oneLine,
              force: true,
            });
            systemLine = r.systemLine ?? r.msg;
            d.aiLiving = living;
          });
          syncCharacterSkinRuntime(saveManager.get());
          refreshDialogueVisualContext(overlay, characterId);
          if (systemLine) appendLog('系统', systemLine);
        });
        delete overlay.dataset.disciplineBusy;
        syncDisciplineChrome(overlay, characterId);
        unlockInput();
        if (!document.body.contains(overlay) || dialogueEnded) return;
        // 与进房对称：立刻发「已离开」反应轮，同步 AI
        clearProactive();
        consecutiveProactive = 0;
        void runCharacterSpeak('proactive', DISCIPLINE_LEAVE_REACT_MOTIVE);
      })();
      return;
    }

    // 若玩家刚在对话里威胁过，记为威胁兑现
    const recentUser = [...logEl.querySelectorAll('.ai-immersive-line.is-self .ai-immersive-msg')]
      .map((el) => el.textContent || '')
      .slice(-3)
      .join('\n');
    const entrySource: DisciplineEntrySource = detectDisciplineThreat(recentUser)
      ? 'threat_fulfilled'
      : 'player_button';

    void runDisciplineBlackout(overlay, () => {
      let systemLine = '';
      saveManager.mutate((d) => {
        const living = getAiLiving();
        releasePendingItemOffer(d, living, { silent: true });
        const r = enterDisciplineSession(d, living, characterId, entrySource);
        systemLine = r.systemLine ?? r.msg;
        d.aiLiving = living;
      });
      syncCharacterSkinRuntime(saveManager.get());
      refreshDialogueVisualContext(overlay, characterId);
      if (systemLine) appendLog('系统', systemLine);
    }).then(() => {
      syncDisciplineChrome(overlay, characterId);
      if (!document.body.contains(overlay) || dialogueEnded) return;
      clearProactive();
      consecutiveProactive = 0;
      void runCharacterSpeak('proactive', DISCIPLINE_ENTER_REACT_MOTIVE);
    });
  });

  // 姿势切换 / 默认态 / 邀请确认（事件委托，条带由 syncDisciplineChrome 重建）
  overlay.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement | null;
    if (!t) return;

    const idleBtn = t.closest<HTMLButtonElement>('[data-ai-discipline-idle]');
    if (idleBtn) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      if (overlay.dataset.disciplineBusy === '1') return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      let playerMessage = '';
      saveManager.mutate((d) => {
        const living = getAiLiving();
        const r = applyDisciplineIdleReset(living, characterId);
        if (!r.ok) {
          appendLog('系统', r.msg);
        } else {
          playerMessage = r.playerMessage ?? '';
        }
        d.aiLiving = living;
      });
      syncDisciplineChrome(overlay, characterId);
      if (!playerMessage) return;
      const stage = findDialoguePortraitStage(overlay, characterId);
      if (stage) void setDialogueDisciplinePose(stage, null);
      void send(playerMessage, false);
      return;
    }

    const poseBtn = t.closest<HTMLButtonElement>('[data-ai-discipline-pose]');
    if (poseBtn) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      if (overlay.dataset.disciplineBusy === '1') return;
      const n = Number(poseBtn.dataset.aiDisciplinePose);
      if (!Number.isFinite(n) || n < 1) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      let playerMessage = '';
      saveManager.mutate((d) => {
        const living = getAiLiving();
        const r = applyDisciplinePoseSwitch(living, characterId, n);
        if (!r.ok) {
          appendLog('系统', r.msg);
        } else {
          playerMessage = r.playerMessage ?? '';
        }
        d.aiLiving = living;
      });
      syncDisciplineChrome(overlay, characterId);
      if (!playerMessage) return;
      const stage = findDialoguePortraitStage(overlay, characterId);
      if (stage) void setDialogueDisciplinePose(stage, n);
      void send(playerMessage, false);
      return;
    }

    // 舞蹈：主按钮——事件进行中时就是菜单开关（菜单里是「开始舞蹈/停下/结束」）
    const danceBtn = t.closest<HTMLButtonElement>('[data-ai-dance]');
    if (danceBtn) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const st = observeDanceStateForUi(characterId);
      const menu = overlay.querySelector<HTMLElement>('[data-ai-dance-menu]');
      if (menu) {
        if (st.active) menu.hidden = false;
        else menu.hidden = !menu.hidden;
      }
      syncDanceChrome(overlay, characterId);
      return;
    }

    // 舞蹈事件内：开始 / 停止（回待机）/ 结束（换装离场）
    const danceStart = t.closest<HTMLButtonElement>('[data-ai-dance-start]');
    const danceAlt = t.closest<HTMLButtonElement>('[data-ai-dance-alt]');
    if (danceStart || danceAlt) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const modeRaw = (danceStart?.dataset.aiDanceStart ?? danceAlt?.dataset.aiDanceAlt ?? 'solo') as 'solo' | 'co';
      const mode: 'solo' | 'co' = modeRaw === 'co' ? 'co' : 'solo';
      const handled = requestPlayerDance(characterId, mode);
      if (handled) {
        syncCharacterSkinRuntime(saveManager.get());
        refreshDialogueVisualContext(overlay, characterId);
        const flash = takeDanceUiFlash();
        if (flash) appendLog('系统', flash);
        syncDanceChrome(overlay, characterId);
        syncAnfuChrome(overlay, characterId);
        syncDisciplineChrome(overlay, characterId);
        ensureDanceLoop(overlay, characterId);
      }
      return;
    }
    if (t.closest('[data-ai-dance-stop]')) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const line = stopDanceNow();
      syncCharacterSkinRuntime(saveManager.get());
      refreshDialogueVisualContext(overlay, characterId);
      if (line) appendLog('系统', line);
      syncDanceChrome(overlay, characterId);
      ensureDanceLoop(overlay, characterId);
      return;
    }
    if (t.closest('[data-ai-dance-end]')) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const line = endDanceNow();
      syncCharacterSkinRuntime(saveManager.get());
      refreshDialogueVisualContext(overlay, characterId);
      if (line) appendLog('系统', line);
      syncDanceChrome(overlay, characterId);
      ensureDanceLoop(overlay, characterId);
      return;
    }

    // 舞蹈子按钮：发出邀请文本，角色自行判断（与打字/语音等效）
    const danceCo = t.closest<HTMLButtonElement>('[data-ai-dance-co]');
    const danceSolo = t.closest<HTMLButtonElement>('[data-ai-dance-solo]');
    if (danceCo || danceSolo) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const mode: 'solo' | 'co' = danceCo ? 'co' : 'solo';
      const menu = overlay.querySelector<HTMLElement>('[data-ai-dance-menu]');
      if (menu) menu.hidden = true;
      // 舞蹈事件已在进行（待机/演出中）→ 直接起舞，不再走一轮对话
      const handled = requestPlayerDance(characterId, mode);
      if (handled) {
        syncCharacterSkinRuntime(saveManager.get());
        refreshDialogueVisualContext(overlay, characterId);
        const flash = takeDanceUiFlash();
        if (flash) appendLog('系统', flash);
        syncDanceChrome(overlay, characterId);
        syncAnfuChrome(overlay, characterId);
        syncDisciplineChrome(overlay, characterId);
        ensureDanceLoop(overlay, characterId);
        return;
      }
      const name = CHARACTER_MAP[characterId]?.name ?? characterId;
      const text =
        mode === 'co'
          ? `走，${name}，一起去大厅跳支舞吧？`
          : `${name}，我想看你跳舞，给我跳一段嘛。`;
      void send(text, false);
      return;
    }

    if (t.closest('[data-ai-dance-invite-yes]')) {
      if (dialogueEnded) return;
      if (sending) {
        appendLog('系统', '【系统】这句话说完再去大厅，别急。');
        return;
      }
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const menu = overlay.querySelector<HTMLElement>('[data-ai-dance-menu]');
      if (menu) menu.hidden = true;
      // 黑屏换景：通知 + 切大厅 + 换舞装（不再额外发一轮对话，避免换装被打乱）
      void runDisciplineBlackout(overlay, () => {
        const ok = acceptPendingDanceInviteNow();
        const flash = takeDanceUiFlash();
        syncCharacterSkinRuntime(saveManager.get());
        if (flash) appendLog('系统', flash);
        else if (ok) appendLog('系统', '答应了舞蹈邀请：已到大厅换舞装，换好就能起舞。');
      }).then(() => {
        refreshDialogueVisualContext(overlay, characterId);
        syncDanceChrome(overlay, characterId);
        syncAnfuChrome(overlay, characterId);
        syncDisciplineChrome(overlay, characterId);
        ensureDanceLoop(overlay, characterId);
      });
      return;
    }
    if (t.closest('[data-ai-dance-invite-no]')) {
      if (sending || dialogueEnded) return;
      unlockAudioPlayback();
      playUiSound('tap');
      rejectPendingDanceInviteNow();
      syncDanceChrome(overlay, activeId());
      appendLog('系统', '婉拒了舞蹈邀请。');
      return;
    }

    // 小游戏：主按钮——菜单开关（对局进行中时菜单不用，交互在浮层面板）
    const mgBtn = t.closest<HTMLButtonElement>('[data-ai-minigame]');
    if (mgBtn) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const menu = overlay.querySelector<HTMLElement>('[data-ai-minigame-menu]');
      if (menu) menu.hidden = !menu.hidden;
      syncMiniGameChrome(overlay, characterId);
      return;
    }

    // 小游戏子按钮：登记邀请 + 发一条玩家消息（与打字/语音等效，角色可自行拒绝）
    const mgKindBtn = t.closest<HTMLButtonElement>('[data-ai-minigame-kind]');
    if (mgKindBtn) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const kind = mgKindBtn.dataset.aiMinigameKind === 'rps' ? 'rps' : 'gomoku';
      const menu = overlay.querySelector<HTMLElement>('[data-ai-minigame-menu]');
      if (menu) menu.hidden = true;
      const inGame = requestPlayerMiniGame(characterId, kind);
      syncMiniGameChrome(overlay, characterId);
      if (inGame) return; // 已在对局中：浮层面板直接交互，不再发对话
      const name = CHARACTER_MAP[characterId]?.name ?? characterId;
      const text = kind === 'gomoku' ? `${name}，来盘五子棋吧？` : `${name}，猜拳吗？石头剪刀布！`;
      void send(text, false);
      return;
    }

    if (t.closest('[data-ai-minigame-invite-yes]')) {
      if (sending || dialogueEnded) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const ok = acceptPendingMiniGameInviteNow();
      const flash = takeMiniGameUiFlash();
      if (flash) appendLog('系统', flash);
      else if (ok) appendLog('系统', '答应了小游戏邀请，对局开始。');
      syncMiniGameChrome(overlay, characterId);
      syncDanceChrome(overlay, characterId);
      syncAnfuChrome(overlay, characterId);
      syncDisciplineChrome(overlay, characterId);
      return;
    }
    if (t.closest('[data-ai-minigame-invite-no]')) {
      if (sending || dialogueEnded) return;
      unlockAudioPlayback();
      playUiSound('tap');
      rejectPendingMiniGameInviteNow();
      syncMiniGameChrome(overlay, activeId());
      appendLog('系统', '婉拒了小游戏邀请。');
      return;
    }

    // 洗浴：主按钮 → 打开两个选项的菜单
    const bathBtn = t.closest<HTMLButtonElement>('[data-ai-bath]');
    if (bathBtn) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const st = observeBathStateForUi(characterId);
      const menu = overlay.querySelector<HTMLElement>('[data-ai-bath-menu]');
      if (menu) {
        if (st.active) menu.hidden = false;
        else menu.hidden = !menu.hidden;
      }
      syncBathChrome(overlay, characterId);
      return;
    }

    // 洗浴子按钮：帮我（指挥官冲澡） / 一同泡澡
    const bathHelp = t.closest<HTMLButtonElement>('[data-ai-bath-help]');
    const bathCo = t.closest<HTMLButtonElement>('[data-ai-bath-co]');
    if (bathHelp || bathCo) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const mode: 'help_wash' | 'co_bath' = bathHelp ? 'help_wash' : 'co_bath';
      const menu = overlay.querySelector<HTMLElement>('[data-ai-bath-menu]');
      if (menu) menu.hidden = true;
      // 已在浴室互动中 → 直接切换模式，不再走一轮对话
      const handled = requestPlayerBathAssist(characterId, mode);
      if (handled) {
        syncCharacterSkinRuntime(saveManager.get());
        refreshDialogueVisualContext(overlay, characterId);
        const flash = takeBathAssistUiFlash();
        if (flash) appendLog('系统', flash);
        syncBathChrome(overlay, characterId);
        return;
      }
      // 尚未开始：把请求发进聊天（与打字/语音等效），角色答复后再出确认条
      const name = CHARACTER_MAP[characterId]?.name ?? characterId;
      const text =
        mode === 'help_wash'
          ? `${name}，帮我清洗一下吧。`
          : `${name}，我们一同泡澡吧。`;
      void send(text, false);
      return;
    }

    if (t.closest('[data-ai-bath-invite-yes]')) {
      if (dialogueEnded) return;
      if (sending) {
        appendLog('系统', '【系统】这句话说完再去浴室，别急。');
        return;
      }
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const menu = overlay.querySelector<HTMLElement>('[data-ai-bath-menu]');
      if (menu) menu.hidden = true;
      const ok = acceptPendingBathAssistInviteNow();
      const flash = takeBathAssistUiFlash();
      syncCharacterSkinRuntime(saveManager.get());
      refreshDialogueVisualContext(overlay, characterId);
      if (flash) appendLog('系统', flash);
      else if (ok) appendLog('系统', '答应了浴室邀请：正在换洗浴外覆，稍等就到浴室。');
      syncBathChrome(overlay, characterId);
      return;
    }
    if (t.closest('[data-ai-bath-invite-no]')) {
      if (sending || dialogueEnded) return;
      unlockAudioPlayback();
      playUiSound('tap');
      rejectPendingBathAssistInviteNow();
      syncBathChrome(overlay, activeId());
      appendLog('系统', '婉拒了浴室邀请。');
      return;
    }

    // 安抚：主按钮 → 直接发出邀请文本（角色自行判断，与打字/语音等效）
    const anfuBtn = t.closest<HTMLButtonElement>('[data-ai-anfu]');
    if (anfuBtn) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      requestPlayerAnfu(characterId);
      const name = CHARACTER_MAP[characterId]?.name ?? characterId;
      void send(`${name}，要不要去安抚室玩棉花游戏？我发射棉花，你负责舒服。`, false);
      return;
    }

    // 安抚邀请确认（角色主动邀请 → 黑屏切安抚室换装）
    if (t.closest('[data-ai-anfu-invite-yes]')) {
      if (dialogueEnded) return;
      if (sending) {
        appendLog('系统', '【系统】这句话说完再确认安抚室，别急。');
        return;
      }
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      void runDisciplineBlackout(overlay, () => {
        let systemLine = '';
        saveManager.mutate((d) => {
          const living = getAiLiving();
          releasePendingItemOffer(d, living, { silent: true });
          const r = acceptAnfuInvite(d, living);
          systemLine = r.systemLine ?? r.msg;
          d.aiLiving = living;
        });
        syncCharacterSkinRuntime(saveManager.get());
        refreshDialogueVisualContext(overlay, characterId);
        if (systemLine) appendLog('系统', systemLine);
      }).then(() => {
        syncAnfuChrome(overlay, characterId);
        if (!document.body.contains(overlay) || dialogueEnded) return;
        clearProactive();
        consecutiveProactive = 0;
        void send(
          `【系统事实·已确认·正在换装】她在自己房间换动物服装（换装中动态），还没到安抚室；换好会走过去。`,
          false,
        );
      });
      return;
    }
    if (t.closest('[data-ai-anfu-invite-no]')) {
      if (sending || dialogueEnded) return;
      unlockAudioPlayback();
      playUiSound('tap');
      rejectPendingAnfuInviteNow();
      syncAnfuChrome(overlay, activeId());
      appendLog('系统', '婉拒了安抚邀请。');
      return;
    }

    // 棉花攻击：切片段 + 发攻击气泡（数值等模型回 anfu_gain 后落盘）
    const anfuAttack = t.closest<HTMLButtonElement>('[data-ai-anfu-attack]');
    if (anfuAttack) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const r = requestAnfuAttackNow(characterId);
      if (!r.ok) {
        appendLog('系统', r.msg);
        syncAnfuChrome(overlay, characterId);
        return;
      }
      // 先刷新皮肤层（切安抚中皮），再由会话状态驱动片段（幂等，不会回第一段）
      syncCharacterSkinRuntime(saveManager.get());
      refreshDialogueVisualContext(overlay, characterId);
      syncAnfuPortraitFromSession(overlay, characterId);
      syncAnfuChrome(overlay, characterId);
      void send(
        r.attackText ?? `发射棉花！第${(r.clipIndex ?? 0) + 1}团棉花飞过去了！`,
        false,
      );
      return;
    }

    // 离开安抚室：standby 中性 / soothing 扣好感 / exhausted 结算（状态层分流）
    if (t.closest('[data-ai-anfu-leave]')) {
      if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      const r = leaveAnfuNow('leave');
      const flash = takeAnfuUiFlash();
      clearAnfuClip(overlay, characterId);
      // 离开安抚室 → 彻底停止喘息声
      stopAnfuBreathAudio();
      syncCharacterSkinRuntime(saveManager.get());
      refreshDialogueVisualContext(overlay, characterId);
      if (flash) appendLog('系统', flash);
      else if (r.ok) appendLog('系统', r.msg);
      syncAnfuChrome(overlay, characterId);
      return;
    }

    if (t.closest('[data-ai-discipline-invite-yes]')) {
      if (sending || dialogueEnded) return;
      unlockAudioPlayback();
      playUiSound('tap');
      const characterId = activeId();
      void runDisciplineBlackout(overlay, () => {
        let systemLine = '';
        saveManager.mutate((d) => {
          const living = getAiLiving();
          releasePendingItemOffer(d, living, { silent: true });
          const r = acceptDisciplineInvite(d, living);
          systemLine = r.systemLine ?? r.msg;
          d.aiLiving = living;
        });
        syncCharacterSkinRuntime(saveManager.get());
        refreshDialogueVisualContext(overlay, characterId);
        if (systemLine) appendLog('系统', systemLine);
      }).then(() => {
        syncDisciplineChrome(overlay, characterId);
        if (!document.body.contains(overlay) || dialogueEnded) return;
        clearProactive();
        consecutiveProactive = 0;
        void runCharacterSpeak('proactive', DISCIPLINE_ENTER_REACT_MOTIVE);
      });
      return;
    }

    if (t.closest('[data-ai-discipline-invite-no]')) {
      unlockAudioPlayback();
      playUiSound('cancel');
      let line = '';
      saveManager.mutate((d) => {
        const living = getAiLiving();
        line = rejectDisciplineInvite(living);
        d.aiLiving = living;
      });
      if (line) appendLog('系统', line);
      syncDisciplineChrome(overlay, activeId());
    }
  });

  micBtn?.addEventListener('click', () => {
    unlockAudioPlayback();
    playUiSound('tap');
    if (sending) {
      appendLog('系统', '上一条还在发送，请稍候再语音。');
      return;
    }
    if (!isSpeechInputSupported()) {
      appendLog(
        '系统',
        '当前环境不支持麦克风。请用文字，或换 Chrome / Edge，并在营地生活填写 Qwen Key（国内识别）。',
      );
      return;
    }
    clearProactive();
    toggleSpeechInput({
      onStart: () => {
        setMicUi(true);
        // 玩家正在录音（语音输入，非打字）→ 临时关闭喘息声
        setAnfuBreathDucked('mic', true);
        const cid = activeId();
        const listen = listeningEmotionHint(cid);
        syncPortraitEmotion(cid, listen.pose, listen.emotion, 'sticky');
      },
      onEnd: () => {
        setMicUi(false);
        // 录音结束 → 解除 mic 静音（voice 若仍在播则保持静音）
        setAnfuBreathDucked('mic', false);
      },
      onStatus: (status) => {
        if (micBtn) micBtn.title = status;
      },
      onPartial: (partial, isFinal) => {
        if (sending) return;
        lastPlayerTypedAt = Date.now();
        reactToAsrText(activeId(), partial, isFinal);
        if (!isFinal && partial.trim()) input.value = partial;
      },
      onResult: (text) => {
        if (sending) return;
        input.value = text;
        reactToAsrText(activeId(), text, true);
        void send(text, true);
      },
      onError: (message) => appendLog('系统', message),
    });
  });

  void openDialogueSession(initialCharacterId).then((session) => {
    syncCharacterSkinRuntime(saveManager.get());
    refreshDialogueVisualContext(overlay, initialCharacterId, {
      clock: session.clock,
      fromOutreach: opts.fromOutreach,
      presenceLabel: session.presenceLabel,
      forcePortraitRefresh: true,
    });

    logEl.innerHTML = '';
    for (const m of session.history) {
      appendLog(m.role === 'user' ? '你' : initialName, m.text, m.role === 'user');
    }
    if (session.history.length) {
      const last = session.history[session.history.length - 1];
      if (last.role === 'assistant') {
        bubbleRow.hidden = true;
        bubbleText.textContent = last.text;
        const stageBits: string[] = [];
        if (last.action?.trim()) stageBits.push(last.action.trim());
        if (last.innerThought?.trim()) stageBits.push(`心里：${last.innerThought.trim()}`);
        if (stageBits.length) {
          actionEl.hidden = false;
          actionEl.textContent = `（${stageBits.join(' · ')}）`;
        } else {
          actionEl.hidden = true;
        }
      }
    }

    input.disabled = false;
    sendBtn.disabled = false;
    if (micBtn) micBtn.disabled = false;
    syncDisciplineChrome(overlay, activeId());
    input.focus();
    if (opts.initialOfferPropId) {
      void sendOffer(opts.initialOfferPropId);
    } else if (opts.openItemPicker) {
      showDialogueItemPicker({
        overlay,
        characterId: activeId(),
        initialTab: opts.itemPickerTab,
        onOffer: (propId) => {
          void sendOffer(propId);
        },
      });
    }
    // 开场后按性格等待主动开口（本地 Fable 与千问同一套自主性）
    scheduleProactive('idle');
  });
}

/** 后台用：导出关系列表（避免未使用告警时也可被 panel 引用） */
export function debugListRelations() {
  const living = getAiLiving();
  const owned = Object.keys(living.affinities);
  return listRelationPairs(living, owned);
}
