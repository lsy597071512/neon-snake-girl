/**
 * 角色表情动作图（emotion-poses）
 *
 * 资源根：`./tex/juese/emotion-poses/{characterId}/`
 * 文件名：`{nn}-{emotionKey}.png`（与下方 catalog 一一对应）
 *
 * 对话 JSON 字段：`emotion_pose` —— 填 emotionKey（如 anger / joy），
 * 供 UI / 训练同步选用正确立绘；粗粒度 `emotion` 仍用 joy|anger|… 八档。
 */

export type DialogueEmotion =
  | 'joy'
  | 'anger'
  | 'sadness'
  | 'surprise'
  | 'fear'
  | 'disgust'
  | 'neutral'
  | 'thinking';

export type EmotionPoseEntry = {
  /** 01–40 */
  index: number;
  /** 英文 key，写入 JSON emotion_pose */
  key: string;
  /** 中文情绪名 */
  labelZh: string;
  /** 映射到对话粗粒度 emotion */
  dialogueEmotion: DialogueEmotion;
  /** 给模型的短提示：表情重心 + 轻量陪衬动作 */
  aiHint: string;
};

/** 全员共用的 40 档情绪动作目录（先默认皮肤表情动作） */
export const EMOTION_POSE_CATALOG: readonly EmotionPoseEntry[] = [
  { index: 1, key: 'anger', labelZh: '生气', dialogueEmotion: 'anger', aiHint: '眉压眼锋，克制怒意，下颌收紧' },
  { index: 2, key: 'resentment', labelZh: '愤恨', dialogueEmotion: 'anger', aiHint: '怨怒积压，目光阴沉，唇线发硬' },
  { index: 3, key: 'irritability', labelZh: '烦躁', dialogueEmotion: 'anger', aiHint: '不耐烦轻蹙眉，视线略偏，气息短' },
  { index: 4, key: 'hostility', labelZh: '敌意', dialogueEmotion: 'anger', aiHint: '戒备敌视，肩微绷，目光锁定威胁' },
  { index: 5, key: 'grudge', labelZh: '怨恨', dialogueEmotion: 'anger', aiHint: '旧怨未消，冷眼回望，嘴角下压' },
  { index: 6, key: 'jealousy', labelZh: '嫉妒', dialogueEmotion: 'anger', aiHint: '酸意藏在眼底，强装平静却刺人' },
  { index: 7, key: 'sorrow', labelZh: '忧伤', dialogueEmotion: 'sadness', aiHint: '眼波下沉，轻叹，肩线略松' },
  { index: 8, key: 'depression', labelZh: '抑郁', dialogueEmotion: 'sadness', aiHint: '神采抽离，目光失焦，动作滞' },
  { index: 9, key: 'loneliness', labelZh: '寂寞', dialogueEmotion: 'sadness', aiHint: '独处空茫，眼神望远处，唇微抿' },
  { index: 10, key: 'dejection', labelZh: '沮丧', dialogueEmotion: 'sadness', aiHint: '受挫低垂，眉心轻锁，气势塌半寸' },
  { index: 11, key: 'despair', labelZh: '绝望', dialogueEmotion: 'sadness', aiHint: '瞳孔发空，脸色发白，像路断了' },
  { index: 12, key: 'self_pity', labelZh: '自怜', dialogueEmotion: 'sadness', aiHint: '委屈自伤，眼眶微湿，指节收紧' },
  { index: 13, key: 'anxiety', labelZh: '焦虑', dialogueEmotion: 'fear', aiHint: '眉心打结，视线游移，呼吸偏快' },
  { index: 14, key: 'panic', labelZh: '惊恐', dialogueEmotion: 'fear', aiHint: '眼睁大，唇微张，本能后撤半寸' },
  { index: 15, key: 'tension', labelZh: '紧张', dialogueEmotion: 'fear', aiHint: '肩颈紧绷，故作镇定却漏破绽' },
  { index: 16, key: 'fluster', labelZh: '慌乱', dialogueEmotion: 'fear', aiHint: '手足无措，目光乱跳，气息乱' },
  { index: 17, key: 'worry', labelZh: '担忧', dialogueEmotion: 'fear', aiHint: '柔和忧色，眉梢下压，关切凝视' },
  { index: 18, key: 'doubt', labelZh: '疑虑', dialogueEmotion: 'thinking', aiHint: '半信半疑，微眯眼，像在验算' },
  { index: 19, key: 'joy', labelZh: '愉悦', dialogueEmotion: 'joy', aiHint: '克制浅笑，眼角放松，暖意克制' },
  { index: 20, key: 'contentment', labelZh: '满足', dialogueEmotion: 'joy', aiHint: '安稳满足，眼帘微沉，气息放缓' },
  { index: 21, key: 'excitement', labelZh: '兴奋', dialogueEmotion: 'joy', aiHint: '眼亮上扬，气息提速，仍不失分寸' },
  { index: 22, key: 'ecstasy', labelZh: '狂喜', dialogueEmotion: 'joy', aiHint: '罕见高涨喜悦，笑容更开，仍是本人' },
  { index: 23, key: 'pride', labelZh: '自豪', dialogueEmotion: 'joy', aiHint: '下巴微抬，目光笃定，开路者气场' },
  { index: 24, key: 'friendliness', labelZh: '友善', dialogueEmotion: 'joy', aiHint: '礼貌柔和，嘴角轻扬，距离刚好' },
  { index: 25, key: 'concern', labelZh: '关切', dialogueEmotion: 'neutral', aiHint: '探询式注视，眉眼放软，像确认安全' },
  { index: 26, key: 'trust', labelZh: '信赖', dialogueEmotion: 'joy', aiHint: '卸下戒备的信任眼，肩线松，靠一点' },
  { index: 27, key: 'intimacy', labelZh: '亲密', dialogueEmotion: 'joy', aiHint: '近距柔软对视，声线可更低，仍克制' },
  { index: 28, key: 'doting', labelZh: '宠爱', dialogueEmotion: 'joy', aiHint: '难得宠意，目光黏一点，动作轻' },
  { index: 29, key: 'shock', labelZh: '震惊', dialogueEmotion: 'surprise', aiHint: '骤然愣住，瞳孔放大，呼吸一滞' },
  { index: 30, key: 'amazement', labelZh: '讶异', dialogueEmotion: 'surprise', aiHint: '意外微睁眼，眉上扬，像数据对不上' },
  { index: 31, key: 'pleasant_surprise', labelZh: '惊喜', dialogueEmotion: 'surprise', aiHint: '惊喜带笑意，眼亮，克制的开怀' },
  { index: 32, key: 'awkwardness', labelZh: '尴尬', dialogueEmotion: 'surprise', aiHint: '场面卡壳，视线飘开，嘴角僵一下' },
  { index: 33, key: 'contempt', labelZh: '轻蔑', dialogueEmotion: 'disgust', aiHint: '眼尾下压，不屑一瞥，距离拉远' },
  { index: 34, key: 'sarcasm', labelZh: '讥讽', dialogueEmotion: 'disgust', aiHint: '讽刺式浅笑，眼神刀尖，话短刺人' },
  { index: 35, key: 'aversion', labelZh: '反感', dialogueEmotion: 'disgust', aiHint: '明显排斥，眉拧，身体微侧开' },
  { index: 36, key: 'shame', labelZh: '羞耻', dialogueEmotion: 'sadness', aiHint: '耳根发热，目光躲闪，肩微收' },
  { index: 37, key: 'guilt', labelZh: '愧疚', dialogueEmotion: 'sadness', aiHint: '歉疚垂眼，唇抿，像欠一句「停」' },
  { index: 38, key: 'confusion', labelZh: '困惑', dialogueEmotion: 'thinking', aiHint: '不解微歪头，眉心问号，在算路' },
  { index: 39, key: 'curiosity', labelZh: '好奇', dialogueEmotion: 'thinking', aiHint: '探究兴味，眼更亮，前倾一点' },
  { index: 40, key: 'anticipation', labelZh: '期待', dialogueEmotion: 'joy', aiHint: '等待前方的亮眼，屏息，准备开路' },
] as const;

