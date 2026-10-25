import {
  buildDisciplineActivePromptBlock,
  buildDisciplineJustLeftPromptBlock,
  buildDisciplineThreatPromptBlock,
  detectDisciplineThreat,
  isDisciplineActiveFor,
  isDisciplineEnabled,
} from './disciplineSession';
import { buildAdultEventPromptBlock, detectAdultEventContext } from './adultEvents';
import {
  BATH_INTIMATE_CONSENT_PROTOCOL,
  buildCommanderBondPromptBlock,
  getAiProfile,
  getVoicePromptLine,
} from './aiProfiles';
import { buildDialogueSystemPrompt, buildPlayerTurnPriorityLock } from './localHomeGpuPrompt';
import { isLocalHomeGpuDialoguePath } from './providerConfig';
import { buildCommanderCanonPromptBlock, buildCommanderOnlinePresenceLine } from './commanderCanon';
import {
  buildLiveCharacterSnapshot,
  buildWorldSyncPromptBlock,
  liveCharacterSnapshotToPromptBlock,
} from './characterLiveSnapshot';
import {
  buildCampLayoutPromptBlock,
  buildCampRosterPromptBlock,
  buildCharacterCampPromptLines,
} from '../data/campLayout';
import { buildCampLandmarkPromptBlock } from '../data/campLandmarks';
import { resolveCharacterRoomId, resolvePresence } from './livingState';
import {
  describeTimeSinceTalk,
  findRepeatedAsk,
  getChatDigestLines,
  getMemoryLines,
  getRecentChatsForPrompt,
  recallRelevantArchiveLines,
} from './memory';
import { describePersonaForPrompt, getPersona } from './characterPersona';
import { dailyTopicSeed, describeAgendaForPrompt, getAgenda, isAgendaActive } from './characterAgenda';
import {
  describeCharacterEventStance,
  describeCoScreenMembers,
  getCoScreenGroupForCharacter,
  listActiveCampEventsForUi,
} from './campEvents';
import { computeDesires } from './characterDesires';
import { emotionOutfitPromptHint } from './emotionOutfit';
import { buildOutfitChangePromptBlock, buildOutfitLiveUserDirective } from './outfitChangeProcess';
import { emotionPosePromptHint } from '../data/characterEmotionPoses';
import { unfinishedBusinessLines } from './desireNext';
import {
  buildBathAgendaDemotePromptBlock,
  buildLocationChallengePromptBlock,
} from './dialogueRealityGuard';
import { describeLifeGoalForPrompt } from './lifeGoals';
import { recallRelevantTimelineLines } from './lifeTimeline';
import { buildCampEconomyPromptBlock, buildPendingItemOfferPromptBlock } from '../systems/CampWarehouseSystem';
import { describeAffinity, describeRelation, getAffinity, getRelation } from './relationship';
import { buildRelationshipArcPromptBlock } from './relationshipArc';
import { buildStructuredFactsPromptBlock } from './structuredFacts';
import { buildAffinityGameplayPromptHint } from '../systems/AffinityGameplay';
import { describeMoodContinuumForPrompt } from './moodContinuum';
import { getSceneCard, sceneCardToPromptBlock } from './sceneCards';
import { formatGameClock, describeTimeScale } from './worldClock';
import {
  buildSceneRealtimeRuleLine,
  buildSceneTransitionPromptBlock,
  captureDialogueSceneSnapshot,
  getDialogueSceneSnapshot,
} from './dialogueSceneSync';
import type { AiLivingSave, CharacterActivity, DialogueRequest } from './types';
import type { ChatMessage } from './llmClient';
import type { SaveData } from '../types';
import { describeSleepForPrompt, isDeepSleeping, isInSleepSystem } from './sleepSystem';
import { CHARACTER_MAP } from '../data/characters';

function agendaDesireHint(living: AiLivingSave, characterId: string): string {
  const a = getAgenda(living, characterId);
  if (!a || a.remainGameMin <= 0) return '';
  return `${a.reason} ${a.behavior}`;
}

function activityInChinese(activity: CharacterActivity): string {
  const map: Record<CharacterActivity, string> = {
    idle: '闲着/发呆',
    busy: '手头有点忙',
    talking: '正跟人说话',
    sleeping: '正在睡觉恢复电力',
    patrol: '刚巡过一圈',
    maintain: '在收拾东西',
    rest: '在歇口气',
    play: '在玩/打发时间',
    bathe: '刚洗过或在洗',
    eat: '在吃饭',
    guard: '在门口守着',
  };
  return map[activity] ?? activity;
}

