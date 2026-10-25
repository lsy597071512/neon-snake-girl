/**
 * 走路/到达：角色的移动必须有路程时间与过程场景。
 * 禁止「同意就瞬移到大厅/安抚室」——先登记行程，按途经点实时推进，到点才落点。
 *
 * - 行程存于 living.travelPlans[characterId]
 * - 途中 presence 按"途经点"实时变化：起点 → 楼梯/大厅 → 目的地（背景随之实时切换）
 * - 到达由 tickTravelPlans 结算（心跳 / 1.5s 泵 / 对话 1s 心跳）
 */
import { CAMP_ROOM_MAP } from '../data/campLayout';
import type { AiLivingSave, CharacterActivity, LivingPresence } from './types';
import { snapAgentToRoom } from './campAgents';

export type TravelWaypoint = {
  roomId: string;
  /** 相对行程起点的毫秒偏移 */
  atMs: number;
  /** 已经"走到"该途经点（由 tickTravelWaypoints 标记） */
  reached?: boolean;
};

export type TravelPlan = {
  fromRoomId: string;
  toRoomId: string;
  startedAtMs: number;
  arriveAtMs: number;
  activity: CharacterActivity;
  behavior: string;
  arriveBehavior?: string;
  reason: string;
  waypoints?: TravelWaypoint[];
};

export type TravelArrival = {
  characterId: string;
  toRoomId: string;
  reason: string;
};

export function ensureTravelPlans(living: AiLivingSave): Record<string, TravelPlan> {
  if (!living.travelPlans) living.travelPlans = {};
  return living.travelPlans;
}

export function getTravelPlan(living: AiLivingSave, characterId: string): TravelPlan | null {
  return living.travelPlans?.[characterId] ?? null;
}

export function isTraveling(living: AiLivingSave, characterId: string, now = Date.now()): boolean {
  const p = getTravelPlan(living, characterId);
  return !!p && now < p.arriveAtMs;
}

export function travelRemainMs(living: AiLivingSave, characterId: string, now = Date.now()): number {
  const p = getTravelPlan(living, characterId);
  return p ? Math.max(0, p.arriveAtMs - now) : 0;
}

function roomFloorLabel(roomId: string): string {
  const r = CAMP_ROOM_MAP[roomId];
  if (!r) return roomId;
  return r.kind === 'yard' ? '营地门口' : `${r.floor}楼·${r.label}`;
}

/** 路程估算：同层约 8 秒；跨一层 +6 秒；进出营地门口 +6 秒；上限 26 秒 */
export function walkDurationMs(fromRoomId: string, toRoomId: string): number {
  const a = CAMP_ROOM_MAP[fromRoomId];
  const b = CAMP_ROOM_MAP[toRoomId];
  if (!a || !b) return 8_000;
  let ms = 8_000;
  if (a.kind === 'yard' || b.kind === 'yard') ms += 6_000;
  ms += Math.abs((a.floor ?? 0) - (b.floor ?? 0)) * 6_000;
  return Math.min(26_000, Math.max(5_000, ms));
}

function hallOnFloor(floor: number): string | null {
  if (floor === 1) return 'room_1f_hall1';
  if (floor === 2) return 'room_2f_atrium';
  return null;
}

function stairsOnFloor(floor: number): string | null {
  if (floor === 1) return 'room_1f_stairs';
  if (floor === 2) return 'room_2f_stairs';
  return null;
}

/**
 * 途经点：让"边聊边走"的背景能实时换景。
 * - 跨层：出发层楼梯 → 目标层楼梯口
 * - 同层：本层大厅/中庭
 * - 进出营地门口：大门 → 楼梯
 */
function pickWaypoints(fromRoomId: string, toRoomId: string, durationMs: number): TravelWaypoint[] {
  const from = CAMP_ROOM_MAP[fromRoomId];
  const to = CAMP_ROOM_MAP[toRoomId];
  if (!from || !to) return [];
  const out: TravelWaypoint[] = [];
  const push = (roomId: string | null, ratio: number) => {
    if (!roomId || roomId === fromRoomId || roomId === toRoomId) return;
    if (out.some((w) => w.roomId === roomId)) return;
    out.push({ roomId, atMs: Math.round(durationMs * ratio) });
  };
  const fromFloor = from.floor ?? 0;
  const toFloor = to.floor ?? 0;

  if (from.kind === 'yard' || to.kind === 'yard') {
    push('room_1f_gate', 0.3);
    if (fromFloor !== toFloor) push(stairsOnFloor(fromFloor || 1), 0.55);
    return out;
  }
  if (fromFloor !== toFloor) {
    push(stairsOnFloor(fromFloor), 0.4);
    push(stairsOnFloor(toFloor), 0.72);
    return out;
  }
  push(hallOnFloor(fromFloor), 0.55);
  return out;
}

/**
 * 登记行程。同房间直接返回 started:false（调用方按原逻辑就地落点）。
 * 路上暂不切皮：需要"换好再走"的调用方应自己先排队换装。
 */
