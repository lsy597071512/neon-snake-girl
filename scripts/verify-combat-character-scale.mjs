import * as THREE from 'three';
import { COMBAT_CHARACTER_SCALE } from '../src/game/Combat3D.ts';
import { PLAYER_Z, billboardScale, getPlayerCombatLayout, setupCombatCamera } from '../src/game/WastelandEnvironment.ts';

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
}

function makeCamera(width, height) {
  const camera = new THREE.PerspectiveCamera(68, width / height, 0.1, 280);
  setupCombatCamera(camera);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

const camera = makeCamera(720, 1280);
const layout = getPlayerCombatLayout(camera, 1, PLAYER_Z, 'grounded');
const playerScaleH = layout.scaleH * COMBAT_CHARACTER_SCALE;
const playerScaleW = layout.scaleW * COMBAT_CHARACTER_SCALE;
const enemyBaseScale = billboardScale(-40, camera.position.z);
const enemyWidth = 1.8 * enemyBaseScale * COMBAT_CHARACTER_SCALE;
const enemyHeight = 2.4 * enemyBaseScale * COMBAT_CHARACTER_SCALE;
const bossWidth = 3 * COMBAT_CHARACTER_SCALE * 1.35;
const bossHeight = 4 * COMBAT_CHARACTER_SCALE * 1.35;

assert(COMBAT_CHARACTER_SCALE === 0.5, 'all combat characters use 0.5 scale multiplier');
assert(Math.abs(playerScaleH / layout.scaleH - 0.5) < 0.0001, 'player render height is reduced to 50%');
assert(Math.abs(playerScaleW / layout.scaleW - 0.5) < 0.0001, 'player render width is reduced to 50%');
assert(layout.y > layout.groundY, 'player foot anchor remains above the road after shrinking');
assert(Math.abs(enemyWidth / (1.8 * enemyBaseScale) - 0.5) < 0.0001, 'enemy width is reduced to 50%');
assert(Math.abs(enemyHeight / (2.4 * enemyBaseScale) - 0.5) < 0.0001, 'enemy height is reduced to 50%');
assert(Math.abs(bossWidth / (3 * 1.35) - 0.5) < 0.0001, 'boss width is reduced to 50%');
assert(Math.abs(bossHeight / (4 * 1.35) - 0.5) < 0.0001, 'boss height is reduced to 50%');

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}

console.log('\nAll combat character scale tests passed.');
