/**
 * 锈带纪元 → 赛博陪伴 实时存档桥
 * 在 SaveManager.save() 末尾调用 pushCompanionSync(this.data)
 */
import type { SaveData } from '../types';
import {
  buildAllCharacterSnapshots,
  buildLiveCharacterSnapshot,
} from '../ai/characterLiveSnapshot';
import { formatGameClock } from '../ai/worldClock';
import type { AiLivingSave } from '../ai/types';

const COMPANION_INGEST =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { VITE_COMPANION_SYNC_URL?: string } }).env?.VITE_COMPANION_SYNC_URL) ||
  'http://127.0.0.1:8787/api/sync/ingest';

function asLiving(d: SaveData): AiLivingSave | null {
  return (d.aiLiving as AiLivingSave) || null;
}

export function buildCompanionLivePayload(d: SaveData) {
  const living = asLiving(d);
  const snaps = buildAllCharacterSnapshots(d, living);
  const characters: Record<string, unknown> = {};

  for (const [id, snap] of Object.entries(snaps)) {
    characters[id] = {
      characterId: snap.characterId,
      name: snap.name,
      owned: snap.owned,
      rarity: snap.rarity,
      tag: snap.tag,
      age: snap.age,
      height: snap.height,
      measurements: snap.measurements,
      personality: snap.personality,
      giftPreference: snap.giftPreference,
      appearanceNotes: snap.appearanceNotes,
      homeRegion: snap.homeRegion,
      backgroundDigest: snap.backgroundDigest,
      weaponId: snap.weaponId,
      weaponName: snap.weaponName,
      giftCount: snap.giftCount,
      powerEstimate: snap.power,
      unlockedSkins: snap.unlockedSkinIds,
      activeSkinId: snap.activeSkinId,
      activeSkinName: snap.activeSkinName,
      hasPoster: snap.hasPoster,
      portraitFront: snap.portraitFront,
      skillName: snap.skillName,
      skillDesc: snap.skillDesc,
      live: living
        ? {
            affinity: snap.affinity,
            affinityLabel: snap.affinityLabel,
            activity: snap.activity,
            statusTags: snap.statusTags,
            locationHint: snap.locationHint,
            memories: (living.memories?.[id] ?? []).slice(0, 8),
            recentChats: (living.recentChats?.[id] ?? []).slice(-12),
            lastTalkAt: living.lastTalkAt?.[id] ?? 0,
          }
        : null,
    };
  }

  return {
    version: 2,
    source: 'rust-belt-era',
    pushedAt: Date.now(),
    clock: living ? formatGameClock(living) : null,
    dayIndex: living?.dayIndex ?? 0,
    gameMinutes: living?.gameMinutes ?? 0,
    playerLocationId: living?.playerLocationId ?? null,
    hubFeaturedCharId: d.settings?.hubFeaturedCharId ?? null,
    squad: d.squad ?? [],
    characters,
    campLog: living?.campLog?.slice(0, 20) ?? [],
    /** 快捷：当前主页角色的完整实时卡 */
    featuredSnapshot: d.settings?.hubFeaturedCharId
      ? buildLiveCharacterSnapshot(d.settings.hubFeaturedCharId, d, living)
      : null,
  };
}

let lastPush = 0;
let inflight: Promise<void> | null = null;

/** 存档变更后推送到陪伴应用（节流，失败静默） */
export function pushCompanionSync(d: SaveData): void {
  const now = Date.now();
  if (now - lastPush < 800) return;
  lastPush = now;

  const payload = buildCompanionLivePayload(d);
  const body = JSON.stringify(payload);

  inflight = (async () => {
    try {
      await fetch(COMPANION_INGEST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        mode: 'cors',
        keepalive: true,
      });
    } catch {
      // companion 未启动时忽略
    }
  })();
}

export async function flushCompanionSync(): Promise<void> {
  if (inflight) await inflight;
}
