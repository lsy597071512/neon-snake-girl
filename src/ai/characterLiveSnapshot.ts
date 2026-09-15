/**
 * 角色「实时身份快照」——每次对话/同步从存档+静态档案现算。
 * 保证身高/年纪/三围/皮肤/武装/战力/礼物/好感/状态/背景与当前游戏状态一致。
 */
import type { SaveData } from '../types';
import { CHARACTER_MAP } from '../data/characters';
import { getCharacterLore } from '../data/characterLore';
import {
  getCharacterSkin,
  getCharacterSkins,
  getActiveSkinAiLookNote,
  getUnlockedSkinsAiNote,
  OUTFIT_CHANGE_SKIN_ID,
  SHOWER_SKIN_ID,
} from '../data/characterSkins';
import { getCharacterPosters } from '../data/characterPosters';
import { WEAPON_MAP } from '../data/weapons';
import { getCharacterPower } from '../core/formulas';
import { WORLD_INTRO_TITLE } from '../data/worldIntro';
import { getCharacterSleepRoom } from '../data/campLayout';
import { getAiProfile, getVoicePromptLine } from './aiProfiles';
import { getBathIntimateConsent, getBathIntimateIntroDone } from './bathIntimateConsent';
import { getCampDisplaySkinId } from './campOutfit';
import { resolvePresence } from './livingState';
import { describeAffinity, getAffinity } from './relationship';
import { describeTimeScale } from './worldClock';
import type { AiLivingSave, CharacterActivity } from './types';

/** 进 Prompt 的世界观短卡（完整序章不塞，省 token） */
export const WORLD_LORE_SYNC_BLURB =
  `${WORLD_INTRO_TITLE}：大崩解后人类消亡于辐射与连锁毁灭；锈带走廊上存活的是少女构型机械/义体。` +
  `玩家「指挥官」是被拆掉战斗模块、矮小近废料的废弃机器人（外形见 tex/zhujue.png：灰白圆顶、双红圆眼、锈红胸板、三指爪；身量远矮于队员），在零号月台边缘营地召集、培养并呵护伙伴团队。` +
  `指挥官无生理性别，本作为男性向故默认男性声音与「他」；其清醒在场时间与玩家打开游戏一致，未开游戏时沉睡离线。` +
  `地点轴：白棺谷 / 熔炉城 / 锈带走廊 / 星核禁区。家园营地为室内双层（一楼大厅枢纽+二楼中庭回廊），角色都住在里面生活。记忆会锈，小队还在则走廊未死。`;

export type LiveCharacterSnapshot = {
  characterId: string;
  name: string;
  owned: boolean;
  rarity: string;
  tag: string;
  age: string;
  height: string;
  measurements: string;
  personality: string;
  giftPreference: string;
  skillName?: string;
  skillDesc?: string;
  /** 从详细背景抽出的外形要点（发型/衣装/机体特征） */
  appearanceNotes: string;
  homeRegion: string;
  /** 背景摘要：profile.summary + 详细背景截断 */
  backgroundDigest: string;
  speechStyle: string;
  dailyRhythm: string;
  weaponId: string | null;
  weaponName: string | null;
  power: number;
  giftCount: number;
  activeSkinId: string | null;
  activeSkinName: string;
  /** 当前营地外观是否为事件临时外覆 */
  skinIsEventTemp: boolean;
  unlockedSkinIds: string[];
  hasPoster: boolean;
  portraitFront: string;
  /**
   * 自我形象锁死短句：外形要点 + 当前外覆观感 + 战斗模型提示。
   * 谈及自己时只能按此描述，禁止串其他队员外形。
   */
  selfImageLine: string;
  affinity: number;
  affinityLabel: string;
  activity: CharacterActivity | null;
  statusTags: string[];
  locationHint: string | null;
};

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** 从详细背景里抽出含外表/身材描述的段落，作外形自述依据 */
function extractAppearanceNotes(detailedBio: string, fallbackBio: string): string {
  const paras = detailedBio
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const scored =
    paras.find((p) =>
      /公分|cm|外表|岁|发|铠|衣装|泳装|睡衣|浴巾|毛巾|光环|狐耳|橙发|银|冰晶|义肢|尾节|构装/.test(p),
    ) ?? paras[1] ?? paras[0] ?? fallbackBio;
  return clip(scored, 220);
}

function activityCn(activity: CharacterActivity): string {
  const map: Record<CharacterActivity, string> = {
    idle: '闲着',
    busy: '忙碌',
    talking: '交谈中',
    sleeping: '睡觉恢复电力',
    patrol: '巡逻后',
    maintain: '维护中',
    rest: '歇息',
    play: '玩乐中',
    bathe: '洗浴中',
    eat: '用餐中',
    guard: '守门中',
  };
  return map[activity] ?? activity;
}

/**
 * 从当前存档 + 静态档案构建实时快照（所有角色均可调用，未拥有也能拿静态身份）。
 */
