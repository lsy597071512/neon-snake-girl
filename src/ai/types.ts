/** AI 生活系统 · 类型 */

export type CampPeriod = 'qingchen' | 'zhongwu' | 'huanghun' | 'bangwan' | 'shenye' | 'qingtian';
export type WeatherId = 'clear' | 'hazy' | 'dusty' | 'rain' | 'indoor';

export type SceneCard = {
  id: string;
  label: string;
  kind: 'camp' | 'indoor';
  image: string;
  /** 户外场景夜间背景；有则按时段自动切换 */
  imageNight?: string;
  period: CampPeriod | 'any';
  weather: WeatherId;
  locationName: string;
  atmosphere: string;
  sensory: string[];
  dialogueHints: string[];
  interactables: string[];
};

export type AiProfile = {
  summary: string;
  homeBase: string;
  knownLocations: string[];
  dailyRoutine: string;
  emotionalBaseline: string;
  coreNeeds: string[];
  fears: string[];
  speechStyle: string;
  relationshipNotes: string;
  secrets: string;
  sensoryAnchors: string[];
};

export type CharacterActivity =
  | 'idle'
  | 'busy'
  | 'talking'
  | 'sleeping'
  | 'patrol'
  | 'maintain'
  | 'rest'
  | 'play'
  | 'bathe'
  | 'eat'
  | 'guard';

export type LightStatusTag =
  | 'hunger'
  | 'thirst'
  | 'fatigue'
  | 'inspired'
  | 'fear_state'
  | 'affection'
  | 'jealousy'
  | 'anxiety_state'
  | 'calm'
  | 'injured'
  | 'poisoned'
  | 'radiation'
  | 'cold';

export type LivingPresence = {
  characterId: string;
  /** 场景卡 id */
  locationId: string;
  /** 房间 id（平面落点） */
  roomId: string;
  activity: CharacterActivity;
  /** 口语行为，如「在娱乐间打台球」 */
  behavior: string;
  statusTags: LightStatusTag[];
  label: string;
};

export type AiMemoryEntry = {
  ts: number;
  kind: 'talk' | 'gift' | 'event' | 'combat_return' | 'outreach' | 'outreach_ignored' | 'activity_fatigue';
  summary: string;
  importance: number;
};

/** 角色主动找玩家发消息的类型 */
export type AiMessageKind = 'chat' | 'ask_help' | 'share' | 'invite' | 'vent' | 'report';

export type AiMessageStatus = 'pending' | 'accepted' | 'cancelled' | 'expired' | 'ignored';

/**
 * AI 消息事件：角色主动找玩家聊天/提问。
 * 投递于主页立绘界面；玩家点选一人后其余取消。
 */
export type AiMessageEvent = {
  messageId: string;
  characterId: string;
  status: AiMessageStatus;
  kind: AiMessageKind;
  /** 主页气泡预览（短） */
  preview: string;
  /** 点开后的开场白 */
  openingDialogue: string;
  action?: string;
  innerThought?: string;
  /** AI 自述：为何此刻发消息（合理性审计 / 训练） */
  reason: string;
  /** 事件分量 1–5：影响好感扣分与后续行为幅度 */
  significance: number;
  createdAt: number;
  expiresAt: number;
  /** 当时行为/事件上下文摘要 */
  contextSummary: string;
  relatedEventInstanceId?: string;
  /** 离线规则模拟产生的留言（用于统计/展示区分） */
  offlineSent?: boolean;
};

/** 每角色主动消息统计（未回应连击等） */
export type AiMessageOutreachStats = {
  unansweredCount: number;
  lastOutreachAt: number;
  lastRespondedAt: number;
  lastCancelledAt?: number;
};

/** NPC 主动找另一 NPC 的待赴约意图（跨房寻找） */
export type NpcSeekIntent = {
  seekerId: string;
  targetId: string;
  motive: string;
  createdGameMin: number;
  expiresGameMin: number;
};

export type CampLogEntry = {
  ts: number;
  gameMinutes: number;
  text: string;
  source: 'system' | 'npc' | 'offline' | 'player';
  characterIds?: string[];
};

/** 角色意图来源 */
export type AgendaSource = 'need' | 'schedule' | 'event' | 'social' | 'llm' | 'player_task';

