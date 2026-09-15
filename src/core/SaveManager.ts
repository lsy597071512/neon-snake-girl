import type { SaveData, PlayerStats } from '../types';
import { ECONOMY, STARTER } from '../data/stages';
import { syncCharacterSkinRuntime } from '../ui/characterSkinRuntime';
import { createDefaultAiLiving } from '../ai/worldClock';
import { recoverStaleDisciplineSession } from '../ai/disciplineSession';
import { applyCharacterPersonaResets } from '../ai/personaReset';
import { applyPoolPartySkinRollout } from '../ai/poolPartySkinRollout';
import { applySpecialOutfitSkinRollout } from '../ai/specialOutfitSkinRollout';
import { applyLifewearCampDefaultRollout } from '../ai/lifewearCampDefaultRollout';
import { pushCompanionSync } from '../bridge/companionSync';
import { seedCampEconomy } from '../systems/CampWarehouseSystem';
import { SWEEP_MAX_CHARGES, syncSweepRecovery } from '../systems/SweepSystem';
import { applyStoryMigration } from '../systems/StoryGuideSystem';

const SAVE_KEY = 'rust-belt-era-save-v1';
const SAVE_VERSION = 8;

export const DEBUG_INFINITE_GOLD = 999999999;

export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    gold: ECONOMY.startGold,
    tickets: ECONOMY.startTickets,
    gachaPity: 0,
    armoryLevel: 1,
    armoryUpgradeEnd: null,
    ownedCharacters: STARTER.characters.map((c) => ({
      characterId: c.characterId,
      weaponId: c.weaponId,
      giftCount: 0,
      shardPowerBonus: 0,
    })),
    ownedWeaponIds: [...STARTER.ownedWeaponIds],
    squad: [...STARTER.squad],
    clearedStages: [],
    achievementsClaimed: [],
    tasksClaimed: [],
    characterShards: {},
    weaponShards: {},
    characterShardUses: {},
    weaponShardUses: {},
    weaponEnhanceBonus: {},
    stats: {
      stagesCleared: 0,
      totalKills: 0,
      charactersOwned: STARTER.characters.length,
      giftsSent: 0,
      legendariesEquipped: 0,
      highestStage: 0,
      playTimeSeconds: 0,
    },
    sweepCharges: SWEEP_MAX_CHARGES,
    sweepRecoverAnchorAt: Date.now(),
    tutorialFlags: {
      combatDone: false,
      armoryVideoSeen: false,
      worldIntroSeen: false,
      storyHubFollowSeen: false,
      storyGuideStep: 'g_hello',
      storyGuideDone: false,
      storyGuideArmoryOpened: false,
      storyBeatsSeen: [],
      storyChoiceLog: {},
    },
    settings: {
      useLivePortrait: true,
      hubFeaturedCharId: STARTER.squad[0] ?? null,
      hubMidUiVisible: true,
      debugInfiniteGold: false,
      disciplineEnabled: true,
    },
    aiLiving: createDefaultAiLiving(),
    campWarehouse: {},
    campShop: { dayIndex: -1, offers: [] },
  };
}

