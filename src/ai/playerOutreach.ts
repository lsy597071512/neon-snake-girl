/**
 * 角色主动找玩家发消息（AI 消息事件）
 *
 * - 仅在主页立绘界面且非战斗时由上层轮询评估
 * - 是否发送、内容、频率由当前行为 + LLM（优先 life 通道）综合判断
 * - 多人待处理时玩家点选一人；其余取消；多次不理降好感并影响后续行为
 */
import { CHARACTER_MAP } from '../data/characters';
import { saveManager } from '../core/SaveManager';
import {
  describeAgendaForPrompt,
  getAgenda,
  isAgendaActive,
  isProtectedAgenda,
  setAgenda,
} from './characterAgenda';
import { listActiveCampEventsForUi } from './campEvents';
import { getPersona, evolvePersonaAfterTalk } from './characterPersona';
import { applyMoodImpulse, describeMoodContinuumForPrompt, getMoodSnapshot } from './moodContinuum';
import { chatJsonRouted, hasDialogueApiKey, hasLifePathApiKey } from './llmRouter';
import { resolvePresence } from './livingState';
import { getRecentChatLines, pushCampLog, pushMemory, pushRecentChat } from './memory';
import { adjustAffinity, getAffinity } from './relationship';
import { formatGameClock, describeTimeScale } from './worldClock';
import { proactiveContactBlockReason } from './sleepSystem';
import { buildLiveCharacterSnapshot, liveCharacterSnapshotToPromptBlock } from './characterLiveSnapshot';
import { computeDesires } from './characterDesires';
import { ensureLifeGoal, lifeGoalProgressLine } from './lifeGoals';
import type {
  AiLivingSave,
  AiMessageEvent,
  AiMessageKind,
  AiMessageOutreachStats,
  CharacterAgenda,
  CharacterActivity,
} from './types';

/** 全局评估间隔（现实毫秒） */
const EVAL_COOLDOWN_MS = 45_000;
/** 单条消息未点开存活时间 */
const MSG_TTL_MS = 3.5 * 60_000;
/** 同时最多几条待处理 */
const MAX_PENDING = 3;
/** 同角色两次主动消息的最短间隔 */
const CHAR_COOLDOWN_MS = 2.5 * 60_000;
/** 刚与玩家对谈结束后的静默期（避免答应办事后立刻另起话题） */
const POST_TALK_QUIET_MS = 12 * 60_000;
/** 未回应连击达到此值后加重好感扣分 */
const UNANSWERED_STREAK_SOFT = 2;

type LlmOutreachDecision = {
  should_send?: boolean;
  kind?: string;
  preview?: string;
  opening?: string;
  action?: string;
  inner_thought?: string;
  reason?: string;
  significance?: number;
};

function ensureQueues(living: AiLivingSave): void {
  if (!living.pendingAiMessages) living.pendingAiMessages = [];
  if (!living.aiMessageStats) living.aiMessageStats = {};
  if (living.lastPlayerOutreachEvalAt == null) living.lastPlayerOutreachEvalAt = 0;
}

function getStats(living: AiLivingSave, characterId: string): AiMessageOutreachStats {
  ensureQueues(living);
  const cur = living.aiMessageStats![characterId];
  if (cur) return cur;
  const fresh: AiMessageOutreachStats = {
    unansweredCount: 0,
    lastOutreachAt: 0,
    lastRespondedAt: 0,
  };
  living.aiMessageStats![characterId] = fresh;
  return fresh;
}

