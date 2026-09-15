/**
 * 深场对话 → desire_next 回写（未来意图，不是此刻位置）。
 *
 * 对话回合内：默认只记念，不拽腿切景。
 * 身体「此刻」房间由 dialoguePresence / dialogueWorldSync 独占。
 */
import { CAMP_ROOM_MAP } from '../data/campLayout';
import {
  applyAgendaMovement,
  getAgenda,
  isProtectedAgenda,
  setAgenda,
} from './characterAgenda';
import {
  defaultActivityForRoom,
  DIALOGUE_PLANNING_RE,
  inferRoomFromText,
  speechHasPresentScene,
} from './dialoguePresence';
import { resolveCharacterRoomId } from './livingState';
import { pushMemory } from './memory';
import type {
  AiLivingSave,
  CharacterActivity,
  CharacterAgenda,
  DesireNextPayload,
} from './types';

export {
  DIALOGUE_PLANNING_RE,
  inferRoomFromText,
  speechHasPresentScene,
} from './dialoguePresence';

/** @deprecated 浴室特例；请用 speechHasPresentScene */
export function speechIndicatesStillBathing(speech: string): boolean {
  return /浴室|洗澡|洗浴|冲澡|水温|洗着|冲着/.test(speech) && speechHasPresentScene(speech, '', null);
}

type DesireNorm = {
  goal: string;
  roomId: string;
  activity: CharacterActivity;
  behavior: string;
  reason: string;
  remainGameMin: number;
};

function activityForRoom(roomId: string, goal: string, text: string): CharacterActivity {
  return defaultActivityForRoom(roomId, `${goal} ${text}`);
}

export function activityForRoomFromSync(
  roomId: string,
  goal: string,
  text: string,
): CharacterActivity {
  return activityForRoom(roomId, goal, text);
}

/**
 * 对话中 desire 与「此刻」冲突 → 一律延后拽腿。
 * 规则通用：欲望房间 ≠ 当前房间，且对白仍有现场 / 含规划语气 → 不切景。
 */
export function shouldDeferDesireSnap(
  living: AiLivingSave,
  characterId: string,
  desireRoomId: string,
  presentSpeech: string,
): boolean {
  if (!desireRoomId || !CAMP_ROOM_MAP[desireRoomId]) return true;
  const cur = resolveCharacterRoomId(characterId, living);
  if (desireRoomId === cur) return false;

  const speech = presentSpeech.trim();
  // 对话回合默认：只要目标不是当前房，就不靠 desire 瞬移（切景只认对白「此刻」）
  if (speechHasPresentScene(speech, characterId, cur)) return true;
  if (DIALOGUE_PLANNING_RE.test(speech) && !/(?:现在|已经|就)在/.test(speech)) return true;
  // 无对白上下文时也延后：欲望是「之后」，不是「瞬移」
  if (!speech) return true;
  // 欲望目标与对白声称的此刻不一致
  const mentionedNow = inferRoomFromText(speech, characterId);
  if (mentionedNow && mentionedNow !== desireRoomId && speechHasPresentScene(speech, characterId, mentionedNow)) {
    return true;
  }
  // 默认对话路径：不同房就延后（防任意场景抢切）
  return true;
}

function normalizeDesire(
  characterId: string,
  raw: string | DesireNextPayload | undefined | null,
): DesireNorm | null {
  if (raw == null) return null;

  if (typeof raw === 'object') {
    const reason = (raw.reason || raw.goal || '').trim();
    const roomId =
      (raw.room_id || raw.roomId || '').trim() ||
      inferRoomFromText(`${raw.goal ?? ''} ${reason}`, characterId) ||
      '';
    if (!roomId || !CAMP_ROOM_MAP[roomId]) {
      const fromGoal = inferRoomFromText(String(raw.goal ?? reason), characterId);
      if (!fromGoal) return null;
      return normalizeDesire(characterId, {
        ...raw,
        room_id: fromGoal,
        reason: reason || '聊完后想去那里',
      });
    }
    const goal = (raw.goal || reason || 'desire').trim().slice(0, 48) || 'desire';
    const remain = Math.max(
      25,
      Math.min(160, Number(raw.minutes ?? raw.remainGameMin) || 70),
    );
    const text = `${goal} ${reason}`;
    const activity = activityForRoom(roomId, goal, text);
    const place = CAMP_ROOM_MAP[roomId]!.label;
    return {
      goal: goal.startsWith('desire:') ? goal : `desire:${goal}`,
      roomId,
      activity,
      behavior: reason ? reason.slice(0, 40) : `去${place}按自己的想法待一会`,
      reason: reason || `想去${place}`,
      remainGameMin: remain,
    };
  }

  const text = String(raw).trim();
  if (!text || text === '""' || text === "''") return null;
  const m = text.match(/^(room_[\w]+)\s*[:：]\s*(.+)$/);
  if (m && CAMP_ROOM_MAP[m[1]!]) {
    return normalizeDesire(characterId, {
      room_id: m[1],
      reason: m[2],
      goal: m[2],
    });
  }
  const roomId = inferRoomFromText(text, characterId);
  if (!roomId) return null;
  return normalizeDesire(characterId, {
    room_id: roomId,
    reason: text.slice(0, 48),
    goal: text.slice(0, 32),
  });
}

/**
 * 对话里的 desire_next：默认只记念；不改当前身体房间。
 * 世界走动由作息/议程 tick 或对白「我到了××」驱动。
 */
