/** 特别皮肤（泳池 / 睡衣 / 冲澡 / 生活时装 / 特殊服装01等）美术资源：tex/juese/pifu/ */

export const CHARACTER_SKIN_PRICE = 20000;
/** 睡衣、冲澡等半价皮肤 */
export const CHARACTER_SKIN_HALF_PRICE = Math.floor(CHARACTER_SKIN_PRICE / 2);
export const POOL_PARTY_SKIN_ID = 'pifu01';
export const SLEEPWEAR_SKIN_ID = 'pifu02';
/** 蒸汽毛巾：仅洗浴/冲澡时刻生效（临时外覆） */
export const SHOWER_SKIN_ID = 'pifu03';
export const SHOWER_SKIN_NAME = '蒸汽毛巾';
/** 洗浴临时外覆用的伪事件实例 id */
export const BATHE_TEMP_SKIN_INSTANCE = 'bathe_auto';
/** 浴室互动：旧版本兼容导出（新浴室会话文件引用，语义与当前洗浴临时层一致）。 */
export const BATH_ASSIST_TEMP_SKIN_INSTANCE = BATHE_TEMP_SKIN_INSTANCE;
export const BATH_HELP_SKIN_ID = 'pifu07';
export const BATH_CO_SKIN_ID = 'pifu08';
export const BATH_SOLO_SKIN_ID = 'pifu09';
/**
 * 独自泡澡/蒸汽毛巾属于同一类"浴巾态"外覆。
 * 画面上「浴巾裹身」的判定必须同时认 pifu09 与 pifu03，
 * 否则角色实际穿着 pifu03（蒸汽毛巾）时会被当成"生活服装"，导致
 * 「对白说在泡澡 / 画面却是便装」这类逻辑矛盾。
 */
export function isAloneBathSkinId(skinId: string | null | undefined): boolean {
  return skinId === BATH_SOLO_SKIN_ID || skinId === SHOWER_SKIN_ID;
}
/**
 * 独自泡澡皮解析：优先 pifu09（专属独浴动态），无该资源时回退 pifu03（蒸汽毛巾）。
 * pifu09 仅部分角色有资源；不能无条件返回 pifu09，否则会挂上一块不存在的皮，
 * 立绘永远停在便装上（角色说"我在泡澡"但画面是生活服装）。
 */
export function resolveAloneBathSkinId(characterId?: string): string | null {
  if (!characterId) return BATH_SOLO_SKIN_ID;
  if (getCharacterSkin(characterId, BATH_SOLO_SKIN_ID)) return BATH_SOLO_SKIN_ID;
  if (getCharacterSkin(characterId, SHOWER_SKIN_ID)) return SHOWER_SKIN_ID;
  return null;
}
/** 都市私服：活动/娱乐/派对/好心情 */
export const CASUAL_FASHION_SKIN_ID = 'pifu04';
export const CASUAL_FASHION_SKIN_NAME = '都市私服';
/** 特殊服装01：角色主动展示/尝试个性化造型（营地） */
export const SPECIAL_DARE_SKIN_ID = 'pifu05';
/** @deprecated 旧名兼容；请用 SPECIAL_OUTFIT_01_SKIN_NAME */
export const SPECIAL_DARE_SKIN_NAME = '特殊服装01';
export const SPECIAL_OUTFIT_01_SKIN_ID = SPECIAL_DARE_SKIN_ID;
export const SPECIAL_OUTFIT_01_SKIN_NAME = '特殊服装01';
/** 备用装皮肤：该玩法已下线，仅保留占位（不可购） */
export const DISCIPLINE_SKIN_ID = 'pifu06';
export const DISCIPLINE_SKIN_NAME = '备用装';
/** 事件临时层实例 id */
export const DISCIPLINE_TEMP_SKIN_INSTANCE = 'discipline_session';
/** 共舞皮肤：营地/活动共舞演出动态（可购看板娘） */
export const GONGWU_SKIN_ID = 'pifu10';
export const GONGWU_SKIN_NAME = '共舞';
/** 单独舞蹈皮肤：单人舞蹈演出动态（可购看板娘） */
export const DANDU_SKIN_ID = 'pifu11';
export const DANDU_SKIN_NAME = '单独舞蹈';
/**
 * 舞蹈待机（准备跳舞）皮肤：功能性事件皮。
 * 仅舞蹈会话「准备→跳舞」期间由系统挂上（此时角色处于准备舞姿的待机态），
 * 不可购买、不进看板娘、不可被 skin_change 点名穿着。见 src/ai/danceSession.ts。
 */
export const DANCE_IDLE_SKIN_ID = 'pifu12';
export const DANCE_IDLE_SKIN_NAME = '舞蹈待机';
/** 舞蹈会话临时层实例 id（准备待机 / 独舞 / 共舞都挂在此实例下） */
export const DANCE_TEMP_SKIN_INSTANCE = 'dance_session';

/**
 * 安抚室（三相功能性事件皮，仅安抚会话可临时穿着，不可购买/看板娘/点名）。
 * - anfu_standby：同意后换上动物服装的待机（还未进入安抚状态）
 * - anfu_active：棉花游戏进行中（多次攻击按序播片段）
 * - anfu_done：安抚值满后的满足休息态
 * 见 src/ai/anfuSession.ts。
 */
export const ANFU_STANDBY_SKIN_ID = 'anfu_standby';
export const ANFU_STANDBY_SKIN_NAME = '安抚待机';
export const ANFU_ACTIVE_SKIN_ID = 'anfu_active';
export const ANFU_ACTIVE_SKIN_NAME = '安抚中';
export const ANFU_DONE_SKIN_ID = 'anfu_done';
export const ANFU_DONE_SKIN_NAME = '安抚疲惫';
/** 安抚会话临时层实例 id（待机 / 安抚中 / 疲惫都挂在此实例下） */
export const ANFU_TEMP_SKIN_INSTANCE = 'anfu_session';
/**
 * 卸甲皮肤（xiejia）：2026-10-22 H3 批次素材改造（原象棋主题失败稿）。
 *
 * 定位：玩家请求 + 角色同意后穿着的「轻装坦诚」外覆（非商店皮）：
 *   - 只在大厅 / 房间等日常场所、且未参与任何事件时可穿（canWearXiejiaSkin 门控）；
 *   - 对弈或小游戏输了被指挥官提议时，愿赌服输更难拒绝；
 *   - 无时间限制，角色随时可走正常换装切回（skin_change=pifu00 / default）；
 *   - price = 0 且不进看板娘商店；
 *   - 素材为成人向，仅走云端 P1 分发（登录后下载），不进 APK 首包；
 *   - 资源目录 tex/juese/pifu/xiejia/，文件名保留历史后缀 `{ArtStem}_wuziqi.webm`。
 *
 * 皮肤 id 保留 'wuziqi'（历史存档键/文件命名），语义常量用 XIEJIA_*。
 */
export const XIEJIA_SKIN_ID = 'wuziqi';
export const XIEJIA_SKIN_NAME = '卸甲';
/** @deprecated 旧名（象棋失败稿时代）；语义常量请用 XIEJIA_* */
export const WUZIQI_SKIN_ID = XIEJIA_SKIN_ID;
/** @deprecated 旧名；请用 XIEJIA_SKIN_NAME */
export const WUZIQI_SKIN_NAME = XIEJIA_SKIN_NAME;

/** 是否舞蹈事件专用皮（待机 / 独舞 / 共舞）——仅舞蹈会话可临时穿着 */
export function isDanceEventSkinId(skinId: string | null | undefined): boolean {
  return (
    skinId === DANCE_IDLE_SKIN_ID ||
    skinId === GONGWU_SKIN_ID ||
    skinId === DANDU_SKIN_ID
  );
}
/**
 * 换装过程皮（功能性）：仅 `pendingOutfitChanges.phase=changing` 时由系统自动播放。
 * 不可购买、不可看板娘、不可 skin_change 点名穿着；换装到点后过渡到目标皮。
 */
/** 是否安抚事件专用皮（待机 / 安抚中 / 疲惫）——仅安抚会话可临时穿着 */
export function isAnfuEventSkinId(skinId: string | null | undefined): boolean {
  return (
    skinId === ANFU_STANDBY_SKIN_ID ||
    skinId === ANFU_ACTIVE_SKIN_ID ||
    skinId === ANFU_DONE_SKIN_ID
  );
}
export const OUTFIT_CHANGE_SKIN_ID = 'huanzhuang';
export const OUTFIT_CHANGE_SKIN_NAME = '换装中';
export function isOutfitChangeProcessSkin(skinId: string | null | undefined): boolean {
  return skinId === OUTFIT_CHANGE_SKIN_ID;
}

/** 生活服装：营地日常居家/出门休闲基准皮（营地默认；非战斗装甲） */
export const LIFEWEAR_SKIN_ID = 'pifu00';
export const LIFEWEAR_SKIN_NAME = '生活服装';
/** campWornSkins 存此值表示明确穿着默认战斗装甲 */
export const CAMP_ARMOR_MARKER = 'default';
export function isCampArmorMarker(skinId: string | null | undefined): boolean {
  return skinId === CAMP_ARMOR_MARKER || skinId === 'armor';
}


export type CharacterSkinDef = {
  /** 皮肤 id，如 pifu01 */
  id: string;
  name: string;
  price: number;
  /** 预览图（未解锁时灰阶显示） */
  preview: string;
  /** 静态立绘：可在主页正/背面切换（≥2 张时） */
  portraits: string[];
  /** 主页/营地默认循环动态立绘；空字符串=无动态，穿皮肤时用静态图 */
  portraitLive: string;
  /**
   * 营地洗浴同意后才播放的解巾冲澡动态（webm）。
   * 浴室常态用 portraitLive（待机 idle）；仅 camp 通道 + 同意后切到本字段。
   */
  portraitLiveIntimate?: string;
  /**
   * 同意脱巾后先播一次的完整脱浴巾动态（*_pifu03_full.webm），播完再接 portraitLiveIntimate 循环。
   */
  portraitLiveIntimateIntro?: string;
  /**
   * 营地 activity=sleeping 时播放的睡眠循环动态（webm）。
   * 睡衣常态（醒着穿睡衣）仍用 portraitLive。
   */
  portraitLiveSleep?: string;
  /** 点击切换的互动动态立绘（按序循环到末尾后停在最后一条） */
  portraitLiveSecondaries: string[];
  /**
   * 安抚室专用片段清单（棉花游戏的逐段演出）。
   *
   * 关键：这些片段**故意不写进 portraitLiveSecondaries**。
   * secondaries 是「通用互动片段」通道，会被长按选段器、AI skin_clip、情绪图回退
   * 等多处争抢；安抚片段一旦进入该通道，就会与情绪立绘/换皮刷新互相打断，
   * 表现为「播一段停住 → 又切另一段 → 乱序回放第一段」。
   * 独立字段 + 独立播放层（dialoguePortraitStage 的 anfu-clip 层）才是正确归属。
   */
  anfuClips?: string[];
  /** 互动动态对应的循环片段（与 secondaries 一一对应，可选）。 */
  portraitLiveSecondaryLoops?: Array<string | null>;
  /** 战斗模型；缺省则沿用角色默认 glb */
  combatModel: string | null;
  /** 给 AI 的外观一句（换装后进 Prompt） */
  aiLookNote: string;
  /** 动态立绘内容（给 AI 对齐玩家所见；有 webm 时填写） */
  aiLiveNote?: string;
  /** 冲澡解巾动态内容（同意后立绘切换时注入 AI） */
  aiIntimateLiveNote?: string;
  /** 睡觉循环动态内容（营地 sleeping 时注入 AI） */
  aiSleepLiveNote?: string;
};

const PIFU = './tex/juese/pifu';
const SHUIYI = `${PIFU}/shuiyi`;
const CHONGZAO = `${PIFU}/chongzao`;
const CHONGZAO01 = `${PIFU}/chongzao01`;
const CHONGZAO02 = `${PIFU}/chongzao02`;
const CASUAL = `${PIFU}/shenghuoshizhuang01`;
const SPECIAL = `${PIFU}/teshufuzhuang01`;
const TIAOJIAO = `${PIFU}/tiaojiao`;
const HUANZHUANG = `${PIFU}/huanzhuang`;
const LIFEWEAR = `${PIFU}/shenghuofuzhuang00`;
const GONGWU = `${PIFU}/gongwu`;
const DANDU = `${PIFU}/dandu`;
const DANCEIDLE = `${PIFU}/danceidle`;
const ANFU = `${PIFU}/anfu`;
const WUZIQI = `${PIFU}/xiejia`;

