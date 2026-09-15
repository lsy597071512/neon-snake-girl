/**
 * 对话 ↔ 世界实时同步（AI 主导·通用）：
 * 皮肤与场景只跟对白「此刻」走；规划句 / desire_next 不切景。
 * 任意房间同一套规则，不绑死浴室↔武器库特例。
 */
import {
  BATHE_TEMP_SKIN_INSTANCE,
  getCharacterSkins,
  LIFEWEAR_SKIN_ID,
  POOL_PARTY_SKIN_ID,
  SHOWER_SKIN_ID,
  SLEEPWEAR_SKIN_ID,
} from '../data/characterSkins';
import { CAMP_ROOM_MAP } from '../data/campLayout';
import { CHARACTER_MAP } from '../data/characters';
import type { SaveData } from '../types';
import { snapAgentToRoom } from './campAgents';
import { applyBatheShowerSkins } from './campEvents/campEventEffects';
import {
  getAgenda,
  isProtectedAgenda,
  setAgenda,
} from './characterAgenda';
import { getCampLogicalSkinId, hasLifewearAsset } from './campOutfit';
import { clearBathIntimateConsentIfNotBathing, setBathIntimateConsent } from './bathIntimateConsent';
import {
  ROOM_PRESENCE_LEXICON,
  coerceActivityToRoom,
  defaultActivityForRoom,
  inferPresentRoomFromSpeech,
} from './dialoguePresence';
import { resolveCharacterRoomId, resolvePresence } from './livingState';
import { pushMemory } from './memory';
import {
  isMidChangeSpeech,
  shouldHoldAutoOutfit,
  holdOutfitForNarrative,
  schedulePresenceOutfitChange,
  getPendingOutfitChange,
  applyPendingOutfitChangeNow,
  normalizeSkinChangeWant,
} from './outfitChangeProcess';
import { preloadRoomSceneImage } from './assetPreload';
import { isInSleepSystem, tryWakeFromSpeech } from './sleepSystem';
import { declinesOutfitChange } from './outfitChangeProcess';
import { disciplineBodyBehavior, getDisciplineSession, isDisciplineActiveFor } from './disciplineSession';
import { setCampWornSkin } from './campOutfit';
import type {
  AiLivingSave,
  CharacterActivity,
  CharacterAgenda,
  LlmDialogueResult,
} from './types';

export type DialogueWorldSyncResult = {
  moved: boolean;
  skinned: boolean;
  roomId: string;
  activity: CharacterActivity;
  msg: string;
};

function behaviorForRoom(roomId: string, activity: CharacterActivity, reason: string): string {
  const label = CAMP_ROOM_MAP[roomId]?.label ?? roomId;
  if (activity === 'bathe') return `在${label}洗浴/冲澡`;
  if (activity === 'maintain' && roomId === 'room_1f_armory') return `在武器库点检武装`;
  if (activity === 'play' && roomId === 'room_1f_pool') return `在泳池活动`;
  if (activity === 'sleeping') return `在${label}休息`;
  if (activity === 'guard') return `在${label}执勤`;
  if (activity === 'eat') return `在${label}用餐`;
  return reason ? `${reason}（在${label}）` : `在${label}`;
}

/**
 * 只根据 AI 对白/动作定「此刻」房间。
 * P2：world_intent.move_to（结构化）优先——免正则误判；文本推断降级为兜底。
 * desire_next / 规划句里的地点一律不参与切景。
 */
function resolveTargetRoom(
  characterId: string,
  turn: { dialogue: string; action?: string; scene_beat?: string; world_intent?: LlmDialogueResult['world_intent'] },
  currentRoomId: string,
): { roomId: string; reason: string } | null {
  // ① 结构化意图：模型显声明的「此刻」位置，直接采信（房间合法性校验）
  const intent = turn.world_intent;
  const intentRoom = typeof intent === 'object' && intent ? intent.move_to?.trim() : '';
  if (intentRoom && CAMP_ROOM_MAP[intentRoom]) {
    return { roomId: intentRoom, reason: 'world_intent.move_to' };
  }

  // ② 文本推断兜底
  const speech = `${turn.dialogue} ${turn.action ?? ''} ${turn.scene_beat ?? ''}`.trim();
  const inferred = inferPresentRoomFromSpeech(speech, characterId, currentRoomId);
  if (!inferred.roomId) return null;
  // 延续当前：仍回写，好让活动/皮肤与现场对齐
  return { roomId: inferred.roomId, reason: inferred.reason };
}

