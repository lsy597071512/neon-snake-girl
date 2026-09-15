/**
 * 多人事件同屏：仅由事件赴约产生，偶然同房不算
 */
import { CHARACTER_MAP } from '../../data/characters';
import { CAMP_ROOM_MAP } from '../../data/campLayout';
import type { AiLivingSave, CampEventInstance } from '../types';
import { getCampEventDef } from './catalog';
import { capCoScreenMemberIds, resolveCoScreenJoinCap } from './coScreenSync';

export {
  MAX_CO_SCREEN_JOINERS,
  resolveCoScreenJoinCap,
  capCoScreenMemberIds,
  syncCoScreenParticipantWorld,
} from './coScreenSync';

export type CoScreenGroup = {
  instanceId: string;
  defId: string;
  eventName: string;
  focusRoomId: string;
  focusLabel: string;
  memberIds: string[];
  topic?: string;
  blurb?: string;
  /** 争吵双方等 */
  meta?: Record<string, string>;
};

function roomLabel(roomId: string): string {
  const room = CAMP_ROOM_MAP[roomId];
  if (!room) return roomId;
  return room.kind === 'yard' ? '营地门口' : `${room.floor}楼·${room.label}`;
}

/** 刷新同屏列表（赴约者；硬上限 6 人） */
export function refreshCoScreenMembership(living: AiLivingSave, ev: CampEventInstance): void {
  const def = getCampEventDef(ev.defId);
  if (!def?.allowsCoScreen) {
    ev.coScreenIds = [];
    return;
  }
  const cap = resolveCoScreenJoinCap(def.maxJoiners);
  const ids = capCoScreenMemberIds(
    ev.participants.filter((p) => p.inCoScreen).map((p) => p.characterId),
    cap,
  );
  ev.coScreenIds = ids.length >= 2 ? ids : [];
  ev.meta = {
    ...(ev.meta ?? {}),
    coScreenCap: String(cap),
    coScreenFull: ids.length >= cap ? '1' : '0',
  };
}

/**
 * 若角色正处在「活跃多人事件同屏」中，返回同屏组；否则 null。
 * 偶然同房不会返回。
 */
export function getCoScreenGroupForCharacter(
  living: AiLivingSave,
  characterId: string,
): CoScreenGroup | null {
  const active = (living.activeCampEvents ?? []).filter((e) => e.phase === 'active');
  for (const ev of active) {
    const def = getCampEventDef(ev.defId);
    if (!def?.allowsCoScreen) continue;
    const members = ev.coScreenIds ?? [];
    if (members.length < 2) continue;
    if (!members.includes(characterId)) continue;
    return {
      instanceId: ev.instanceId,
      defId: ev.defId,
      eventName: def.name,
      focusRoomId: ev.focusRoomId,
      focusLabel: roomLabel(ev.focusRoomId),
      memberIds: [...members],
      topic: ev.meta?.chatTopic,
      blurb: def.blurb,
      meta: ev.meta ? { ...ev.meta } : undefined,
    };
  }
  return null;
}

export function describeCoScreenMembers(memberIds: string[]): string {
  return memberIds.map((id) => CHARACTER_MAP[id]?.name ?? id).join('、');
}