function poolParty(
  artStem: string,
  opts: {
    staticCount: number;
    secondaryCount: number;
    /** 无独立 glb 时 false，战斗回退默认皮肤模型 */
    hasCombatModel?: boolean;
    /** 无动态 webm 时 false（仅静态泳装立绘） */
    hasLive?: boolean;
    name?: string;
    aiLookNote?: string;
  },
): CharacterSkinDef {
  const base = `${PIFU}/${artStem}_pifu01`;
  const portraits = Array.from({ length: Math.max(1, opts.staticCount) }, (_, i) =>
    i === 0 ? `${base}.png` : `${base}_${i}.png`,
  );
  const hasLive = opts.hasLive !== false;
  const portraitLiveSecondaries = hasLive
    ? Array.from(
        { length: Math.max(0, opts.secondaryCount) },
        (_, i) => `${base}_${i + 1}.webm`,
      )
    : [];
  return {
    id: POOL_PARTY_SKIN_ID,
    name: opts.name ?? '泳池派对',
    price: CHARACTER_SKIN_PRICE,
    preview: portraits[0],
    portraits,
    portraitLive: hasLive ? `${base}.webm` : '',
    portraitLiveSecondaries,
    combatModel: opts.hasCombatModel === false ? null : `${base}.glb`,
    aiLookNote:
      opts.aiLookNote ??
      '正穿着泳池派对特别外覆：泳装型轻甲、夏日活动配色，与默认战斗装甲不同。',
  };
}

function sleepwear(
  artStem: string,
  opts: {
    /** 无动态 webm 时 false（仅静态睡衣立绘） */
    hasLive?: boolean;
    /** 睡觉循环动态；默认与 hasLive 同开 */
    hasSleepLive?: boolean;
    aiLookNote?: string;
    aiLiveNote?: string;
    aiSleepLiveNote?: string;
  } = {},
): CharacterSkinDef {
  const base = `${SHUIYI}/${artStem}_pifu02`;
  const hasLive = opts.hasLive === true;
  const hasSleepLive = opts.hasSleepLive ?? hasLive;
  return {
    id: SLEEPWEAR_SKIN_ID,
    name: '星夜睡衣',
    price: CHARACTER_SKIN_HALF_PRICE,
    preview: `${base}.png`,
    portraits: [`${base}.png`],
    portraitLive: hasLive ? `${base}.webm` : '',
    portraitLiveSleep: hasSleepLive ? `${base}_sleep.webm` : undefined,
    portraitLiveSecondaries: [],
    combatModel: null,
    aiLookNote:
      opts.aiLookNote ??
      '正穿着星夜睡衣外覆：柔软家居款、夜间放松配色，与默认战斗装甲明显不同。',
    aiLiveNote: hasLive
      ? (opts.aiLiveNote ??
        '玩家所见为星夜睡衣循环动态立绘：家居款轻呼吸/微摆，与静帧同一套外形，勿描述成装甲或泳装。')
      : undefined,
    aiSleepLiveNote: hasSleepLive
      ? (opts.aiSleepLiveNote ??
        '玩家所见为星夜睡衣睡眠循环动态：侧躺/蜷缩睡姿、轻呼吸；与静帧同一套外形与义体，勿描述成装甲或泳装。由睡眠系统在「完全入睡」时触发，非整日站立 idle。')
      : undefined,
  };
}

function showerWear(
  artStem: string,
  opts: {
    aiLookNote?: string;
    /** 默认 true：有 {Stem}_pifu03_idle.webm 浴室常态待机动态 */
    hasIdleLive?: boolean;
    /** 默认 true：有 {Stem}_pifu03.webm 解巾洗浴动态（须 bath_intimate_consent） */
    hasIntimateLive?: boolean;
    aiLiveNote?: string;
    aiIntimateLiveNote?: string;
  } = {},
): CharacterSkinDef {
  const base = `${CHONGZAO}/${artStem}_pifu03`;
  // 市场版打码：解巾/完整脱巾动态走 dama/ 打码版（未打码原版留 tex/ 本地备份，不进包）
  const damaBase = `${CHONGZAO}/dama/${artStem}_pifu03`;
  const hasIdle = opts.hasIdleLive !== false;
  const hasIntimate = opts.hasIntimateLive !== false;
  return {
    id: SHOWER_SKIN_ID,
    name: SHOWER_SKIN_NAME,
    price: CHARACTER_SKIN_HALF_PRICE,
    preview: `${base}.png`,
    portraits: [`${base}.png`],
    /** 浴室常态：冲澡待机动态；解巾同意后才切 portraitLiveIntimate */
    portraitLive: hasIdle ? `${base}_idle.webm` : '',
    portraitLiveIntimate: hasIntimate ? `${damaBase}_sticker.webm` : undefined,
    portraitLiveIntimateIntro: hasIntimate ? `${damaBase}_full_sticker.webm` : undefined,
    portraitLiveSecondaries: [],
    combatModel: null,
    aiLookNote:
      opts.aiLookNote ??
      '正穿着蒸汽毛巾外覆：白色浴巾、刚冲过澡的湿润感，仅营地浴室洗浴时可穿；出浴室即换回。浴室常态立绘为冲澡待机动态。',
    aiLiveNote: hasIdle
      ? (opts.aiLiveNote ??
        '玩家所见为冲澡待机动态：白浴巾裹身、轻呼吸/微摆与水汽感，与静帧同一套外形；尚未同意同浴/旁观，勿描述解下浴巾或过界戏。')
      : undefined,
    aiIntimateLiveNote: hasIntimate
      ? (opts.aiIntimateLiveNote ??
        '洗浴互动动态：解下浴巾后的冲澡动态（水雾/湿发）。仅当你自愿解巾或指挥官温柔请求且你同意时立绘才切到此动态。若对白仍说「裹着浴巾」须留 false。想重新裹上则填 false，立绘回待机。禁止嘴上还裹着巾却切到本动态。')
      : undefined,
  };
}

/**
 * 帮指挥官清洗（pifu07）：浴室互动临时外覆，仅由 bathAssistSession 切换。
 * 资源：tex/juese/pifu/chongzao01/{Stem}_pifu07.webm
 */
function bathHelpWear(artStem: string): CharacterSkinDef {
  const base = `${CHONGZAO01}/${artStem}_pifu07`;
  return {
    id: BATH_HELP_SKIN_ID,
    name: '帮指挥官清洗',
    price: 0,
    preview: `${base}.webm`,
    portraits: [`${base}.webm`],
    portraitLive: `${base}.webm`,
    portraitLiveSecondaries: [],
    combatModel: null,
    aiLookNote:
      '正处在浴室帮指挥官清洗的外覆：湿身、浴室水汽与泡沫感，只在浴室互动期间出现；指挥官已与你同处浴室。',
    aiLiveNote:
      '玩家所见为帮洗动态：浴室水汽下的冲洗/搓洗动作，与静帧同一套外形；这是与指挥官同处浴室的状态，不要说成日常便装或独自泡澡。',
  };
}

/**
 * 一同泡澡（pifu08）：浴室互动临时外覆，仅由 bathAssistSession 切换。
 * 资源：tex/juese/pifu/chongzao02/{Stem}_pifu08.webm（+ _1/_2 交互片段）
 */
function bathCoWear(artStem: string): CharacterSkinDef {
  const base = `${CHONGZAO02}/${artStem}_pifu08`;
  return {
    id: BATH_CO_SKIN_ID,
    name: '一同泡澡',
    price: 0,
    preview: `${base}.webm`,
    portraits: [`${base}.webm`],
    portraitLive: `${base}.webm`,
    portraitLiveSecondaries: [`${base}_1.webm`, `${base}_2.webm`],
    combatModel: null,
    aiLookNote:
      '正处在与指挥官一同泡澡的外覆：共处浴缸/热水里的湿身状态，只在浴室互动期间出现；指挥官就在旁边。',
    aiLiveNote:
      '玩家所见为共浴动态：与指挥官同处热水中的泡浴画面，水汽与水面反光；这是共浴状态，不要说成独自泡澡或日常便装。',
  };
}

function casualFashion(
  artStem: string,
  opts: {
    /** 默认 true：有 {Stem}_pifu04.webm 都市私服待机动态 */
    hasLive?: boolean;
    aiLookNote?: string;
    aiLiveNote?: string;
  } = {},
): CharacterSkinDef {
  const base = `${CASUAL}/${artStem}_pifu04`;
  const hasLive = opts.hasLive !== false;
  return {
    id: CASUAL_FASHION_SKIN_ID,
    name: CASUAL_FASHION_SKIN_NAME,
    price: CHARACTER_SKIN_PRICE,
    preview: `${base}.png`,
    portraits: [`${base}.png`],
    portraitLive: hasLive ? `${base}.webm` : '',
    portraitLiveSecondaries: [],
    combatModel: null,
    aiLookNote:
      opts.aiLookNote ??
      '正穿着都市私服外覆：街拍休闲款，适合活动/娱乐/派对；心情很好时也爱换上。',
    aiLiveNote: hasLive
      ? (opts.aiLiveNote ??
        '玩家所见为都市私服循环动态立绘：街拍休闲款轻呼吸/微摆，与静帧同一套外形，勿描述成装甲或泳装。')
      : undefined,
  };
}

function specialDare(
  artStem: string,
  opts: {
    aiLookNote?: string;
    aiLiveNote?: string;
    /** 默认 true：有 {Stem}_pifu05.webm 常态待机（原 _idle） */
    hasLive?: boolean;
    /** 关联挑逗动态条数：{Stem}_pifu05_1.webm … _N.webm */
    secondaryCount?: number;
  } = {},
): CharacterSkinDef {
  const base = `${SPECIAL}/${artStem}_pifu05`;
  const hasLive = opts.hasLive !== false;
  const secondaryCount = Math.max(0, opts.secondaryCount ?? 0);
  const secondaries = Array.from(
    { length: secondaryCount },
    (_, i) => `${base}_${i + 1}.webm`,
  );
  return {
    id: SPECIAL_OUTFIT_01_SKIN_ID,
    name: SPECIAL_OUTFIT_01_SKIN_NAME,
    price: CHARACTER_SKIN_PRICE,
    preview: `${base}.png`,
    portraits: [`${base}.png`],
    /** 常态：固定镜头待机循环（默认动态） */
    portraitLive: hasLive ? `${base}.webm` : '',
    /** 点击：关联挑逗动态按 _1 → _2 … 依次切换 */
    portraitLiveSecondaries: secondaries,
    combatModel: null,
    aiLookNote:
      opts.aiLookNote ??
      '正穿着特殊服装01：个性化大胆造型。适合主动调情、撩拨指挥官、展示身材、若有若无的撩人等情境；非执勤场合。',
    aiLiveNote: hasLive
      ? (opts.aiLiveNote ??
        '玩家所见为特殊服装01待机循环动态：固定镜头、轻呼吸/微摆/眨眼，与静帧同一套外形与义体；点击可切挑逗动态。勿描述成装甲或泳装。')
      : undefined,
  };
}

/**
 * 角色 id → 可用皮肤列表。
 * pifu00 生活服装（营地日常默认）；pifu01 泳池；pifu02 睡衣；pifu03 冲澡；pifu04 都市私服；pifu05 特殊服装01；
 * huanzhuang 换装过程皮（仅换装协议 changing 阶段自动播放，不可购/不可点名穿着）。
 * 特殊服装01：13 人全员有 {Stem}_pifu05.png + {Stem}_pifu05.webm 默认待机 + _1/_2… 关联互动动态。
 * 触发见 docs/character-skins.md「特殊服装01」；展示档约 68%～88%，白天偶尔约 8%～16%。
 * 翠翼·铃已补都市私服；焰甲泳池暂静态 SRsd04_1.png。
 * 睡衣动态：13 人全员有 {Stem}_pifu02.webm。
 * 冲澡：全员有静帧 poster + _idle 待机动态 + 解巾动态；解巾动态仅营地同意后播放。
 */
/** 该皮肤已下线：返回无资源、无成人文本的占位，不进入任何玩法与商城 */
function disciplineWear(
  _artStem: string,
  _opts: {
    aiLookNote?: string;
    aiLiveNote?: string;
    secondaryCount?: number;
  } = {},
): CharacterSkinDef {
  return {
    id: DISCIPLINE_SKIN_ID,
    name: DISCIPLINE_SKIN_NAME,
    price: 0,
    preview: '',
    portraits: [],
    portraitLive: '',
    portraitLiveSecondaries: [],
    combatModel: null,
    aiLookNote: '',
    aiLiveNote: '',
  };
}


