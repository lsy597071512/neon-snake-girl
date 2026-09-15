/**
 * NPC 主动找另一 NPC 沟通（含跨房寻找）——用于生活仿真与对话语料训练。
 *
 * 原 heartbeat 仅：同场景 + 高关系 + 28% 概率对谈。
 * 本模块补强：
 * 1) 按当前行为/意图挑出发起人与对象（修理求助、社交搭话等）
 * 2) 不同房时写入 seek 意图并赶路，抵达后触发对谈
 * 3) 对谈带动机 motive，写入档案供训练
 */
import { CHARACTER_MAP } from '../data/characters';
import { getCharacterHomeRoom } from '../data/campLayout';
import { saveManager } from '../core/SaveManager';
import { getAgenda, isAgendaActive, setAgenda } from './characterAgenda';
import { setAgentDestination } from './campAgents';
import { runNpcPairEvent } from './dialogueEngine';
import { hasDialogueApiKey } from './llmRouter';
import { resolveCharacterRoomId, resolvePresence } from './livingState';
import { pushCampLog, pushMemory } from './memory';
import { getRelation } from './relationship';
import { resolveActiveSceneId } from './worldClock';
import { recordLifeNote } from './lifeArchive';
import type { AiLivingSave, CharacterActivity, NpcSeekIntent } from './types';

function ensureSeeks(living: AiLivingSave): NpcSeekIntent[] {
  if (!living.pendingNpcSeeks) living.pendingNpcSeeks = [];
  return living.pendingNpcSeeks;
}

function hardUnavailable(activity: CharacterActivity): boolean {
  return activity === 'sleeping' || activity === 'bathe';
}

type SeekCandidate = {
  seekerId: string;
  targetId: string;
  motive: string;
  score: number;
  sameRoom: boolean;
};