/** 可持续意图：到期前不换目标 */
export type CharacterAgenda = {
  goal: string;
  targetRoomId: string;
  activity: CharacterActivity;
  behavior: string;
  /** 剩余游戏分钟 */
  remainGameMin: number;
  /** 意图开始时的 gameMinutes */
  startedGameMin: number;
  reason: string;
  source: AgendaSource;
  /** 绑定的营地事件实例 id */
  eventInstanceId?: string;
  /** 对该事件的反应姿态（对话注入用） */
  eventStance?: CampEventReactionKind;
};

export type CampEventPhase = 'warn' | 'active' | 'resolve';

export type CampEventReactionKind =
  | 'investigate'
  | 'help'
  | 'recruit'
  | 'spectate'
  | 'avoid'
  | 'ignore'
  | 'vent';

export type CampEventParticipant = {
  characterId: string;
  reaction: CampEventReactionKind;
  arrived?: boolean;
  contributed?: boolean;
  /** 是否计入多人同屏场景（赴约/参与焦点活动） */
  inCoScreen?: boolean;
};

export type CampEventInstance = {
  instanceId: string;
  defId: string;
  phase: CampEventPhase;
  startedGameMin: number;
  warnEndsAtGameMin: number;
  endsAtGameMin: number;
  focusRoomId: string;
  participants: CampEventParticipant[];
  logLines: string[];
  outcomeSeed: number;
  /** 事件专属载荷（争吵双方、伤者、聊天话题等） */
  meta?: Record<string, string>;
  /**
   * 多人同屏成员（≥2 且事件允许同屏时才有意义）。
   * 仅由事件参与产生，偶然同房不算。
   */
  coScreenIds?: string[];
};

export type CampEventHistoryEntry = {
  instanceId: string;
  defId: string;
  endedAtGameMin: number;
  summary: string;
  goldDelta?: number;
};

