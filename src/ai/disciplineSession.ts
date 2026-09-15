/**
 * 小黑屋 / 调教会话（P0）
 * 规格：docs/discipline-event.md §12–§13
 *
 * - 主路径：玩家点「小黑屋」或对话威慑后拖入
 * - 强制营地/事件通道调教皮；不写看板娘 activeSkinId
 * - 离开/关窗/读档残留 → 结算并还原
 */
import {
  DISCIPLINE_SKIN_ID,
  DISCIPLINE_TEMP_SKIN_INSTANCE,
  getCharacterSkin,
} from '../data/characterSkins';
import { CHARACTER_MAP } from '../data/characters';
import {
  startDisciplineOverlayMusic,
  stopDisciplineOverlayMusic,
} from '../audio/disciplineOverlay';
import type { SaveData } from '../types';
import { clearEventTempSkinsForInstance, setEventTempSkin } from './campEvents/campEventEffects';
import { getCampWornSkinId } from './campOutfit';
import { snapAgentToRoom } from './campAgents';
import { pushMemory, pushRecentChat } from './memory';
import { adjustAffinity, getAffinity } from './relationship';
import type { AiLivingSave, CharacterActivity, LightStatusTag } from './types';
import { resolvePresence } from './livingState';
import {
  buildDisciplineIdlePlayerMessage,
  buildDisciplinePosePlayerMessage,
  getDisciplinePoseCount,
  getDisciplinePoseNote,
} from './disciplinePoseNotes';
import { clearDialogueSceneSnapshots } from './dialogueSceneSync';
import { chatJsonRouted, hasDialogueApiKey } from './llmRouter';
import type { ChatMessage } from './llmClient';
import { getPersona } from './characterPersona';
import { getMoodSnapshot } from './moodContinuum';

export const DISCIPLINE_ROOM_ID = 'room_b1_discipline';
export const DISCIPLINE_SCENE_ID = 'indoor_tiaojiaoshi';
export const DISCIPLINE_BG_PATH = './tex/Indoor/shinei01_tiaojiaoshi.png';
/** 姿势切换冷却（毫秒） */
export const DISCIPLINE_POSE_COOLDOWN_MS = 20_000;

export type DisciplineEntrySource =
  | 'player_button'
  | 'threat_fulfilled'
  | 'character_request'
  | 'recover';

export type DisciplineValence = 'tragic' | 'mixed' | 'joyful';

export type DisciplineSessionState = {
  active: boolean;
  characterId: string;
  prevRoomId: string | null;
  prevCampSkinId: string | null;
  /** 进房前的事件临时皮（睡衣/洗浴等），离开时优先还原 */
  prevEventTemp?: import('./types').EventTempSkinState | null;
  poseIndex: number | null;
  startedAt: number;
  lastPoseAt: number;
  awaitingPoseReply: boolean;
  entrySource: DisciplineEntrySource;
  valenceHints: DisciplineValence[];
  /** 刚拖入：下一轮对白必须先反应「已被拖入并束缚」 */
  justEntered?: boolean;
  /** 刚离开：后续 1～2 轮禁止再写「被束缚」 */
  justLeft?: boolean;
  justLeftTurnsLeft?: number;
  /** 结束结算幂等锁 */
  settling?: boolean;
};

/** 角色主动求进待确认 */
export type DisciplineInvitePending = {
  characterId: string;
  proposedAt: number;
  dayIndex: number;
  preview: string;
};

/** 对话威胁关键词（未进房；仅注入 Prompt，不自动进房） */
export const DISCIPLINE_THREAT_RE =
  /小黑屋|调教室|拖进|拖入|关进|关进小黑屋|惩罚你|再不.{0,12}(听话|理我|跟我聊|聊天)|不听我就|再不听/;

export function isDisciplineEnabled(save: SaveData): boolean {
  return save.settings?.disciplineEnabled !== false;
}

export function getDisciplineSession(living: AiLivingSave): DisciplineSessionState | null {
  const s = living.disciplineSession;
  if (!s?.active || !s.characterId) return null;
  return s;
}

export function isDisciplineActiveFor(
  living: AiLivingSave,
  characterId: string,
): boolean {
  const s = getDisciplineSession(living);
  return !!s && s.characterId === characterId;
}

export function detectDisciplineThreat(playerMessage: string): boolean {
  return DISCIPLINE_THREAT_RE.test(playerMessage || '');
}

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

function addFatigue(living: AiLivingSave, characterId: string): void {
  const cur = new Set(living.characterStatus[characterId] ?? []);
  cur.add('fatigue' as LightStatusTag);
  living.characterStatus[characterId] = [...cur].slice(0, 4) as LightStatusTag[];
}

