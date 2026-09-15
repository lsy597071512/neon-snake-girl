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
/** 都市私服：活动/娱乐/派对/好心情 */
export const CASUAL_FASHION_SKIN_ID = 'pifu04';
export const CASUAL_FASHION_SKIN_NAME = '都市私服';
/** 特殊服装01：角色主动展示/调教/尝试个性化造型（营地） */
export const SPECIAL_DARE_SKIN_ID = 'pifu05';
/** @deprecated 旧名兼容；请用 SPECIAL_OUTFIT_01_SKIN_NAME */
export const SPECIAL_DARE_SKIN_NAME = '特殊服装01';
export const SPECIAL_OUTFIT_01_SKIN_ID = SPECIAL_DARE_SKIN_ID;
export const SPECIAL_OUTFIT_01_SKIN_NAME = '特殊服装01';
/** 调教约束皮：仅小黑屋事件（营地/事件通道；不可购） */
export const DISCIPLINE_SKIN_ID = 'pifu06';
export const DISCIPLINE_SKIN_NAME = '调教约束';
/** 事件临时层实例 id */
export const DISCIPLINE_TEMP_SKIN_INSTANCE = 'discipline_session';
/**
 * 换装过程皮（功能性）：仅 `pendingOutfitChanges.phase=changing` 时由系统自动播放。
 * 不可购买、不可看板娘、不可 skin_change 点名穿着；换装到点后过渡到目标皮。
 */
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
   * 营地成人洗浴同意后才播放的冲澡动态（webm）。
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
  /** 战斗模型；缺省则沿用角色默认 glb */
  combatModel: string | null;
  /** 给 AI 的外观一句（换装后进 Prompt） */
  aiLookNote: string;
  /** 动态立绘内容（给 AI 对齐玩家所见；有 webm 时填写） */
  aiLiveNote?: string;
  /** 冲澡成人互动动态内容（同意后立绘切换时注入 AI） */
  aiIntimateLiveNote?: string;
  /** 睡觉循环动态内容（营地 sleeping 时注入 AI） */
  aiSleepLiveNote?: string;
};

const PIFU = './tex/juese/pifu';
const SHUIYI = `${PIFU}/shuiyi`;
const CHONGZAO = `${PIFU}/chongzao`;
const CASUAL = `${PIFU}/shenghuoshizhuang01`;
const SPECIAL = `${PIFU}/teshufuzhuang01`;
const TIAOJIAO = `${PIFU}/tiaojiao`;
const HUANZHUANG = `${PIFU}/huanzhuang`;
const LIFEWEAR = `${PIFU}/shenghuofuzhuang00`;

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
    /** 默认 true：有 {Stem}_pifu03.webm 成人洗浴动态（须 bath_intimate_consent） */
    hasIntimateLive?: boolean;
    aiLiveNote?: string;
    aiIntimateLiveNote?: string;
  } = {},
): CharacterSkinDef {
  const base = `${CHONGZAO}/${artStem}_pifu03`;
  const hasIdle = opts.hasIdleLive !== false;
  const hasIntimate = opts.hasIntimateLive !== false;
  return {
    id: SHOWER_SKIN_ID,
    name: SHOWER_SKIN_NAME,
    price: CHARACTER_SKIN_HALF_PRICE,
    preview: `${base}.png`,
    portraits: [`${base}.png`],
    /** 浴室常态：冲澡待机动态；成人同意后才切 portraitLiveIntimate */
    portraitLive: hasIdle ? `${base}_idle.webm` : '',
    portraitLiveIntimate: hasIntimate ? `${base}.webm` : undefined,
    portraitLiveIntimateIntro: hasIntimate ? `${base}_full.webm` : undefined,
    portraitLiveSecondaries: [],
    combatModel: null,
    aiLookNote:
      opts.aiLookNote ??
      '正穿着蒸汽毛巾外覆：白色浴巾、刚冲过澡的湿润感，仅营地浴室洗浴时可穿；出浴室即换回。浴室常态立绘为冲澡待机动态。',
    aiLiveNote: hasIdle
      ? (opts.aiLiveNote ??
        '玩家所见为冲澡待机动态：白浴巾裹身、轻呼吸/微摆与水汽感，与静帧同一套外形；尚未同意同浴/旁观，勿描述脱掉浴巾或成人同浴戏。')
      : undefined,
    aiIntimateLiveNote: hasIntimate
      ? (opts.aiIntimateLiveNote ??
        '洗浴成人互动动态：浴巾已脱掉后的冲澡动态（水雾/湿发/身体动作）。仅当你自愿脱掉浴巾，或指挥官明确要求脱巾且你同意时立绘才切到此动态。若对白仍说「裹着浴巾」必须 bath_intimate_consent=false。想重新裹上则填 false，立绘回待机。禁止嘴上还裹着巾却切成人动态。')
      : undefined,
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
      '正穿着特殊服装01：个性化大胆情趣造型。适合主动调情、捉弄指挥官、展示/勾引/性暗示、情趣造型等情境；非执勤场合。不是小黑屋调教事件。',
    aiLiveNote: hasLive
      ? (opts.aiLiveNote ??
        '玩家所见为特殊服装01待机循环动态：固定镜头、轻呼吸/微摆/眨眼，与静帧同一套外形与义体；点击可切挑逗动态。勿描述成装甲或泳装。')
      : undefined,
  };
}