export function buildLiveCharacterSnapshot(
  characterId: string,
  save: SaveData | null | undefined,
  living: AiLivingSave | null | undefined,
): LiveCharacterSnapshot | null {
  const def = CHARACTER_MAP[characterId];
  if (!def) return null;

  const owned = save?.ownedCharacters?.find((o) => o.characterId === characterId) ?? null;
  const lore = getCharacterLore(characterId);
  const profile = getAiProfile(characterId);
  const weaponId = owned?.weaponId ?? null;
  const weapon = weaponId ? WEAPON_MAP[weaponId] : null;
  // 营地外观：显示通道（含换装过程皮）与主页玩家装备无关
  const activeSkinId = living ? getCampDisplaySkinId(living, characterId) : null;
  const skin = activeSkinId ? getCharacterSkin(characterId, activeSkinId) : null;
  const posters = getCharacterPosters(characterId);
  const tempSkinId = living?.eventTempSkins?.[characterId]?.skinId ?? null;
  const skinIsProcess =
    Boolean(living?.pendingOutfitChanges?.[characterId]?.phase === 'changing') &&
    activeSkinId === OUTFIT_CHANGE_SKIN_ID;

  const appearanceNotes = extractAppearanceNotes(
    lore?.detailedBio ?? def.bio,
    def.bio,
  );
  const backgroundDigest = clip(
    [profile?.summary, lore ? clip(lore.detailedBio, 280) : def.bio].filter(Boolean).join(' '),
    360,
  );

  let affinity = 0;
  let affinityLabel = '陌生';
  let activity: CharacterActivity | null = null;
  let statusTags: string[] = [];
  let locationHint: string | null = null;

  if (living) {
    const presence = resolvePresence(characterId, living);
    affinity = getAffinity(living, characterId);
    affinityLabel = describeAffinity(affinity);
    activity = presence.activity;
    statusTags = [...(presence.statusTags ?? [])];
    locationHint = `${presence.label}｜${presence.behavior}`;
  }

  const power = save
    ? getCharacterPower(characterId, weaponId, save)
    : def.basePower + (owned?.shardPowerBonus ?? 0);

  const lookNote = getActiveSkinAiLookNote(characterId, activeSkinId);
  const intimateOn =
    activeSkinId === SHOWER_SKIN_ID && getBathIntimateConsent(living, characterId);
  const liveVisNote =
    intimateOn && skin?.aiIntimateLiveNote
      ? skin.aiIntimateLiveNote
      : skin?.aiLiveNote && activeSkinId
        ? skin.aiLiveNote
        : '';
  // 出征一律默认甲；营内特别外覆不带上锈带。主页玩家装备与营地穿搭分离。
  const combatNote = skinIsProcess
    ? `此刻是换装过程立绘，不是定装；出征仍用默认装甲。主页看板娘外观由指挥官另选，与你营地穿搭无关。`
    : activeSkinId
      ? `营内正穿着「${skin?.name ?? '特别外覆'}」；出征时用默认装甲上阵，勿声称穿着泳装/睡衣/浴巾进锈带。主页看板娘外观由指挥官另选，与你营地穿搭无关。`
      : `此刻穿着默认战斗装甲（仅执勤/军械/室外干活或你主动想穿时）；营地日常基准是生活服装。出征亦用装甲。主页看板娘外观由指挥官另选，与你营地穿搭无关。`;
  const posterNote = posters
    ? `档案海报可能是默认造型；营地对话立绘以当前营地外观「${skin?.name ?? '默认外观'}」为准。`
    : `无独立海报档案时，仍以当前营地立绘为准。`;
  const bathVis =
    activeSkinId === SHOWER_SKIN_ID
      ? intimateOn
        ? getBathIntimateIntroDone(living, characterId)
          ? '玩家此刻所见：已脱掉浴巾的成人冲澡动态（循环）。'
          : '玩家此刻所见：正在播放脱掉浴巾的过渡动态，随后切无巾冲澡循环。'
        : '玩家此刻所见：冲澡待机动态（仍裹浴巾；尚未脱掉浴巾）。'
      : '';
  const changeVis = skinIsProcess
    ? '玩家此刻所见：换装过程循环动态（遮布/衣柜）；尚未换完目标外覆。'
    : '';
  const selfImageLine = clip(
    [
      `我是${def.name}，不是别人：${appearanceNotes}`,
      lookNote || '此刻穿着默认战斗/日常装甲。',
      liveVisNote,
      bathVis,
      changeVis,
      combatNote,
      posterNote,
    ]
      .filter(Boolean)
      .join(' '),
    520,
  );

  return {
    characterId,
    name: def.name,
    owned: Boolean(owned),
    rarity: def.rarity,
    tag: def.tag,
    age: def.age,
    height: def.height,
    measurements: def.measurements,
    personality: def.personality,
    giftPreference: def.giftPreference,
    skillName: def.skillName,
    skillDesc: def.skillDesc,
    appearanceNotes,
    homeRegion: lore?.homeRegion ?? profile?.homeBase ?? '零号月台营地',
    backgroundDigest,
    speechStyle: lore?.speechStyle ?? profile?.speechStyle ?? '',
    dailyRhythm: lore?.dailyRhythm ?? profile?.dailyRoutine ?? '',
    weaponId,
    weaponName: weapon?.name ?? null,
    power,
    giftCount: owned?.giftCount ?? 0,
    activeSkinId,
    activeSkinName: skin?.name ?? '默认外观',
    skinIsEventTemp: Boolean(tempSkinId) || skinIsProcess,
    unlockedSkinIds: owned?.unlockedSkins ?? [],
    hasPoster: Boolean(posters),
    portraitFront: skin?.portraits?.[0] ?? def.portraitFront ?? '',
    selfImageLine,
    affinity,
    affinityLabel,
    activity,
    statusTags,
    locationHint,
  };
}