/** 流式中途：仅当推断出明确「此刻」房间时可推测切景 */
export function inferAiPresenceRoomFromSpeech(
  speech: string,
  characterId = '',
  currentRoomId?: string | null,
): string | null {
  return inferPresentRoomFromSpeech(speech, characterId, currentRoomId).roomId;
}

/** 对话世界同步提交「此刻身体」账本；resolvePresence 优先读它而非按时钟重算作息 */
function writeBodyAnchor(
  living: AiLivingSave,
  characterId: string,
  roomId: string,
  activity: CharacterActivity,
  behavior: string,
): void {
  if (!living.bodyAnchors) living.bodyAnchors = {};
  const prev = living.bodyAnchors[characterId];
  living.bodyAnchors[characterId] = {
    roomId,
    activity,
    behavior,
    atGameMin: living.gameMinutes,
    seq: (prev?.seq ?? 0) + 1,
  };
}

/**
 * 按当前房间/活动对齐营地皮肤。
 * 全部走延时换装协议（可取消、立绘停旧衣）——唯一例外是浴室毛巾「无中间叙事」时仍可瞬时。
 * 任何「正在脱/拉链卡住/还在换」的中间过程叙事都会压住瞬时路径（总闸门在 shouldHoldAutoOutfit）。
 */
export function syncOutfitToCurrentPresence(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  speech = '',
): { changed: boolean; msg: string } {
  // 调教专用临时皮由 disciplineSession 持有，普通场景换装不可清除或改写。
  if (isDisciplineActiveFor(living, characterId)) {
    return { changed: false, msg: '' };
  }
  if (shouldHoldAutoOutfit(living, characterId)) {
    return { changed: false, msg: '' };
  }
  const presence = resolvePresence(characterId, living);
  const roomId = presence.roomId;
  const skins = getCharacterSkins(characterId);
  const has = (id: string) => skins.some((s) => s.id === id);
  const worn = getCampLogicalSkinId(living, characterId);
  const temp = living.eventTempSkins?.[characterId];
  const midChange = isMidChangeSpeech(speech);
  if (midChange) {
    holdOutfitForNarrative(living, characterId, speech.slice(0, 40));
  }

  // 浴室 → 蒸汽毛巾。有中间过程叙事时改走延时协议（立绘停在旧衣，等「换好了」收尾）
  if (roomId === 'room_1f_bath') {
    if (has(SHOWER_SKIN_ID)) {
      const alreadyShower =
        temp?.skinId === SHOWER_SKIN_ID || worn === SHOWER_SKIN_ID;
      if (!alreadyShower) {
        if (midChange) {
          const q = schedulePresenceOutfitChange(living, characterId, SHOWER_SKIN_ID);
          return { changed: q.queued, msg: q.msg ? `对齐浴室（换装中）：${q.msg}` : '' };
        }
        applyBatheShowerSkins(save, living);
        return { changed: true, msg: '对齐浴室：蒸汽毛巾' };
      }
    }
    return { changed: false, msg: '' };
  }

  // 离开浴室：清冲澡临时皮与同浴同意；回生活服装走延时（勿瞬间裸切）
  if (temp?.skinId === SHOWER_SKIN_ID || temp?.eventInstanceId === BATHE_TEMP_SKIN_INSTANCE) {
    delete living.eventTempSkins![characterId];
  }
  clearBathIntimateConsentIfNotBathing(living, characterId);
  if (living.bathIntimateConsent?.[characterId]) {
    setBathIntimateConsent(living, characterId, false);
  }

  // 泳池 → 泳装（延时）
  if (roomId === 'room_1f_pool' && has(POOL_PARTY_SKIN_ID)) {
    if (worn !== POOL_PARTY_SKIN_ID) {
      const q = schedulePresenceOutfitChange(living, characterId, POOL_PARTY_SKIN_ID);
      return { changed: q.queued, msg: q.msg ? `对齐泳池：${q.msg}` : '' };
    }
    return { changed: false, msg: '' };
  }

  // 睡觉 → 睡衣（延时）；睡眠系统准备/睡着相位也强制睡衣
  if (
    (presence.activity === 'sleeping' || isInSleepSystem(living, characterId)) &&
    has(SLEEPWEAR_SKIN_ID)
  ) {
    if (worn !== SLEEPWEAR_SKIN_ID) {
      const q = schedulePresenceOutfitChange(living, characterId, SLEEPWEAR_SKIN_ID);
      return { changed: q.queued, msg: q.msg ? `对齐睡眠：${q.msg}` : '' };
    }
    return { changed: false, msg: '' };
  }

  // 仍在睡眠系统内时禁止扒睡衣
  if (isInSleepSystem(living, characterId)) {
    return { changed: false, msg: '' };
  }

  const kind = CAMP_ROOM_MAP[roomId]?.kind;
  const act = String(presence.activity || '');
  // 仅军械/塔楼/机械/执勤活动 → 默认装甲；大厅/商店/院子闲逛不强制装甲
  const needArmor =
    kind === 'armory' ||
    kind === 'tower' ||
    kind === 'mechanical' ||
    act === 'maintain' ||
    act === 'guard' ||
    act === 'patrol' ||
    (kind === 'yard' && (act === 'busy' || act === 'maintain'));

  if (needArmor) {
    if (worn) {
      const q = schedulePresenceOutfitChange(living, characterId, 'default');
      return { changed: q.queued, msg: q.msg ? `对齐执勤/军械：${q.msg}` : '' };
    }
    return { changed: false, msg: '' };
  }

  // 非执勤：装甲、或已离开泳池/浴室的情境皮 → 回生活服装（不自动扒都市私服/特殊服装）
  const leaveSituational =
    worn == null ||
    worn === SHOWER_SKIN_ID ||
    (worn === POOL_PARTY_SKIN_ID && roomId !== 'room_1f_pool');

  if (
    leaveSituational &&
    hasLifewearAsset(characterId) &&
    (worn as string | null) !== LIFEWEAR_SKIN_ID
  ) {
    const q = schedulePresenceOutfitChange(living, characterId, LIFEWEAR_SKIN_ID);
    return { changed: q.queued, msg: q.msg ? `对齐营地日常：${q.msg}` : '' };
  }

  return { changed: false, msg: '' };
}

