/**
 * 剧情引导逻辑自测：STARTER / 步骤机 / 营地锁 / 开箱保底 / beat 映射
 */
import { STARTER, STAGE_MAP } from '../src/data/stages.ts';
import {
  GUIDE_STEP_ORDER,
  STORY_BEATS,
  resolveStageBeatId,
  shouldPlayStageBeat,
} from '../src/data/storyBeats.ts';
import {
  advanceGuideConfirm,
  applyStoryMigration,
  checkGuideDeploy,
  getGuideStepId,
  getGuideMaxFightStageId,
  grantGuideArmoryPityWeapon,
  isCampLockedByStory,
  markHubFollowSeen,
  syncGuideProgress,
} from '../src/systems/StoryGuideSystem.ts';
import { countOwnedWeaponCopies } from '../src/systems/weaponInventory.ts';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
}

function freshSave() {
  return {
    version: 8,
    gold: 800,
    tickets: 3,
    gachaPity: 0,
    armoryLevel: 1,
    armoryUpgradeEnd: null,
    ownedCharacters: STARTER.characters.map((c) => ({
      characterId: c.characterId,
      weaponId: c.weaponId,
      giftCount: 0,
      shardPowerBonus: 0,
    })),
    ownedWeaponIds: [...STARTER.ownedWeaponIds],
    squad: [...STARTER.squad],
    clearedStages: [],
    achievementsClaimed: [],
    tasksClaimed: [],
    characterShards: {},
    weaponShards: {},
    characterShardUses: {},
    weaponShardUses: {},
    weaponEnhanceBonus: {},
    stats: {
      stagesCleared: 0,
      totalKills: 0,
      charactersOwned: STARTER.characters.length,
      giftsSent: 0,
      legendariesEquipped: 0,
      highestStage: 0,
      playTimeSeconds: 0,
    },
    sweepCharges: 15,
    sweepRecoverAnchorAt: Date.now(),
    tutorialFlags: {
      combatDone: false,
      armoryVideoSeen: false,
      worldIntroSeen: true,
      storyHubFollowSeen: false,
      storyGuideStep: 'g_hello',
      storyGuideDone: false,
      storyGuideArmoryOpened: false,
      storyBeatsSeen: [],
      storyChoiceLog: {},
    },
    settings: {
      useLivePortrait: true,
      hubFeaturedCharId: null,
      hubMidUiVisible: true,
      debugInfiniteGold: false,
      disciplineEnabled: true,
    },
  };
}

function testStarter() {
  assert(STARTER.squad.length === 0, 'STARTER squad empty');
  assert(STARTER.characters.find((c) => c.characterId === 'heartforge')?.weaponId === null, 'heartforge weapon null');
  assert(STARTER.ownedWeaponIds.length === 1 && STARTER.ownedWeaponIds[0] === 'w01', 'only w01 owned');
  const d = freshSave();
  assert(d.squad.length === 0, 'default save empty squad');
  assert(d.tutorialFlags.storyGuideDone === false, 'guide not done on new save');
  assert(isCampLockedByStory(d), 'camp locked on new save');
}

function testGuideFlow() {
  const d = freshSave();
  markHubFollowSeen(d);
  assert(getGuideStepId(d) === 'g_hello', 'starts at g_hello');

  advanceGuideConfirm(d);
  assert(getGuideStepId(d) === 'g_identity', 'after hello → identity');
  advanceGuideConfirm(d);
  assert(getGuideStepId(d) === 'g_squad', 'after identity → squad');

  d.squad = ['ashcrow'];
  syncGuideProgress(d);
  assert(getGuideStepId(d) === 'g_squad_ok', 'squad filled → squad_ok');

  const r = advanceGuideConfirm(d);
  assert(r.gotoMap === true, 'squad_ok confirm opens map');
  assert(getGuideStepId(d) === 'g_stage1', 'waiting stage1');

  d.clearedStages = [1];
  syncGuideProgress(d);
  assert(getGuideStepId(d) === 'g_task', 'cleared 1 → task');

  d.tasksClaimed = ['t1_stage'];
  syncGuideProgress(d);
  assert(getGuideStepId(d) === 'g_shop', 'claimed task → shop');

  const before = countOwnedWeaponCopies(d, 'w02');
  const pity = grantGuideArmoryPityWeapon(d);
  assert(!!pity && pity.id === 'w02', 'pity grants w02');
  assert(countOwnedWeaponCopies(d, 'w02') === before + 1, 'w02 copy added');
  syncGuideProgress(d);
  assert(getGuideStepId(d) === 'g_equip', 'shop done → equip');

  const hf = d.ownedCharacters.find((c) => c.characterId === 'heartforge');
  hf.weaponId = 'w02';
  syncGuideProgress(d);
  assert(getGuideStepId(d) === 'g_squad2', 'equipped → squad2');

  d.squad = ['ashcrow', 'heartforge'];
  syncGuideProgress(d);
  assert(getGuideStepId(d) === 'g_stage2', 'both in squad → stage2');

  d.clearedStages = [1, 2];
  syncGuideProgress(d);
  assert(getGuideStepId(d) === 'g_stage3', 'cleared 2 → stage3');

  d.clearedStages = [1, 2, 3];
  syncGuideProgress(d);
  assert(getGuideStepId(d) === 'g_camp', 'cleared 3 → camp');
  assert(isCampLockedByStory(d), 'camp still locked until confirm');

  const done = advanceGuideConfirm(d);
  assert(done.done === true, 'camp confirm finishes guide');
  assert(d.tutorialFlags.storyGuideDone === true, 'storyGuideDone true');
  assert(!isCampLockedByStory(d), 'camp unlocked');
}

