import { rankingScore } from '../data/achievements';
import { CHARACTERS } from '../data/characters';
import { WEAPONS } from '../data/weapons';
import type { AiLivingSaveData, PlayerStats, Rarity, SaveData, WeaponRarity } from '../types';
import { addCharacterShard, addWeaponShard } from './ShardSystem';
import { acquireWeapon } from './ArmorySystem';

export type TaskRewardType = 'gold' | 'tickets' | 'character' | 'weapon' | 'char_shard' | 'weapon_shard';

export interface TaskReward {
  type: TaskRewardType;
  amount?: number;
  rarity?: Rarity | WeaponRarity;
  characterId?: string;
  weaponId?: string;
}

export interface TaskDef {
  id: string;
  level: number;
  name: string;
  desc: string;
  target: number;
  metric: TaskMetric;
  rewards: TaskReward[];
}

export type TaskMetric =
  | 'play_minutes'
  | 'highest_stage'
  | 'stages_cleared'
  | 'total_kills'
  | 'ranking_score'
  | 'characters_owned'
  | 'gifts_sent'
  | 'dialogue_chars'
  | 'dialogue_turns'
  | 'camp_events'
  | 'max_affinity'
  | 'camp_log_entries'
  | 'ai_memories'
  | 'ai_outreach_replied'
  | 'camp_game_days';

export interface TaskProgress {
  current: number;
  target: number;
  done: boolean;
}

export interface TaskContext {
  stats: PlayerStats;
  ranking: number;
}

function ctxFromSave(save: SaveData): TaskContext {
  return {
    stats: save.stats,
    ranking: rankingScore(save.stats),
  };
}

function dialogueCharCount(living: AiLivingSaveData): number {
  const ids = new Set<string>();
  for (const [id, ts] of Object.entries(living.lastTalkAt ?? {})) {
    if (ts > 0) ids.add(id);
  }
  for (const [id, turns] of Object.entries(living.recentChats ?? {})) {
    if (turns.some((t) => t.role === 'user')) ids.add(id);
  }
  return ids.size;
}

function dialogueTurnCount(living: AiLivingSaveData): number {
  if (living.totalUserDialogueTurns != null) return living.totalUserDialogueTurns;
  let n = 0;
  for (const turns of Object.values(living.recentChats ?? {})) {
    n += turns.filter((t) => t.role === 'user').length;
  }
  for (const digs of Object.values(living.chatDigests ?? {})) {
    n += digs.length * 4;
  }
  return n;
}

function maxOwnedAffinity(save: SaveData): number {
  const living = save.aiLiving;
  if (!living) return 0;
  let max = 0;
  for (const oc of save.ownedCharacters) {
    max = Math.max(max, living.affinities?.[oc.characterId] ?? 40);
  }
  return max;
}

function aiMemoryCount(living: AiLivingSaveData): number {
  let n = 0;
  for (const list of Object.values(living.memories ?? {})) {
    n += list.length;
  }
  return n;
}

function aiOutreachReplyCount(living: AiLivingSaveData): number {
  let n = 0;
  for (const stats of Object.values(living.aiMessageStats ?? {})) {
    if ((stats.lastRespondedAt ?? 0) > 0) n += 1;
  }
  return n;
}

function metricValue(metric: TaskMetric, ctx: TaskContext, save: SaveData): number {
  const living = save.aiLiving;
  switch (metric) {
    case 'play_minutes':
      return Math.floor(ctx.stats.playTimeSeconds / 60);
    case 'highest_stage':
      return ctx.stats.highestStage;
    case 'stages_cleared':
      return ctx.stats.stagesCleared;
    case 'total_kills':
      return ctx.stats.totalKills;
    case 'ranking_score':
      return ctx.ranking;
    case 'characters_owned':
      return ctx.stats.charactersOwned;
    case 'gifts_sent':
      return ctx.stats.giftsSent;
    case 'dialogue_chars':
      return living ? dialogueCharCount(living) : 0;
    case 'dialogue_turns':
      return living ? dialogueTurnCount(living) : 0;
    case 'camp_events':
      return living?.eventHistory?.length ?? 0;
    case 'max_affinity':
      return maxOwnedAffinity(save);
    case 'camp_log_entries':
      return living?.campLog?.length ?? 0;
    case 'ai_memories':
      return living ? aiMemoryCount(living) : 0;
    case 'ai_outreach_replied':
      return living ? aiOutreachReplyCount(living) : 0;
    case 'camp_game_days':
      return living?.dayIndex ?? 0;
  }
}