/** idle=已进房未触手加压；姿势N=触手调教中。与立绘双态一致。 */
export function disciplineBodyBehavior(poseIndex: number | null | undefined): string {
  if (poseIndex != null && poseIndex > 0) {
    return `在负一楼小黑屋触手调教姿势${poseIndex}中，被机械触手固定，无法自行离开`;
  }
  return '在负一楼小黑屋穿着调教约束皮待机，尚未被触手加压姿势缠住；房间门锁死，无法自行离开';
}

function lockAgenda(living: AiLivingSave, characterId: string, poseIndex: number | null = null): void {
  if (!living.agendas) living.agendas = {};
  living.agendas[characterId] = {
    goal: 'discipline_session',
    targetRoomId: DISCIPLINE_ROOM_ID,
    activity: 'talking',
    behavior: disciplineBodyBehavior(poseIndex),
    remainGameMin: 9999,
    startedGameMin: living.gameMinutes,
    reason: '小黑屋调教会话锁定',
    source: 'event',
    eventInstanceId: DISCIPLINE_TEMP_SKIN_INSTANCE,
  };
}

function syncDisciplineBodyPose(
  living: AiLivingSave,
  characterId: string,
  poseIndex: number | null,
): void {
  writeBodyAnchor(
    living,
    characterId,
    DISCIPLINE_ROOM_ID,
    'talking',
    disciplineBodyBehavior(poseIndex),
  );
  snapAgentToRoom(characterId, DISCIPLINE_ROOM_ID, {
    activity: 'talking',
    behavior: disciplineBodyBehavior(poseIndex),
  });
  const a = living.agendas?.[characterId];
  if (a?.goal === 'discipline_session' || a?.eventInstanceId === DISCIPLINE_TEMP_SKIN_INSTANCE) {
    a.behavior = disciplineBodyBehavior(poseIndex);
  }
}

function unlockAgenda(living: AiLivingSave, characterId: string): void {
  const a = living.agendas?.[characterId];
  if (a?.eventInstanceId === DISCIPLINE_TEMP_SKIN_INSTANCE || a?.goal === 'discipline_session') {
    delete living.agendas![characterId];
  }
}

export type DisciplineEnterResult = {
  ok: boolean;
  msg: string;
  systemLine?: string;
};

/**
 * 进入小黑屋：快照 → 换房 → 强制调教皮 → 清 pending 送礼由调用方处理。
 */