export const EMOTION_POSE_BASE = './tex/juese/emotion-poses';

/** 已完成资源入库的角色（有图才可被 emotion_pose 选用） */
export const EMOTION_POSE_READY_CHARACTERS: readonly string[] = [
  'ashcrow',
  'dustblade',
  'frostline',
  'heartforge',
  'ironrain',
  'mirror',
  'neoncoil',
  'outercore',
  'prismrift',
  'pulse',
  'skyshard',
  'stellar',
  'wireguard',
];

const byKey = new Map(EMOTION_POSE_CATALOG.map((e) => [e.key, e]));
const byIndex = new Map(EMOTION_POSE_CATALOG.map((e) => [e.index, e]));

export function getEmotionPoseEntry(keyOrIndex: string | number): EmotionPoseEntry | undefined {
  if (typeof keyOrIndex === 'number') return byIndex.get(keyOrIndex);
  const k = keyOrIndex.trim().toLowerCase();
  if (/^\d{1,2}$/.test(k)) return byIndex.get(Number(k));
  return byKey.get(k);
}

export function emotionPoseFileName(entry: EmotionPoseEntry): string {
  return `${String(entry.index).padStart(2, '0')}-${entry.key}.png`;
}

export function emotionPosePath(characterId: string, keyOrIndex: string | number): string | null {
  const entry = getEmotionPoseEntry(keyOrIndex);
  if (!entry) return null;
  if (!EMOTION_POSE_READY_CHARACTERS.includes(characterId)) return null;
  return `${EMOTION_POSE_BASE}/${characterId}/${emotionPoseFileName(entry)}`;
}

