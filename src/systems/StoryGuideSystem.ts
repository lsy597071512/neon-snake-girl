/**
 * 剧情引导状态机（纯逻辑）：步骤推进、营地锁、关卡 beat 播控、开箱保底。
 */
import type { SaveData, StageDef } from '../types';
import { WEAPONS } from '../data/weapons';
import {
  GUIDE_STEP_ORDER,
  GUIDE_STEPS,
  STORY_BEATS,
  resolveStageBeatId,
  shouldPlayStageBeat,
  type GuideStepDef,
  type GuideStepId,
  type StoryBeatDef,
} from '../data/storyBeats';
import { isTaskClaimed } from './TaskSystem';
import { countAvailableWeaponCopies, countOwnedWeaponCopies } from './weaponInventory';
import { addWeapon } from './ArmorySystem';

export function isStoryGuideDone(save: SaveData): boolean {
  return Boolean(save.tutorialFlags.storyGuideDone);
}

/**
 * 教学最后一关（第 3 关）。引导期间玩家必然会打到这里，
 * 所以「进度是否超过教学」是判断老存档、决定要不要跳过引导的唯一依据。
 */
export const TUTORIAL_LAST_STAGE_ID = 3;

export function isCampLockedByStory(save: SaveData): boolean {
  return !isStoryGuideDone(save);
}

export function getGuideStepId(save: SaveData): GuideStepId | null {
  if (isStoryGuideDone(save)) return null;
  const raw = save.tutorialFlags.storyGuideStep;
  if (raw && GUIDE_STEPS[raw as GuideStepId]) return raw as GuideStepId;
  return 'g_hello';
}

export function getGuideStep(save: SaveData): GuideStepDef | null {
  const id = getGuideStepId(save);
  return id ? GUIDE_STEPS[id] : null;
}

/**
 * 引导期允许挑战的最高关卡 id（普通）。
 * 超出则提示先跟老板娘走完当前步，避免跳关软锁任务/开箱顺序。
 */
export function getGuideMaxFightStageId(save: SaveData): number | null {
  if (isStoryGuideDone(save)) return null;
  if (!save.tutorialFlags.storyHubFollowSeen) return 1;
  const id = getGuideStepId(save);
  if (id === 'g_stage2') return 2;
  if (id === 'g_stage3' || id === 'g_camp') return 3;
  return 1;
}

/**
 * 引导期出战硬性名单（按出战槽顺序）。
 * 第 1 关必须澪打头；第 2～3 关必须澪+芹奈。
 */
export function getGuideRequiredDeploy(save: SaveData, stageId: number): string[] | null {
  if (isStoryGuideDone(save)) return null;
  if (!save.tutorialFlags.storyHubFollowSeen) return null;
  if (stageId === 1) return ['ashcrow'];
  if (stageId === 2 || stageId === 3) return ['ashcrow', 'heartforge'];
  return null;
}

/** 校验引导必带角色是否在出战前排 */
export function checkGuideDeploy(
  save: SaveData,
  stageId: number,
  deployIds: string[],
): { ok: true } | { ok: false; message: string } {
  const need = getGuideRequiredDeploy(save, stageId);
  if (!need?.length) return { ok: true };
  for (let i = 0; i < need.length; i++) {
    if (deployIds[i] !== need[i]) {
      if (stageId === 1) {
        return {
          ok: false,
          message: '教学第 1 关必须让「苍羽·澪」站在出战槽 1。请打开「编队」：点澪 → 再点出战槽 1。',
        };
      }
      return {
        ok: false,
        message:
          '教学关需要「苍羽·澪」在出战槽 1、「白楯·芹奈」在出战槽 2。请回「编队」按顺序放好再出战。',
      };
    }
  }
  return { ok: true };
}

function hasCleared(save: SaveData, stageId: number): boolean {
  return save.clearedStages.includes(stageId);
}

function heartforgeArmed(save: SaveData): boolean {
  const oc = save.ownedCharacters.find((c) => c.characterId === 'heartforge');
  return Boolean(oc?.weaponId);
}