export function planTravel(
  living: AiLivingSave,
  characterId: string,
  toRoomId: string,
  fromRoomId: string,
  opts: {
    activity: CharacterActivity;
    behavior: string;
    reason: string;
    arriveBehavior?: string;
    durationMs?: number;
  },
): { started: boolean; etaMs: number } {
  if (!CAMP_ROOM_MAP[toRoomId] || !CAMP_ROOM_MAP[fromRoomId]) {
    return { started: false, etaMs: 0 };
  }
  if (toRoomId === fromRoomId) return { started: false, etaMs: 0 };
  const plans = ensureTravelPlans(living);
  const now = Date.now();
  const duration = opts.durationMs ?? walkDurationMs(fromRoomId, toRoomId);
  plans[characterId] = {
    fromRoomId,
    toRoomId,
    startedAtMs: now,
    arriveAtMs: now + duration,
    activity: opts.activity,
    behavior: opts.behavior,
    arriveBehavior: opts.arriveBehavior,
    reason: opts.reason,
    waypoints: pickWaypoints(fromRoomId, toRoomId, duration),
  };
  return { started: true, etaMs: duration };
}

export function cancelTravel(living: AiLivingSave, characterId: string): void {
  if (living.travelPlans) delete living.travelPlans[characterId];
}

/** 当前所处阶段键（起点 / 途经点）——用于对话层判断是否需要实时刷新背景 */
export function getTravelStageKey(
  living: AiLivingSave,
  characterId: string,
  now = Date.now(),
): string {
  const p = getTravelPlan(living, characterId);
  if (!p || now >= p.arriveAtMs) return '';
  const elapsed = now - p.startedAtMs;
  let roomId = p.fromRoomId;
  for (const wp of p.waypoints ?? []) {
    if (elapsed >= wp.atMs) roomId = wp.roomId;
  }
  return `${p.startedAtMs}:${roomId}`;
}

/** 途中 presence：按途经点实时换景（起点 → 楼梯/大厅 → 目的地） */
export function applyTravelPresence(
  characterId: string,
  living: AiLivingSave,
  base: LivingPresence,
  now = Date.now(),
): LivingPresence | null {
  const p = getTravelPlan(living, characterId);
  if (!p || now >= p.arriveAtMs) return null;
  const elapsed = now - p.startedAtMs;
  let currentRoomId = p.fromRoomId;
  let viaLabel: string | null = null;
  for (const wp of p.waypoints ?? []) {
    if (elapsed >= wp.atMs) {
      currentRoomId = wp.roomId;
      viaLabel = CAMP_ROOM_MAP[wp.roomId]?.label ?? wp.roomId;
    }
  }
  const cur = CAMP_ROOM_MAP[currentRoomId];
  const toLabel = roomFloorLabel(p.toRoomId);
  const leftSec = Math.max(1, Math.ceil((p.arriveAtMs - now) / 1000));
  const where = viaLabel ? `正经过${viaLabel}` : '正要出门';
  return {
    ...base,
    roomId: currentRoomId,
    locationId: cur?.sceneId ?? base.locationId,
    activity: viaLabel ? 'idle' : p.activity,
    behavior: `${where}，去${toLabel}的路上（约 ${leftSec} 秒）`,
    label: `路上 · ${roomLabelOf(currentRoomId)}→${toLabel}`,
  };
}

function roomLabelOf(roomId: string): string {
  const r = CAMP_ROOM_MAP[roomId];
  if (!r) return roomId;
  return r.kind === 'yard' ? '营地门口' : `${r.floor}楼·${r.label}`;
}

/**
 * 途经点推进：走到楼梯/大厅时把 agent 也挪过去（营地地图上能看到分段移动），
 * 但**不写身体锚点**——锚点只代表"已到达目的地"。
 */
export function tickTravelWaypoints(
  living: AiLivingSave,
  now = Date.now(),
): { characterId: string; roomId: string }[] {
  const plans = living.travelPlans;
  if (!plans) return [];
  const moved: { characterId: string; roomId: string }[] = [];
  for (const [id, p] of Object.entries(plans)) {
    if (now >= p.arriveAtMs) continue;
    const elapsed = now - p.startedAtMs;
    for (const wp of p.waypoints ?? []) {
      if (wp.reached || elapsed < wp.atMs) continue;
      wp.reached = true;
      snapAgentToRoom(id, wp.roomId, {
        activity: 'idle',
        behavior: `正经过${CAMP_ROOM_MAP[wp.roomId]?.label ?? wp.roomId}，去${roomLabelOf(p.toRoomId)}的路上`,
      });
      moved.push({ characterId: id, roomId: wp.roomId });
    }
  }
  return moved;
}

/** 到点落点：写 agent + 身体锚点，返回到达列表供上层派发（会话相位切换等） */
export function tickTravelPlans(living: AiLivingSave, now = Date.now()): TravelArrival[] {
  const plans = living.travelPlans;
  if (!plans) return [];
  const arrivals: TravelArrival[] = [];
  for (const [id, p] of Object.entries(plans)) {
    if (now < p.arriveAtMs) continue;
    delete plans[id];
    snapAgentToRoom(id, p.toRoomId, {
      activity: p.activity,
      behavior: p.arriveBehavior ?? p.behavior,
    });
    if (!living.bodyAnchors) living.bodyAnchors = {};
    const prev = living.bodyAnchors[id];
    living.bodyAnchors[id] = {
      roomId: p.toRoomId,
      activity: p.activity,
      behavior: p.arriveBehavior ?? p.behavior,
      atGameMin: living.gameMinutes,
      seq: (prev?.seq ?? 0) + 1,
    };
    arrivals.push({ characterId: id, toRoomId: p.toRoomId, reason: p.reason });
  }
  return arrivals;
}