function newMessageId(): string {
  return `om_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function clampSig(n: number | undefined): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 2;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function normalizeKind(raw: string | undefined): AiMessageKind {
  const k = (raw ?? 'chat').toLowerCase();
  if (k === 'ask_help' || k === 'help' || k === '求助') return 'ask_help';
  if (k === 'share' || k === '分享') return 'share';
  if (k === 'invite' || k === '邀请') return 'invite';
  if (k === 'vent' || k === '倾诉') return 'vent';
  if (k === 'report' || k === '汇报') return 'report';
  return 'chat';
}

/** 过期未处理的消息 → ignored，记录扣分 */
export function expireStaleAiMessages(living: AiLivingSave, now = Date.now()): number {
  ensureQueues(living);
  let n = 0;
  for (const msg of living.pendingAiMessages!) {
    if (msg.status !== 'pending') continue;
    if (now < msg.expiresAt) continue;
    applyUnansweredOutcome(living, msg, 'expired');
    n += 1;
  }
  // 清理很旧的终态记录，只留最近 12 条
  living.pendingAiMessages = living.pendingAiMessages!.filter((m) => {
    if (m.status === 'pending') return true;
    return now - m.createdAt < 30 * 60_000;
  });
  if (living.pendingAiMessages.length > 12) {
    living.pendingAiMessages = living.pendingAiMessages.slice(-12);
  }
  return n;
}

/**
 * 离线期间到期的消息：指挥官不在场，不算「被无视」——不扣好感。
 * 只留一条「你不在，她等了很久」的记忆，随后按 cancelled 清理。
 */
export function expireMessagesWhileOffline(living: AiLivingSave, now = Date.now()): number {
  ensureQueues(living);
  let n = 0;
  for (const msg of living.pendingAiMessages!) {
    if (msg.status !== 'pending') continue;
    if (now < msg.expiresAt) continue;
    msg.status = 'cancelled';
    n += 1;
    pushMemory(living, msg.characterId, {
      kind: 'outreach_ignored',
      summary: `指挥官离线期间她发过「${msg.preview}」，等不到回音（不算被无视，不扣好感）`,
      importance: 3,
    });
    pushCampLog(living, {
      text: `${CHARACTER_MAP[msg.characterId]?.name ?? msg.characterId} 的消息在指挥官离线期间过期（不作扣分）`,
      source: 'system',
      characterIds: [msg.characterId],
    });
  }
  return n;
}

/**
 * 离线模拟出的「她给你留的话」：以刚收到的形式投递，TTL 正常计算。
 * 内容由规则模板生成，不经过 LLM。
 */
export function enqueueOfflineOutreach(
  living: AiLivingSave,
  characterId: string,
  text: string,
  now = Date.now(),
): boolean {
  ensureQueues(living);
  const preview = text.trim().slice(0, 36);
  if (!preview) return false;
  const presence = resolvePresence(characterId, living);
  const msg: AiMessageEvent = {
    messageId: newMessageId(),
    characterId,
    status: 'pending',
    kind: 'chat',
    preview,
    openingDialogue: text.trim().slice(0, 160),
    reason: '指挥官离线期间想找你说话',
    significance: 2,
    createdAt: now,
    expiresAt: now + MSG_TTL_MS,
    contextSummary: `离线期间留的话｜${presence.behavior}`,
    offlineSent: true,
  };
  living.pendingAiMessages!.push(msg);
  pushCampLog(living, {
    text: `${CHARACTER_MAP[characterId]?.name ?? characterId} 在你离线时给你留了话：「${preview}」`,
    source: 'system',
    characterIds: [characterId],
  });
  return true;
}

export function listPendingAiMessages(living: AiLivingSave, now = Date.now()): AiMessageEvent[] {
  ensureQueues(living);
  expireStaleAiMessages(living, now);
  for (const msg of living.pendingAiMessages!) {
    if (msg.status !== 'pending') continue;
    if (proactiveContactBlockReason(living, msg.characterId)) {
      msg.status = 'cancelled';
    }
  }
  return living.pendingAiMessages!.filter((m) => m.status === 'pending' && now < m.expiresAt);
}

function hardBlockReason(
  living: AiLivingSave,
  characterId: string,
  activity: CharacterActivity,
): string | null {
  const sleepBlock = proactiveContactBlockReason(living, characterId);
  if (sleepBlock) return sleepBlock;
  if (activity === 'sleeping') return '正在睡觉，不该发消息';
  if (activity === 'bathe') return '正在洗浴，不方便发消息';
  // 独占玩法事件进行中：人正在跳舞/安抚/帮洗，不会同时摸出手机找你
  if (living.danceSession?.active && living.danceSession.characterId === characterId) {
    return '正在舞蹈事件中，不会主动发消息';
  }
  if (living.anfuSession?.active && living.anfuSession.characterId === characterId) {
    return '正在安抚室，不会主动发消息';
  }
  if (
    living.bathAssistSession?.active &&
    living.bathAssistSession.characterId === characterId
  ) {
    return '正在浴室互动中，不会主动发消息';
  }
  return null;
}

function localEligibility(
  living: AiLivingSave,
  characterId: string,
  now: number,
): { ok: boolean; note: string } {
  const presence = resolvePresence(characterId, living);
  const hard = hardBlockReason(living, characterId, presence.activity);
  if (hard) return { ok: false, note: hard };

  const lastTalk = living.lastTalkAt?.[characterId] ?? 0;
  if (lastTalk > 0 && now - lastTalk < POST_TALK_QUIET_MS) {
    return { ok: false, note: '刚与指挥官对谈结束，先办事/消化，不另起话题' };
  }

  const agenda = getAgenda(living, characterId);
  if (isProtectedAgenda(living, agenda) && agenda?.source === 'player_task') {
    return { ok: false, note: '正在执行指挥官交代的事，禁止另开无关主动消息' };
  }

  const pending = listPendingAiMessages(living, now);
  if (pending.some((m) => m.characterId === characterId)) {
    return { ok: false, note: '已有待处理消息' };
  }
  if (pending.length >= MAX_PENDING) {
    return { ok: false, note: '队列已满' };
  }

  const stats = getStats(living, characterId);
  if (stats.lastOutreachAt > 0 && now - stats.lastOutreachAt < CHAR_COOLDOWN_MS) {
    return { ok: false, note: '个人冷却中' };
  }

  return { ok: true, note: `${presence.behavior}；活动=${presence.activity}` };
}

function buildContextBlock(living: AiLivingSave, characterId: string): string {
  const save = saveManager.get();
  const snap = buildLiveCharacterSnapshot(characterId, save, living);
  const presence = resolvePresence(characterId, living);
  const agenda = describeAgendaForPrompt(living, characterId);
  const persona = getPersona(living, characterId);
  const events = listActiveCampEventsForUi(living)
    .slice(0, 3)
    .map((e) => `- ${e.name}（${e.phase}）@ ${e.focusLabel}`)
    .join('\n');
  const stats = getStats(living, characterId);
  const affinity = getAffinity(living, characterId);
  const goalLine = lifeGoalProgressLine(living, characterId);
  const desireTop = computeDesires(living, characterId).topLine;

  return [
    snap ? liveCharacterSnapshotToPromptBlock(snap) : '',
    `【此刻行为】${presence.label}｜${presence.behavior}｜activity=${presence.activity}`,
    `【意图】${agenda}`,
    persona
      ? `【今日模式】${persona.dayMode}｜心情：${persona.moodNote}｜计划：${persona.dayPlan}`
      : '',
    describeMoodContinuumForPrompt(living, characterId),
    `【人生目标】${goalLine}`,
    `【当前欲望】${desireTop}`,
    `【对玩家好感】${affinity}/100；近期未回应主动消息连击 ${stats.unansweredCount}`,
    events ? `【进行中营地事件】\n${events}` : '【进行中营地事件】无',
    `【游戏时间】${formatGameClock(living)}（${describeTimeScale()}）`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function decideOutreachWithLlm(
  living: AiLivingSave,
  characterId: string,
): Promise<LlmOutreachDecision | null> {
  const presence = resolvePresence(characterId, living);
  const hard = hardBlockReason(living, characterId, presence.activity);
  if (hard) {
    return { should_send: false, reason: hard, significance: 1 };
  }

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const system = `你是锈带纪元营地角色「${name}」的内心决策器。
根据她当前在做什么、情绪、事件与对玩家（指挥官）关系，判断「此刻是否主动给玩家发一条消息」。
她对指挥官有感情因素，是羁绊团队一员；主动消息可以是关心、吃味、分享生活，也可以是求助——但必须像「这个人」而不是无感系统通知。
指挥官是矮小废弃机器人（默认按男性「他」理解）；玩家未开游戏时他沉睡离线——主动消息是「他上线后能在主页看到」，不是他离线时还在院里陪你。

硬规则（必须遵守）：
1. 睡觉、洗浴 → should_send=false。
2. 正在专注修理/维护/忙碌，且没有突发问题/求助动机 → 通常 should_send=false（不要为了聊天打断专注）。
3. 若专注中发现故障、缺零件、害怕、想汇报、需要玩家拍板 → 可以 should_send=true，kind 多为 ask_help / report。
4. 闲着、玩乐、歇息、社交日模式 → 可以闲聊 chat / share / invite（可带一点想靠近指挥官的气味）。
5. 心情差或吃醋 → 可 vent，但要克制、口语、像真人。
6. significance 1–5：闲聊 1–2；求助/汇报 3–4；重大情绪/危机 5。
7. preview ≤28 字；opening ≤90 字；reason 用中文写清「为什么此刻发」。
8. 【禁止复读】opening 禁止与「近期已发过的主动消息」雷同或同句改写；禁止「在主页干站着」这类元游戏口吻；要像此刻才想起来的一句新话。
9. 【刚对谈连续性】若【近窗对话】里她刚答应指挥官去办事（拿东西/去商店等），should_send=false；禁止立刻另开无关话题（娱乐间旧芯、门口风速等借口都不行）。只有任务进度相关（拿到了/缺货/路上出事）才允许发。
10. 【意图锁定】若【意图】写明「办理指挥官交代的事」，should_send=false，除非 opening 明确汇报该任务进度。

只输出 JSON：
{"should_send":false,"kind":"chat","preview":"","opening":"","action":"","inner_thought":"","reason":"","significance":2}`;

  const recentOpenings = listRecentOpenings(living, characterId);
  const recentChat = getRecentChatLines(living, characterId).slice(-8);
  const user = `${buildContextBlock(living, characterId)}

【近窗对话】（刚聊过的内容，主动消息必须连贯，禁止话题硬切）
${recentChat.length ? recentChat.join('\n') : '（无）'}

【近期已发过的主动开场（禁止再写成同一句）】
${recentOpenings.length ? recentOpenings.map((o, i) => `${i + 1}. ${o}`).join('\n') : '（无）'}

请综合判断：要不要现在给玩家发消息？若发，写一句全新的开场。`;

  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];

  // life 通道（qwen-plus）→ 失败再 dialogue 通道 → 都失败才交给本地模板
  if (!hasLifePathApiKey() && !hasDialogueApiKey()) return null;

  if (hasLifePathApiKey()) {
    try {
      return await chatJsonRouted<LlmOutreachDecision>(messages, {
        channel: 'life',
        maxTokens: 420,
        temperature: 0.75,
        timeoutMs: 12000,
      });
    } catch {
      /* fall through to Qwen dialogue */
    }
  }

  if (hasDialogueApiKey()) {
    try {
      return await chatJsonRouted<LlmOutreachDecision>(messages, {
        channel: 'dialogue',
        maxTokens: 420,
        temperature: 0.75,
        timeoutMs: 20000,
      });
    } catch {
      return null;
    }
  }

  return null;
}

/** 无 LLM 时的本地启发式（多模板，避免复读） */
function decideOutreachLocal(
  living: AiLivingSave,
  characterId: string,
): LlmOutreachDecision {
  const presence = resolvePresence(characterId, living);
  const hard = hardBlockReason(living, characterId, presence.activity);
  if (hard) {
    return { should_send: false, reason: hard, significance: 1 };
  }

  const agenda = getAgenda(living, characterId);
  if (isProtectedAgenda(living, agenda) && agenda?.source === 'player_task') {
    return {
      should_send: false,
      reason: '正在执行指挥官交代的事，不另开无关主动消息',
      significance: 1,
    };
  }

  const persona = getPersona(living, characterId);
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const roll = Math.random();
  const mode = persona?.dayMode ?? 'dutiful';
  const recent = listRecentOpenings(living, characterId);

  // 专注维护：多数不发；小概率因故障求助
  if (presence.activity === 'maintain' || presence.activity === 'busy' || presence.activity === 'guard') {
    if (roll < 0.18) {
      const helpPool = [
        {
          preview: '这边有点不对劲…',
          opening: `${name}的通讯跳了两下：「你在吗？我这边搞到一半，有个地方拿不准。」`,
          action: '擦了擦手上的油渍，盯着通讯等回音',
          inner_thought: '自己能搞定最好……但拖下去会更糟',
        },
        {
          preview: '缺个意见',
          opening: `${name}：「顺手问一句——这个接头你觉得该拧死还是留余量？我卡住了。」`,
          action: '把零件举到灯下又放下',
          inner_thought: '问他也比瞎拧强',
        },
        {
          preview: '别挂',
          opening: `${name}压低声音：「别挂。仪表跳了一下，我想让你听我说完再决定。」`,
          action: '耳机线绕在手指上绷紧',
          inner_thought: '真出事的话，得有人知道',
        },
      ];
      const pick = pickFreshTemplate(helpPool, recent, characterId, living.dayIndex + 11);
      return {
        should_send: true,
        kind: 'ask_help',
        ...pick,
        reason: `正在「${presence.behavior}」时遇到拿不准的问题，需要玩家意见`,
        significance: 3,
      };
    }
    return {
      should_send: false,
      reason: `正专注于「${presence.behavior}」，不宜闲聊`,
      significance: 1,
    };
  }

  if (presence.activity === 'eat' && roll > 0.35) {
    return { should_send: false, reason: '正在用餐', significance: 1 };
  }

  const socialBoost =
    mode === 'social' || mode === 'playful' || mode === 'restless' || mode === 'idle' ? 0.22 : 0;
  const base =
    presence.activity === 'play' || presence.activity === 'rest' || presence.activity === 'idle'
      ? 0.28
      : 0.12;
  // 欲望/人生目标抬升「想找指挥官」的冲动（体感：活着才会来找你）
  const desire = computeDesires(living, characterId);
  const goal = ensureLifeGoal(living, characterId);
  const goalPct = goal.progress / Math.max(1, goal.target);
  const desireBoost =
    Math.max(desire.scores.social, desire.scores.shop, desire.scores.swim) >= 48 ? 0.14 : 0;
  const goalBoost = goalPct >= 0.55 ? 0.16 : goalPct >= 0.3 ? 0.08 : 0;
  const giftHunger = goal.kind === 'gift_bond' && goalPct < 0.7 ? 0.1 : 0;
  if (roll > base + socialBoost + desireBoost + goalBoost + giftHunger) {
    return { should_send: false, reason: '此刻没有找玩家的冲动', significance: 1 };
  }

  // 人生目标过半：优先用「惦记目标」开场，而不是纯闲聊
  if (goalPct >= 0.45 && roll < 0.55) {
    const goalPool = [
      {
        preview: '有件事…',
        opening: `${name}：「${goal.text.replace(/^[^：:]+[：:]/, '').slice(0, 36)}——你最近有空搭把手吗。」`,
        action: '通讯那头停了一拍，像在斟酌要不要显得太急',
        inner_thought: `进度已经到 ${Math.round(goalPct * 100)}% 了，不想再自己憋着`,
      },
      {
        preview: '惦记着',
        opening: `${name}：「不是闲聊。我想把那件事往前推一点，你在的话听我说完。」`,
        action: '把通讯屏亮度拧高了一格',
        inner_thought: lifeGoalProgressLine(living, characterId),
      },
    ];
    const pick = pickFreshTemplate(goalPool, recent, characterId, living.dayIndex + 19);
    return {
      should_send: true,
      kind: goal.kind === 'gift_bond' ? 'chat' : 'ask_help',
      ...pick,
      reason: `人生目标推进中（${Math.round(goalPct * 100)}%），主动找指挥官`,
      significance: 3,
    };
  }

  // 心情连续体差（与 withdrawn 正交）：优先 vent 池——低落时也会主动找人，但语气偏闷
  const moodNow = getMoodSnapshot(living, characterId);
  if (moodNow.valence <= -40) {
    const ventPool = [
      {
        preview: '……在吗',
        opening: `通讯里只有很轻的一声：「……你忙吗。没事的话，陪我说两句也行。」`,
        action: '把通讯屏幕亮度调得很低',
        inner_thought: '心里有点堵，想找个人待一会儿',
      },
      {
        preview: '说不上来',
        opening: `${name}：「不是什么大事……就是心里闷。你听着就行，不用回话。」`,
        action: '吸了口气才把消息发出去',
        inner_thought: '说出来可能会好一点',
      },
      {
        preview: '想找你说说',
        opening: `${name}：「今天不太顺。你那边……方便听我嘟囔两句吗。」`,
        action: '抱着膝盖坐在床沿等回音',
        inner_thought: '只有他不会笑我这样',
      },
    ];
    const pick = pickFreshTemplate(ventPool, recent, characterId, living.dayIndex + 23);
    return {
      should_send: true,
      kind: 'vent',
      ...pick,
      reason: `心情「${moodNow.labelZh}」（valence 偏低），想找指挥官倾诉`,
      significance: 3,
    };
  }

  if (mode === 'withdrawn') {
    const ventPool = [
      {
        preview: '……在吗',
        opening: `通讯里只有很轻的一声：「……你忙吗。没事的话，陪我说两句也行。」`,
        action: '把通讯屏幕亮度调得很低',
        inner_thought: '其实也没什么大事',
      },
      {
        preview: '随便问问',
        opening: `${name}：「你还在就回一下。不用长聊。」`,
        action: '拇指悬在发送上停了两秒',
        inner_thought: '确认他还在就够了',
      },
    ];
    const pick = pickFreshTemplate(ventPool, recent, characterId, living.dayIndex + 3);
    return {
      should_send: true,
      kind: 'vent',
      ...pick,
      reason: `当前较空闲（${presence.behavior}），今日模式 withdrawn`,
      significance: 3,
    };
  }

  const eventBit = isAgendaActive(agenda) && agenda?.eventInstanceId;
  const chatPool = [
    {
      preview: '有空吗？',
      opening: `${name}：「在吗。路过想听你说两句，别装忙。」`,
      action: '靠着墙，通讯贴在耳边',
      inner_thought: persona?.moodNote || '想听听他的声音',
    },
    {
      preview: '聊两句',
      opening: `${name}：「热水还够。你要是闲着，过来站一会儿。」`,
      action: '用靴尖点了点地面',
      inner_thought: '有人回应就不那么空',
    },
    {
      preview: '醒着没',
      opening: `${name}：「醒着就回。我刚巡完一圈，嘴里闷得慌。」`,
      action: '摘下半边护目，眨眼适应灯光',
      inner_thought: '随便找个由头而已',
    },
    {
      preview: '报个到',
      opening: `${name}：「报个到就行。你人还在营地吧？」`,
      action: '盯着通讯列表里的头像',
      inner_thought: '确认位置比闲聊重要',
    },
    {
      preview: eventBit ? '跟眼前的事有关' : '想起你了',
      opening: eventBit
        ? `${name}：「眼前这事我想跟你对一下口径，别让旁人乱传。」`
        : `${name}：「忽然想到你。别多想，就是突然。」`,
      action: '把话在嘴里过了一遍才发出去',
      inner_thought: eventBit ? '得先稳住说法' : '发出去又有点后悔',
    },
  ];
  const pick = pickFreshTemplate(chatPool, recent, characterId, living.dayIndex + 7);
  return {
    should_send: true,
    kind: 'chat',
    ...pick,
    reason: `当前较空闲（${presence.behavior}），今日模式 ${mode}，想找玩家说话`,
    significance: 2,
  };
}

function normalizeOpeningKey(text: string): string {
  return text
    .replace(/「|」|"|“|”/g, '')
    .replace(/\s+/g, '')
    .slice(0, 48);
}

function listRecentOpenings(living: AiLivingSave, characterId: string): string[] {
  ensureQueues(living);
  const fromQueue = (living.pendingAiMessages ?? [])
    .filter((m) => m.characterId === characterId)
    .map((m) => m.openingDialogue)
    .filter(Boolean);
  const fromMem = (living.memories?.[characterId] ?? [])
    .filter((m) => m.kind === 'outreach')
    .map((m) => m.summary)
    .filter(Boolean);
  const fromChat = (living.recentChats?.[characterId] ?? [])
    .filter((m) => m.role === 'assistant')
    .map((m) => m.text)
    .slice(-4);
  return [...fromQueue, ...fromMem, ...fromChat].slice(-8);
}

function isTooSimilarOpening(candidate: string, recent: string[]): boolean {
  const key = normalizeOpeningKey(candidate);
  if (key.length < 8) return false;
  return recent.some((r) => {
    const rk = normalizeOpeningKey(r);
    if (!rk) return false;
    if (key === rk) return true;
    if (key.includes(rk.slice(0, 16)) || rk.includes(key.slice(0, 16))) return true;
    // 关键烂梗硬拦
    if (/在主页干站着/.test(candidate) && /在主页干站着/.test(r)) return true;
    return false;
  });
}

type LocalLine = {
  preview: string;
  opening: string;
  action: string;
  inner_thought: string;
};

function pickFreshTemplate(
  pool: LocalLine[],
  recent: string[],
  characterId: string,
  salt: number,
): LocalLine {
  const fresh = pool.filter((p) => !isTooSimilarOpening(p.opening, recent));
  const use = fresh.length ? fresh : pool;
  const idx = Math.floor(hash01(characterId, salt) * use.length + Math.random() * 0.999) % use.length;
  return use[idx] ?? use[0];
}

function hash01(characterId: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < characterId.length; i++) h = (h * 31 + characterId.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function sanitizeDecision(
  living: AiLivingSave,
  characterId: string,
  decision: LlmOutreachDecision,
): LlmOutreachDecision {
  if (!decision.should_send) return decision;
  const recent = listRecentOpenings(living, characterId);
  const opening = (decision.opening || '').trim();
  if (!opening || isTooSimilarOpening(opening, recent) || /在主页干站着/.test(opening)) {
    // LLM 复读或元游戏口吻 → 改走本地多模板
    const local = decideOutreachLocal(living, characterId);
    if (local.should_send) return local;
    return { should_send: false, reason: '开场与近期重复，本拍取消', significance: 1 };
  }
  return decision;
}

function enqueueMessage(
  living: AiLivingSave,
  characterId: string,
  decision: LlmOutreachDecision,
  now: number,
): AiMessageEvent | null {
  if (!decision.should_send) return null;
  const cleaned = sanitizeDecision(living, characterId, decision);
  if (!cleaned.should_send) return null;
  const presence = resolvePresence(characterId, living);
  const hard = hardBlockReason(living, characterId, presence.activity);
  if (hard) return null;
  ensureQueues(living);
  const kind = normalizeKind(cleaned.kind);
  const preview = (cleaned.preview || '发来一条消息').trim().slice(0, 36);
  const opening = (cleaned.opening || preview).trim().slice(0, 160);
  if (!opening) return null;

  const msg: AiMessageEvent = {
    messageId: newMessageId(),
    characterId,
    status: 'pending',
    kind,
    preview,
    openingDialogue: opening,
    action: cleaned.action?.trim() || undefined,
    innerThought: cleaned.inner_thought?.trim() || undefined,
    reason: (cleaned.reason || '想找玩家说话').trim().slice(0, 120),
    significance: clampSig(cleaned.significance),
    createdAt: now,
    expiresAt: now + MSG_TTL_MS,
    contextSummary: `${presence.behavior}｜${describeAgendaForPrompt(living, characterId)}`,
    relatedEventInstanceId: getAgenda(living, characterId)?.eventInstanceId,
  };

  living.pendingAiMessages!.push(msg);
  const stats = getStats(living, characterId);
  stats.lastOutreachAt = now;

  pushCampLog(living, {
    text: `${CHARACTER_MAP[characterId]?.name ?? characterId} 主动发来消息：${preview}`,
    source: 'npc',
    characterIds: [characterId],
  });

  return msg;
}

/**
 * 评估并可能投递一条主动消息。
 * 上层在主城/营地、非战斗时调用。
 */
export async function tickPlayerOutreach(
  living: AiLivingSave,
  ownedIds: string[],
  opts: { forceCharacterId?: string; bypassCooldown?: boolean } = {},
  now = Date.now(),
): Promise<{ kind: 'skip' | 'none' | 'sent' | 'expired'; detail?: string }> {
  ensureQueues(living);
  const expired = expireStaleAiMessages(living, now);
  if (expired > 0 && !opts.forceCharacterId) {
    // 先消化过期，本拍不再叠加新消息，避免扣分与新消息抢戏
    return { kind: 'expired', detail: String(expired) };
  }

  if (!opts.bypassCooldown && now - (living.lastPlayerOutreachEvalAt ?? 0) < EVAL_COOLDOWN_MS) {
    return { kind: 'skip' };
  }
  living.lastPlayerOutreachEvalAt = now;

  if (!ownedIds.length) return { kind: 'none' };

  const candidates = (opts.forceCharacterId ? [opts.forceCharacterId] : ownedIds)
    .filter((id) => CHARACTER_MAP[id])
    .map((id) => ({ id, elig: localEligibility(living, id, now) }))
    .filter((c) => c.elig.ok);

  if (!candidates.length) return { kind: 'none', detail: 'no_eligible' };

  // 加权：好感高、社交日模式、空闲活动、欲望/人生目标优先被抽中评估
  const scored = candidates.map((c) => {
    const presence = resolvePresence(c.id, living);
    const persona = getPersona(living, c.id);
    const desire = computeDesires(living, c.id);
    const goal = ensureLifeGoal(living, c.id);
    const goalPct = goal.progress / Math.max(1, goal.target);
    let score = 1 + getAffinity(living, c.id) / 50;
    if (persona?.dayMode === 'social' || persona?.dayMode === 'playful') score += 1.2;
    if (persona?.dayMode === 'withdrawn') score += 0.4;
    if (presence.activity === 'idle' || presence.activity === 'rest' || presence.activity === 'play') {
      score += 1;
    }
    if (presence.activity === 'maintain' || presence.activity === 'busy') score += 0.35;
    if (desire.scores.social >= 45) score += 0.8;
    if (goalPct >= 0.4) score += 0.7 + goalPct;
    if (goal.kind === 'gift_bond' || goal.kind === 'promise') score += 0.35;
    // 心情连续体：心情好更愿意主动示好/邀约；心情差也会想找人但欲望低一些
    const mood = getMoodSnapshot(living, c.id);
    if (mood.valence >= 40) score += 0.9;
    else if (mood.valence <= -40) score += 0.3;
    score += Math.random() * 0.8;
    return { ...c, score };
  });
  scored.sort((a, b) => b.score - a.score);

  // 每拍最多评估 2 人，避免烧爆 API
  const toEval = scored.slice(0, opts.forceCharacterId ? 1 : 2);
  for (const c of toEval) {
    let decision = await decideOutreachWithLlm(living, c.id);
    if (!decision) decision = decideOutreachLocal(living, c.id);
    else decision = sanitizeDecision(living, c.id, decision);
    const sent = enqueueMessage(living, c.id, decision, now);
    if (sent) {
      return { kind: 'sent', detail: `${sent.characterId}:${sent.kind}` };
    }
  }

  return { kind: 'none', detail: 'declined' };
}

function affinityPenaltyForIgnore(significance: number, unansweredCount: number): number {
  const base = 1 + significance;
  const streak = unansweredCount >= UNANSWERED_STREAK_SOFT ? unansweredCount : 0;
  return -(base + streak);
}

function applyBehaviorAfterUnanswered(living: AiLivingSave, msg: AiMessageEvent): void {
  applyMoodImpulse(living, msg.characterId, { kind: 'ignored' });
  const persona = getPersona(living, msg.characterId);
  if (persona) {
    persona.moodNote =
      msg.significance >= 4
        ? '被晾在一边，心里发紧，话变少'
        : '主动开口没人理，有点闷';
    persona.traits.warmth = Math.max(0, persona.traits.warmth - Math.min(8, 2 + msg.significance));
    persona.talkStreak = 0;
  }

  // 高分量被忽略：短暂撤回到自己的房间歇息，减少再找人
  if (msg.significance >= 3) {
    const presence = resolvePresence(msg.characterId, living);
    const agenda: CharacterAgenda = {
      goal: '消化被无视的情绪',
      targetRoomId: presence.roomId,
      activity: 'rest',
      behavior: '一个人待着，通讯扣在桌上',
      remainGameMin: 25 + msg.significance * 8,
      startedGameMin: living.gameMinutes,
      reason: '消息没人回，先自己待一会儿',
      source: 'social',
    };
    setAgenda(living, msg.characterId, agenda);
  }
}

function applyUnansweredOutcome(
  living: AiLivingSave,
  msg: AiMessageEvent,
  status: 'cancelled' | 'expired' | 'ignored',
): void {
  if (msg.status !== 'pending') return;
  msg.status = status;
  const stats = getStats(living, msg.characterId);
  stats.unansweredCount += 1;
  stats.lastCancelledAt = Date.now();

  const delta = affinityPenaltyForIgnore(msg.significance, stats.unansweredCount);
  const next = adjustAffinity(living, msg.characterId, delta);

  pushMemory(living, msg.characterId, {
    kind: 'outreach_ignored',
    summary: `主动消息「${msg.preview}」未被回应（${status}），好感→${next}；原因曾是：${msg.reason}`,
    importance: Math.min(8, 3 + msg.significance),
  });
  pushCampLog(living, {
    text: `${CHARACTER_MAP[msg.characterId]?.name ?? msg.characterId} 的消息无人应答（${status}）`,
    source: 'system',
    characterIds: [msg.characterId],
  });
  applyBehaviorAfterUnanswered(living, msg);
}

/**
 * 玩家点选某条消息：接受该条，取消其余 pending。
 * 返回被接受的事件（已写入开场白到 recentChats）。
 */
export function acceptAiMessage(
  living: AiLivingSave,
  messageId: string,
  now = Date.now(),
): AiMessageEvent | null {
  ensureQueues(living);
  expireStaleAiMessages(living, now);
  const target = living.pendingAiMessages!.find((m) => m.messageId === messageId);
  if (!target || target.status !== 'pending') return null;

  for (const msg of living.pendingAiMessages!) {
    if (msg.messageId === messageId) continue;
    if (msg.status === 'pending') {
      applyUnansweredOutcome(living, msg, 'cancelled');
    }
  }

  target.status = 'accepted';
  const stats = getStats(living, target.characterId);
  stats.unansweredCount = 0;
  stats.lastRespondedAt = now;

  const reward = Math.max(1, Math.ceil(target.significance * 0.8));
  adjustAffinity(living, target.characterId, reward);

  pushRecentChat(living, target.characterId, 'assistant', target.openingDialogue, {
    action: target.action,
    innerThought: target.innerThought,
  });

  pushMemory(living, target.characterId, {
    kind: 'outreach',
    summary: `主动找玩家（${target.kind}）：${target.preview}｜${target.reason}`,
    importance: Math.min(8, 4 + target.significance),
  });

  pushCampLog(living, {
    text: `你点开了 ${CHARACTER_MAP[target.characterId]?.name ?? target.characterId} 的消息`,
    source: 'player',
    characterIds: [target.characterId],
  });

  // 正面行为影响：心情回暖；求助类短暂转向「等玩家一起处理」
  const persona = getPersona(living, target.characterId);
  if (persona) {
    evolvePersonaAfterTalk(living, target.characterId, {
      affectionDelta: reward,
      playerMessage: '[打开了你的主动消息]',
    });
    persona.moodNote =
      target.kind === 'ask_help' ? '终于等到回应，松了口气' : '被接住了，语气软一点';
  }

  if (target.kind === 'ask_help' || target.kind === 'report') {
    const presence = resolvePresence(target.characterId, living);
    setAgenda(living, target.characterId, {
      goal: '等玩家一起处理眼前的事',
      targetRoomId: presence.roomId,
      activity: 'talking',
      behavior: '守着通讯，等你回完这句再动手',
      remainGameMin: 20 + target.significance * 6,
      startedGameMin: living.gameMinutes,
      reason: target.reason,
      source: 'social',
      eventInstanceId: target.relatedEventInstanceId,
    });
  }

  return target;
}

/** 玩家主动关掉某条（等同忽略） */
export function dismissAiMessage(living: AiLivingSave, messageId: string): boolean {
  ensureQueues(living);
  const msg = living.pendingAiMessages!.find((m) => m.messageId === messageId);
  if (!msg || msg.status !== 'pending') return false;
  applyUnansweredOutcome(living, msg, 'ignored');
  return true;
}
