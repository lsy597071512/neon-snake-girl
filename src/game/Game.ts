import { Combat3D, startCombat3D, type CombatSceneData } from './Combat3D';

/** 实验性 3D 战斗 — 改为 false 可回退 Phaser 2D（见 CombatScene.ts） */
export const USE_3D_COMBAT = true;

let activeCombat: Combat3D | null = null;

export function startCombat(parent: HTMLElement, data: CombatSceneData): void {
  activeCombat?.dispose();
  activeCombat = startCombat3D(parent, data);
}

export function disposeCombat(): void {
  activeCombat?.dispose();
  activeCombat = null;
}

export type { CombatSceneData };