export function getTaskProgress(task: TaskDef, save: SaveData): TaskProgress {
  const ctx = ctxFromSave(save);
  const current = metricValue(task.metric, ctx, save);
  return {
    current: Math.min(current, task.target),
    target: task.target,
    done: current >= task.target,
  };
}

export function isTaskComplete(task: TaskDef, save: SaveData): boolean {
  return getTaskProgress(task, save).done;
}

export function isTaskClaimed(save: SaveData, taskId: string): boolean {
  return save.tasksClaimed.includes(taskId);
}

export function getClaimableTasks(save: SaveData): TaskDef[] {
  return TASKS.filter((t) => isTaskComplete(t, save) && !isTaskClaimed(save, t.id));
}

function pickCharByRarity(rarity: Rarity): string {
  const pool = CHARACTERS.filter((c) => c.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)]?.id ?? CHARACTERS[0].id;
}

function pickWeaponByRarity(rarity: WeaponRarity): string {
  const pool = WEAPONS.filter((w) => w.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)]?.id ?? WEAPONS[0].id;
}

function formatReward(reward: TaskReward): string {
  switch (reward.type) {
    case 'gold':
      return `🪙 ${reward.amount ?? 0}`;
    case 'tickets':
      return `🎫 ${reward.amount ?? 0}`;
    case 'character':
      return reward.characterId ? `角色 ${reward.characterId}` : `随机 ${reward.rarity ?? 'SR'} 角色`;
    case 'weapon':
      return reward.weaponId ? `武器 ${reward.weaponId}` : `随机 ${reward.rarity ?? 'R'} 武器`;
    case 'char_shard':
      return `角色碎片 ×${reward.amount ?? 1}`;
    case 'weapon_shard':
      return `武器碎片 ×${reward.amount ?? 1}`;
  }
}

export function describeTaskRewards(task: TaskDef): string {
  return task.rewards.map(formatReward).join(' · ');
}

function applyReward(save: SaveData, reward: TaskReward, lines: string[]): void {
  switch (reward.type) {
    case 'gold': {
      const n = reward.amount ?? 0;
      save.gold += n;
      lines.push(`🪙 锈币 +${n}`);
      break;
    }
    case 'tickets': {
      const n = reward.amount ?? 0;
      save.tickets += n;
      lines.push(`🎫 抽卡券 +${n}`);
      break;
    }
    case 'character': {
      if (reward.characterId) {
        const owned = save.ownedCharacters.some((o) => o.characterId === reward.characterId);
        if (owned) {
          addCharacterShard(save, reward.characterId, reward.amount ?? 1);
          lines.push(`重复角色转为碎片 ×${reward.amount ?? 1}`);
        } else {
          save.ownedCharacters.push({
            characterId: reward.characterId,
            weaponId: null,
            giftCount: 0,
            shardPowerBonus: 0,
          });
          if (!save.squad.includes(reward.characterId) && save.squad.length < 3) {
            save.squad.push(reward.characterId);
          }
          lines.push(`获得角色 ${reward.characterId}`);
        }
      } else {
        const rarity = (reward.rarity ?? 'SR') as Rarity;
        const charId = pickCharByRarity(rarity);
        const owned = save.ownedCharacters.some((o) => o.characterId === charId);
        if (owned) {
          addCharacterShard(save, charId, 1);
          lines.push(`获得 ${charId} 碎片 ×1`);
        } else {
          save.ownedCharacters.push({
            characterId: charId,
            weaponId: null,
            giftCount: 0,
            shardPowerBonus: 0,
          });
          if (!save.squad.includes(charId) && save.squad.length < 3) save.squad.push(charId);
          lines.push(`获得 ${charId}`);
        }
      }
      save.stats.charactersOwned = save.ownedCharacters.length;
      break;
    }
    case 'weapon': {
      const weaponId = reward.weaponId ?? pickWeaponByRarity((reward.rarity ?? 'R') as WeaponRarity);
      const w = WEAPONS.find((x) => x.id === weaponId);
      if (!w) break;
      const acquired = acquireWeapon(save, w);
      lines.push(acquired.msg);
      break;
    }
    case 'char_shard': {
      const charId = reward.characterId ?? pickCharByRarity((reward.rarity ?? 'SR') as Rarity);
      addCharacterShard(save, charId, reward.amount ?? 1);
      lines.push(`角色碎片 +${reward.amount ?? 1}`);
      break;
    }
    case 'weapon_shard': {
      const weaponId = reward.weaponId ?? pickWeaponByRarity((reward.rarity ?? 'R') as WeaponRarity);
      addWeaponShard(save, weaponId, reward.amount ?? 1);
      lines.push(`武器碎片 +${reward.amount ?? 1}`);
      break;
    }
  }
}