export type AiLivingSave = {
  /** 累计游戏分钟（用于昼夜） */
  gameMinutes: number;
  dayIndex: number;
  lastRealTs: number;
  /** 玩家当前所在场景（外景或室内） */
  playerLocationId: string;
  /** 玩家对角色好感 0–100 */
  affinities: Record<string, number>;
  /** 角色间关系 -100..100，键为 sorted "a|b" */
  relationships: Record<string, number>;
  memories: Record<string, AiMemoryEntry[]>;
  campLog: CampLogEntry[];
  characterStatus: Record<string, LightStatusTag[]>;
  lastNpcEventAt: number;
  lastOfflineSummaryAt: number;
  pendingOfflineSummary: string | null;
  /** 对话短时上下文（每角色最近几句，进 Prompt） */
  recentChats: Record<string, ChatTurn[]>;
  /** 更早对话的本地压缩要点（进 Prompt，省 token） */
  chatDigests: Record<string, string[]>;
  /** 每角色上次对话结束时间（现实时间戳） */
  lastTalkAt: Record<string, number>;
  /** 累计玩家发出的对话条数（任务统计） */
  totalUserDialogueTurns?: number;
  /** 每角色当前意图议程 */
  agendas?: Record<string, CharacterAgenda>;
  /** 进行中的营地随机事件 */
  activeCampEvents?: CampEventInstance[];
  /** 已结算事件摘要 */
  eventHistory?: CampEventHistoryEntry[];
  /**
   * 营地日常穿搭（AI 驱动；与主页玩家 activeSkinId 无关）。
   * 缺省 / 无键 = 生活服装 pifu00（有资源时）；值为 'default' = 战斗装甲。
   * 事件临时层优先于本字段。
   */
  campWornSkins?: Record<string, string>;
  /**
   * 营地事件/洗浴临时外覆（不改主页玩家装备、不解锁）。
   * 事件结束后清除 → 回落到 campWornSkins / 生活服装基准。
   */
  eventTempSkins?: Record<string, EventTempSkinState>;
  /**
   * 营地洗浴成人互动同意：true 时冲澡立绘切到 intimate webm。
   * 出浴室自动清除；未同意时浴室播放冲澡待机动态（*_idle.webm）。
   */
  bathIntimateConsent?: Record<string, boolean>;
  /** 本轮同意脱巾后是否已播完 *_pifu03_full 脱巾前奏（回裹巾/出浴室清零） */
  bathIntimateIntroDone?: Record<string, boolean>;
  /** 上次尝试生成营地事件的 gameMinutes */
  lastCampEventSpawnGameMin?: number;
  /** 动态人设 / 今日行为（随日与对话漂移） */
  personas?: Record<string, CharacterPersonaLive>;
  /** 待处理 / 近期 AI 主动消息队列 */
  pendingAiMessages?: AiMessageEvent[];
  /** 每角色主动消息统计 */
  aiMessageStats?: Record<string, AiMessageOutreachStats>;
  /** 上次全局评估「是否找玩家」的现实时间戳 */
  lastPlayerOutreachEvalAt?: number;
  /** NPC 跨房主动寻找另一 NPC */
  pendingNpcSeeks?: NpcSeekIntent[];
  /** 人设大改后的一次性清档标记（角色 id → revision） */
  personaResets?: Record<string, number>;
  /** 皮肤全量入库等活动 rollout 标记（如 pifu01 → rev） */
  skinRollouts?: Record<string, number>;
  /** 情绪选装上次生效的 gameMinutes（角色 id → 时刻） */
  emotionOutfitAt?: Record<string, number>;
  /** 中期人生目标（玩法推进可见） */
  lifeGoals?: Record<string, LifeGoalState>;
  /** 角色私房锈币（可自行买进仓库） */
  characterPockets?: Record<string, number>;
  /** 义体健康 0–100（战斗命中磨损 + 时间老化） */
  characterCyberHealth?: Record<string, number>;
  /** 上次义体老化结算的 dayIndex */
  lastCyberAgingDayIndex?: number;
  /** 义体健康告警事件队列 */
  pendingCyberHealthEvents?: CyberHealthEventSave[];
  /** 叙事义体挂载（不改皮肤/战力） */
  characterCyberLoadout?: Record<string, Record<string, string>>;
  /** 营地房间陈设：roomId → slotId → propId */
  /** 玩家当日发起的重复活动计数（角色 id → {dayIndex, counts}，跨天清零） */
  activityRequests?: Record<string, import('./activityFatigue').ActivityRequestRecord>;
  campPlacements?: Record<string, Record<string, string>>;
  /**
   * 结构化事实表（承诺/称呼/约定等）
   * 每轮强注入 Prompt；与 memories 自由文本分离
   */
  structuredFacts?: Record<string, import('./structuredFacts').StructuredFact[]>;
  /** 每角色上次关系弧线阶段 id（用于跨档里程碑） */
  relationshipArcStage?: Record<string, string>;
  /**
   * 对话进行中的「上一轮场景快照」，用于检测换房/换装并注入 Prompt。
   * 不冻结场景；只保证对白跟上现实。
   */
  dialogueTurnScene?: Record<string, DialogueSceneSnapshot>;
  /**
   * 对话中挂起的「之后想去」欲望（不立刻切景）。
   * 对话结束或世界 tick 再落成议程走动。
   */
  pendingDesires?: Record<string, PendingDesireNext>;
  /**
   * 对话换装过程：答应后先切「换装中」过程皮循环，到点才真正穿上目标外覆。
   */
  pendingOutfitChanges?: Record<string, PendingOutfitChange>;
  /** 玩家点名展示的衣服：锁定期内禁止情绪/场景自动扒掉 */
  outfitWearLocks?: Record<string, OutfitWearLock>;
  /** 叙事换装锁：对白描述换装中间过程时，禁止背景写者瞬间套终点皮肤 */
  outfitNarrativeHolds?: Record<string, OutfitNarrativeHold>;
  /** 身体锚点：对话同步的身体位置账本（resolvePresence 优先读它） */
  bodyAnchors?: Record<string, BodyAnchor>;
  /** 走路行程：移动必须有路程时间（到点才落点/切场景） */
  travelPlans?: Record<string, import('./travel').TravelPlan>;
  /** 离线归来摘要：同步给 Prompt 用（到期自动失效，避免长期占上下文） */
  offlineDigestForPrompt?: string;
  offlineDigestExpiresAtMs?: number;
  /** @deprecated 已废弃的场景锁，读档时清除 */
  dialoguePresenceLocks?: Record<string, unknown>;
  /**
   * 睡眠系统：每角色准备入睡 / 睡着 / 被打扰。
   * 一整觉约现实 6 小时；脱离时营地皮必须同步星夜睡衣。
   */
  characterSleep?: Record<string, import('./sleepSystem').CharacterSleepState>;
  /**
   * 对话中玩家递交的道具（已从仓库 escrow；接受才消耗，拒绝/关窗退回）。
   * 同时仅一条。
   */
  pendingItemOffer?: PendingItemOffer | null;
  /**
   * 事件会话占位（对话页；读档若 active 须自动结算）。
   */
  disciplineSession?: import('./disciplineSession').DisciplineSessionState;
  /** 事件邀请占位（待玩家确认） */
  pendingDisciplineInvite?: import('./disciplineSession').DisciplineInvitePending;
  /** 事件邀请日冷却：characterId → dayIndex */
  disciplineInviteCooldownDay?: Record<string, number>;
  /**
   * 浴室互动会话：帮清洗 / 一同泡澡（对话页；关页/离浴室须结算）。
   * 见 docs/bath-assist-events.md / src/ai/bathAssistSession.ts
   */
  bathAssistSession?: import('./bathAssistSession').BathAssistSessionState;
  /** 角色主动提出浴室互动（待玩家确认） */
  pendingBathAssistInvite?: import('./bathAssistSession').BathAssistInvitePending;
  /**
   * 舞蹈事件会话：单人独舞 / 一对一共舞（对话页；关页/离大厅须结算）。
   * 见 src/ai/danceSession.ts
   */
  danceSession?: import('./danceSession').DanceSessionState;
  /** 角色主动提出舞蹈（待玩家确认） */
  pendingDanceInvite?: import('./danceSession').DanceInvitePending;
  /** 指挥官提出舞蹈（待角色本轮答应） */
  pendingPlayerDanceAsk?: import('./danceSession').DancePlayerAskPending;
  /** 舞蹈邀请日冷却：characterId → dayIndex */
  danceInviteCooldownDay?: Record<string, number>;
  /** 1v1 共舞好感去重：characterId → dayIndex */
  danceAffinityDay?: Record<string, number>;
  /** UI 闪示一行舞蹈系统提示，展示后清空 */
  danceUiFlash?: string;
  /**
   * 安抚室会话：安抚待机 / 安抚中 / 安抚疲惫（对话页；关页/离安抚室须结算）。
   * 见 src/ai/anfuSession.ts
   */
  anfuSession?: import('./anfuSession').AnfuSessionState;
  /** 角色主动提出安抚（待玩家确认） */
  pendingAnfuInvite?: import('./anfuSession').AnfuInvitePending;
  /** 指挥官提出安抚（待角色本轮答应） */
  pendingPlayerAnfuAsk?: import('./anfuSession').AnfuPlayerAskPending;
  /** 安抚邀请日冷却：characterId → dayIndex */
  anfuInviteCooldownDay?: Record<string, number>;
  /** 安抚每日一次：characterId → dayIndex（进入待机时消耗） */
  anfuPlayDay?: Record<string, number>;
  /** UI 闪示一行安抚系统提示，展示后清空 */
  anfuUiFlash?: string;
  /**
   * 小游戏事件会话：五子棋 / 猜拳（对话页；关页/离房须结算）。
   * 见 src/ai/miniGameSession.ts
   */
  miniGameSession?: import('./miniGameSession').MiniGameSessionState;
  /** 角色主动提出小游戏（待玩家确认） */
  pendingMiniGameInvite?: import('./miniGameSession').MiniGameInvitePending;
  /** 指挥官提出小游戏（待角色本轮答应） */
  pendingPlayerMiniGameAsk?: import('./miniGameSession').MiniGamePlayerAskPending;
  /** 小游戏邀请日冷却：characterId → dayIndex */
  miniGameInviteCooldownDay?: Record<string, number>;
  /** 赛后随性奖惩窗（愿赌服输 stake；每场对话回合消耗） */
  miniGameStake?: import('./miniGameSession').MiniGameStakeState;
  /** UI 闪示一行小游戏系统提示，展示后清空 */
  miniGameUiFlash?: string;
  /** 帮洗：已换冲洗皮，等待延迟后进帮洗会话 */
  bathAssistPrepare?: {
    characterId: string;
    mode: 'help_wash' | 'co_bath';
    readyAt: number;
  };
  /** 指挥官提出帮洗/共浴（待角色本轮答应） */
  pendingPlayerBathAssistAsk?: import('./bathAssistSession').BathAssistPlayerAskPending;
  /** 口头约定去浴室冲澡（防误切泳池） */
  pendingBathRoomRendezvous?: import('./bathAssistSession').BathRoomRendezvous;
  /** UI 闪示一行浴室互动系统提示（同意/拒绝/切换），展示后清空 */
  bathAssistUiFlash?: string;
  /** 浴室邀请日冷却：characterId → dayIndex */
  bathAssistInviteCooldownDay?: Record<string, number>;
  /**
   * 亲密氛围亲近区（指挥官机体核心 + 美少女分区升温/机体液）。
   * 见 src/ai/bodySensitivity.ts
   */
  bodySensitivity?: {
    commander: import('./bodySensitivity').BodySensitivityState;
    characters: Record<string, import('./bodySensitivity').BodySensitivityState>;
  };
};