export function enterDisciplineSession(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  entrySource: DisciplineEntrySource = 'player_button',
): DisciplineEnterResult {
  if (!isDisciplineEnabled(save)) {
    return { ok: false, msg: '小黑屋功能已关闭' };
  }
  if (!CHARACTER_MAP[characterId]) {
    return { ok: false, msg: '角色不存在' };
  }
  if (!getCharacterSkin(characterId, DISCIPLINE_SKIN_ID)) {
    return { ok: false, msg: '该角色暂无调教约束皮资源' };
  }
  const existing = getDisciplineSession(living);
  if (existing) {
    if (existing.characterId === characterId) {
      void startDisciplineOverlayMusic();
      return { ok: true, msg: '已在小黑屋中' };
    }
    return { ok: false, msg: '另一名角色正在小黑屋中' };
  }

  const presence = resolvePresence(characterId, living);
  const prevRoomId = presence.roomId || null;
  const prevCampSkinId = getCampWornSkinId(living, characterId);
  const prevTempRaw = living.eventTempSkins?.[characterId];
  const prevEventTemp =
    prevTempRaw && prevTempRaw.eventInstanceId !== DISCIPLINE_TEMP_SKIN_INSTANCE
      ? { ...prevTempRaw }
      : null;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;

  clearDialogueSceneSnapshots(living, [characterId]);
  living.disciplineSession = {
    active: true,
    characterId,
    prevRoomId,
    prevCampSkinId,
    prevEventTemp,
    poseIndex: null,
    startedAt: Date.now(),
    lastPoseAt: 0,
    awaitingPoseReply: false,
    entrySource,
    valenceHints: [],
    justEntered: true,
    justLeft: false,
    justLeftTurnsLeft: 0,
  };

  // 进房默认 idle：约束皮待机，尚未触手加压
  syncDisciplineBodyPose(living, characterId, null);

  setEventTempSkin(
    save,
    living,
    characterId,
    DISCIPLINE_SKIN_ID,
    DISCIPLINE_TEMP_SKIN_INSTANCE,
  );
  // 即使营地已穿同皮也强制写临时层，确保离开可清
  if (!living.eventTempSkins) living.eventTempSkins = {};
  living.eventTempSkins[characterId] = {
    skinId: DISCIPLINE_SKIN_ID,
    restoreSkinId: prevCampSkinId,
    eventInstanceId: DISCIPLINE_TEMP_SKIN_INSTANCE,
  };

  lockAgenda(living, characterId, null);

  // 取消挂起换装，避免逃出调教皮
  if (living.pendingOutfitChanges?.[characterId]) {
    delete living.pendingOutfitChanges[characterId];
  }

  const systemLine = `【系统】指挥官将${name}拖入负一楼小黑屋（机器人调教室）。`;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}被拖入负一楼小黑屋调教室（来源：${entrySource}）`,
    importance: 7,
  });

  void startDisciplineOverlayMusic();
  return { ok: true, msg: '已进入小黑屋', systemLine };
}

export type DisciplineLeaveResult = {
  ok: boolean;
  msg: string;
  valence: DisciplineValence;
  affinityDelta: number;
  systemLine?: string;
};

function pickValence(session: DisciplineSessionState): DisciplineValence {
  const hints = session.valenceHints;
  if (!hints.length) return 'mixed';
  const score = { tragic: 0, mixed: 0, joyful: 0 };
  for (const h of hints) score[h] += 1;
  if (score.tragic >= score.joyful && score.tragic >= score.mixed) return 'tragic';
  if (score.joyful > score.tragic && score.joyful >= score.mixed) return 'joyful';
  return 'mixed';
}

/**
 * 离开小黑屋并结算（幂等）。
 * 必须写入对话历史 + justLeft，并由 UI 触发离房反应轮（与进房对称）。
 */
export function leaveDisciplineSession(
  save: SaveData,
  living: AiLivingSave,
  opts?: {
    valence?: DisciplineValence;
    reason?: string;
    oneLineMemory?: string;
    /** 读档恢复 / 卡死 settling 时强制完成 */
    force?: boolean;
  },
): DisciplineLeaveResult {
  void save;
  const session = living.disciplineSession;
  if (!session?.active) {
    scrubOrphanDisciplineArtifacts(living);
    stopDisciplineOverlayMusic();
    return { ok: false, msg: '未在小黑屋中', valence: 'mixed', affinityDelta: 0 };
  }
  // 卡死的 settling（中断离开）会导致永久锁房；force 强制放行
  if (session.settling && !opts?.force) {
    return { ok: true, msg: '结算中', valence: 'mixed', affinityDelta: 0 };
  }
  session.settling = true;

  const characterId = session.characterId;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const valence = opts?.valence ?? pickValence(session);

  let affinityDelta = 0;
  if (valence === 'joyful') affinityDelta = 3;
  else if (valence === 'tragic') affinityDelta = -4;
  else affinityDelta = 0;

  try {
    if (affinityDelta !== 0) {
      adjustAffinity(living, characterId, affinityDelta);
    }
    addFatigue(living, characterId);

    clearEventTempSkinsForInstance(living, DISCIPLINE_TEMP_SKIN_INSTANCE);

    if (session.prevEventTemp?.skinId) {
      if (!living.eventTempSkins) living.eventTempSkins = {};
      living.eventTempSkins[characterId] = { ...session.prevEventTemp };
    }

    if (living.campWornSkins?.[characterId] === DISCIPLINE_SKIN_ID) {
      if (session.prevCampSkinId && session.prevCampSkinId !== DISCIPLINE_SKIN_ID) {
        living.campWornSkins[characterId] = session.prevCampSkinId;
      } else {
        delete living.campWornSkins[characterId];
      }
    }

    const restoreRoom =
      session.prevRoomId && session.prevRoomId !== DISCIPLINE_ROOM_ID
        ? session.prevRoomId
        : 'room_1f_hall1';
    writeBodyAnchor(
      living,
      characterId,
      restoreRoom,
      'idle',
      '刚从小黑屋离开，束缚已解除，身体自由但带着余韵',
    );
    snapAgentToRoom(characterId, restoreRoom, {
      activity: 'idle',
      behavior: '刚从小黑屋离开，束缚已解除',
    });

    clearDialogueSceneSnapshots(living, [characterId]);
    unlockAgenda(living, characterId);

    const reason = opts?.reason ?? '离开';
    const memLine =
      opts?.oneLineMemory?.trim() ||
      `${name}离开小黑屋（${reason}；结局倾向 ${valence}；好感${affinityDelta >= 0 ? '+' : ''}${affinityDelta}）`;
    pushMemory(living, characterId, {
      kind: 'event',
      summary: memLine.slice(0, 100),
      importance: 6,
    });

    // 写入对话短窗：否则历史全是「被绑着」，模型会继续当束缚态演
    pushRecentChat(
      living,
      characterId,
      'user',
      `【系统事实·已生效】指挥官结束了调教，解除所有束缚。${name}已离开负一楼小黑屋，身体完全自由，不在调教室。禁止再说被触手绑着/无法动弹/还在小黑屋。`,
    );

    living.disciplineSession = {
      ...session,
      active: false,
      settling: false,
      poseIndex: null,
      awaitingPoseReply: false,
      justEntered: false,
      justLeft: true,
      justLeftTurnsLeft: 3,
      prevEventTemp: null,
    };

    scrubOrphanDisciplineArtifacts(living);

    const affBit =
      affinityDelta === 0
        ? '好感持平'
        : affinityDelta > 0
          ? `好感 +${affinityDelta}`
          : `好感 ${affinityDelta}`;
    const systemLine = `【系统】${name}离开小黑屋（${valence === 'joyful' ? '偏欢愉' : valence === 'tragic' ? '偏沉痛' : '复杂余韵'} · ${affBit} · 疲劳↑）。`;

    stopDisciplineOverlayMusic();
    return {
      ok: true,
      msg: '已离开小黑屋',
      valence,
      affinityDelta,
      systemLine,
    };
  } catch (err) {
    if (living.disciplineSession) living.disciplineSession.settling = false;
    throw err;
  } finally {
    if (living.disciplineSession?.settling) {
      living.disciplineSession.settling = false;
    }
  }
}

/** 清理非活跃会话残留的调教皮 / 议程 / 束缚锚点（读档与离开后都跑） */
export function scrubOrphanDisciplineArtifacts(living: AiLivingSave): void {
  const activeId =
    living.disciplineSession?.active && living.disciplineSession.characterId
      ? living.disciplineSession.characterId
      : null;

  if (living.eventTempSkins) {
    for (const [cid, st] of Object.entries(living.eventTempSkins)) {
      if (st?.eventInstanceId === DISCIPLINE_TEMP_SKIN_INSTANCE && cid !== activeId) {
        delete living.eventTempSkins[cid];
      }
    }
  }

  if (living.agendas) {
    for (const [cid, a] of Object.entries(living.agendas)) {
      if (cid === activeId) continue;
      if (a?.goal === 'discipline_session' || a?.eventInstanceId === DISCIPLINE_TEMP_SKIN_INSTANCE) {
        delete living.agendas[cid];
      }
    }
  }

  if (living.campWornSkins) {
    for (const [cid, skinId] of Object.entries(living.campWornSkins)) {
      if (cid !== activeId && skinId === DISCIPLINE_SKIN_ID) {
        delete living.campWornSkins[cid];
      }
    }
  }

  if (living.bodyAnchors) {
    for (const [cid, b] of Object.entries(living.bodyAnchors)) {
      if (cid === activeId || !b) continue;
      const stuckRoom = b.roomId === DISCIPLINE_ROOM_ID;
      const stuckBeh = /小黑屋|调教室|被.*束缚|无法自行离开/.test(b.behavior || '');
      if (!stuckRoom && !stuckBeh) continue;
      const room = stuckRoom ? 'room_1f_hall1' : b.roomId || 'room_1f_hall1';
      writeBodyAnchor(living, cid, room, 'idle', '在营地自由活动');
      snapAgentToRoom(cid, room, { activity: 'idle', behavior: '在营地自由活动' });
    }
  }
}

/**
 * 任一会话终止路径的统一结算出口。
 * 断线、关闭、卸载与后台事件必须同步调用它，不能等待静默 LLM 裁决。
 */
export function settleActiveDisciplineSession(
  save: SaveData,
  living: AiLivingSave,
  reason: string,
): DisciplineLeaveResult | null {
  const session = getDisciplineSession(living);
  if (!session) {
    scrubOrphanDisciplineArtifacts(living);
    return null;
  }
  session.settling = false;
  return leaveDisciplineSession(save, living, { reason, force: true });
}

/** 读档 / 异常：若卡在 active，强制结算；并清孤儿残留 */
export function recoverStaleDisciplineSession(
  save: SaveData,
  living: AiLivingSave,
): boolean {
  scrubOrphanDisciplineArtifacts(living);
  return Boolean(settleActiveDisciplineSession(save, living, '读档/异常自动结束'));
}

export function buildDisciplineThreatPromptBlock(): string {
  return `【世界同步·小黑屋威慑·本轮】