function migrateSave(raw: Partial<SaveData>): SaveData {
  const base = createDefaultSave();
  const ownedCharacters = Array.isArray(raw.ownedCharacters) ? raw.ownedCharacters : base.ownedCharacters;
  const ownedWeaponIds = Array.isArray(raw.ownedWeaponIds)
    ? raw.ownedWeaponIds.filter((id): id is string => typeof id === 'string')
    : [...base.ownedWeaponIds];

  const migrated: SaveData = {
    ...base,
    ...raw,
    version: SAVE_VERSION,
    ownedCharacters: ownedCharacters.map((c) => {
      const normalized = { ...c };
      if (normalized.weaponId === undefined) normalized.weaponId = null;
      if (normalized.giftCount === undefined) normalized.giftCount = 0;
      if (normalized.shardPowerBonus === undefined) normalized.shardPowerBonus = 0;
      if (!Array.isArray(normalized.unlockedSkins)) normalized.unlockedSkins = [];
      if (normalized.activeSkinId === undefined) normalized.activeSkinId = null;
      return normalized;
    }),
    ownedWeaponIds,
    squad: Array.isArray(raw.squad) ? raw.squad.filter((id): id is string => typeof id === 'string') : [...base.squad],
    clearedStages: Array.isArray(raw.clearedStages) ? raw.clearedStages.filter((id): id is number => typeof id === 'number') : [],
    achievementsClaimed: Array.isArray(raw.achievementsClaimed)
      ? raw.achievementsClaimed.filter((id): id is string => typeof id === 'string')
      : [],
    tasksClaimed: Array.isArray(raw.tasksClaimed)
      ? raw.tasksClaimed.filter((id): id is string => typeof id === 'string')
      : [],
    characterShards: typeof raw.characterShards === 'object' && raw.characterShards ? { ...raw.characterShards } : {},
    weaponShards: typeof raw.weaponShards === 'object' && raw.weaponShards ? { ...raw.weaponShards } : {},
    characterShardUses:
      typeof raw.characterShardUses === 'object' && raw.characterShardUses ? { ...raw.characterShardUses } : {},
    weaponShardUses: typeof raw.weaponShardUses === 'object' && raw.weaponShardUses ? { ...raw.weaponShardUses } : {},
    weaponEnhanceBonus:
      typeof raw.weaponEnhanceBonus === 'object' && raw.weaponEnhanceBonus ? { ...raw.weaponEnhanceBonus } : {},
    stats: {
      ...base.stats,
      ...raw.stats,
      playTimeSeconds: raw.stats?.playTimeSeconds ?? base.stats.playTimeSeconds,
    },
    sweepCharges:
      typeof raw.sweepCharges === 'number'
        ? Math.max(0, Math.min(SWEEP_MAX_CHARGES, raw.sweepCharges))
        : SWEEP_MAX_CHARGES,
    sweepRecoverAnchorAt:
      typeof raw.sweepRecoverAnchorAt === 'number' ? raw.sweepRecoverAnchorAt : Date.now(),
    tutorialFlags: {
      ...base.tutorialFlags,
      ...raw.tutorialFlags,
      armoryVideoSeen: raw.tutorialFlags?.armoryVideoSeen ?? base.tutorialFlags.armoryVideoSeen,
      worldIntroSeen:
        raw.tutorialFlags?.worldIntroSeen ??
        Boolean(
          (Array.isArray(raw.clearedStages) && raw.clearedStages.length > 0) ||
            (raw.stats?.stagesCleared ?? 0) > 0 ||
            (raw.stats?.playTimeSeconds ?? 0) > 60,
        ),
      storyHubFollowSeen: raw.tutorialFlags?.storyHubFollowSeen ?? false,
      storyGuideStep: raw.tutorialFlags?.storyGuideStep ?? 'g_hello',
      storyGuideDone: raw.tutorialFlags?.storyGuideDone ?? false,
      storyGuideArmoryOpened: raw.tutorialFlags?.storyGuideArmoryOpened ?? false,
      storyBeatsSeen: Array.isArray(raw.tutorialFlags?.storyBeatsSeen)
        ? [...raw.tutorialFlags!.storyBeatsSeen!]
        : [],
      storyChoiceLog:
        raw.tutorialFlags?.storyChoiceLog && typeof raw.tutorialFlags.storyChoiceLog === 'object'
          ? { ...raw.tutorialFlags.storyChoiceLog }
          : {},
    },
    settings: {
      ...base.settings,
      ...raw.settings,
      // v7：主页看板娘默认动态立绘；旧档一次性切到开（之后仍可由设置开关）
      useLivePortrait:
        (raw.version ?? 0) < 7
          ? true
          : (raw.settings?.useLivePortrait ?? base.settings.useLivePortrait),
      hubFeaturedCharId:
        raw.settings?.hubFeaturedCharId !== undefined
          ? raw.settings.hubFeaturedCharId
          : base.settings.hubFeaturedCharId,
      hubMidUiVisible: raw.settings?.hubMidUiVisible ?? base.settings.hubMidUiVisible,
      debugInfiniteGold: raw.settings?.debugInfiniteGold ?? base.settings.debugInfiniteGold,
      disciplineEnabled: raw.settings?.disciplineEnabled ?? true,
    },
    aiLiving: raw.aiLiving
      ? {
          ...createDefaultAiLiving(),
          ...raw.aiLiving,
          affinities: raw.aiLiving.affinities ?? {},
          relationships: raw.aiLiving.relationships ?? {},
          memories: raw.aiLiving.memories ?? {},
          campLog: Array.isArray(raw.aiLiving.campLog) ? raw.aiLiving.campLog : [],
          characterStatus: raw.aiLiving.characterStatus ?? {},
          recentChats: raw.aiLiving.recentChats ?? {},
          chatDigests: raw.aiLiving.chatDigests ?? {},
          lastTalkAt: raw.aiLiving.lastTalkAt ?? {},
          agendas: raw.aiLiving.agendas ?? {},
          activeCampEvents: Array.isArray(raw.aiLiving.activeCampEvents)
            ? raw.aiLiving.activeCampEvents
            : [],
          eventHistory: Array.isArray(raw.aiLiving.eventHistory) ? raw.aiLiving.eventHistory : [],
          lastCampEventSpawnGameMin: raw.aiLiving.lastCampEventSpawnGameMin ?? 0,
          personas: raw.aiLiving.personas ?? {},
          personaResets: raw.aiLiving.personaResets ?? {},
          skinRollouts: raw.aiLiving.skinRollouts ?? {},
          lifeGoals: raw.aiLiving.lifeGoals ?? {},
          characterPockets: raw.aiLiving.characterPockets ?? {},
          characterCyberHealth: raw.aiLiving.characterCyberHealth ?? {},
          lastCyberAgingDayIndex: raw.aiLiving.lastCyberAgingDayIndex ?? raw.aiLiving.dayIndex ?? 0,
          pendingCyberHealthEvents: Array.isArray(raw.aiLiving.pendingCyberHealthEvents)
            ? raw.aiLiving.pendingCyberHealthEvents
            : [],
          characterCyberLoadout: raw.aiLiving.characterCyberLoadout ?? {},
          campPlacements: raw.aiLiving.campPlacements ?? {},
          structuredFacts: raw.aiLiving.structuredFacts ?? {},
          relationshipArcStage: raw.aiLiving.relationshipArcStage ?? {},
        }
      : createDefaultAiLiving(),
    campWarehouse:
      typeof raw.campWarehouse === 'object' && raw.campWarehouse ? { ...raw.campWarehouse } : {},
    campShop:
      raw.campShop &&
      typeof raw.campShop === 'object' &&
      Array.isArray((raw.campShop as { offers?: unknown }).offers)
        ? {
            dayIndex: Number((raw.campShop as { dayIndex?: number }).dayIndex) || -1,
            offers: (
              (raw.campShop as { offers: { propId?: string; sold?: boolean }[] }).offers || []
            )
              .filter((o) => typeof o?.propId === 'string')
              .map((o) => ({ propId: o.propId!, sold: Boolean(o.sold) })),
          }
        : { dayIndex: -1, offers: [] },
  };

  if (migrated.aiLiving) {
    const living = migrated.aiLiving as import('../ai/types').AiLivingSave;
    applyCharacterPersonaResets(living);
    applyPoolPartySkinRollout(migrated, living);
    applySpecialOutfitSkinRollout(migrated, living);
    applyLifewearCampDefaultRollout(migrated, living);
    seedCampEconomy(migrated, living);
    // 读档若卡在调教态 → 自动结算，避免永久锁皮/锁房
    recoverStaleDisciplineSession(migrated, living);
  }

  // 看板娘必须在上场编队内；空编队则清空
  if (!migrated.squad.length) {
    migrated.settings.hubFeaturedCharId = null;
  } else if (
    !migrated.settings.hubFeaturedCharId ||
    !migrated.squad.includes(migrated.settings.hubFeaturedCharId)
  ) {
    migrated.settings.hubFeaturedCharId = migrated.squad[0];
  }

  const rawHadProgress = Boolean(
    (Array.isArray(raw.clearedStages) && raw.clearedStages.length > 0) ||
      (raw.stats?.stagesCleared ?? 0) > 0 ||
      (raw.stats?.highestStage ?? 0) > 0,
  );
  applyStoryMigration(migrated, rawHadProgress);

  applyDebugInfiniteGold(migrated);

  const equippedCounts = new Map<string, number>();
  for (const owned of migrated.ownedCharacters) {
    if (!owned.weaponId) continue;
    equippedCounts.set(owned.weaponId, (equippedCounts.get(owned.weaponId) ?? 0) + 1);
  }

  for (const [weaponId, equipped] of equippedCounts) {
    let owned = 0;
    for (const wid of migrated.ownedWeaponIds) {
      if (wid === weaponId) owned++;
    }
    while (owned < equipped) {
      migrated.ownedWeaponIds.push(weaponId);
      owned++;
    }
  }
  syncCharacterSkinRuntime(migrated);
  return migrated;
}