/** 玩家递物意图（对话页物品按钮） */
export type ItemOfferIntent = 'gift' | 'consume' | 'equip' | 'play' | 'show';

export type PendingItemOffer = {
  propId: string;
  toCharacterId: string;
  intent: ItemOfferIntent;
  offeredAtMs: number;
  offeredAtGameMin: number;
};

/** 玩家递物后角色对暂存道具的裁决（对话 JSON item_offer_resolution） */
export type ItemOfferResolution =
  | 'accept'
  | 'accept_consume'
  | 'accept_gift'
  | 'accept_equip'
  | 'accept_play'
  | 'reject'
  | 'return'
  | 'defer';

export type PendingOutfitChange = {
  targetSkinId: string | null;
  targetName: string;
  fromSkinId: string | null;
  fromSkinName: string;
  phase: 'changing' | 'ready';
  announcedAtMs: number;
  readyAtMs: number;
  /**
   * 本次换装的目标是「事件临时外覆」而非日常穿搭：
   * 到点后写入 eventTempSkins[instanceId]，不碰 campWornSkins。
   * 用于营地群体事件/洗浴等需要可见换衣过程的临时皮。
   */
  applyAsTempInstanceId?: string;
};

/** 结构化世界意图（world_intent 字段；见 LlmDialogueResult 注释） */
export type WorldIntent = {
  move_to?: string;
  outfit_action?: '' | 'start' | 'finish';
  target_skin?: string;
  activity?: string;
};