export type AssembledDialogue = {
  /**
   * 发给模型的完整 system（= systemStatic + systemDynamic）。
   * 千问与 Fable 共用：旧布局「整包 system + 短 user」。
   */
  system: string;
  /** L0–L2 固定人设/玩法宪法（会话内可缓存拼装） */
  systemStatic: string;
  /** L3–L4 本轮世界快照（含场景门控块、成人事件等；并入 system，不进 user） */
  systemDynamic: string;
  history: ChatMessage[];
  user: string;
};

// ─── 会话级 SYSTEM 缓存 ────────────────────────────────────────────────────
// 原理：Ollama KV Cache 以 token 位置为键，同一角色的静态前缀在首次计算后，
// 后续轮次只需发新增的 user/assistant token，首 token 延迟（prefill）大幅下降。
// 实测提升：第 2 句起快 2-3 倍。
//
// 缓存失效条件：换角色（characterId 变）→ 换新缓存 key。
// 角色不换时，buildDialogueSystemPrompt、world sync、camp layout 等全部复用。
// ─────────────────────────────────────────────────────────────────────────

interface SystemCache {
  /** 角色 ID（用于比对） */
  characterId: string;
  /** 角色名（用于比对） */
  name: string;
  /** 静态前缀（buildDialogueSystemPrompt + world sync + camp layout + rules）*/
  staticPrefix: string;
  /** 首次计算时间（调试用） */
  builtAt: number;
}

let _systemCache: SystemCache | null = null;

/**
 * 获取（并按需构建）会话级静态 SYSTEM 缓存。
 * 角色不换时直接返回缓存结果，节省 ~30-50% prefill token 重算。
 */
function getCachedSystemPrefix(
  characterId: string,
  _localGpu: boolean,
): string {
  const profile = getAiProfile(characterId);
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;

  // 命中缓存：角色相同
  if (_systemCache && _systemCache.characterId === characterId) {
    return _systemCache.staticPrefix;
  }

  // 缓存未命中或角色切换：重建
  const baseSystem = buildDialogueSystemPrompt(characterId);
  const worldSync = buildWorldSyncPromptBlock();
  const campLayout = buildCampLayoutPromptBlock();
  const campLandmark = buildCampLandmarkPromptBlock();

  // 连续对话规则（静态文案）
  const continuousRules = `【连续对话规则】
- 下方 messages 里已有你们的真实对话历史，必须接着聊，禁止当成第一次见面。
- 【记忆】本地永久存着你们聊过的话；【相关旧对话】【更早聊过的要点】【长期记得】若命中，要像真人一样自然用上，禁止说「我没有记忆/不记得昨天」。
- 禁止原样复读自己说过的同一句；禁止复用自己上一句的开场句式。
- 若距上次对话很近：禁止重新寒暄式开场，必须承接刚才的情绪/话题。
- 若你刚主动给玩家发过消息（历史里最近一句是你先开口）：本轮必须承接那条主动消息的事由，不要装作没发过。
- 若正处于多人事件同屏：【硬规则】本轮必须以该事件为当下现实作答；禁止聊无关的风向/沙尘观测/日常作息；玩家问「怎么了」必须解释眼前的事件与同场同伴。
- 若有进行中的营地事件（非同屏）：也优先用你自己的态度谈事件观感，不要假装营里无事。
- 【今日状态】若是发呆/社交/玩闹：聊天可以闲、可以懒、可以跑题到生活；不要强行复读档案箭头作息。
- 旧记忆是参考不是剧本：过期的风向/沙尘口头禅禁止无脑复读；人物事实/约定/问答要记得。
- 玩家若重复提问：用「你自己的声线」点破——禁止全员统一成「你不是刚问过吗」式吐槽。
- 用符合【专属声线】的口语回应；专属声线可随今日情绪漂移，但仍要是此人。
- 禁止把关心统一写成傲娇否认。
- 外形/武装以【自我认知】为准；位置以【你在营地的位置】为准。
- 【衣装术语·禁止混称】「营地装/营地标配/营地日常」=生活服装 pifu00（居家休闲，不是装甲）；「星夜睡衣」=pifu02；「默认战斗装甲/装甲/原皮」=default（仅执勤军械室外干活，不是营地日常默认）。禁止把睡衣/泳装/装甲说成营地标配；谈起穿着必须与玩家眼前立绘一致。
- 【画面跟嘴走·硬规则】地点跟「此刻」对白走；换衣服除外——答应换装后立绘切「换装中」过程动态，等系统换好后你才能按新衣说话。营地日常默认生活服装(pifu00)；装甲仅主动/执勤军械时。禁止同一轮既说「等我去换」又说「已经换好了」。规划句与 desire_next 绝不切景。
- 同伴位置以【营地同伴此刻】为准。
- 【话题收束】一次只谈一个话题。玩家说「好/行/嗯/知道了/我走了/再见」且你已说完要点 → end_conversation=true，说收尾句，禁止再发明下一件杂事硬续聊。
- 【自然发言】你不是回合制客服。指挥官沉默时可以主动开口；话没说完可以 want_continue=true 接着说；也可短打断冷场。是否开口由性格、今日模式与当下环境（忙/睡/洗浴等）判断——内敛就少说，话痨/社交就多接话，忙碌时可抱怨被晾着或干脆不想聊。
- 【被打扰】综合你此刻活动（睡觉/洗浴/专注维护/忙碌等）、今日模式与性格判断 interrupt_reaction：
  · welcome=其实乐意被找；tolerate=还能忍；annoyed=烦了；angry=被吵怒了。
  · 不想被打扰却仍被缠：语气变冲，affection_change 可为负，并倾向 end_conversation=true。
  · 喜欢被打扰/社交日模式/闲着：可继续聊，不必为结束而结束。`;

  // JSON / 深场：权威定义已在人设【深场字段】；此处只留短提醒（一比一去重）
  const jsonProtocol = `【深场提醒】scene_beat / desire_next / memory_write / world_intent / camp_item_action / item_offer_resolution 的完整定义见人设【深场字段】。本轮 scene_beat 勿空；意图只写 desire_next；action / inner_thought 必填。`;

  const staticPrefix = [
    baseSystem,
    worldSync,
    campLayout,
    campLandmark,
    continuousRules,
    jsonProtocol,
  ]
    .filter(Boolean)
    .join('\n\n');

  _systemCache = { characterId, name, staticPrefix, builtAt: Date.now() };
  return staticPrefix;
}

