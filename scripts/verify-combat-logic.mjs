/** 波次逻辑单元测试 — node scripts/verify-combat-logic.mjs */

function shouldEndVictory(alive, pendingSpawns, wave, maxWaves, everSpawned) {
  return alive === 0 && pendingSpawns <= 0 && wave >= maxWaves && everSpawned;
}

function nextWaveAfterClear(alive, pendingSpawns, wave, maxWaves) {
  if (alive !== 0 || pendingSpawns > 0) return null;
  if (wave < maxWaves) return wave + 1;
  return null;
}

function estimateStageEnemyCount(stageId, waves, isBoss) {
  let total = 0;
  for (let w = 1; w <= waves; w++) {
    total += 4 + w + Math.floor(stageId / 10);
  }
  if (isBoss) total += 1;
  return total;
}

function computeCombatPassLimit(input) {
  const enemies = estimateStageEnemyCount(input.stageId, input.waves, input.isBoss);
  const stageT = Math.min(1, Math.max(0, (input.stageId - 1) / 40));
  let leakRatio = 0.32 - stageT * 0.18;
  leakRatio *= 1 / (1 + input.enemyDamage * 0.01);
  const tcpRatio = Math.max(0.75, Math.min(1.35, input.tcp / Math.max(1, input.recommendedTcp)));
  const shieldMul = 1 + Math.min(0.35, input.shieldBonus) * 0.55;
  const offense =
    1 +
    input.attackSpeedBonus * 0.35 +
    input.projectilePierce * 0.08 +
    (input.ironRainEnabled ? 0.12 : 0) +
    Math.min(1.2, input.avgShotDamage / 40) * 0.15;
  const offenseMul = 1 / Math.max(0.85, Math.min(1.22, offense));
  const squadMul = 1 + Math.max(0, input.squadSize - 1) * 0.05;
  let limit = enemies * leakRatio * tcpRatio * shieldMul * offenseMul * squadMul;
  if (input.isBoss) limit *= 0.88;
  const floor = input.stageId <= 3 ? 5 : input.stageId <= 8 ? 4 : 3;
  return Math.max(floor, Math.min(22, Math.round(limit)));
}

function shouldFailByPass(passCount, passLimit) {
  return passCount > passLimit;
}

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
}

assert(!shouldEndVictory(0, 5, 1, 3, false), 'frame0: pending spawns blocks victory');
assert(!shouldEndVictory(0, 0, 1, 3, false), 'frame0: no spawn yet blocks victory');
assert(nextWaveAfterClear(0, 0, 1, 3) === 2, 'wave1 clear advances to wave2');
assert(!shouldEndVictory(0, 0, 1, 3, true), 'wave1 clear is not final victory');
assert(nextWaveAfterClear(0, 0, 2, 3) === 3, 'wave2 clear advances to wave3');
assert(shouldEndVictory(0, 0, 3, 3, true), 'wave3 clear triggers victory');
assert(nextWaveAfterClear(0, 4, 1, 3) === null, 'pending spawns block wave advance');

let wave = 1;
const maxWaves = 3;
let pending = 6;
let alive = 0;
let everSpawned = false;
if (nextWaveAfterClear(alive, pending, wave, maxWaves) !== null) wave++;
assert(wave === 1 && !shouldEndVictory(alive, pending, wave, maxWaves, everSpawned), 'first frame cascade blocked');

assert(!shouldFailByPass(5, 5), 'at limit is still alive');
assert(shouldFailByPass(6, 5), 'over limit fails');

const early = computeCombatPassLimit({
  stageId: 1,
  waves: 3,
  isBoss: false,
  enemyDamage: 5,
  recommendedTcp: 140,
  tcp: 140,
  shieldBonus: 0,
  attackSpeedBonus: 0,
  projectilePierce: 0,
  ironRainEnabled: false,
  squadSize: 1,
  avgShotDamage: 12,
});
assert(early >= 5 && early <= 12, `early stage pass limit in range (got ${early})`);

const late = computeCombatPassLimit({
  stageId: 40,
  waves: 8,
  isBoss: true,
  enemyDamage: 31,
  recommendedTcp: 2000,
  tcp: 2000,
  shieldBonus: 0.2,
  attackSpeedBonus: 0.3,
  projectilePierce: 1,
  ironRainEnabled: true,
  squadSize: 3,
  avgShotDamage: 45,
});
assert(late >= 3 && late <= 22, `late boss pass limit in range (got ${late})`);

const tanky = computeCombatPassLimit({
  stageId: 10,
  waves: 4,
  isBoss: false,
  enemyDamage: 11,
  recommendedTcp: 500,
  tcp: 700,
  shieldBonus: 0.3,
  attackSpeedBonus: 0,
  projectilePierce: 0,
  ironRainEnabled: false,
  squadSize: 2,
  avgShotDamage: 15,
});
const glass = computeCombatPassLimit({
  stageId: 10,
  waves: 4,
  isBoss: false,
  enemyDamage: 11,
  recommendedTcp: 500,
  tcp: 500,
  shieldBonus: 0,
  attackSpeedBonus: 0.4,
  projectilePierce: 1,
  ironRainEnabled: true,
  squadSize: 2,
  avgShotDamage: 40,
});
assert(tanky >= glass, `shield/TCP limit >= glass cannon (tanky=${tanky}, glass=${glass})`);

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll combat wave logic tests passed.');