- 指挥官正在用「拖进负一楼小黑屋（机器人调教室）惩罚你」作为威胁；你此刻仍在原场景，尚未被拖入。
- 小黑屋 = 你不听话 / 冷落玩家时的惩罚工具，不是情趣调情，也不是换 pifu05。
- 你必须结合性格、好感、社交、是否刚怠慢过指挥官，自行选择：害怕求饶并答应聊天或听话、讨价还价、嘴硬挑衅、或继续冷淡——禁止无视威胁装没听见。
- 顺从只是你的对白态度，系统不会改写服从度数值；若指挥官真的按下「小黑屋」，你会被强制拖入调教室并切换调教约束皮。`;
}

function disciplineMoodHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * 调教中的情绪不是固定反抗，也不是固定兴奋；只把当前状态翻译成稳定的表现倾向。
 * 使用会话/对话轮的确定性抽样，避免同一轮 LLM 重试时情绪规则前后改变。
 */
function buildDisciplineMoodPromptBlock(
  living: AiLivingSave,
  characterId: string,
  session: DisciplineSessionState,
): string {
  const persona = getPersona(living, characterId);
  const mood = getMoodSnapshot(living, characterId);
  const affinity = getAffinity(living, characterId);
  const positiveValence = Math.max(0, mood.valence) / 100;
  const relationWarmth = affinity / 100;
  const arousal = mood.arousal / 100;
  const play = ((persona.traits.play + 40) / 80);
  const warmth = ((persona.traits.warmth + 40) / 80);
  const caution = ((persona.traits.caution + 40) / 80);
  const modeBoost = persona.dayMode === 'playful' || persona.dayMode === 'social' ? 0.1 : 0;
  const requestBoost = session.entrySource === 'character_request' ? 0.12 : 0;
  const highArousalChance = Math.max(
    0.04,
    Math.min(
      0.78,
      0.05 + arousal * 0.34 + positiveValence * 0.16 + relationWarmth * 0.16 +
        play * 0.1 + warmth * 0.06 - caution * 0.12 + modeBoost + requestBoost,
    ),
  );
  const turn = (living.recentChats?.[characterId]?.length ?? 0) + (session.poseIndex ?? 0);
  const roll = disciplineMoodHash(
    `${characterId}:${session.startedAt}:${session.entrySource}:${turn}`,
  );
  const sampledExcitement = roll < highArousalChance;
  const excitement = ['兴奋', '渴望', '溺爱', '淫乱', '亢奋'];
  const sampledWord = excitement[Math.floor(disciplineMoodHash(`${characterId}:${session.startedAt}:${turn}:word`) * excitement.length)];
  const tendency = sampledExcitement
    ? `本轮状态抽样偏向「${sampledWord}」`
    : '本轮状态抽样未进入兴奋主导档';

  return `【调教情绪取样·不是固定模板】