type TaskRewardSummary = {
  gold: number;
  tickets: number;
  charShards: number;
  weaponShards: number;
  newCharacters: number;
  duplicateCharShards: number;
  weaponDuplicates: number;
  newWeapons: string[];
};

function emptyRewardSummary(): TaskRewardSummary {
  return {
    gold: 0,
    tickets: 0,
    charShards: 0,
    weaponShards: 0,
    newCharacters: 0,
    duplicateCharShards: 0,
    weaponDuplicates: 0,
    newWeapons: [],
  };
}

function absorbRewardLine(summary: TaskRewardSummary, line: string): void {
  let m: RegExpMatchArray | null;
  if ((m = line.match(/🪙 锈币 \+(\d+)/))) {
    summary.gold += Number(m[1]);
    return;
  }
  if ((m = line.match(/🎫 抽卡券 \+(\d+)/))) {
    summary.tickets += Number(m[1]);
    return;
  }
  if ((m = line.match(/^角色碎片 \+(\d+)$/))) {
    summary.charShards += Number(m[1]);
    return;
  }
  if ((m = line.match(/^武器碎片 \+(\d+)$/))) {
    summary.weaponShards += Number(m[1]);
    return;
  }
  if ((m = line.match(/重复角色转为碎片 ×(\d+)/))) {
    summary.duplicateCharShards += Number(m[1]);
    return;
  }
  if ((m = line.match(/获得 .+ 碎片 ×(\d+)/))) {
    summary.charShards += Number(m[1]);
    return;
  }
  if (line.startsWith('获得角色 ') || line.startsWith('获得 ')) {
    summary.newCharacters += 1;
    return;
  }
  if ((m = line.match(/ 碎片 ×(\d+)$/))) {
    summary.weaponDuplicates += Number(m[1]);
    return;
  }
  if (line && !line.includes('碎片')) {
    summary.newWeapons.push(line);
  }
}

function formatRewardSummary(summary: TaskRewardSummary): string[] {
  const out: string[] = [];
  if (summary.gold > 0) out.push(`🪙 锈币 +${summary.gold}`);
  if (summary.tickets > 0) out.push(`🎫 抽卡券 +${summary.tickets}`);
  if (summary.charShards > 0) out.push(`角色碎片 ×${summary.charShards}`);
  if (summary.duplicateCharShards > 0) out.push(`重复角色转碎片 ×${summary.duplicateCharShards}`);
  if (summary.weaponShards > 0) out.push(`武器碎片 ×${summary.weaponShards}`);
  if (summary.weaponDuplicates > 0) out.push(`武器转碎片 ×${summary.weaponDuplicates}`);
  if (summary.newCharacters > 0) out.push(`获得角色 ×${summary.newCharacters}`);
  if (summary.newWeapons.length > 0) {
    const names = [...new Set(summary.newWeapons)];
    out.push(`获得武器 ×${summary.newWeapons.length}（${names.join('、')}）`);
  }
  return out;
}

