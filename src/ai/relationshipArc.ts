/**
 * 指挥官↔角色 关系弧线（好感驱动的阶段状态机）
 * 与 affinity 0–100 对齐；不依赖 relationship.ts（避免循环引用）。
 */
import type { AiLivingSave } from './types';

export type RelationshipArcId =
  | 'wary'
  | 'cool'
  | 'familiar'
  | 'friendly'
  | 'trust'
  | 'intimate';

export type RelationshipArcStage = {
  id: RelationshipArcId;
  minAffinity: number;
  labelZh: string;
  addressHint: string;
  topicFreedom: string;
  constraint: string;
};

export const RELATIONSHIP_ARC_STAGES: readonly RelationshipArcStage[] = [
  {
    id: 'wary',
    minAffinity: 0,
    labelZh: '警惕',
    addressHint: '保持距离，少用亲昵称呼，可用职衔或冷淡直呼',
    topicFreedom: '只谈任务/安全/当面事；拒绝对私人生活刨根问底',
    constraint: '勿突然表白或过度亲昵；可防备、可试探',
  },
  {
    id: 'cool',
    minAffinity: 20,
    labelZh: '冷淡',
    addressHint: '礼貌但疏离，偶尔露出一点在意仍嘴硬',
    topicFreedom: '可闲聊营地日常，仍回避过深感情戏',
    constraint: '不要装成已经很熟；可短答、可打发',
  },
  {
    id: 'familiar',
    minAffinity: 40,
    labelZh: '熟悉',
    addressHint: '开始像队友熟人，可用名字或惯用称呼',
    topicFreedom: '可聊喜好、作息、吐槽同伴；仍克制告白',
    constraint: '记得你们已经打过交道，禁止「第一次见面」式开场',
  },
  {
    id: 'friendly',
    minAffinity: 60,
    labelZh: '友好',
    addressHint: '语气放软，可主动关心，仍按本人声线',
    topicFreedom: '可谈心事、吃味、约定小事；可轻度撒娇/护短（若声线允许）',
    constraint: '感情升温要像「这个人」，禁止统一二次元傲娇模板',
  },
  {
    id: 'trust',
    minAffinity: 80,
    labelZh: '信赖',
    addressHint: '信任卸防，可托付、可依赖；称呼可更私人（仍克制低俗）',
    topicFreedom: '可谈秘密边缘、未来、出征承诺；可吃醋但可沟通',
    constraint: '重大约定必须当真；禁止否认已建立的信任事实',
  },
  {
    id: 'intimate',
    minAffinity: 90,
    labelZh: '亲密',
    addressHint: '近距柔软或占有欲（按声线）；可用专属昵称（若有事实表）',
    topicFreedom: '可深情、可脆弱、可宣示归属；仍禁止OOC与全员同一句甜言',
    constraint: '必须记得【结构化事实】里的约定/称呼；出戏式遗忘即失败',
  },
] as const;

export function resolveRelationshipArc(affinity: number): RelationshipArcStage {
  const score = Math.max(0, Math.min(100, affinity | 0));
  let best = RELATIONSHIP_ARC_STAGES[0]!;
  for (const stage of RELATIONSHIP_ARC_STAGES) {
    if (score >= stage.minAffinity) best = stage;
  }
  return best;
}

export function getRelationshipArc(
  living: AiLivingSave,
  characterId: string,
): RelationshipArcStage {
  const aff = living.affinities[characterId] ?? 40;
  return resolveRelationshipArc(aff);
}

/** UI / 存档展示用别名 */
export function getRelationshipArcStage(
  living: AiLivingSave,
  characterId: string,
): RelationshipArcStage {
  return getRelationshipArc(living, characterId);
}

export function relationshipArcLabelZh(affinity: number): string {
  return resolveRelationshipArc(affinity).labelZh;
}

export function buildRelationshipArcPromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const aff = living.affinities[characterId] ?? 40;
  const arc = resolveRelationshipArc(aff);
  return `【关系弧线·指挥官】阶段「${arc.labelZh}」（好感 ${aff}/100）
- 称呼底色：${arc.addressHint}
- 话题自由度：${arc.topicFreedom}
- 硬约束：${arc.constraint}
- 禁止跳级表演（未到信赖却深度告白、未到熟悉却装作青梅）。`;
}

export function detectArcTransition(
  prevAffinity: number,
  nextAffinity: number,
): { from: RelationshipArcStage; to: RelationshipArcStage } | null {
  const from = resolveRelationshipArc(prevAffinity);
  const to = resolveRelationshipArc(nextAffinity);
  if (from.id === to.id) return null;
  return { from, to };
}