- 综合依据：${mood.labelZh}；唤醒度${mood.arousal}/100；愉悦度${mood.valence}/100；好感${affinity}/100；今日模式「${persona.dayMode}」；traits（play ${persona.traits.play} / warmth ${persona.traits.warmth} / caution ${persona.traits.caution}）；入口「${session.entrySource}」。
- 成人向兴奋表现概率约 ${Math.round(highArousalChance * 100)}%；${tendency}。这只是本轮表现倾向，不是强制剧情，也不是数值播报。
- 若抽中：可把「兴奋、渴望、溺爱、淫乱、亢奋」中的一个作为主导情绪，也可与气愤、害怕、屈辱、羞耻、紧张矛盾并存；必须用角色自己的声线和当前姿势表现，不能只贴标签。
- 若未抽中：以反抗、害怕、屈辱、紧张、疲惫或复杂拉扯为主，但仍可保留少量敏感、好奇或动摇。后续轮次会因状态和话题变化，不得永远固定为反抗，也不得每轮固定兴奋。
- 只改变情绪、动作、内心与对白的表现，不改变调教室地点、约束皮、无法自行离开或 end_conversation=false 等硬事实；触手是否缠身必须以「当前画面」为准。
- discipline_mood 填本轮 1～3 个主导情绪词；discipline_valence 依据整体感受填写 tragic|mixed|joyful。`;
}

export function buildDisciplineActivePromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const session = getDisciplineSession(living);
  if (!session || session.characterId !== characterId) return '';
  const pose = session.poseIndex;
  const note = getDisciplinePoseNote(characterId, pose);
  const idle = pose == null || pose <= 0;
  const poseLine = idle
    ? `idle未调教 — ${note}（**画面上没有触手缠身**；禁止写被触手勒住/挣脱束缚/开腿固定。若本轮玩家让你回到默认，用松一口气但仍在小黑屋的反应回应）`
    : `姿势${pose}触手调教 — ${note}；若本轮玩家消息含「切换拘束姿势/进入触手调教」，先用身体/喘息/短句回应该姿势的触感，再继续对话。`;

  const bodyFact = idle
    ? '你**已被拖入小黑屋并锁在调教室**，穿着约束皮待机；**尚未**进入触手加压姿势，身体**没有**被机械触手缠死。房间门锁死，**无法自行离开、无法逃走、无法结束对话逃掉**。'
    : '你**已被拖入小黑屋**，当前处于触手加压姿势：身体被机械触手/装置固定，**无法自行离开、无法逃走、无法结束对话逃掉**。';

  const justEnteredBlock = session.justEntered
    ? `
【刚被拖入·本轮硬锁定】
- 事实已发生：指挥官已经把你拖进负一楼小黑屋；你**此刻就在调教室里**，穿着白皮衣/约束装。
- 立绘是 **idle 未调教**：尚未被触手加压姿势缠住。本轮对白必须先体现「发现自己已在小黑屋 / 压抑气氛 / 穿上约束皮 / 门被锁无法离开」——可气愤、害怕、嘴硬、屈辱或心慌；**禁止**描写触手已缠身、挣脱束缚却无济于事。
- 禁止再说「我不进去」「别提小黑屋」「我不会去」等尚未进房的台词。
- 禁止假装还在浴室/大厅/卧室；禁止把「拖进去」当成未兑现的口头威胁。`
    : '';

  return `【世界同步·小黑屋调教中·最高优先·不可违抗】