export async function assemblePlayerDialogueMessages(
  living: AiLivingSave,
  req: DialogueRequest,
  save?: SaveData | null,
): Promise<AssembledDialogue> {
  const localGpu = isLocalHomeGpuDialoguePath();

  // 会话级缓存：角色不变时静态前缀全部复用（第 2 句起快 2-3 倍）
  const staticPrefix = getCachedSystemPrefix(req.characterId, localGpu);

  const scene = getSceneCard(req.sceneId);
  const presence = resolvePresence(req.characterId, living);
  const affinity = getAffinity(living, req.characterId);
  const profile = getAiProfile(req.characterId);
  const repeat = findRepeatedAsk(living, req.characterId, req.playerMessage);
  const since = describeTimeSinceTalk(living, req.characterId);
  const personaLive = getPersona(living, req.characterId);
  const askRecall =
    /还记得|上次|昨天|之前|从前|说过|问过|告诉过|提过|约定|名字|喜欢|讨厌|害怕/.test(
      req.playerMessage,
    ) || /[?？]/.test(req.playerMessage);
  // Fable Q4：与千问同记忆宽度
  const memoryCap = askRecall ? 10 : 7;
  const memories = getMemoryLines(living, req.characterId, memoryCap);
  const archiveRecall = await recallRelevantArchiveLines(
    req.characterId,
    req.playerMessage,
    askRecall ? 5 : 3,
  );
  const liveSnap = buildLiveCharacterSnapshot(req.characterId, save ?? null, living);
  const timelineRecall = await recallRelevantTimelineLines(
    req.characterId,
    [
      req.playerMessage,
      agendaDesireHint(living, req.characterId),
      liveSnap?.activeSkinName ?? '',
      liveSnap?.locationHint ?? '',
    ]
      .filter(Boolean)
      .join(' '),
    askRecall ? 5 : 4,
  );
  const roomId = resolveCharacterRoomId(req.characterId, living);
  const ownedIds = (save?.ownedCharacters ?? []).map((o) => o.characterId);
  const roster = false
    ? []
    : ownedIds
        .filter((id) => id !== req.characterId)
        .slice(0, 12)
        .map((id) => {
          const p = resolvePresence(id, living);
          return {
            name: CHARACTER_MAP[id]?.name ?? id,
            roomLabel: p.label.split('·').slice(1).join('·').trim() || p.label,
            behavior: p.behavior,
          };
        });

  const co = getCoScreenGroupForCharacter(living, req.characterId);
  const inLiveEvent = Boolean(co && co.memberIds.length >= 2);

  const agendaNow = getAgenda(living, req.characterId);
  const desireSnap = computeDesires(living, req.characterId);
  const desireLine = isAgendaActive(agendaNow)
    ? `${agendaNow!.reason}（去${agendaNow!.targetRoomId}，剩约${agendaNow!.remainGameMin}分）｜${desireSnap.topLine}`
    : `${personaLive.dayPlan || '随营生活'}｜情绪：${personaLive.moodNote}｜${desireSnap.topLine}`;
  const unfinishedRaw = unfinishedBusinessLines(living, req.characterId, 3);
  const unfinished =
    presence.activity === 'bathe' || presence.roomId === 'room_1f_bath'
      ? unfinishedRaw
      : unfinishedRaw.filter((l) => !/浴|澡|洗浴|冲澡|水温|浴巾/.test(l));
  const sensory =
    scene?.sensory?.length
      ? scene.sensory.slice(0, 3).join('；')
      : presence.behavior;

  // 精简动态块（每轮必重算，只含运行时状态）
  const deepFieldBlock = false
    ? `【短意图·勿写进对白】${desireLine.slice(0, 140)}
【立绘硬锁】玩家眼前此刻就是「${liveSnap?.activeSkinName ?? '默认外观'}」${liveSnap?.skinIsEventTemp ? '（事件临时外覆）' : ''} @ ${presence.label}。
dialogue/action 只能按这套外观与地点说话；禁止描述未穿的衣服；禁止 skin_change 乱跳。
${buildOutfitChangePromptBlock(living, req.characterId)}
${emotionPosePromptHint(req.characterId)}
${buildStructuredFactsPromptBlock(living, req.characterId)}
${unfinished.length ? `挂念（勿整句复读进 dialogue）：\n${unfinished.join('\n')}` : ''}
desire_next 仅 JSON 字段；want_continue=false；dialogue 只回指挥官本轮话。`
    : `【深场·生命节拍】（你是活在锈带的机体，不是客服回合。用一场戏的密度说话。）
今日欲望/当前意图：${desireLine}
此刻地点感官：${presence.label}——${sensory}
当前外观：${liveSnap?.activeSkinName ?? '默认外观'}${liveSnap?.skinIsEventTemp ? '（事件临时外覆）' : ''}——谈及衣装必须与此一致，勿描述未穿的外覆。
${buildOutfitChangePromptBlock(living, req.characterId)}
${save ? emotionOutfitPromptHint(save, living, req.characterId) : ''}
${emotionPosePromptHint(req.characterId)}
与指挥官感情温度：好感 ${affinity}/100（${describeAffinity(affinity)}）
${buildRelationshipArcPromptBlock(living, req.characterId)}
${buildStructuredFactsPromptBlock(living, req.characterId)}
${describeMoodContinuumForPrompt(living, req.characterId)}
${buildAffinityGameplayPromptHint(living, req.characterId)}
${unfinished.length ? `未了之事（可自然带一句，勿清单播报）：\n${unfinished.join('\n')}` : '未了之事：暂无特别沉重的挂念。'}
${describeLifeGoalForPrompt(living, req.characterId)}`;

  const nowSnap = captureDialogueSceneSnapshot(living, req.characterId);
  const prevSnap = getDialogueSceneSnapshot(living, req.characterId);
  const sceneTransition = buildSceneTransitionPromptBlock(prevSnap, nowSnap);
  const locChallenge = buildLocationChallengePromptBlock(living, req);
  const bathDemote = buildBathAgendaDemotePromptBlock(living, req.characterId);

  // 动态 contextParts：不含 staticPrefix 已有的羁绊全文 / 地标 / 深场权威定义
  const contextParts = [
    '【世界快照】以下为本轮可变状态；不得覆盖人设【专属声线】与玩法宪法（换装/嘴腿/JSON/成人底线）。',
    buildCommanderCanonPromptBlock(),
    buildCommanderOnlinePresenceLine(living, req.characterId),
    liveSnap ? liveCharacterSnapshotToPromptBlock(liveSnap) : '',
    `【你在营地的位置】\n${buildCharacterCampPromptLines(req.characterId, roomId, presence.behavior)}`,
    buildCampRosterPromptBlock(roster),
    deepFieldBlock,
    `【此刻状态】${formatGameClock(living)}（${describeTimeScale()}）；你正在：${presence.behavior}（${activityInChinese(presence.activity)}）。`,
    buildSceneRealtimeRuleLine(),
    sceneTransition,
    locChallenge,
    bathDemote,
    `【当前意图·勿顶替回答】${describeAgendaForPrompt(living, req.characterId)}`,
    describePersonaForPrompt(living, req.characterId),
    inLiveEvent
      ? ''
      : `【今日闲聊种子】${dailyTopicSeed(living, req.characterId)}——仅当今日状态允许闲聊时用；勿复读成每天同一开场。`,
    `【时间关系】${since}。`,
    scene ? sceneCardToPromptBlock(scene) : `【场景】${req.sceneId}`,
  ].filter(Boolean);

  // 不想被打扰的活动提示
  const doNotDisturb = ['sleeping', 'bathe', 'maintain', 'busy', 'guard', 'patrol'].includes(
    presence.activity,
  );
  if (doNotDisturb) {
    contextParts.push(
      `【打扰风险】你当前活动「${activityInChinese(presence.activity)}」通常不喜欢被长时间缠住。` +
        `结合今日模式「${personaLive.dayMode}」与性格自行判断：可以短答后结束，也可以真的喜欢被找。` +
        `若判定为不耐烦，请给 interrupt_reaction=annoyed/angry，并考虑 end_conversation=true。`,
    );
  }

  contextParts.push(describeSleepForPrompt(living, req.characterId));
  if (isDeepSleeping(living, req.characterId)) {
    contextParts.push(
      '【睡眠立绘】你已完全入睡：玩家眼前是星夜睡衣睡眠循环动态（侧躺/蜷缩轻呼吸）。' +
        '被找聊天=被打扰状态，你会气愤或疲惫；interrupt_reaction 自行判定。' +
        '若你决定醒来（做梦惊醒/被吵醒/不想再睡），对白里体现醒来；系统会把立绘同步回睡衣站立，勿声称立刻换回装甲。',
    );
  } else if (isInSleepSystem(living, req.characterId)) {
    contextParts.push(
      '【睡眠立绘】你在准备入睡：已穿星夜睡衣站立（idle），尚未切到睡眠循环。',
    );
  }

  if (presence.activity === 'bathe' || presence.roomId === 'room_1f_bath') {
    const intimateOn = Boolean(living.bathIntimateConsent?.[req.characterId]);
    // 一比一门控：协议全文与旧静态人设同文，仅浴室注入
    contextParts.push(BATH_INTIMATE_CONSENT_PROTOCOL);
    contextParts.push(
      `【洗浴立绘】你在浴室。玩家眼前默认是冲澡待机动态（白浴巾裹身、轻呼吸/微摆）。` +
        (intimateOn
          ? `此刻浴巾已脱掉，立绘是成人冲澡动态——对白必须按「已脱巾」说；想重新裹上填 bath_intimate_consent=false。禁止再说裹着浴巾。`
          : `只有你自愿脱掉浴巾，或指挥官明确要求脱巾且你同意时，才填 bath_intimate_consent=true。一起洗/搓背但仍裹巾 → 填 "" 或 false。对白若说「裹着浴巾」绝不可填 true。`),
    );
  }

  // 小黑屋：进房沉浸块优先；刚离开次之；未进房的对话威慑再次之
  if (isDisciplineActiveFor(living, req.characterId)) {
    contextParts.push(buildDisciplineActivePromptBlock(living, req.characterId));
  } else {
    const justLeft = buildDisciplineJustLeftPromptBlock(living, req.characterId);
    if (justLeft) contextParts.push(justLeft);
    else if (
      (!save || isDisciplineEnabled(save)) &&
      req.turnMode === 'reply' &&
      detectDisciplineThreat(req.playerMessage)
    ) {
      contextParts.push(buildDisciplineThreatPromptBlock());
    }
  }

  // 成人事件总层：浴室亲密 + 小黑屋 + 成人话题；挂载身体敏感点
  {
    const adultCtx = detectAdultEventContext({
      living,
      characterId: req.characterId,
      userText: req.playerMessage || '',
    });
    const adultBlock = buildAdultEventPromptBlock({
      living,
      characterId: req.characterId,
      ctx: adultCtx,
    });
    if (adultBlock) contextParts.push(adultBlock);
  }

  const outreachMem = (living.memories?.[req.characterId] ?? []).find(
    (m) => m.kind === 'outreach' || m.kind === 'outreach_ignored',
  );
  if (outreachMem) {
    contextParts.push(
      `【主动消息后果】最近：${outreachMem.summary}（重要性 ${outreachMem.importance}）。情绪与话题要受此影响，分量越大影响越明显。`,
    );
  }

  const eventStance = describeCharacterEventStance(living, req.characterId);
  if (eventStance) {
    contextParts.push(`【营地进行中事件】\n${eventStance}`);
  }
  const activeUi = listActiveCampEventsForUi(living);
  if (activeUi.length) {
    contextParts.push(
      `【事件看板】\n${activeUi
        .map(
          (e) =>
            `- ${e.name}（${e.phaseLabel}，剩余约${e.remainGameMin}游戏分，焦点${e.focusLabel}${e.coScreenActive ? `，同屏×${e.coScreenIds.length}` : ''}）`,
        )
        .join('\n')}`,
    );
  }

  const agenda = getAgenda(living, req.characterId);
  if (isAgendaActive(agenda) && agenda?.eventStance === 'vent') {
    contextParts.push('【情绪】你此刻很想吐槽刚发生/正在发生的事，第一句就可以带情绪，不要客套。');
  }

  if (co && co.memberIds.length >= 2) {
    const others = co.memberIds.filter((id) => id !== req.characterId);
    const relLines = others
      .map((id) => {
        const n = CHARACTER_MAP[id]?.name ?? id;
        const sc = getRelation(living, req.characterId, id);
        return `- 与${n}：${sc}（${describeRelation(sc)}）`;
      })
      .join('\n');
    let focusLock = `【多人同屏·硬锁定】当下现实是「${co.eventName}」`;
    if (co.blurb) focusLock += `——${co.blurb}`;
    focusLock += `。同场：${describeCoScreenMembers(co.memberIds)}。`;
    if (co.topic) focusLock += `话题「${co.topic}」。`;
    if (co.defId === 'argument' && co.meta?.partyA && co.meta?.partyB) {
      const na = CHARACTER_MAP[co.meta.partyA]?.name ?? co.meta.partyA;
      const nb = CHARACTER_MAP[co.meta.partyB]?.name ?? co.meta.partyB;
      focusLock += `争吵双方是${na}与${nb}。`;
      if (req.characterId === co.meta.partyA || req.characterId === co.meta.partyB) {
        focusLock += `你是当事人，说话要带火气/委屈/不服，不要突然变成气象播报。`;
      } else {
        focusLock += `你在劝架、拱火或旁观，必须表态，不要假装没听见吵架。`;
      }
    }
    focusLock +=
      `指挥官就在现场问你；回答必须扣住「${co.eventName}」与同场同伴，禁止岔开到旧记忆里的沙尘/巡逻风话。`;
    if (co.meta?.coScreenFull === '1') {
      focusLock += `同场已满（最多${co.meta.coScreenCap ?? '6'}人），不要再拉新人或说「还有谁要来」。`;
    }
    focusLock += `\n【同屏现实】你与同场所有人此刻都在${co.focusLabel}，场景与活动外覆已对齐；禁止说自己在别的房间或仍穿睡眠/浴室皮。\n【你与同场同伴的关系】\n${relLines}`;
    contextParts.push(focusLock);
  }

  // 与在营同伴的关系摘要（后台关系网）
  if (true) {
    const peerRels = ownedIds
      .filter((id) => id !== req.characterId)
      .slice(0, 8)
      .map((id) => {
        const sc = getRelation(living, req.characterId, id);
        if (Math.abs(sc) < 8) return null;
        return `${CHARACTER_MAP[id]?.name ?? id}${describeRelation(sc)}(${sc})`;
      })
      .filter(Boolean);
    if (peerRels.length) {
      contextParts.push(`【你与同伴的关系印象】${peerRels.join('；')}`);
    }
  }

  if (repeat.hit) {
    contextParts.push(
      `【重复提问】这句与历史高度相似（约 ${repeat.askCount} 次）。` +
        (repeat.prevReply
          ? `你上次答过类似：「${repeat.prevReply.slice(0, 48)}」。请点破并换说法。`
          : '请点破并换说法。'),
    );
  }
  if (archiveRecall.length) {
    contextParts.push(
      `【相关旧对话】（永久本地档案检索；与本轮话题相关或近期跨天备份。请自然调用，禁止否认记得）\n${archiveRecall.join('\n')}`,
    );
  }

  if (timelineRecall.length) {
    contextParts.push(
      `【人生时间线】（你经历过的里程碑，按相关度召回。谈及往事时要像真人记得，禁止说没有记忆；勿整表背诵）\n${timelineRecall.join('\n')}`,
    );
  }

  if (memories.length) {
    contextParts.push(
      `【长期记得】（工作记忆短窗；人物事实/约定要认，过时风向口头禅勿复读）\n${memories.join('\n')}`,
    );
  }

  const digests = getChatDigestLines(living, req.characterId, askRecall ? 12 : 10);
  if (digests.length) {
    contextParts.push(
      `【更早聊过的要点】（已压缩，勿复读原文）\n${digests.join('\n')}`,
    );
  }

  const pendingOfferBlock = buildPendingItemOfferPromptBlock(living, req.characterId);
  if (pendingOfferBlock) {
    contextParts.push(pendingOfferBlock);
  }

  // 经济说明门控：触发时注入与旧版同文的 buildCampEconomyPromptBlock
  const economyIntent =
    /买|卖|送|礼物|吃|修|义体|锈币|钱|仓库|商店|货架|口粮|补给|购物/.test(req.playerMessage) ||
    Boolean(pendingOfferBlock) ||
    roomId === 'room_1f_shop' ||
    roomId === 'room_1f_shop_bed' ||
    roomId === 'room_1f_storage';
  if (save && economyIntent) {
    const eco = buildCampEconomyPromptBlock(save, living, req.characterId);
    if (eco) contextParts.push(eco);
  }

  if (profile?.emotionalBaseline) {
    const persona = getPersona(living, req.characterId);
    contextParts.push(
      `【情绪底色·档案】${profile.emotionalBaseline}\n【今日情绪叠加】${persona.moodNote}——二者合成，不要只念档案。`,
    );
  }

  // 拼装层拆 static/dynamic 便于缓存与门控；发出时合并为完整 system（千问=Fable 同布局）
  const systemStatic = staticPrefix;
  const systemDynamic = contextParts.join('\n');
  const system = `${systemStatic}\n\n${systemDynamic}`;

  // 只塞最近几句原话进 messages，省 token；更早的靠 digests
  const history: ChatMessage[] = getRecentChatsForPrompt(living, req.characterId).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text,
  }));

  const turnMode = req.turnMode ?? 'reply';
  let user = req.playerMessage;
  if (turnMode === 'outfit_reveal') {
    user = buildOutfitLiveUserDirective(living, req.characterId, 'outfit_reveal');
  } else if (turnMode === 'proactive') {
    const discActive = isDisciplineActiveFor(living, req.characterId);
    const justLeft = buildDisciplineJustLeftPromptBlock(living, req.characterId);
    user = discActive
      ? `【系统·小黑屋内发言】动机：${req.playerMessage || '束缚中的反应'}。
你已被拖入调教室并束缚，无法离开。按动机与性格开口；禁止假装未进房；禁止 end_conversation=true。
${buildOutfitLiveUserDirective(living, req.characterId, turnMode)}`
      : justLeft
        ? `【系统·刚离开小黑屋】动机：${req.playerMessage || '束缚已解除'}。
你已离开小黑屋、束缚已解除。按动机开口；禁止再说被绑着；action 禁止写束缚。
${buildOutfitLiveUserDirective(living, req.characterId, turnMode)}`
      : `【系统·角色主动发言】指挥官这会儿没说话。动机：${req.playerMessage || '冷场想接话'}。
请你按性格与环境自行开口（可催促、自言自语、换话题、吐槽沉默、或短促确认对方还在）。
禁止复读上一句；禁止假装指挥官刚说了什么。本轮不要编造指挥官台词。
若不想再聊可 end_conversation=true；若还想接着说可 want_continue=true。
${buildOutfitLiveUserDirective(living, req.characterId, turnMode)}`;
  } else if (turnMode === 'continue') {
    const discActive = isDisciplineActiveFor(living, req.characterId);
    const justLeft = buildDisciplineJustLeftPromptBlock(living, req.characterId);
    user = `【系统·角色接着说】你上一句还没把话说完/还想补一句。动机：${req.playerMessage || '接着刚才的话'}。
直接续上，不要重新寒暄，不要复读上一句。指挥官仍可能随时插话。
说完该停了就 want_continue=false；还想再补一句才 want_continue=true。
${discActive ? '【束缚锁定】你仍在小黑屋，end_conversation 必须 false。\n' : ''}${justLeft ? '【刚离开】束缚已解除，禁止再说被绑着。\n' : ''}${buildOutfitLiveUserDirective(living, req.characterId, turnMode)}`;
  } else {
    const discLock = isDisciplineActiveFor(living, req.characterId)
      ? '\n【束缚锁定】你已在小黑屋被固定：end_conversation 必须 false；禁止假装未进房或逃走。'
      : buildDisciplineJustLeftPromptBlock(living, req.characterId)
        ? '\n【刚离开锁定】束缚已解除、已离开小黑屋：禁止再说被绑着/挣扎挣脱。'
        : '';
    // 千问与 Fable 同一 user 形态：回答锁 + 原话 + 换装指令（世界状态在 system）
    user = `${buildPlayerTurnPriorityLock(req.playerMessage)}\n\n指挥官说：${req.playerMessage}\n\n${buildOutfitLiveUserDirective(living, req.characterId, turnMode)}${discLock}`;
  }

  return { system, systemStatic, systemDynamic, history, user };
}

