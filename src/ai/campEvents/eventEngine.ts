/**
 * 营地随机事件引擎：生成 / 倒计时 / 激活 / 结算
 */
import { CHARACTER_MAP } from '../../data/characters';
import { CAMP_ROOM_MAP } from '../../data/campLayout';
import { clearAgenda, getAgenda, resolveCurrentRoomId } from '../characterAgenda';
import { evolvePersonaAfterEvent } from '../characterPersona';
import { recordLifeNote } from '../lifeArchive';
import { pushCampLog, pushMemory } from '../memory';
import { adjustAffinity, adjustRelation, bumpPairwiseRelations, getAffinity } from '../relationship';
import type {
  AiLivingSave,
  CampEventHistoryEntry,
  CampEventInstance,
  LightStatusTag,
} from '../types';
import { getHour, gameMinutesToRealSeconds } from '../worldClock';
import { CAMP_EVENT_CATALOG, getCampEventDef, type CampEventDef } from './catalog';
import { clearEventTempSkinsForInstance } from './campEventEffects';
import { refreshCoScreenMembership } from './coScreen';
import { assignReactionsOnActivate, warnBlurb } from './reactions';

const MAX_ACTIVE = 2;
const MAX_HISTORY = 48;
/** 两次事件尝试的全局最小间隔（游戏分钟） */
const GLOBAL_SPAWN_GAP = 90;

function ensureEventFields(living: AiLivingSave): void {
  if (!living.activeCampEvents) living.activeCampEvents = [];
  if (!living.eventHistory) living.eventHistory = [];
  if (living.lastCampEventSpawnGameMin == null) living.lastCampEventSpawnGameMin = 0;
  if (!living.agendas) living.agendas = {};
}

