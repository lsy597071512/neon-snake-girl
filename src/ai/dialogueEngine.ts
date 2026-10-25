import {
  clampAffectionChange,
} from './aiProfiles';
import { chatDialogueStreamJson, chatJsonRouted } from './llmRouter';
import {
  archiveNpcTurn,
  archivePlayerTurn,
  getRecentChatsForPrompt,
  pushCampLog,
  pushMemory,
  pushRecentChat,
} from './memory';
import { assembleNpcPairMessages, assemblePlayerDialogueMessages } from './promptAssembler';
import { getLifeDigestLinesForPrompt } from './lifeArchive';
import { adjustAffinity, adjustRelation } from './relationship';
import { ingestFactsFromDialogueTurn } from './structuredFacts';
import type { AiLivingSave, DialogueRequest, LlmDialogueResult, LightStatusTag } from './types';
import {
  applyCampItemAction,
  normalizeItemOfferResolution,
  settlePendingItemOffer,
  type CampItemActionPayload,
} from '../systems/CampWarehouseSystem';
import type { SaveData } from '../types';
import { saveManager } from '../core/SaveManager';
import { getCoScreenGroupForCharacter } from './campEvents';
import { applyBathIntimateConsentFromAi } from './bathIntimateConsent';
import {
  detectAiBathAssistEnd,
  isBathAssistActiveFor,
  leaveBathAssistSession,
  maybeProposeBathAssistInvite,
  parseBathAssistActionField,
  resolvePlayerBathAssistAskFromTurn,
} from './bathAssistSession';
import {
  beginCoDance,
  beginSoloDance,
  consumeDanceJustEntered,
  detectAiContinuesDance,
  detectAiStopsDance,
  getDanceSession,
  isDanceActiveFor,
  leaveDanceSession,
  maybeProposeDanceInvite,
  offerDanceInviteFromTurn,
  parseDanceActionField,
  resolvePlayerDanceAskFromTurn,
  returnToPrepare,
  setSoloPaused,
} from './danceSession';
import {
  consumeAnfuJustEntered,
  detectAiAnfuPropose,
  isAnfuActiveFor,
  leaveAnfuSession,
  maybeProposeAnfuInvite,
  offerAnfuInviteFromTurn,
  parseAnfuActionField,
  parseAnfuBonusField,
  parseAnfuGainField,
  resolveAnfuAttackGain,
  resolvePlayerAnfuAskFromTurn,
  settleAnfuExhausted,
} from './anfuSession';
import {
  aiQuitMiniGame,
  consumeMiniGameJustEntered,
  detectAiMiniGamePropose,
  isMiniGameActiveFor,
  maybeProposeMiniGameInvite,
  offerMiniGameInviteFromTurn,
  parseMiniGameActionField,
  resolveMiniGameStake,
  resolvePlayerMiniGameAskFromTurn,
} from './miniGameSession';
import { applyAdultEventFromLlm, detectAdultEventContext } from './adultEvents';
import { applyDesireNextFromDialogue, commitPendingDesireAfterDialogue } from './desireNext';
import { sanitizeCharacterDialogue } from './dialogueSanitize';
import {
  applyDialogueRealityHardClamp,
  buildDialogueRealityRetryHint,
  detectDialogueRealityIssues,
  type DialogueRealityIssue,
} from './dialogueRealityGuard';
import { isLocalHomeGpuDialoguePath, resolveCharacterModel } from './providerConfig';
import { clampLocalHomeGpuDialogueResult } from './localHomeGpuClamp';
import { LOCAL_HOME_GPU_MAX_TOKENS } from './localHomeGpuPrompt';
import { applyBatheShowerSkins } from './campEvents/campEventEffects';
import { syncDialogueWorldRealtime } from './dialogueWorldSync';
import { captureDialogueSceneSnapshot } from './dialogueSceneSync';
import {
  beginDialogueRequest,
  finishDialogueRequest,
  isCurrentDialogueRequest,
} from './dialogueRequestGuard';
import {
  cancelPendingOutfitChange,
  declinesOutfitChange,
  OUTFIT_SPEECH_RE,
  processTurnOutfitChange,
} from './outfitChangeProcess';
import { evolvePersonaAfterTalk } from './characterPersona';
import { applyMoodImpulse } from './moodContinuum';
import { resolvePresence } from './livingState';
import {
  clearDisciplinePoseAwaiting,
  consumeDisciplineJustEntered,
  consumeDisciplineJustLeftTurn,
  isDisciplineActiveFor,
  maybeProposeDisciplineInvite,
  recordDisciplineValenceHint,
} from './disciplineSession';
import { tryCommitPlayerTaskAgenda } from './characterAgenda';
import {
  handleSleepInterruptFromTurn,
  isDeepSleeping,
  isInSleepSystem,
  leaveSleepSystem,
  markSleepDisturbed,
  maybeReturnToSleepFromSpeech,
  sleepBackIfLeftAloneAfterWake,
  proactiveContactBlockReason,
  tryCommitSleepFromDialogue,
  tryWakeFromSpeech,
} from './sleepSystem';
import { CHARACTER_MAP } from '../data/characters';
import {
  EMOTION_POSE_CATALOG,
  normalizeEmotionPoseKey,
} from '../data/characterEmotionPoses';

function stripParen(s: string): string {
  return s.replace(/^[（(]\s*/, '').replace(/\s*[）)]$/, '').trim();
}

function looksLikePlayerFarewell(msg: string): boolean {
  const t = msg.trim();
  if (!t) return false;
  return /^(再见|拜拜|拜|晚安|我走了|先走了|走了|回头聊|先这样|没事了|可以了|不聊了|挂了)([。.!！~～…]*)$/i.test(
    t,
  );
}

function looksLikePlayerClosing(msg: string): boolean {
  const t = msg.trim();
  if (!t) return false;
  return (
    looksLikePlayerFarewell(t) ||
    /^(好的?|行|嗯+|哦+|喔+|知道了|明白了|了解|收到)([。.!！~～…]*)$/i.test(t)
  );
}

function looksLikeLowEngagement(msg: string): boolean {
  const t = msg.trim();
  return /^(好的?|行|嗯+|哦+|喔+|哈哈*|呵呵*|是|对)([。.!！~～…]*)$/i.test(t);
}

function normalizeInterrupt(
  raw: unknown,
): LlmDialogueResult['interrupt_reaction'] | undefined {
  const v = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (v === 'welcome' || v === 'tolerate' || v === 'annoyed' || v === 'angry') return v;
  return undefined;
}