function hasFreeWeaponForHeartforge(save: SaveData): boolean {
  if (heartforgeArmed(save)) return true;
  for (const w of WEAPONS) {
    if (countAvailableWeaponCopies(save, w.id) > 0) return true;
  }
  return false;
}

/**
 * 背包里是否还有能装给指定角色的武器副本（排除他人在用的）。
 * g_equip 的防卡死依据：连一把都装不上时本步无法完成，必须放行而不是让玩家干等。
 */
function hasFreeWeaponFor(save: SaveData, characterId: string): boolean {
  for (const w of WEAPONS) {
    if (countAvailableWeaponCopies(save, w.id, characterId) > 0) return true;
  }
  return false;
}

/** 某步完成条件（幂等） */
export function isGuideStepConditionMet(save: SaveData, stepId: GuideStepId): boolean {
  switch (stepId) {
    case 'g_hello':
    case 'g_identity':
    case 'g_squad_ok':
    case 'g_camp':
      return false; // confirm-only；由 advanceGuideConfirm 推进
    case 'g_squad':
      return save.squad[0] === 'ashcrow';
    case 'g_stage1':
      return hasCleared(save, 1);
    case 'g_task':
      return isTaskClaimed(save, 't1_stage');
    case 'g_shop':
      return Boolean(save.tutorialFlags.storyGuideArmoryOpened) || hasFreeWeaponForHeartforge(save);
    case 'g_equip':
      // 防卡死：背包里一把能装给芹奈的都没有时，本步永远无法完成，
      // 直接判定通过让引导继续，绝不能让玩家对着空菜单死等。
      return heartforgeArmed(save) || !hasFreeWeaponFor(save, 'heartforge');
    case 'g_squad2':
      return save.squad[0] === 'ashcrow' && save.squad[1] === 'heartforge';
    case 'g_stage2':
      return hasCleared(save, 2);
    case 'g_stage3':
      return hasCleared(save, 3);
    default:
      return false;
  }
}

function nextStepId(id: GuideStepId): GuideStepId | 'done' {
  const i = GUIDE_STEP_ORDER.indexOf(id);
  if (i < 0 || i >= GUIDE_STEP_ORDER.length - 1) return 'done';
  return GUIDE_STEP_ORDER[i + 1]!;
}

/** 自动跳过已满足的 condition 步；confirm 步停住 */
export function syncGuideProgress(save: SaveData): void {
  if (isStoryGuideDone(save)) return;
  if (!save.tutorialFlags.storyHubFollowSeen) return;

  let guard = 0;
  while (guard++ < 20) {
    const id = getGuideStepId(save);
    if (!id) return;
    const step = GUIDE_STEPS[id];
    if (step.mode === 'confirm') return;
    if (!isGuideStepConditionMet(save, id)) return;
    const n = nextStepId(id);
    if (n === 'done') {
      save.tutorialFlags.storyGuideDone = true;
      save.tutorialFlags.storyGuideStep = 'g_camp';
      return;
    }
    save.tutorialFlags.storyGuideStep = n;
  }
}

export function advanceGuideConfirm(save: SaveData): { ok: boolean; gotoMap?: boolean; gotoSquad?: boolean; done?: boolean } {
  syncGuideProgress(save);
  const id = getGuideStepId(save);
  if (!id) return { ok: false };
  const step = GUIDE_STEPS[id];
  if (step.mode !== 'confirm') return { ok: false };

  if (id === 'g_camp') {
    save.tutorialFlags.storyGuideDone = true;
    return { ok: true, done: true };
  }

  const n = nextStepId(id);
  if (n === 'done') {
    save.tutorialFlags.storyGuideDone = true;
    return { ok: true, done: true };
  }
  save.tutorialFlags.storyGuideStep = n;
  syncGuideProgress(save);
  return { ok: true, gotoMap: id === 'g_squad_ok', gotoSquad: id === 'g_roster' };
}

export function markHubFollowSeen(save: SaveData): void {
  save.tutorialFlags.storyHubFollowSeen = true;
  if (!save.tutorialFlags.storyGuideStep) {
    save.tutorialFlags.storyGuideStep = 'g_hello';
  }
  syncGuideProgress(save);
}

