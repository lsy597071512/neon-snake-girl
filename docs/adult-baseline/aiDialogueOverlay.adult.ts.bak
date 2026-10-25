/**
 * 沉浸式对话：单人 / 多人事件同屏
 * 同屏仅当角色处于活跃多人事件赴约组；偶然同房不开同屏
 */
import {
  enterFestiveCampDialogueBgm,
  exitFestiveCampDialogueBgm,
  notifyBgmStateChanged,
  shouldPlayFestiveCampDialogueBgm,
} from '../audio/bgm';
import { syncDisciplineOverlayMusic } from '../audio/disciplineOverlay';
import { playUiSound } from './uiSound';
import { CHARACTER_MAP } from '../data/characters';
import { CAMP_ROOM_MAP } from '../data/campLayout';
import { AI_BUBBLE_STYLE, AI_PARTICLE } from '../ai/assets';
import {
  getAiLiving,
  getOutfitChangeCountdownMs,
  openDialogueSession,
  peekAffinity,
  releaseDialogueSceneSession,
  settleDueOutfitChangeNow,
  talkToCharacter,
} from '../ai/livingService';
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
  playDialogueSkinClip,
  refreshDialogueSkinLayer,
  setDialogueDisciplinePose,
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
import { DISCIPLINE_SKIN_ID, getCharacterSkin } from '../data/characterSkins';

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
    const label = inDiscipline
      ? '负一楼·小黑屋'
      : opts?.presenceLabel || presence.label;
    const outreachBit = opts?.fromOutreach ? ' · 主动来信' : '';
    const discBit = inDiscipline ? ' · 调教中' : '';
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
}