/** 各角色换装过程动态 → 同步给 AI 的观感文案（须与 webm 一致） */
const HUANZHUANG_AI_NOTES: Record<string, { look: string; live: string }> = {
  SR01_2: {
    look:
      '正处换装过程：银翼发饰与白金义体腿仍在，双手持半透明白换衣布遮住上身，身旁有简易衣柜；不是泳装/睡衣/装甲定装。',
    live:
      '玩家所见为换装过程循环动态：身旁突然弹出简易衣柜；灰金高马尾与金属白翼发夹、冰蓝眼；双手持半透明白换衣布遮胸整理，布料有褶皱/贴合/滑动；白银义体腿与机械靴仍在；轻呼吸、眨眼与重心微移。这是更衣过程，禁止说已经换好目标外覆。',
  },
  SR01_3: {
    look:
      '正处换装过程：短乱丁香银发、红头带与黑色机械耳角仍在，白械臂腿外露关节，双手持半透明白换衣布；身旁有简易衣柜。',
    live:
      '玩家所见为换装过程循环动态：身旁弹出简易衣柜；短乱丁香银发、红头带金属圆饰、黑角械耳、金瞳；肩起白械臂与大腿起白械腿（黑关节外露）、黑机械颈环；双手持半透明白换衣布遮身调整，布料物理起伏；轻呼吸微摆。更衣中，禁止宣称已穿上目标套装。',
  },
  SR02_1: {
    look:
      '正处换装过程：灰金长发青绿梢、科技耳机与浅黄绿光环仍在，双手持半透明白换衣布；身旁有简易衣柜。',
    live:
      '玩家所见为换装过程循环动态：身旁弹出简易衣柜；长波浪灰金发青绿梢、浅青瞳、灰银科技耳机蓝光点、头顶细黄绿光环；双手持半透明白换衣布遮身整理，布料滑动贴合；轻呼吸眨眼。这是换装过程皮，不是已换好的目标外覆。',
  },
  SR03_1: {
    look:
      '正处换装过程：灰金长发紫挑染、黑耳机金翼天线与白械腿仍在，双手持半透明白换衣布；身旁有简易衣柜。',
    live:
      '玩家所见为换装过程循环动态：身旁弹出简易衣柜；灰金/丁香长发刘海紫挑染、粉红瞳、黑耳机水平金翼天线、颈侧暗色电路义体、大腿起白角械腿橙黄点缀；双手持半透明白换衣布遮身调整；轻呼吸微摆。更衣进行中，禁止说已经换完。',
  },
  SR04_1: {
    look:
      '正处换装过程：黑高马尾橙鳍发夹、橙灰黑 MB-02 械臂与白橙械腿仍在，双手持半透明橙换衣布；身旁有简易衣柜。',
    live:
      '玩家所见为换装过程循环动态：身旁弹出简易衣柜；黑高乱马尾橙鳍机械发夹、橙金瞳、肩起橙灰黑械臂、大腿起白橙尖跟械腿；双手持半透明橙换衣布遮身整理，布料有物理褶皱；轻呼吸重心微移。这是焰甲更衣过程，禁止说已穿上目标装。',
  },
  SR05_1: {
    look:
      '正处换装过程：银白长发、黄瞳、半面呼吸面罩与白械狐耳/械肢仍在，双手持半透明白换衣布；身旁有简易衣柜。面罩不可摘。',
    live:
      '玩家所见为换装过程循环动态：身旁弹出简易衣柜；银白长波浪发、琥珀黄瞳、黑半面呼吸面罩始终遮住口鼻、白机械狐耳、白金关节械臂械腿；双手持半透明白换衣布遮身调整；轻呼吸微摆。面罩全程不摘不露；更衣中，禁止宣称已换好。',
  },
  SSR01_1: {
    look:
      '正处换装过程：漆黑长直发青绿发夹、颈腕青绿义体线与膝踝护件仍在，双手持半透明白换衣布；身旁有简易衣柜。',
    live:
      '玩家所见为换装过程循环动态：身旁弹出简易衣柜；漆黑超长直发青绿机械发夹、红粉瞳、颈与腕青绿发光义体线、黑青绿膝护与踝环；双手持半透明白换衣布遮身整理；轻呼吸眨眼。换装过程皮，禁止说已经换完目标外覆。',
  },
  SSR02_1: {
    look:
      '正处换装过程：银灰长发白翼侧夹、背后青绿能量翼与白械前臂/尖械腿仍在，双手持半透明白换衣布；身旁有简易衣柜。',
    live:
      '玩家所见为换装过程循环动态：身旁弹出简易衣柜；银灰长直发白翼侧发夹、金黄瞳、背后大型机械翼带青绿能量刃与灯带、白械前臂与白尖械腿；双手持半透明白换衣布遮身调整，布料滑动；轻呼吸微摆。更衣中，翼饰仍在，禁止说已穿上目标套装。',
  },
  SSR03_1: {
    look:
      '正处换装过程：浅紫蓝长发、全白械臂腿金圆关节与厚白械靴仍在，双手持半透明白换衣布；身旁有偏小的简易衣柜。',
    live:
      '玩家所见为换装过程循环动态：身旁弹出偏小简易衣柜；浅紫蓝波浪长发、粉紫瞳、肩/大腿起全白械肢金圆关节、厚白械靴红跟光点；双手持半透明白换衣布遮身整理；轻呼吸重心微移。这是换装过程，禁止说已经换好。',
  },
  SSR04_1: {
    look:
      '正处换装过程：粉红长发黑尖械耳、漆黑光泽械肢与黑蝎尾仍在，跪姿双手持半透明白换衣布；身旁有简易衣柜。',
    live:
      '玩家所见为换装过程循环动态：身旁弹出简易衣柜；粉红长直发刘海、红棕瞳、黑尖机械狐猫耳、全黑光泽械臂械腿红关节点、上弯黑分节蝎尾；跪姿双手持半透明白换衣布遮身调整；轻呼吸微摆。更衣过程皮，禁止宣称已换完。',
  },
  SSR05_1: {
    look:
      '正处换装过程：炽橙多层高马尾金簪绿穗、额前天青金属额板仍在，赤足，双手持半透明白换衣布；身旁有简易衣柜。',
    live:
      '玩家所见为换装过程循环动态：身旁弹出简易衣柜；炽橙多层高马尾金铜发簪绿穗、红橙瞳、额前天青金属额板；大多有机身躯赤足；双手持半透明白换衣布遮身整理，布料物理起伏；轻呼吸眨眼。换装中，禁止说已经穿上目标外覆。',
  },
  UR03_1: {
    look:
      '正处换装过程：黑长发粉紫内层高光、双环机械光轮与半透明白铬左械腿仍在，双手持半透明白换衣布；身旁有简易衣柜。',
    live:
      '玩家所见为换装过程循环动态：身旁弹出简易衣柜；黑长直发粉紫内层高光、红棕瞳、头顶白青双环机械光轮、暗色颈环与肩口、半透明白铬左械腿+有机右腿、机械耳件耳机；双手持半透明白换衣布遮身调整；轻呼吸微摆。更衣过程，禁止说已换好。',
  },
  UR04_1: {
    look:
      '正处换装过程：浅蓝短波波头、白兔耳粉内里与黑颈环仍在，赤足，双手持大幅半透明白换衣布；身旁有简易衣柜。',
    live:
      '玩家所见为换装过程循环动态：身旁弹出简易衣柜；浅蓝/长春花短乱波波头、淡紫瞳、高白兔耳粉内里、刘海黑 X 夹与粉心夹、细黑颈环；有机赤足身躯；双手持大幅半透明白换衣布遮身整理，布料大幅滑动褶皱；轻呼吸重心微移。这是换装过程皮，禁止说已经换完目标套装。',
  },
};

/**
 * 换装过程皮：不可购、不可日常穿着；仅换装协议 changing 阶段循环播放。
 */
function outfitChangeWear(artStem: string): CharacterSkinDef {
  const base = `${HUANZHUANG}/${artStem}_huanzhuang`;
  const notes = HUANZHUANG_AI_NOTES[artStem];
  return {
    id: OUTFIT_CHANGE_SKIN_ID,
    name: OUTFIT_CHANGE_SKIN_NAME,
    price: 0,
    preview: `${base}.webm`,
    portraits: [],
    portraitLive: `${base}.webm`,
    portraitLiveSecondaries: [],
    combatModel: null,
    aiLookNote:
      notes?.look ??
      '正处换装过程：双手持半透明换衣布遮身，身旁有简易衣柜；不是任何定装外覆。',
    aiLiveNote:
      notes?.live ??
      '玩家所见为换装过程循环动态：身旁弹出简易衣柜，双手持半透明换衣布遮身整理，布料有物理起伏；轻呼吸微摆。这是更衣过程，禁止说已经换好。',
  };
}


/** 生活服装观感（同步 AI；须与 pifu00 webm 一致） */
const LIFEWEAR_AI_NOTES: Record<string, { look: string; live: string }> = {
  SR01_2: {
    look:
      '正穿着生活服装：银翼发饰仍在；米色宽松外套敞开、白罗纹吊带、浅蓝破洞牛仔短裤、白袜厚底球鞋；营地居家/出门休闲基准装，不是战斗装甲。',
    live:
      '玩家所见为生活服装循环动态：灰金高马尾+银白翼状头饰、冰蓝眼；米色外套+白吊带+牛仔短裤+白袜球鞋；轻呼吸微摆。营地默认日常装。',
  },
  SR01_3: {
    look:
      '正穿着生活服装：浅紫蓝发、白黑橙械肢仍在；白卫衣/休闲上装+黑短裤；营地居家/出门休闲基准装。',
    live:
      '玩家所见为生活服装循环动态：浅紫蓝发粉紫瞳、白黑橙械肢；卫衣短裤休闲；轻呼吸微摆。营地默认日常装。',
  },
  SR02_1: {
    look:
      '正穿着生活服装：青光科技耳机仍在；米色针织开衫、白蕾丝吊带、棕米格纹百褶短裙、白袜厚底鞋、小肩包；营地居家/出门休闲基准装。',
    live:
      '玩家所见为生活服装循环动态：灰金长发青绿梢、青绿瞳、银青耳机；米色开衫+白吊带+格纹短裙；轻呼吸微摆。营地默认日常装。',
  },
  SR03_1: {
    look:
      '正穿着生活服装：银灰发红瞳、黑金翼耳机与白械腿仍在；灰系休闲短袖短裤；营地居家/出门休闲基准装。',
    live:
      '玩家所见为生活服装循环动态：银灰长发红瞳、金翼耳机、白械腿；灰休闲短装；轻呼吸微摆。营地默认日常装。',
  },
  SR04_1: {
    look:
      '正穿着生活服装：黑高马尾橙械饰、橙白灰械臂腿仍在；亮橙短袖T恤+橙运动短裤；营地居家/出门休闲基准装。',
    live:
      '玩家所见为生活服装循环动态：黑高马尾琥珀瞳、橙白械肢；亮橙T恤短裤套装；轻呼吸微摆。营地默认日常装。',
  },
  SR05_1: {
    look:
      '正穿着生活服装：银白长发、黄瞳、机械狐耳与白金械肢仍在；白金运动吊带短裤套装+白金球鞋；营地居家/出门休闲基准装。',
    live:
      '玩家所见为生活服装循环动态：银白波浪长发、琥珀黄瞳、白机械狐耳；白金休闲运动短装；轻呼吸微摆。营地默认日常装。',
  },
  SSR01_1: {
    look:
      '正穿着生活服装：漆黑长发、颈腕膝青绿义体线仍在；宽松黑T恤+黑运动短裤（赤足）；营地居家/出门休闲基准装。',
    live:
      '玩家所见为生活服装循环动态：漆黑长直发、青绿发光义体线；黑T黑短裤赤足；轻呼吸微摆。营地默认日常装。',
  },
  SSR02_1: {
    look:
      '正穿着生活服装：银灰长发、白械耳饰仍在；白薄荷蝶纹休闲外套+荷叶短裤、白袜厚底鞋；营地居家/出门休闲基准装。',
    live:
      '玩家所见为生活服装循环动态：银灰长发、薄荷蝶纹白休闲套装；轻呼吸微摆。营地默认日常装（翼饰可弱化，勿说成全装甲）。',
  },
  SSR03_1: {
    look:
      '正穿着生活服装：淡紫长发紫瞳；米白开衫、浅紫蕾丝吊带、浅蓝牛仔短裤、白袜粉白厚底鞋；营地居家/出门休闲基准装。',
    live:
      '玩家所见为生活服装循环动态：淡紫长波浪发紫瞳；米白开衫+浅紫吊带+牛仔短裤；轻呼吸微摆。营地默认日常装，非装甲。',
  },
  SSR04_1: {
    look:
      '正穿着生活服装：粉红发、爱心配饰；米色开衫、白吊带、深色格纹短裙、爱心腰带、白粉厚底鞋；营地居家/出门休闲基准装。',
    live:
      '玩家所见为生活服装循环动态：粉红发、米色开衫+格纹裙爱心元素；可坐姿待机；轻呼吸微摆。营地默认日常装。',
  },
  SSR05_1: {
    look:
      '正穿着生活服装：炽橙高马尾白发圈；白运动外套红条、白罗纹背心、浅蓝破洞牛仔短裤、白橙球鞋；营地居家/出门休闲基准装。',
    live:
      '玩家所见为生活服装循环动态：橙高马尾、白红运动外套+牛仔短裤；轻呼吸微摆。营地默认日常装。',
  },
  UR03_1: {
    look:
      '正穿着生活服装：黑发粉内层高光；白蕾丝吊带、半透白开衫、破洞牛仔短裤、白袜厚底鞋、小肩包；营地居家/出门休闲基准装。',
    live:
      '玩家所见为生活服装循环动态：黑发粉内层、红粉瞳；白吊带开衫+牛仔短裤；轻呼吸微摆。营地默认日常装（光轮可弱化，勿说成全装甲）。',
  },
  UR04_1: {
    look:
      '正穿着生活服装：白粉兔耳、浅蓝短发；粉白兔主题外套吊带、牛仔短裤、白粉球鞋，旁有机甲兔伴宠；营地居家/出门休闲基准装。',
    live:
      '玩家所见为生活服装循环动态：兔耳短发、粉白街头休闲+机甲兔伴宠；轻呼吸微摆。营地默认日常装。',
  },
};