export function applyDebugInfiniteGold(d: SaveData): void {
  if (d.settings.debugInfiniteGold) d.gold = DEBUG_INFINITE_GOLD;
}

export class SaveManager {
  private data: SaveData;
  private revision = 0;

  constructor() {
    this.data = this.load();
    syncCharacterSkinRuntime(this.data);
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return createDefaultSave();
      const migrated = migrateSave(JSON.parse(raw) as Partial<SaveData>);
      // 迁移可能自动结束异常中断的小黑屋会话；必须立即落盘，
      // 否则下次重启会再次读到旧的 active=true 状态。
      const normalized = JSON.stringify(migrated);
      if (normalized !== raw) localStorage.setItem(SAVE_KEY, normalized);
      return migrated;
    } catch {
      return createDefaultSave();
    }
  }

  save(): void {
    applyDebugInfiniteGold(this.data);
    localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    // 存档一变就推实时角色身份（身高/皮肤/武装/好感/状态…）；陪伴端未启动则静默失败
    pushCompanionSync(this.data);
  }

  reset(): void {
    this.data = createDefaultSave();
    syncCharacterSkinRuntime(this.data);
    this.save();
  }

  get(): SaveData {
    syncSweepRecovery(this.data);
    applyDebugInfiniteGold(this.data);
    return this.data;
  }

  /** Changes while an async clone is in flight make that clone stale. */
  getRevision(): number {
    return this.revision;
  }

  mutate(fn: (d: SaveData) => void): void {
    syncSweepRecovery(this.data);
    fn(this.data);
    this.revision += 1;
    applyDebugInfiniteGold(this.data);
    syncCharacterSkinRuntime(this.data);
    this.syncStats();
    this.save();
  }

  private syncStats(): void {
    const d = this.data;
    d.stats.charactersOwned = d.ownedCharacters.length;
    d.stats.stagesCleared = d.clearedStages.length;
    d.stats.highestStage = d.clearedStages.length ? Math.max(...d.clearedStages) : 0;
  }

  updateStats(partial: Partial<PlayerStats>): void {
    Object.assign(this.data.stats, partial);
    this.save();
  }
}

export const saveManager = new SaveManager();