function pickSeekCandidates(living: AiLivingSave, ownedIds: string[]): SeekCandidate[] {
  const out: SeekCandidate[] = [];
  const seeks = ensureSeeks(living);

  for (const seekerId of ownedIds) {
    if (seeks.some((s) => s.seekerId === seekerId)) continue;
    const sp = resolvePresence(seekerId, living);
    if (hardUnavailable(sp.activity)) continue;

    const agenda = getAgenda(living, seekerId);
    const agendaActive = isAgendaActive(agenda);

    for (const targetId of ownedIds) {
      if (targetId === seekerId) continue;
      if (seeks.some((s) => s.seekerId === targetId && s.targetId === seekerId)) continue;
      const tp = resolvePresence(targetId, living);
      if (hardUnavailable(tp.activity)) continue;

      const rel = getRelation(living, seekerId, targetId);
      if (rel < 8 && Math.abs(rel) < 25) continue;

      const sameRoom = resolveCharacterRoomId(seekerId, living) === resolveCharacterRoomId(targetId, living);
      let score = Math.abs(rel) / 20;
      let motive = '想随便说两句';

      // 维护/忙碌 → 更倾向找人求助或汇报
      if (sp.activity === 'maintain' || sp.activity === 'busy') {
        if (tp.activity === 'maintain' || tp.activity === 'busy' || tp.activity === 'idle' || tp.activity === 'rest') {
          score += 1.4;
          motive = `自己在「${sp.behavior}」时碰到拿不准的点，想找 ${CHARACTER_MAP[targetId]?.name ?? targetId} 商量`;
        } else {
          score -= 0.6;
        }
      }

      // 玩乐/闲着 → 社交搭话
      if (sp.activity === 'play' || sp.activity === 'idle' || sp.activity === 'rest') {
        score += 0.9;
        motive = `手头空，想找 ${CHARACTER_MAP[targetId]?.name ?? targetId} 聊两句营地里的事`;
      }

      // 事件意图中 → 拉人
      if (agendaActive && agenda?.eventStance === 'recruit') {
        score += 1.6;
        motive = `事件相关：想拉 ${CHARACTER_MAP[targetId]?.name ?? targetId} 一起处理「${agenda.reason}」`;
      }

      // 同房更容易立刻谈；跨房需要更强动机
      if (sameRoom) score += 0.8;
      else score -= 0.35;

      // 关系敌对时可能冲突式搭话
      if (rel <= -25) {
        score += 0.5;
        motive = `看对方不爽，主动凑上去拌两句`;
      }

      score += Math.random() * 0.5;
      if (score >= 1.6) {
        out.push({ seekerId, targetId, motive, score, sameRoom });
      }
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

function startSeek(living: AiLivingSave, c: SeekCandidate): void {
  const targetRoom =
    resolveCharacterRoomId(c.targetId, living) || getCharacterHomeRoom(c.targetId).id;
  ensureSeeks(living).push({
    seekerId: c.seekerId,
    targetId: c.targetId,
    motive: c.motive,
    createdGameMin: living.gameMinutes,
    expiresGameMin: living.gameMinutes + 90,
  });

  setAgenda(living, c.seekerId, {
    goal: `去找 ${CHARACTER_MAP[c.targetId]?.name ?? c.targetId}`,
    targetRoomId: targetRoom,
    activity: 'talking',
    behavior: `赶去找人：${c.motive.slice(0, 40)}`,
    remainGameMin: 35,
    startedGameMin: living.gameMinutes,
    reason: c.motive,
    source: 'social',
  });
  setAgentDestination(c.seekerId, targetRoom);

  const sn = CHARACTER_MAP[c.seekerId]?.name ?? c.seekerId;
  const tn = CHARACTER_MAP[c.targetId]?.name ?? c.targetId;
  pushCampLog(living, {
    text: `${sn} 主动去找 ${tn}：${c.motive}`,
    source: 'npc',
    characterIds: [c.seekerId, c.targetId],
  });
  void recordLifeNote(living, `${sn} 动身去找 ${tn}`, {
    kind: 'npc',
    characterId: c.seekerId,
  });
}

/**
 * 若 seeker 已与 target 同房，结算对谈并清除 seek。
 */
export async function resolveReadyNpcSeeks(
  living: AiLivingSave,
): Promise<{ kind: 'npc' | 'none'; detail?: string }> {
  const seeks = ensureSeeks(living);
  if (!seeks.length) return { kind: 'none' };

  // 过期清理
  living.pendingNpcSeeks = seeks.filter((s) => s.expiresGameMin >= living.gameMinutes);
  const ready = living.pendingNpcSeeks.find(
    (s) =>
      resolveCharacterRoomId(s.seekerId, living) === resolveCharacterRoomId(s.targetId, living) &&
      !hardUnavailable(resolvePresence(s.seekerId, living).activity) &&
      !hardUnavailable(resolvePresence(s.targetId, living).activity),
  );
  if (!ready) return { kind: 'none' };

  living.pendingNpcSeeks = living.pendingNpcSeeks.filter(
    (s) => !(s.seekerId === ready.seekerId && s.targetId === ready.targetId),
  );

  if (!hasDialogueApiKey()) {
    const sn = CHARACTER_MAP[ready.seekerId]?.name ?? ready.seekerId;
    const tn = CHARACTER_MAP[ready.targetId]?.name ?? ready.targetId;
    const summary = `${sn} 找到 ${tn}，低声说了几句（离线）：${ready.motive}`;
    pushCampLog(living, { text: summary, source: 'npc', characterIds: [ready.seekerId, ready.targetId] });
    pushMemory(living, ready.seekerId, { kind: 'event', summary, importance: 3 });
    pushMemory(living, ready.targetId, { kind: 'event', summary, importance: 3 });
    return { kind: 'npc', detail: summary };
  }

  const sceneId =
    resolvePresence(ready.seekerId, living).locationId || resolveActiveSceneId(living);
  try {
    const result = await runNpcPairEvent(
      living,
      ready.seekerId,
      ready.targetId,
      sceneId,
      saveManager.get(),
      ready.motive,
    );
    void recordLifeNote(living, result.summary, { kind: 'npc', characterId: ready.seekerId });
    return { kind: 'npc', detail: result.summary };
  } catch {
    return { kind: 'none', detail: 'npc_seek_fail' };
  }
}

/**
 * 尝试发起一次主动 NPC 沟通（同房立刻谈 / 跨房开始寻找）。
 */
export async function tryProactiveNpcOutreach(
  living: AiLivingSave,
  ownedIds: string[],
): Promise<{ kind: 'npc' | 'seek' | 'none'; detail?: string }> {
  // 先结算已抵达的寻找
  const resolved = await resolveReadyNpcSeeks(living);
  if (resolved.kind === 'npc') return resolved;

  const candidates = pickSeekCandidates(living, ownedIds);
  if (!candidates.length) return { kind: 'none' };

  const top = candidates[0];
  // 同房：直接对话（有 Key）或本地摘要
  if (top.sameRoom) {
    if (hasDialogueApiKey() && Math.random() < 0.72) {
      const sceneId =
        resolvePresence(top.seekerId, living).locationId || resolveActiveSceneId(living);
      try {
        const result = await runNpcPairEvent(
          living,
          top.seekerId,
          top.targetId,
          sceneId,
          saveManager.get(),
          top.motive,
        );
        void recordLifeNote(living, result.summary, { kind: 'npc', characterId: top.seekerId });
        return { kind: 'npc', detail: result.summary };
      } catch {
        /* fallthrough seek log */
      }
    }
    // 无 Key 或失败：仍记一条「主动搭话」训练痕迹
    const sn = CHARACTER_MAP[top.seekerId]?.name ?? top.seekerId;
    const tn = CHARACTER_MAP[top.targetId]?.name ?? top.targetId;
    const summary = `${sn} 在同房主动找 ${tn}：${top.motive}`;
    pushCampLog(living, { text: summary, source: 'npc', characterIds: [top.seekerId, top.targetId] });
    pushMemory(living, top.seekerId, { kind: 'event', summary, importance: 3 });
    pushMemory(living, top.targetId, { kind: 'event', summary, importance: 2 });
    return { kind: 'npc', detail: summary };
  }

  // 跨房：开始寻找（约 55% 真正动身，避免全员乱跑）
  if (Math.random() < 0.55) {
    startSeek(living, top);
    return { kind: 'seek', detail: `${top.seekerId}->${top.targetId}` };
  }

  return { kind: 'none' };
}

/** 供调试：当前 seek 列表文案 */
export function describePendingNpcSeeks(living: AiLivingSave): string[] {
  return ensureSeeks(living).map((s) => {
    const a = CHARACTER_MAP[s.seekerId]?.name ?? s.seekerId;
    const b = CHARACTER_MAP[s.targetId]?.name ?? s.targetId;
    return `${a} → ${b}：${s.motive}`;
  });
}
