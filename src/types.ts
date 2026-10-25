export type Rarity = 'SR' | 'SSR' | 'UR';
export type WeaponRarity = 'N' | 'R' | 'E' | 'L';

export interface CharacterDef {
  id: string;
  name: string;
  rarity: Rarity;
  basePower: number;
  icon: string;
  /** 立绘正面（主页/家园） */
  portraitFront?: string;
  /** 立绘背面（战斗关卡） */
  portraitBack?: string;
  /** 战斗 GLB 模型（背面朝向相机）；有 combatLive 时战斗场景不用它 */
  combatModel?: string;
  /** 战斗待机射击 WebM（默认装甲背影，tex/juese/combat-back） */
  combatLive?: string;
  /** 动态立绘 WebM / MP4 */
  portraitLive?: string;
  /** 主页二级动态立绘（点击一级动画后播放，仅主页） */
  portraitLiveSecondary?: string;
  tag: string;
  skillName?: string;
  skillDesc?: string;
  skillId?: string;
  bio: string;
  /** 外表年纪，如「18岁」 */
  age: string;
  /** 身高，如「165cm」 */
  height: string;
  /** 三围，如「B86 / W58 / H85」 */
  measurements: string;
  /** 性格关键词 */
  personality: string;
  giftPreference: string;
}

export interface WeaponDef {
  id: string;
  name: string;
  rarity: WeaponRarity;
  power: number;
  icon: string;
  sellPrice: number;
  desc: string;
}

export type StageMode = 'normal' | 'hell';
export type StageCombatMode = 'wave' | 'raidBoss';

export interface StageDef {
  id: number;
  chapter: number;
  chapterIndex: number;
  name: string;
  /** 全局难度档位 1–60（普通） */
  tier: number;
  mode: StageMode;
  combatMode: StageCombatMode;
  recommendedTcp: number;
  isBoss: boolean;
  type: 'normal' | 'door' | 'barrel' | 'boss';
  firstClearGold: number;
  sweepGold: number;
  timer: number;
  waves: number;
  enemyHp: number;
  enemyDamage: number;
  /** 雷电 BOSS 血量（仅 raidBoss） */
  raidBossHp?: number;
}

export interface ChapterDef {
  id: number;
  name: string;
  desc: string;
  theme: string;
}

export interface OwnedCharacter {
  characterId: string;
  weaponId: string | null;
  giftCount: number;
  /** 角色碎片强化累计战力加成 */
  shardPowerBonus?: number;
  /** 已解锁的特别皮肤 id（如 pifu01） */
  unlockedSkins?: string[];
  /** 当前应用的皮肤；null/缺省 = 默认皮肤 */
  activeSkinId?: string | null;
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  check: (stats: PlayerStats) => boolean;
  rewardGold: number;
  rewardTickets: number;
}

export interface PlayerStats {
  stagesCleared: number;
  totalKills: number;
  charactersOwned: number;
  giftsSent: number;
  legendariesEquipped: number;
  highestStage: number;
  /** 累计游玩秒数（用于任务系统） */
  playTimeSeconds: number;
}

