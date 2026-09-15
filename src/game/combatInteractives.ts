export interface DoorInteractiveState {
  kind: 'door';
  attackSpeedBonus: number;
  active: boolean;
}

export interface BarrelInteractiveState {
  kind: 'barrel';
  hitsRemaining: number;
  active: boolean;
}

export type CombatInteractiveState = DoorInteractiveState | BarrelInteractiveState;

export interface CombatInteractiveHitResult {
  attackSpeedBonus: number;
  consumed: boolean;
}

export function applyInteractiveHit(interactive: CombatInteractiveState): CombatInteractiveHitResult {
  if (!interactive.active) {
    return { attackSpeedBonus: 0, consumed: false };
  }

  if (interactive.kind === 'door') {
    interactive.active = false;
    return {
      attackSpeedBonus: interactive.attackSpeedBonus,
      consumed: true,
    };
  }

  interactive.hitsRemaining -= 1;
  if (interactive.hitsRemaining <= 0) {
    interactive.active = false;
    return {
      attackSpeedBonus: 0.15,
      consumed: true,
    };
  }

  return { attackSpeedBonus: 0, consumed: false };
}