export function applyDesireNextFromDialogue(
  living: AiLivingSave,
  characterId: string,
  desireRaw: string | DesireNextPayload | undefined,
  opts?: { presentSpeech?: string; allowSnap?: boolean },
): { ok: boolean; msg: string } {
  const norm = normalizeDesire(characterId, desireRaw);
  if (!norm) return { ok: false, msg: '无可解析欲望' };

  const cur = getAgenda(living, characterId);
  if (isProtectedAgenda(living, cur)) {
    return { ok: false, msg: '受保护议程进行中，欲望延后' };
  }

  const speech = opts?.presentSpeech ?? '';
  const defer =
    opts?.allowSnap === true
      ? shouldDeferDesireSnap(living, characterId, norm.roomId, speech)
      : true; // 对话默认永不因 desire 瞬移

  if (defer) {
    const place = CAMP_ROOM_MAP[norm.roomId]?.label ?? norm.roomId;
    // 挂起欲望：不覆盖「此刻」议程目标房，避免 chip/背景被未来意图污染
    if (!living.pendingDesires) living.pendingDesires = {};
    living.pendingDesires[characterId] = {
      roomId: norm.roomId,
      reason: norm.reason,
      goal: norm.goal,
      activity: norm.activity,
      behavior: norm.behavior,
      remainGameMin: norm.remainGameMin,
      savedAtGameMin: living.gameMinutes,
    };
    pushMemory(living, characterId, {
      kind: 'event',
      // 勿写成「角色名稍后想去…」——本地模型会整句抄进 dialogue
      summary: `[挂念·勿口述] 之后想去${place}（${norm.reason}）`,
      importance: 5,
    });
    return { ok: true, msg: `欲望挂起：${norm.reason}` };
  }

  if (
    cur &&
    cur.targetRoomId === norm.roomId &&
    cur.remainGameMin > 40 &&
    (cur.source === 'llm' || cur.source === 'social' || cur.goal.startsWith('desire:'))
  ) {
    const patched: CharacterAgenda = {
      ...cur,
      reason: norm.reason,
      behavior: norm.behavior,
      activity: norm.activity,
    };
    setAgenda(living, characterId, patched);
    applyAgendaMovement(living, characterId, patched);
    return { ok: true, msg: `续写欲望：${norm.reason}` };
  }

  const agenda: CharacterAgenda = {
    goal: norm.goal,
    targetRoomId: norm.roomId,
    activity: norm.activity,
    behavior: norm.behavior,
    remainGameMin: norm.remainGameMin,
    startedGameMin: living.gameMinutes,
    reason: norm.reason,
    source: 'llm',
  };
  setAgenda(living, characterId, agenda);
  applyAgendaMovement(living, characterId, agenda);

  pushMemory(living, characterId, {
    kind: 'event',
    summary: `[挂念·勿口述] 聊完后想去${CAMP_ROOM_MAP[norm.roomId]?.label ?? norm.roomId}（${norm.reason}）`,
    importance: 5,
  });
  return { ok: true, msg: agenda.reason };
}

/** 对话结束后：把挂起欲望落成议程并开始走（若有） */
export function commitPendingDesireAfterDialogue(
  living: AiLivingSave,
  characterId: string,
): { ok: boolean; msg: string } {
  const pending = living.pendingDesires?.[characterId];
  if (!pending?.roomId || !CAMP_ROOM_MAP[pending.roomId]) {
    return { ok: false, msg: '无挂起欲望' };
  }
  if (isProtectedAgenda(living, getAgenda(living, characterId))) {
    return { ok: false, msg: '受保护议程，挂起保留' };
  }
  const curRoom = resolveCharacterRoomId(characterId, living);
  delete living.pendingDesires![characterId];
  if (pending.roomId === curRoom) {
    return { ok: true, msg: '已在欲望地点' };
  }
  const agenda: CharacterAgenda = {
    goal: pending.goal || `desire:${pending.reason}`,
    targetRoomId: pending.roomId,
    activity: pending.activity || defaultActivityForRoom(pending.roomId, pending.reason),
    behavior: pending.behavior || pending.reason,
    remainGameMin: pending.remainGameMin || 70,
    startedGameMin: living.gameMinutes,
    reason: pending.reason,
    source: 'llm',
  };
  setAgenda(living, characterId, agenda);
  applyAgendaMovement(living, characterId, agenda);
  return { ok: true, msg: `开始前往：${CAMP_ROOM_MAP[pending.roomId]?.label ?? pending.roomId}` };
}

/** 从记忆抽出「未了之事」供深场 Prompt */
export function unfinishedBusinessLines(
  living: AiLivingSave,
  characterId: string,
  limit = 3,
): string[] {
  const mem = living.memories?.[characterId] ?? [];
  const fromMem = mem
    .filter((m) => m.importance >= 6)
    .slice(0, limit)
    .map((m) => `- ${m.summary.slice(0, 72)}`);
  const broken = mem.filter((m) => /没能办完|食言|搁下了交代/.test(m.summary)).slice(0, 1);
  if (broken.length && !fromMem.some((l) => l.includes(broken[0]!.summary.slice(0, 20)))) {
    fromMem.unshift(`- ${broken[0]!.summary.slice(0, 72)}`);
  }
  const pending = living.pendingDesires?.[characterId];
  if (pending?.reason) {
    const place = CAMP_ROOM_MAP[pending.roomId]?.label ?? pending.roomId;
    fromMem.unshift(`- 挂念：想去${place}（${pending.reason.slice(0, 40)}）`);
  }
  return fromMem.slice(0, limit);
}
