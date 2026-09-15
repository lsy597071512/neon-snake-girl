/** 波次结算纯逻辑 — 供战斗与单元测试共用 */
export function shouldAdvanceWave(
  alive: number,
  pendingSpawns: number,
): boolean {
  return alive === 0 && pendingSpawns <= 0;
}

export function shouldEndVictory(
  alive: number,
  pendingSpawns: number,
  wave: number,
  maxWaves: number,
  everSpawned: boolean,
): boolean {
  return (
    alive === 0 &&
    pendingSpawns <= 0 &&
    wave >= maxWaves &&
    everSpawned
  );
}

export function nextWaveAfterClear(
  alive: number,
  pendingSpawns: number,
  wave: number,
  maxWaves: number,
): number | null {
  if (alive !== 0 || pendingSpawns > 0) return null;
  if (wave < maxWaves) return wave + 1;
  return null;
}