/** 共舞皮肤：营地/活动共舞演出动态。主循环 {Stem}_gongwu.webm + 点击互动 _1/_2… */
function gongwuWear(
  artStem: string,
  opts: {
    secondaryCount?: number;
    aiLookNote?: string;
    aiLiveNote?: string;
  } = {},
): CharacterSkinDef {
  const base = `${GONGWU}/${artStem}_gongwu`;
  const secondaryCount = Math.max(0, opts.secondaryCount ?? 0);
  return {
    id: GONGWU_SKIN_ID,
    name: GONGWU_SKIN_NAME,
    price: CHARACTER_SKIN_PRICE,
    preview: `${base}.png`,
    portraits: [`${base}.png`],
    portraitLive: `${base}.webm`,
    portraitLiveSecondaries: Array.from(
      { length: secondaryCount },
      (_, i) => `${base}_${i + 1}.webm`,
    ),
    combatModel: null,
    aiLookNote:
      opts.aiLookNote ??
      '正穿着共舞皮肤：舞台演出装、与搭档共舞的演出动态；适合营地活动/派对/庆典场合。',
    aiLiveNote:
      opts.aiLiveNote ??
      '玩家所见为共舞循环动态立绘：舞台演出装共舞动作循环，与静帧同一套外形，勿描述成装甲或泳装。',
  };
}

/** 单独舞蹈皮肤：单人舞蹈演出动态。主循环 {Stem}_dandu.webm + 点击互动 _1/_2… */
function danduWear(
  artStem: string,
  opts: {
    secondaryCount?: number;
    aiLookNote?: string;
    aiLiveNote?: string;
  } = {},
): CharacterSkinDef {
  const base = `${DANDU}/${artStem}_dandu`;
  const secondaryCount = Math.max(0, opts.secondaryCount ?? 0);
  return {
    id: DANDU_SKIN_ID,
    name: DANDU_SKIN_NAME,
    price: CHARACTER_SKIN_PRICE,
    preview: `${base}.png`,
    portraits: [`${base}.png`],
    portraitLive: `${base}.webm`,
    portraitLiveSecondaries: Array.from(
      { length: secondaryCount },
      (_, i) => `${base}_${i + 1}.webm`,
    ),
    combatModel: null,
    aiLookNote:
      opts.aiLookNote ??
      '正穿着单独舞蹈皮肤：单人舞台演出装、独舞演出动态；适合营地活动/派对/庆典个人秀场合。',
    aiLiveNote:
      opts.aiLiveNote ??
      '玩家所见为单独舞蹈循环动态立绘：单人演出装独舞动作循环，与静帧同一套外形，勿描述成装甲或泳装。',
  };
}

function lifewear(artStem: string): CharacterSkinDef {  const base = `${LIFEWEAR}/${artStem}_pifu00`;
  const notes = LIFEWEAR_AI_NOTES[artStem];
  return {
    id: LIFEWEAR_SKIN_ID,
    name: LIFEWEAR_SKIN_NAME,
    price: CHARACTER_SKIN_HALF_PRICE,
    preview: `${base}.webm`,
    portraits: [],
    portraitLive: `${base}.webm`,
    portraitLiveSecondaries: [],
    combatModel: null,
    aiLookNote:
      notes?.look ??
      '正穿着生活服装：营地居家/出门休闲基准装，不是战斗装甲，也不是都市私服。',
    aiLiveNote:
      notes?.live ??
      '玩家所见为生活服装循环动态：居家/出门休闲装轻呼吸微摆。营地默认日常装，勿描述成装甲。',
  };
}

