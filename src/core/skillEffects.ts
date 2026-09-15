export type CharacterSkillId =
  | 'frost_overload'
  | 'resonance_burst'
  | 'sand_pierce'
  | 'iron_rain'
  | 'stellar_judgment'
  | 'shard_shell'
  | 'outer_pulse';

export interface SkillEffectModifiers {
  attackSpeedBonus: number;
  bossCritBonus: number;
  shieldBonus: number;
  tripleShotEnabled: boolean;
  tripleShotTriggerKills: number;
  tripleShotCooldown: number;
  projectilePierce: number;
  ironRainEnabled: boolean;
  ironRainInterval: number;
  ironRainDamageMultiplier: number;
  frostControlEnabled: boolean;
  stellarJudgmentEnabled: boolean;
  outerPulseEnabled: boolean;
}

export function isCharacterSkillId(value: string | undefined): value is CharacterSkillId {
  return (
    value === 'frost_overload' ||
    value === 'resonance_burst' ||
    value === 'sand_pierce' ||
    value === 'iron_rain' ||
    value === 'stellar_judgment' ||
    value === 'shard_shell' ||
    value === 'outer_pulse'
  );
}

export function getSkillModifiersFromSkillIds(skillIds: Array<CharacterSkillId | undefined>): SkillEffectModifiers {
  let attackSpeedBonus = 0;
  let bossCritBonus = 0;
  let shieldBonus = 0;
  let tripleShotEnabled = false;
  let projectilePierce = 0;
  let ironRainEnabled = false;
  let frostControlEnabled = false;
  let stellarJudgmentEnabled = false;
  let outerPulseEnabled = false;

  for (const skillId of skillIds) {
    switch (skillId) {
      case 'frost_overload':
        attackSpeedBonus += 0.18;
        shieldBonus += 0.1;
        frostControlEnabled = true;
        break;
      case 'resonance_burst':
        tripleShotEnabled = true;
        break;
      case 'sand_pierce':
        projectilePierce += 1;
        break;
      case 'iron_rain':
        ironRainEnabled = true;
        break;
      case 'stellar_judgment':
        attackSpeedBonus += 0.25;
        bossCritBonus += 0.15;
        stellarJudgmentEnabled = true;
        break;
      case 'shard_shell':
        attackSpeedBonus += 0.1;
        shieldBonus += 0.12;
        break;
      case 'outer_pulse':
        attackSpeedBonus += 0.2;
        shieldBonus += 0.08;
        bossCritBonus += 0.1;
        outerPulseEnabled = true;
        break;
    }
  }

  return {
    attackSpeedBonus,
    bossCritBonus,
    shieldBonus,
    tripleShotEnabled,
    tripleShotTriggerKills: 3,
    tripleShotCooldown: 8000,
    projectilePierce,
    ironRainEnabled,
    ironRainInterval: 10000,
    ironRainDamageMultiplier: 1.2,
    frostControlEnabled,
    stellarJudgmentEnabled,
    outerPulseEnabled,
  };
}
