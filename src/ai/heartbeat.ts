import { runNpcPairEvent } from './dialogueEngine';
import { listPresencesAt, resolvePresence } from './livingState';
import { pushCampLog } from './memory';
import { getRelation } from './relationship';
import { resolveActiveSceneId } from './worldClock';
import { hasDialogueApiKey } from './llmRouter';
import { recordCampLifeSnapshot, recordLifeNote } from './lifeArchive';
import { trySpawnCampEvent } from './campEvents';
import { tryProactiveNpcOutreach, resolveReadyNpcSeeks } from './npcOutreach';
import { tryRollCyberHealthEvents } from '../systems/CyberHealthSystem';
import type { AiLivingSave } from './types';
import { CHARACTER_MAP } from '../data/characters';

const MIN_INTERVAL_MS = 8 * 60 * 1000; // 至少 8 分钟一次稀疏事件

/** 本地规则日志（不耗 API） */
function localAmbientLog(living: AiLivingSave, ownedIds: string[]): void {
  if (!ownedIds.length) return;
  const id = ownedIds[Math.floor(Math.random() * ownedIds.length)];
  const p = resolvePresence(id, living);
  const name = CHARACTER_MAP[id]?.name ?? id;
  const text = `${name}：${p.behavior}`;
  pushCampLog(living, {
    text,
    source: 'system',
    characterIds: [id],
  });
  void recordLifeNote(living, text, { kind: 'camp', characterId: id });
}

/**
 * 稀疏心跳：优先营地事件 → NPC 主动沟通（含跨房寻找）→ 同房高关系对谈 → 本地氛围。
 */
export async function tickHeartbeat(
  living: AiLivingSave,
  ownedIds: string[],
  now = Date.now(),
): Promise<{ kind: 'skip' | 'local' | 'npc' | 'camp_event' | 'npc_seek'; detail?: string }> {
  await recordCampLifeSnapshot(living, ownedIds, '心跳巡检');

  // 已抵达的寻找可随时结算（不占 8 分钟配额）
  const arrived = await resolveReadyNpcSeeks(living);
  if (arrived.kind === 'npc') {
    return { kind: 'npc', detail: arrived.detail };
  }

  if (now - living.lastNpcEventAt < MIN_INTERVAL_MS) {
    return { kind: 'skip' };
  }
  living.lastNpcEventAt = now;

  // 义体健康告警（按健康档位概率，心情/状态微调）
  const cyberEv = tryRollCyberHealthEvents(living, ownedIds);
  if (cyberEv) {
    return { kind: 'camp_event', detail: `cyber:${cyberEv.id}` };
  }

  // 营地随机事件（本地规则，不耗对话 API）
  const spawned = trySpawnCampEvent(living, ownedIds, { chance: 0.55 });
  if (spawned) {
    return { kind: 'camp_event', detail: spawned.defId };
  }

  // 主动 NPC 沟通（动机驱动，可跨房）
  const proactive = await tryProactiveNpcOutreach(living, ownedIds);
  if (proactive.kind === 'npc') {
    return { kind: 'npc', detail: proactive.detail };
  }
  if (proactive.kind === 'seek') {
    return { kind: 'npc_seek', detail: proactive.detail };
  }

  // 回退：同场景高关系偶发对谈
  const sceneId = resolveActiveSceneId(living);
  const here = listPresencesAt(ownedIds, living, sceneId).map((p) => p.characterId);

  let best: { a: string; b: string; score: number } | null = null;
  for (let i = 0; i < here.length; i++) {
    for (let j = i + 1; j < here.length; j++) {
      const rel = getRelation(living, here[i], here[j]);
      const score = Math.abs(rel);
      if (score >= 15 && (!best || score > best.score)) {
        best = { a: here[i], b: here[j], score };
      }
    }
  }

  const roll = Math.random();
  if (best && hasDialogueApiKey() && roll < 0.35) {
    try {
      const motive = '同房间遇见，顺口聊两句营地近况';
      const result = await runNpcPairEvent(living, best.a, best.b, sceneId, undefined, motive);
      void recordLifeNote(living, result.summary, { kind: 'npc', characterId: best.a });
      return { kind: 'npc', detail: result.summary };
    } catch {
      localAmbientLog(living, ownedIds);
      return { kind: 'local', detail: 'npc_fallback' };
    }
  }

  localAmbientLog(living, ownedIds);
  return { kind: 'local' };
}
