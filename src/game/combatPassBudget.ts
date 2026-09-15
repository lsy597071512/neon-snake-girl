/**
 * 战斗「敌人通过」失败阈值（与营地义体健康无关）。
 * 角色无敌；每次碰撞或漏过计 1 次通过；通过次数超过阈值才判负。
 */

export interface CombatPassBudgetInput {
  stageId: number;
  waves: number;
  isBoss: boolean;
  enemyDamage: number;
  recommendedTcp: number;
  tcp: number;
  /** 0~1+，护盾类技能 */
  shieldBonus: number;
  /** 攻速加成，反映武器/技能清场能力 */
  attackSpeedBonus: number;
  /** 穿透次数，清场更稳 */
  projectilePierce: number;
  /** 是否有铁雨等周期性清场 */
  ironRainEnabled: boolean;
  squadSize: number;
  /** 小队平均弹伤（已含武器/稀有度/职业） */
  avgShotDamage: number;
}

/** 与 Combat3D.spawnWave 一致的预估敌人总数 */
export function estimateStageEnemyCount(stageId: number, waves: number, isBoss: boolean): number {
  let total = 0;
  for (let w = 1; w <= waves; w++) {
    total += 4 + w + Math.floor(stageId / 10);
  }
  if (isBoss) total += 1;
  return total;
}

/**
 * 本关允许的最大通过次数；实际通过数 **超过** 该值才失败。
 *
 * 设计：
 * - 基准 = 预估敌人数 × 允许漏过比例（前期宽、后期紧）
 * - 敌伤压力↑ → 阈值略降
 * - TCP/推荐↑、护盾↑、编制↑ → 阈值略升（容错）
 * - 攻速/穿透/铁雨/弹伤↑ → 清场更强，阈值略收（避免白送）
 * - Boss 关略紧
 */
export function computeCombatPassLimit(input: CombatPassBudgetInput): number {
  const enemies = estimateStageEnemyCount(input.stageId, input.waves, input.isBoss);

  // 关卡进度：约 32% → 14% 可漏
  const stageT = Math.min(1, Math.max(0, (input.stageId - 1) / 40));
  let leakRatio = 0.32 - stageT * 0.18;

  // 敌伤越高（推进更猛）→ 略收紧
  leakRatio *= 1 / (1 + input.enemyDamage * 0.01);

  // TCP 相对推荐：0.75~1.35
  const tcpRatio = Math.max(
    0.75,
    Math.min(1.35, input.tcp / Math.max(1, input.recommendedTcp)),
  );

  // 护盾技能：最多约 +20% 容错
  const shieldMul = 1 + Math.min(0.35, input.shieldBonus) * 0.55;

  // 输出能力只影响玩家的容错上限，不能反向压低高战队伍的通关机会。
  // 操作仍然有意义：换道失误会增加通过数；高战力只是让有效输出更稳定。
  const offenseMul =
    1 +
    Math.min(0.22, input.attackSpeedBonus * 0.22) +
    Math.min(0.08, input.projectilePierce * 0.04) +
    (input.ironRainEnabled ? 0.06 : 0) +
    Math.min(0.08, input.avgShotDamage / 120);

  // 多编队位：增加清场稳定性，但不替代换道操作。
  const squadMul = 1 + Math.max(0, input.squadSize - 1) * 0.05;

  let limit = enemies * leakRatio * tcpRatio * shieldMul * offenseMul * squadMul;
  if (input.isBoss) limit *= 0.92;

  // 通过数量是普通关唯一的进度失败指标；阈值随关卡规模变化，不随伤害反向收紧。
  const floor = input.stageId <= 3 ? 5 : input.stageId <= 8 ? 4 : 3;
  return Math.max(floor, Math.min(22, Math.round(limit)));
}
