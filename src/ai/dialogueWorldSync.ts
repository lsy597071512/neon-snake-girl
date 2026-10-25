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
import { isDanceActiveFor } from './danceSession';
import { captureDialogueSceneSnapshot, commitDialogueSceneSnapshot } from './dialogueSceneSync';
import { planTravel } from './travel';
import { BATH_ASSIST_ROOM_ID, isBathAssistActiveFor } from './bathAssistSession';
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
  inferRoomFromText,
} from './dialoguePresence';
import { resolveCharacterRoomId, resolvePresence } from './livingState';
import { pushMemory } from './memory';import {
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
import { recordPlayerActivityRequest } from './activityFatigue';
import { disciplineBodyBehavior, getDisciplineSession, isDisciplineActiveFor } from './disciplineSession';
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
  // 独占临时皮由会话持有，普通场景换装不可清除或改写。
  if (isDisciplineActiveFor(living, characterId)) {
    return { changed: false, msg: '' };
  }
  const anfuSession = living.anfuSession;
  if (anfuSession?.active && anfuSession.characterId === characterId) {
    // 安抚室三相皮由会话独占，任何场景/情绪换装都必须让位
    return { changed: false, msg: '' };
  }
  // 舞蹈事件：舞装由会话独占（换装相/待机皮/演出皮），场景同步不得插手
  if (isDanceActiveFor(living, characterId)) {
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

  // 浴室 → 浴巾/泡澡服。任何时候都走"先换衣再显形"的临时皮排队（不瞬间挂浴巾）
  if (roomId === 'room_1f_bath') {
    if (has(SHOWER_SKIN_ID)) {
      const alreadyShower =
        temp?.skinId === SHOWER_SKIN_ID || worn === SHOWER_SKIN_ID;
      if (!alreadyShower) {
        applyBatheShowerSkins(save, living);
        return {
          changed: true,
          msg: midChange
            ? '对齐浴室：正在换洗浴外覆（换装中）'
            : '对齐浴室：换上浴巾/泡澡服（换装中）',
        };
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
  // 仅军械/塔楼/机械间，或在其中执勤/点检 → 默认装甲。
  // 大厅/院子/宿舍里「随手修点东西(maintain)」不算执勤：营地装甲占比必须很低。
  const onDutyActivity = act === 'maintain' || act === 'guard' || act === 'patrol';
  const dutyPlace =
    kind === 'armory' || kind === 'tower' || kind === 'mechanical' || roomId === 'room_1f_armory';
  const needArmor = dutyPlace && onDutyActivity;

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
  const anfuSession = living.anfuSession;
  if (anfuSession?.active && anfuSession.characterId === characterId) return null;
  if (isDanceActiveFor(living, characterId)) return null;
  const action = intent.outfit_action;
  if (!action) return null;

  if (action === 'start') {
    const want = normalizeSkinChangeWant(characterId, intent.target_skin ?? '');
    if (!want) return null;
    // 重复活动厌倦：今天第 N 次让她换装（超耐心阈值会打厌倦脉冲）
    recordPlayerActivityRequest(living, characterId, 'outfit');
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
    // 移动要有路程：登记行程，到点才落点/切场景（不再瞬移）
    const travel = planTravel(living, characterId, roomId, curRoom, {
      activity,
      behavior,
      reason: 'dialogue_move',
      arriveBehavior: behavior,
    });
    if (!travel.started) {
      snapAgentToRoom(characterId, roomId, { activity, behavior });
    }
    moved = true;
    bits.push(`地点→${CAMP_ROOM_MAP[roomId]?.label ?? roomId}（路上约 ${Math.round(travel.etaMs / 1000)} 秒）`);
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
 * 指挥官指路 → 角色答应后要「真的走过去」。
 * 历史 BUG：玩家说「一起去大厅看看吧」，角色嘴上答应「走吧」，但没有任何
 * world_intent.move_to，于是人一直待在原地反复说「等我把热可可放好就去」。
 * 这里在 AI **没有**自己申报 move_to 时兜底：只要玩家点了目的地 + 角色同意
 * （且没有拒绝/没声称在别处），就用 planTravel 走同一套走路路线。
 */
function resolvePlayerDirectedMove(
  characterId: string,
  playerMessage: string | undefined,
  dialogue: string,
  action: string | undefined,
  curRoom: string,
): { roomId: string; reason: string } | null {
  const pm = (playerMessage || '').trim();
  if (!pm) return null;
  const dest = inferRoomFromText(pm, characterId);
  if (!dest || dest === curRoom) return null;
  const mouth = `${dialogue} ${action ?? ''}`;
  // 角色明确拒绝 / 拖延（待会/等会/回头/先不）：不搬
  if (/不(?:想|去|行|了)|算了|改天|下次|先不|没空|待会|等会|等一下|回头|之后(?:再说|再去)|要不(?:先)?别/.test(mouth)) {
    return null;
  }
  // 角色声称人在别处且与目的地不符：让现有的房间推断去处理，不强行搬
  const claimed = inferPresentRoomFromSpeech(mouth, characterId, curRoom);
  if (claimed.roomId && claimed.roomId !== curRoom && claimed.roomId !== dest) return null;
  // 同意 / 承诺要过去：「走吧/一起去/好呀/放好热可可我就过去/收拾一下就去」都算。
  const agrees =
    /走吧|一起去|去(?:吧|看看|逛逛|一趟|那边)|好的?|好呀|行|可以|没问题|嗯+[，,。]?|这就(?:去|过去)|出发|过去看看|去看看/.test(
      mouth,
    ) ||
    /(?:放好|放下|收好|收拾(?:好|一下)?|换(?:好|完|一下)(?:衣服|衣裳|装)?|整理(?:好|一下)?|拿上|带上)?.{0,8}(?:就|马上|这就|立刻)(?:过去|过去看看|去|走|到|来)/.test(
      mouth,
    ) ||
    /马上(?:就)?(?:过去|到|来)|我(?:这就|马上|立刻)(?:过去|来)/.test(mouth);
  if (!agrees) return null;
  return { roomId: dest, reason: 'player_directed_move' };
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
  // 物理锁定场景占位（历史兼容）：模型对白中的睡觉、移动、换装描述只属于叙事，
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

  // 安抚室会话：房间/皮肤/活动全部由会话独占——模型对白里的离开、换衣、
  // 回房只属于叙事，不得反向改世界（否则会「满值后突然被切回大厅」）。
  const anfuSession = living.anfuSession;
  if (anfuSession?.active && anfuSession.characterId === characterId) {
    const presence = resolvePresence(characterId, living);
    writeBodyAnchor(living, characterId, presence.roomId, 'play', '在安抚室和指挥官玩棉花游戏');
    return {
      moved: false,
      skinned: false,
      roomId: presence.roomId,
      activity: 'play',
      msg: '',
    };
  }

  // 浴室互动会话：房间锁在浴室，洗澡中不可能跑去大厅跳舞/去安抚室。
  // 模型对白里的「好，去大厅」只属于叙事，不得反向把人搬走（否则事件互相踩踏）。
  if (isBathAssistActiveFor(living, characterId)) {
    const presence = resolvePresence(characterId, living);
    const behavior = '在浴室与指挥官一起洗浴';
    snapAgentToRoom(characterId, BATH_ASSIST_ROOM_ID, { activity: 'bathe', behavior });
    writeBodyAnchor(living, characterId, BATH_ASSIST_ROOM_ID, 'bathe', behavior);
    return {
      moved: presence.roomId !== BATH_ASSIST_ROOM_ID,
      skinned: false,
      roomId: BATH_ASSIST_ROOM_ID,
      activity: 'bathe',
      msg: '',
    };
  }

  // 舞蹈事件会话：大厅位置/舞装由会话独占——模型对白里的回房、换衣、睡觉只属于叙事，
  // 不得反向改世界（历史 BUG：答应跳舞后模型填 move_to 卧室/换睡衣 → 人不在大厅，舞蹈永远开不了）。
  if (isDanceActiveFor(living, characterId)) {
    const s = living.danceSession!;
    const behavior =
      s.phase === 'dressing'
        ? '在大厅换舞装，准备跳舞'
        : s.phase === 'dancing'
          ? s.mode === 'co'
            ? '在大厅与指挥官共舞'
            : '在大厅独自起舞'
          : '在大厅待机，准备跳舞';
    snapAgentToRoom(characterId, s.hallRoomId, { activity: 'play', behavior });
    writeBodyAnchor(living, characterId, s.hallRoomId, 'play', behavior);
    commitDialogueSceneSnapshot(
      living,
      characterId,
      captureDialogueSceneSnapshot(living, characterId),
    );
    return {
      moved: false,
      skinned: false,
      roomId: s.hallRoomId,
      activity: 'play',
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
  let target = resolveTargetRoom(
    characterId,
    {
      dialogue: turn.dialogue,
      action: turn.action,
      scene_beat: turn.scene_beat,
      world_intent: turn.world_intent,
    },
    curRoom,
  );
  // 指挥官指路 + 角色答应、但模型没申报 move_to：兜底走同一套走路路线，
  // 避免"嘴上说走、身体不动、下一轮又重复放热可可"。
  if (!target) {
    target = resolvePlayerDirectedMove(
      characterId,
      turn.playerMessage,
      turn.dialogue,
      turn.action,
      curRoom,
    );
  }
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

  // 刚脱离睡眠系统：换星夜睡衣站立（禁止裸回装甲；走换装过程不硬切）
  if (wasSleeping && !isInSleepSystem(living, characterId)) {
    if (getCharacterSkins(characterId).some((s) => s.id === SLEEPWEAR_SKIN_ID)) {
      schedulePresenceOutfitChange(living, characterId, SLEEPWEAR_SKIN_ID);
      result = {
        ...result,
        skinned: true,
        msg: result.msg
          ? `${result.msg}；脱离睡眠→换星夜睡衣`
          : '脱离睡眠→换星夜睡衣',
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
  const anfuSession = living.anfuSession;
  if (anfuSession?.active && anfuSession.characterId === characterId) return null;

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
  const behavior = behaviorForRoom(inferred.roomId, activity, '乐观同步');
  // 她说「我现在在X」但身体不在：按"正在过去"处理，走完才算到（不瞬移）
  const travel = planTravel(living, characterId, inferred.roomId, curRoom, {
    activity,
    behavior,
    reason: 'dialogue_move',
    arriveBehavior: behavior,
  });
  if (!travel.started) {
    snapAgentToRoom(characterId, inferred.roomId, { activity, behavior });
    writeBodyAnchor(living, characterId, inferred.roomId, activity, behavior);
  }
  preloadRoomSceneImage(inferred.roomId, living);
  return {
    moved: true,
    skinned: false,
    roomId: inferred.roomId,
    activity,
    msg: `乐观切景→${CAMP_ROOM_MAP[inferred.roomId]?.label ?? inferred.roomId}（待整包对账）`,
  };
}