export type OutfitWearLock = {
  skinId: string | null;
  untilGameMin: number;
};

/**
 * 叙事换装锁：对白正在描述「脱/换/穿」的中间过程（拉链卡住、正在脱…）。
 * 锁定期内禁止任何「房间对齐/时钟副作用」瞬间套上终点皮肤——
 * 立绘必须停在旧衣，等换装协议（延时）或叙事完成信号（换好了）收尾。
 */
export type OutfitNarrativeHold = {
  untilMs: number;
  reason: string;
};

/**
 * 身体锚点：对话世界同步提交的「此刻身体位置」持久账本。
 * resolvePresence 优先读锚点而非按时钟重算作息表，
 * 杜绝议程过期后角色被作息表瞬移（浴室聊完变大厅）。
 * 超过 ttlGameMin 未刷新 → 作息表接管（接管时写记忆，让叙事知道换地方了）。
 */
export type BodyAnchor = {
  roomId: string;
  activity: CharacterActivity;
  behavior: string;
  atGameMin: number;
  seq: number;
};

export type PendingDesireNext = {
  roomId: string;
  reason: string;
  goal: string;
  activity?: CharacterActivity;
  behavior?: string;
  remainGameMin?: number;
  savedAtGameMin?: number;
};

/** 对话轮次场景快照（对比上一轮 → 注入场景切换提示） */
export type DialogueSceneSnapshot = {
  roomId: string;
  activity: CharacterActivity;
  behavior: string;
  presenceLabel: string;
  skinKey: string;
  skinName: string;
  capturedAtGameMin: number;
};

/** 义体健康告警（存档形态） */
export type CyberHealthEventSave = {
  id: string;
  characterId: string;
  partHint: string;
  healthAtTrigger: number;
  createdGameMin: number;
  status: 'open' | 'resolved';
  note: string;
};