export function claimTask(save: SaveData, taskId: string): { ok: boolean; msg: string; lines: string[] } {
  const task = TASK_MAP[taskId];
  if (!task) return { ok: false, msg: '任务不存在', lines: [] };
  if (isTaskClaimed(save, taskId)) return { ok: false, msg: '奖励已领取', lines: [] };
  if (!isTaskComplete(task, save)) return { ok: false, msg: '任务尚未完成', lines: [] };

  const lines: string[] = [`${task.name} · Lv.${task.level}`];
  for (const reward of task.rewards) applyReward(save, reward, lines);
  save.tasksClaimed.push(taskId);
  return { ok: true, msg: '领取成功', lines };
}

export function claimAllTasks(save: SaveData): { ok: boolean; msg: string; lines: string[] } {
  const pending = [...getClaimableTasks(save)];
  if (!pending.length) return { ok: false, msg: '暂无可领取奖励', lines: [] };

  const summary = emptyRewardSummary();
  for (const task of pending) {
    const chunk: string[] = [];
    for (const reward of task.rewards) applyReward(save, reward, chunk);
    for (const line of chunk) absorbRewardLine(summary, line);
    save.tasksClaimed.push(task.id);
  }

  const lines = [`共领取 ${pending.length} 项任务奖励`, ...formatRewardSummary(summary)];
  return { ok: true, msg: '领取成功', lines };
}

