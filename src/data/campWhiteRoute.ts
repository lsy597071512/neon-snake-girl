/**
 * 基于 luxian 白线网格的路径搜索（百分比坐标）
 */
import { CAMP_ROUTE_GRAPH, type CampRouteNode } from './campRouteGraph.generated';
import type { CampFloor } from './campLayout';

export type CampVec = { x: number; y: number };

function dist(a: CampRouteNode, b: CampRouteNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nearestNodeId(floor: CampFloor, p: CampVec): number {
  const g = floor === 1 || floor === 2 ? CAMP_ROUTE_GRAPH[floor] : CAMP_ROUTE_GRAPH[1];
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    const d = dist(g.nodes[i], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function buildAdj(floor: CampFloor): number[][] {
  const g = floor === 1 || floor === 2 ? CAMP_ROUTE_GRAPH[floor] : CAMP_ROUTE_GRAPH[1];
  const adj: number[][] = Array.from({ length: g.nodes.length }, () => []);
  for (const [a, b] of g.edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return adj;
}

const ADJ_CACHE: Partial<Record<CampFloor, number[][]>> = {};

function adjOf(floor: CampFloor): number[][] {
  return (ADJ_CACHE[floor] ??= buildAdj(floor));
}

/** 白线网格 A*：返回百分比折线（含起终点） */
export function findWhiteRoutePolyline(floor: CampFloor, from: CampVec, to: CampVec): CampVec[] {
  const g = floor === 1 || floor === 2 ? CAMP_ROUTE_GRAPH[floor] : null;
  if (!g?.nodes?.length) return [from, to];

  const start = nearestNodeId(floor, from);
  const goal = nearestNodeId(floor, to);
  if (start === goal) {
    return [from, { x: g.nodes[goal].x, y: g.nodes[goal].y }, to];
  }

  const adj = adjOf(floor);
  const open = new Set<number>([start]);
  const came = new Map<number, number>();
  const gScore = new Map<number, number>([[start, 0]]);
  const fScore = new Map<number, number>([[start, dist(g.nodes[start], g.nodes[goal])]]);

  while (open.size) {
    let cur = -1;
    let bestF = Infinity;
    for (const id of open) {
      const f = fScore.get(id) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        cur = id;
      }
    }
    if (cur < 0) break;
    if (cur === goal) {
      const pathIds = [cur];
      while (came.has(pathIds[0])) {
        pathIds.unshift(came.get(pathIds[0])!);
      }
      const pts: CampVec[] = [{ ...from }];
      for (const id of pathIds) {
        const n = g.nodes[id];
        const last = pts[pts.length - 1];
        if (Math.hypot(last.x - n.x, last.y - n.y) > 0.6) {
          pts.push({ x: n.x, y: n.y });
        }
      }
      const end = { ...to };
      const last = pts[pts.length - 1];
      if (Math.hypot(last.x - end.x, last.y - end.y) > 0.6) pts.push(end);
      return simplify(pts);
    }

    open.delete(cur);
    const base = gScore.get(cur) ?? Infinity;
    for (const nb of adj[cur]) {
      const step = dist(g.nodes[cur], g.nodes[nb]);
      const tentative = base + step;
      if (tentative < (gScore.get(nb) ?? Infinity)) {
        came.set(nb, cur);
        gScore.set(nb, tentative);
        fScore.set(nb, tentative + dist(g.nodes[nb], g.nodes[goal]));
        open.add(nb);
      }
    }
  }

  return [from, to];
}

function simplify(pts: CampVec[]): CampVec[] {
  if (pts.length <= 2) return pts;
  const out: CampVec[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const cross = Math.abs(abx * bcy - aby * bcx);
    if (cross > 0.35 || Math.hypot(abx, aby) > 4) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** 点是否靠近白线（用于碰撞轻推） */
export function nearestWhitePoint(floor: CampFloor, p: CampVec): CampVec {
  const g = floor === 1 || floor === 2 ? CAMP_ROUTE_GRAPH[floor] : CAMP_ROUTE_GRAPH[1];
  if (!g?.nodes?.length) return p;
  const id = nearestNodeId(floor, p);
  return { x: g.nodes[id].x, y: g.nodes[id].y };
}