function normalizeResult(
  raw: Partial<LlmDialogueResult>,
  characterId: string,
): LlmDialogueResult {
  const affRaw = typeof raw.affection_change === 'number' ? raw.affection_change : 0;
  const action = typeof raw.action === 'string' ? stripParen(raw.action) : '';
  const thought = typeof raw.inner_thought === 'string' ? stripParen(raw.inner_thought) : '';
  const end =
    raw.end_conversation === true ||
    raw.end_conversation === ('true' as unknown as boolean) ||
    String(raw.end_conversation).toLowerCase() === 'true';
  const wantContinue =
    raw.want_continue === true ||
    raw.want_continue === ('true' as unknown as boolean) ||
    String(raw.want_continue).toLowerCase() === 'true';
  const skinRaw =
    typeof raw.skin_change === 'string' ? raw.skin_change.trim() : '';
  let skinClip: number | undefined;
  {
    const c = raw.skin_clip;
    const n =
      typeof c === 'number'
        ? c
        : typeof c === 'string' && c.trim() && c.trim() !== '""'
          ? Number(c.trim())
          : NaN;
    if (Number.isFinite(n) && n >= 1) skinClip = Math.floor(n);
  }
  const bathConsentRaw =
    raw.bath_intimate_consent === true ||
    raw.bath_intimate_consent === false ||
    typeof raw.bath_intimate_consent === 'string'
      ? raw.bath_intimate_consent
      : undefined;
  const beat =
    typeof raw.scene_beat === 'string' ? stripParen(raw.scene_beat).slice(0, 80) : '';
  // P2：结构化世界意图（对象或 JSON 字符串都收；非法则弃用走文本推断）
  let world_intent: LlmDialogueResult['world_intent'];
  {
    const wi = raw.world_intent;
    let obj: unknown = wi;
    if (typeof wi === 'string') {
      const t = wi.trim();
      if (t && t !== '""' && t !== '{}' && t.toLowerCase() !== 'none') {
        try {
          obj = JSON.parse(t);
        } catch {
          obj = null;
        }
      } else {
        obj = null;
      }
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const o = obj as Record<string, unknown>;
      world_intent = {
        move_to: typeof o.move_to === 'string' ? o.move_to.trim() : undefined,
        outfit_action:
          o.outfit_action === 'start' || o.outfit_action === 'finish'
            ? o.outfit_action
            : undefined,
        target_skin: typeof o.target_skin === 'string' ? o.target_skin.trim() : undefined,
        activity: typeof o.activity === 'string' ? o.activity.trim() : undefined,
      };
      if (!world_intent.move_to && !world_intent.outfit_action && !world_intent.activity) {
        world_intent = undefined;
      }
    }
  }
  const memWrite =
    typeof raw.memory_write === 'string' ? raw.memory_write.trim().slice(0, 100) : '';
  let desire_next: LlmDialogueResult['desire_next'];
  if (typeof raw.desire_next === 'string') {
    const d = raw.desire_next.trim();
    desire_next = d ? d : undefined;
  } else if (raw.desire_next && typeof raw.desire_next === 'object') {
    desire_next = raw.desire_next as LlmDialogueResult['desire_next'];
  }
  const poseRaw =
    typeof raw.emotion_pose === 'string' ? raw.emotion_pose.trim() : '';
  let emotion_pose = normalizeEmotionPoseKey(characterId, poseRaw);
  if (!emotion_pose && raw.emotion) {
    const fallback = EMOTION_POSE_CATALOG.find((e) => e.dialogueEmotion === raw.emotion);
    if (fallback) emotion_pose = normalizeEmotionPoseKey(characterId, fallback.key);
  }
  let camp_item_action: LlmDialogueResult['camp_item_action'];
  const cia = raw.camp_item_action;
  if (typeof cia === 'string') {
    const t = cia.trim();
    if (t && t !== '""' && t !== '{}' && t.toLowerCase() !== 'none') {
      try {
        camp_item_action = JSON.parse(t) as CampItemActionPayload;
      } catch {
        camp_item_action = undefined;
      }
    }
  } else if (cia && typeof cia === 'object') {
    camp_item_action = cia as CampItemActionPayload;
  }
  const item_offer_resolution = normalizeItemOfferResolution(raw.item_offer_resolution);
  const discipline_mood =
    typeof raw.discipline_mood === 'string' ? raw.discipline_mood.trim().slice(0, 24) : undefined;
  const dv = typeof raw.discipline_valence === 'string' ? raw.discipline_valence.trim().toLowerCase() : '';
  const discipline_valence =
    dv === 'tragic' || dv === 'mixed' || dv === 'joyful' ? dv : undefined;
  const emptyish = (v: unknown) =>
    v === undefined ||
    v === null ||
    (typeof v === 'string' && (!v.trim() || v.trim() === '""'));
  const stim_target =
    !emptyish(raw.stim_target) && typeof raw.stim_target === 'string'
      ? raw.stim_target.trim().slice(0, 24)
      : undefined;
  const stim_zones =
    !emptyish(raw.stim_zones) && typeof raw.stim_zones === 'string'
      ? raw.stim_zones.trim().slice(0, 120)
      : undefined;
  const stim_intensity = emptyish(raw.stim_intensity) ? undefined : raw.stim_intensity;
  const stim_duration =
    !emptyish(raw.stim_duration) && typeof raw.stim_duration === 'string'
      ? raw.stim_duration.trim().slice(0, 16)
      : undefined;
  const adult_odd_mood =
    !emptyish(raw.adult_odd_mood) && typeof raw.adult_odd_mood === 'string'
      ? raw.adult_odd_mood.trim().slice(0, 48)
      : undefined;
  const oil_discharge =
    !emptyish(raw.oil_discharge) && typeof raw.oil_discharge === 'string'
      ? raw.oil_discharge.trim().slice(0, 16)
      : undefined;
  return {
    emotion: raw.emotion || 'neutral',
    emotion_pose,
    dialogue: sanitizeCharacterDialogue(raw.dialogue || '', characterId),
    inner_thought: thought || undefined,
    action: action || undefined,
    type: raw.type || 'dialogue',
    affection_change: clampAffectionChange(characterId, affRaw),
    status_changes: Array.isArray(raw.status_changes) ? raw.status_changes : [],
    trigger_jealousy: Array.isArray(raw.trigger_jealousy) ? raw.trigger_jealousy : [],
    end_conversation: end,
    end_reason: typeof raw.end_reason === 'string' ? raw.end_reason.trim().slice(0, 80) : undefined,
    interrupt_reaction: normalizeInterrupt(raw.interrupt_reaction),
    want_continue: wantContinue && !end,
    skin_change: skinRaw || undefined,
    skin_clip: skinClip,
    discipline_mood,
    discipline_valence,
    world_intent,
    bath_intimate_consent: bathConsentRaw,
    bath_assist_action: parseBathAssistActionField(raw.bath_assist_action),
    dance_action: parseDanceActionField(raw.dance_action),
    anfu_action: parseAnfuActionField(raw.anfu_action),
    minigame_action: parseMiniGameActionField(raw.minigame_action),
    anfu_gain: parseAnfuGainField(raw.anfu_gain),
    anfu_bonus: parseAnfuBonusField(raw.anfu_bonus),
    stim_target,
    stim_zones,
    stim_intensity,
    stim_duration,
    adult_odd_mood,
    oil_discharge,
    scene_beat: beat || undefined,
    desire_next,
    memory_write: memWrite || undefined,
    camp_item_action,
    item_offer_resolution,
  };
}

export type DialogueCommittedPayload = {
  dialogue: string;
  action?: string;
  inner_thought?: string;
  type?: string;
  emotion?: string;
  emotion_pose?: string | null;
};

export type PlayerDialogueOpts = {
  /** 流式 dialogue 字段（仅首包；补全/重写不回调） */
  onDialoguePartial?: (text: string) => void;
  /** 现实守卫/场景漂移重试：新一轮生成前重置预览气泡 */
  onDialogueRegenerating?: () => void;
  /** LLM 整包 JSON 已定稿、后处理尚未跑完：立刻把对白落进聊天日志 */
  onDialogueCommitted?: (payload: DialogueCommittedPayload) => void;
  signal?: AbortSignal;
  /** 发话前位置/穿搭已对齐（可刷新立绘背景） */
  onWorldSynced?: () => void;
};

const MAX_DIALOGUE_ATTEMPTS = 2;