/** 中期人生目标（与 lifeGoals.ts 同步） */
export type LifeGoalState = {
  id: string;
  text: string;
  kind:
    | 'combat_chapter'
    | 'gift_bond'
    | 'armory'
    | 'shop'
    | 'skin'
    | 'promise'
    | 'rest';
  meta?: number;
  progress: number;
  target: number;
  daySeed: number;
  completedAtGameMin?: number;
};

/** 动态人设运行时 */
export type CharacterPersonaLive = {
  dayIndex: number;
  dayMode: 'dutiful' | 'idle' | 'social' | 'withdrawn' | 'playful' | 'restless';
  dayPlan: string;
  moodNote: string;
  /** 情绪连续体愉悦度 -100..100 */
  moodValence?: number;
  /** 情绪连续体唤醒度 0..100 */
  moodArousal?: number;
  lastMoodTickGameMin?: number;
  traits: { duty: number; warmth: number; play: number; caution: number };
  lastEvolveGameMin: number;
  talkStreak: number;
};

/** 单轮对话存档（含动作/心里描写，供 UI 回放） */
export type ChatTurn = {
  role: 'user' | 'assistant';
  text: string;
  /** 短动作/神态描写 */
  action?: string;
  /** 心里话（可与嘴上不一致） */
  innerThought?: string;
};

/** 事件临时皮肤状态 */
export type EventTempSkinState = {
  skinId: string;
  /** 事件前营地日常穿搭（null=默认原皮）；仅作记录，结束时清临时层即可 */
  restoreSkinId: string | null;
  eventInstanceId: string;
};

