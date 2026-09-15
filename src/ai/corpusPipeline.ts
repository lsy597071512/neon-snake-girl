/**
 * Phase4 · 美术 → 场景/角色卡流水线
 * 新图入库时按此模板补 JSON，供 Prompt 使用（文本 LLM「看见」世界）。
 */

import type { SceneCard } from './types';

export type SceneCardDraft = Partial<SceneCard> & {
  id: string;
  image: string;
  label: string;
};

export type CharacterCardDraft = {
  characterId: string;
  imageRefs: string[];
  visualNotes: string;
  wardrobeTags: string[];
  suggestedSensory: string[];
};

/** 校验场景卡是否可被 Prompt 使用 */
export function validateSceneCard(card: SceneCardDraft): string[] {
  const errors: string[] = [];
  if (!card.id) errors.push('缺少 id');
  if (!card.image) errors.push('缺少 image');
  if (!card.label) errors.push('缺少 label');
  if (!card.atmosphere) errors.push('缺少 atmosphere（给 AI 的氛围描述）');
  if (!card.sensory?.length) errors.push('缺少 sensory');
  if (!card.dialogueHints?.length) errors.push('缺少 dialogueHints');
  return errors;
}

/** 从文件名拼音猜测场景草稿（人工再补全） */
export function draftSceneFromFilename(filename: string): SceneCardDraft {
  const base = filename.replace(/\.[^.]+$/, '');
  const indoor = /shinei|indoor|woshi|dating|yushi/i.test(base);
  return {
    id: base.replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
    label: base,
    kind: indoor ? 'indoor' : 'camp',
    image: indoor ? `./tex/Indoor/${filename}` : `./tex/${filename}`,
    period: 'any',
    weather: indoor ? 'indoor' : 'clear',
    locationName: indoor ? '室内' : '营地外景',
    atmosphere: '（待补：根据画面写 1–2 句氛围）',
    sensory: ['（待补）'],
    dialogueHints: ['（待补）'],
    interactables: ['（待补）'],
  };
}

export function draftCharacterCard(
  characterId: string,
  imageRefs: string[],
  notes: string,
): CharacterCardDraft {
  return {
    characterId,
    imageRefs,
    visualNotes: notes,
    wardrobeTags: [],
    suggestedSensory: [],
  };
}

import { CAMP_INDOOR_SCENE_ORDER } from '../data/campLayout';

/** 室内漫游顺序（营地生活面板 / 家园营地） */
export const INDOOR_ROAM_ORDER = CAMP_INDOOR_SCENE_ORDER;

export function nextIndoorId(current: string, dir: 1 | -1): string {
  const list = [...INDOOR_ROAM_ORDER];
  const idx = list.indexOf(current);
  if (idx < 0) return list[0];
  return list[(idx + dir + list.length) % list.length];
}