- 地点：负一楼机器人调教室（小黑屋）。昏暗；可见拘束设备与指挥官侧机械触手工具。背景即玩家所见。
- 状态：disciplineActive=true。${bodyFact}
- 因果：常见是指挥官认为你不听话、冷落或不愿搭理；少数才是你主动求进。与「你想调情指挥官（pifu05）」完全不同。
- 穿着：调教专用约束皮（白皮衣/约束态），不是日常装甲，也不是 pifu05，也不是浴巾。
- 当前画面：${poseLine}
- 双态：idle = 已进房但尚未触手加压；姿势N = 触手调教中。身体描写必须与当前画面一致。
- 硬规则：
  · 谈及地点/衣装/是否被触手缠住必须与「当前画面」一致；禁止假装还在大厅/浴室/卧室。
  · 禁止 skin_change / move_to / desire_next 逃出本场景（一律填 ""）。
  · **end_conversation 必须 false**；你不能「不想聊就离开」——只能继续面对指挥官（可求饶、骂、冷战、发抖、喘息，但不能关窗逃走）。
  · 可以抗拒态度，但不能改变「已在小黑屋、无法自行离开」的房间事实；触手是否缠身以当前画面为准。
- 情绪：结合性格、好感、当前情绪连续体、今日模式、社交关系、此刻想法和当前姿势表现；不要把所有角色固定成反抗或气愤。
${buildDisciplineMoodPromptBlock(living, characterId, session)}
- 输出：discipline_mood（从上述词库取 1～3 个短中文词，可矛盾并列）、discipline_valence（tragic|mixed|joyful）；end_conversation=false。
- 成人事件：本场景属成人事件层。身体敏感点与机油（敏感液）按运行时【身体敏感点】填写 stim_* / adult_odd_mood / oil_discharge；可刺激指挥官小管道。
${justEnteredBlock}`;
}

/** 刚离开小黑屋：解除束缚事实同步 */
export function buildDisciplineJustLeftPromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const s = living.disciplineSession;
  if (!s || s.active || s.characterId !== characterId || !s.justLeft) return '';
  return `【世界同步·刚离开小黑屋·最高优先·不可违抗】
