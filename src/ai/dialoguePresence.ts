/**
 * 对话「此刻现场」推断（通用，不绑死浴室/武器库）。
 *
 * 核心约定：
 * - 画面只跟「现在时」走：我在×× / 正在×× / 现场动作
 * - 「之后要去 / 洗完再去 / desire_next」= 未来意图，不切景
 * - 一句里同时出现现场与目的地时，以现场房间为准
 */
import { CAMP_ROOM_MAP, getCharacterHomeRoom, getCharacterSleepRoom } from '../data/campLayout';
import type { CharacterActivity } from './types';

/** 规划 / 征求 / 之后再去 —— 不等于人已经到那儿 */
export const DIALOGUE_PLANNING_RE =
  /(?:先|待会|等会|一会儿|一会|回头|晚点|等下|之后|稍后|呆会|待会儿|准备|打算|想要?)去|要去(?!现在)|去不去|要不要去|还是(?:先)?去|去还是|要不要先|去一趟再|买完再|逛完再|洗完(?:再|就|去|后)|冲完(?:再|就|去|后)|吃完(?:再|就|去)|干完(?:再|就|去)|游完(?:再|就|去)|逛完(?:再|就|去)|点检完(?:再|就|去)|赶紧(?:.+)?去|得赶紧|再去|回头去|待会去|一会儿去|一会要去|去干活|之后要|晚点再|回头再|等会儿再|完了再|然后再去|接着去|随后去/;

/** 明确「现在就在现场」 */
export const DIALOGUE_PRESENT_HERE_RE =
  /(?:现在|已经|就|还)?在(?:这(?:里|儿)?的?)?|正在|这边|这里|这儿|过来了|到了|人在/;

export type RoomPresenceLex = {
  roomId: string;
  /** 地点名词 / 别名 */
  nouns: RegExp;
  /** 该处正在进行的动作（现在时） */
  doingNow: RegExp;
};

/**
 * 全营地地点词典：名词 + 现场动作。
 * 顺序无关；冲突时靠「现在时打分」裁决。
 */
export const ROOM_PRESENCE_LEXICON: RoomPresenceLex[] = [
  {
    roomId: 'room_1f_shop',
    nouns: /商店|商城|货架|杂货|柜台/,
    doingNow: /逛着|看着货|理货|点货|站柜台|在买|挑选着/,
  },
  {
    roomId: 'room_1f_armory',
    nouns: /武器库|军械库|军械/,
    doingNow: /正在(?:点检|擦枪|擦械)|点检着|擦着枪|擦着械|保养着武装/,
  },
  {
    roomId: 'room_1f_pool',
    nouns: /泳池|水池/,
    doingNow: /游着|泡着|戏水|泳着|在游/,
  },
  {
    roomId: 'room_1f_tower',
    nouns: /警卫塔|瞭望塔/,
    doingNow: /在塔上|瞭望着|守着塔|远眺着/,
  },
  {
    roomId: 'room_yard',
    nouns: /营地大门|大门口|院子门口/,
    doingNow: /守着门|看沙|门口站着|守门/,
  },
  {
    roomId: 'room_1f_bath',
    nouns: /浴室|洗澡间/,
    // 禁止把「洗完再去/赶紧洗完」当现场——那些是规划，否则会与大厅抢分后乱切景
    doingNow:
      /正在(?:洗澡|冲澡|洗浴)|洗着澡|冲着澡|还在洗|洗着呢|冲澡中|在洗澡|在冲澡|浴室里|裹着(?:浴巾|毛巾)|调试着水温|冲着|洗浴中/,
  },
  {
    roomId: 'room_2f_yule',
    nouns: /娱乐间|台球室/,
    doingNow: /打着台球|玩着|牌局中/,
  },
  {
    roomId: 'room_1f_hall2',
    nouns: /大厅2|食堂/,
    doingNow: /吃着|开饭|在吃|用餐中/,
  },
  {
    roomId: 'room_1f_hall1',
    nouns: /大厅1|一楼大厅(?!2)|大厅(?!2)/,
    doingNow: /闲聊着|在大厅坐着|人在大厅|正在大厅/,
  },
  {
    roomId: 'room_1f_storage',
    nouns: /仓库/,
    doingNow: /清点着库存|搬着货/,
  },
  {
    roomId: 'room_1f_machine',
    nouns: /机房/,
    doingNow: /看着发电机|检修着机房/,
  },
  {
    roomId: 'room_1f_mech',
    nouns: /机械区/,
    doingNow: /检修着管道|在机械区忙/,
  },
  {
    roomId: 'room_2f_atrium',
    nouns: /中庭/,
    doingNow: /在中庭/,
  },
  {
    roomId: 'room_2f_wc',
    nouns: /厕所|卫生间/,
    doingNow: /在厕所/,
  },
  {
    roomId: 'room_2f_lounge',
    nouns: /南大厅|二楼大厅·南/,
    doingNow: /在南大厅/,
  },
  {
    roomId: 'room_1f_shop_bed',
    nouns: /商店卧室/,
    doingNow: /在商店卧室/,
  },
];