export function normalizeEmotionPoseKey(
  characterId: string,
  raw: string | undefined | null,
): string | undefined {
  if (!raw?.trim()) return undefined;
  if (!EMOTION_POSE_READY_CHARACTERS.includes(characterId)) return undefined;
  const entry = getEmotionPoseEntry(raw);
  return entry?.key;
}

/** 注入系统提示：告诉模型有哪些 emotion_pose 可填 */
export function emotionPosePromptHint(characterId: string): string {
  if (!EMOTION_POSE_READY_CHARACTERS.includes(characterId)) {
    return '【表情动作图 emotion_pose】本角色资源尚未入库，字段填 ""。';
  }
  const lines = EMOTION_POSE_CATALOG.map(
    (e) => `${e.key}(${e.labelZh}:${e.aiHint})`,
  );
  return `【表情动作图 emotion_pose·必选其一·画面表现】
- 每轮必须填 emotion_pose：下方英文 key 之一（不要填中文，不要自造）。
- 用途：对话时立绘会从营地皮肤实时切换到该情绪动作图（玩家看得见的脸/上身情绪），不是口头说说。
- 与粗粒度 emotion 尽量同族（生气族→anger/resentment…，愉悦族→joy/contentment…）；情绪突变可选跨族 key，画面会跟着重切。
- action/inner_thought 写神态时须与 emotion_pose 一致；禁止嘴上平静却填 panic 等明显错位。
可选 key：
${lines.join('；')}
`;
}

/**
 * 生图硬规则（全角色表情动作图通用）
 * - 禁止：任何衣服、布料、躯干盔甲、武器
 * - 允许：默认皮肤上的特征义体（头饰传感、义肢等，按角色 `_ref-lock`）
 * - 遮罩：胸关键部位半透明深色剪影（非死黑），仅身体轮廓内，不染绿幕
 */
export const EMOTION_POSE_GEN_RULES = {
  noClothesOrArmor: true,
  keepDefaultCyberTraits: true,
  /** 半透明深色；仅身体轮廓内，不得盖到绿幕 */
  veil: 'translucent-dark-on-body-only',
  aspect: '9:16',
  bg: '#00b140',
} as const;

/** 训练/调试用：角色自述卡里可附带的外观锚点（生图一致性） */
export const EMOTION_POSE_LOOK_ANCHORS: Record<
  string,
  { bodyNote: string; faceNote: string; cyberNote: string }
