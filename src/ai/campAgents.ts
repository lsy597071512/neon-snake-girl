/**
 * 营地角色代理：沿导航折线走动 + 碰撞修正
 * LLM 只给目标房间；本模块负责可见移动
 */
import {
  buildWaypointPolyline,
  estimateWalkDurationMs,
  getRoomNav,
  pickRoomWanderPoint,
  resolveCollision,
  roomFloor,
  samplePolyline,
  syncLayoutAnchorsFromNav,
  type CampVec,
} from '../data/campNav';
import { CAMP_ROOM_MAP, neighborsOf, type CampFloor } from '../data/campLayout';

export type CampAgentState = {
  characterId: string;
  roomId: string;
  targetRoomId: string;
  /** 本段折线实际终点房间（可能是换层中转楼梯） */
  walkGoal?: string;
  x: number;
  y: number;
  activity: string;
  behavior: string;
  /** 折线行走 */
  path: CampVec[];
  pathStartedAt: number;
  pathDurationMs: number;
  moving: boolean;
  lastWanderAt: number;
};

const agents = new Map<string, CampAgentState>();

syncLayoutAnchorsFromNav();

function ensureAgent(characterId: string, roomId: string): CampAgentState {
  let a = agents.get(characterId);
  if (a) return a;
  const nav = getRoomNav(roomId) ?? getRoomNav('room_1f_hall1')!;
  const pos = resolveCollision(nav.anchor, roomFloor(nav.roomId));
  a = {
    characterId,
    roomId: nav.roomId,
    targetRoomId: nav.roomId,
    x: pos.x,
    y: pos.y,
    activity: 'idle',
    behavior: '在营',
    path: [],
    pathStartedAt: 0,
    pathDurationMs: 0,
    moving: false,
    lastWanderAt: Date.now(),
  };
  agents.set(characterId, a);
  return a;
}

function startWalk(a: CampAgentState, toRoomId: string): void {
  if (!CAMP_ROOM_MAP[toRoomId]) return;
  if (a.moving && a.targetRoomId === toRoomId) return;

  // 跨层：先走到本层楼梯，再瞬移换层坐标（同楼梯口）
  const fromFloor = roomFloor(a.roomId);
  const toFloor = roomFloor(toRoomId);
  let goal = toRoomId;
  if (fromFloor !== toFloor) {
    goal = fromFloor === 1 ? 'room_1f_stairs' : 'room_2f_stairs';
    if (a.roomId === goal) {
      // 已在楼梯 → 换到对面楼梯再继续
      const other = fromFloor === 1 ? 'room_2f_stairs' : 'room_1f_stairs';
      a.roomId = other;
      const nav = getRoomNav(other)!;
      a.x = nav.anchor.x;
      a.y = nav.anchor.y;
      goal = toRoomId;
    }
  }

  const poly = buildWaypointPolyline(a.roomId, goal);
  if (poly.length < 2) {
    const nav = getRoomNav(goal);
    if (nav) {
      a.roomId = goal;
      a.targetRoomId = toRoomId;
      a.x = nav.anchor.x;
      a.y = nav.anchor.y;
      a.moving = false;
      a.path = [];
    }
    return;
  }

  a.path = [{ x: a.x, y: a.y }, ...poly.slice(1)];
  a.pathStartedAt = performance.now();
  a.pathDurationMs = estimateWalkDurationMs(a.path);
  a.moving = true;
  a.targetRoomId = toRoomId;
  a.walkGoal = goal;
}

export function setAgentDestination(
  characterId: string,
  targetRoomId: string,
  meta?: { activity?: string; behavior?: string; fromRoomId?: string },
): void {
  const startRoom = meta?.fromRoomId ?? agents.get(characterId)?.roomId ?? targetRoomId;
  const a = ensureAgent(characterId, startRoom);
  if (meta?.activity) a.activity = meta.activity;
  if (meta?.behavior) a.behavior = meta.behavior;

  if (targetRoomId === a.roomId && !a.moving) {
    // 同房：微移
    const spot = pickRoomWanderPoint(a.roomId, { x: a.x, y: a.y });
    a.path = [
      { x: a.x, y: a.y },
      spot,
    ];
    a.pathStartedAt = performance.now();
    a.pathDurationMs = estimateWalkDurationMs(a.path);
    a.moving = true;
    a.targetRoomId = targetRoomId;
    a.walkGoal = targetRoomId;
    a.lastWanderAt = Date.now();
    return;
  }

  startWalk(a, targetRoomId);
}