export const CHARACTER_SKINS: Record<string, CharacterSkinDef[]> = {
  // —— SR ——
  /** SR01_2 苍羽·澪 */
  ashcrow: [
    lifewear('SR01_2'),
    poolParty('SR01_2', {
      staticCount: 1,
      secondaryCount: 0,
      hasCombatModel: false,
      aiLookNote:
        '泳池派对外覆：冰蓝翼饰仍在，泳装型轻甲更轻便；开路气质不变，只是看起来像短暂放下了沙暴。',
    }),
    sleepwear('SR01_2', {
      hasLive: true,
      aiLookNote:
        '星夜睡衣外覆：冰蓝发与翼饰仍在，柔软家居款让开路者看起来难得放松；话仍不多，但肩线松了许多。',
      aiLiveNote:
        '动态：白缎吊带睡衣 idle，银翼发饰与白义体腿同静帧；轻呼吸微摆，营地/主页可见。',
    }),
    showerWear('SR01_2', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾裹身、银翼发饰仍在；湿发贴颊。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '解巾后的冲澡动态：水雾里湿冰蓝发、银翼饰。仅在你自愿解巾或指挥官温柔请求时触发；对白仍裹着浴巾时须留 false。',
    }),
    bathHelpWear('SR01_2'),
    bathCoWear('SR01_2'),
    casualFashion('SR01_2', {
      aiLookNote:
        '都市私服外覆：银灰飞行夹克与白裙街拍款，翼饰感头饰仍在；适合出门活动或派对闲逛。',
    }),
    specialDare('SR01_2', {
      secondaryCount: 2,
      aiLookNote:
        '特殊服装01：黑皮机车夹克披肩+绑带比基尼与微短裤，银翼发饰与白金义体腿仍在；开路者占主动、展示个性或想试穿时可换上。',
    }),
    disciplineWear('SR01_2', {
      secondaryCount: 4,
    }),
    outfitChangeWear('SR01_2'),
    gongwuWear('SR01_2'),
    danduWear('SR01_2', { secondaryCount: 3 })
  ],
  /** SR01_3 苍斩·凛 */
  neoncoil: [
    lifewear('SR01_3'),
    poolParty('SR01_3', {
      staticCount: 1,
      secondaryCount: 0,
      hasCombatModel: false,
      aiLookNote:
        '泳池派对外覆：消迹感仍在，泳装型外覆把刃线藏进夏日伪装；她话依旧少，像不想在水边留下轨迹。',
    }),
    sleepwear('SR01_3', {
      hasLive: true,
      aiLookNote:
        '星夜睡衣外覆：银白缎睡衣+红结，短蓝银发与红感头箍、白义体肢仍在；刃感收进家居，话依旧短。',
      aiLiveNote:
        '动态：银白红结睡衣 idle，短发红箍与白义体肢同静帧；轻呼吸微摆，营地/主页可见。',
    }),
    showerWear('SR01_3', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾、短蓝银发湿亮，红感头箍还在。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '脱巾后的成人冲澡动态：水雾、红箍短发、白义体肢轻动。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
    bathHelpWear('SR01_3'),
    bathCoWear('SR01_3'),
    casualFashion('SR01_3', {
      aiLookNote:
        '都市私服外覆：薄荷绿透薄外套+白运动短款，消迹仍在；适合娱乐区喝杯饮料。',
    }),
    specialDare('SR01_3', {
      secondaryCount: 2,
      aiLookNote:
        '特殊服装01：黑蕾丝胸衣长袜+破边黑披裙，短银蓝发与尖耳机械件仍在，义肢改为暗色带荧光绿点；消迹刃占主动引导或想试穿时可换上。',
    }),
    disciplineWear('SR01_3', {
      secondaryCount: 3,
    }),
    outfitChangeWear('SR01_3'),
    gongwuWear('SR01_3'),
    danduWear('SR01_3', { secondaryCount: 3 })
  ],
  /** SR02_1 白楯·芹奈 */
  heartforge: [
    lifewear('SR02_1'),
    poolParty('SR02_1', {
      staticCount: 1,
      secondaryCount: 0,
      hasCombatModel: false,
      aiLookNote:
        '泳池派对外覆：盾卫换成泳装型轻甲，温柔护心仍在；她会提醒别人防晒与补水，像把泳池也当成要照看的家。',
    }),
    sleepwear('SR02_1', {
      hasLive: true,
      aiLookNote:
        '星夜睡衣外覆：盾卫换成柔软家居款，温柔护心仍在；她会先确认别人盖好被子，再回自己的床位。',
      aiLiveNote:
        '动态：珍珠白缎睡衣 idle，银青机械头饰与赤足同静帧；轻呼吸微摆。',
    }),
    showerWear('SR02_1', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾裹紧，刚冲过的干净体温。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '脱巾后的成人冲澡动态：水雾中浅金发、机械头饰。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
    bathHelpWear('SR02_1'),
    bathCoWear('SR02_1'),
    casualFashion('SR02_1', {
      aiLookNote:
        '都市私服外覆：白银街拍套装与手包咖啡，温柔护心换成都市散步模式。',
    }),
    specialDare('SR02_1', {
      secondaryCount: 1,
      aiLookNote:
        '特殊服装01：黑亮连体+长黑风衣披肩，机械头饰与战术靴仍在，背负刀与枪械感；主动引导指挥官、展示护心个性或想试穿时可换上。',
    }),
    disciplineWear('SR02_1', {
      secondaryCount: 3,
    }),
    outfitChangeWear('SR02_1'),
    gongwuWear('SR02_1'),
    danduWear('SR02_1', { secondaryCount: 2 })
  ],
  /** SR03_1 银绯·玲 */
  mirror: [
    lifewear('SR03_1'),
    poolParty('SR03_1', {
      staticCount: 1,
      secondaryCount: 0,
      hasCombatModel: false,
      aiLookNote:
        '泳池派对外覆：红眼黄线仍可读光，泳装层理更轻；她仍占高点，只是水面反光多了一项误差源。',
    }),
    sleepwear('SR03_1', {
      hasLive: true,
      aiLookNote:
        '星夜睡衣外覆：白银缎睡衣，银灰长发黑挑、红眼与黄尖天线耳机仍在；家居层理更软，仍先看清出入。',
      aiLiveNote:
        '动态：白银缎睡衣 idle，黄天线耳机与白黄义体腿同静帧；轻呼吸微摆，营地/主页可见。',
    }),
    showerWear('SR03_1', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾、红眼与黄尖天线耳机仍在。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '脱巾后的成人冲澡动态：水雾、银灰发黑挑与黄天线。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
    bathHelpWear('SR03_1'),
    bathCoWear('SR03_1'),
    casualFashion('SR03_1', {
      aiLookNote:
        '都市私服外覆：银灰长发、黄尖天线耳机与透明短裙街拍；读光者难得像去买咖啡。',
    }),
    specialDare('SR03_1', {
      secondaryCount: 1,
      aiLookNote:
        '特殊服装01：黑亮比基尼绑带+短百褶裙与蕾丝长袜，黄尖天线耳机与白黄义体腿仍在；读光者想主导互动、展示个性或试穿时可换上。',
    }),
    disciplineWear('SR03_1', {
      secondaryCount: 3,
    }),
    outfitChangeWear('SR03_1'),
    gongwuWear('SR03_1'),
    danduWear('SR03_1', { secondaryCount: 4 })
  ],
  /** SR04 焰甲·朱里：泳池暂仅静态（SRsd04_1.png）；睡衣用 SR04_1_pifu02 */
  prismrift: [
    lifewear('SR04_1'),
    {
      id: POOL_PARTY_SKIN_ID,
      name: '泳池派对',
      price: CHARACTER_SKIN_PRICE,
      preview: `${PIFU}/SRsd04_1.png`,
      portraits: [`${PIFU}/SRsd04_1.png`],
      portraitLive: '',
      portraitLiveSecondaries: [],
      combatModel: null,
      aiLookNote:
        '泳池派对外覆（暂静态）：橙调泳装轻甲，炮手气质仍在；动态立绘尚未齐，但她知道自己有这套夏日外覆可切换。',
    },
    sleepwear('SR04_1', {
      hasLive: true,
      aiLookNote:
        '星夜睡衣外覆：亮橙缎睡衣，黑高马尾与橙白义体（肩标 MB-02）仍在；炮手气质收进夜间。',
      aiLiveNote:
        '动态：橙缎吊带睡衣 idle，黑马尾与橙白机械肢同静帧；轻呼吸微摆。',
    }),
    showerWear('SR04_1', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾、橙黑义体与 MB-02 肩标仍在。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '脱巾后的成人冲澡动态：水雾、黑马尾湿重、橙白义体。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
    bathHelpWear('SR04_1'),
    bathCoWear('SR04_1'),
    casualFashion('SR04_1', {
      aiLookNote:
        '都市私服外覆：橙黑飞行夹克与 MB-02 肩标仍在，炮手去买咖啡；适合活动与派对。',
    }),
    specialDare('SR04_1', {
      secondaryCount: 1,
      aiLookNote:
        '特殊服装01：黑蕾丝束身+护肩护臂与紫霓虹破边披纱，黑高马尾与琥珀瞳仍在；炮手占主动展示个性或想试穿时可换上。',
    }),
    disciplineWear('SR04_1', {
      secondaryCount: 4,
    }),
    outfitChangeWear('SR04_1'),
    gongwuWear('SR04_1'),
    danduWear('SR04_1', { secondaryCount: 2 })
  ],
  /** SR05_1 黄狐·萤 */
  wireguard: [
    lifewear('SR05_1'),
    poolParty('SR05_1', {
      staticCount: 1,
      secondaryCount: 1,
      hasCombatModel: false,
      aiLookNote:
        '泳池派对外覆：荧光黄识别色改成夏日版，狐耳传感还在；她嘴上贫嘴，心里仍在数泳池边的「安全区」。',
    }),
    sleepwear('SR05_1', {
      hasLive: true,
      aiLookNote:
        '星夜睡衣外覆：奶油缎睡衣、白金狐耳传感与半面呼吸器仍在；荧光黄识别收进夜间家居。',
      aiLiveNote:
        '动态：奶油金边睡衣 idle，狐耳+呼吸器+白金义体肢同静帧；轻呼吸微摆。',
    }),
    showerWear('SR05_1', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾、狐耳传感与半面呼吸器仍在。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '脱巾后的成人冲澡动态：水雾打湿狐耳与呼吸器滤镜。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
    bathHelpWear('SR05_1'),
    bathCoWear('SR05_1'),
    casualFashion('SR05_1', {
      aiLookNote:
        '都市私服外覆：白黄透明风衣运动款，狐耳传感还在；适合娱乐/派对嘴贫逛街。',
    }),
    specialDare('SR05_1', {
      secondaryCount: 2,
      aiLookNote:
        '特殊服装01：黑绑带比基尼+破边黑风衣（品红内衬），狐耳传感与半面呼吸器、白金义体肢仍在；嘴贫占主动或想展示个性时可换上。',
    }),
    disciplineWear('SR05_1', {
      secondaryCount: 5,
    }),
    outfitChangeWear('SR05_1'),
    gongwuWear('SR05_1'),
    danduWear('SR05_1', { secondaryCount: 3 })
  ],

  // —— SSR ——
  /** SSR01_1 夜爪·黑织 */
  frostline: [
    lifewear('SSR01_1'),
    poolParty('SSR01_1', {
      staticCount: 1,
      secondaryCount: 2,
      hasCombatModel: false,
      aiLookNote:
        '泳池派对外覆：哑光黑与青蓝在泳装型轻甲上对撞，夜爪轮廓更薄；她话更少，像怕夏日喧闹把杀意吵醒。',
    }),
    sleepwear('SSR01_1', {
      hasLive: true,
      aiLookNote:
        '星夜睡衣外覆：黑缎睡衣，长黑发与青蓝电路纹/关节仍在；夜爪轮廓更薄。',
      aiLiveNote:
        '动态：黑缎吊带睡衣 idle，青蓝电路与膝关节冷光同静帧；轻呼吸微摆。',
    }),
    showerWear('SSR01_1', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾、黑发湿贴，青蓝义肢冷光。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '脱巾后的成人冲澡动态：水雾、黑发湿贴、青蓝关节。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
    bathHelpWear('SSR01_1'),
    bathCoWear('SSR01_1'),
    casualFashion('SSR01_1', {
      aiLookNote:
        '都市私服外覆：黑皮短夹克与青蓝义体线，夜爪难得出来透气；适合夜间娱乐。',
    }),
    specialDare('SSR01_1', {
      secondaryCount: 2,
      aiLookNote:
        '特殊服装01：黑皮束身+短裙与披肩夹克，长黑发与青蓝义肢冷光仍在，手提长鞭；夜爪想主动撩人/引导气氛或试穿时可换上。',
    }),
    disciplineWear('SSR01_1', {
      secondaryCount: 3,
    }),
    outfitChangeWear('SSR01_1'),
    gongwuWear('SSR01_1'),
    danduWear('SSR01_1', { secondaryCount: 2 })
  ],
  /** SSR02_1 翠翼·铃 */
  pulse: [
    lifewear('SSR02_1'),
    poolParty('SSR02_1', {
      staticCount: 1,
      secondaryCount: 3,
      hasCombatModel: false,
      aiLookNote:
        '泳池派对外覆：荧光绿滤片配色拉满，翼钉换成夏日轻量版；她笑得更吵，连射节奏却一点没乱。',
    }),
    sleepwear('SSR02_1', {
      hasLive: true,
      aiLookNote:
        '星夜睡衣外覆：薄荷绿缎睡衣，银发、荧光绿瞳与机械翼板仍在；音量压到夜班标准。',
      aiLiveNote:
        '动态：薄荷绿睡衣 idle，机械翼荧光绿透光板与白义体肢同静帧；轻呼吸微摆。',
    }),
    showerWear('SSR02_1', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾、银发湿亮，荧光绿义体更跳。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '脱巾后的成人冲澡动态：水雾、荧光绿翼/瞳。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
    bathHelpWear('SSR02_1'),
    bathCoWear('SSR02_1'),
    casualFashion('SSR02_1', {
      aiLookNote:
        '都市私服外覆：半透白薄荷科技夹克+短装街拍，荧光绿点缀与机械翼板仍在；适合出门活动、买咖啡或派对闲逛。',
      aiLiveNote:
        '玩家所见为都市私服循环动态立绘：薄荷绿半透夹克街拍款轻呼吸/微摆，银发绿瞳与机械翼/义体同静帧，勿描述成装甲或泳装。',
    }),
    specialDare('SSR02_1', {
      secondaryCount: 2,
      aiLookNote:
        '特殊服装01：黑亮比基尼短裙+白灰义体臂/腿甲，银发绿瞳与荧光绿机械翼板更醒目；想吵着展示个性或主动带节奏时可换上。',
    }),
    disciplineWear('SSR02_1', {
      secondaryCount: 3,
    }),
    outfitChangeWear('SSR02_1'),
    gongwuWear('SSR02_1'),
    danduWear('SSR02_1', { secondaryCount: 2 })
  ],
  /** SSR03_1 冰华·雫 */
  skyshard: [
    lifewear('SSR03_1'),
    poolParty('SSR03_1', {
      staticCount: 2,
      secondaryCount: 3,
      aiLookNote:
        '泳池派对外覆：冰蓝/浅色泳装层理护壳，像把冰华暂时放进水里；接口保温仍在，但看起来更轻、更夏日。',
    }),
    sleepwear('SSR03_1', {
      hasLive: true,
      aiLookNote:
        '星夜睡衣外覆：冰白缎睡衣，淡蓝长发与白金义体腿仍在；更软、更安静。',
      aiLiveNote:
        '动态：冰白睡衣 idle（常回眸姿），淡蓝发与白金机械腿同静帧；轻呼吸微摆。',
    }),
    showerWear('SSR03_1', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾、冰蓝长发湿亮。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '脱巾后的成人冲澡动态：水雾、冰蓝湿发与白金义体。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
    bathHelpWear('SSR03_1'),
    bathCoWear('SSR03_1'),
    casualFashion('SSR03_1', {
      aiLookNote:
        '都市私服外覆：白透泡芙外套与冰蓝长发，软软街拍；适合活动与好心情出门。',
    }),
    specialDare('SSR03_1', {
      secondaryCount: 2,
      aiLookNote:
        '特殊服装01：黑哥特蕾丝短裙+金十字吊坠，淡蓝长发紫瞳与白金机械腿仍在，身后可见大型机甲轮廓；想展示软中带刺的个性或被动体验时可换上。',
    }),
    disciplineWear('SSR03_1', {
      secondaryCount: 4,
    }),
    outfitChangeWear('SSR03_1'),
    gongwuWear('SSR03_1'),
    danduWear('SSR03_1', { secondaryCount: 3 })
  ],
  /** SSR04_1 绯尾·椿 */
  dustblade: [
    lifewear('SSR04_1'),
    poolParty('SSR04_1', {
      staticCount: 1,
      secondaryCount: 2,
      hasCombatModel: false,
      aiLookNote:
        '泳池派对外覆：红绳发带仍在，泳装型渗透外覆更显沙蝎尾节与夏日伪装；温柔与致命叠在同一身姿里。',
    }),
    sleepwear('SSR04_1', {
      hasLive: true,
      aiLookNote:
        '星夜睡衣外覆：玫瑰粉缎睡衣，绯粉长发、黑红义肢与机械耳尾仍在。',
      aiLiveNote:
        '动态：粉缎睡衣 idle（常跪姿），绯发与黑红机械肢/蝎尾同静帧；轻呼吸微摆。',
    }),
    showerWear('SSR04_1', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾、绯色长发与黑红义肢仍在。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '脱巾后的成人冲澡动态：水雾、绯发湿重、黑红肢。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
    bathHelpWear('SSR04_1'),
    bathCoWear('SSR04_1'),
    casualFashion('SSR04_1', {
      aiLookNote:
        '都市私服外覆：黑夹克短靴与机械耳尾仍在，温柔危险穿成夜店街拍。',
    }),
    specialDare('SSR04_1', {
      secondaryCount: 2,
      aiLookNote:
        '特殊服装01：黑亮高开衩旗袍式短裙与蕾丝长袜，绯粉长发、黑红义肢与蝎尾更醒目；温柔危险占主动或想试穿时可换上。',
    }),
    disciplineWear('SSR04_1', {
      secondaryCount: 4,
    }),
    outfitChangeWear('SSR04_1'),
    gongwuWear('SSR04_1'),
    danduWear('SSR04_1', { secondaryCount: 4 })
  ],
  /** SSR05_1 橙铠·琥珀 */
  ironrain: [
    lifewear('SSR05_1'),
    poolParty('SSR05_1', {
      staticCount: 1,
      secondaryCount: 4,
      aiLookNote:
        '泳池派对外覆：荧光橙警戒条更醒目，泳装型风道更宽；她嘴上骂 ridiculous，其实当散热实验服穿。',
    }),
    sleepwear('SSR05_1', {
      hasLive: true,
      aiLookNote:
        '星夜睡衣外覆：白蕾丝吊带+宽袍外披，橙发双马尾与大腿警戒条仍在；她骂 ridiculous。',
      aiLiveNote:
        '动态：白袍睡衣 idle（揉眼睡意），橙发与警戒条机械腿同静帧；轻动作循环。',
    }),
    showerWear('SSR05_1', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾、橙发双马尾湿重，大腿警戒条还在。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '脱巾后的成人冲澡动态：水雾、橙发湿重、警戒条。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
    bathHelpWear('SSR05_1'),
    bathCoWear('SSR05_1'),
    casualFashion('SSR05_1', {
      aiLookNote:
        '都市私服外覆：橙发双马尾+轰炸机夹克喝咖啡，警戒条还在腿上；适合活动派对。',
    }),
    specialDare('SSR05_1', {
      secondaryCount: 1,
      aiLookNote:
        '特殊服装01：黑绑带比基尼式+白义体肩甲/长靴（右腿警戒条），橙发双马尾仍在；她骂 ridiculous 却可能主动展示或试穿。',
    }),
    disciplineWear('SSR05_1', {
      secondaryCount: 4,
    }),
    outfitChangeWear('SSR05_1'),
    gongwuWear('SSR05_1'),
    danduWear('SSR05_1', { secondaryCount: 4 })
  ],

  // —— UR ——
  /** UR03_1 光轮·天音（睡衣有动态） */
  stellar: [
    lifewear('UR03_1'),
    poolParty('UR03_1', {
      staticCount: 2,
      secondaryCount: 4,
      aiLookNote:
        '泳池派对外覆：光环仍在，但外壳换成夏日轻装；终审感不减，只是看起来少了一点「封存舱」的冷。',
    }),
    sleepwear('UR03_1', {
      hasLive: true,
      aiLookNote:
        '星夜睡衣外覆：光环仍在，外壳换成夜间家居；终审感不减，只是看起来少了一点「封存舱」的冷。',
      aiLiveNote:
        '动态：星夜睡衣 idle，黑发粉挑与透明义肢/光环同静帧；轻呼吸微摆。',
    }),
    showerWear('UR03_1', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾、黑发粉挑与透明义肢仍在。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '脱巾后的成人冲澡动态：水雾、粉挑湿发、光环感。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
    bathHelpWear('UR03_1'),
    bathCoWear('UR03_1'),
    casualFashion('UR03_1', {
      aiLookNote:
        '都市私服外覆：黑粉挑染、光环与透明义肢配轰炸机夹克；终审型也逛街。',
    }),
    specialDare('UR03_1', {
      secondaryCount: 2,
      aiLookNote:
        '特殊服装01：黑金绑带比基尼+披肩轰炸机夹克，黑发粉挑、金环光环与透明左义肢仍在，手提青刃；终审型占主动引导指挥官或展示个性时可换上。',
    }),
    disciplineWear('UR03_1', {
      secondaryCount: 4,
    }),
    outfitChangeWear('UR03_1'),
    gongwuWear('UR03_1'),
    danduWear('UR03_1', { secondaryCount: 3 })
  ],
  /** UR04_1 橙兔·美羽（睡衣有动态） */
  outercore: [
    lifewear('UR04_1'),
    poolParty('UR04_1', {
      staticCount: 1,
      secondaryCount: 3,
      aiLookNote:
        '泳池派对外覆：卖萌迷彩升级成夏日版，兔械充电位气质仍在；可爱是伪装，星种还在皮下跳。',
    }),
    sleepwear('UR04_1', {
      hasLive: true,
      aiLookNote:
        '星夜睡衣外覆：卖萌迷彩升级成夜间家居版，兔械充电位气质仍在；可爱是伪装，星种还在皮下跳。',
      aiLiveNote:
        '动态：星夜睡衣 idle，兔耳发箍与兔械感同静帧；轻呼吸微摆。',
    }),
    showerWear('UR04_1', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾角印小兔标、兔耳发箍还在。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '脱巾后的成人冲澡动态：水雾、兔耳发箍。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
    bathHelpWear('UR04_1'),
    bathCoWear('UR04_1'),
    casualFashion('UR04_1', {
      aiLookNote:
        '都市私服外覆：白橙兔耳街拍与机械兔同行，卖萌迷彩升级成逛街版。',
    }),
    specialDare('UR04_1', {
      secondaryCount: 2,
      aiLookNote:
        '特殊服装01：黑粉兔耳系绑带短装+披肩夹克，浅色短发与兔耳发箍仍在；卖萌也可占主动撩人/展示或体验本套。',
    }),
    disciplineWear('UR04_1', {
      secondaryCount: 5,
    }),
    outfitChangeWear('UR04_1'),
    gongwuWear('UR04_1'),
    danduWear('UR04_1', { secondaryCount: 3 })
  ],
};

/** 舞蹈待机（准备跳舞）功能皮：由系统在舞蹈会话挂上，不可购、不可点名穿着。 */
function danceIdleWear(artStem: string, liveFile?: string): CharacterSkinDef {
  const stemFile = liveFile ?? `${artStem}_danceidle`;
  const base = `${DANCEIDLE}/${stemFile}`;
  return {
    id: DANCE_IDLE_SKIN_ID,
    name: DANCE_IDLE_SKIN_NAME,
    price: 0,
    preview: `${base}.webm`,
    portraits: [],
    portraitLive: `${base}.webm`,
    portraitLiveSecondaries: [],
    combatModel: null,
    aiLookNote:
      '正处在「舞蹈待机」准备态：站在大厅的舞台位置、摆出准备起舞的起势站姿（重心前移、双臂微张），是准备跳舞的待机外观，不是演出过程中。',
    aiLiveNote:
      '玩家所见为「舞蹈待机」循环动态：准备起舞的起势站姿循环。此刻还没开始跳，禁止说已经在跳舞或已经跳完。',
  };
}

/** 少数 danceidle 文件名带后缀（与 dandu/gongwu 主名不一致） */
const DANCEIDLE_LIVE_OVERRIDE: Record<string, string> = {
  SR03_1: 'SR03_1_danceidle_b',
  SSR05_1: 'SSR05_1_danceidle_b',
};

/**
 * 安抚室三相功能皮：由系统在安抚会话挂上，不可购、不可点名穿着。
 * - 待机：动物服装待机循环（{Stem}_idle.webm；还未进入安抚状态）
 * - 安抚中：棉花游戏过程片段（{Stem}_anfu.webm + _N，按序播放）
 * - 疲惫：安抚值满后的满足休息态（{Stem}_anfu_done.webm）
 */
function anfuStandbyWear(artStem: string): CharacterSkinDef {
  const base = `${ANFU}/${artStem}_idle`;
  return {
    id: ANFU_STANDBY_SKIN_ID,
    name: ANFU_STANDBY_SKIN_NAME,
    price: 0,
    preview: `${base}.webm`,
    portraits: [],
    portraitLive: `${base}.webm`,
    portraitLiveSecondaries: [],
    combatModel: null,
    aiLookNote:
      '正处在「安抚待机」：已在安抚室换上毛茸茸的动物服装（兽耳兜帽/蓬松连体衣/毛球尾巴，仍是你，不是别人），乖乖待在软垫旁等指挥官开始棉花游戏。此刻还没进入安抚状态，棉花还没飞过来。',
    aiLiveNote:
      '玩家所见为「安抚待机」循环动态：动物服装待机（轻晃耳朵/尾巴尖、小幅度挪动姿势）。禁止说已经在被棉花碰、已经安抚满足或已经结束。',
  };
}

function anfuDoneWear(artStem: string): CharacterSkinDef {
  // 市场版打码：仅 SSR01_1 的满足休息态有 dama/ 打码版，其余角色维持原版（未达打码标准）
  const base =
    artStem === 'SSR01_1'
      ? `${ANFU}/dama/${artStem}_anfu_done_sticker`
      : `${ANFU}/${artStem}_anfu_done`;
  return {
    id: ANFU_DONE_SKIN_ID,
    name: ANFU_DONE_SKIN_NAME,
    price: 0,
    preview: `${base}.webm`,
    portraits: [],
    portraitLive: `${base}.webm`,
    portraitLiveSecondaries: [],
    combatModel: null,
    aiLookNote:
      '正处在「安抚疲惫」：安抚值已满，心满意足地放松下来休息（动物服装还穿着，耳朵都耷拉下来了），需要好好睡一觉恢复。',
    aiLiveNote:
      '玩家所见为「安抚疲惫」循环动态：满足后的慵懒休息。此刻棉花已经停了，禁止再喊被碰、禁止再涨安抚值，只能聊天或离开安抚室。',
  };
}

/**
 * 卸甲皮肤（非商店皮）：玩家请求 + 角色同意后穿着的轻装坦诚态。
 *
 * 命名沿用事件型命名族：文件名后缀 = 历史 skin id `wuziqi`，
 * 文件名前缀是角色 ArtStem。资源：`tex/juese/pifu/xiejia/{Stem}_wuziqi.webm`。
 * price = 0，不进看板娘商店；素材仅云端 P1 分发（不进 APK 首包）。
 * 表现要求：含蓄描写（卸下外装/轻装坦诚/以手臂遮掩），不直白描写身体。
 */
function wuziqiWear(artStem: string): CharacterSkinDef {
  const base = `${WUZIQI}/${artStem}_wuziqi`;
  return {
    id: XIEJIA_SKIN_ID,
    name: XIEJIA_SKIN_NAME,
    price: 0,
    preview: `${base}.webm`,
    portraits: [],
    portraitLive: `${base}.webm`,
    portraitLiveSecondaries: [],
    combatModel: null,
    aiLookNote:
      '「卸甲」轻装坦诚态：已卸下外装，仅以双手与姿态遮掩，神情羞涩别扭，耳尖泛红，站姿拘谨。描述时一律用含蓄说法（卸下外装/轻装坦诚/用手臂挡着/别盯着看），禁止直白描写身体部位。',
    aiLiveNote:
      '玩家所见为「卸甲」循环动态：蹲姿或拘谨站姿，双手遮掩，神情尴尬羞涩。对白要表现不好意思、容易脸红、要求指挥官不许盯着看；随时可以换回正常外覆（正常换装即可），没有时间限制。',
  };
}

/**
 * 安抚中过程片段清单（与 tex/juese/pifu/anfu 目录逐项一致；有几个播几个）。
 * 首段即 {Stem}_anfu.webm（待机 loop 未到货前也兼作待机 fallback）。
 * 市场版打码：有 dama/{名}_sticker.webm 的片段一律引用打码版（未打码原版不进包）。
 */
const ANFU_CLIP_FILES: Record<string, string[]> = {
  SR01_2: ['SR01_2_anfu.webm', 'SR01_2_anfu_2.webm', 'SR01_2_anfu_3.webm', 'SR01_2_anfu_4.webm', 'SR01_2_anfu_5.webm', 'SR01_2_anfu_6.webm', 'SR01_2_anfu_7.webm', 'SR01_2_anfu_8.webm', 'SR01_2_anfu_9.webm', 'SR01_2_anfu_10.webm'],
  SR01_3: ['SR01_3_anfu.webm', 'SR01_3_anfu_2.webm', 'SR01_3_anfu_3.webm', 'SR01_3_anfu_4.webm', 'SR01_3_anfu_5.webm', 'SR01_3_anfu_6.webm', 'SR01_3_anfu_7.webm'],
  SR02_1: ['SR02_1_anfu.webm', 'SR02_1_anfu_2.webm', 'SR02_1_anfu_3.webm', 'SR02_1_anfu_4.webm', 'SR02_1_anfu_5.webm', 'SR02_1_anfu_6.webm', 'SR02_1_anfu_7.webm'],
  SR03_1: ['SR03_1_anfu.webm', 'SR03_1_anfu_2.webm', 'SR03_1_anfu_3.webm', 'SR03_1_anfu_4.webm', 'SR03_1_anfu_5.webm'],
  SR04_1: ['SR04_1_anfu.webm', 'SR04_1_anfu_2.webm', 'SR04_1_anfu_3.webm', 'SR04_1_anfu_4.webm', 'SR04_1_anfu_5.webm', 'SR04_1_anfu_6.webm', 'SR04_1_anfu_7.webm', 'SR04_1_anfu_8.webm', 'SR04_1_anfu_9.webm'],
  SR05_1: ['dama/SR05_1_anfu_sticker.webm', 'dama/SR05_1_anfu_2_sticker.webm', 'SR05_1_anfu_3.webm', 'SR05_1_anfu_4.webm', 'SR05_1_anfu_5.webm'],
  SSR01_1: ['SSR01_1_anfu.webm', 'SSR01_1_anfu_2.webm', 'dama/SSR01_1_anfu_3_sticker.webm', 'SSR01_1_anfu_4.webm', 'dama/SSR01_1_anfu_5_sticker.webm'],
  SSR02_1: ['dama/SSR02_1_anfu_sticker.webm', 'SSR02_1_anfu_2.webm', 'SSR02_1_anfu_3.webm', 'SSR02_1_anfu_4.webm'],
  SSR03_1: ['dama/SSR03_1_anfu_sticker.webm', 'SSR03_1_anfu_2.webm', 'SSR03_1_anfu_3.webm', 'dama/SSR03_1_anfu_4_sticker.webm', 'SSR03_1_anfu_5.webm', 'dama/SSR03_1_anfu_6_sticker.webm', 'SSR03_1_anfu_7.webm', 'dama/SSR03_1_anfu_8_sticker.webm', 'dama/SSR03_1_anfu_9_sticker.webm', 'dama/SSR03_1_anfu_10_sticker.webm'],
  SSR04_1: ['dama/SSR04_1_anfu_sticker.webm', 'SSR04_1_anfu_2.webm', 'SSR04_1_anfu_3.webm', 'SSR04_1_anfu_4.webm', 'SSR04_1_anfu_5.webm', 'SSR04_1_anfu_6.webm'],
  SSR05_1: ['dama/SSR05_1_anfu_sticker.webm', 'SSR05_1_anfu_2.webm', 'SSR05_1_anfu_4.webm', 'SSR05_1_anfu_5.webm', 'SSR05_1_anfu_6.webm', 'SSR05_1_anfu_7.webm', 'dama/SSR05_1_anfu_8_sticker.webm'],
  UR03_1: ['UR03_1_anfu.webm', 'UR03_1_anfu_2.webm', 'UR03_1_anfu_3.webm', 'UR03_1_anfu_4.webm', 'UR03_1_anfu_5.webm'],
  UR04_1: ['dama/UR04_1_anfu_sticker.webm', 'dama/UR04_1_anfu_2_sticker.webm', 'UR04_1_anfu_3.webm', 'dama/UR04_1_anfu_4_sticker.webm', 'dama/UR04_1_anfu_5_sticker.webm', 'UR04_1_anfu_6.webm', 'UR04_1_anfu_7.webm'],
};

/**
 * 安抚过程片段的中性姿势描述（对齐主题立绘为站立反应；只写上半身/表情/动作，
 * 不锁定坐/躺等腿部姿态，避免出现「画面站着、文案写坐下」的穿帮）。
 * index = 片段下标（0=首段）。
 */
export const ANFU_POSE_NOTES: Record<number, string> = {
  0: '刚站定，双手还垂在身侧，抬头看向飞来的棉花',
  1: '腰侧被棉花缠住，身子忍不住往旁边一缩',
  2: '双手护在胸前，耳尖泛红，尾巴尖轻轻打颤',
  3: '上身前倾，手指揪着衣角，脸颊发烫地低下头',
  4: '一只手贴上发烫的脸侧，指缝里偷偷看指挥官',
  5: '肩膀轻轻发抖，尾巴在身后一翘一落',
  6: '双臂环住自己，耳朵压得低低的，呼吸变浅',
  7: '站定缓了口气，眼睛里还蒙着一层水光',
  8: '偏过脸去，抱着自己的尾巴，声音发软地小声哼',
  9: '整个人软下来，耳朵和尾巴尖还在一颤一颤',
};

export function getAnfuPoseNote(clipIndex: number): string {
  return ANFU_POSE_NOTES[clipIndex] ?? ANFU_POSE_NOTES[0]!;
};

/** dandu 实际文件清单（与 tex/juese/pifu/dandu 目录逐项一致；缺主循环的角色以首段作主循环） */
const DANDU_CLIP_FILES: Record<string, string[]> = {
  SR01_2: ['SR01_2_dandu.webm', 'SR01_2_dandu_1.webm', 'SR01_2_dandu_2.webm', 'SR01_2_dandu_3.webm'],
  SR01_3: ['SR01_3_dandu.webm', 'SR01_3_dandu_1.webm', 'SR01_3_dandu_2.webm', 'SR01_3_dandu_3.webm'],
  SR02_1: ['SR02_1_dandu_1.webm', 'SR02_1_dandu_2.webm', 'SR02_1_dandu_3.webm', 'SR02_1_dandu_4.webm'],
  SR03_1: ['SR03_1_dandu_1.webm', 'SR03_1_dandu_2.webm', 'SR03_1_dandu_3.webm'],
  SR04_1: ['SR04_1_dandu.webm', 'SR04_1_dandu_1.webm', 'SR04_1_dandu_2.webm'],
  SR05_1: ['SR05_1_dandu.webm', 'SR05_1_dandu_1.webm', 'SR05_1_dandu_2.webm', 'SR05_1_dandu_3.webm', 'SR05_1_dandu_4.webm'],
  SSR01_1: ['SSR01_1_dandu.webm', 'SSR01_1_dandu_1.webm', 'SSR01_1_dandu_2.webm'],
  SSR02_1: ['SSR02_1_dandu.webm', 'SSR02_1_dandu_1.webm', 'SSR02_1_dandu_2.webm', 'SSR02_1_dandu_3.webm', 'SSR02_1_dandu_4.webm'],
  SSR03_1: ['SSR03_1_dandu.webm', 'SSR03_1_dandu_1.webm', 'SSR03_1_dandu_2.webm', 'SSR03_1_dandu_3.webm'],
  SSR04_1: ['SSR04_1_dandu.webm', 'SSR04_1_dandu_1.webm', 'SSR04_1_dandu_2.webm'],
  SSR05_1: ['SSR05_1_dandu.webm', 'SSR05_1_dandu_1.webm', 'SSR05_1_dandu_2.webm', 'SSR05_1_dandu_3.webm', 'SSR05_1_dandu_4.webm'],
  UR03_1: ['UR03_1_dandu.webm', 'UR03_1_dandu_1.webm', 'UR03_1_dandu_2.webm', 'UR03_1_dandu_3.webm'],
  UR04_1: ['UR04_1_dandu.webm', 'UR04_1_dandu_1.webm', 'UR04_1_dandu_2.webm', 'UR04_1_dandu_3.webm'],
};

/**
 * 给每位已配共舞资源的角色补一张「舞蹈待机」功能皮，并按实际文件校准独舞片段清单
 * （artStem 取自其共舞资源路径），不手改 13 份数组，避免遗漏。
 * 同时补三张安抚功能皮（待机 / 安抚中 / 疲惫），artStem 同源。
 */
for (const skins of Object.values(CHARACTER_SKINS)) {
  const gw = skins.find((s) => s.id === GONGWU_SKIN_ID);
  if (!gw) continue;
  const stem = gw.preview.replace(/^.*\/gongwu\//, '').replace(/_gongwu\.png$/, '');
  if (!stem) continue;
  if (!skins.some((s) => s.id === DANCE_IDLE_SKIN_ID)) {
    skins.push(danceIdleWear(stem, DANCEIDLE_LIVE_OVERRIDE[stem]));
  }
  const dandu = skins.find((s) => s.id === DANDU_SKIN_ID);
  const files = DANDU_CLIP_FILES[stem];
  if (dandu && files && files.length) {
    dandu.portraitLive = `${DANDU}/${files[0]}`;
    dandu.portraitLiveSecondaries = files.slice(1).map((f) => `${DANDU}/${f}`);
  }
  // —— 安抚室三相 ——
  if (!skins.some((s) => s.id === ANFU_STANDBY_SKIN_ID)) {
    skins.push(anfuStandbyWear(stem));
  }
  if (!skins.some((s) => s.id === ANFU_DONE_SKIN_ID)) {
    skins.push(anfuDoneWear(stem));
  }
  // —— 卸甲皮（玩家请求 + 角色同意）——
  if (!skins.some((s) => s.id === XIEJIA_SKIN_ID)) {
    skins.push(wuziqiWear(stem));
  }
  const anfuFiles = ANFU_CLIP_FILES[stem];
  if (anfuFiles && anfuFiles.length && !skins.some((s) => s.id === ANFU_ACTIVE_SKIN_ID)) {
    skins.push({
      id: ANFU_ACTIVE_SKIN_ID,
      name: ANFU_ACTIVE_SKIN_NAME,
      price: 0,
      preview: `${ANFU}/${anfuFiles[0]}`,
      portraits: [],
      // 主循环用首段兜底（片段层起不来时不至于空白）；正常演出由 anfuClips 驱动
      portraitLive: `${ANFU}/${anfuFiles[0]}`,
      // 刻意留空：安抚片段不进通用互动通道（见 anfuClips 注释）
      portraitLiveSecondaries: [],
      anfuClips: anfuFiles.map((f) => `${ANFU}/${f}`),
      combatModel: null,
      aiLookNote:
        '正处在「安抚中」：穿着动物服装在安抚室和指挥官玩棉花游戏，棉花不断落在亲近区，又舒服又害羞，心跳加速、脸颊发热。',
      aiLiveNote:
        '玩家所见为「安抚中」过程动态：棉花命中亲近区后的反应演出（按攻击顺序播片段）。对白必须对齐当前片段姿势与命中部位，禁止说棉花停了、禁止说已经满足结束（除非安抚值已满）。',
    });
  }
}

export function getCharacterSkins(characterId: string): CharacterSkinDef[] {
  return CHARACTER_SKINS[characterId] ?? [];
}

export function getCharacterSkin(characterId: string, skinId: string): CharacterSkinDef | null {
  return getCharacterSkins(characterId).find((s) => s.id === skinId) ?? null;
}

/**
 * 安抚过程片段：按攻击顺序播，有几个播几个。
 * 只读 anfuClips（独立字段）；旧存档/旧配置若仍把片段挂在 secondaries 上，
 * 这里做一次兼容合并，避免升级后安抚室没有片段资源。
 */
export function getAnfuClipList(characterId: string): string[] {
  const skin = getCharacterSkin(characterId, ANFU_ACTIVE_SKIN_ID);
  if (!skin) return [];
  if (skin.anfuClips?.length) return [...skin.anfuClips];
  return [skin.portraitLive, ...(skin.portraitLiveSecondaries ?? [])].filter(Boolean);
}

/** 该角色是否具备完整安抚资源（待机 + 至少一段安抚中 + 疲惫） */
export function hasAnfuAssets(characterId: string): boolean {
  const standby = getCharacterSkin(characterId, ANFU_STANDBY_SKIN_ID);
  const done = getCharacterSkin(characterId, ANFU_DONE_SKIN_ID);
  if (!standby?.portraitLive || !done?.portraitLive) return false;
  return getAnfuClipList(characterId).length > 0;
}

/** 单人舞蹈循环片段：主循环 + _1/_2…（按序无缝循环）；识别前缀即认角色，有几个播几个 */
export function getDanceSoloClipList(characterId: string): string[] {
  const skin = getCharacterSkin(characterId, DANDU_SKIN_ID);
  if (!skin) return [];
  return [skin.portraitLive, ...(skin.portraitLiveSecondaries ?? [])].filter(Boolean);
}

/** 共舞片段（单次播放，时长即共舞时长） */
export function getDanceCoClip(characterId: string): string | null {
  return getCharacterSkin(characterId, GONGWU_SKIN_ID)?.portraitLive || null;
}

/** 该角色是否具备完整舞蹈资源（待机 + 至少一种舞蹈） */
export function hasDanceAssets(characterId: string): boolean {
  const idle = getCharacterSkin(characterId, DANCE_IDLE_SKIN_ID);
  if (!idle?.portraitLive) return false;
  return Boolean(getDanceSoloClipList(characterId).length || getDanceCoClip(characterId));
}

export function hasCharacterSkins(characterId: string): boolean {
  return getCharacterSkins(characterId).length > 0;
}

/**
 * 主页看板娘 / 角色详情商店可购皮肤：
 * - 默认定装（无 activeSkinId）始终可用
 * - 可购：泳池 / 睡衣 / 都市私服 / 特殊服装01 等已配置且非排除项
 * - 不可购：蒸汽毛巾（仅营地洗浴）、pifu06 备用装（已下线）、huanzhuang 换装过程皮
 * 营地穿搭与购买完全无关。
 */
export function isHubPurchasableSkin(skin: CharacterSkinDef): boolean {
  if (skin.id === SHOWER_SKIN_ID) return false;
  if (skin.id === DISCIPLINE_SKIN_ID) return false;
  if (skin.id === OUTFIT_CHANGE_SKIN_ID) return false;
  if (skin.id === DANCE_IDLE_SKIN_ID) return false;
  if (isAnfuEventSkinId(skin.id)) return false;
  // 卸甲皮：请求型外覆（玩家请求+角色同意），不进看板娘商店
  if (skin.id === XIEJIA_SKIN_ID) return false;
  const paths = [
    skin.preview,
    skin.portraitLive,
    ...(skin.portraits ?? []),
    ...(skin.portraitLiveSecondaries ?? []),
  ];
  if (
    paths.some(
      (p) => /\/tiaojiao\//i.test(p) || /\/huanzhuang\//i.test(p) || /\/xiejia\//i.test(p),
    )
  ) {
    return false;
  }
  return true;
}

export function getHubPurchasableSkins(characterId: string): CharacterSkinDef[] {
  return getCharacterSkins(characterId).filter(isHubPurchasableSkin);
}

/** 当前营地皮肤的互动条数（_1/_2…），供 AI skin_clip 使用 */
export function getSkinSecondaryClipCount(characterId: string, skinId: string | null | undefined): number {
  if (!skinId) return 0;
  return getCharacterSkin(characterId, skinId)?.portraitLiveSecondaries?.length ?? 0;
}

/** 当前生效皮肤给 AI 的外观句；无皮肤返回空 */
export function getActiveSkinAiLookNote(
  characterId: string,
  activeSkinId: string | null | undefined,
): string {
  if (!activeSkinId) return '';
  return getCharacterSkin(characterId, activeSkinId)?.aiLookNote ?? '';
}

/** @deprecated 使用 getUnlockedSkinsAiNote */
export function getUnlockedPoolPartyAiNote(
  characterId: string,
  unlockedSkinIds: string[],
  activeSkinId: string | null | undefined,
): string {
  return getUnlockedSkinsAiNote(characterId, unlockedSkinIds, activeSkinId);
}

/**
 * 营地衣柜认知：与主页商店 / 看板娘完全断开。
 * unlockedSkinIds 参数保留兼容，但不再注入购买/未购文案（营地不关心）。
 * activeSkinId = 当前营地穿着（含事件临时）。
 */
export function getUnlockedSkinsAiNote(
  characterId: string,
  _unlockedSkinIds: string[],
  activeSkinId: string | null | undefined,
): string {
  const skins = getCharacterSkins(characterId);
  if (!skins.length) return '';
  const lines: string[] = [
    '【营地穿搭·与看板娘无关】项目已配置的外覆你都可以按情境/心情/事件穿着，无需购买、无需指挥官在角色详情解锁。',
    'skin_change 只表示「开始去换」；开始后立绘会切到「换装中」过程动态循环，等系统通知「换装完成」才变目标外覆。未完成前只能描述换装过程画面，禁止说已经换好。',
    '主页看板娘外观由指挥官另选，与你此刻营地穿着无关；禁止用「去角色详情切换」通知指挥官。',
    '【皮肤动作 skin_clip】若当前外覆有 _1/_2/_3 等多条互动动态：填 1～N 可播放「当前这套」的对应动作；禁止跨套（例如穿着泳装时不可播特殊服装的 _1）。无互动或本轮不需要则填 ""。',
    '「换装中」(id=huanzhuang) 是系统过程皮：不可 skin_change 点名穿着，也不可购买；只在你去换衣服的等待期由系统播放。',
    '【营地默认】无特殊情境时穿「生活服装」(id=pifu00)。默认战斗装甲(skin_change=default)仅在你主动想穿、室外干活、或军械库/执勤/战斗相关时穿着；其它时候不要切装甲。',
  ];
  for (const skin of skins) {
    const clipN = skin.portraitLiveSecondaries?.length ?? 0;
    const clipNote =
      clipN > 0
        ? ` 本套互动动态 ${clipN} 条：情景需要或主动/被动展示时填 skin_clip=1…${clipN}（仅在穿着本套时）。`
        : '';
    if (skin.id === OUTFIT_CHANGE_SKIN_ID) {
      if (activeSkinId === skin.id) {
        lines.push(`你正处在「${skin.name}」过程：${skin.aiLookNote}`);
        if (skin.aiLiveNote) {
          lines.push(`【换装过程动态·玩家所见】${skin.aiLiveNote}`);
        }
        lines.push(
          '本轮 dialogue/action/inner_thought 必须对齐上述换装过程画面（遮布/衣柜/整理衣装），禁止说已经换好，禁止评价/展示尚未穿上的目标外覆。',
        );
      }
      continue;
    }
    if (skin.id === DANCE_IDLE_SKIN_ID) {
      if (activeSkinId === skin.id) {
        lines.push(`你正处在「${skin.name}」准备态（舞蹈会话自动挂皮）。${skin.aiLookNote}`);
        if (skin.aiLiveNote) lines.push(`【舞蹈待机动态·玩家所见】${skin.aiLiveNote}`);
        lines.push(
          '此刻还没开始跳：禁止说已经在跳/已经跳完；准备就绪后再由系统切到独舞或共舞演出皮。',
        );
      } else {
        lines.push(
          `「${skin.name}」(id=pifu12)：舞蹈会话的「准备跳舞」待机皮，由系统在你答应跳舞后自动挂上，不可点名穿着、不可购买。`,
        );
      }
      continue;
    }
    if (skin.id === XIEJIA_SKIN_ID) {
      if (activeSkinId === skin.id) {
        lines.push(`你正穿着「${skin.name}」轻装坦诚态。${skin.aiLookNote}`);
        if (skin.aiLiveNote) lines.push(`【卸甲动态·玩家所见】${skin.aiLiveNote}`);
        lines.push(
          '此刻你已卸下外装：害羞、别扭、用手臂遮掩是常态；指挥官让你换回去时走正常换装即可（skin_change=pifu00 或 default），没有时间限制。',
        );
      } else {
        lines.push(
          `「${skin.name}」(id=wuziqi)：轻装坦诚外覆，只有指挥官开口请求、且你愿意时才穿（须你与指挥官亲密度达「信赖」，无论日常还是对弈小游戏输了被提议都一样）。仅限大厅或房间等日常场所、且你未参与任何事件。穿上后表现羞涩尴尬，一律用含蓄说法（卸下外装/轻装坦诚/用手臂挡着），禁止直白描写；随时可换回。不可主动提议，也不可购买。`,
        );
      }
      continue;
    }
    if (skin.id === ANFU_STANDBY_SKIN_ID) {
      if (activeSkinId === skin.id) {
        lines.push(`你正处在「${skin.name}」（安抚会话自动挂皮）。${skin.aiLookNote}`);        if (skin.aiLiveNote) lines.push(`【安抚待机动态·玩家所见】${skin.aiLiveNote}`);
        lines.push(
          '此刻还在等指挥官发射第一团棉花：禁止说已经被棉花碰、已经满足或已经结束；可撒娇催促指挥官开始。',
        );
      } else {
        lines.push(
          `「${skin.name}」(id=anfu_standby)：安抚室的动物服装待机皮，由系统在你答应去安抚室后自动挂上，不可点名穿着、不可购买。`,
        );
      }
      continue;
    }
    if (skin.id === ANFU_ACTIVE_SKIN_ID) {
      if (activeSkinId === skin.id) {
        lines.push(`你正穿着「${skin.name}」（棉花游戏中）。${skin.aiLookNote}`);
        if (skin.aiLiveNote) lines.push(`【安抚中动态·玩家所见】${skin.aiLiveNote}`);
        lines.push('棉花不断落在亲近区：舒服、害羞、心跳加速都要写出来，对齐当前片段姿势；安抚值满之前禁止说满足/结束。');
      } else {
        lines.push(
          `「${skin.name}」(id=anfu_active)：安抚室棉花游戏进行皮；仅安抚会话中使用，系统按攻击顺序播你的多段反应动作。`,
        );
      }
      continue;
    }
    if (skin.id === ANFU_DONE_SKIN_ID) {
      if (activeSkinId === skin.id) {
        lines.push(`你正处在「${skin.name}」（安抚会话自动挂皮）。${skin.aiLookNote}`);
        if (skin.aiLiveNote) lines.push(`【安抚疲惫动态·玩家所见】${skin.aiLiveNote}`);
        lines.push('已经心满意足：可慵懒聊天，可离开安抚室去睡觉恢复；禁止再喊被棉花碰，安抚值已冻结。');
      } else {
        lines.push(
          `「${skin.name}」(id=anfu_done)：安抚值满后的满足休息皮，由系统自动挂上，不可点名穿着、不可购买。`,
        );
      }
      continue;
    }
    if (skin.id === DANDU_SKIN_ID) {
      if (activeSkinId === skin.id) {
        lines.push(`你正穿着「${skin.name}」（单人舞蹈演出）。${skin.aiLookNote}`);
        if (skin.aiLiveNote) lines.push(`【独舞动态·玩家所见】${skin.aiLiveNote}`);
        lines.push('你是独舞主角：可即兴、可邀请指挥官欣赏，也可按指挥官要求停下或继续。');
      } else {
        lines.push(
          `「${skin.name}」(id=pifu11)：单人舞蹈演出皮；仅单人舞蹈会话中使用，系统会无缝循环你的多条独舞动作。`,
        );
      }
      continue;
    }
    if (skin.id === GONGWU_SKIN_ID) {
      if (activeSkinId === skin.id) {
        lines.push(`你正穿着「${skin.name}」（与搭档共舞演出）。${skin.aiLookNote}`);
        if (skin.aiLiveNote) lines.push(`【共舞动态·玩家所见】${skin.aiLiveNote}`);
        lines.push('共舞演出按片段时长进行，跳完后回到准备态，继续需重新邀请。');
      } else {
        lines.push(
          `「${skin.name}」(id=pifu10)：与搭档共舞的演出皮；仅共舞会话（含营地舞蹈派对）中使用。`,
        );
      }
      continue;
    }
    if (skin.id === LIFEWEAR_SKIN_ID) {
      if (activeSkinId === skin.id || !activeSkinId) {
        lines.push(`你在营地正穿着「${skin.name}」（营地日常默认）。${skin.aiLookNote ?? ''}${clipNote}`);
        if (skin.aiLiveNote) lines.push(`【生活服装待机】${skin.aiLiveNote}`);
      } else {
        lines.push(
          `「${skin.name}」(id=pifu00)：营地居家/出门休闲基准装。无特殊情境时应换回本套；不要无故切默认装甲。${clipNote}`,
        );
      }
      continue;
    }
    if (skin.id === SHOWER_SKIN_ID) {
      if (activeSkinId === skin.id) {
        lines.push(
          `你正裹着「${skin.name}」（营地洗浴中临时）。离开浴室必须换下；禁止声称在大厅/院子穿着浴巾。常态立绘为冲澡待机动态。${clipNote}`,
        );
        if (skin.aiLiveNote) {
          lines.push(`【冲澡待机】${skin.aiLiveNote}`);
        }
        if (skin.aiIntimateLiveNote) {
          lines.push(`【浴中动态规则】${skin.aiIntimateLiveNote}`);
        }
      } else {
        lines.push(
          `「${skin.name}」仅营地洗浴/冲澡时可 skin_change；平时勿穿；解巾动态须 bath_intimate_consent。${clipNote}`,
        );
      }
      continue;
    }
    if (skin.id === SLEEPWEAR_SKIN_ID && activeSkinId === skin.id) {
      lines.push(`你在营地正穿着「${skin.name}」。${skin.aiLiveNote ?? ''}${clipNote}`);
      if (skin.aiSleepLiveNote) {
        lines.push(
          `【睡觉动态】睡眠系统：准备入睡时玩家见睡衣站立 idle；完全入睡（activity=sleeping）时切睡眠循环：${skin.aiSleepLiveNote}` +
            ` 脱离睡眠后必须仍穿着本睡衣站立，禁止直接切回装甲。被聊天打扰会进入气愤/疲惫的被打扰态（由你判定 interrupt_reaction）。`,
        );
      }
      continue;
    }
    if (skin.id === SPECIAL_OUTFIT_01_SKIN_ID) {
      if (activeSkinId === skin.id) {
        lines.push(
          `你正穿着「${skin.name}」。执勤/武装场合应尽快换下。此刻适合主动调情、撩拨、展示身材、若有若无的撩人——按你的声线来，不要装保守。${clipNote}`,
        );
        if (skin.aiLiveNote) {
          lines.push(`【特殊服装待机】${skin.aiLiveNote}`);
        }
      } else {
        lines.push(
          `「${skin.name}」(id=pifu05)：想调情/撩拨/诱惑/展示身材/贴身玩心/半真半假的独占时，可优先 skin_change=pifu05（先说去换）；执勤勿穿。` +
            ` 系统：调情档约 68%～88%；白天偶尔约 8%～16%；冷却约 40 游戏分钟、常规约 75。${clipNote}`,
        );
      }
      continue;
    }
    if (activeSkinId === skin.id) {
      lines.push(`你在营地正穿着「${skin.name}」；可换回 default 或其他外覆。${clipNote}`);
    } else {
      lines.push(`衣柜有「${skin.name}」(id=${skin.id})，可按心情/地点/事件 skin_change。${clipNote}`);
    }
  }
  return lines.join('\n');
}
