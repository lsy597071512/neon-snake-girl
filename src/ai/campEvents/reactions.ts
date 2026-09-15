/**
 * 营地事件角色反应：本地规则掷骰 → 赴约/回避 → 同屏成员
 */
import { CHARACTER_MAP } from '../../data/characters';
import { CAMP_ROOM_MAP, getCharacterSleepRoom } from '../../data/campLayout';
import { getAiProfile } from '../aiProfiles';
import { dailyTopicSeed, forceEventAgenda, resolveCurrentRoomId } from '../characterAgenda';
import { pushCampLog, pushMemory } from '../memory';
import { bumpPairwiseRelations, getAffinity, getRelation } from '../relationship';
import type {
  AiLivingSave,
  CampEventInstance,
  CampEventParticipant,
  CampEventReactionKind,
  CharacterActivity,
} from '../types';
import { saveManager } from '../../core/SaveManager';
import { defaultJoinReactions, getCampEventDef, type CampEventDef } from './catalog';
import {
  capCoScreenMemberIds,
  resolveCoScreenJoinCap,
  syncCoScreenParticipantWorld,
} from './coScreenSync';

function hash01(seed: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function roomLabel(roomId: string): string {
  const room = CAMP_ROOM_MAP[roomId];
  if (!room) return roomId;
  const yardish =
    room.kind === 'yard' ||
    room.kind === 'tower' ||
    room.kind === 'pool' ||
    room.kind === 'shop' ||
    room.kind === 'armory';
  return yardish ? `院落·${room.label}` : `${room.floor}楼·${room.label}`;
}

const STANCE_LABEL: Record<CampEventReactionKind, string> = {
  investigate: '去查看出了什么事',
  help: '主动帮忙',
  recruit: '想拉人一起处理',
  spectate: '想去看热闹/围观',
  avoid: '想躲开',
  ignore: '假装没看见',
  vent: '心里有情绪想吐槽',
};

function tweakWeights(
  def: CampEventDef,
  characterId: string,
  living: AiLivingSave,
): Record<CampEventReactionKind, number> {
  const base: Record<CampEventReactionKind, number> = {
    investigate: def.reactionWeights.investigate ?? 0,
    help: def.reactionWeights.help ?? 0,
    recruit: def.reactionWeights.recruit ?? 0,
    spectate: def.reactionWeights.spectate ?? 0,
    avoid: def.reactionWeights.avoid ?? 0,
    ignore: def.reactionWeights.ignore ?? 1,
    vent: def.reactionWeights.vent ?? 0,
  };
  const profile = getAiProfile(characterId);
  const fears = profile?.fears ?? [];
  const needs = profile?.coreNeeds ?? [];
  const personality = CHARACTER_MAP[characterId]?.personality ?? '';

  if (fears.some((f) => /沙|风|暴|外|暗|鬼/.test(f))) {
    if (def.tags.includes('fear')) {
      base.avoid += 4;
      base.spectate = Math.max(0, base.spectate - 2);
      base.vent += 2;
    }
  }
  if (needs.some((n) => /安全|守|秩序|修|机械/.test(n)) || /守|修|纪律|冷静/.test(personality)) {
    base.help += 2;
    base.investigate += 1;
  }
  if (needs.some((n) => /社交|热闹|玩|聊/.test(n)) || /吵|活泼|起哄|贫嘴/.test(personality)) {
    base.spectate += 2;
    if (def.tags.includes('social') || def.tags.includes('chat')) base.help += 1;
  }
  if (def.tags.includes('jealousy')) {
    const aff = getAffinity(living, characterId);
    if (aff < 45) base.vent += 3;
    if (aff >= 60) base.avoid += 2;
  }
  if (def.tags.includes('repair') && /机|频|修|械/.test(personality + (profile?.summary ?? ''))) {
    base.help += 3;
    base.recruit += 1;
  }
  if (def.preferMinJoiners && def.preferMinJoiners >= 2) {
    base.spectate += 1;
    base.help += 1;
  }
  // 闲聊预圈成员：提高赴约意愿，但不强制入场（仍由掷骰决定）
  const meta = living.activeCampEvents?.find((e) => e.defId === def.id)?.meta;
  if (meta?.[`chat_${characterId}`] === '1') {
    base.spectate += 3;
    base.help += 2;
    base.ignore = Math.max(0, base.ignore - 2);
  }

  if (meta?.partyA === characterId || meta?.partyB === characterId) {
    base.vent += 5;
    base.spectate += 2;
    base.ignore = 0;
  }
  if (meta?.injured === characterId) {
    base.avoid += 3;
    base.help = 0;
  }
  // 闲聊：关系好的人更想凑
  if (def.tags.includes('chat')) {
    base.spectate += 2;
  }

  return base;
}

export function rollReaction(
  living: AiLivingSave,
  characterId: string,
  def: CampEventDef,
  outcomeSeed: number,
): CampEventReactionKind {
  const weights = tweakWeights(def, characterId, living);
  const entries = Object.entries(weights).filter(([, w]) => w > 0) as [CampEventReactionKind, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0) || 1;
  let roll = hash01(characterId + def.id, outcomeSeed) * total;
  for (const [kind, w] of entries) {
    roll -= w;
    if (roll <= 0) return kind;
  }
  return entries[0]?.[0] ?? 'ignore';
}

function behaviorFor(
  def: CampEventDef,
  reaction: CampEventReactionKind,
  targetRoom: string,
): { activity: CharacterActivity; behavior: string; reason: string; goal: string } {
  const place = roomLabel(targetRoom);
  switch (reaction) {
    case 'investigate':
      return {
        goal: `event_${def.id}_invest`,
        activity: def.arriveActivity,
        behavior: `在${place}查看「${def.name}」`,
        reason: `想搞清${def.name}`,
      };
    case 'help':
      return {
        goal: `event_${def.id}_help`,
        activity:
          def.arriveActivity === 'eat'
            ? 'eat'
            : def.arriveActivity === 'play'
              ? 'play'
              : def.arriveActivity === 'talking'
                ? 'talking'
                : 'maintain',
        behavior: `在${place}处理「${def.name}」`,
        reason: `帮忙应对${def.name}`,
      };
    case 'recruit':
      return {
        goal: `event_${def.id}_recruit`,
        activity: 'busy',
        behavior: `赶去${place}并想叫人`,
        reason: `拉人一起处理${def.name}`,
      };
    case 'spectate':
      return {
        goal: `event_${def.id}_watch`,
        activity: def.arriveActivity === 'guard' ? 'guard' : def.arriveActivity === 'talking' ? 'talking' : 'idle',
        behavior: `在${place}参与「${def.name}」`,
        reason: `赴约${def.name}`,
      };
    case 'avoid':
      return {
        goal: `event_${def.id}_avoid`,
        activity: 'rest',
        behavior: '躲回安全处避开骚动',
        reason: `躲开${def.name}`,
      };
    case 'vent':
      return {
        goal: `event_${def.id}_vent`,
        activity: 'talking',
        behavior: `因为「${def.name}」心里不痛快`,
        reason: `对${def.name}有情绪`,
      };
    case 'ignore':
    default:
      return {
        goal: `event_${def.id}_ignore`,
        activity: 'idle',
        behavior: '继续自己的事，没理会骚动',
        reason: `不管${def.name}`,
      };
  }
}

/** 为闲聊事件挑选话题与核心成员（AI 本地决策） */
function pickChatCircle(
  living: AiLivingSave,
  ownedIds: string[],
  outcomeSeed: number,
  maxJoiners: number,
): { members: string[]; topic: string } {
  const scored = ownedIds.map((id) => {
    let social = 0;
    for (const other of ownedIds) {
      if (other === id) continue;
      social += getRelation(living, id, other);
    }
    const needs = getAiProfile(id)?.coreNeeds ?? [];
    if (needs.some((n) => /社交|聊|陪伴/.test(n))) social += 40;
    social += hash01(id, outcomeSeed) * 30;
    return { id, social };
  });
  scored.sort((a, b) => b.social - a.social);
  const host = scored[0]?.id ?? ownedIds[0];
  const rest = scored.filter((s) => s.id !== host);
  // 主人优先拉关系好的
  rest.sort(
    (a, b) =>
      getRelation(living, host, b.id) - getRelation(living, host, a.id) ||
      b.social - a.social,
  );
  const want = Math.min(
    maxJoiners,
    Math.max(2, 2 + Math.floor(hash01(host, outcomeSeed + 3) * Math.min(3, ownedIds.length - 1))),
  );
  const members = [host, ...rest.slice(0, want - 1).map((r) => r.id)];
  const topic = dailyTopicSeed(living, host);
  return { members, topic };
}

function isJoinReaction(def: CampEventDef, reaction: CampEventReactionKind): boolean {
  const joins = defaultJoinReactions(def);
  if (joins.includes(reaction)) return true;
  // vent 在八卦/吃醋/闲聊里也算入场
  if (reaction === 'vent' && (def.tags.includes('chat') || def.tags.includes('jealousy') || def.tags.includes('conflict'))) {
    return true;
  }
  return false;
}

/** 激活阶段：分配反应、赴约议程、同屏成员（本地性格掷骰；不强制全员入场） */
export function assignReactionsOnActivate(
  living: AiLivingSave,
  ev: CampEventInstance,
  ownedIds: string[],
): void {
  const def = getCampEventDef(ev.defId);
  if (!def) return;

  const remain = Math.max(20, ev.endsAtGameMin - living.gameMinutes);
  const maxJoin = resolveCoScreenJoinCap(def.maxJoiners);
  const participants: CampEventParticipant[] = [];

  // 闲聊：先定圈子与话题
  if (def.tags.includes('chat') || def.id === 'npc_multi_chat') {
    const circle = pickChatCircle(living, ownedIds, ev.outcomeSeed, maxJoin);
    ev.meta = { ...(ev.meta ?? {}), chatTopic: circle.topic, chatHost: circle.members[0] };
    for (const id of circle.members) {
      (ev.meta as Record<string, string>)[`chat_${id}`] = '1';
    }
  }

  // 先掷反应
  const rolled: { id: string; reaction: CampEventReactionKind }[] = [];
  for (const id of ownedIds) {
    let reaction = rollReaction(living, id, def, ev.outcomeSeed + id.length * 17);
    // 争吵双方强制在场
    if (ev.meta?.partyA === id || ev.meta?.partyB === id) {
      reaction = 'vent';
    }
    rolled.push({ id, reaction });
  }

  // 限额赴约：按优先级截断
  const joinPriority = (r: CampEventReactionKind) =>
    r === 'help' || r === 'recruit' ? 3 : r === 'investigate' ? 2 : r === 'spectate' || r === 'vent' ? 1 : 0;

  let joiners = rolled
    .filter((r) => isJoinReaction(def, r.reaction))
    .sort(
      (a, b) =>
        joinPriority(b.reaction) - joinPriority(a.reaction) ||
        hash01(a.id, ev.outcomeSeed) - hash01(b.id, ev.outcomeSeed),
    );

  if (joiners.length > maxJoin) {
    const cut = new Set(joiners.slice(maxJoin).map((j) => j.id));
    for (const r of rolled) {
      if (cut.has(r.id) && r.reaction !== 'vent') r.reaction = 'ignore';
    }
    joiners = joiners.slice(0, maxJoin);
  }

  // preferMinJoiners：仅目录显式声明时才补人（默认不强制拉全员）
  const preferMin = def.preferMinJoiners ?? 0;
  if (preferMin > 0 && joiners.length < preferMin) {
    const need = preferMin - joiners.length;
    const candidates = rolled
      .filter((r) => !joiners.some((j) => j.id === r.id))
      .sort((a, b) => getRelation(living, joiners[0]?.id ?? a.id, b.id) - getRelation(living, joiners[0]?.id ?? a.id, a.id));
    for (const c of candidates.slice(0, need)) {
      c.reaction = 'spectate';
      joiners.push(c);
    }
  }

  const joinerSet = new Set(joiners.map((j) => j.id));

  for (const { id, reaction } of rolled) {
    const inCoScreen = joinerSet.has(id) && isJoinReaction(def, reaction);
    let targetRoom = def.focusRoomId;
    if (reaction === 'avoid' || (!inCoScreen && reaction === 'ignore')) {
      targetRoom = reaction === 'avoid' ? getCharacterSleepRoom(id).id : resolveCurrentRoomId(living, id);
    } else if (inCoScreen) {
      targetRoom = def.focusRoomId;
    } else if (reaction === 'vent' && !inCoScreen) {
      targetRoom = resolveCurrentRoomId(living, id);
    }

    const pack = behaviorFor(def, inCoScreen ? (reaction === 'ignore' ? 'spectate' : reaction) : reaction, targetRoom);
    if (reaction === 'avoid') {
      pack.behavior = `躲在${roomLabel(targetRoom)}避开「${def.name}」`;
    }
    if (def.tags.includes('chat') && inCoScreen && ev.meta?.chatTopic) {
      pack.behavior = `在${roomLabel(targetRoom)}聊「${ev.meta.chatTopic}」`;
      pack.reason = `想聊：${ev.meta.chatTopic}`;
      pack.activity = 'talking';
    }

    if (inCoScreen || reaction === 'avoid') {
      forceEventAgenda(living, id, {
        goal: pack.goal,
        targetRoomId: targetRoom,
        activity: pack.activity,
        behavior: pack.behavior,
        remainGameMin: remain,
        reason: pack.reason,
        eventInstanceId: ev.instanceId,
        eventStance: reaction,
      });
    }

    participants.push({
      characterId: id,
      reaction,
      arrived: false,
      contributed: false,
      inCoScreen,
    });

    const name = CHARACTER_MAP[id]?.name ?? id;
    const line = inCoScreen
      ? `${name}：赴约「${def.name}」· ${STANCE_LABEL[reaction]}`
      : `${name}：${STANCE_LABEL[reaction]}（未入场）`;
    ev.logLines.push(line);
    pushMemory(living, id, {
      kind: 'event',
      summary: `${def.name} → ${STANCE_LABEL[reaction]}${inCoScreen ? '·同场' : ''}`,
      importance: inCoScreen ? 5 : 3,
    });
  }

  ev.participants = participants;

  // recruit：拉一个未入场者（仍受同屏人数上限约束）
  const recruiter = participants.find((p) => p.reaction === 'recruit' && p.inCoScreen);
  if (recruiter && participants.filter((p) => p.inCoScreen).length < maxJoin) {
    const target = participants.find((p) => !p.inCoScreen && (p.reaction === 'ignore' || p.reaction === 'avoid'));
    if (target) {
      const rn = CHARACTER_MAP[recruiter.characterId]?.name ?? recruiter.characterId;
      const tn = CHARACTER_MAP[target.characterId]?.name ?? target.characterId;
      pushCampLog(living, {
        text: `${rn}发现「${def.name}」，喊上了${tn}一起去${roomLabel(def.focusRoomId)}。`,
        source: 'npc',
        characterIds: [recruiter.characterId, target.characterId],
      });
      forceEventAgenda(living, target.characterId, {
        goal: `event_${def.id}_helped`,
        targetRoomId: def.focusRoomId,
        activity: def.arriveActivity,
        behavior: `被叫去${roomLabel(def.focusRoomId)}帮忙`,
        remainGameMin: remain,
        reason: `${rn}叫我去帮忙`,
        eventInstanceId: ev.instanceId,
        eventStance: 'help',
      });
      target.reaction = 'help';
      target.inCoScreen = true;
      target.contributed = true;
      bumpPairwiseRelations(living, [recruiter.characterId, target.characterId], 2);
    }
  }

  // 同屏成员：硬上限 6；落位 + 统一场景/外覆
  const coIds = capCoScreenMemberIds(
    participants.filter((p) => p.inCoScreen).map((p) => p.characterId),
    maxJoin,
  );
  const coSet = new Set(coIds);
  for (const p of participants) {
    if (p.inCoScreen && !coSet.has(p.characterId)) p.inCoScreen = false;
  }
  if (def.allowsCoScreen && coIds.length >= 2) {
    ev.coScreenIds = coIds;
    bumpPairwiseRelations(living, coIds, 1);
    pushCampLog(living, {
      text: `【多人场景】${def.name}：${coIds.map((id) => CHARACTER_MAP[id]?.name ?? id).join('、')}同场（可同屏对话，最多${maxJoin}人）`,
      source: 'system',
      characterIds: coIds,
    });
    syncCoScreenParticipantWorld(saveManager.get(), living, ev);
  } else {
    ev.coScreenIds = [];
    ev.meta = { ...(ev.meta ?? {}), coScreenFull: '0' };
  }

  pushCampLog(living, {
    text: `【事件激活】${def.name}：${def.blurb}${
      ev.meta?.chatTopic ? ` 话题「${ev.meta.chatTopic}」` : ''
    }`,
    source: 'system',
    characterIds: participants.map((p) => p.characterId),
  });
}

export function warnBlurb(def: CampEventDef): string {
  return `【预警】${def.name}将在不久后发生——${def.blurb}`;
}

export function stanceLabel(kind: CampEventReactionKind): string {
  return STANCE_LABEL[kind];
}

export function describeCharacterEventStance(
  living: AiLivingSave,
  characterId: string,
): string | null {
  const events = living.activeCampEvents ?? [];
  if (!events.length) return null;
  const lines: string[] = [];
  for (const evInst of events) {
    const def = getCampEventDef(evInst.defId);
    if (!def) continue;
    const part = evInst.participants.find((p) => p.characterId === characterId);
    const phase =
      evInst.phase === 'warn' ? '即将发生' : evInst.phase === 'active' ? '正在发生' : '即将结束';
    if (evInst.phase === 'warn') {
      lines.push(`营地「${def.name}」${phase}（焦点：${roomLabel(def.focusRoomId)}）。你可能已听说风声。`);
      continue;
    }
    if (part) {
      const co =
        part.inCoScreen && (evInst.coScreenIds?.length ?? 0) >= 2
          ? `你与 ${evInst.coScreenIds!.filter((id) => id !== characterId)
              .slice(0, 6)
              .map((id) => CHARACTER_MAP[id]?.name ?? id)
              .join('、')} 同场。`
          : '';
      const topic = evInst.meta?.chatTopic ? `大家在聊「${evInst.meta.chatTopic}」。` : '';
      let quarrel = '';
      if (def.id === 'argument' && evInst.meta?.partyA && evInst.meta?.partyB) {
        const na = CHARACTER_MAP[evInst.meta.partyA]?.name ?? evInst.meta.partyA;
        const nb = CHARACTER_MAP[evInst.meta.partyB]?.name ?? evInst.meta.partyB;
        const selfSide =
          characterId === evInst.meta.partyA
            ? `你就是当事人之一，正在和${nb}吵。`
            : characterId === evInst.meta.partyB
              ? `你就是当事人之一，正在和${na}吵。`
              : `${na}与${nb}正在对吵，你在旁边。`;
        quarrel = `矛盾焦点：${selfSide}`;
      }
      let skinBit = '';
      if (part.inCoScreen) {
        const place = roomLabel(def.focusRoomId);
        skinBit = `你与同场所有人此刻都在${place}（事件焦点场景），穿着与活动一致的外覆；禁止说自己在别的房间、或仍穿着睡眠/浴室皮。`;
        if (evInst.meta?.coScreenFull === '1') {
          skinBit += `同场已满（最多${evInst.meta.coScreenCap ?? '6'}人），不再扩招。`;
        }
      } else if (part.arrived) {
        if (def.id === 'pool_party') {
          const suited = (evInst.meta?.swimsuitIds ?? '').split(',').filter(Boolean);
          skinBit = suited.includes(characterId)
            ? '你已换上泳池派对泳装外覆（营地事件穿搭）。'
            : '你在戏水；若有泳装外覆应换上，没有专属资源也能玩。';
        } else if (
          def.id === 'movie_night' ||
          def.id === 'night_snack' ||
          def.id === 'entertainment_night' ||
          def.id === 'sleepwalk_scare'
        ) {
          const pajama = (evInst.meta?.eventSkinIds ?? '').split(',').filter(Boolean);
          const kept = (evInst.meta?.eventSkinKeptOwned ?? '').split(',').filter(Boolean);
          skinBit =
            pajama.includes(characterId) || kept.includes(characterId)
              ? '你正穿着星夜睡衣外覆参与这次夜间活动（事件结束后会回到事件前的营地穿搭/默认原皮）。'
              : '夜间活动：若有星夜睡衣外覆可穿上；也可用 skin_change。';
        } else {
          skinBit =
            '事件进行中你可用 skin_change 换衣柜里任意外覆；结束后临时层收回，回到营地日常穿搭（与主页购买/应用无关）。';
        }
      }
      lines.push(
        `营地「${def.name}」${phase}——${def.blurb}态度：${STANCE_LABEL[part.reaction]}。${co}${topic}${quarrel}${skinBit}` +
          `本轮说话必须围绕这件事，禁止岔开到无关的风向/沙尘/作息闲聊。`,
      );
    } else {
      lines.push(`营地「${def.name}」${phase}——${def.blurb}`);
    }
  }
  return lines.join('\n') || null;
}