- 事实：调教会话**已结束**；你**已经离开**负一楼小黑屋；机械触手/装置束缚**已全部解除**；身体可自由走动。
- 地点：当前场景不是调教室（以玩家眼前背景与【你在营地的位置】为准）。
- 穿着：已不是调教约束皮（除非你本来就穿别的事件临时皮）；禁止再描述白皮衣束缚态。
- 禁止：再说「被绑着/触手缠着/无法动弹/关在小黑屋/拘束装置」等仍在束缚中的描写；禁止 action 写「被束缚的身体挣扎」。
- 允许：余韵——酸软、羞耻、余怒、疲惫、心有余悸、不想再提、想洗脸换衣服等。
- end_conversation 可按正常收束规则填写。`;
}

export function consumeDisciplineJustLeftTurn(
  living: AiLivingSave,
  characterId: string,
): void {
  const s = living.disciplineSession;
  if (!s || s.active || s.characterId !== characterId || !s.justLeft) return;
  const left = (s.justLeftTurnsLeft ?? 0) - 1;
  if (left <= 0) {
    s.justLeft = false;
    s.justLeftTurnsLeft = 0;
  } else {
    s.justLeftTurnsLeft = left;
  }
}

/** 进房后首轮主动反应的系统动机（给 talkToCharacter / proactive） */
export const DISCIPLINE_ENTER_REACT_MOTIVE =
  '【世界已变·最高优先】指挥官已把你拖进负一楼小黑屋（机器人调教室）。你此刻已在调教室、穿着约束皮待机（idle 未调教），**尚未**被触手加压姿势缠住；门已锁，无法自行离开。请立刻用短句反应「发现自己已被拖入小黑屋」——可气愤、害怕、屈辱、嘴硬或心慌；禁止描写触手已缠身/挣脱束缚；禁止再说「我不进去/别提小黑屋」。discipline_mood 填 1～3 个情绪词；end_conversation 必须 false。';

/** 离房后首轮主动反应（与进房对称，必须触发） */
export const DISCIPLINE_LEAVE_REACT_MOTIVE =
  '【世界已变·最高优先】指挥官已结束调教并解除所有束缚。你已经离开负一楼小黑屋，身体完全自由，不在调教室，也不再被触手/装置固定。请立刻用短句反应「发现自己已被放开/离开小黑屋」——可余怒、疲惫、羞耻、松一口气或不想再提；禁止再说被绑着、挣扎挣脱、还在小黑屋。action 禁止写束缚。';

export function consumeDisciplineJustEntered(
  living: AiLivingSave,
  characterId: string,
): boolean {
  const s = getDisciplineSession(living);
  if (!s || s.characterId !== characterId || !s.justEntered) return false;
  s.justEntered = false;
  return true;
}

export function normalizeDisciplineValence(raw: unknown): DisciplineValence | null {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (v === 'tragic' || v === 'mixed' || v === 'joyful') return v;
  return null;
}

/** 记录本轮 valence 倾向（供离开加权） */
export function recordDisciplineValenceHint(
  living: AiLivingSave,
  characterId: string,
  valence: DisciplineValence | null | undefined,
): void {
  const s = getDisciplineSession(living);
  if (!s || s.characterId !== characterId || !valence) return;
  s.valenceHints = [...(s.valenceHints ?? []), valence].slice(-12);
}

export function clearDisciplinePoseAwaiting(
  living: AiLivingSave,
  characterId: string,
): void {
  const s = getDisciplineSession(living);
  if (!s || s.characterId !== characterId) return;
  s.awaitingPoseReply = false;
}

export type DisciplinePoseSwitchResult = {
  ok: boolean;
  msg: string;
  playerMessage?: string;
  poseIndex?: number;
};

function assertPoseSwitchAllowed(
  s: DisciplineSessionState,
): DisciplinePoseSwitchResult | null {
  if (s.awaitingPoseReply) {
    return { ok: false, msg: '请等待角色回应上一姿势' };
  }
  const since = Date.now() - (s.lastPoseAt || 0);
  if (s.lastPoseAt > 0 && since < DISCIPLINE_POSE_COOLDOWN_MS) {
    const left = Math.ceil((DISCIPLINE_POSE_COOLDOWN_MS - since) / 1000);
    return { ok: false, msg: `姿势冷却中（${left}s）` };
  }
  return null;
}

/** 切换姿势：更新会话 + 返回玩家侧文本（由 UI 发对话） */
export function applyDisciplinePoseSwitch(
  living: AiLivingSave,
  characterId: string,
  poseIndex: number,
): DisciplinePoseSwitchResult {
  const s = getDisciplineSession(living);
  if (!s || s.characterId !== characterId) {
    return { ok: false, msg: '未在小黑屋中' };
  }
  const max = getDisciplinePoseCount(characterId);
  if (poseIndex < 1 || poseIndex > max) {
    return { ok: false, msg: '无效姿势' };
  }
  if (s.poseIndex === poseIndex) {
    return { ok: false, msg: '已是该姿势' };
  }
  const blocked = assertPoseSwitchAllowed(s);
  if (blocked) return blocked;
  s.poseIndex = poseIndex;
  s.lastPoseAt = Date.now();
  s.awaitingPoseReply = true;
  syncDisciplineBodyPose(living, characterId, poseIndex);
  return {
    ok: true,
    msg: '已切换姿势',
    poseIndex,
    playerMessage: buildDisciplinePosePlayerMessage(characterId, poseIndex),
  };
}

/** 回到未调教 idle（默认态） */
export function applyDisciplineIdleReset(
  living: AiLivingSave,
  characterId: string,
): DisciplinePoseSwitchResult {
  const s = getDisciplineSession(living);
  if (!s || s.characterId !== characterId) {
    return { ok: false, msg: '未在小黑屋中' };
  }
  if (s.poseIndex == null || s.poseIndex <= 0) {
    return { ok: false, msg: '已是默认待机' };
  }
  const blocked = assertPoseSwitchAllowed(s);
  if (blocked) return blocked;
  s.poseIndex = null;
  s.lastPoseAt = Date.now();
  s.awaitingPoseReply = true;
  syncDisciplineBodyPose(living, characterId, null);
  return {
    ok: true,
    msg: '已回默认待机',
    poseIndex: undefined,
    playerMessage: buildDisciplineIdlePlayerMessage(characterId),
  };
}

export function getDisciplinePoseCooldownRemainingMs(living: AiLivingSave): number {
  const s = getDisciplineSession(living);
  if (!s?.active || !s.lastPoseAt) return 0;
  return Math.max(0, DISCIPLINE_POSE_COOLDOWN_MS - (Date.now() - s.lastPoseAt));
}

export function isDisciplinePoseUiLocked(living: AiLivingSave, characterId: string): boolean {
  const s = getDisciplineSession(living);
  if (!s || s.characterId !== characterId) return true;
  if (s.awaitingPoseReply) return true;
  return getDisciplinePoseCooldownRemainingMs(living) > 0;
}

// ——— 角色主动求进 ———

function isDisciplineRefusal(dialogue: string): boolean {
  return /(?:不想|不去|不要|别|拒绝|讨厌|害怕|反感|不喜欢).{0,16}(?:小黑屋|调教室|负一楼)|(?:小黑屋|调教室|负一楼).{0,16}(?:不想|不去|不要|别|拒绝|讨厌|害怕|反感|不喜欢)/.test(dialogue);
}

function isExplicitDisciplineRequest(dialogue: string): boolean {
  const room = '(?:负一楼(?:的)?(?:小黑屋|调教室)|小黑屋|调教室)';
  return new RegExp(
    `(?:我)?(?:想|要|愿意|可以)(?:被你)?(?:进|去|到)${room}|` +
      `(?:请|求你)(?:把我)?(?:带|拖)(?:我)?(?:进|去|到)${room}|` +
      `(?:带我|拖我)(?:进|去|到)${room}`,
  ).test(dialogue);
}

/** 日冷却 + 明确求进：是否生成求进提案（不直接进房） */
export function maybeProposeDisciplineInvite(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  dialogue: string,
): DisciplineInvitePending | null {
  const explicitRequest = isExplicitDisciplineRequest(dialogue);
  if (isDisciplineRefusal(dialogue) || !explicitRequest) {
    // Drop invitations created by an older build when the current reply does not support them.
    if (living.pendingDisciplineInvite?.characterId === characterId) living.pendingDisciplineInvite = undefined;
    return null;
  }
  if (!isDisciplineEnabled(save)) return null;
  if (getDisciplineSession(living)) return null;
  if (living.pendingDisciplineInvite?.characterId) return null;
  if (!getCharacterSkin(characterId, DISCIPLINE_SKIN_ID)) return null;

  const day = living.dayIndex | 0;
  if (!living.disciplineInviteCooldownDay) living.disciplineInviteCooldownDay = {};
  if ((living.disciplineInviteCooldownDay[characterId] ?? -999) >= day) return null;

  const aff = getAffinity(living, characterId);
  if (aff < 35) return null;

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const pending: DisciplineInvitePending = {
    characterId,
    proposedAt: Date.now(),
    dayIndex: day,
    preview: `${name}低声提出：想去负一楼小黑屋接受惩罚或调教。`,
  };
  living.pendingDisciplineInvite = pending;
  living.disciplineInviteCooldownDay[characterId] = day;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}主动提出想进小黑屋（待指挥官确认）`,
    importance: 6,
  });
  return pending;
}