/** 营地 AI 生活存档（见 src/ai） */
export interface AiLivingSaveData {
  gameMinutes: number;
  dayIndex: number;
  lastRealTs: number;
  playerLocationId: string;
  affinities: Record<string, number>;
  relationships: Record<string, number>;
  memories: Record<string, { ts: number; kind: string; summary: string; importance: number }[]>;
  campLog: { ts: number; gameMinutes: number; text: string; source: string; characterIds?: string[] }[];
  characterStatus: Record<string, string[]>;
  lastNpcEventAt: number;
  lastOfflineSummaryAt: number;
  pendingOfflineSummary: string | null;
  recentChats: Record<string, { role: 'user' | 'assistant'; text: string; action?: string; innerThought?: string }[]>;
  chatDigests?: Record<string, string[]>;
  lastTalkAt?: Record<string, number>;
  /** 累计玩家发出的对话条数（任务统计；旧档可由缓冲估算） */
  totalUserDialogueTurns?: number;
  agendas?: Record<
    string,
    {
      goal: string;
      targetRoomId: string;
      activity: string;
      behavior: string;
      remainGameMin: number;
      startedGameMin: number;
      reason: string;
      source: string;
      eventInstanceId?: string;
      eventStance?: string;
    }
  >;
  activeCampEvents?: {
    instanceId: string;
    defId: string;
    phase: string;
    startedGameMin: number;
    warnEndsAtGameMin: number;
    endsAtGameMin: number;
    focusRoomId: string;
    participants: { characterId: string; reaction: string; arrived?: boolean; contributed?: boolean }[];
    logLines: string[];
    outcomeSeed: number;
    meta?: Record<string, string>;
  }[];
  eventHistory?: {
    instanceId: string;
    defId: string;
    endedAtGameMin: number;
    summary: string;
    goldDelta?: number;
  }[];
  lastCampEventSpawnGameMin?: number;
  personas?: Record<
    string,
    {
      dayIndex: number;
      dayMode: string;
      dayPlan: string;
      moodNote: string;
      moodValence?: number;
      moodArousal?: number;
      lastMoodTickGameMin?: number;
      traits: { duty: number; warmth: number; play: number; caution: number };
      lastEvolveGameMin: number;
      talkStreak: number;
    }
  >;
  pendingAiMessages?: {
    messageId: string;
    characterId: string;
    status: string;
    kind: string;
    preview: string;
    openingDialogue: string;
    action?: string;
    innerThought?: string;
    reason: string;
    significance: number;
    createdAt: number;
    expiresAt: number;
    contextSummary: string;
    relatedEventInstanceId?: string;
  }[];
  aiMessageStats?: Record<
    string,
    {
      unansweredCount: number;
      lastOutreachAt: number;
      lastRespondedAt: number;
      lastCancelledAt?: number;
    }
  >;
  lastPlayerOutreachEvalAt?: number;
  pendingNpcSeeks?: {
    seekerId: string;
    targetId: string;
    motive: string;
    createdGameMin: number;
    expiresGameMin: number;
  }[];
  /** 人设大改后的一次性清档标记 */
  personaResets?: Record<string, number>;
  /** 皮肤全量入库等活动 rollout */
  skinRollouts?: Record<string, number>;
  /** 营地日常穿搭（AI；与主页玩家装备无关） */
  campWornSkins?: Record<string, string>;
  /** 营地事件/洗浴临时外覆（不改主页玩家装备） */
  eventTempSkins?: Record<
    string,
    { skinId: string; restoreSkinId: string | null; eventInstanceId: string }
  >;
  /** 营地洗浴成人互动同意（冲澡成人动态立绘门控；未同意播待机 idle） */
  bathIntimateConsent?: Record<string, boolean>;
  bathIntimateIntroDone?: Record<string, boolean>;
  /** 情绪选装上次生效的 gameMinutes */
  emotionOutfitAt?: Record<string, number>;
  /** 中期人生目标 */
  lifeGoals?: Record<
    string,
    {
      id: string;
      text: string;
      kind: string;
      meta?: number;
      progress: number;
      target: number;
      daySeed: number;
      completedAtGameMin?: number;
    }
  >;
  /** 角色私房锈币（可自行买进仓库） */
  characterPockets?: Record<string, number>;
  /** 义体健康 0–100 */
  characterCyberHealth?: Record<string, number>;
  lastCyberAgingDayIndex?: number;
  pendingCyberHealthEvents?: {
    id: string;
    characterId: string;
    partHint: string;
    healthAtTrigger: number;
    createdGameMin: number;
    status: 'open' | 'resolved';
    note: string;
  }[];
  characterCyberLoadout?: Record<string, Record<string, string>>;
  campPlacements?: Record<string, Record<string, string>>;
  /** 结构化事实表（承诺/称呼/约定等） */
  structuredFacts?: Record<
    string,
    {
      id: string;
      kind: string;
      text: string;
      createdGameMin: number;
      dayIndex: number;
      source: string;
      importance: number;
    }[]
  >;
  /** 每角色关系弧线阶段 id */
  relationshipArcStage?: Record<string, string>;
  /** 事件会话占位（可选；读档 active 须结算） */
  disciplineSession?: {
    active: boolean;
    characterId: string;
    prevRoomId: string | null;
    prevCampSkinId: string | null;
    prevEventTemp?: {
      skinId: string;
      restoreSkinId: string | null;
      eventInstanceId: string;
    } | null;
    poseIndex: number | null;
    startedAt: number;
    lastPoseAt: number;
    awaitingPoseReply: boolean;
    entrySource: string;
    valenceHints: string[];
    justEntered?: boolean;
    justLeft?: boolean;
    justLeftTurnsLeft?: number;
    settling?: boolean;
  };
  pendingDisciplineInvite?: {
    characterId: string;
    proposedAt: number;
    dayIndex: number;
    preview: string;
  };
  disciplineInviteCooldownDay?: Record<string, number>;
  /** 浴室互动：帮清洗 / 一同泡澡 */
  bathAssistSession?: {
    active: boolean;
    characterId: string;
    mode: 'help_wash' | 'co_bath' | string;
    prevRoomId: string | null;
    prevCampSkinId: string | null;
    prevEventTemp?: {
      skinId: string;
      restoreSkinId: string | null;
      eventInstanceId: string;
    } | null;
    startedAt: number;
    entrySource: string;
    justEntered?: boolean;
    justLeft?: boolean;
    justLeftTurnsLeft?: number;
    settling?: boolean;
    stickyClip?: number | null;
    awaitingCoClipReply?: boolean;
    pendingCoClip?: number | null;
    lastCoClipAt?: number;
  };
  pendingBathAssistInvite?: {
    characterId: string;
    mode: 'help_wash' | 'co_bath' | string;
    proposedAt: number;
    dayIndex: number;
    preview: string;
    afterPlayerAsk?: boolean;
    prepareWithShowerDelay?: boolean;
  };
  /** 舞蹈事件：单人独舞 / 一对一共舞 */
  danceSession?: {
    active: boolean;
    characterId: string;
    mode: 'solo' | 'co' | string | null;
    phase: 'dressing' | 'prepare' | 'dancing' | string;
    /** 换装相到点时刻 */
    dressReadyAtMs?: number;
    prevRoomId: string | null;
    prevCampSkinId: string | null;
    prevEventTemp?: {
      skinId: string;
      restoreSkinId: string | null;
      eventInstanceId: string;
    } | null;
    startedAt: number;
    entrySource: string;
    hallRoomId: string;
    awaitingAskReply?: boolean;
    pendingAskMode?: 'solo' | 'co' | null;
    soloIndex?: number;
    soloPaused?: boolean;
    coEndsAtMs?: number;
    justEntered?: boolean;
    justLeft?: boolean;
    justLeftTurnsLeft?: number;
    settling?: boolean;
  };
  pendingDanceInvite?: {
    characterId: string;
    mode: 'solo' | 'co' | string;
    proposedAt: number;
    dayIndex: number;
    preview: string;
  };
  pendingPlayerDanceAsk?: {
    characterId: string;
    mode: 'solo' | 'co' | string;
    proposedAt: number;
    isModeSwitch?: boolean;
  };
  danceInviteCooldownDay?: Record<string, number>;
  danceAffinityDay?: Record<string, number>;
  danceUiFlash?: string;
  bathAssistPrepare?: {
    characterId: string;
    mode: 'help_wash' | 'co_bath' | string;
    readyAt: number;
  };
  bathAssistInviteCooldownDay?: Record<string, number>;
}