/** 粗粒度地点词 → 房间（欲望/软提及仍可用；切景勿单靠它） */
export const ROOM_HINTS: { re: RegExp; roomId: string }[] = [
  { re: /商店|商城|货架|杂货|逛/, roomId: 'room_1f_shop' },
  { re: /武器库|军械|擦枪|擦械|点检/, roomId: 'room_1f_armory' },
  { re: /泳池|泳|戏水|泡澡后/, roomId: 'room_1f_pool' },
  { re: /警卫塔|塔上|远眺/, roomId: 'room_1f_tower' },
  { re: /大门|门口|守门|看沙/, roomId: 'room_yard' },
  { re: /浴室|洗澡|清洗|洗浴|水温/, roomId: 'room_1f_bath' },
  { re: /娱乐|台球|玩/, roomId: 'room_2f_yule' },
  { re: /大厅2|吃饭|开饭|食堂/, roomId: 'room_1f_hall2' },
  { re: /大厅1|一楼大厅(?!2)/, roomId: 'room_1f_hall1' },
  { re: /仓库/, roomId: 'room_1f_storage' },
  { re: /机房/, roomId: 'room_1f_machine' },
  { re: /机械区|散热/, roomId: 'room_1f_mech' },
  { re: /中庭/, roomId: 'room_2f_atrium' },
  { re: /厕所/, roomId: 'room_2f_wc' },
  { re: /南大厅|避风|lounge/, roomId: 'room_2f_lounge' },
];

export function inferRoomFromText(text: string, characterId: string): string | null {
  for (const h of ROOM_HINTS) {
    if (h.re.test(text) && CAMP_ROOM_MAP[h.roomId]) return h.roomId;
  }
  if (/睡|困|回房|卧室|歇着睡/.test(text)) return getCharacterSleepRoom(characterId).id;
  if (/歇|休息|回房|发呆|待着/.test(text)) return getCharacterHomeRoom(characterId).id;
  return null;
}