/**
 * 角色 id → 可用皮肤列表。
 * pifu00 生活服装（营地日常默认）；pifu01 泳池；pifu02 睡衣；pifu03 冲澡；pifu04 都市私服；pifu05 特殊服装01；pifu06 调教约束（仅小黑屋）；
 * huanzhuang 换装过程皮（仅换装协议 changing 阶段自动播放，不可购/不可点名穿着）。
 * 特殊服装01：13 人全员有 {Stem}_pifu05.png + {Stem}_pifu05.webm 默认待机 + _1/_2… 关联挑逗动态。
 * 触发见 docs/character-skins.md「特殊服装01」；调情高档约 68%～88%，白天偶尔约 8%～16%。
 * 翠翼·铃已补都市私服；焰甲泳池暂静态 SRsd04_1.png。
 * 睡衣动态：13 人全员有 {Stem}_pifu02.webm。
 * 冲澡：全员有静帧 poster + _idle 待机动态 + 成人动态；成人动态仅营地同意后播放。
 */
function disciplineWear(
  artStem: string,
  opts: {
    aiLookNote?: string;
    aiLiveNote?: string;
    secondaryCount?: number;
  } = {},
): CharacterSkinDef {
  const base = `${TIAOJIAO}/${artStem}_tiaojiao`;
  const secondaryCount = Math.max(0, opts.secondaryCount ?? 0);
  const secondaries = Array.from(
    { length: secondaryCount },
    (_, i) => `${base}_${i + 1}.webm`,
  );
  return {
    id: DISCIPLINE_SKIN_ID,
    name: DISCIPLINE_SKIN_NAME,
    price: 0,
    /** 无顶层 PNG：预览回退 idle webm（仅营地事件用，不进商城） */
    preview: `${base}.webm`,
    portraits: [],
    portraitLive: `${base}.webm`,
    portraitLiveSecondaries: secondaries,
    combatModel: null,
    aiLookNote:
      opts.aiLookNote ??
      '正穿着调教专用约束皮：白色薄皮衣待机。进房默认为未调教 idle（无触手缠身）；仅在指挥官切换姿势后才会被机械触手加压。仅在负一楼小黑屋（调教室）出现；不是 pifu05，也不是日常装甲。',
    aiLiveNote:
      opts.aiLiveNote ??
      '玩家所见为调教约束皮：默认 idle 循环无触手；点姿势才切触手动态并粘住。禁止把 idle 描述成已被触手缠满，也禁止描述成泳池/睡衣/都市私服或 pifu05。',
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

function lifewear(artStem: string): CharacterSkinDef {
  const base = `${LIFEWEAR}/${artStem}_pifu00`;
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
        '脱巾后的成人冲澡动态：水雾里湿冰蓝发、银翼饰。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
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
    outfitChangeWear('SR01_2')
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
    outfitChangeWear('SR01_3')
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
        '动态：珍珠白缎睡衣 idle，银青机械头饰与裸足同静帧；轻呼吸微摆。',
    }),
    showerWear('SR02_1', {
      aiLookNote:
        '蒸汽毛巾外覆（仅营地洗浴）：白浴巾裹紧，刚冲过的干净体温。常态为冲澡待机动态；离开浴室必须换下。',
      aiIntimateLiveNote:
        '脱巾后的成人冲澡动态：水雾中浅金发、机械头饰。仅自愿脱巾或指挥官要求脱巾且同意时触发；对白仍说裹着浴巾须 bath_intimate_consent=false。',
    }),
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
    outfitChangeWear('SR02_1')
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
    outfitChangeWear('SR03_1')
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
    outfitChangeWear('SR04_1')
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
    outfitChangeWear('SR05_1')
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
    casualFashion('SSR01_1', {
      aiLookNote:
        '都市私服外覆：黑皮短夹克与青蓝义体线，夜爪难得出来透气；适合夜间娱乐。',
    }),
    specialDare('SSR01_1', {
      secondaryCount: 2,
      aiLookNote:
        '特殊服装01：黑皮束身+短裙与披肩夹克，长黑发与青蓝义肢冷光仍在，手提长鞭；夜爪占主动调教/引导指挥官或想试穿时可换上。',
    }),
    disciplineWear('SSR01_1', {
      secondaryCount: 3,
    }),
    outfitChangeWear('SSR01_1')
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
    outfitChangeWear('SSR02_1')
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
    outfitChangeWear('SSR03_1')
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
    outfitChangeWear('SSR04_1')
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
    outfitChangeWear('SSR05_1')
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
    outfitChangeWear('UR03_1')
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
    casualFashion('UR04_1', {
      aiLookNote:
        '都市私服外覆：白橙兔耳街拍与机械兔同行，卖萌迷彩升级成逛街版。',
    }),
    specialDare('UR04_1', {
      secondaryCount: 2,
      aiLookNote:
        '特殊服装01：黑粉兔耳系绑带短装+披肩夹克，浅色短发与兔耳发箍仍在；卖萌也可占主动调教/展示或被动体验本套。',
    }),
    disciplineWear('UR04_1', {
      secondaryCount: 5,
    }),
    outfitChangeWear('UR04_1')
  ],
};

