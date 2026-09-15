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
import { isDeepSleeping, leaveSleepSystem } from '../sleepSystem';
import type { AiLivingSave, CampEventInstance } from '../types';
import { EVENT_AUTO_SKIN, setEventTempSkin } from './campEventEffects';
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
  const coIds = capCoScreenMemberIds(
    ev.participants.filter((p) => p.inCoScreen).map((p) => p.characterId),
    cap,
  );
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

    if (isDeepSleeping(living, id)) {
      leaveSleepSystem(living, id, {
        reason: `被营地事件「${def.name}」叫醒`,
        completed: false,
      });
    }

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

    if (getCharacterSkin(id, skinId)) {
      setEventTempSkin(save, living, id, skinId, ev.instanceId);
    }
  }
}