/** world_intent.outfit_action 的确定性执行（start=排队预载；finish=到点即穿） */
function applyWorldIntentOutfit(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  intent: LlmDialogueResult['world_intent'],
): string | null {
  if (!intent || typeof intent !== 'object') return null;
  const action = intent.outfit_action;
  if (!action) return null;

  if (action === 'start') {
    const want = normalizeSkinChangeWant(characterId, intent.target_skin ?? '');
    if (!want) return null;
    const q = schedulePresenceOutfitChange(living, characterId, want);
    return q.msg || null;
  }

  if (action === 'finish') {
    const pending = getPendingOutfitChange(living, characterId);
    if (!pending) return null;
    // 微防抖：模型刚说「去换」下一拍就 finish 不可信；≥1.2s 视为真实完成
    if (Date.now() - pending.announcedAtMs < 1200) return null;
    const r = applyPendingOutfitChangeNow(save, living, characterId);
    return r.applied ? r.msg || null : null;
  }
  return null;
}

function applyMoveAndOutfit(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  target: { roomId: string; reason: string },
  speech: string,
  opts?: { silentMemory?: boolean; worldIntent?: LlmDialogueResult['world_intent'] },
): DialogueWorldSyncResult {
  const curRoom = resolveCharacterRoomId(characterId, living);
  let moved = false;
  let roomId = curRoom;
  let activity = resolvePresence(characterId, living).activity;
  const bits: string[] = [];
  const curAgenda = getAgenda(living, characterId);
  const protectedEv = isProtectedAgenda(living, curAgenda);

  if (target.roomId !== curRoom && !protectedEv) {
    roomId = target.roomId;
    activity = coerceActivityToRoom(
      roomId,
      defaultActivityForRoom(roomId, speech),
      speech,
    );
    const behavior = behaviorForRoom(roomId, activity, target.reason);
    const agenda: CharacterAgenda = {
      goal: `sync:${roomId}`,
      targetRoomId: roomId,
      activity,
      behavior,
      remainGameMin: Math.max(45, curAgenda?.remainGameMin ?? 60),
      startedGameMin: living.gameMinutes,
      reason: target.reason,
      source: 'llm',
    };
    setAgenda(living, characterId, agenda);
    snapAgentToRoom(characterId, roomId, { activity, behavior });
    moved = true;
    bits.push(`地点→${CAMP_ROOM_MAP[roomId]?.label ?? roomId}`);
    // 切景意图落地前预热目标房间场景图（零加载换景）
    preloadRoomSceneImage(roomId, living);
  } else if (target.roomId === curRoom) {
    activity = coerceActivityToRoom(
      curRoom,
      defaultActivityForRoom(curRoom, speech),
      speech,
    );
    const behavior = behaviorForRoom(curRoom, activity, target.reason);
    if (
      !curAgenda ||
      curAgenda.activity !== activity ||
      curAgenda.targetRoomId !== curRoom ||
      curAgenda.reason !== target.reason
    ) {
      setAgenda(living, characterId, {
        ...(curAgenda ?? {
          goal: `sync:${curRoom}`,
          remainGameMin: 60,
          startedGameMin: living.gameMinutes,
          source: 'llm' as const,
        }),
        targetRoomId: curRoom,
        activity,
        behavior,
        reason: target.reason,
        source: 'llm',
      });
      snapAgentToRoom(characterId, curRoom, { activity, behavior });
      bits.push(`意图对齐→${CAMP_ROOM_MAP[curRoom]?.label ?? curRoom}`);
    }
  }

  // world_intent.outfit_action 先于房间对齐执行：start 排队后 shouldHoldAutoOutfit
  // 会压住 syncOutfit 的「浴室瞬时毛巾」路径，避免结构化意图被瞬时切换吃掉
  const intentMsg = applyWorldIntentOutfit(save, living, characterId, opts?.worldIntent);
  const skinR = syncOutfitToCurrentPresence(save, living, characterId, speech);
  if (skinR.changed) bits.push(skinR.msg);
  if (intentMsg) bits.push(intentMsg);

  // 提交身体锚点：对话后世界记住「她在这」；作息表不得在锚点新鲜期内瞬移她
  {
    const p = resolvePresence(characterId, living);
    writeBodyAnchor(living, characterId, p.roomId, p.activity, p.behavior);
  }

  const msg = bits.join('；');
  if (msg && !opts?.silentMemory) {
    const name = CHARACTER_MAP[characterId]?.name ?? characterId;
    pushMemory(living, characterId, {
      kind: 'event',
      summary: `${name}对话世界同步：${msg}`,
      importance: 4,
    });
  }

  const presence = resolvePresence(characterId, living);
  return {
    moved,
    skinned: skinR.changed,
    roomId: presence.roomId,
    activity: presence.activity,
    msg,
  };
}

