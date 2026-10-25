/**
 * 多人同屏：人数上限、赴约者场景/皮肤对齐（对话与 Prompt 共用）
 */
import {
  getCharacterSkin,
  LIFEWEAR_SKIN_ID,
} from '../../data/characterSkins';
import { CAMP_ROOM_MAP } from '../../data/campLayout';
import type { SaveData } from '../../types';
import { snapAgentToRoom } from '../campAgents';
import { planTravel } from '../travel';
import { isInSleepSystem, leaveSleepSystem, sleepWakeDifficulty } from '../sleepSystem';
import type { AiLivingSave, CampEventInstance } from '../types';
import { EVENT_AUTO_SKIN } from './campEventEffects';
import { scheduleEventTempSkinChange } from '../outfitChangeProcess';
import { getCampEventDef } from './catalog';

/** 任何多人同屏活动最多 6 人（含焦点角色） */
export const MAX_CO_SCREEN_JOINERS = 6;

export function resolveCoScreenJoinCap(defMaxJoiners?: number): number {
  const raw = defMaxJoiners ?? MAX_CO_SCREEN_JOINERS;
  return Math.min(MAX_CO_SCREEN_JOINERS, Math.max(2, raw));
}

export function capCoScreenMemberIds(ids: string[], cap = MAX_CO_SCREEN_JOINERS): string[] {
  return ids.slice(0, cap);
}

function roomLabel(roomId: string): string {
  const room = CAMP_ROOM_MAP[roomId];
  if (!room) return roomId;
  return room.kind === 'yard' ? '营地门口' : `${room.floor}楼·${room.label}`;
}

function resolveEventUnifiedSkinId(defId: string): string {
  return EVENT_AUTO_SKIN[defId] ?? LIFEWEAR_SKIN_ID;
}

/**
 * 同屏赴约者：立刻落到事件焦点房 + 统一事件外覆（有资源则生活服装/泳池/睡衣等）。
 * 避免「人在机房事件、立绘仍是寝室睡衣」的错位。
 */
export function syncCoScreenParticipantWorld(
  save: SaveData,
  living: AiLivingSave,
  ev: CampEventInstance,
): void {
  const def = getCampEventDef(ev.defId);
  if (!def?.allowsCoScreen) return;

  const cap = resolveCoScreenJoinCap(def.maxJoiners);
  const capped = capCoScreenMemberIds(
    ev.participants.filter((p) => p.inCoScreen).map((p) => p.characterId),
    cap,
  );
  // 睡太沉叫不醒的人来不了同屏（不能瞬移+瞬醒）
  const coIds = capped.filter((id) => {
    if (!isInSleepSystem(living, id)) return true;
    if (sleepWakeDifficulty(living, id).wakeable) return true;
    const part = ev.participants.find((p) => p.characterId === id);
    if (part) {
      part.inCoScreen = false;
      part.arrived = false;
    }
    return false;
  });
  ev.coScreenIds = coIds.length >= 2 ? coIds : [];

  ev.meta = {
    ...(ev.meta ?? {}),
    coScreenCap: String(cap),
    coScreenFull: coIds.length >= cap ? '1' : '0',
  };

  if (coIds.length < 2) return;

  const targetRoom = ev.focusRoomId || def.focusRoomId;
  const skinId = resolveEventUnifiedSkinId(ev.defId);
  const behavior = `在${roomLabel(targetRoom)}参与「${def.name}」`;

  if (!living.bodyAnchors) living.bodyAnchors = {};

  for (const id of coIds) {
    const part = ev.participants.find((p) => p.characterId === id);
    if (part) part.arrived = true;

    // 叫不醒的人不进同屏：睡得太沉就是来不了（不能瞬移+瞬醒）
    if (isInSleepSystem(living, id)) {
      if (!sleepWakeDifficulty(living, id).wakeable) {
        if (part) {
          part.arrived = false;
          part.inCoScreen = false;
        }
        continue;
      }
      leaveSleepSystem(living, id, {
        reason: `被营地事件「${def.name}」叫醒`,
        completed: false,
      });
    }

    const curRoom = living.bodyAnchors?.[id]?.roomId;
    const fromRoom = curRoom && CAMP_ROOM_MAP[curRoom] ? curRoom : targetRoom;
    if (fromRoom !== targetRoom) {
      // 赴约要走路：到点才落点/切场景
      planTravel(living, id, targetRoom, fromRoom, {
        activity: def.arriveActivity,
        behavior: `去${roomLabel(targetRoom)}参加「${def.name}」`,
        reason: 'coscreen',
        arriveBehavior: behavior,
      });
    } else {
      snapAgentToRoom(id, targetRoom, {
        activity: def.arriveActivity,
        behavior,
      });
      const prev = living.bodyAnchors[id];
      living.bodyAnchors[id] = {
        roomId: targetRoom,
        activity: def.arriveActivity,
        behavior,
        atGameMin: living.gameMinutes,
        seq: (prev?.seq ?? 0) + 1,
      };
    }

    if (getCharacterSkin(id, skinId)) {
      // 其它事件会话（舞蹈/安抚/浴室/调教）独占时不得被同屏统一皮覆盖
      const inst = living.eventTempSkins?.[id]?.eventInstanceId;
      if (inst && inst !== ev.instanceId) continue;
      // 统一事件外覆也要「先换衣再显形」
      scheduleEventTempSkinChange(living, id, skinId, ev.instanceId, 2_600);
    }
  }
}