export interface SaveData {
  version: number;
  gold: number;
  tickets: number;
  gachaPity: number;
  armoryLevel: number;
  armoryUpgradeEnd: number | null;
  ownedCharacters: OwnedCharacter[];
  ownedWeaponIds: string[];
  squad: string[];
  clearedStages: number[];
  achievementsClaimed: string[];
  /** 已领取奖励的任务 ID */
  tasksClaimed: string[];
  /** 角色专属碎片（重复获得同角色时积累） */
  characterShards: Record<string, number>;
  /** 武器专属碎片（重复获得同武器时积累） */
  weaponShards: Record<string, number>;
  /** 各角色已进行碎片强化的次数 */
  characterShardUses: Record<string, number>;
  /** 各武器已进行碎片强化的次数 */
  weaponShardUses: Record<string, number>;
  /** 各武器碎片强化带来的额外战力 */
  weaponEnhanceBonus: Record<string, number>;
  stats: PlayerStats;
  /** 扫荡次数（0–15） */
  sweepCharges: number;
  /** 扫荡恢复计时锚点（未满时） */
  sweepRecoverAnchorAt: number;
  tutorialFlags: {
    combatDone: boolean;
    /** 已完整观看过军械箱开箱视频，之后可跳过 */
    armoryVideoSeen: boolean;
    /** 已看过首次开局世界观介绍 */
    worldIntroSeen: boolean;
    /** 看板跟随剧情已看 */
    storyHubFollowSeen?: boolean;
    /** 老板娘引导当前步 id */
    storyGuideStep?: string;
    /** 引导完成 → 营地解锁 */
    storyGuideDone?: boolean;
    /** 引导期内已开过军械箱（含保底） */
    storyGuideArmoryOpened?: boolean;
    /** 战斗内技能跟随按钮指引已展示（仅首战一次） */
    combatSkillGuideSeen?: boolean;
    /** 扫荡懒加载说明已展示（通关后首次见可扫荡时一次） */
    sweepGuideSeen?: boolean;
    /** 地狱懒加载说明已展示（首次解锁地狱时一次） */
    hellGuideSeen?: boolean;
    /** 武器页一句话说明已展示（首次进武器页一次） */
    weaponGuideSeen?: boolean;
    /** 角色面板一句话说明已展示（首次打开角色详情一次） */
    charGuideSeen?: boolean;
    /** 首个 BOSS 战规则指引已展示 */
    combatBossGuideSeen?: boolean;
    /** 已播过的剧情 beat id */
    storyBeatsSeen?: string[];
    /** 选项记录（可选回放） */
    storyChoiceLog?: Record<string, 'A' | 'B' | 'C'>;
  };
  settings: {
    /** 主页看板娘是否使用动态立绘（默认开） */
    useLivePortrait: boolean;
    /** 主页看板娘：上场角色 ID，须在 squad 内；空编队时为 null */
    hubFeaturedCharId: string | null;
    /** 主页中间层 UI（侧栏 / 远征等），不影响顶栏与底栏 */
    hubMidUiVisible: boolean;
    /** 调试：消费不扣锈币，始终维持满额 */
    debugInfiniteGold: boolean;
    /** 事件开关占位（默认关） */
    disciplineEnabled: boolean;
  };
  /** 角色营地生活 / AI 对话状态 */
  aiLiving?: AiLivingSaveData;
  /** 营地共享仓库：道具 id → 数量（见 campProps / CampWarehouseSystem） */
  campWarehouse?: Record<string, number>;
  /** 营地日更商店：游戏日刷新 30 槽，买完即下架 */
  campShop?: CampShopState;
}

export type CampShopOffer = {
  propId: string;
  /** 当日已售出（库存单位为 1） */
  sold: boolean;
};

export type CampShopState = {
  /** 对应 AiLivingSave.dayIndex */
  dayIndex: number;
  offers: CampShopOffer[];
};

export interface CombatModifiers {
  attackSpeedBonus: number;
  bossCritBonus: number;
  shieldBonus: number;
  tripleShotEnabled: boolean;
  tripleShotTriggerKills: number;
  tripleShotCooldown: number;
  projectilePierce: number;
  ironRainEnabled: boolean;
  ironRainInterval: number;
  ironRainDamageMultiplier: number;
}

export interface CombatResult {
  victory: boolean;
  kills: number;
  goldEarned: number;
  firstClear: boolean;
  reason: string;
}