/** 本地兜底：沿邻接图迈一步（LLM 慢/失败时仍能动） */
export function localStepAgent(characterId: string, preferredRoomId?: string): void {
  const a = agents.get(characterId) ?? ensureAgent(characterId, preferredRoomId ?? 'room_1f_hall1');
  if (a.moving) return;
  const neigh = neighborsOf(a.roomId).filter((id) => CAMP_ROOM_MAP[id]);
  if (!neigh.length) return;
  let next = preferredRoomId && neigh.includes(preferredRoomId)
    ? preferredRoomId
    : neigh[Math.floor(Math.random() * neigh.length)];
  // 若有更远目标且在邻接中优先
  if (preferredRoomId && preferredRoomId !== a.roomId) {
    const toward = neigh.find((n) => n === preferredRoomId) ?? next;
    next = toward;
  }
  setAgentDestination(characterId, next, {
    activity: 'busy',
    behavior: `走向${CAMP_ROOM_MAP[next]?.label ?? next}`,
  });
}

export function tickCampAgents(now = performance.now()): void {
  for (const a of agents.values()) {
    if (!a.moving || !a.path.length) continue;
    const t = (now - a.pathStartedAt) / Math.max(1, a.pathDurationMs);
    if (t >= 1) {
      const end = a.path[a.path.length - 1];
      const floor = roomFloor(a.walkGoal ?? a.roomId);
      const pos = resolveCollision(end, floor);
      a.x = pos.x;
      a.y = pos.y;
      a.moving = false;
      a.path = [];
      if (a.walkGoal) {
        a.roomId = a.walkGoal;
        const finalTarget = a.targetRoomId;
        a.walkGoal = undefined;
        if (finalTarget && finalTarget !== a.roomId) {
          startWalk(a, finalTarget);
        }
      }
      continue;
    }
    const sample = samplePolyline(a.path, t);
    const floor = roomFloor(a.walkGoal ?? a.roomId);
    const pos = resolveCollision(sample, floor);
    a.x = pos.x;
    a.y = pos.y;
  }
}

export function getAgent(characterId: string): CampAgentState | null {
  return agents.get(characterId) ?? null;
}

/**
 * 对话开场：瞬间落到目标房间，避免「状态已到泳池、立绘还在卧室走路」的错位。
 */
export function snapAgentToRoom(
  characterId: string,
  roomId: string,
  meta?: { activity?: string; behavior?: string },
): void {
  if (!CAMP_ROOM_MAP[roomId]) return;
  const a = ensureAgent(characterId, roomId);
  const nav = getRoomNav(roomId);
  if (!nav) return;
  a.roomId = roomId;
  a.targetRoomId = roomId;
  a.walkGoal = undefined;
  a.x = nav.anchor.x;
  a.y = nav.anchor.y;
  a.moving = false;
  a.path = [];
  a.pathStartedAt = 0;
  a.pathDurationMs = 0;
  if (meta?.activity) a.activity = meta.activity;
  if (meta?.behavior) a.behavior = meta.behavior;
}

export function listAgentsOnFloor(floor: CampFloor): CampAgentState[] {
  return [...agents.values()].filter((a) => roomFloor(a.roomId) === floor || (a.moving && roomFloor(a.targetRoomId) === floor));
}

export function ensureAgentsForOwned(ownedIds: string[], roomOf: (id: string) => string): void {
  for (const id of ownedIds) {
    if (!agents.has(id)) ensureAgent(id, roomOf(id));
  }
}

export function getAgentDisplayPos(characterId: string): CampVec | null {
  const a = agents.get(characterId);
  if (!a) return null;
  return { x: a.x, y: a.y };
}

export function clearCampAgents(): void {
  agents.clear();
}
