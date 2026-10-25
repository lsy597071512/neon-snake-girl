/**
 * 行程到达派发：走到目的地后切会话相位（舞蹈/安抚），并写营地日志。
 */
import { finishAnfuTravel } from './anfuSession';
import { finishDanceTravel } from './danceSession';
import { pushCampLog } from './memory';
import { tickTravelPlans, tickTravelWaypoints } from './travel';
import type { AiLivingSave } from './types';

export function processTravelArrivals(
  living: AiLivingSave,
  now = Date.now(),
): string[] {
  // 先推进途经点（楼梯/大厅），再结算到达
  tickTravelWaypoints(living, now);
  const arrivals = tickTravelPlans(living, now);
  if (!arrivals.length) return [];
  const lines: string[] = [];
  for (const a of arrivals) {
    let line: string | null = null;
    if (a.reason === 'dance_entry') line = finishDanceTravel(living, a.characterId);
    else if (a.reason === 'anfu_entry') line = finishAnfuTravel(living, a.characterId);
    if (line) {
      lines.push(line);
      pushCampLog(living, {
        text: line.replace(/^【系统】/, ''),
        source: 'system',
        characterIds: [a.characterId],
      });
    }
  }
  return lines;
}