function sameDialogueReality(
  a: ReturnType<typeof captureDialogueSceneSnapshot>,
  b: ReturnType<typeof captureDialogueSceneSnapshot>,
): boolean {
  // 只比对「房间」。
  // behavior / skinKey / activity 会被后台心跳、情绪换装、展示锁随时改写；把它们
  // 算进来会让一次正常生成被判成「场景漂移」而整轮重来，玩家看到气泡文字来回换
  // 几次才真正发出来（首字延迟数倍）。外观/活动漂移交世界同步在提交后拉正。
  return a.roomId === b.roomId;
}

export async function runPlayerDialogue(
  living: AiLivingSave,
  req: DialogueRequest,
  save?: SaveData | null,
  opts?: PlayerDialogueOpts,
): Promise<LlmDialogueResult> {
  if (!living.lastTalkAt) living.lastTalkAt = {};
  const liveSave = save ?? saveManager.get();
  const isProactive =
    req.turnMode === 'proactive' ||
    req.turnMode === 'continue' ||
    req.turnMode === 'outfit_reveal';
  if (
    (req.turnMode === 'proactive' || req.turnMode === 'continue') &&
    proactiveContactBlockReason(living, req.characterId)
  ) {
    return {
      emotion: 'neutral',
      dialogue: '',
      action: '',
      inner_thought: '',
      want_continue: false,
      end_conversation: false,
      affection_change: 0,
      skin_change: '',
    };
  }
  const closeHint = isProactive
    ? ''
    : looksLikePlayerClosing(req.playerMessage)
      ? '玩家本轮像在收尾/应承/告别：优先 end_conversation=true，给收尾句，禁止再派新任务。'
      : looksLikeLowEngagement(req.playerMessage)
        ? '玩家投入很低（短应承）：若话题已尽，请 end_conversation=true；不要为续聊硬编下一件杂事。'
        : '';

  const wantContinueHint =
    req.turnMode === 'outfit_reveal'
      ? '本轮是换装完成同步：want_continue=false，skin_change=""，只按新立绘说话。'
      : isProactive
          ? '若你还想一口气接着说（不等指挥官回），可 want_continue=true；若说完该等对方了则 want_continue=false。禁止无意义复读。'
          : '若性格话痨且话题未尽、指挥官刚应承完你仍想补一句，可 want_continue=true；多数情况 false。';

  const recentAssistant = getRecentChatsForPrompt(living, req.characterId)
    .filter((t) => t.role === 'assistant')
    .slice(-3)
    .map((t) => t.text.trim())
    .filter(Boolean);
  const disciplineAntiRepeat = '';
  const antiRepeatHint =
    recentAssistant.length > 0
      ? `${disciplineAntiRepeat}禁止复读或近义改写你刚说过的话（含长片段重叠）：${recentAssistant.map((t) => `「${t.slice(0, 36)}」`).join('、')}。`
      : disciplineAntiRepeat;
  const lease = beginDialogueRequest(req.characterId);
  const abortFromCaller = () => lease.controller.abort();
  if (opts?.signal) {
    if (opts.signal.aborted) abortFromCaller();
    else opts.signal.addEventListener('abort', abortFromCaller, { once: true });
  }
  try {
    let requestScene = captureDialogueSceneSnapshot(living, req.characterId);
    let raw: Partial<LlmDialogueResult> | undefined;
    let result!: LlmDialogueResult;
    let realityHint = '';
    let realityRetried = false;
    /** 仅 ignore_player_ask 时保留首稿（流式已展示），避免硬钳地点模板盖掉 */
    let softAskKeep: LlmDialogueResult | undefined;

    // 场景漂移重试 + 现实守卫重试（最多 2 次生成；3 次会让首字延迟翻倍）
    for (let attempt = 0; attempt < MAX_DIALOGUE_ATTEMPTS; attempt += 1) {
      if (attempt > 0) opts?.onDialogueRegenerating?.();
      const localGpu = isLocalHomeGpuDialoguePath();
      const charModel = localGpu ? resolveCharacterModel(req.characterId) : '';
      const streamOpts = {
        channel: 'dialogue' as const,
        // Fable 与千问同量级输出预算；温度略低以稳住 JSON
        temperature: localGpu ? 1.0 : 0.95,
        maxTokens: localGpu
          ? req.turnMode === 'continue' || req.turnMode === 'proactive'
            ? Math.min(LOCAL_HOME_GPU_MAX_TOKENS, 560)
            : LOCAL_HOME_GPU_MAX_TOKENS
          : 720,
        onDialoguePartial: opts?.onDialoguePartial,
        signal: lease.controller.signal,
        model: charModel || undefined,
      };
      raw = await chatDialogueStreamJson<Partial<LlmDialogueResult>>(async () => {
        if (!isCurrentDialogueRequest(lease)) throw new DOMException('Superseded dialogue', 'AbortError');
        requestScene = captureDialogueSceneSnapshot(living, req.characterId);
        // 千问与 Fable 共用旧结构：system=人设宪法+本轮世界状态；user=指挥官原话+短 footer。
        // 保留瘦身后的内容（去重/场景门控/成人事件等）在 assemble 内；此处只恢复消息布局。
        const { system, history, user } = await assemblePlayerDialogueMessages(
          living,
          req,
          liveSave,
        );
        const lifeLines = await getLifeDigestLinesForPrompt(req.characterId, 4);
        const systemWithLife = lifeLines.length
          ? `${system}\n\n【你近日在营地的生活痕迹】（本地存档，勿背诵成流水账）\n${lifeLines.map((l) => `- ${l}`).join('\n')}`
          : system;
        const coNow = getCoScreenGroupForCharacter(living, req.characterId);
        const eventLockHint = coNow
          ? `此刻同屏事件是「${coNow.eventName}」，dialogue 必须扣住这件事与同场同伴，禁止聊无关沙尘/风向。`
          : '';
        const footer = `（请只输出要求的 JSON 对象；键顺序建议先 dialogue，再 emotion/emotion_pose，其余字段其后。dialogue 必须先直接回应指挥官本轮原话，禁止自说自话演欲望/外观独角戏；禁止复读旧台词；禁止「才不是」类统一傲娇。action 与 inner_thought 本轮必填，各一句中文，不得空。记得填写 end_conversation / end_reason / interrupt_reaction / want_continue，以及 scene_beat、desire_next、memory_write、world_intent（无则 ""）。涉及买/卖/送礼/吃东西时填 camp_item_action，否则 ""。钱不够或仓库没货时不要假装成功。${eventLockHint}${closeHint ? ` ${closeHint}` : ''}${antiRepeatHint ? ` ${antiRepeatHint}` : ''} ${wantContinueHint}${realityHint ? ` ${realityHint}` : ''}）`;
        return [
          { role: 'system' as const, content: systemWithLife },
          ...history,
          {
            role: 'user' as const,
            content: `${user}\n\n${footer}`,
          },
        ];
      }, streamOpts);
      if (!isCurrentDialogueRequest(lease)) throw new DOMException('Superseded dialogue', 'AbortError');
      if (!sameDialogueReality(requestScene, captureDialogueSceneSnapshot(living, req.characterId))) {
        console.info(`[dialogue-retry] ${req.characterId}: scene changed during generation`);
        // 最后一次生成即使房间漂移也采用：宁可让本轮台词落地（世界同步随后拉正），
        // 也不要再重来一整轮把玩家晾在原地。
        if (attempt < MAX_DIALOGUE_ATTEMPTS - 1) continue;
      }

      result = normalizeResult(raw, req.characterId);
      if (isLocalHomeGpuDialoguePath()) {
        result = clampLocalHomeGpuDialogueResult(living, req, result);
      }

      const issues: DialogueRealityIssue[] = detectDialogueRealityIssues(
        living,
        req,
        result,
        requestScene,
      );
      if (!issues.length) break;

      const softAskOnly =
        issues.length === 1 && issues[0] === 'ignore_player_ask' && Boolean(result.dialogue?.trim());
      if (softAskOnly && !softAskKeep) softAskKeep = result;

      if (!realityRetried && (req.turnMode ?? 'reply') !== 'outfit_reveal') {
        realityRetried = true;
        realityHint = buildDialogueRealityRetryHint(
          living,
          req,
          issues,
          result.dialogue,
          result.dialogue,
        );
        console.info(
          `[dialogue-reality] ${req.characterId}: retry issues=${issues.join(',')}`,
        );
        continue;
      }

      // 软答非所问：保留首稿（通常已是流式正确台词），禁止地点复读硬模板覆盖
      if (softAskOnly && softAskKeep) {
        const keepFirst =
          (softAskKeep.dialogue?.length ?? 0) >= (result.dialogue?.length ?? 0) * 0.6;
        result = keepFirst ? softAskKeep : result;
        opts?.onDialoguePartial?.(result.dialogue || '');
        console.info(
          `[dialogue-reality] ${req.characterId}: soft-keep dialogue (skip location fallback)`,
        );
        break;
      }

      result = applyDialogueRealityHardClamp(living, req, result, issues, requestScene);
      break;
    }
  if (!raw || !result || !isCurrentDialogueRequest(lease)) {
    throw new DOMException('Dialogue context changed before commit', 'AbortError');
  }

  // 流式预览只负责「打字感」；此处 JSON 已定稿，先落字再跑换装/世界同步等慢后处理，避免气泡长期卡在预览态。
  opts?.onDialogueCommitted?.({
    dialogue: result.dialogue,
    action: result.action,
    inner_thought: result.inner_thought,
    type: result.type,
    emotion: result.emotion,
    emotion_pose: result.emotion_pose,
  });

  const inDiscipline = isDisciplineActiveFor(living, req.characterId);

  // 软兜底：明确告别时若模型漏标结束 → 仍收束；短应承交给模型判断（主动发言轮跳过）
  // 事件中禁止收束逃走
  if (
    !inDiscipline &&
    !isProactive &&
    !result.end_conversation &&
    looksLikePlayerFarewell(req.playerMessage)
  ) {
    result = {
      ...result,
      end_conversation: true,
      end_reason: result.end_reason || '玩家告别，话题收束',
      want_continue: false,
    };
  }

  // 连续短应承（好/行/嗯…）≥2 轮仍不结束 → 强制收束，防止无限派活
  if (
    !inDiscipline &&
    !isProactive &&
    !result.end_conversation &&
    looksLikeLowEngagement(req.playerMessage)
  ) {
    const hist = living.recentChats?.[req.characterId] ?? [];
    let streak = 1;
    for (let i = hist.length - 1; i >= 0; i--) {
      const turn = hist[i];
      if (turn.role !== 'user') continue;
      if (looksLikeLowEngagement(turn.text)) streak += 1;
      else break;
    }
    if (streak >= 2) {
      result = {
        ...result,
        end_conversation: true,
        end_reason: result.end_reason || '玩家连续短应承，话题已尽',
        interrupt_reaction: result.interrupt_reaction ?? 'tolerate',
      };
    }
  }

  // 忙碌态被连续打扰：若模型已标 annoyed/angry 却未结束 → 强制结束
  // 事件会话排除（事件中不能因「烦」关掉对话逃走）
  if (!inDiscipline) {
    const act = resolvePresence(req.characterId, living).activity;
    const dnd = ['sleeping', 'bathe', 'maintain', 'busy', 'guard'].includes(act);
    if (
      dnd &&
      !result.end_conversation &&
      (result.interrupt_reaction === 'annoyed' || result.interrupt_reaction === 'angry')
    ) {
      result = {
        ...result,
        end_conversation: true,
        end_reason: result.end_reason || '正在做事，不想再被缠',
      };
    }
  }

  // 事件硬钳制：抑制连珠炮 want_continue
  if (inDiscipline) {
    result = {
      ...result,
      end_conversation: false,
      end_reason: undefined,
      skin_change: '',
      desire_next: undefined,
      want_continue: false,
      world_intent: result.world_intent
        ? {
            ...(typeof result.world_intent === 'object' ? result.world_intent : {}),
            move_to: '',
            outfit_action: undefined,
            target_skin: '',
          }
        : { move_to: '', outfit_action: undefined, target_skin: '' },
    };
  }

  // 动作和心声是展示字段。千问路径可本地补齐；本机 Fable Q4 禁止程序代写，必须用模型原文。
  if (
    !isLocalHomeGpuDialoguePath() &&
    (!result.action?.trim() || !result.inner_thought?.trim())
  ) {
    result = {
      ...result,
      action: result.action || '看向指挥官，神情微动',
      inner_thought: result.inner_thought || '先听听指挥官想说什么。',
    };
  }

  if (isProactive) {
    pushRecentChat(living, req.characterId, 'assistant', result.dialogue, {
      action: result.action,
      innerThought: result.inner_thought,
    });
    living.lastTalkAt[req.characterId] = Date.now();
    archivePlayerTurn(
      req.characterId,
      req.turnMode === 'outfit_reveal'
        ? '（换装完成）'
        : req.turnMode === 'continue'
          ? '（接着说）'
          : '（指挥官沉默·角色主动）',
      result.dialogue,
      req.sceneId,
    );
  } else {
    pushRecentChat(living, req.characterId, 'user', req.playerMessage);
    pushRecentChat(living, req.characterId, 'assistant', result.dialogue, {
      action: result.action,
      innerThought: result.inner_thought,
    });
    living.lastTalkAt[req.characterId] = Date.now();
    archivePlayerTurn(req.characterId, req.playerMessage, result.dialogue, req.sceneId);
  }

  evolvePersonaAfterTalk(living, req.characterId, {
    affectionDelta: result.affection_change ?? 0,
    playerMessage: isProactive ? '' : req.playerMessage,
  });
  applyMoodImpulse(living, req.characterId, {
    kind: 'talk',
    affectionDelta: result.affection_change ?? 0,
  });

  if (result.affection_change) {
    adjustAffinity(living, req.characterId, result.affection_change);
  }

  // 同屏对话：与同场同伴微增关系（AI 互动影响角色间好感）
  const coGroup = getCoScreenGroupForCharacter(living, req.characterId);
  if (coGroup && coGroup.memberIds.length >= 2) {
    for (const other of coGroup.memberIds) {
      if (other === req.characterId) continue;
      adjustRelation(living, req.characterId, other, 1);
    }
  }

  // 吃醋：点名角色小幅掉好感
  if (result.trigger_jealousy?.length) {
    for (const otherId of result.trigger_jealousy.slice(0, 3)) {
      if (!otherId || otherId === req.characterId) continue;
      adjustAffinity(living, otherId, -2);
      const cur = new Set(living.characterStatus[otherId] ?? []);
      cur.add('jealousy');
      living.characterStatus[otherId] = [...cur].slice(0, 4) as LightStatusTag[];
      pushMemory(living, otherId, {
        kind: 'event',
        summary: `因指挥官与${req.characterId}的互动而吃味`,
        importance: 3,
      });
    }
  }

  if (result.status_changes?.length) {
    const cur = new Set(living.characterStatus[req.characterId] ?? []);
    for (const s of result.status_changes) {
      cur.add(s as LightStatusTag);
    }
    living.characterStatus[req.characterId] = [...cur].slice(0, 4) as LightStatusTag[];
  }

  // 事件会话：记录 valence、解除姿势等待、消费 justEntered / justLeft
  if (isDisciplineActiveFor(living, req.characterId)) {
    recordDisciplineValenceHint(living, req.characterId, result.discipline_valence as 'tragic' | 'mixed' | 'joyful' | undefined);
    clearDisciplinePoseAwaiting(living, req.characterId);
    consumeDisciplineJustEntered(living, req.characterId);
    if (result.skin_change) {
      result = { ...result, skin_change: '' };
    }
  } else {
    consumeDisciplineJustLeftTurn(living, req.characterId);
    if (
      liveSave &&
      (req.turnMode ?? 'reply') !== 'outfit_reveal'
    ) {
      maybeProposeDisciplineInvite(liveSave, living, req.characterId, result.dialogue);
    }
  }

  const factAsk =
    !isProactive &&
    /[?？]|还记得|上次|昨天|之前|名字|喜欢|讨厌|害怕|约定|告诉/.test(req.playerMessage);
  pushMemory(living, req.characterId, {
    kind: 'talk',
    summary: isProactive
      ? `主动开口：「${result.dialogue.slice(0, 72)}」${
          result.end_conversation ? `｜结束：${result.end_reason || '收束'}` : ''
        }`
      : `玩家：「${req.playerMessage.slice(0, 56)}」→「${result.dialogue.slice(0, 56)}」${
          result.end_conversation ? `｜结束：${result.end_reason || '收束'}` : ''
        }`,
    importance: factAsk ? 7 : result.end_conversation ? 6 : isProactive ? 4 : 5,
  });

  // 玩家交代跑腿且角色答应 → 锁定受保护议程，避免关对话后立刻另起无关主动消息
  if (
    !isProactive &&
    tryCommitPlayerTaskAgenda(living, req.characterId, req.playerMessage, result.dialogue)
  ) {
    pushMemory(living, req.characterId, {
      kind: 'talk',
      summary: `已答应指挥官交代的事，正在办理中：${req.playerMessage.slice(0, 48)}`,
      importance: 9,
    });
    pushCampLog(living, {
      text: `${CHARACTER_MAP[req.characterId]?.name ?? req.characterId} 去办指挥官交代的事了`,
      source: 'npc',
      characterIds: [req.characterId],
    });
  }

  if (result.end_conversation) {
    pushCampLog(living, {
      text: `${req.characterId} 结束了对谈${result.end_reason ? `（${result.end_reason}）` : ''}`,
      source: 'npc',
      characterIds: [req.characterId],
    });
  }

  if (result.interrupt_reaction === 'annoyed' || result.interrupt_reaction === 'angry') {
    const cur = new Set(living.characterStatus[req.characterId] ?? []);
    // 安抚疲惫（anfu_done）后入睡被打扰：疲惫很低=大幅扣好感 + 影响次日心情；
    // 普通睡眠被打扰走原逻辑。
    const anfuTired =
      (living.characterStatus[req.characterId] ?? []).includes('fatigue') &&
      (living.memories?.[req.characterId] ?? []).some(
        (m) => m.kind === 'event' && /安抚值满|安抚疲惫/.test(m.summary ?? ''),
      );
    const tag: LightStatusTag =
      result.interrupt_reaction === 'angry' ? 'anxiety_state' : 'fatigue';
    cur.add(tag);
    living.characterStatus[req.characterId] = [...cur].slice(0, 4) as LightStatusTag[];
    // 模型未扣好感时给保底扣分（性格仍可通过 LLM 的 affection_change 放大）；
    // 安抚疲惫态被打扰：保底翻倍并记高重要记忆（含次日心情语义）
    const floor = result.interrupt_reaction === 'angry' ? (anfuTired ? -8 : -4) : (anfuTired ? -4 : -2);
    if ((result.affection_change ?? 0) > floor) {
      const extra = floor - (result.affection_change ?? 0);
      adjustAffinity(living, req.characterId, extra);
      result = { ...result, affection_change: floor };
    }
    if (anfuTired) {
      pushMemory(living, req.characterId, {
        kind: 'event',
        summary: '安抚满足后的疲惫睡眠被打扰，明日心情都会受影响（语气带刺、容易累）',
        importance: 7,
      });
    }
    if (isDeepSleeping(living, req.characterId)) {
      markSleepDisturbed(
        living,
        req.characterId,
        result.interrupt_reaction === 'angry' ? '睡觉被吵醒后很生气' : '睡觉被吵醒后很烦/疲惫',
      );
    }
  }

  // 睡眠中主动惊醒 / 指挥官让睡 / 对白决定起床（由角色意愿决定，不硬锁）
  {
    const speech = `${result.dialogue ?? ''} ${result.action ?? ''} ${result.end_reason ?? ''}`;
    const wakeOutcome = isProactive
      ? 'none'
      : handleSleepInterruptFromTurn(living, req.characterId, {
          speech,
          interruptReaction: result.interrupt_reaction,
        });
    if (wakeOutcome === 'cant_wake') {
      // 太沉了：这一轮只可能是梦话/翻身，世界与立绘保持睡眠循环
      pushRecentChat(
        living,
        req.characterId,
        'user',
        '【系统事实】她睡得太沉，本轮只发出梦呓/翻身，没有醒来；不得认为自己已起床或已答应任何活动。',
      );
      pushCampLog(living, {
        text: `${CHARACTER_MAP[req.characterId]?.name ?? req.characterId} 睡得太沉，叫不醒（只翻了个身）`,
        source: 'system',
        characterIds: [req.characterId],
      });
    } else if (wakeOutcome === 'kept_sleeping') {
      pushRecentChat(
        living,
        req.characterId,
        'user',
        '【系统事实】她选择继续睡（或赌气不理），仍然在睡觉；不得描写起床做别的事。',
      );
    } else if (wakeOutcome === 'woke') {
      pushRecentChat(
        living,
        req.characterId,
        'user',
        '【系统事实】她已经被叫醒，穿着星夜睡衣起身；可以聊天、换装或去做别的事。',
      );
      pushCampLog(living, {
        text: `${CHARACTER_MAP[req.characterId]?.name ?? req.characterId} 被叫醒（仍穿着星夜睡衣）`,
        source: 'system',
        characterIds: [req.characterId],
      });
    }
    if (
      wakeOutcome !== 'woke' &&
      wakeOutcome !== 'cant_wake' &&
      !isProactive &&
      tryCommitSleepFromDialogue(
        living,
        req.characterId,
        req.playerMessage,
        result.dialogue,
        result.action,
      )
    ) {
      pushMemory(living, req.characterId, {
        kind: 'event',
        summary: '指挥官让睡觉休息，已进入睡眠（立绘切睡眠循环）',
        importance: 6,
      });
      pushCampLog(living, {
        text: `${CHARACTER_MAP[req.characterId]?.name ?? req.characterId} 答应睡觉，进入睡眠恢复电力`,
        source: 'system',
        characterIds: [req.characterId],
      });
      result = { ...result, end_conversation: true, want_continue: false };
    } else if (!isInSleepSystem(living, req.characterId)) {
      // 已醒着：她也可以自己说「再睡会儿」而重新窝回床上（好感小幅下滑）
      if (!maybeReturnToSleepFromSpeech(living, req.characterId, speech) && result.end_conversation) {
        // 刚被叫醒、聊两句指挥官就走 → 她又睡回去（好感 -1）
        sleepBackIfLeftAloneAfterWake(living, req.characterId);
      }
    }
  }

  const outfitRefused = declinesOutfitChange(result.dialogue, result.action);
  // 舞蹈/安抚等独占事件进行中：外观由会话唯一持有，AI 的换装/移动一律丢弃
  // （历史 BUG：舞蹈准备态里模型填了 skin_change → 排在换装队列 → 立绘卡在「换装中」）
  if (
    isDanceActiveFor(living, req.characterId) ||
    isAnfuActiveFor(living, req.characterId) ||
    isDisciplineActiveFor(living, req.characterId)
  ) {
    result = { ...result, skin_change: '', world_intent: undefined };
  }
  if (outfitRefused && !isDisciplineActiveFor(living, req.characterId)) {
    cancelPendingOutfitChange(living, req.characterId);
    result = {
      ...result,
      skin_change: '',
      world_intent:
        result.world_intent && typeof result.world_intent === 'object'
          ? {
              ...result.world_intent,
              outfit_action: undefined,
              target_skin: '',
            }
          : result.world_intent,
    };
  }

  // 舞蹈/浴室/安抚的「邀请待回应」期间，角色说「换衣服/换舞装/等我换好」
  // 是在为事件做准备，不能让通用换装协议把它劫持成「特殊服装01」。
  const eventAskPending =
    Boolean(living.pendingPlayerDanceAsk?.characterId === req.characterId) ||
    Boolean(living.pendingPlayerBathAssistAsk?.characterId === req.characterId) ||
    Boolean(living.pendingPlayerAnfuAsk?.characterId === req.characterId) ||
    Boolean(living.pendingDanceInvite?.characterId === req.characterId) ||
    Boolean(living.pendingBathAssistInvite?.characterId === req.characterId) ||
    Boolean(living.pendingAnfuInvite?.characterId === req.characterId);

  if (
    req.turnMode !== 'outfit_reveal' &&
    !outfitRefused &&
    // 事件邀请待回应期间：角色说「换衣服/等我换好」是在为事件换装，别被通用换装协议
    // 劫持成「特殊服装01」。但模型显式填了 skin_change 时仍尊重之。
    !(eventAskPending && !result.skin_change) &&
    (result.skin_change ||
      OUTFIT_SPEECH_RE.test(
        `${result.dialogue}${result.action ?? ''}${req.playerMessage}`,
      ))
  ) {
    const skinR = processTurnOutfitChange(liveSave, living, req.characterId, result, {
      playerMessage: req.playerMessage,
      dialogue: result.dialogue,
      action: result.action,
      inner_thought: result.inner_thought,
    });
    if (skinR.msg) {
      pushMemory(living, req.characterId, {
        kind: 'event',
        summary: `换装过程：${skinR.msg}`,
        importance: 4,
      });
      console.info(`[outfit-process] ${req.characterId}: ${skinR.msg}`);
    }
    if (skinR.suppressContinue) {
      result = { ...result, want_continue: false };
    }
  }

  // 先处理脱巾门控（须与本轮对白一致），再跟嘴走定地点/皮肤
  {
    const bathR = applyBathIntimateConsentFromAi(
      living,
      req.characterId,
      result.bath_intimate_consent,
      {
        playerMessage: req.playerMessage,
        dialogue: result.dialogue,
        action: result.action,
      },
    );
    if (bathR.changed || bathR.consented) {
      if (bathR.changed) {
        pushMemory(living, req.characterId, {
          kind: 'event',
          summary: bathR.consented
            ? `洗浴互动：解下浴巾（解巾后动态${bathR.source === 'infer' ? '·对白推断' : ''}）`
            : '洗浴互动：仍裹/重新裹浴巾（立绘回冲澡待机）',
          importance: 5,
        });
      }
      if (bathR.consented) {
        applyBatheShowerSkins(liveSave, living);
      }
      result = {
        ...result,
        bath_intimate_consent: bathR.consented,
      };
    }
  }

  // 浴室互动：指挥官提出（按钮/打字）结算 / 角色主动提出（邀请条）/ 结束
  {
    const bathAction = result.bath_assist_action;
    const bathSpeech = `${result.dialogue ?? ''} ${result.action ?? ''} ${result.inner_thought ?? ''}`;

    if (isBathAssistActiveFor(living, req.characterId)) {
      // 互动进行中：只有明确收尾才结束；其余一律当作"还在浴室里"
      if (bathAction === 'end' || detectAiBathAssistEnd(bathSpeech)) {
        const r = leaveBathAssistSession(liveSave, living, { reason: '角色收尾/指挥官叫停' });
        if (r?.systemLine) living.bathAssistUiFlash = r.systemLine;
        result = { ...result, bath_assist_action: undefined };
      }
    } else {
      // 指挥官已提出、等本轮答复：同意→发确认条；拒绝→取消
      const resolved = resolvePlayerBathAssistAskFromTurn(liveSave, living, req.characterId, {
        bathAssistAction: bathAction,
        dialogue: result.dialogue ?? '',
        action: result.action,
      });
      if (resolved) {
        if (resolved.systemLine) living.bathAssistUiFlash = resolved.systemLine;
        result = { ...result, bath_assist_action: undefined };
      } else if (bathAction === 'propose_help' || bathAction === 'propose_co') {
        // 角色主动提出：只挂邀请条，等指挥官确认（不直接拖进场景）
        const mode = bathAction === 'propose_co' ? 'co_bath' : 'help_wash';
        const offered = maybeProposeBathAssistInvite(living, req.characterId, result.dialogue ?? '', mode);
        if (offered) {
          const name = CHARACTER_MAP[req.characterId]?.name ?? req.characterId;
          living.bathAssistUiFlash = `【系统】${name}提出${mode === 'co_bath' ? '一同泡澡' : '帮指挥官清洗'}。点「去浴室」确认后才会开始。`;
        }
        result = { ...result, bath_assist_action: undefined };
      }
    }
  }

  // 舞蹈事件：指挥官邀请结算 / 角色主动邀请 / 停下·继续 / 结束
  {
    const danceAction = result.dance_action;
    const speech = `${result.dialogue ?? ''} ${result.action ?? ''} ${result.inner_thought ?? ''}`;

    if (isDanceActiveFor(living, req.characterId)) {
      const sess = getDanceSession(living)!;
      if (danceAction === 'end') {
        // 结束整个舞蹈事件：换下舞装 + 离开大厅
        const r = leaveDanceSession(liveSave, living, { reason: '角色收尾/指挥官叫停' });
        if (r?.systemLine) living.danceUiFlash = r.systemLine;
        result = { ...result, dance_action: undefined };
      } else if (danceAction === 'stop' || detectAiStopsDance(speech)) {
        // 只是停下休息：回舞蹈待机，事件继续（之后可以再开始/自己换装）
        if (sess.phase === 'dancing') {
          returnToPrepare(liveSave, living, req.characterId);
          living.danceUiFlash = '【系统】停下休息，回到舞蹈待机（舞蹈事件仍在，可以再开始）。';
        }
        result = { ...result, dance_action: undefined };
      } else if (danceAction === 'start_co') {
        if (sess.phase === 'dressing' || sess.phase === 'unveil' || sess.phase === 'travel') {
          sess.mode = 'co';
          living.danceUiFlash =
            sess.phase === 'travel'
              ? '【系统】还在去大厅的路上，到了就一起跳。'
              : sess.phase === 'unveil'
                ? '【系统】正在换演出服，马上一起跳。'
                : '【系统】换好舞装就一起跳。';
        } else if (sess.phase === 'dancing' && sess.mode === 'co') {
          // 已在共舞：保持连续，不重复播「共舞开始」
        } else {
          beginCoDance(liveSave, living, req.characterId);
          living.danceUiFlash = '【系统】换演出服，马上共舞。';
        }
        result = { ...result, dance_action: undefined };
      } else if (
        danceAction === 'start_solo' ||
        (detectAiContinuesDance(speech) && sess.phase !== 'dancing')
      ) {
        if (sess.phase === 'dressing' || sess.phase === 'unveil' || sess.phase === 'travel') {
          sess.mode = 'solo';
          living.danceUiFlash =
            sess.phase === 'travel'
              ? '【系统】还在去大厅的路上，到了就跳。'
              : sess.phase === 'unveil'
                ? '【系统】正在换演出服，马上起舞。'
                : '【系统】换好舞装就开始跳。';
        } else if (sess.phase === 'dancing' && sess.mode === 'solo') {
          setSoloPaused(living, req.characterId, false);
        } else {
          beginSoloDance(liveSave, living, req.characterId);
          living.danceUiFlash = '【系统】换演出服，马上独舞。';
        }
        result = { ...result, dance_action: undefined };
      }
    } else {
      const resolved = resolvePlayerDanceAskFromTurn(liveSave, living, req.characterId, {
        danceAction,
        dialogue: result.dialogue ?? '',
        action: result.action,
      });
      if (resolved) {
        if (resolved.systemLine) living.danceUiFlash = resolved.systemLine;
        if (!resolved.ok) {
          pushMemory(living, req.characterId, {
            kind: 'event',
            summary: resolved.msg,
            importance: 4,
          });
        }
        result = { ...result, dance_action: undefined };
      } else if (danceAction === 'start_co' || danceAction === 'start_solo') {
        // 模型表示愿意：只弹「去大厅」确认条，绝不直接拉进场景
        const mode = danceAction === 'start_co' ? ('co' as const) : ('solo' as const);
        const offered = offerDanceInviteFromTurn(living, req.characterId, mode);
        const name = CHARACTER_MAP[req.characterId]?.name ?? req.characterId;
        if (offered) {
          living.danceUiFlash = `【系统】${name}愿意「${mode === 'co' ? '一同跳舞' : '跳舞给你看'}」。点「去大厅」确认后才会开始。`;
        }
        result = { ...result, dance_action: undefined };
      } else if (danceAction === 'propose_solo' || danceAction === 'propose_co') {
        const mode = danceAction === 'propose_co' ? ('co' as const) : ('solo' as const);
        maybeProposeDanceInvite(living, req.characterId, result.dialogue ?? '', mode);
        result = { ...result, dance_action: undefined };
      }
    }
    consumeDanceJustEntered(living, req.characterId);
  }

  // 安抚室：指挥官邀请结算 / 角色主动邀请 / 攻击结算 / 满足结算 / 结束
  {
    const anfuAction = result.anfu_action;
    const anfuSession = living.anfuSession?.active ? living.anfuSession : null;
    const inAnfu = isAnfuActiveFor(living, req.characterId);

    if (inAnfu && anfuSession) {
      // 安抚事件期间：皮肤/场景由会话独占，AI 的 skin_change 与 world_intent 一律丢弃
      result = { ...result, skin_change: '', world_intent: undefined };
      if (anfuSession.phase === 'soothing') {
        // 攻击结算：awaitingAttackReply 时用本轮 gain 落盘；无锁则视为聊天轮（被动涨幅由 tick 驱动）
        if (anfuSession.awaitingAttackReply) {
          const hasGain = result.anfu_gain != null;
          resolveAnfuAttackGain(liveSave, living, req.characterId, {
            gain: result.anfu_gain,
            fallback: !hasGain,
          });
        }
      }
      // 尾声（安抚值满）：角色也可以主动选择离开；中途仍由玩家点按钮决定。
      // 任何离开都会由 leaveAnfuSession 写入系统事实，并在聊天面板显示。
      const leaveSpeech = /我(?:先|该|要|想)?(?:走|离开|回去|回房)|先回房|先回去|我要走了|该走了/;
      if (anfuSession.phase === 'exhausted') {
        if (
          anfuAction === 'end' ||
          leaveSpeech.test(`${result.dialogue ?? ''} ${result.action ?? ''}`)
        ) {
          const r = leaveAnfuSession(liveSave, living, { reason: 'leave' });
          if (r.systemLine) living.anfuUiFlash = r.systemLine;
        }
      } else if (anfuAction === 'end') {
        living.anfuUiFlash = '【系统】想结束安抚的话，请点「结束安抚」确认。';
      }
      result = { ...result, anfu_action: undefined, anfu_gain: undefined };
    } else {
      const resolved = resolvePlayerAnfuAskFromTurn(liveSave, living, req.characterId, {
        anfuAction,
        dialogue: result.dialogue ?? '',
        action: result.action,
      });
      if (resolved) {
        if (resolved.systemLine) living.anfuUiFlash = resolved.systemLine;
        if (!resolved.ok) {
          pushMemory(living, req.characterId, {
            kind: 'event',
            summary: resolved.msg,
            importance: 4,
          });
        }
        result = { ...result, anfu_action: undefined, anfu_gain: undefined };
      } else if (anfuAction === 'start') {
        // 模型表示愿意：只弹确认条，绝不直接拉人进安抚室
        const offered = offerAnfuInviteFromTurn(living, req.characterId);
        const name = CHARACTER_MAP[req.characterId]?.name ?? req.characterId;
        if (offered) {
          living.anfuUiFlash = `【系统】${name}愿意去安抚室。点「去安抚室」确认后才会过去。`;
        }
        result = { ...result, anfu_action: undefined, anfu_gain: undefined };
      } else if (anfuAction === 'propose') {
        maybeProposeAnfuInvite(living, req.characterId, result.dialogue ?? '');
        result = { ...result, anfu_action: undefined, anfu_gain: undefined };
      } else {
        // 非安抚上下文：角色对白里顺口提到安抚 → 转邀请条（需资源/每日门）
        if (anfuAction == null && detectAiAnfuPropose(`${result.dialogue ?? ''} ${result.action ?? ''}`)) {
          maybeProposeAnfuInvite(living, req.characterId, result.dialogue ?? '');
        }
      }
    }
    consumeAnfuJustEntered(living, req.characterId);
  }

  // 小游戏（五子棋/猜拳）：对局中认输 / 会话外邀请结算 / 角色主动邀请 / 赛后约定应答
  {
    const minigameAction = result.minigame_action;
    const mgSpeech = `${result.dialogue ?? ''} ${result.action ?? ''} ${result.inner_thought ?? ''}`;

    if (isMiniGameActiveFor(living, req.characterId)) {
      // 对局为独立事件：棋局走面板与本地引擎，LLM 只允许口头认输（quit），其余一律无视
      if (minigameAction === 'quit') {
        const r = aiQuitMiniGame(liveSave, living);
        if (r.systemLine) living.miniGameUiFlash = r.systemLine;
      }
      result = { ...result, minigame_action: undefined };
    } else {
      const resolved = resolvePlayerMiniGameAskFromTurn(liveSave, living, req.characterId, {
        minigameAction,
        dialogue: result.dialogue ?? '',
        action: result.action,
      });
      if (resolved) {
        if (resolved.systemLine) living.miniGameUiFlash = resolved.systemLine;
        if (!resolved.ok) {
          pushMemory(living, req.characterId, {
            kind: 'event',
            summary: resolved.msg,
            importance: 4,
          });
        }
        result = { ...result, minigame_action: undefined };
      } else if (minigameAction === 'start_gomoku' || minigameAction === 'start_rps') {
        // 模型表示愿意：只弹确认条，绝不直接开局
        const kind = minigameAction === 'start_gomoku' ? ('gomoku' as const) : ('rps' as const);
        const offered = offerMiniGameInviteFromTurn(living, req.characterId, kind);
        const name = CHARACTER_MAP[req.characterId]?.name ?? req.characterId;
        if (offered) {
          living.miniGameUiFlash = `【系统】${name}愿意和你来一局${kind === 'gomoku' ? '五子棋' : '猜拳'}。点「开始」确认后才会开局。`;
        }
        result = { ...result, minigame_action: undefined };
      } else if (minigameAction === 'propose_gomoku' || minigameAction === 'propose_rps') {
        const kind = minigameAction === 'propose_gomoku' ? ('gomoku' as const) : ('rps' as const);
        maybeProposeMiniGameInvite(living, req.characterId, result.dialogue ?? '', kind);
        result = { ...result, minigame_action: undefined };
      } else if (minigameAction === 'accept_stake' || minigameAction === 'refuse_stake') {
        const stakeLine = resolveMiniGameStake(living, req.characterId, minigameAction === 'accept_stake');
        if (stakeLine) living.miniGameUiFlash = stakeLine;
        result = { ...result, minigame_action: undefined };
      } else if (minigameAction == null) {
        // 非小游戏上下文：角色对白里顺口提到想玩 → 转邀请条（需房间门）
        const kindHint = detectAiMiniGamePropose(mgSpeech);
        if (kindHint) maybeProposeMiniGameInvite(living, req.characterId, result.dialogue ?? '', kindHint);
      }
    }
    consumeMiniGameJustEntered(living, req.characterId);
  }

  // 亲密氛围：亲近区刺激落盘（浴室 / 暧昧话题）
  {
    const adultCtx = detectAdultEventContext({
      living,
      characterId: req.characterId,
      userText: req.playerMessage || '',
      assistantText: `${result.dialogue || ''} ${result.action || ''}`,
    });
    const stimR = applyAdultEventFromLlm({
      living,
      characterId: req.characterId,
      ctx: adultCtx,
      fields: {
        stim_target: result.stim_target,
        stim_zones: result.stim_zones,
        stim_intensity: result.stim_intensity,
        stim_duration: result.stim_duration,
        adult_odd_mood: result.adult_odd_mood,
        oil_discharge: result.oil_discharge,
      },
    });
    if (stimR.applied && 'msg' in stimR && stimR.msg) {
      pushMemory(living, req.characterId, {
        kind: 'event',
        summary: `亲近氛围：${stimR.msg}`,
        importance: 5,
      });
      console.info(`[intimacy] ${req.characterId}: ${stimR.msg}`);
    }
  }

  {
    const worldR = syncDialogueWorldRealtime(liveSave, living, req.characterId, {
      playerMessage: req.playerMessage,
      dialogue: result.dialogue,
      action: result.action,
      inner_thought: result.inner_thought,
      scene_beat: result.scene_beat,
      world_intent: result.world_intent,
    });
    if (worldR.msg) {
      console.info(`[world-sync] ${req.characterId}: ${worldR.msg}`);
    }
    saveManager.mutate((d) => {
      d.aiLiving = living;
    });
    opts?.onWorldSynced?.();
  }

  if (result.desire_next) {
    const d = applyDesireNextFromDialogue(living, req.characterId, result.desire_next, {
      presentSpeech: `${result.dialogue} ${result.action ?? ''} ${result.inner_thought ?? ''} ${result.scene_beat ?? ''}`,
    });
    if (d.ok) {
      console.info(`[desire_next] ${req.characterId}: ${d.msg}`);
    }
  }

  // 对话收束：挂起欲望才开始走路（此刻画面已由对白锁死）
  if (result.end_conversation) {
    const committed = commitPendingDesireAfterDialogue(living, req.characterId);
    if (committed.ok) {
      console.info(`[desire-commit] ${req.characterId}: ${committed.msg}`);
    }
  }

  saveManager.mutate((d) => {
    d.aiLiving = living;
  });
  opts?.onWorldSynced?.();

  if (living.pendingItemOffer?.toCharacterId === req.characterId) {
    const campAction =
      result.camp_item_action && typeof result.camp_item_action === 'object'
        ? (result.camp_item_action as CampItemActionPayload)
        : null;
    const pendingSettle = settlePendingItemOffer(
      liveSave,
      living,
      req.characterId,
      campAction,
      result.dialogue,
      result.item_offer_resolution,
    );
    if (pendingSettle.handled) {
      if (pendingSettle.msg) {
        result = {
          ...result,
          camp_item_result: pendingSettle.ok
            ? pendingSettle.msg
            : `失败：${pendingSettle.msg}`,
        };
        if (!pendingSettle.ok) {
          pushMemory(living, req.characterId, {
            kind: 'event',
            summary: `道具动作失败：${pendingSettle.msg}`,
            importance: 4,
          });
        }
      }
    }
  } else if (result.camp_item_action && typeof result.camp_item_action === 'object') {
    const eco = applyCampItemAction(
      liveSave,
      living,
      req.characterId,
      result.camp_item_action as CampItemActionPayload,
    );
    if (eco.msg) {
      result = { ...result, camp_item_result: eco.ok ? eco.msg : `失败：${eco.msg}` };
      if (!eco.ok) {
        pushMemory(living, req.characterId, {
          kind: 'event',
          summary: `道具动作失败：${eco.msg}`,
          importance: 4,
        });
      }
    }
  }

  if (result.memory_write) {
    pushMemory(living, req.characterId, {
      kind: 'talk',
      summary: result.memory_write,
      importance: 7,
    });
  } else if (result.scene_beat) {
    pushMemory(living, req.characterId, {
      kind: 'talk',
      summary: `节拍：${result.scene_beat}`,
      importance: 4,
    });
  }

  ingestFactsFromDialogueTurn(living, req.characterId, {
    playerMessage: req.playerMessage,
    dialogue: result.dialogue,
    memoryWrite: result.memory_write,
  });

    return result;
  } finally {
    // Only the request that still owns this character may clear the lease.
    opts?.signal?.removeEventListener('abort', abortFromCaller);
    finishDialogueRequest(lease);
  }
}

export type NpcPairResult = {
  lines: { characterId: string; emotion: string; dialogue: string }[];
  summary: string;
  relation_change?: number;
};

export async function runNpcPairEvent(
  living: AiLivingSave,
  a: string,
  b: string,
  sceneId: string,
  save?: SaveData | null,
  motive?: string,
): Promise<NpcPairResult> {
  const liveSave = save ?? saveManager.get();
  const { system, user } = assembleNpcPairMessages(living, a, b, sceneId, liveSave, motive);
  const raw = await chatJsonRouted<NpcPairResult>(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { channel: 'dialogue', maxTokens: 500 },
  );

  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  const summary = raw.summary || `${a} 与 ${b} 短暂交谈`;
  const delta = typeof raw.relation_change === 'number' ? raw.relation_change : 1;
  adjustRelation(living, a, b, delta);

  pushCampLog(living, {
    text: summary,
    source: 'npc',
    characterIds: [a, b],
  });
  pushMemory(living, a, { kind: 'event', summary, importance: 3 });
  pushMemory(living, b, { kind: 'event', summary, importance: 3 });
  archiveNpcTurn(a, b, lines, sceneId, summary);

  return { lines, summary, relation_change: delta };
}
