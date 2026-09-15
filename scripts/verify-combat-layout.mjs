import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {
  COMBAT_PLAYER,
  PLAYER_Z,
  getPlayerCombatLayout,
  setupCombatCamera,
} from '../src/game/WastelandEnvironment.ts';

const outDir = path.join(process.cwd(), 'artifacts');
fs.mkdirSync(outDir, { recursive: true });

let failed = 0;
const report = [];

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
}

function makeCamera(width, height, bobOffset = 0) {
  const camera = new THREE.PerspectiveCamera(68, width / height, 0.1, 280);
  setupCombatCamera(camera);
  camera.position.y += bobOffset;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

const viewportSamples = [
  { name: 'mobile-portrait', width: 720, height: 1280 },
  { name: 'mobile-tall', width: 1080, height: 1920 },
  { name: 'desktop-landscape', width: 1600, height: 900 },
];

const bobOffsets = [-0.03, 0, 0.03];
const angleSamples = [
  { name: 'default', posX: 0, posY: 0, lookAtX: 0, lookAtY: 0.2 },
  { name: 'left-peek', posX: -1.2, posY: 0, lookAtX: -0.6, lookAtY: 0.2 },
  { name: 'right-peek', posX: 1.2, posY: 0, lookAtX: 0.6, lookAtY: 0.2 },
  { name: 'high-pitch', posX: 0, posY: 0.4, lookAtX: 0, lookAtY: 0.5 },
];
const stageSamples = [
  { name: 'normal', stageId: 1 },
  { name: 'door', stageId: 3 },
  { name: 'barrel', stageId: 6 },
  { name: 'boss', stageId: 8 },
];

for (const viewport of viewportSamples) {
  for (const bob of bobOffsets) {
    for (const angle of angleSamples) {
      for (const lane of [0, 1, 2]) {
        const camera = makeCamera(viewport.width, viewport.height, bob);
        camera.position.x += angle.posX;
        camera.position.y += angle.posY;
        camera.lookAt(angle.lookAtX, angle.lookAtY, -75);
        camera.updateMatrixWorld(true);

        const legacy = getPlayerCombatLayout(camera, lane, PLAYER_Z, 'legacy');
        const grounded = getPlayerCombatLayout(camera, lane, PLAYER_Z, 'grounded');

        const entry = {
          viewport: viewport.name,
          bobOffset: bob,
          cameraAngle: angle.name,
          lane,
          legacyY: Number(legacy.y.toFixed(3)),
          groundedY: Number(grounded.y.toFixed(3)),
          anchorScaleH: Number(grounded.anchorScaleH.toFixed(3)),
          groundedScaleH: Number(grounded.scaleH.toFixed(3)),
          logicZ: Number(grounded.logicZ.toFixed(3)),
          renderZ: Number(grounded.renderZ.toFixed(3)),
          logicCameraDistance: Number(grounded.logicCameraDistance.toFixed(3)),
          renderCameraDistance: Number(grounded.renderCameraDistance.toFixed(3)),
          groundY: Number(grounded.groundY.toFixed(3)),
          translateY: Number(grounded.translateY.toFixed(3)),
          groundClearance: Number(grounded.groundClearance.toFixed(3)),
        };
        report.push(entry);

        assert(
          Math.abs(grounded.y - (grounded.groundY + grounded.groundClearance)) < 0.0001,
          `${viewport.name}/${angle.name}/lane${lane}/bob${bob}: player Y remains anchored to the validated ground contact`,
        );
        assert(
          grounded.renderCameraDistance < grounded.logicCameraDistance,
          `${viewport.name}/${angle.name}/lane${lane}/bob${bob}: rendered player is closer to camera than logic plane`,
        );
        assert(
          Math.abs(grounded.scaleH - grounded.anchorScaleH) < 0.0001,
          `${viewport.name}/${angle.name}/lane${lane}/bob${bob}: rendered player keeps the original world size baseline`,
        );
        assert(
          grounded.groundClearance >= COMBAT_PLAYER.minGroundClearance &&
            grounded.groundClearance <= COMBAT_PLAYER.maxGroundClearance,
          `${viewport.name}/${angle.name}/lane${lane}/bob${bob}: ground clearance stays within safe range`,
        );
        assert(
          grounded.y > grounded.groundY,
          `${viewport.name}/${angle.name}/lane${lane}/bob${bob}: player feet stay above road surface`,
        );
        assert(
          grounded.logicZ === PLAYER_Z,
          `${viewport.name}/${angle.name}/lane${lane}/bob${bob}: combat logic still uses original player Z plane`,
        );
      }
    }
  }
}

for (const stage of stageSamples) {
  console.log(`SCENE: ${stage.name} stage ${stage.stageId} uses the same grounded player layout pipeline.`);
}

const reportPath = path.join(outDir, 'combat-layout-validation.json');
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      combatPlayer: COMBAT_PLAYER,
      samples: report,
      stageSamples,
    },
    null,
    2,
  ),
);

console.log(`Report written to: ${reportPath}`);

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}

console.log('\nAll combat layout validation tests passed.');