/** 小黑屋按钮文案 / 送礼禁用 / 姿势条 / 邀请条 */
function syncDisciplineChrome(overlay: HTMLElement, characterId: string): void {
  const living = getAiLiving();
  const active = isDisciplineActiveFor(living, characterId);
  syncDisciplineOverlayMusic(active);
  const enabled = isDisciplineEnabled(saveManager.get());
  const discBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-discipline]');
  const itemsBtn = overlay.querySelector<HTMLButtonElement>('[data-ai-items]');
  if (discBtn) {
    const hasSkin = !!getCharacterSkin(characterId, DISCIPLINE_SKIN_ID);
    discBtn.hidden = overlay.dataset.coScreen === 'true' || !enabled || !hasSkin;
    discBtn.disabled = overlay.classList.contains('is-ended') || overlay.dataset.disciplineBusy === '1';
    discBtn.textContent = active ? '离开' : '小黑屋';
    discBtn.title = active ? '结束调教会话并离开小黑屋' : '将角色拖入负一楼小黑屋（调教室）';
    discBtn.classList.toggle('is-active', active);
  }
  if (itemsBtn) {
    if (active) {
      itemsBtn.disabled = true;
      itemsBtn.title = '调教中无法送礼';
      closeDialogueItemPicker(overlay);
    } else if (!overlay.classList.contains('is-ended') && !overlay.querySelector('[name="msg"]')?.hasAttribute('disabled')) {
      itemsBtn.disabled = false;
      itemsBtn.title = '从仓库递交物品';
    }
  }

  // 姿势条
  let poseBar = overlay.querySelector<HTMLElement>('[data-ai-discipline-poses]');
  if (active && overlay.dataset.coScreen !== 'true') {
    const count = getDisciplinePoseCount(characterId);
    if (!poseBar) {
      poseBar = document.createElement('div');
      poseBar.className = 'ai-discipline-poses';
      poseBar.dataset.aiDisciplinePoses = '1';
      const form = overlay.querySelector('[data-ai-form]');
      form?.parentElement?.insertBefore(poseBar, form);
    }
    const locked = isDisciplinePoseUiLocked(living, characterId);
    const coolMs = getDisciplinePoseCooldownRemainingMs(living);
    const session = living.disciplineSession;
    const cur = session?.poseIndex ?? null;
    const idleOn = cur == null ? ' is-on' : '';
    const idleBtn = `<button type="button" class="ai-discipline-pose-btn ai-discipline-idle-btn${idleOn}" data-ai-discipline-idle="1" title="${escapeHtml(getDisciplinePoseNote(characterId, null))}" ${locked ? 'disabled' : ''}>默认</button>`;
    const buttons = Array.from({ length: count }, (_, i) => {
      const n = i + 1;
      const note = getDisciplinePoseNote(characterId, n);
      const on = cur === n ? ' is-on' : '';
      return `<button type="button" class="ai-discipline-pose-btn${on}" data-ai-discipline-pose="${n}" title="${escapeHtml(note)}" ${locked ? 'disabled' : ''}>姿势${n}</button>`;
    }).join('');
    const coolHint =
      coolMs > 0
        ? `<span class="ai-discipline-pose-hint">冷却 ${Math.ceil(coolMs / 1000)}s</span>`
        : session?.awaitingPoseReply
          ? `<span class="ai-discipline-pose-hint">等待回应…</span>`
          : '';
    poseBar.hidden = false;
    poseBar.innerHTML = `<span class="ai-discipline-pose-label">拘束状态</span>${idleBtn}${buttons}${coolHint}`;
  } else if (poseBar) {
    poseBar.hidden = true;
    poseBar.innerHTML = '';
  }

  // 主动求进确认条
  let inviteBar = overlay.querySelector<HTMLElement>('[data-ai-discipline-invite]');
  const pending = living.pendingDisciplineInvite;
  const showInvite =
    !active &&
    enabled &&
    pending &&
    pending.characterId === characterId &&
    overlay.dataset.coScreen !== 'true';
  if (showInvite && pending) {
    if (!inviteBar) {
      inviteBar = document.createElement('div');
      inviteBar.className = 'ai-discipline-invite';
      inviteBar.dataset.aiDisciplineInvite = '1';
      const form = overlay.querySelector('[data-ai-form]');
      form?.parentElement?.insertBefore(inviteBar, form);
    }
    inviteBar.hidden = false;
    inviteBar.innerHTML = `
      <p class="ai-discipline-invite-text">${escapeHtml(pending.preview)}</p>
      <div class="ai-discipline-invite-actions">
        <button type="button" class="ai-discipline-invite-yes" data-ai-discipline-invite-yes>带她去</button>
        <button type="button" class="ai-discipline-invite-no" data-ai-discipline-invite-no>拒绝</button>
      </div>`;
  } else if (inviteBar) {
    inviteBar.hidden = true;
    inviteBar.innerHTML = '';
  }
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
        <form class="ai-immersive-form" data-ai-form>
          <button type="button" class="ai-immersive-discipline" data-ai-discipline aria-label="小黑屋" title="将角色拖入负一楼小黑屋（调教室）">小黑屋</button>
          <button type="button" class="ai-immersive-items" data-ai-items aria-label="物品" title="从仓库递交物品">📦</button>
          <button type="button" class="ai-immersive-mic" data-ai-mic aria-label="语音输入" title="语音输入：角色将语音回复">🎤</button>
          <input class="ai-immersive-input" name="msg" type="text" maxlength="200" placeholder="打字=文字回复 · 麦克风=语音回复" autocomplete="off" disabled />
          <button class="ai-immersive-send" type="submit" data-ai-send disabled>发送</button>
        </form>
      </div>
      <div class="ai-particle-layer" data-ai-particles></div>
    </div>
  `;

  wireDialogueChrome(overlay, characterId, def.name, opts, null);
  tagFestiveDialogueOverlay(overlay, characterId, opts, festiveBgm);
  document.body.appendChild(overlay);
  bindDialoguePortraitInteractions(overlay);
  playLiveVideos(overlay);
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
        <form class="ai-immersive-form" data-ai-form>
          <button type="button" class="ai-immersive-items" data-ai-items aria-label="物品" title="从仓库递交物品">📦</button>
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
  /** 离开小黑屋 / 强制中断时抬升，丢弃在途对白结果，避免离房后仍刷「被束缚」 */
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
  });

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
        appendLog('系统', `语音播放失败：${r.reason || '未知'}（仍可看文字）`);
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
    // 小黑屋也要情绪图表达表情；结束后由 fadeToSkin 续播 idle/粘住姿势
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
        bubbleText.textContent = '……';
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
    dialogueEnded = true;
    voiceChatActive = false;
    clearDialogueVoiceSession();
    closeDialogueItemPicker(overlay);
    const focusCid = activeId();
    saveManager.mutate((d) => {
      const living = getAiLiving();
      releasePendingItemOffer(d, living, { silent: true });
      settleActiveDisciplineSession(d, living, '关闭对话页');
      d.aiLiving = living;
    });
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
    updateOutfitHint(characterId);
    syncPortraitEmotion(characterId, result.emotion_pose, result.emotion, 'commit');
    {
      const clipRaw = result.skin_clip;
      const clip =
        typeof clipRaw === 'number'
          ? clipRaw
          : typeof clipRaw === 'string' && clipRaw.trim()
            ? Number(clipRaw.trim())
            : NaN;
      if (Number.isFinite(clip) && clip >= 1) {
        const livingNow = getAiLiving();
        // 小黑屋姿势由 UI 粘住驱动，忽略 AI skin_clip 以免打断触手态
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
      const message = err instanceof Error ? err.message : String(err);
      const isAbort = (err as Error)?.name === 'AbortError';
      bubbleText.textContent = isAbort
        ? '家里云端超时了。请确认 PC 上 Fable/Ollama 服务与隧道仍在跑。'
        : message;
      appendLog('系统', bubbleText.textContent);
      scheduleProactive('idle');
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
    voiceChatActive = wantSpeak;
    if (wantSpeak) {
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
    } catch (err) {
      if (epoch !== speakEpoch) return;
      const message = err instanceof Error ? err.message : String(err);
      const isAbort = (err as Error)?.name === 'AbortError';
      const displayMsg = isAbort
        ? '家里云端超时了。请确认 PC 上 Fable/Ollama 服务与隧道仍在跑，再发一句。'
        : message;
      bubbleText.textContent = displayMsg;
      appendLog('系统', displayMsg);
      scheduleProactive('idle');
    } finally {
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

  input.addEventListener('input', () => {
    lastPlayerTypedAt = Date.now();
  });

  overlay.querySelector<HTMLFormElement>('[data-ai-form]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    unlockAudioPlayback();
    void send(input.value, false);
  });

  itemsBtn?.addEventListener('click', () => {
    if (sending || dialogueEnded || overlay.classList.contains('is-ended')) return;
    if (isDisciplineActiveFor(getAiLiving(), activeId())) {
      appendLog('系统', '调教中无法送礼。');
      return;
    }
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
        // 清掉上一句束缚态 action，避免离房后仍显示「被束缚挣扎」
        actionEl.hidden = true;
        actionEl.textContent = '';
        appendLog('系统', '正在结算小黑屋余韵…');
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
        // 与进房对称：立刻发「已离开/束缚解除」反应轮，同步 AI
        clearProactive();
        consecutiveProactive = 0;
        void runCharacterSpeak('proactive', DISCIPLINE_LEAVE_REACT_MOTIVE);
      })();
      return;
    }

    if (!isDisciplineEnabled(saveManager.get())) {
      appendLog('系统', '小黑屋功能已关闭。');
      return;
    }
    if (!getCharacterSkin(characterId, DISCIPLINE_SKIN_ID)) {
      appendLog('系统', '该角色暂无调教约束皮资源。');
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
        const cid = activeId();
        const listen = listeningEmotionHint(cid);
        syncPortraitEmotion(cid, listen.pose, listen.emotion, 'sticky');
      },
      onEnd: () => setMicUi(false),
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
