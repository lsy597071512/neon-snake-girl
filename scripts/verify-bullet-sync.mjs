import { computeBulletRenderZ } from '../src/game/Combat3D.ts';

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
}

const originLogicZ = 7;
const renderStartZ = 23;
const targetZ = -30;

assert(
  computeBulletRenderZ(originLogicZ, renderStartZ, targetZ, originLogicZ) === renderStartZ,
  'bullet visual starts at the shifted player render position',
);

assert(
  computeBulletRenderZ(targetZ, renderStartZ, targetZ, originLogicZ) === targetZ,
  'bullet visual aligns with the enemy position at hit time',
);

const passedTarget = computeBulletRenderZ(-40, renderStartZ, targetZ, originLogicZ);
assert(
  passedTarget < targetZ,
  'bullet visual keeps moving forward after passing the original target',
);

const movedTargetZ = -18;
assert(
  computeBulletRenderZ(movedTargetZ, renderStartZ, movedTargetZ, originLogicZ) === movedTargetZ,
  'bullet visual still aligns when the enemy moves closer before impact',
);

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}

console.log('\nAll bullet sync tests passed.');
