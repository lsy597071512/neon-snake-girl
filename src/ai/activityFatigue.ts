/**
 * 重复活动厌倦（活人定律输入源之一）：
 * 玩家反复让同一角色做同类活动（小游戏/跳舞/共浴/换装）时，
 * 超过耐心阈值（按 play 特质浮动）后打心情脉冲 + 写记忆，
 * 并注入 Prompt 让 AI 表现出不耐烦——真实的人会被重复安排磨掉兴致。
 * 次数按天记录，跨天自动清零。
 */
import type { AiLivingSave } from './types';
import { getPersona } from './characterPersona';
import { applyMoodImpulse } from './moodContinuum';
import { pushMemory } from './memory';

export type ActivityRequestRecord = {
  dayIndex: number;
  counts: Record<string, number>;
};

/** 玩家可发起的重复活动键 → 文案 */
const ACTIVITY_LABELS: Record<string, string> = {
  minigame: '拉她玩小游戏',
  dance: '让她跳舞',
  bath: '找她一起洗澡',
  outfit: '让她换装',
};

function getRecord(living: AiLivingSave, characterId: string): ActivityRequestRecord {
  const cur = living.activityRequests?.[characterId];
  if (cur && cur.dayIndex === living.dayIndex) return cur;
  const fresh: ActivityRequestRecord = { dayIndex: living.dayIndex, counts: {} };
  if (!living.activityRequests) living.activityRequests = {};
  living.activityRequests[characterId] = fresh;
  return fresh;
}

/** 耐心阈值：基础 3 次 + play 特质加成（play 越高越耐玩，最高约 8 次） */
function patienceThreshold(living: AiLivingSave, characterId: string): number {
  const p = getPersona(living, characterId);
  return 3 + Math.floor((p.traits.play ?? 0) / 10);
}

/**
 * 玩家发起一次活动请求时调用：计数 + 超阈值打厌倦脉冲。
 * 返回今天该活动的第几次。
 */
export function recordPlayerActivityRequest(
  living: AiLivingSave,
  characterId: string,
  key: keyof typeof ACTIVITY_LABELS | string,
): number {
  const rec = getRecord(living, characterId);
  rec.counts[key] = (rec.counts[key] ?? 0) + 1;
  const n = rec.counts[key];
  const threshold = patienceThreshold(living, characterId);
  if (n > threshold) {
    const over = n - threshold;
    // 每超一次心情更差一点（封顶 18），唤醒微升（烦）
    applyMoodImpulse(living, characterId, {
      kind: 'asr_hint',
      valenceDelta: -Math.min(18, over * 2),
      arousalDelta: 4,
    });
    // 首次越界写一条记忆，之后不重复刷
    if (n === threshold + 1) {
      pushMemory(living, characterId, {
        kind: 'activity_fatigue',
        summary: `今天第 ${n} 次被指挥官${ACTIVITY_LABELS[key] ?? '安排同样的活动'}，开始觉得腻了`,
        importance: 2,
      });
    }
  }
  return n;
}

/** 注入 Prompt：把今天的重复活动感受告诉 AI（无记录时返回空串） */
export function describeActivityFatigueForPrompt(
  living: AiLivingSave,
  characterId: string,
): string {
  const rec = living.activityRequests?.[characterId];
  if (!rec || rec.dayIndex !== living.dayIndex) return '';
  const threshold = patienceThreshold(living, characterId);
  const lines: string[] = [];
  for (const key of Object.keys(rec.counts)) {
    const label = ACTIVITY_LABELS[key];
    const n = rec.counts[key];
    if (!label || n < 2) continue;
    if (n > threshold) {
      lines.push(
        `- 今天指挥官已第 ${n} 次${label}，明显超过她的耐心（约 ${threshold} 次）：她已觉得腻烦，可显出不情愿、敷衍或直接吐槽，语气贴合当前心情`,
      );
    } else if (n === threshold) {
      lines.push(`- 今天指挥官已第 ${n} 次${label}，接近耐心上限：可流露一丝不耐烦或调侃「又来」`);
    } else {
      lines.push(`- 今天指挥官第 ${n} 次${label}：尚可接受，但别表现成第一次那样新鲜`);
    }
  }
  if (!lines.length) return '';
  return `【重复活动感受】（同日活动次数，真实的人会腻）\n${lines.join('\n')}`;
}