/**
 * 本轮对白结束后：身体立刻跟 AI「此刻」走（地点+皮肤）。
 */
export function syncDialogueWorldRealtime(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  turn: {
    playerMessage?: string;
    dialogue: string;
    action?: string;
    inner_thought?: string;
    scene_beat?: string;
    world_intent?: LlmDialogueResult['world_intent'];
    /** @deprecated 已不参与切景 */
    desire_next?: LlmDialogueResult['desire_next'];
  },
): DialogueWorldSyncResult {
  // 小黑屋是物理锁定场景：模型对白中的睡觉、移动、换装描述只属于叙事，
  // 不能反向修改已经落地的房间/皮肤/活动状态。
  if (isDisciplineActiveFor(living, characterId)) {
    const presence = resolvePresence(characterId, living);
    const pose = getDisciplineSession(living)?.poseIndex ?? null;
    writeBodyAnchor(
      living,
      characterId,
      presence.roomId,
      'talking',
      disciplineBodyBehavior(pose),
    );
    return {
      moved: false,
      skinned: false,
      roomId: presence.roomId,
      activity: 'talking',
      msg: '',
    };
  }

  const speechAll = `${turn.dialogue} ${turn.action ?? ''} ${turn.inner_thought ?? ''} ${turn.scene_beat ?? ''} ${turn.playerMessage ?? ''}`;
  const charSpeechOnly = `${turn.dialogue} ${turn.action ?? ''} ${turn.inner_thought ?? ''} ${turn.scene_beat ?? ''}`;
  const outfitRefused = declinesOutfitChange(turn.dialogue, turn.action);
  // 醒来只认角色自己的对白，别把指挥官原话里的「起来」误当成角色要醒
  tryWakeFromSpeech(living, characterId, charSpeechOnly);

  const wasSleeping = isInSleepSystem(living, characterId);
  const curRoom = resolveCharacterRoomId(characterId, living);
  const target = resolveTargetRoom(
    characterId,
    {
      dialogue: turn.dialogue,
      action: turn.action,
      scene_beat: turn.scene_beat,
      world_intent: turn.world_intent,
    },
    curRoom,
  );
  let result: DialogueWorldSyncResult;
  if (!target) {
    // intent 先行（同 applyMoveAndOutfit 的顺序理由）
    const intentMsg = outfitRefused
      ? null
      : applyWorldIntentOutfit(save, living, characterId, turn.world_intent);
    // 拒绝换装只拦 world_intent/玩家点名换衣，执勤/睡眠等场景对齐仍要走
    const skinR = syncOutfitToCurrentPresence(save, living, characterId, speechAll);
    const presence = resolvePresence(characterId, living);
    // 无地点信号时仍纠活动与房间相容性
    const fixed = coerceActivityToRoom(presence.roomId, presence.activity, '');
    if (fixed !== presence.activity) {
      snapAgentToRoom(characterId, presence.roomId, {
        activity: fixed,
        behavior: behaviorForRoom(presence.roomId, fixed, '纠活动'),
      });
    }
    const presence2 = resolvePresence(characterId, living);
    // 锚点续期：对话进行中身体账本始终新鲜（长对话也不被作息表抢走）
    writeBodyAnchor(
      living,
      characterId,
      presence2.roomId,
      presence2.activity,
      presence2.behavior,
    );
    const msg = [skinR.msg, intentMsg].filter(Boolean).join('；');
    result = {
      moved: false,
      skinned: skinR.changed || !!intentMsg,
      roomId: presence2.roomId,
      activity: presence2.activity,
      msg,
    };
  } else {
    result = applyMoveAndOutfit(save, living, characterId, target, speechAll, {
      worldIntent: outfitRefused ? undefined : turn.world_intent,
    });
  }

  // 刚脱离睡眠系统：强制星夜睡衣站立（禁止裸回装甲）
  if (wasSleeping && !isInSleepSystem(living, characterId)) {
    if (getCharacterSkins(characterId).some((s) => s.id === SLEEPWEAR_SKIN_ID)) {
      setCampWornSkin(living, characterId, SLEEPWEAR_SKIN_ID);
      result = {
        ...result,
        skinned: true,
        msg: result.msg
          ? `${result.msg}；脱离睡眠→星夜睡衣`
          : '脱离睡眠→同步星夜睡衣',
      };
    }
  }
  return result;
}

