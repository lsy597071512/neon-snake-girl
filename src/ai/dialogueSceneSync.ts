/**
 * 对话轮次场景同步：允许世界时钟推进导致换房/换装，
 * 但必须把「已切换」注入 Prompt，避免对白仍停在上一环境。
 */
import { CAMP_ROOM_MAP } from '../data/campLayout';
import { getCharacterSkin } from '../data/characterSkins';
import { getCoScreenGroupForCharacter } from './campEvents';
import { getCampEventDef } from './campEvents/catalog';
import { getAgenda, isAgendaActive } from './characterAgenda';
import { resolvePresence, resolveCharacterRoomId } from './livingState';
import type { AiLivingSave, CharacterActivity, DialogueSceneSnapshot } from './types';

function resolveSkin(living: AiLivingSave, characterId: string): { key: string; name: string } {
  const temp = living.eventTempSkins?.[characterId]?.skinId;
  if (temp) {
    return {
      key: `temp:${temp}`,
      name: getCharacterSkin(characterId, temp)?.name ?? temp,
    };
  }
  const worn = living.campWornSkins?.[characterId];
  if (worn) {
    return {
      key: `camp:${worn}`,
      name: getCharacterSkin(characterId, worn)?.name ?? worn,
    };
  }
  return { key: 'default', name: '默认外观' };
}

export function captureDialogueSceneSnapshot(
  living: AiLivingSave,
  characterId: string,
): DialogueSceneSnapshot {
  const co = getCoScreenGroupForCharacter(living, characterId);
  if (co) {
    const def = getCampEventDef(co.defId);
    const skin = resolveSkin(living, characterId);
    const presence = resolvePresence(characterId, living);
    return {
      roomId: co.focusRoomId,
      activity: (def?.arriveActivity ?? presence.activity) as CharacterActivity,
      behavior: `在${co.focusLabel}参与「${co.eventName}」`,
      presenceLabel: co.focusLabel,
      skinKey: skin.key,
      skinName: skin.name,
      capturedAtGameMin: living.gameMinutes,
    };
  }

  const presence = resolvePresence(characterId, living);
  const agenda = getAgenda(living, characterId);
  // 身体实际房间优先（agent/presence），勿用未抵达的议程目标房覆盖「此刻」
  const roomId = resolveCharacterRoomId(characterId, living) || presence.roomId;
  const skin = resolveSkin(living, characterId);
  const sameRoomAgenda =
    agenda && isAgendaActive(agenda) && agenda.targetRoomId === roomId;
  return {
    roomId,
    activity: (sameRoomAgenda ? agenda!.activity : presence.activity) as CharacterActivity,
    behavior: (sameRoomAgenda ? agenda!.behavior : presence.behavior) || presence.behavior,
    presenceLabel: presence.label,
    skinKey: skin.key,
    skinName: skin.name,
    capturedAtGameMin: living.gameMinutes,
  };
}

export function getDialogueSceneSnapshot(
  living: AiLivingSave,
  characterId: string,
): DialogueSceneSnapshot | null {
  return living.dialogueTurnScene?.[characterId] ?? null;
}

export function commitDialogueSceneSnapshot(
  living: AiLivingSave,
  characterId: string,
  snap?: DialogueSceneSnapshot,
): void {
  if (!living.dialogueTurnScene) living.dialogueTurnScene = {};
  living.dialogueTurnScene[characterId] = snap ?? captureDialogueSceneSnapshot(living, characterId);
}

export function clearDialogueSceneSnapshots(living: AiLivingSave, characterIds?: string[]): void {
  if (!living.dialogueTurnScene) return;
  if (!characterIds?.length) {
    living.dialogueTurnScene = {};
    return;
  }
  for (const id of characterIds) delete living.dialogueTurnScene[id];
}

function roomLabel(roomId: string): string {
  const r = CAMP_ROOM_MAP[roomId];
  if (!r) return roomId;
  return r.floor ? `${r.floor}楼·${r.label}` : r.label;
}

function activityCn(a: string): string {
  const map: Record<string, string> = {
    idle: '闲着',
    busy: '忙碌',
    talking: '交谈',
    sleeping: '睡觉',
    patrol: '巡逻',
    maintain: '维护',
    rest: '歇息',
    play: '玩乐',
    bathe: '洗浴',
    eat: '进食',
    guard: '戒备',
  };
  return map[a] || a;
}

/**
 * 对比上一轮快照与此刻：有换房/换活动/换装则生成硬规则块。
 */
export function buildSceneTransitionPromptBlock(
  prev: DialogueSceneSnapshot | null | undefined,
  next: DialogueSceneSnapshot,
): string {
  if (!prev) return '';

  const roomChanged = prev.roomId !== next.roomId;
  const activityChanged = prev.activity !== next.activity;
  const skinChanged = prev.skinKey !== next.skinKey;
  if (!roomChanged && !activityChanged && !skinChanged) return '';

  const bits: string[] = [];
  if (roomChanged) {
    bits.push(`地点：${roomLabel(prev.roomId)} → ${roomLabel(next.roomId)}（${next.presenceLabel}）`);
  }
  if (activityChanged) {
    bits.push(`活动：${activityCn(prev.activity)}「${prev.behavior}」→ ${activityCn(next.activity)}「${next.behavior}」`);
  }
  if (skinChanged) {
    bits.push(`外观：${prev.skinName} → ${next.skinName}`);
  }

  const leftPrivate =
    (prev.activity === 'bathe' || prev.roomId === 'room_1f_bath') &&
    next.activity !== 'bathe' &&
    next.roomId !== 'room_1f_bath';

  return `【场景已切换·硬规则】自上一句对白以来，你的身体状态已变化：
${bits.map((b) => `- ${b}`).join('\n')}
必须遵守：
1. 本轮 dialogue / action / inner_thought 必须以【此刻】地点、活动、外观为准；禁止继续假装仍在上一地点做上一件事（例如已出浴室却仍在搓澡/冲澡）。
2. 用一两句自然交代「已经换环境/换装/做完上一段事」（口语，不要系统播报腔）。
3. 下方历史对白若仍停在旧场景，只作前情，不可覆盖此刻现实。
4. 若私密/洗浴等情境已结束且你想独处歇息：可 end_conversation=true，并写 end_reason（如「洗完了回房歇一会」）。
${leftPrivate ? '5. 你刚离开洗浴/浴室：优先考虑收尾或改聊回房后的事，禁止继续浴室玩法对白。' : ''}`;
}

/** 无切换时的常驻提醒：历史场景不得压过此刻 */
export function buildSceneRealtimeRuleLine(): string {
  return `【实时场景】地点跟本轮「此刻」对白走；规划句与 desire_next 不切景。换衣服必须等立绘换上再按新衣说话：嘴上还在旧衣时禁止声称已穿新衣。`;
}

/** @deprecated 兼容旧字段清理 */
export function clearLegacyDialoguePresenceLocks(living: AiLivingSave): void {
  if (living.dialoguePresenceLocks) {
    delete living.dialoguePresenceLocks;
  }
}

export function ensureDialogueSceneFields(living: AiLivingSave): void {
  if (!living.dialogueTurnScene) living.dialogueTurnScene = {};
  if (!living.pendingOutfitChanges) living.pendingOutfitChanges = {};
  if (!living.outfitWearLocks) living.outfitWearLocks = {};
  clearLegacyDialoguePresenceLocks(living);
}
