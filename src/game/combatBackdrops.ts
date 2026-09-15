/**
 * 章节竖屏远景背景（战斗场景 + 开战前剧情共用）。
 */
import type { CombatThemeId } from './combatThemes';

/** 每两关一张（1-2 / 3-4 / 5-6 / 7-8） */
export const THEME_BACKDROP_PLATES: Partial<Record<CombatThemeId, readonly string[]>> = {
  station: [
    './tex/combat/backgrounds/station/01-platform.png',
    './tex/combat/backgrounds/station/02-depot.png',
    './tex/combat/backgrounds/station/03-gantry.png',
    './tex/combat/backgrounds/station/04-signal.png',
  ],
  corridor: [
    './tex/combat/backgrounds/corridor/04-digigate.png',
    './tex/combat/backgrounds/corridor/07-beacon.png',
    './tex/combat/backgrounds/corridor/08-bunker.png',
    './tex/combat/backgrounds/corridor/09-cyclone.png',
  ],
  frost: [
    './tex/combat/backgrounds/frost/02-frozenhangar.png',
    './tex/combat/backgrounds/frost/04-cryodepot.png',
    './tex/combat/backgrounds/frost/05-icegantry.png',
    './tex/combat/backgrounds/frost/06-shieldwreck.png',
  ],
  forge: [
    './tex/combat/backgrounds/forge/03-workshop.png',
    './tex/combat/backgrounds/forge/04-coolingtower.png',
    './tex/combat/backgrounds/forge/05-foundrycrane.png',
    './tex/combat/backgrounds/forge/06-emberstreet.png',
  ],
  core: [
    './tex/combat/backgrounds/core/01-ringwall.png',
    './tex/combat/backgrounds/core/03-starseed.png',
    './tex/combat/backgrounds/core/05-skycrack.png',
    './tex/combat/backgrounds/core/06-skygate.png',
  ],
};

function chapterIndexOfStage(stageId: number): number {
  return ((Math.max(1, stageId) - 1) % 8) + 1;
}

export function pickCombatBackdropUrl(themeId: CombatThemeId, stageId: number): string | null {
  const plates = THEME_BACKDROP_PLATES[themeId];
  if (!plates?.length) return null;
  const pair = Math.floor((chapterIndexOfStage(stageId) - 1) / 2);
  return plates[Math.min(pair, plates.length - 1)] ?? plates[0] ?? null;
}