function splitClauses(text: string): string[] {
  return text
    .split(/[。！？!?;；,，、\n]|·|(?<=[了着完])(?=[我你他她咱我])/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

function clauseIsPlanning(clause: string): boolean {
  if (DIALOGUE_PLANNING_RE.test(clause) && !/(?:现在|已经|就)在/.test(clause)) return true;
  // 「去××点检/逛/游」且无「在/正在」→ 当规划
  if (
    /(?:要|想|准备|打算|之后|等下|待会)?去.{0,12}(?:点检|逛|游|泡|守|吃|洗|睡)/.test(clause) &&
    !DIALOGUE_PRESENT_HERE_RE.test(clause) &&
    !/正在/.test(clause)
  ) {
    return true;
  }
  return false;
}

function scoreRoomInClause(clause: string, lex: RoomPresenceLex): number {
  if (!CAMP_ROOM_MAP[lex.roomId]) return 0;
  let score = 0;
  const hasNoun = lex.nouns.test(clause);
  const doing = lex.doingNow.test(clause);
  const planning = clauseIsPlanning(clause);
  const here =
    /(?:我们|咱们|我)(?:现在|已经|就)?(?:还)?在/.test(clause) && hasNoun;

  // 现场动作永远压过同句里的「之后要去」
  if (doing) score += 10;
  if (here) score += 8;
  if (hasNoun && DIALOGUE_PRESENT_HERE_RE.test(clause) && !planning) score += 5;
  if (hasNoun && !planning && /着|中|着呢/.test(clause)) score += 3;
  if (hasNoun && planning && !doing) score -= 10;
  if (!hasNoun && doing) score += 2;
  return score;
}

export type PresentRoomInferResult = {
  roomId: string | null;
  reason: string;
  /** 对白是否在延续「当前房间」的现场动作 */
  holdingCurrent: boolean;
};

/**
 * 从对白推断「此刻人在哪」。
 * - 规划句里的地点不计分（或负分）
 * - 现场动作 / 「我在××」才加分
 * - 若当前房间仍有现场证据，优先保持（防同句提到目的地就切景）
 */
export function inferPresentRoomFromSpeech(
  speech: string,
  characterId: string,
  currentRoomId?: string | null,
): PresentRoomInferResult {
  const t = speech.trim();
  if (!t || t.length < 2) {
    return { roomId: null, reason: '空对白', holdingCurrent: false };
  }

  const clauses = splitClauses(t);
  const scores = new Map<string, number>();

  const bump = (roomId: string, n: number) => {
    if (!CAMP_ROOM_MAP[roomId] || n === 0) return;
    scores.set(roomId, (scores.get(roomId) ?? 0) + n);
  };

  for (const clause of clauses.length ? clauses : [t]) {
    const planning = clauseIsPlanning(clause);
    for (const lex of ROOM_PRESENCE_LEXICON) {
      let s = scoreRoomInClause(clause, lex);
      // 纯规划分句：地点词扣分；但已有 doing 现场分则保留
      if (planning && s > 0 && !lex.doingNow.test(clause)) {
        s = -2;
      }
      bump(lex.roomId, s);
    }

    // 卧室 / 睡觉（角色相关）
    if (!planning) {
      if (/正在睡|睡着了|躺着睡|在床上/.test(clause)) {
        bump(getCharacterSleepRoom(characterId).id, 8);
      }
      if (/(?:我|我们)(?:现在|已经|就)?在(?:自己)?(?:的)?卧室|回房躺着/.test(clause)) {
        bump(getCharacterHomeRoom(characterId).id, 6);
      }
    }
  }

  // 全文级：现场动作（不拆句也能命中）
  for (const lex of ROOM_PRESENCE_LEXICON) {
    if (lex.doingNow.test(t)) bump(lex.roomId, 4);
  }

  let bestId: string | null = null;
  let bestScore = 0;
  for (const [id, sc] of scores) {
    if (sc > bestScore) {
      bestScore = sc;
      bestId = id;
    }
  }

  const cur = currentRoomId && CAMP_ROOM_MAP[currentRoomId] ? currentRoomId : null;
  const curScore = cur ? scores.get(cur) ?? 0 : 0;

  // 当前房间仍有现场分：必须明显更高分才切走（防半句提到别处就瞬移）
  const leaveMargin = cur === 'room_1f_bath' || cur === 'room_1f_pool' ? 8 : 6;
  if (cur && curScore >= 3 && bestScore < curScore + leaveMargin) {
    return {
      roomId: cur,
      reason: `延续当前现场（${CAMP_ROOM_MAP[cur]?.label ?? cur}）`,
      holdingCurrent: true,
    };
  }

  // 需要明确正分才切景；纯规划提到的地点 bestScore 会 ≤0
  if (bestId && bestScore >= 6) {
    return {
      roomId: bestId,
      reason: `此刻现场在${CAMP_ROOM_MAP[bestId]?.label ?? bestId}`,
      holdingCurrent: Boolean(cur && bestId === cur),
    };
  }

  // 强硬兜底：我在××（且该分句非规划）
  for (const clause of clauses.length ? clauses : [t]) {
    if (clauseIsPlanning(clause)) continue;
    for (const lex of ROOM_PRESENCE_LEXICON) {
      if (
        lex.nouns.test(clause) &&
        /(?:我们|咱们|我)(?:现在|已经|就)?(?:还)?在/.test(clause)
      ) {
        return {
          roomId: lex.roomId,
          reason: `声称在${CAMP_ROOM_MAP[lex.roomId]?.label ?? lex.roomId}`,
          holdingCurrent: Boolean(cur && lex.roomId === cur),
        };
      }
    }
  }

  return { roomId: null, reason: '无此刻地点信号', holdingCurrent: false };
}

/** 对白是否仍在叙述「某个现场」（任意房间），用于延后 desire 拽腿 */
export function speechHasPresentScene(speech: string, characterId: string, currentRoomId?: string | null): boolean {
  const r = inferPresentRoomFromSpeech(speech, characterId, currentRoomId);
  if (r.holdingCurrent) return true;
  if (r.roomId) return true;
  // 有现场动作词即算
  return ROOM_PRESENCE_LEXICON.some((lex) => lex.doingNow.test(speech));
}

/** 活动必须与房间相容，杜绝「武器库·洗浴」类幽灵状态 */
export function activityCompatibleWithRoom(roomId: string, activity: CharacterActivity): boolean {
  if (activity === 'bathe') return roomId === 'room_1f_bath' || roomId === 'room_2f_wc';
  if (activity === 'sleeping') {
    const kind = CAMP_ROOM_MAP[roomId]?.kind;
    return kind === 'bedroom' || kind === 'hall';
  }
  if (activity === 'guard') return roomId === 'room_yard' || roomId === 'room_1f_tower';
  if (activity === 'maintain') {
    return (
      roomId === 'room_1f_armory' ||
      roomId === 'room_1f_mech' ||
      roomId === 'room_1f_machine' ||
      roomId === 'room_1f_storage'
    );
  }
  if (activity === 'play') return roomId === 'room_1f_pool' || roomId === 'room_2f_yule';
  if (activity === 'eat') return roomId === 'room_1f_hall2' || roomId === 'room_1f_hall1';
  return true;
}

export function defaultActivityForRoom(roomId: string, speech = ''): CharacterActivity {
  if (/sleep|睡/.test(speech) && CAMP_ROOM_MAP[roomId]?.kind === 'bedroom') return 'sleeping';
  if (roomId === 'room_1f_bath') return 'bathe';
  if (roomId === 'room_1f_hall2' || /吃|饭/.test(speech)) return 'eat';
  if (roomId === 'room_1f_pool' || roomId === 'room_2f_yule') return 'play';
  if (roomId === 'room_1f_armory' || roomId === 'room_1f_mech' || roomId === 'room_1f_machine')
    return 'maintain';
  if (roomId === 'room_yard' || roomId === 'room_1f_tower') return 'guard';
  if (roomId === 'room_1f_hall1') return 'talking';
  if (/巡逻|巡/.test(speech)) return 'patrol';
  if (/歇|休息|rest/.test(speech)) return 'rest';
  return 'busy';
}

export function coerceActivityToRoom(
  roomId: string,
  activity: CharacterActivity,
  speech = '',
): CharacterActivity {
  if (activityCompatibleWithRoom(roomId, activity)) return activity;
  return defaultActivityForRoom(roomId, speech);
}
