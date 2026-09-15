/**
 * 关系牵引：同伴去商店/泳池/武器库等时，亲近者有概率尾随偶遇。
 */
import { CHARACTER_MAP } from '../data/characters';
import { CAMP_ROOM_MAP } from '../data/campLayout';
import {
  applyAgendaMovement,
  getAgenda,
  isAgendaActive,
  isProtectedAgenda,
  setAgenda,
} from './characterAgenda';
import { getRelation } from './relationship';
import type { AiLivingSave, CharacterAgenda } from './types';

/** 值得被尾随的「外出/地标」意图 */
const FOLLOWABLE_ROOMS = new Set([
  'room_1f_pool',
  'room_1f_shop',
  'room_1f_armory',
  'room_1f_tower',
  'room_yard',
]);

function hash01(a: string, b: string, salt: number): number {
  let h = salt >>> 0;
  const s = `${a}|${b}`;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function isFollowableAgenda(ag: CharacterAgenda | null): boolean {
  if (!isAgendaActive(ag)) return false;
  if (ag!.source === 'event' || ag!.source === 'player_task') return false;
  if (ag!.goal.startsWith('follow:')) return false;
  return FOLLOWABLE_ROOMS.has(ag!.targetRoomId);
}

/**
 * 扫描 owned，为亲近同伴写入短时尾随意程（不打断受保护任务）。
 * 建议在议程刷新后调用。
 */
export function tryApplyCompanionFollows(
  living: AiLivingSave,
  ownedIds: string[],
): string[] {
  const notes: string[] = [];
  const leaders = ownedIds.filter((id) => isFollowableAgenda(getAgenda(living, id)));

  for (const leaderId of leaders) {
    const lead = getAgenda(living, leaderId)!;
    const leadName = CHARACTER_MAP[leaderId]?.name ?? leaderId;
    const place = CAMP_ROOM_MAP[lead.targetRoomId]?.label ?? lead.targetRoomId;

    for (const peerId of ownedIds) {
      if (peerId === leaderId) continue;
      const peerAg = getAgenda(living, peerId);
      if (isProtectedAgenda(living, peerAg)) continue;
      // 已在同目标或已在尾随此人 → 跳过
      if (
        peerAg &&
        isAgendaActive(peerAg) &&
        (peerAg.targetRoomId === lead.targetRoomId ||
          peerAg.goal === `follow:${leaderId}`)
      ) {
        continue;
      }
      // 同伴自己也有强意图且剩余还多 → 不硬拉
      if (peerAg && peerAg.remainGameMin > 55 && peerAg.source === 'need') continue;

      const rel = getRelation(living, leaderId, peerId);
      if (rel < 22) continue;

      // 关系越高越容易尾随；每对每天盐不同
      const chance = Math.min(0.55, 0.12 + rel / 180);
      const roll = hash01(leaderId, peerId, living.dayIndex * 97 + lead.targetRoomId.length);
      if (roll > chance) continue;

      // 同一领导者最多带 2 个尾随，避免全家跟着去泳池
      const already = ownedIds.filter((id) => {
        const a = getAgenda(living, id);
        return a?.goal === `follow:${leaderId}` && isAgendaActive(a);
      }).length;
      if (already >= 2) break;

      const follow: CharacterAgenda = {
        goal: `follow:${leaderId}`,
        targetRoomId: lead.targetRoomId,
        activity: lead.activity === 'maintain' ? 'busy' : lead.activity,
        behavior: `跟着${leadName}去${place}`,
        remainGameMin: Math.min(70, Math.max(30, Math.floor(lead.remainGameMin * 0.7))),
        startedGameMin: living.gameMinutes,
        reason: `想跟${leadName}一起（关系${rel}）`,
        source: 'social',
      };
      setAgenda(living, peerId, follow);
      applyAgendaMovement(living, peerId, follow);
      notes.push(`${CHARACTER_MAP[peerId]?.name ?? peerId}→随${leadName}去${place}`);
    }
  }

  return notes;
}