export type LlmDialogueResult = {
  emotion: string;
  /**
   * 精细表情动作图 key（见 `characterEmotionPoses.ts`），如 anger / joy / panic。
   * 有资源时驱动 `tex/juese/emotion-poses/{id}/{nn}-{key}.png`。
   */
  emotion_pose?: string;
  dialogue: string;
  inner_thought?: string;
  action?: string;
  type?: 'dialogue' | 'whisper' | 'shout' | 'narration';
  affection_change?: number;
  status_changes?: string[];
  trigger_jealousy?: string[];
  /** 本轮后结束对话（AI 主动收束/拒绝继续） */
  end_conversation?: boolean;
  /** 结束原因（给日志/记忆） */
  end_reason?: string;
  /** 被打扰时的态度（供训练与调试） */
  interrupt_reaction?: 'welcome' | 'tolerate' | 'annoyed' | 'angry';
  /**
   * 角色还想接着说（不等指挥官回）：true 时 UI 可短间隔再拉一轮主动发言。
   * 仅建议在 proactive/continue 或性格话痨时使用。
   */
  want_continue?: boolean;
  /**
   * 自主换装意向：`default` 或皮肤 id。
   * 对话中先排队（说去换），到点才穿上，不是瞬间切换。
   */
  skin_change?: string;
  /**
   * 当前营地皮肤互动动态序号（1-based，对应 _1/_2/_3）。
   * 仅播放当前穿着这套的 secondaries；禁止跨皮肤。空=不播。
   */
  skin_clip?: number | string;
  /** 事件会话本轮主导情绪（短中文，占位） */
  discipline_mood?: string;
  /** 事件会话本轮结局倾向（占位） */
  discipline_valence?: 'tragic' | 'mixed' | 'joyful' | string;
  /**
   * 【P2·结构化世界意图】AI「怎么想」的确定性表达（优先级高于文本正则推断）：
   * - move_to：此刻身体所在/正在前往的房间 id（现在时，非规划）
   * - outfit_action：start=开始换 target_skin；finish=换完了（立绘此刻应已/即将换上）
   * - target_skin：目标皮肤 id 或 default
   * - activity：可选活动修正
   * 模型漏填时回退文本推断；填了则免正则误判。
   */
  world_intent?: WorldIntent | string;
  /**
   * 营地洗浴「脱掉浴巾」门控：true=自愿/被要求脱巾 → 成人冲澡动态；
   * false=仍裹巾或重新裹上 → 待机动态；""=不改。
   * 「一起洗/搓背」 alone 不够；对白仍说裹着浴巾时不可为 true。
   * 仅浴室洗浴中有效；出浴室自动失效。
   * 浴室互动（帮洗/共浴）进行中必须为 false/""。
   */
  bath_intimate_consent?: boolean | string;
  /**
   * 浴室互动意图：propose_help|propose_co|end|""。
   * 异地提出走确认条；进行中填 end 结束。start_* 一般由按钮/指挥官明确提出触发。
   */
  bath_assist_action?: string;
  /**
   * 舞蹈事件意图：propose_solo|propose_co|start_solo|start_co|stop|end|""。
   * 只发生在大厅；指挥官按钮/打字/语音等效提出；你可主动提出（propose_*，走确认条）。
   * 一切舞蹈先切「舞蹈待机」(pifu12) 再起舞；独舞(pifu11)为无缝循环，独舞可 stop 暂停/重开；
   * 共舞(pifu10)按片段时长，结束后回准备态。想结束进行中的舞蹈填 end 或对白明确收尾。
   * 非舞蹈事件填 ""。
   */
  dance_action?: string;
  /**
   * 安抚室意图：propose=你主动邀请（走确认条）；start=答应指挥官（同意后系统切安抚待机）；
   * end=结束（待机/疲惫相为正常离开；安抚中填 end 视为中途离开，会让TA失落扣好感）。
   * 只发生在安抚室；非安抚事件填 ""。
   */
  anfu_action?: string;
  /** 安抚值判定（安抚中每轮必填）：10~40，越接近满越敏感；服务端钳制为准。 */
  anfu_gain?: number;
  /** 满足结算追加好感：0~3（基础 +5，合计上限 8）。 */
  anfu_bonus?: number;
  /**
   * 小游戏意图：propose_gomoku|propose_rps=你主动邀请（走确认条）；
   * start_gomoku|start_rps=答应指挥官的邀请；quit=认输/不想玩了（对局中判你负）；
   * accept_stake|refuse_stake=赛后输赢约定（奖惩）的应答。只发生在游戏室/大厅；非小游戏事件填 ""。
   */
  minigame_action?: string;
  /**
   * 成人事件·身体刺激目标：self=角色自己；commander=指挥官小管道；mutual=双方。
   * 非成人事件填 ""。
   */
  stim_target?: string;
  /**
   * 刺激区 id 逗号分隔：waist,butt,breast,nipple,perineum,vagina,crotch_outer,crotch_deep,commander_pipe
   */
  stim_zones?: string;
  /** 刺激强度 1|2|3 */
  stim_intensity?: number | string;
  /** brief|sustained|climax */
  stim_duration?: string;
  /** 异样情绪 1～3 词（兴奋/害羞/…/迷糊），可矛盾并存 */
  adult_odd_mood?: string;
  /** 机油/敏感液排出：self|commander|both|"" */
  oil_discharge?: string;
  /**
   * 深场戏剧节拍（一句）：本轮这场戏在干什么，如「试探指挥官是否记得泳池约定」。
   * 不进 UI，进记忆/调试。
   */
  scene_beat?: string;
  /**
   * 聊完后下一小时想做什么（驱动身体议程）。
   * 可为短中文，或 { goal, room_id, reason, minutes }。
   */
  desire_next?: string | DesireNextPayload;
  /** 要写入长期记忆的一句（本地校验后入库） */
  memory_write?: string;
  /**
   * 营地道具动作（仓库/商店/送礼/食用）。
   * 无经济意图时省略或 ""。
   */
  camp_item_action?:
    | string
    | {
        item_id?: string;
        itemId?: string;
        action?: string;
        payer?: string;
        target?: string;
        reason?: string;
        qty?: number;
      };
  /** 运行时回填：道具动作执行结果（不要求模型输出） */
  camp_item_result?: string;
  /**
   * 玩家递来暂存道具时的裁决（见运行时【玩家递来物品】）。
   * accept* = 收下并使用；reject/return = 退回仓库；defer = 先拿着下轮再定。
   */
  item_offer_resolution?: ItemOfferResolution;
};

/** 对话回写的下一欲望 */
export type DesireNextPayload = {
  goal?: string;
  room_id?: string;
  roomId?: string;
  reason?: string;
  minutes?: number;
  remainGameMin?: number;
};

export type DialogueTurnMode = 'reply' | 'proactive' | 'continue' | 'outfit_reveal';

export type DialogueRequest = {
  characterId: string;
  playerMessage: string;
  sceneId: string;
  isNpcPair?: boolean;
  otherCharacterId?: string;
  turnMode?: DialogueTurnMode;
};
