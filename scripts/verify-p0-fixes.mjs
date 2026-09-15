import {
  canEquipWeapon,
  countAvailableWeaponCopies,
  countOwnedWeaponCopies,
  getWeaponInventory,
} from '../src/systems/weaponInventory.ts';
import { getSkillModifiersFromSkillIds } from '../src/core/skillEffects.ts';
import { applyInteractiveHit } from '../src/game/combatInteractives.ts';
import { computeCombatPassLimit } from '../src/game/combatPassBudget.ts';
import { getCharacterShotDamage } from '../src/core/formulas.ts';
import { getWeaponShardPowerGain } from '../src/systems/ShardSystem.ts';

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
}

function testWeaponInventory() {
  const save = {
    ownedWeaponIds: ['w01'],
    ownedCharacters: [
      { characterId: 'ashcrow', weaponId: null },
      { characterId: 'mirror', weaponId: null },
    ],
  };

  assert(countOwnedWeaponCopies(save, 'w01') === 1, 'starter inventory has one w01');
  assert(canEquipWeapon(save, 'ashcrow', 'w01'), 'ashcrow can equip existing w01');

  save.ownedCharacters[0].weaponId = 'w01';
  assert(countAvailableWeaponCopies(save, 'w01') === 0, 'no free copy remains after equipping');

  assert(!canEquipWeapon(save, 'mirror', 'w01'), 'same single-copy weapon cannot equip to second character');

  save.ownedWeaponIds.push('w01');
  assert(countOwnedWeaponCopies(save, 'w01') === 2, 'duplicate drop increases copy count');
  assert(canEquipWeapon(save, 'mirror', 'w01'), 'second character can equip after duplicate drop');

  save.ownedCharacters[1].weaponId = 'w01';
  assert(countAvailableWeaponCopies(save, 'w01') === 0, 'equipping second copy consumes all remaining copies');

  const inventory = getWeaponInventory(save).find((entry) => entry.weaponId === 'w01');
  assert(!!inventory && inventory.total === 2 && inventory.equipped === 2 && inventory.free === 0, 'inventory aggregates copies and equipped count correctly');

  save.ownedCharacters[1].weaponId = null;
  save.ownedWeaponIds.splice(save.ownedWeaponIds.indexOf('w01'), 1);
  assert(countOwnedWeaponCopies(save, 'w01') === 1, 'selling removes only one free copy');
}

function testInteractives() {
  const door = { kind: 'door', attackSpeedBonus: 0.35, active: true };
  const firstDoorHit = applyInteractiveHit(door);
  const secondDoorHit = applyInteractiveHit(door);

  assert(firstDoorHit.attackSpeedBonus === 0.35 && firstDoorHit.consumed, 'door grants bonus once on direct hit');
  assert(secondDoorHit.attackSpeedBonus === 0 && !secondDoorHit.consumed, 'door cannot be claimed twice');

  const barrel = { kind: 'barrel', hitsRemaining: 3, active: true };
  const hit1 = applyInteractiveHit(barrel);
  const hit2 = applyInteractiveHit(barrel);
  const hit3 = applyInteractiveHit(barrel);
  const hit4 = applyInteractiveHit(barrel);

  assert(hit1.attackSpeedBonus === 0 && !hit1.consumed, 'barrel first hit does not trigger reward');
  assert(hit2.attackSpeedBonus === 0 && !hit2.consumed, 'barrel second hit does not trigger reward');
  assert(hit3.attackSpeedBonus === 0.15 && hit3.consumed && !barrel.active, 'barrel reward triggers only on third hit');
  assert(hit4.attackSpeedBonus === 0 && !hit4.consumed, 'destroyed barrel ignores extra hits');
}

function testSkillModifiers() {
  const none = getSkillModifiersFromSkillIds([undefined]);
  assert(!none.tripleShotEnabled, 'triple shot is disabled without pulse');

  const pulse = getSkillModifiersFromSkillIds(['resonance_burst']);
  assert(pulse.tripleShotEnabled && pulse.tripleShotTriggerKills === 3, 'pulse enables gated triple shot');

  const dustblade = getSkillModifiersFromSkillIds(['sand_pierce']);
  assert(dustblade.projectilePierce === 1, 'dustblade grants projectile pierce');

  const ironrain = getSkillModifiersFromSkillIds(['iron_rain']);
  assert(ironrain.ironRainEnabled && ironrain.ironRainDamageMultiplier === 1.2, 'ironrain enables periodic barrage');

  const frostline = getSkillModifiersFromSkillIds(['frost_overload']);
  assert(frostline.attackSpeedBonus === 0.18 && frostline.shieldBonus === 0.1, 'frostline keeps attack speed and damage reduction bonuses');

  const controlSkills = getSkillModifiersFromSkillIds(['frost_overload', 'stellar_judgment', 'outer_pulse']);
  assert(controlSkills.frostControlEnabled && controlSkills.stellarJudgmentEnabled && controlSkills.outerPulseEnabled, 'control, burst, and repair skills are combat-enabled');
}

function testCombatGrowthBalance() {
  const sr = getCharacterShotDamage('ashcrow', null);
  const ur = getCharacterShotDamage('stellar', null);
  assert(ur / sr < 3, 'UR base damage stays below three SR-equivalent damage');
  assert(getWeaponShardPowerGain('L', 5) > getWeaponShardPowerGain('L', 0), 'weapon shard gains increase with enhancement level');
}
function testCombatPassBudget() {
  const base = {
    stageId: 20,
    waves: 5,
    isBoss: false,
    enemyDamage: 3,
    recommendedTcp: 500,
    tcp: 500,
    shieldBonus: 0,
    attackSpeedBonus: 0,
    projectilePierce: 0,
    ironRainEnabled: false,
    squadSize: 2,
    avgShotDamage: 20,
  };
  const highPower = computeCombatPassLimit({ ...base, tcp: 900, avgShotDamage: 70, attackSpeedBonus: 0.4 });
  const normalPower = computeCombatPassLimit(base);
  assert(highPower >= normalPower, 'higher combat power never reduces pass tolerance');
}

testWeaponInventory();
testInteractives();
testSkillModifiers();
testCombatGrowthBalance();
testCombatPassBudget();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}

console.log('\nAll P0 fix tests passed.');
