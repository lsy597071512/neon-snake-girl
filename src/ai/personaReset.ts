/**
 * 人设大改后的一次性存档清理：清掉该角色相关好感、关系、记忆与近期对话。
 */
import { clearCharacterLifeTimeline } from './lifeTimeline';
import type { AiLivingSave } from './types';

/** 白楯·芹奈：刻薄傲娇 → 温柔贤惠护盾 */
export const HEARTFORGE_PERSONA_RESET_REV = 1;

export function applyCharacterPersonaResets(living: AiLivingSave): void {
  living.personaResets ??= {};
  if ((living.personaResets.heartforge ?? 0) < HEARTFORGE_PERSONA_RESET_REV) {
    wipeCharacterSocialTrace(living, 'heartforge');
    living.personaResets.heartforge = HEARTFORGE_PERSONA_RESET_REV;
  }
}

function wipeCharacterSocialTrace(living: AiLivingSave, characterId: string): void {
  living.affinities[characterId] = 0;
  if (living.relationshipArcStage) delete living.relationshipArcStage[characterId];
  if (living.structuredFacts) delete living.structuredFacts[characterId];

  for (const key of Object.keys(living.relationships ?? {})) {
    if (key === characterId || key.startsWith(`${characterId}|`) || key.endsWith(`|${characterId}`)) {
      delete living.relationships[key];
    }
  }

  if (living.memories) delete living.memories[characterId];
  if (living.recentChats) delete living.recentChats[characterId];
  if (living.chatDigests) delete living.chatDigests[characterId];
  if (living.lastTalkAt) delete living.lastTalkAt[characterId];
  if (living.personas) delete living.personas[characterId];
  if (living.agendas) delete living.agendas[characterId];
  if (living.aiMessageStats) delete living.aiMessageStats[characterId];
  if (living.characterStatus) delete living.characterStatus[characterId];

  if (Array.isArray(living.pendingAiMessages)) {
    living.pendingAiMessages = living.pendingAiMessages.filter((m) => m.characterId !== characterId);
  }
  if (Array.isArray(living.pendingNpcSeeks)) {
    living.pendingNpcSeeks = living.pendingNpcSeeks.filter(
      (s) => s.seekerId !== characterId && s.targetId !== characterId,
    );
  }

  void clearCharacterLifeTimeline(characterId);
}