export function markStoryBeatSeen(save: SaveData, beatId: string): void {
  const list = save.tutorialFlags.storyBeatsSeen ?? [];
  if (!list.includes(beatId)) list.push(beatId);
  save.tutorialFlags.storyBeatsSeen = list;
}

export function hasSeenStoryBeat(save: SaveData, beatId: string): boolean {
  return (save.tutorialFlags.storyBeatsSeen ?? []).includes(beatId);
}

export function recordStoryChoice(save: SaveData, beatId: string, choice: 'A' | 'B' | 'C'): void {
  if (!save.tutorialFlags.storyChoiceLog) save.tutorialFlags.storyChoiceLog = {};
  save.tutorialFlags.storyChoiceLog[beatId] = choice;
}

export function getStageStoryBeat(save: SaveData, stage: StageDef): StoryBeatDef | null {
  if (!shouldPlayStageBeat(stage)) return null;
  const beatId = resolveStageBeatId(stage);
  if (!beatId) return null;
  if (hasSeenStoryBeat(save, beatId)) return null;
  return STORY_BEATS[beatId] ?? null;
}

/** 引导首开：保证发放一把尚未拥有的武器（写入背包，不自动抢澪的装备逻辑由调用方处理） */
export function grantGuideArmoryPityWeapon(save: SaveData): { id: string; name: string } | null {
  const prefer = ['w02', 'w03', 'w04', 'w05'];
  for (const id of prefer) {
    if (countOwnedWeaponCopies(save, id) <= 0) {
      const def = WEAPONS.find((w) => w.id === id);
      if (!def) continue;
      addWeapon(save, def);
      save.tutorialFlags.storyGuideArmoryOpened = true;
      return { id: def.id, name: def.name };
    }
  }
  for (const def of WEAPONS) {
    if (countOwnedWeaponCopies(save, def.id) <= 0) {
      addWeapon(save, def);
      save.tutorialFlags.storyGuideArmoryOpened = true;
      return { id: def.id, name: def.name };
    }
  }
  // 全拥有时仍标记开过，避免卡死
  save.tutorialFlags.storyGuideArmoryOpened = true;
  return null;
}

export function markGuideArmoryOpened(save: SaveData): void {
  save.tutorialFlags.storyGuideArmoryOpened = true;
}

/**
 * 旧档迁移：`rawHadProgressBeyondTutorial` 表示存档进度已超出教学三关，
 * 说明是回归玩家而非「卡在教学中途」，此时才跳过整段引导。
 * 传 true 之前务必确认进度确实越过了 TUTORIAL_LAST_STAGE_ID，
 * 否则玩家中途退出重进会导致新手引导被整段抹掉。
 */
export function applyStoryMigration(save: SaveData, rawHadProgressBeyondTutorial: boolean): void {
  const tf = save.tutorialFlags;
  if (tf.storyGuideDone == null) tf.storyGuideDone = false;
  if (tf.storyHubFollowSeen == null) tf.storyHubFollowSeen = false;
  if (tf.storyGuideArmoryOpened == null) tf.storyGuideArmoryOpened = false;
  if (tf.sweepGuideSeen == null) tf.sweepGuideSeen = false;
  if (tf.hellGuideSeen == null) tf.hellGuideSeen = false;
  if (tf.weaponGuideSeen == null) tf.weaponGuideSeen = false;
  if (tf.charGuideSeen == null) tf.charGuideSeen = false;
  if (!Array.isArray(tf.storyBeatsSeen)) tf.storyBeatsSeen = [];
  if (!tf.storyChoiceLog) tf.storyChoiceLog = {};

  if (rawHadProgressBeyondTutorial && !tf.storyGuideDone) {
    tf.storyHubFollowSeen = true;
    tf.storyGuideDone = true;
    tf.storyGuideStep = 'g_camp';
  } else if (!tf.storyGuideStep) {
    tf.storyGuideStep = 'g_hello';
  }

  syncGuideProgress(save);
}

export function getHubFollowBeat(): StoryBeatDef {
  return STORY_BEATS.hub_follow!;
}

/** 营地初见引导 beat（首次进入营地时播放一次） */
export function getCampIntroBeat(): StoryBeatDef {
  return STORY_BEATS.camp_intro!;
}