> = {
  ashcrow: {
    bodyNote:
      '18岁，168cm，B88/W59/H86，修长；胸围偏丰满；无衣无躯干盔甲；半透明剪影仅贴身体',
    faceNote: '亚麻金高马尾+刘海，冰蓝眼；严格贴合默认皮肤与 `_ref-lock.png`（更2D）',
    cyberNote:
      '白翼传感头饰 + 右臂青蓝义体（青色Z标、肩部金环节点）；禁止躯干盔甲与武器；左肩为肤色',
  },
  heartforge: {
    bodyNote:
      '19岁，166cm，B90/W60/H88，温柔盾卫体型；胸围更丰满；无衣无盾无躯干盔甲；半透明剪影仅贴身体',
    faceNote: '浅亚麻金长发+刘海，翠绿眼，温柔五官；贴合默认皮肤与 `_ref-lock.png`（更2D）',
    cyberNote:
      '细金属光环/耳侧传感头环等默认皮肤特征义体；禁止棺型巨盾、白灰躯干装甲、武器',
  },
  mirror: {
    bodyNote:
      '银绯·玲；超长银白直发过胸+额侧深灰挑染；B87；无衣无盔甲；半透明深灰数字网格像素溶解遮罩仅贴躯干',
    faceNote: '橙红发光眼，青年脸；严格贴合 `Generated_image.png` / `_ref-lock.png`（更2D）',
    cyberNote:
      '左侧暗灰机械传感头环+天线尖+黄矩形光点；禁止短发、禁止布料衣服/装甲',
  },
  neoncoil: {
    bodyNote:
      '苍斩·凛；短乱冰蓝白发过耳不披肩；B84/W56/H82；无衣无白甲无武器；半透明深灰数字网格 HUD 像素溶解遮罩仅贴躯干；上半身可有轻量情绪动作',
    faceNote: '冷白肤、锐利冷静五官、眼下细红传感纹；严格贴合候选 A / `_ref-lock.png`（更2D）',
    cyberNote: '细红发带 + 左侧暗色机械传感头环；禁止长发、白甲、刺刀步枪',
  },
  prismrift: {
    bodyNote:
      '焰甲·朱里；长黑发高马尾；B92/W61/H90；无衣无躯干白橙甲无重炮；半透明深灰数字网格 HUD 像素溶解遮罩仅贴躯干；上半身可有轻量情绪动作',
    faceNote: '琥珀/橙黄发光眼，冷静锐利五官；严格贴合候选 B / `_ref-lock.png`（更2D）',
    cyberNote:
      '头侧橙传感饰 + 肩侧小块 MB-02 义体肩片 + 双臂白/橙/深灰义肢；禁止肩扛重炮、全身白橙躯干装甲',
  },
  wireguard: {
    bodyNote:
      '黄狐·萤；长银白波浪发过肩+齐刘海；B85/W57/H84；无衣无白甲无武器；半透明深灰数字网格像素溶解遮罩仅贴躯干；上半身可有轻量情绪动作',
    faceNote: '亮黄/金琥珀发光眼，青年脸；严格贴合候选 B / `Generated_image.png` / `_ref-lock.png`（更2D）',
    cyberNote:
      '头顶双侧机械狐耳（白外壳+灰内腔+黄描边+青蓝三角灯）；禁止单侧太阳穴头环、额侧深灰挑染、橙红眼、布料衣服/装甲',
  },
  frostline: {
    bodyNote:
      '夜爪·黑织；长直黑发过腰+齐刘海；B89/W59/H87；无衣无肩炮无巨爪无躯干黑甲；半透明深灰数字网格像素溶解遮罩仅贴躯干；上半身可有轻量情绪动作',
    faceNote: '暖褐/琥珀眼，冷感青年脸；严格贴合候选 C / `Generated_image.png` / `_ref-lock.png`（更2D）',
    cyberNote:
      '发侧青蓝发光发夹 + 颈侧细青蓝传感纹/电路线；禁止肩炮、巨型机械爪、哑光黑躯干甲、布料衣服',
  },
  pulse: {
    bodyNote:
      '翠翼·铃；长直银白发过肩+齐刘海；B85/W57/H84；无衣无巨型背翼无白甲无武器；半透明深灰数字网格像素溶解遮罩仅贴躯干；上半身可有轻量情绪动作',
    faceNote:
      '荧光绿/霓虹绿发光眼，偏幼态明朗脸（略圆颊大眼）；严格贴合候选 A / `Generated_image.png` / `_ref-lock.png`（更2D）',
    cyberNote:
      '头侧轻量银灰机械传感耳饰/翼钉感头饰（小绿光点）；禁止巨型机械背翼、肩炮/臂炮、重刃、白甲躯干、布料衣服',
  },
  dustblade: {
    bodyNote:
      '绯尾·椿；灰玫/粉褐长直发过肩+齐刘海；B88/W58/H86；无衣无蝎尾无腿甲无躯干黑红甲；半透明深灰数字网格像素溶解遮罩仅贴躯干；上半身可有轻量情绪动作',
    faceNote:
      '橙红/琥珀红发光眼，温柔危险青年脸；严格贴合候选 C / `Generated_image.png` / `_ref-lock.png`（更2D）',
    cyberNote:
      '头顶双侧黑色机械尖耳（黑甲+红内腔）+ 双臂黑红机械义肢（红光条关节）；禁止巨型蝎尾/尾刃、腿部重甲、躯干装甲板、布料衣服',
  },
  ironrain: {
    bodyNote:
      '橙铠·琥珀；19岁，166cm，B86/W58/H85；鲜橙长发高马尾+齐刘海；无衣无深灰紧身躯干甲无白腿甲无武器；半透明深灰数字网格像素溶解遮罩仅贴躯干；上半身可有轻量情绪动作',
    faceNote:
      '橙/琥珀红发光眼，沉静青年脸；严格贴合候选 A / `Generated_image.png` / `_ref-lock.png`（更2D）',
    cyberNote:
      '额前青绿传感额饰/小视窗 + 白色机械臂甲/义肢护腕（肘腕白甲+橙/青节点）；禁止深灰战斗服躯干、白腿甲/高筒机甲靴、大腿警戒斜纹整装、武器、布料衣服',
  },
  skyshard: {
    bodyNote:
      '冰华·雫；18岁，158cm，B82/W55/H80；冰蓝波浪长发过肩；无衣无白紧身机甲服无腿甲无重型机兵；半透明深灰数字网格像素溶解遮罩仅贴躯干；上半身可有轻量情绪动作；默认正脸/微侧对镜',
    faceNote:
      '大紫/粉紫发光眼，偏幼态圆颊高眼脸比；严格贴合候选 B / `Generated_image.png` / `_ref-lock.png`（更2D）；禁止成熟化/半侧脸连刷',
    cyberNote:
      '双臂白金机械义肢护腕（白甲+金/青铜关节）；可有肩侧细同步接口痕；禁止重型机兵同伴、白躯干甲、腿甲、武器、布料衣服',
  },
  stellar: {
    bodyNote:
      '光轮·天音；外表19岁，170cm，B86/W56/H84；长直黑发+内层霓虹粉挑染；无衣无黑夹克无背翼刃无连体甲；半透明深灰数字网格像素溶解遮罩仅贴躯干；上半身可有轻量情绪动作；默认正脸/微侧对镜',
    faceNote:
      '大红/玫红发光眼，疏离空灵青年脸；严格贴合候选 B / `Generated_image.png` / `_ref-lock.png`（更2D）',
    cyberNote:
      '头顶发光细光环（halo）+ 耳侧机械耳机/传感耳罩；肩/肘金属关节节点可；禁止轰炸机夹克、背后大型机械翼刃、白黑连体衣/躯干甲、透明腿甲整段、武器、布料衣服',
  },
  outercore: {
    bodyNote:
      '橙兔·美羽；18岁，160cm，B84/W56/H83；淡紫短发粉尖；无衣无橙雨衣无比基尼无腿甲；半透明深灰数字网格像素溶解遮罩仅贴躯干；上半身可有轻量情绪动作；默认正脸/微侧对镜',
    faceNote:
      '大紫/粉紫发光眼，俏皮青年脸；严格贴合候选 B / `Generated_image.png` / `_ref-lock.png`（更2D）',
    cyberNote:
      '头顶白色机械兔耳（粉内腔）+ 黑X发夹/小粉兔发饰；可有白/橙机械臂关节；禁止巨型机械兔同伴、兔耳手枪、橙雨衣、比基尼装、白橙腿甲、武器、布料衣服',
  },
};