export function getCharacterSkins(characterId: string): CharacterSkinDef[] {
  return CHARACTER_SKINS[characterId] ?? [];
}

export function getCharacterSkin(characterId: string, skinId: string): CharacterSkinDef | null {
  return getCharacterSkins(characterId).find((s) => s.id === skinId) ?? null;
}

export function hasCharacterSkins(characterId: string): boolean {
  return getCharacterSkins(characterId).length > 0;
}

/**
 * 主页看板娘 / 角色详情商店可购皮肤：
 * - 默认定装（无 activeSkinId）始终可用
 * - 可购：泳池 / 睡衣 / 都市私服 / 特殊服装01 等已配置且非排除项
 * - 不可购：蒸汽毛巾（仅营地洗浴）、tiaojiao/ 调教皮、huanzhuang 换装过程皮
 * 营地穿搭与购买完全无关。
 */
export function isHubPurchasableSkin(skin: CharacterSkinDef): boolean {
  if (skin.id === SHOWER_SKIN_ID) return false;
  if (skin.id === DISCIPLINE_SKIN_ID) return false;
  if (skin.id === OUTFIT_CHANGE_SKIN_ID) return false;
  const paths = [
    skin.preview,
    skin.portraitLive,
    ...(skin.portraits ?? []),
    ...(skin.portraitLiveSecondaries ?? []),
  ];
  if (paths.some((p) => /\/tiaojiao\//i.test(p) || /\/huanzhuang\//i.test(p))) return false;
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
          lines.push(`【成人同浴动态规则】${skin.aiIntimateLiveNote}`);
        }
      } else {
        lines.push(
          `「${skin.name}」仅营地洗浴/冲澡时可 skin_change；平时勿穿；成人同浴动态须 bath_intimate_consent。${clipNote}`,
        );
      }
      continue;
    }
    if (skin.id === SLEEPWEAR_SKIN_ID && activeSkinId === skin.id) {
      lines.push(`你在营地正穿着「${skin.name}」。${skin.aiLiveNote ?? ''}${clipNote}`);
      if (skin.aiSleepLiveNote) {
        lines.push(
          `【睡觉动态】睡眠系统：准备入睡时玩家见睡衣站立 idle；完全入睡（activity=sleeping）时切睡眠循环：${skin.aiSleepLiveNote}` +
            ` 脱离睡眠后必须仍穿着本睡衣站立，禁止裸回装甲。被聊天打扰会进入气愤/疲惫的被打扰态（由你判定 interrupt_reaction）。`,
        );
      }
      continue;
    }
    if (skin.id === SPECIAL_OUTFIT_01_SKIN_ID) {
      if (activeSkinId === skin.id) {
        lines.push(
          `你正穿着「${skin.name}」。执勤/武装场合应尽快换下。此刻适合主动调情、捉弄、展示情趣造型、勾引/性暗示、邀请身体接触或表达想被调教——按你的声线来，不要装保守。${clipNote}`,
        );
        if (skin.aiLiveNote) {
          lines.push(`【特殊服装待机】${skin.aiLiveNote}`);
        }
      } else {
        lines.push(
          `「${skin.name}」(id=pifu05)：想调情/挑逗/情趣游戏/展示勾引/色诱/性暗示时，优先 skin_change=pifu05（先说去换）；执勤勿穿。小黑屋/调教室/惩罚调教是事件，不是本皮。` +
            ` 系统：调情高档约 68%～88%；白天偶尔约 8%～16%；冷却调情档约 40 游戏分钟、常规约 75。${clipNote}`,
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