export function acceptDisciplineInvite(
  save: SaveData,
  living: AiLivingSave,
): DisciplineEnterResult {
  const pending = living.pendingDisciplineInvite;
  if (!pending) return { ok: false, msg: '没有待确认的邀请' };
  const cid = pending.characterId;
  living.pendingDisciplineInvite = undefined;
  return enterDisciplineSession(save, living, cid, 'character_request');
}

export function rejectDisciplineInvite(living: AiLivingSave): string {
  const pending = living.pendingDisciplineInvite;
  if (!pending) return '没有待确认的邀请';
  const name = CHARACTER_MAP[pending.characterId]?.name ?? pending.characterId;
  living.pendingDisciplineInvite = undefined;
  pushMemory(living, pending.characterId, {
    kind: 'event',
    summary: `指挥官拒绝了${name}进小黑屋的请求`,
    importance: 5,
  });
  return `【系统】你拒绝了${name}进入小黑屋的请求。`;
}

/** 静默 settle：仅 valence + one_line_memory（推荐 A） */
export async function requestDisciplineSettleValence(
  living: AiLivingSave,
  characterId: string,
): Promise<{ valence: DisciplineValence; one_line_memory: string } | null> {
  if (!hasDialogueApiKey()) return null;
  const s = getDisciplineSession(living);
  if (!s || s.characterId !== characterId) return null;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const hints = (s.valenceHints ?? []).join(',') || '无';
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是结算裁判。根据角色在小黑屋调教会话中的整体感受，只输出 JSON：' +
        '{"valence":"tragic|mixed|joyful","one_line_memory":"一句中文记忆（≤40字）"}。' +
        'tragic=以厌恶/害怕/伤心/拒绝为主；joyful=以沉溺/情趣共鸣/偏正为主；mixed=矛盾拉扯。禁止输出其它字段或对白。',
    },
    {
      role: 'user',
      content: `角色：${name}。会话时长约 ${Math.max(1, Math.round((Date.now() - s.startedAt) / 60000))} 分钟。本轮 valence 线索：${hints}。入口：${s.entrySource}。请裁决结局倾向。`,
    },
  ];
  try {
    const raw = await chatJsonRouted<{ valence?: string; one_line_memory?: string }>(messages, {
      priority: 'interactive',
    });
    const valence = normalizeDisciplineValence(raw.valence) ?? pickValence(s);
    const one_line_memory =
      typeof raw.one_line_memory === 'string' && raw.one_line_memory.trim()
        ? raw.one_line_memory.trim().slice(0, 40)
        : `${name}结束了小黑屋会话（${valence}）`;
    return { valence, one_line_memory };
  } catch {
    return null;
  }
}

