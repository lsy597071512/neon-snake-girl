import { chatJsonQwen, hasApiKey } from './llmClient';
import { pushCampLog, pushMemory } from './memory';
import { assembleOfflineSummaryMessages } from './promptAssembler';
import { advanceWorldClock } from './worldClock';
import { getConfiguredSummaryModel } from './modelConfig';
import { recordCampLifeSnapshot, recordLifeNote } from './lifeArchive';
import type { AiLivingSave } from './types';
import { saveManager } from '../core/SaveManager';
import { applyCyberAgingByDayIndex, seedCyberHealthForOwned } from '../systems/CyberHealthSystem';

const OFFLINE_THRESHOLD_MS = 30 * 60 * 1000; // 离线超过 30 分钟才摘要

export async function processOfflineReturn(
  living: AiLivingSave,
  ownedIds: string[],
  now = Date.now(),
): Promise<string | null> {
  const prevDay = living.dayIndex;
  const elapsed = advanceWorldClock(living, now);
  seedCyberHealthForOwned(living, ownedIds);
  if (living.dayIndex !== prevDay) {
    applyCyberAgingByDayIndex(living, ownedIds);
  }
  // 离线归来：无论是否触发 LLM 摘要，都先落本地生活快照（0 token）
  await recordCampLifeSnapshot(living, ownedIds, '离线归来');

  if (elapsed < OFFLINE_THRESHOLD_MS) return null;
  if (now - living.lastOfflineSummaryAt < OFFLINE_THRESHOLD_MS) return null;

  const hours = elapsed / 3_600_000;
  living.lastOfflineSummaryAt = now;

  if (!hasApiKey()) {
    const fallback = `你不在的约 ${hours.toFixed(1)} 小时里，营地按作息运转：有人巡检、有人歇息，沙风如常。`;
    living.pendingOfflineSummary = fallback;
    pushCampLog(living, { text: fallback, source: 'offline' });
    await recordLifeNote(living, fallback, { kind: 'offline' });
    return fallback;
  }

  try {
    const { system, user } = assembleOfflineSummaryMessages(
      living,
      ownedIds,
      hours,
      saveManager.get(),
    );
    const raw = await chatJsonQwen<{ summary?: string; events?: string[] }>(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { model: getConfiguredSummaryModel(), maxTokens: 700 },
    );
    const events = Array.isArray(raw.events) ? raw.events : [];
    const summary = raw.summary || `离线 ${hours.toFixed(1)} 小时摘要`;
    const text = [summary, ...events.map((e) => `· ${e}`)].join('\n');
    living.pendingOfflineSummary = text;
    pushCampLog(living, { text: summary, source: 'offline' });
    await recordLifeNote(living, text, { kind: 'offline' });
    for (const id of ownedIds.slice(0, 6)) {
      pushMemory(living, id, {
        kind: 'event',
        summary: `离线期间：${summary}`,
        importance: 2,
      });
    }
    return text;
  } catch {
    const fallback = `离线约 ${hours.toFixed(1)} 小时。营地仍在，只是少了你的脚步声。`;
    living.pendingOfflineSummary = fallback;
    pushCampLog(living, { text: fallback, source: 'offline' });
    await recordLifeNote(living, fallback, { kind: 'offline' });
    return fallback;
  }
}

export function consumeOfflineSummary(living: AiLivingSave): string | null {
  const s = living.pendingOfflineSummary;
  living.pendingOfflineSummary = null;
  return s;
}