/** 分段任务：1–10 级难度递增，覆盖游玩时长 / 通关 / 积分 / 养成 */
export const TASKS: TaskDef[] = [
  // Lv.1
  { id: 't1_play', level: 1, name: '初阵报到', desc: '累计游玩 5 分钟', target: 5, metric: 'play_minutes', rewards: [{ type: 'gold', amount: 200 }] },
  { id: 't1_stage', level: 1, name: '第一次胜利', desc: '最高通关至少第 1 关', target: 1, metric: 'highest_stage', rewards: [{ type: 'gold', amount: 150 }, { type: 'tickets', amount: 1 }] },
  { id: 't1_score', level: 1, name: '锈带新秀', desc: '排行积分达到 500', target: 500, metric: 'ranking_score', rewards: [{ type: 'gold', amount: 180 }] },
  { id: 't1_chars', level: 1, name: '小队雏形', desc: '拥有 2 名角色', target: 2, metric: 'characters_owned', rewards: [{ type: 'char_shard', rarity: 'SR', amount: 2 }] },
  { id: 't1_ai_link', level: 1, name: '神经链路初接', desc: '在营地与 1 名干员完成对话', target: 1, metric: 'dialogue_chars', rewards: [{ type: 'gold', amount: 120 }] },
  { id: 't1_ai_trust', level: 1, name: '陌生频段', desc: '任一角色好感达到 42', target: 42, metric: 'max_affinity', rewards: [{ type: 'gold', amount: 100 }] },

  // Lv.2
  { id: 't2_play', level: 2, name: '持续作战', desc: '累计游玩 20 分钟', target: 20, metric: 'play_minutes', rewards: [{ type: 'gold', amount: 350 }] },
  { id: 't2_stage', level: 2, name: '战线推进', desc: '最高通关至少第 5 关', target: 5, metric: 'highest_stage', rewards: [{ type: 'gold', amount: 400 }, { type: 'weapon_shard', rarity: 'N', amount: 2 }] },
  { id: 't2_kills', level: 2, name: '猎杀入门', desc: '累计击杀 80 个敌人', target: 80, metric: 'total_kills', rewards: [{ type: 'gold', amount: 300 }] },
  { id: 't2_score', level: 2, name: '积分攀升', desc: '排行积分达到 1500', target: 1500, metric: 'ranking_score', rewards: [{ type: 'tickets', amount: 1 }] },
  { id: 't2_ai_ping', level: 2, name: '频段应答', desc: '累计发送 8 条营地对话', target: 8, metric: 'dialogue_turns', rewards: [{ type: 'gold', amount: 220 }] },
  { id: 't2_ai_log', level: 2, name: '澪的简报', desc: '营地日志累计 3 条', target: 3, metric: 'camp_log_entries', rewards: [{ type: 'gold', amount: 180 }] },

  // Lv.3
  { id: 't3_play', level: 3, name: '驻场训练', desc: '累计游玩 45 分钟', target: 45, metric: 'play_minutes', rewards: [{ type: 'gold', amount: 500 }] },
  { id: 't3_stage', level: 3, name: '深入锈带', desc: '最高通关至少第 10 关', target: 10, metric: 'highest_stage', rewards: [{ type: 'gold', amount: 600 }, { type: 'char_shard', rarity: 'SR', amount: 3 }] },
  { id: 't3_cleared', level: 3, name: '清剿记录', desc: '累计通关 8 个关卡', target: 8, metric: 'stages_cleared', rewards: [{ type: 'weapon', rarity: 'R' }] },
  { id: 't3_score', level: 3, name: '战术评估', desc: '排行积分达到 3000', target: 3000, metric: 'ranking_score', rewards: [{ type: 'gold', amount: 550 }] },
  { id: 't3_ai_squad', level: 3, name: '编队内讯', desc: '与 2 名干员建立对话链路', target: 2, metric: 'dialogue_chars', rewards: [{ type: 'char_shard', rarity: 'SR', amount: 2 }] },
  { id: 't3_ai_mem', level: 3, name: '记忆切片', desc: '累计沉淀 6 条 AI 记忆', target: 6, metric: 'ai_memories', rewards: [{ type: 'gold', amount: 320 }] },

  // Lv.4
  { id: 't4_play', level: 4, name: '长期部署', desc: '累计游玩 90 分钟', target: 90, metric: 'play_minutes', rewards: [{ type: 'gold', amount: 800 }, { type: 'tickets', amount: 1 }] },
  { id: 't4_stage', level: 4, name: '章节突破', desc: '最高通关至少第 16 关', target: 16, metric: 'highest_stage', rewards: [{ type: 'character', rarity: 'SR' }] },
  { id: 't4_kills', level: 4, name: '机兵克星', desc: '累计击杀 400 个敌人', target: 400, metric: 'total_kills', rewards: [{ type: 'weapon_shard', rarity: 'R', amount: 3 }] },
  { id: 't4_gifts', level: 4, name: '记忆馈赠', desc: '累计送礼 5 次', target: 5, metric: 'gifts_sent', rewards: [{ type: 'gold', amount: 400 }] },
  { id: 't4_ai_bond', level: 4, name: '信任协议', desc: '任一角色好感达到 50', target: 50, metric: 'max_affinity', rewards: [{ type: 'tickets', amount: 1 }] },
  { id: 't4_ai_event', level: 4, name: '营地协约', desc: '参与 1 次营地随机事件', target: 1, metric: 'camp_events', rewards: [{ type: 'gold', amount: 450 }] },

  // Lv.5
  { id: 't5_play', level: 5, name: '废土老兵', desc: '累计游玩 150 分钟', target: 150, metric: 'play_minutes', rewards: [{ type: 'gold', amount: 1200 }] },
  { id: 't5_stage', level: 5, name: '双章连战', desc: '最高通关至少第 20 关', target: 20, metric: 'highest_stage', rewards: [{ type: 'tickets', amount: 2 }, { type: 'char_shard', rarity: 'SSR', amount: 1 }] },
  { id: 't5_score', level: 5, name: '指挥评级 A', desc: '排行积分达到 8000', target: 8000, metric: 'ranking_score', rewards: [{ type: 'weapon', rarity: 'E' }] },
  { id: 't5_chars', level: 5, name: '收藏家', desc: '拥有 6 名角色', target: 6, metric: 'characters_owned', rewards: [{ type: 'gold', amount: 1000 }] },
  { id: 't5_ai_deep', level: 5, name: '深度通讯', desc: '累计发送 25 条营地对话', target: 25, metric: 'dialogue_turns', rewards: [{ type: 'char_shard', rarity: 'SR', amount: 3 }] },
  { id: 't5_ai_day', level: 5, name: '驻营日程', desc: '营地度过 3 个游戏日', target: 3, metric: 'camp_game_days', rewards: [{ type: 'gold', amount: 600 }] },

  // Lv.6
  { id: 't6_play', level: 6, name: '持久战线', desc: '累计游玩 240 分钟', target: 240, metric: 'play_minutes', rewards: [{ type: 'gold', amount: 1600 }] },
  { id: 't6_stage', level: 6, name: '第三章门槛', desc: '最高通关至少第 24 关', target: 24, metric: 'highest_stage', rewards: [{ type: 'char_shard', rarity: 'SSR', amount: 2 }] },
  { id: 't6_kills', level: 6, name: '千人斩', desc: '累计击杀 1000 个敌人', target: 1000, metric: 'total_kills', rewards: [{ type: 'weapon_shard', rarity: 'E', amount: 2 }] },
  { id: 't6_cleared', level: 6, name: '通关大师', desc: '累计通关 25 个关卡', target: 25, metric: 'stages_cleared', rewards: [{ type: 'tickets', amount: 2 }] },
  { id: 't6_ai_reply', level: 6, name: '主动联络', desc: '回应 1 次干员主动来信', target: 1, metric: 'ai_outreach_replied', rewards: [{ type: 'gold', amount: 500 }] },
  { id: 't6_ai_archive', level: 6, name: '椿的档案', desc: '累计沉淀 20 条 AI 记忆', target: 20, metric: 'ai_memories', rewards: [{ type: 'weapon_shard', rarity: 'R', amount: 2 }] },

  // Lv.7
  { id: 't7_play', level: 7, name: '锈带常驻', desc: '累计游玩 360 分钟', target: 360, metric: 'play_minutes', rewards: [{ type: 'gold', amount: 2200 }] },
  { id: 't7_stage', level: 7, name: '第四章先锋', desc: '最高通关至少第 32 关', target: 32, metric: 'highest_stage', rewards: [{ type: 'character', rarity: 'SSR' }] },
  { id: 't7_score', level: 7, name: '指挥评级 S', desc: '排行积分达到 15000', target: 15000, metric: 'ranking_score', rewards: [{ type: 'weapon_shard', rarity: 'L', amount: 1 }] },
  { id: 't7_gifts', level: 7, name: '羁绊加深', desc: '累计送礼 15 次', target: 15, metric: 'gifts_sent', rewards: [{ type: 'gold', amount: 800 }, { type: 'char_shard', rarity: 'SR', amount: 5 }] },
  { id: 't7_ai_oath', level: 7, name: '誓约阈值', desc: '任一角色好感达到 65', target: 65, metric: 'max_affinity', rewards: [{ type: 'tickets', amount: 1 }] },
  { id: 't7_ai_brief', level: 7, name: '全员简报', desc: '与 4 名干员建立对话链路', target: 4, metric: 'dialogue_chars', rewards: [{ type: 'gold', amount: 900 }] },

  // Lv.8
  { id: 't8_play', level: 8, name: '纪元见证者', desc: '累计游玩 480 分钟', target: 480, metric: 'play_minutes', rewards: [{ type: 'gold', amount: 3000 }, { type: 'tickets', amount: 3 }] },
  { id: 't8_stage', level: 8, name: '逼近终局', desc: '最高通关至少第 36 关', target: 36, metric: 'highest_stage', rewards: [{ type: 'weapon', rarity: 'L' }] },
  { id: 't8_kills', level: 8, name: '毁灭统计', desc: '累计击杀 2500 个敌人', target: 2500, metric: 'total_kills', rewards: [{ type: 'weapon_shard', rarity: 'E', amount: 4 }] },
  { id: 't8_chars', level: 8, name: '全员集结', desc: '拥有 10 名角色', target: 10, metric: 'characters_owned', rewards: [{ type: 'char_shard', rarity: 'UR', amount: 1 }] },
  { id: 't8_ai_chronicle', level: 8, name: '营地编年', desc: '完成 4 次营地随机事件', target: 4, metric: 'camp_events', rewards: [{ type: 'gold', amount: 1200 }] },
  { id: 't8_ai_signal', level: 8, name: '情报主频', desc: '累计发送 60 条营地对话', target: 60, metric: 'dialogue_turns', rewards: [{ type: 'char_shard', rarity: 'SSR', amount: 2 }] },

  // Lv.9
  { id: 't9_play', level: 9, name: '无尽巡逻', desc: '累计游玩 600 分钟', target: 600, metric: 'play_minutes', rewards: [{ type: 'gold', amount: 4000 }] },
  { id: 't9_stage', level: 9, name: '终章前夜', desc: '最高通关至少第 38 关', target: 38, metric: 'highest_stage', rewards: [{ type: 'tickets', amount: 3 }, { type: 'char_shard', rarity: 'SSR', amount: 3 }] },
  { id: 't9_score', level: 9, name: '传奇指挥', desc: '排行积分达到 30000', target: 30000, metric: 'ranking_score', rewards: [{ type: 'character', rarity: 'SSR' }] },
  { id: 't9_cleared', level: 9, name: '全图扫荡', desc: '累计通关 35 个关卡', target: 35, metric: 'stages_cleared', rewards: [{ type: 'gold', amount: 3500 }] },
  { id: 't9_ai_hub', level: 9, name: '指挥部档案', desc: '营地日志累计 25 条', target: 25, metric: 'camp_log_entries', rewards: [{ type: 'tickets', amount: 2 }] },
  { id: 't9_ai_outreach', level: 9, name: '铃的来电', desc: '回应 3 名干员的主动来信', target: 3, metric: 'ai_outreach_replied', rewards: [{ type: 'gold', amount: 1500 }] },

  // Lv.10
  { id: 't10_play', level: 10, name: '锈带传说', desc: '累计游玩 900 分钟', target: 900, metric: 'play_minutes', rewards: [{ type: 'gold', amount: 6000 }, { type: 'tickets', amount: 5 }] },
  { id: 't10_stage', level: 10, name: '纪元终结', desc: '通关全部 40 关', target: 40, metric: 'highest_stage', rewards: [{ type: 'character', rarity: 'UR' }, { type: 'gold', amount: 5000 }] },
  { id: 't10_kills', level: 10, name: '终末清道夫', desc: '累计击杀 5000 个敌人', target: 5000, metric: 'total_kills', rewards: [{ type: 'weapon', rarity: 'L' }, { type: 'weapon_shard', rarity: 'L', amount: 3 }] },
  { id: 't10_score', level: 10, name: '排行榜顶点', desc: '排行积分达到 50000', target: 50000, metric: 'ranking_score', rewards: [{ type: 'tickets', amount: 5 }, { type: 'char_shard', rarity: 'UR', amount: 2 }] },
  { id: 't10_ai_core', level: 10, name: '神经中枢', desc: '与 8 名干员建立对话链路', target: 8, metric: 'dialogue_chars', rewards: [{ type: 'character', rarity: 'SSR' }] },
  { id: 't10_ai_soul', level: 10, name: '生死与共', desc: '任一角色好感达到 85', target: 85, metric: 'max_affinity', rewards: [{ type: 'gold', amount: 3000 }, { type: 'weapon_shard', rarity: 'L', amount: 2 }] },
];

export const TASK_MAP = Object.fromEntries(TASKS.map((t) => [t.id, t]));