function testOldSaveSkip() {
  const d = freshSave();
  d.clearedStages = [1, 2, 5];
  applyStoryMigration(d, true);
  assert(d.tutorialFlags.storyGuideDone === true, 'old progress skips guide');
  assert(d.tutorialFlags.storyHubFollowSeen === true, 'old progress skips hub follow');
  assert(!isCampLockedByStory(d), 'old save camp open');
}

function testGuideMaxStage() {
  const d = freshSave();
  markHubFollowSeen(d);
  assert(getGuideMaxFightStageId(d) === 1, 'early guide max stage 1');
  advanceGuideConfirm(d); // hello → identity
  advanceGuideConfirm(d); // identity → squad
  d.squad = ['ashcrow'];
  syncGuideProgress(d);
  advanceGuideConfirm(d); // squad_ok → stage1
  assert(getGuideStepId(d) === 'g_stage1', 'on stage1 step');
  assert(getGuideMaxFightStageId(d) === 1, 'stage1 step max 1');
  d.clearedStages = [1];
  d.tasksClaimed = ['t1_stage'];
  d.tutorialFlags.storyGuideArmoryOpened = true;
  const hf = d.ownedCharacters.find((c) => c.characterId === 'heartforge');
  hf.weaponId = 'w02';
  d.ownedWeaponIds.push('w02');
  d.squad = ['ashcrow', 'heartforge'];
  syncGuideProgress(d);
  assert(getGuideStepId(d) === 'g_stage2', 'jumped to stage2 step');
  assert(getGuideMaxFightStageId(d) === 2, 'stage2 step max 2');
  d.clearedStages = [1, 2, 3];
  syncGuideProgress(d);
  assert(getGuideStepId(d) === 'g_camp', 'cleared 3 → camp step');
  assert(getGuideMaxFightStageId(d) === 3, 'camp step max 3');
  d.tutorialFlags.storyGuideDone = true;
  assert(getGuideMaxFightStageId(d) === null, 'done → no cap');
}

function testBeats() {
  assert(!!STORY_BEATS['hub_follow'], 'hub_follow exists');
  assert(!!STORY_BEATS['s1-1'] && !!STORY_BEATS['s5-12'], 'stage beats present');
  const s11 = STAGE_MAP[1];
  assert(shouldPlayStageBeat(s11) && resolveStageBeatId(s11) === 's1-1', '1-1 maps to s1-1');
  const s14 = STAGE_MAP[4];
  assert(!shouldPlayStageBeat(s14), '1-4 has no story beat');
  const s17 = STAGE_MAP[7];
  assert(shouldPlayStageBeat(s17) && resolveStageBeatId(s17) === 's1-7', '1-7 maps');
  assert(GUIDE_STEP_ORDER.length === 12, '12 guide steps');
}

function testGuideDeploy() {
  const d = freshSave();
  markHubFollowSeen(d);
  const bad = checkGuideDeploy(d, 1, ['heartforge']);
  assert(!bad.ok, 'stage1 rejects non-mio');
  const ok = checkGuideDeploy(d, 1, ['ashcrow']);
  assert(ok.ok, 'stage1 accepts mio');
  const bad2 = checkGuideDeploy(d, 2, ['heartforge', 'ashcrow']);
  assert(!bad2.ok, 'stage2 rejects wrong order');
  const ok2 = checkGuideDeploy(d, 2, ['ashcrow', 'heartforge']);
  assert(ok2.ok, 'stage2 accepts mio+serena');
}

testStarter();
testGuideFlow();
testOldSaveSkip();
testGuideMaxStage();
testBeats();
testGuideDeploy();

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nAll story guide checks passed');
