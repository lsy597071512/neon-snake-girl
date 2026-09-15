/** 角色详细背景与 AI 对话用结构化档案 */

/** 图鉴「详细背景」展示用档案（与 sr-bios / ssr-ur-bios 对齐） */
export type CharacterBioLore = {
  characterId: string;
  detailedBio: string;
  homeRegion: string;
  speechStyle: string;
  dailyRhythm: string;
  emotionalBaseline: string;
  coreNeeds: string[];
};

export type CharacterLoreDef = {
  characterId: string;
  /** 保留原短 bio 精神的摘要 */
  summary: string;
  /** 详细背景故事（≥2000 汉字） */
  fullStory: string;
  /** 未来 AI 对话 / 日常模拟用 */
  aiProfile: {
    homeBase: string;
    knownLocations: string[];
    dailyRoutine: string;
    emotionalBaseline: string;
    coreNeeds: string[];
    fears: string[];
    speechStyle: string;
    relationshipNotes: string;
    secrets: string;
    sensoryAnchors: string[];
  };
};
