/**
 * 猜拳引擎（石头剪刀布，三局两胜，纯本地计算）。
 * AI 出拳：均匀随机 + 按角色 id 哈希的轻微偏向（每个角色有自己的"手感"）。
 */

export type RpsThrow = 'rock' | 'scissors' | 'paper';

export const RPS_THROWS: RpsThrow[] = ['rock', 'scissors', 'paper'];

export function rpsThrowLabel(t: RpsThrow): string {
  return t === 'rock' ? '石头' : t === 'scissors' ? '剪刀' : '布';
}

/** 单回合结果：1 玩家胜，-1 AI 胜，0 平 */
export function resolveRpsRound(player: RpsThrow, ai: RpsThrow): 1 | 0 | -1 {
  if (player === ai) return 0;
  if (
    (player === 'rock' && ai === 'scissors') ||
    (player === 'scissors' && ai === 'paper') ||
    (player === 'paper' && ai === 'rock')
  ) {
    return 1;
  }
  return -1;
}

/** 按角色 id 哈希出 0..1 的稳定伪随机 */
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * AI 出拳：以均匀随机为主，按角色哈希给一个轻微偏向（+12% 某拳）。
 */
export function aiChooseRpsThrow(characterId: string, rng: () => number = Math.random): RpsThrow {
  const biasIdx = Math.floor(hashSeed(characterId) * 3) % 3;
  const roll = rng();
  if (roll < 0.12) return RPS_THROWS[biasIdx];
  return RPS_THROWS[Math.floor(rng() * 3) % 3];
}

/** 三局两胜是否已分胜负：'player' | 'ai' | null */
export function rpsMatchResult(playerWins: number, aiWins: number): 'player' | 'ai' | null {
  if (playerWins >= 2) return 'player';
  if (aiWins >= 2) return 'ai';
  return null;
}