function newInstanceId(defId: string, gameMin: number): string {
  return `${defId}_${gameMin}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function roomLabel(roomId: string): string {
  const room = CAMP_ROOM_MAP[roomId];
  if (!room) return roomId;
  const yardish = room.kind === 'yard' || room.kind === 'tower' || room.kind === 'pool' || room.kind === 'shop' || room.kind === 'armory';
  return yardish ? `院落·${room.label}` : `${room.floor}楼·${room.label}`;
}

function pickMeta(def: CampEventDef, ownedIds: string[], living: AiLivingSave): Record<string, string> {
  const meta: Record<string, string> = {};
  if (!ownedIds.length) return meta;
  const shuffled = [...ownedIds].sort(
    (a, b) => getAffinity(living, a) - getAffinity(living, b) || a.localeCompare(b),
  );

  if (def.id === 'argument' && ownedIds.length >= 2) {
    // 关系最差或随机两人
    let worst = { a: ownedIds[0], b: ownedIds[1], score: 999 };
    for (let i = 0; i < ownedIds.length; i++) {
      for (let j = i + 1; j < ownedIds.length; j++) {
        const key = ownedIds[i] < ownedIds[j] ? `${ownedIds[i]}|${ownedIds[j]}` : `${ownedIds[j]}|${ownedIds[i]}`;
        const rel = living.relationships[key] ?? 0;
        if (rel < worst.score) worst = { a: ownedIds[i], b: ownedIds[j], score: rel };
      }
    }
    meta.partyA = worst.a;
    meta.partyB = worst.b;
  }
  if (def.id === 'jealousy_spark' && ownedIds.length >= 2) {
    const byAff = [...ownedIds].sort((a, b) => getAffinity(living, b) - getAffinity(living, a));
    meta.favored = byAff[0];
    meta.jealous = byAff[byAff.length - 1] !== byAff[0] ? byAff[byAff.length - 1] : byAff[1];
  }
  if (def.id === 'injury_scare') {
    meta.injured = shuffled[Math.floor(Math.random() * shuffled.length)];
  }
  return meta;
}

function recentlyHad(living: AiLivingSave, defId: string, withinGameMin: number): boolean {
  const hist = living.eventHistory ?? [];
  for (const h of hist) {
    if (h.defId === defId && living.gameMinutes - h.endedAtGameMin < withinGameMin) return true;
  }
  for (const a of living.activeCampEvents ?? []) {
    if (a.defId === defId) return true;
  }
  return false;
}

function eligibleDefs(living: AiLivingSave): CampEventDef[] {
  const hour = getHour(living);
  return CAMP_EVENT_CATALOG.filter((d) => {
    if (!d.hours.includes(hour)) return false;
    if (recentlyHad(living, d.id, d.minGapGameMin)) return false;
    return true;
  });
}

function weightedPick(defs: CampEventDef[], seed: number): CampEventDef | null {
  if (!defs.length) return null;
  const total = defs.reduce((s, d) => s + d.weight, 0);
  let roll = ((seed % 1000) / 1000) * total;
  for (const d of defs) {
    roll -= d.weight;
    if (roll <= 0) return d;
  }
  return defs[defs.length - 1];
}

/** 尝试生成一个预警事件 */
export function trySpawnCampEvent(
  living: AiLivingSave,
  ownedIds: string[],
  opts?: { forceDefId?: string; chance?: number; bypassGap?: boolean },
): CampEventInstance | null {
  ensureEventFields(living);
  if (!ownedIds.length) return null;
  if ((living.activeCampEvents?.length ?? 0) >= MAX_ACTIVE) return null;

  const since = living.gameMinutes - (living.lastCampEventSpawnGameMin ?? 0);
  if (!opts?.forceDefId && !opts?.bypassGap && since < GLOBAL_SPAWN_GAP) return null;

  const chance = opts?.chance ?? 0.55;
  if (!opts?.forceDefId && !opts?.bypassGap && Math.random() > chance) {
    living.lastCampEventSpawnGameMin = living.gameMinutes;
    return null;
  }

  const pool = opts?.forceDefId
    ? CAMP_EVENT_CATALOG.filter((d) => d.id === opts.forceDefId)
    : eligibleDefs(living);
  const def = weightedPick(
    pool.length ? pool : CAMP_EVENT_CATALOG,
    living.gameMinutes * 13 + living.dayIndex * 7,
  );
  if (!def) {
    living.lastCampEventSpawnGameMin = living.gameMinutes;
    return null;
  }

  const warnEnds = opts?.bypassGap ? living.gameMinutes : living.gameMinutes + def.warnGameMin;
  const ends = warnEnds + def.activeGameMin;
  const ev: CampEventInstance = {
    instanceId: newInstanceId(def.id, living.gameMinutes),
    defId: def.id,
    phase: opts?.bypassGap ? 'active' : 'warn',
    startedGameMin: living.gameMinutes,
    warnEndsAtGameMin: warnEnds,
    endsAtGameMin: ends,
    focusRoomId: def.focusRoomId,
    participants: [],
    logLines: [],
    outcomeSeed: (living.gameMinutes * 17 + def.id.length * 31) % 100000,
    meta: pickMeta(def, ownedIds, living),
  };

  living.activeCampEvents!.push(ev);
  living.lastCampEventSpawnGameMin = living.gameMinutes;

  if (opts?.bypassGap) {
    assignReactionsOnActivate(living, ev, ownedIds);
    const text = `【事件激活】${def.name}：${def.blurb}`;
    pushCampLog(living, { text, source: 'system' });
    void recordLifeNote(living, text, { kind: 'camp' });
  } else {
    const text = warnBlurb(def);
    pushCampLog(living, { text, source: 'system' });
    void recordLifeNote(living, text, { kind: 'camp' });
  }
  return ev;
}

function markArrivals(living: AiLivingSave, ev: CampEventInstance): void {
  const def = getCampEventDef(ev.defId);
  if (!def) return;
  for (const p of ev.participants) {
    const room = resolveCurrentRoomId(living, p.characterId);
    if (room === def.focusRoomId || room === ev.focusRoomId) {
      p.arrived = true;
      if (p.reaction === 'help' || p.reaction === 'investigate' || p.reaction === 'recruit') {
        p.contributed = true;
      }
    }
  }
  refreshCoScreenMembership(living, ev);
}

function addStatus(living: AiLivingSave, characterId: string, tag: LightStatusTag): void {
  const cur = new Set(living.characterStatus[characterId] ?? []);
  cur.add(tag);
  living.characterStatus[characterId] = [...cur].slice(0, 4) as LightStatusTag[];
}

export type CampEventResolveResult = {
  summary: string;
  goldDelta: number;
};

function resolveEvent(
  living: AiLivingSave,
  ev: CampEventInstance,
  ownedIds: string[],
  applyGold: (delta: number) => void,
): CampEventResolveResult {
  const def = getCampEventDef(ev.defId);
  if (!def) {
    return { summary: '未知事件结束', goldDelta: 0 };
  }

  markArrivals(living, ev);
  const helpers = ev.participants.filter((p) => p.contributed || p.reaction === 'help');
  const avoiders = ev.participants.filter((p) => p.reaction === 'avoid' || p.reaction === 'ignore');
  const watchers = ev.participants.filter((p) => p.reaction === 'spectate');
  let goldDelta = 0;
  const bits: string[] = [];

  const nameOf = (id: string) => CHARACTER_MAP[id]?.name ?? id;

  switch (def.id) {
    case 'machine_breakdown':
    case 'power_flicker': {
      if (helpers.length > 0) {
        bits.push(`${helpers.map((p) => nameOf(p.characterId)).join('、')}稳住了机房。`);
        for (const p of helpers) adjustAffinity(living, p.characterId, 2);
        goldDelta = 0;
      } else {
        bits.push('没人及时处理，营地损耗了一些零件。');
        goldDelta = -25;
        applyGold(goldDelta);
      }
      break;
    }
    case 'sandstorm': {
      for (const p of watchers) {
        addStatus(living, p.characterId, 'fear_state');
        bits.push(`${nameOf(p.characterId)}在门口看了风暴。`);
      }
      for (const p of avoiders) {
        adjustAffinity(living, p.characterId, 1);
      }
      for (const p of ev.participants.filter((x) => x.reaction === 'vent')) {
        addStatus(living, p.characterId, 'anxiety_state');
      }
      if (!bits.length) bits.push('沙尘暴掠过营地门口，大家各自安顿。');
      break;
    }
    case 'communal_meal':
    case 'entertainment_night':
    case 'small_celebration': {
      const joiners = ev.participants.filter(
        (p) => p.arrived || p.reaction === 'spectate' || p.reaction === 'help',
      );
      for (const p of joiners) adjustAffinity(living, p.characterId, def.id === 'small_celebration' ? 2 : 3);
      if (joiners.length >= 2) {
        for (let i = 0; i < joiners.length; i++) {
          for (let j = i + 1; j < joiners.length; j++) {
            adjustRelation(living, joiners[i].characterId, joiners[j].characterId, 2);
          }
        }
      }
      bits.push(
        `${joiners.map((p) => nameOf(p.characterId)).join('、') || '几乎没人'}参加了「${def.name}」。`,
      );
      if (def.id === 'small_celebration' && joiners.length >= 2) {
        goldDelta = -15;
        applyGold(goldDelta);
        bits.push('庆祝花了一点锈币。');
      }
      break;
    }
    case 'hot_water_rush': {
      const bathers = ev.participants.filter((p) => p.arrived);
      if (bathers.length >= 2) {
        adjustRelation(living, bathers[0].characterId, bathers[1].characterId, -4);
        bits.push(`${nameOf(bathers[0].characterId)}与${nameOf(bathers[1].characterId)}为热水闹得不愉快。`);
      } else {
        bits.push('热水危机在抱怨声中过去了。');
      }
      break;
    }
    case 'argument': {
      const a = ev.meta?.partyA;
      const b = ev.meta?.partyB;
      if (a && b) {
        adjustRelation(living, a, b, -8);
        bits.push(`${nameOf(a)}与${nameOf(b)}吵了一架。`);
        const mediators = helpers.filter((p) => p.characterId !== a && p.characterId !== b);
        for (const m of mediators) {
          adjustAffinity(living, m.characterId, 2);
          adjustRelation(living, m.characterId, a, 1);
          adjustRelation(living, m.characterId, b, 1);
        }
        if (mediators.length) {
          bits.push(`${mediators.map((p) => nameOf(p.characterId)).join('、')}上前劝了劝。`);
        }
      }
      break;
    }
    case 'supply_cache': {
      if (helpers.length || watchers.some((p) => p.arrived)) {
        goldDelta = 40 + helpers.length * 5;
        applyGold(goldDelta);
        bits.push(`搜出补给，锈币 +${goldDelta}。`);
        for (const p of [...helpers, ...watchers.filter((w) => w.arrived)]) {
          adjustAffinity(living, p.characterId, 2);
        }
      } else {
        bits.push('补给线索被忽略，什么也没拿到。');
      }
      break;
    }
    case 'inventory_theft': {
      goldDelta = -35;
      applyGold(goldDelta);
      bits.push(`仓库短少物资，锈币 ${goldDelta}。`);
      const suspects = ev.participants.filter((p) => p.reaction === 'vent' || p.reaction === 'investigate');
      if (suspects.length >= 2) {
        adjustRelation(living, suspects[0].characterId, suspects[1].characterId, -5);
        bits.push(`${nameOf(suspects[0].characterId)}与${nameOf(suspects[1].characterId)}互相猜疑。`);
      }
      break;
    }
    case 'jealousy_spark': {
      const jealous = ev.meta?.jealous;
      const favored = ev.meta?.favored;
      if (jealous) {
        adjustAffinity(living, jealous, -4);
        addStatus(living, jealous, 'jealousy');
        bits.push(`${nameOf(jealous)}明显吃味了。`);
      }
      if (favored) {
        adjustAffinity(living, favored, 1);
      }
      break;
    }
    case 'night_alert': {
      if (helpers.length) {
        for (const p of helpers) adjustAffinity(living, p.characterId, 3);
        bits.push(`${helpers.map((p) => nameOf(p.characterId)).join('、')}守住了夜间警戒。`);
      } else {
        bits.push('夜间异响未得回应，大家一夜不安。');
        for (const id of ownedIds.slice(0, 3)) addStatus(living, id, 'anxiety_state');
      }
      break;
    }
    case 'radio_ping': {
      const curious = ev.participants.filter((p) => p.reaction === 'investigate' || p.arrived);
      for (const p of curious) {
        pushMemory(living, p.characterId, {
          kind: 'event',
          summary: '听过一段怪短波信号',
          importance: 4,
        });
      }
      bits.push(
        curious.length
          ? `${curious.map((p) => nameOf(p.characterId)).join('、')}记下了怪信号。`
          : '怪信号闪过，无人深究。',
      );
      break;
    }
    case 'injury_scare': {
      const injured = ev.meta?.injured;
      if (injured) {
        addStatus(living, injured, 'injured');
        bits.push(`${nameOf(injured)}擦伤了。`);
        for (const p of helpers) {
          if (p.characterId === injured) continue;
          adjustAffinity(living, p.characterId, 3);
          adjustRelation(living, p.characterId, injured, 3);
        }
        if (helpers.some((p) => p.characterId !== injured)) {
          bits.push(`${helpers.filter((p) => p.characterId !== injured).map((p) => nameOf(p.characterId)).join('、')}帮了忙。`);
        }
      }
      break;
    }
    case 'pool_party': {
      const joiners = ev.participants.filter((p) => p.inCoScreen || p.arrived);
      for (const p of joiners) adjustAffinity(living, p.characterId, 3);
      if (joiners.length >= 2) {
        bumpPairwiseRelations(
          living,
          joiners.map((p) => p.characterId),
          3,
        );
      }
      const suited = (ev.meta?.swimsuitIds ?? '')
        .split(',')
        .filter(Boolean)
        .map(nameOf);
      const bare = (ev.meta?.swimsuitNoAsset ?? '')
        .split(',')
        .filter(Boolean)
        .map(nameOf);
      bits.push(
        `${joiners.map((p) => nameOf(p.characterId)).join('、') || '几乎没人'}办完了泳池派对。`,
      );
      if (suited.length) bits.push(`${suited.join('、')}换过泳装外覆。`);
      if (bare.length) bits.push(`${bare.join('、')}无专属泳装仍下水玩了。`);
      break;
    }
    case 'shop_self_repair_buy': {
      const buyers = ev.participants.filter(
        (p) =>
          p.arrived &&
          (p.reaction === 'help' || p.reaction === 'investigate' || p.contributed),
      );
      const n = Math.max(buyers.length, helpers.length ? helpers.length : 0);
      const count = n || (watchers.some((w) => w.arrived) ? 1 : 0);
      if (count > 0) {
        goldDelta = -count; // 每人自助购一次 -1 锈币
        applyGold(goldDelta);
        bits.push(
          `${(buyers.length ? buyers : helpers).map((p) => nameOf(p.characterId)).join('、') || '有人'}在商店自助买了修理道具，锈币 ${goldDelta}（每次 -1）。`,
        );
        for (const p of buyers.length ? buyers : helpers) {
          adjustAffinity(living, p.characterId, 1);
          pushMemory(living, p.characterId, {
            kind: 'event',
            summary: '在营地商店自助购买修理营地/装备的道具（扣 1 锈币）',
            importance: 4,
          });
        }
      } else {
        bits.push('商店开着，但没人自助下单。');
      }
      break;
    }
    case 'gate_outing_thought': {
      const thinkers = ev.participants.filter((p) => p.arrived || p.inCoScreen);
      for (const p of thinkers) {
        pushMemory(living, p.characterId, {
          kind: 'event',
          summary: '在营地大门内望向远处，起了外出心思，但没有走出大门',
          importance: 4,
        });
      }
      bits.push(
        thinkers.length
          ? `${thinkers.map((p) => nameOf(p.characterId)).join('、')}在门内消化了外出冲动，人仍留在营里。`
          : '门外心思散了，无人久站。',
      );
      break;
    }
    default: {
      const joiners = ev.participants.filter((p) => p.inCoScreen || p.arrived);
      if (joiners.length) {
        bits.push(
          `${joiners.map((p) => nameOf(p.characterId)).join('、')}参与了「${def.name}」。`,
        );
        for (const p of joiners) {
          if (def.tags.includes('affinity')) adjustAffinity(living, p.characterId, 2);
        }
        if (def.tags.includes('relation') && joiners.length >= 2) {
          bumpPairwiseRelations(
            living,
            joiners.map((p) => p.characterId),
            def.tags.includes('conflict') ? -2 : 2,
          );
        }
        if (def.tags.includes('chat') && ev.meta?.chatTopic) {
          bits.push(`话题是「${ev.meta.chatTopic}」。`);
          for (const p of joiners) {
            pushMemory(living, p.characterId, {
              kind: 'event',
              summary: `和同伴聊了「${ev.meta.chatTopic}」`,
              importance: 4,
            });
          }
        }
        if (def.tags.includes('gold_gain')) {
          goldDelta = 20 + joiners.length * 3;
          applyGold(goldDelta);
          bits.push(`锈币 +${goldDelta}。`);
        }
        if (def.tags.includes('gold_loss') && def.tags.includes('social')) {
          goldDelta = -10;
          applyGold(goldDelta);
          bits.push(`花了点锈币（${goldDelta}）。`);
        }
      } else {
        bits.push(`几乎没人理会「${def.name}」。`);
      }
      void avoiders;
      void watchers;
      void ownedIds;
      break;
    }
  }

  // 清事件临时外覆 → 回落到营地日常穿搭 / 默认原皮（不影响主页玩家装备）
  const skinCleared = clearEventTempSkinsForInstance(living, ev.instanceId);
  if (skinCleared.length) {
    bits.push(
      `${skinCleared.map((id) => nameOf(id)).join('、')}换回了事件前的营地外观。`,
    );
  }

  const summary = `【事件结束】${def.name}——${bits.join('') || '告一段落。'}`;
  pushCampLog(living, {
    text: summary,
    source: 'system',
    characterIds: ev.participants.map((p) => p.characterId),
  });
  void recordLifeNote(living, summary, { kind: 'camp' });

  // 凡参与/到场/同屏者留下记忆点（谁经历过谁记得）
  for (const p of ev.participants) {
    const tookPart = p.arrived || p.inCoScreen || p.contributed || p.reaction === 'help';
    const watched = p.reaction === 'spectate';
    if (!tookPart && !watched && p.reaction === 'ignore') continue;
    const roleBit = tookPart
      ? p.inCoScreen
        ? '同场经历'
        : p.arrived
          ? '到场参与'
          : '出了力'
      : '在一旁看着';
    pushMemory(living, p.characterId, {
      kind: 'event',
      summary: `${def.name}：${roleBit}。${bits.join('').slice(0, 60) || '事件结束'}`,
      importance: tookPart ? 6 : 3,
    });
  }

  // 事件结算后微调参与者人设漂移
  const personaKind: 'social' | 'conflict' | 'fear' | 'duty' = def.tags.includes('conflict')
    ? 'conflict'
    : def.tags.includes('fear')
      ? 'fear'
      : def.tags.includes('repair') || def.tags.includes('gold_loss')
        ? 'duty'
        : 'social';
  for (const p of ev.participants) {
    if (p.arrived || p.inCoScreen || p.reaction !== 'ignore') {
      evolvePersonaAfterEvent(living, p.characterId, personaKind);
    }
  }

  // 清事件意图
  for (const p of ev.participants) {
    const ag = getAgenda(living, p.characterId);
    if (ag?.eventInstanceId === ev.instanceId) clearAgenda(living, p.characterId);
  }

  const hist: CampEventHistoryEntry = {
    instanceId: ev.instanceId,
    defId: ev.defId,
    endedAtGameMin: living.gameMinutes,
    summary,
    goldDelta: goldDelta || undefined,
  };
  living.eventHistory!.unshift(hist);
  living.eventHistory = living.eventHistory!.slice(0, MAX_HISTORY);

  return { summary, goldDelta };
}

/**
 * 推进事件阶段。应在世界时钟推进后调用。
 * @param applyGold 修改存档锈币
 */
export function tickCampEvents(
  living: AiLivingSave,
  ownedIds: string[],
  applyGold: (delta: number) => void,
): { activated: string[]; resolved: string[] } {
  ensureEventFields(living);
  const activated: string[] = [];
  const resolved: string[] = [];
  const keep: CampEventInstance[] = [];

  for (const ev of living.activeCampEvents ?? []) {
    if (ev.phase === 'warn' && living.gameMinutes >= ev.warnEndsAtGameMin) {
      ev.phase = 'active';
      assignReactionsOnActivate(living, ev, ownedIds);
      activated.push(ev.defId);
    }

    if (ev.phase === 'active') {
      markArrivals(living, ev);
      if (living.gameMinutes >= ev.endsAtGameMin) {
        ev.phase = 'resolve';
        const result = resolveEvent(living, ev, ownedIds, applyGold);
        resolved.push(result.summary);
        continue; // 不保留
      }
    }

    if (ev.phase === 'warn' || ev.phase === 'active') {
      keep.push(ev);
    }
  }

  living.activeCampEvents = keep;
  return { activated, resolved };
}

/** UI：进行中事件快照 */
export function listActiveCampEventsForUi(living: AiLivingSave): {
  instanceId: string;
  defId: string;
  name: string;
  phase: string;
  phaseLabel: string;
  blurb: string;
  focusRoomId: string;
  focusLabel: string;
  remainGameMin: number;
  warnRemainGameMin: number;
  coScreenIds: string[];
  coScreenActive: boolean;
  topic?: string;
  participants: { characterId: string; name: string; reaction: string; inCoScreen?: boolean }[];
}[] {
  ensureEventFields(living);
  return (living.activeCampEvents ?? []).map((ev) => {
    const def = getCampEventDef(ev.defId);
    const remain =
      ev.phase === 'warn'
        ? Math.max(0, ev.warnEndsAtGameMin - living.gameMinutes)
        : Math.max(0, ev.endsAtGameMin - living.gameMinutes);
    const warnRemain = Math.max(0, ev.warnEndsAtGameMin - living.gameMinutes);
    const coScreenIds = ev.coScreenIds ?? [];
    return {
      instanceId: ev.instanceId,
      defId: ev.defId,
      name: def?.name ?? ev.defId,
      phase: ev.phase,
      phaseLabel: ev.phase === 'warn' ? '预警倒计时' : ev.phase === 'active' ? '进行中' : '结算',
      blurb: def?.blurb ?? '',
      focusRoomId: ev.focusRoomId,
      focusLabel: roomLabel(ev.focusRoomId),
      remainGameMin: remain,
      warnRemainGameMin: warnRemain,
      coScreenIds,
      coScreenActive: ev.phase === 'active' && coScreenIds.length >= 2,
      topic: ev.meta?.chatTopic,
      participants: (ev.participants ?? []).map((p) => ({
        characterId: p.characterId,
        name: CHARACTER_MAP[p.characterId]?.name ?? p.characterId,
        reaction: p.reaction,
        inCoScreen: p.inCoScreen,
      })),
    };
  });
}

export function getFocusRoomIds(living: AiLivingSave): string[] {
  return (living.activeCampEvents ?? []).map((e) => e.focusRoomId);
}

/** 游戏分钟 → 约等于现实秒（用于 UI 倒计时；与 worldClock 时间流速一致） */
export function gameMinToRealSec(gameMin: number): number {
  return gameMinutesToRealSeconds(gameMin);
}