/**
 * 流式对白中途的乐观同步（P2·网络延迟对策）：
 * 只认「已说完的整句」+ 高置信现在时模式（我就在××/已经到××/正在××动词），
 * 只做房间级乐观锚点（皮肤一律等协议/整包 JSON），整包到达后由
 * syncDialogueWorldRealtime 全量对账覆盖——乐观错了也会被纠正。
 */
const OPTIMISTIC_EXPLICIT_RE =
  /(?:我们|咱们|我)(?:现在|已经|早就|就)?(?:还)?就在?|已经到了?|正在(?:这(?:里|儿)?)?/;

export function syncDialogueWorldFromPartialSpeech(
  _save: SaveData,
  living: AiLivingSave,
  characterId: string,
  partialDialogue: string,
): DialogueWorldSyncResult | null {
  const text = (partialDialogue ?? '').trim();
  if (text.length < 4) return null;

  // 只取已说完的整句（最后一句未说完不算——半句误切是老坑）
  const completed = text.split(/[。！？!?…\n]/).slice(0, -1).join('。');
  if (completed.trim().length < 4) return null;

  const curRoom = resolveCharacterRoomId(characterId, living);
  const inferred = inferPresentRoomFromSpeech(completed, characterId, curRoom);
  if (!inferred.roomId || inferred.holdingCurrent) return null;
  if (inferred.roomId === curRoom) return null;

  // 高置信门槛：同一句里必须同时出现「显式现在时标记」+ 该房间名词/现场动作，
  // 防「之后去泳池」「浴室热水还够吗」类提及误发乐观切景。
  const clauses = completed.split(/[。！？!?…\n]/).filter((c) => c.trim());
  const lex = ROOM_PRESENCE_LEXICON.find((l) => l.roomId === inferred.roomId);
  const mentioned = clauses.some(
    (c) =>
      OPTIMISTIC_EXPLICIT_RE.test(c) &&
      ((lex?.nouns.test(c) ?? false) || (lex?.doingNow.test(c) ?? false)),
  );
  if (!mentioned) return null;

  const activity = defaultActivityForRoom(inferred.roomId, completed);
  snapAgentToRoom(characterId, inferred.roomId, {
    activity,
    behavior: behaviorForRoom(inferred.roomId, activity, '乐观同步'),
  });
  writeBodyAnchor(living, characterId, inferred.roomId, activity, behaviorForRoom(inferred.roomId, activity, '乐观同步'));
  preloadRoomSceneImage(inferred.roomId, living);
  return {
    moved: true,
    skinned: false,
    roomId: inferred.roomId,
    activity,
    msg: `乐观切景→${CAMP_ROOM_MAP[inferred.roomId]?.label ?? inferred.roomId}（待整包对账）`,
  };
}