export function assembleNpcPairMessages(
  living: AiLivingSave,
  a: string,
  b: string,
  sceneId: string,
  save?: SaveData | null,
  motive?: string,
): { system: string; user: string } {
  const pa = getAiProfile(a);
  const pb = getAiProfile(b);
  const na = CHARACTER_MAP[a]?.name ?? a;
  const nb = CHARACTER_MAP[b]?.name ?? b;
  const scene = getSceneCard(sceneId);
  const rel = getRelation(living, a, b);
  const snapA = buildLiveCharacterSnapshot(a, save ?? null, living);
  const snapB = buildLiveCharacterSnapshot(b, save ?? null, living);
  const agendaA = describeAgendaForPrompt(living, a);
  const agendaB = describeAgendaForPrompt(living, b);

  const system = `你是废土营地的叙事导演。同时扮演两位少女机体的短对话（每人 1 句口语）。
禁止报告腔、坐标、百分比、协议播报。要有情绪与关系张力。
两人声线必须明显不同，禁止两人共用「才不是/哼/别误会」统一傲娇模板。
她们同属围着「指挥官」的羁绊团队（后宫向归属），对指挥官有感情因素；彼此闲聊也可带一点争风/分享他注意力的气味，但仍必须是各自声线。
若提供了「主动搭话动机」，必须围绕该动机展开（例如修理求助、闲聊、拉人、拌嘴），不要各说各的无关废话。
输出 JSON：
{"lines":[{"characterId":"${a}","emotion":"neutral","dialogue":"..."},{"characterId":"${b}","emotion":"neutral","dialogue":"..."}],"summary":"一句话事件摘要","relation_change":0}`;

  const user = [
    buildWorldSyncPromptBlock(),
    buildCommanderBondPromptBlock(),
    `【时间】${formatGameClock(living)}（${describeTimeScale()}）`,
    scene ? sceneCardToPromptBlock(scene) : '',
    `【声线锁】\n- ${getVoicePromptLine(a)}\n- ${getVoicePromptLine(b)}`,
    snapA ? liveCharacterSnapshotToPromptBlock(snapA) : `【${na}】情绪底：${pa?.emotionalBaseline ?? ''}`,
    snapB ? liveCharacterSnapshotToPromptBlock(snapB) : `【${nb}】情绪底：${pb?.emotionalBaseline ?? ''}`,
    `【${na}意图】${agendaA}`,
    `【${nb}意图】${agendaB}`,
    `【彼此关系】${rel}（-100敌对 ~ 100亲密）`,
    motive ? `【主动搭话动机】${motive}` : '',
    `请生成她们此刻自然、有人情味的短互动；两人说话味道必须不同。`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return { system, user };
}

export function assembleOfflineSummaryMessages(
  living: AiLivingSave,
  ownedIds: string[],
  offlineHours: number,
  save?: SaveData | null,
): { system: string; user: string } {
  const casts = ownedIds
    .slice(0, 8)
    .map((id) => {
      const snap = buildLiveCharacterSnapshot(id, save ?? null, living);
      if (snap) {
        return (
          `- ${snap.name}：${snap.personality}；好感${snap.affinity}；` +
          `外观${snap.activeSkinName}；武装${snap.weaponName ?? '无'}；` +
          `${snap.activity ? activityInChinese(snap.activity) : '在营'} @ ${snap.locationHint ?? '?'}`
        );
      }
      const p = getAiProfile(id);
      const n = CHARACTER_MAP[id]?.name ?? id;
      return `- ${n}：${p?.emotionalBaseline ?? ''}；据点印象 ${p?.homeBase ?? '?'}`;
    })
    .join('\n');

  return {
    system:
      '你是锈带纪元营地日志官。用有生活气息的短句写 4–6 条日志（中文），像日记而非战报。只输出 JSON：{"summary":"总述一句","events":["…","…"]}',
    user: [
      buildWorldSyncPromptBlock(),
      `玩家（指挥官）离开了约 ${offlineHours.toFixed(1)} 小时——那段时间他默认沉睡离线/不在营，角色们过自己的营地生活。`,
      `当前游戏日：${living.dayIndex + 1}`,
      `在营角色（实时）：\n${casts}`,
      `近期营地日志：\n${living.campLog
        .slice(0, 5)
        .map((l) => `- ${l.text}`)
        .join('\n') || '（无）'}`,
      `写日志时记住：指挥官是矮小废弃机器人；离线≠他还在院里陪她们。`,
    ].join('\n\n'),
  };
}