/** 写入 LLM System/Context 的紧凑中文身份卡（实时，随存档变） */
export function liveCharacterSnapshotToPromptBlock(snap: LiveCharacterSnapshot): string {
  const statusLine = [
    snap.activity ? activityCn(snap.activity) : null,
    snap.locationHint,
    snap.statusTags.length ? `状态标：${snap.statusTags.join('、')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const skinExtra = '';
  const skinsAvail = getCharacterSkins(snap.characterId)
    .map((s) => `${s.name}(id=${s.id})`)
    .join('、');
  const wardrobeNote = getUnlockedSkinsAiNote(
    snap.characterId,
    snap.unlockedSkinIds,
    snap.activeSkinId,
  );
  const lookNote = getActiveSkinAiLookNote(snap.characterId, snap.activeSkinId);

  const sleep = getCharacterSleepRoom(snap.characterId);
  return `【自我认知·存档实时同步】（问外形/武装/战力/礼物/年纪时必须按本卡；禁止说不知道或瞎编）
姓名：${snap.name}（${snap.rarity}｜${snap.tag}）
看起来：${snap.age}｜身高 ${snap.height}｜三围 ${snap.measurements}
性格：${snap.personality}
声线锁：${getVoicePromptLine(snap.characterId)}
说话像你自己：${snap.speechStyle || snap.personality}（禁止套用别的队员口癖，禁止默认「才不是/哼」式假傲娇）
外形要点：${snap.appearanceNotes}
【自我形象·锁死】${snap.selfImageLine}
【外观锁死】谈及自己外形/衣装/义体特征时，只能用本卡「外形要点」+「当前外观/换装观感」。禁止套用其他队员的发色、光环、狐耳、兔械等。海报可能是默认造型；玩家眼前立绘必须以「当前外观：${snap.activeSkinName}」为准${snap.skinIsEventTemp ? '（含事件临时外覆）' : ''}。
当前外观：${snap.activeSkinName}${snap.skinIsEventTemp ? '（事件临时）' : ''}${skinExtra}${skinsAvail ? `（衣柜：${skinsAvail}）` : ''}
${lookNote ? `换装观感：${lookNote}` : ''}
${wardrobeNote}
【衣装术语·禁止混称】「营地装/营地标配/营地日常」=生活服装 pifu00（居家休闲，不是装甲）；「星夜睡衣」=pifu02；「默认战斗装甲/装甲/原皮」=default（仅执勤军械室外干活，不是营地日常默认）。禁止把睡衣/泳装/装甲说成营地标配。
【换装规则】营地日常默认生活服装(pifu00)。换衣服要有过程：答应后立绘切「换装中」过程动态循环，换好后才按新衣说话。默认装甲仅主动/执勤军械/室外干活。蒸汽毛巾仅洗浴。出征默认装甲。
武装：${snap.weaponName ? `${snap.weaponName}` : '未装备武器'}${snap.skillName ? `｜技能「${snap.skillName}」${snap.skillDesc ? `：${snap.skillDesc}` : ''}` : ''}
战力：约 ${snap.power}
礼物：偏好「${snap.giftPreference}」｜已收 ${snap.giftCount} 件
好感：${snap.affinity}/100（${snap.affinityLabel}）${snap.owned ? '' : '｜尚未加入小队（静态身份仍有效）'}
此刻：${statusLine || '营地日常'}
卧室：${sleep.floor}楼·${sleep.label}
归属地：${snap.homeRegion}
背景你清楚（口语聊，勿背设定集）：${snap.backgroundDigest}
海报/立绘：玩家看到的是游戏里当前那套外观，必须与「当前外观」一致；勿描述未穿的外覆。`;
}

export function buildWorldSyncPromptBlock(): string {
  return `【世界观·同步】${WORLD_LORE_SYNC_BLURB}
你活在这个世界里，环境（营地/室内/天气/时间）以本轮「场景卡」与时钟为准，会变。
【时间流速】${describeTimeScale()}。你感知到的是游戏内时钟；日程/洗浴/睡觉时长均按游戏分钟计算。`;
}

/** 为所有角色建表（陪伴同步 / 调试用） */
export function buildAllCharacterSnapshots(
  save: SaveData,
  living: AiLivingSave | null | undefined,
): Record<string, LiveCharacterSnapshot> {
  const out: Record<string, LiveCharacterSnapshot> = {};
  for (const id of Object.keys(CHARACTER_MAP)) {
    const snap = buildLiveCharacterSnapshot(id, save, living);
    if (snap) out[id] = snap;
  }
  return out;
}
