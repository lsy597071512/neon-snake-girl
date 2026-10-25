/**
 * 剧情文案表（数据层）——与 UI / 存档分离，便于加章与改台词。
 * 全文案以 docs/story-system.md 为准；此处为可执行结构化版本。
 *
 * 2026-09-16：StoryLine 新增 `emotion`（emotion-poses key，见 characterEmotionPoses.ts），
 * 供对话框表情差分使用；不填则回落角色头像。
 */
import type { StageDef } from '../types';

export type StoryBubble = 'dialogue' | 'whisper' | 'shout' | 'narration';

export type StorySpeakerKind =
  | 'char'
  | 'shopkeeper'
  | 'commander'
  | 'narration';

export interface StoryLine {
  speaker: StorySpeakerKind;
  /** CHARACTER_MAP id；shopkeeper / commander / narration 可空 */
  charId?: string;
  name?: string;
  text: string;
  bubble?: StoryBubble;
  /** 同屏立绘（默认装甲）；当前说话人优先 */
  stage?: string[];
  shopkeeperFacing?: 'front' | 'back';
  /** 表情差分 key（emotion-poses catalog，如 concern / pride）；仅 char 说话人生效 */
  emotion?: string;
}

export interface StoryChoiceOption {
  id: 'A' | 'B' | 'C';
  text: string;
}

export type StoryBeatNode =
  | { type: 'line'; line: StoryLine }
  | {
      type: 'choice';
      options: StoryChoiceOption[];
      branches: Partial<Record<'A' | 'B' | 'C', StoryBeatNode[]>>;
      join?: StoryBeatNode[];
    }
  | { type: 'confirm'; label: string; join?: StoryBeatNode[] }
  | { type: 'tapHint'; hints: Record<string, string> };

export interface StoryBeatDef {
  id: string;
  /** 引导场不可整场跳过 */
  skippable: boolean;
  nodes: StoryBeatNode[];
  /**
   * 剧情情绪 BGM（music/ 曲库）：
   * calm=平和（开场/温情） calm2=平和2（旅途/营地） tense=紧张（危机/Boss 前） truth=真相（揭露/章末）
   * 播放时切到对应轨，收场后恢复之前曲目。
   */
  bgm?: 'calm' | 'calm2' | 'tense' | 'truth';
}

export type GuideHighlight =
  | 'none'
  | 'hub_commander'
  | 'squad'
  | 'map'
  | 'tasks'
  | 'shop'
  | 'weapons'
  | 'camp'
  | 'stage';

export type GuideStepId =
  | 'g_hello'
  | 'g_identity'
  | 'g_tour'
  | 'g_roster'
  | 'g_squad'
  | 'g_squad_ok'
  | 'g_stage1'
  | 'g_task'
  | 'g_shop'
  | 'g_equip'
  | 'g_squad2'
  | 'g_stage2'
  | 'g_stage3'
  | 'g_camp';

export interface GuideTourMark {
  /** 元素选择器（一般为 [data-tour="..."]） */
  sel: string;
  /** 悬浮小标签，如“队伍总战力” */
  label: string;
  /** 点读解说，一句话说明这个位置是什么、怎么用 */
  text: string;
  /** 是否把元素自身的数值拼进牌子（如“推荐战力 95”） */
  showValue?: boolean;
}

export interface GuideStepDef {
  id: GuideStepId;
  highlight: GuideHighlight;
  shopkeeperFacing: 'front' | 'back';
  text: string;
  /** 统一注册表目标 id（P0）：渲染与高光只认这里 */
  targets?: string[];
  /**
   * 有序步：高亮的多个目标必须**按徽章 1→2→3 的顺序**点击。
   * 只点后面的（如跳过选关直接点出战）会被拦截器挡下并摇框提示。
   * 进度按「步 id + 当前页」记在运行时，重渲染不丢。
   */
  ordered?: boolean;
  /** 信息位巡览：只看不点，描边+小标签指示位置 */
  tour?: GuideTourMark[];
  /** 有则显示确认按钮；否则等条件 */
  confirmLabel?: string;
  /** confirm 步：点确认即推进；condition 步：条件满足自动推进 */
  mode: 'confirm' | 'condition';
}

export const GUIDE_STEP_ORDER: GuideStepId[] = [
  'g_hello',
  'g_identity',
  'g_tour',
  'g_roster',
  'g_squad',
  'g_squad_ok',
  'g_stage1',
  'g_task',
  'g_shop',
  'g_equip',
  'g_squad2',
  'g_stage2',
  'g_stage3',
  'g_camp',
];

export const GUIDE_STEPS: Record<GuideStepId, GuideStepDef> = {
  g_hello: {
    id: 'g_hello',
    highlight: 'none',
    shopkeeperFacing: 'front',
    text: '欢迎来到锈带仅存的商店。刚醒就签下两位，手脚挺快嘛。出战名单还空着——我离开柜台一会儿，带你把第一步走完。点「确认」。',
    confirmLabel: '确认',
    mode: 'confirm',
  },
  g_identity: {
    id: 'g_identity',
    highlight: 'hub_commander',
    targets: ['hub-commander'],
    shopkeeperFacing: 'front',
    text: '先认清你的位置：你是指挥官。战斗模块拆了，枪你开不了，但「点谁的名」只有你能做。胸口那盏灯亮着，姑娘们就知道该看向哪里。点一下：「我是指挥官」。',
    confirmLabel: '我是指挥官',
    mode: 'confirm',
  },
  g_tour: {
    id: 'g_tour',
    highlight: 'none',
    targets: ['nav-squad', 'nav-map', 'nav-tasks', 'nav-shop', 'nav-camp'],
    shopkeeperFacing: 'front',
    text: '先认路，30秒。编队管上谁打、前线管去哪打、任务管领钱、商城是我的店、营地以后是家。金色牌子一次指一个，点发光的信息位继续。',
    tour: [
      { sel: '[data-goto="squad"]', label: '编队', text: '管上谁打' },
      { sel: '[data-goto="map"]', label: '前线', text: '管去哪打' },
      { sel: '[data-goto="tasks"]', label: '任务', text: '管领钱' },
      { sel: '[data-goto="shop"]', label: '商城', text: '我的店，管开箱' },
      { sel: '[data-goto="camp"]', label: '营地', text: '以后是家，现在还锁着' },
    ],
    confirmLabel: '认完路了',
    mode: 'confirm',
  },
  g_roster: {
    id: 'g_roster',
    highlight: 'none',
    targets: [],
    shopkeeperFacing: 'front',
    text: '认人：澪是突击，跑得快负责撕口子；芹奈有盾，负责挡住弹片。第一关只能上澪——月台的风只有她压得住。点「去编队」带她上阵。',
    confirmLabel: '去编队',
    mode: 'confirm',
  },
  g_squad: {
    id: 'g_squad',
    highlight: 'squad',
    targets: ['nav-squad', 'squad-pick-ashcrow', 'squad-slot-0'],
    ordered: true,
    shopkeeperFacing: 'front',
    text: '认完人再点名。打开左边「编队」，按顺序来：先点澪的名字（①），再点上面的空出战槽（②），把她放到最前面。',
    tour: [{ sel: '[data-tour="page-title"]', label: '队伍总战力', text: '全队总战力，关卡都认它' }],
    mode: 'condition',
  },
  g_squad_ok: {
    id: 'g_squad_ok',
    highlight: 'map',
    shopkeeperFacing: 'front',
    text: '好了，她站进出战位了。点「前往前线」——零号月台在等你们。',
    confirmLabel: '前往前线',
    mode: 'confirm',
  },
  g_stage1: {
    id: 'g_stage1',
    highlight: 'map',
    targets: ['stage-node:1', 'fight-btn'],
    ordered: true,
    shopkeeperFacing: 'front',
    text: '进「零号月台」，先点第 1 关的关卡格（①），再点右下的「手动战斗」（②）。顺序不能反，先点战斗我不会放你过去。开战前澪有话对你说，别急着点掉。记住：名单第一位必须是澪，不然那扇门不会开。\n开打后看澪脚下：技能亮了就点，点了就放。',
    tour: [
      { sel: '[data-tour="rec-tcp"]', label: '推荐战力', text: '本关门槛，低于它会被拦下来', showValue: true },
      { sel: '[data-tour="battle-tcp"]', label: '出战战力', text: '只计本关能上场的人，绿色就是能打', showValue: true },
    ],
    mode: 'condition',
  },
  g_task: {
    id: 'g_task',
    highlight: 'tasks',
    shopkeeperFacing: 'front',
    text: '「第一次胜利」已经记在你名下了。去左边「任务」把锈币领回来——不领的话，待会儿开箱的钱就不够看了。',
    mode: 'condition',
  },
  g_shop: {
    id: 'g_shop',
    highlight: 'shop',
    targets: ['open-box'],
    shopkeeperFacing: 'front',
    text: '锈币到手。点左边「商城」——是我的店，别走到底栏「武器」去。\n「唤醒协议」那块牌子是我店的招牌，点它能进征召大厅；但今天先顾眼前：点「开启军械箱」，第一箱，我担保出新枪。',
    tour: [
      { sel: '[data-tour="recruit-entry"]', label: '唤醒协议', text: '点牌子进征召大厅，SR/SSR/UR 都在里面等着' },
      { sel: '[data-action="open-box"]', label: '开启军械箱', text: '开箱给武器，第一箱我担保出新枪' },
    ],
    mode: 'condition',
  },
  g_equip: {
    id: 'g_equip',
    highlight: 'weapons',
    targets: ['equip-heartforge'],
    shopkeeperFacing: 'front',
    text: '芹奈还空着手。她有盾，但规矩是规矩：没枪不能上阵。去底栏「武器」，把刚开出来的那把装给她。',
    mode: 'condition',
  },
  g_squad2: {
    id: 'g_squad2',
    highlight: 'squad',
    targets: ['nav-squad', 'squad-pick-heartforge', 'squad-slot-1'],
    ordered: true,
    shopkeeperFacing: 'front',
    text: '再回一趟「编队」。顺序照做：先点「白楯·芹奈」的名字（①），再点第 2 个出战槽（②）把她放进去。澪守住槽 1，她们并肩的样子，比单打独斗稳得多。',
    tour: [
      { sel: '[data-tour="page-title"]', label: '队伍总战力', text: '全队总战力，关卡都认它' },
      { sel: '[data-tour="char-tcp"]', label: '角色战力', text: '每个人的战力，换武器、培养会涨' },
    ],
    mode: 'condition',
  },
  g_stage2: {
    id: 'g_stage2',
    highlight: 'map',
    targets: ['stage-node:2', 'fight-btn'],
    ordered: true,
    shopkeeperFacing: 'front',
    text: '去打第 2 关：先在关卡矩阵里点第 2 关（①），再点「手动战斗」（②）。名单里有澪和芹奈就行。你站她们看得见的地方——你在，她们就敢往前。',
    tour: [
      { sel: '[data-tour="rec-tcp"]', label: '推荐战力', text: '本关门槛，低于它会被拦下来', showValue: true },
      { sel: '[data-tour="battle-tcp"]', label: '出战战力', text: '只计本关能上场的人，绿色就是能打', showValue: true },
    ],
    mode: 'condition',
  },
  g_stage3: {
    id: 'g_stage3',
    highlight: 'map',
    targets: ['stage-node:3', 'fight-btn'],
    ordered: true,
    shopkeeperFacing: 'front',
    text: '教学最后一关：第 3 关。同样先点第 3 关（①），再点「手动战斗」（②）。打完这仗，我带你们去营地。货一直给你们留着。',
    mode: 'condition',
  },
  g_camp: {
    id: 'g_camp',
    highlight: 'camp',
    shopkeeperFacing: 'back',
    text: '到了。这就是我说的营地——以后就是你们的家。点底栏「营地」进去看看吧。我回商店了，要买东西，随时来。',
    confirmLabel: '知道了',
    mode: 'confirm',
  },
};

function L(
  speaker: StorySpeakerKind,
  text: string,
  extra?: Partial<StoryLine>,
): StoryBeatNode {
  return { type: 'line', line: { speaker, text, bubble: 'dialogue', ...extra } };
}

function char(
  charId: string,
  text: string,
  extra?: Partial<StoryLine> & { name?: string },
): StoryBeatNode {
  return L('char', text, { charId, stage: extra?.stage ?? [charId], ...extra });
}

function choice(
  options: StoryChoiceOption[],
  branches: Partial<Record<'A' | 'B' | 'C', StoryBeatNode[]>>,
  join?: StoryBeatNode[],
): StoryBeatNode {
  return { type: 'choice', options, branches, join };
}

/** 看板跟随：指挥官苏醒 → 签约唤醒澪 → 唤醒芹奈 → 老板娘指引前往营地 */
export const BEAT_HUB_FOLLOW: StoryBeatDef = {
  id: 'hub_follow',
  skippable: false,
  bgm: 'calm',
  nodes: [
    L('narration', '沙暴刚停。铁轨从废墟里伸出来，像一条还没断气的路。', { bubble: 'narration' }),
    L('narration', '废墟深处，一盏小灯重新亮起——沉睡了很久的指挥官，睁开了眼。', { bubble: 'narration' }),
    char('ashcrow', '……亮了？真的亮了。\n我在这排封存舱里，等这盏灯等了很久。你胸口的灯一醒，我的舱盖就自己开了。', {
      stage: ['ashcrow'],
      emotion: 'amazement',
    }),
    char('ashcrow', '旧世界的规矩：灯在谁的舱前亮起，就算谁签的名。\n我叫澪。是你把我唤醒的。这一下，叫「签约」。', {
      stage: ['ashcrow'],
      emotion: 'pride',
    }),
    char('ashcrow', '签下名的机体，只认点灯的人。\n以后你走哪，我打哪。先说好——前面三秒空档，我替你撕。', {
      stage: ['ashcrow'],
      emotion: 'pride',
    }),
    choice(
      [
        { id: 'A', text: '「跟我走。」' },
        { id: 'B', text: '「是你一直在守着我？」' },
        { id: 'C', text: '「……哔。」' },
      ],
      {
        A: [char('ashcrow', '嗯。听到了。', { emotion: 'contentment' })],
        B: [char('ashcrow', '舱外风大。总得有人看着那盏灯。', { emotion: 'trust' })],
        C: [char('ashcrow', '……行。这一声，我记住了。', { emotion: 'joy' })],
      },
      [
        char('ashcrow', '舱里还睡着一位。你的灯还够亮——把她也签了吧。', {
          stage: ['ashcrow'],
          emotion: 'friendliness',
        }),
      ],
    ),
    char('heartforge', '……好暖和。\n我以为灯灭的那天，就再也醒不过来了。', {
      stage: ['ashcrow', 'heartforge'],
      emotion: 'trust',
    }),
    char('heartforge', '我叫芹奈。第二个被你点亮的人。\n盾还在。以后谁想碰你那盏灯，先问过我的盾。', {
      stage: ['ashcrow', 'heartforge'],
      emotion: 'pride',
    }),
    choice(
      [
        { id: 'A', text: '「欢迎回来。」' },
        { id: 'B', text: '「你们两个，都算我的。」' },
        { id: 'C', text: '「……哔哔。」' },
      ],
      {
        A: [char('heartforge', '嗯。能回来，真好。', { emotion: 'contentment' })],
        B: [
          char('ashcrow', '行。', { emotion: 'trust' }),
          char('heartforge', '那我说定了。', { emotion: 'joy' }),
        ],
        C: [char('heartforge', '两声？……这是在高兴吧。', { emotion: 'friendliness' })],
      },
      [
        char('ashcrow', '街口商店的老板娘，一直在等醒着的人。\n她说，带我们去一个能叫「家」的地方。', {
          stage: ['ashcrow', 'heartforge'],
          emotion: 'friendliness',
        }),
        L('shopkeeper', '醒了就好。跟我来吧——营地就在商业街尽头，比这儿暖和。', {
          shopkeeperFacing: 'front',
        }),
      ],
    ),
  ],
};

export const BEAT_S1_1: StoryBeatDef = {
  id: 's1-1',
  skippable: false,
  bgm: 'calm',
  nodes: [
    L('narration', '零号月台。风卷着沙粒，铁轨在暮色里泛着冷光。', { bubble: 'narration' }),
    char('ashcrow', '黄沙盖着铁轨，集装箱歪得东倒西歪。\n风我量过——前面大概有三秒空档，够我冲出去撕开一条路。', {
      emotion: 'anticipation',
    }),
    char('ashcrow', '你不用开枪。跟着我，灯别灭。\n机兵从铁轨那边爬过来了。它们只认编号，不认人。', {
      emotion: 'pride',
    }),
    char('ashcrow', '我们有名字。……也有你那声哔。有时候，哔比编号管用。', {
      emotion: 'pride',
    }),
    choice(
      [
        { id: 'A', text: '「我跟着你。」' },
        { id: 'B', text: '「前面交给你。」' },
        { id: 'C', text: '「……小心点。」' },
      ],
      {
        A: [char('ashcrow', '嗯。最前面是我。', { emotion: 'pride' })],
        B: [char('ashcrow', '行。你看着我的背影就好。', { emotion: 'trust' })],
        C: [char('ashcrow', '……风里还会说小心的人，不多。', { emotion: 'contentment' })],
      },
      [
        char('ashcrow', '通讯打开。下面那行「下令开火」——是你的。\n你一点，我才动。', {
          emotion: 'anticipation',
        }),
      ],
    ),
    char('ashcrow', '还有一件——开打后，我脚下会亮起我的主动技「破风突贯」。\n它亮了你就点，点谁脚下、谁放招。', {
      emotion: 'anticipation',
    }),
    char('ashcrow', '想提前看每个人的招式，就去「角色」面板点开名字，技能和冷却都写在信息里。', {
      emotion: 'trust',
    }),
    { type: 'confirm', label: '下令开火', join: [char('ashcrow', '路我开。跟上。三秒——别眨眼。', { emotion: 'pride' })] },
  ],
};

export const BEAT_S1_2: StoryBeatDef = {
  id: 's1-2',
  skippable: false,
  bgm: 'calm',
  nodes: [
    char('heartforge', '跟上了。盾擦到沙子，有点响……抱歉。\n站我后面。不是小看你——弹片不长眼。', {
      stage: ['ashcrow', 'heartforge'],
      emotion: 'guilt',
    }),
    char('ashcrow', '你在，我就敢把背交给她。\n芹奈左，我右。你待中间。', {
      stage: ['ashcrow', 'heartforge'],
      emotion: 'trust',
    }),
    char('heartforge', '以前在熔炉城，通讯里同伴的名字一个个变灰。\n今天别那样。今天要有人回来——哪怕只喝一口热的。', {
      stage: ['ashcrow', 'heartforge'],
      emotion: 'sorrow',
    }),
    choice(
      [
        { id: 'A', text: '「我站你后面。」' },
        { id: 'B', text: '「你们两个都要回来。」' },
        { id: 'C', text: '「下次警报，换我来喊。」' },
      ],
      {
        A: [char('heartforge', '好。我挡着。', { emotion: 'pride' })],
        B: [
          char('ashcrow', '行。', { emotion: 'trust' }),
          char('heartforge', '那我说定了。', { emotion: 'anticipation' }),
        ],
        C: [char('heartforge', '哈，那你可得喊响一点。', { emotion: 'friendliness' })],
      },
      [char('ashcrow', '推进。掉队就喊，别硬撑。', { stage: ['ashcrow', 'heartforge'], emotion: 'concern' })],
    ),
  ],
};

export const BEAT_S1_3: StoryBeatDef = {
  id: 's1-3',
  skippable: false,
  bgm: 'calm',
  nodes: [
    char('ashcrow', '第三条路接上了。月台还能走。集装箱后面那条缝——我标过，安全。', {
      stage: ['ashcrow', 'heartforge'],
      emotion: 'contentment',
    }),
    char('heartforge', '看见没？你胸口那盏灯，一路都没灭。\n在锈带里，这比喊口号更像「还活着」。', {
      stage: ['ashcrow', 'heartforge'],
      emotion: 'joy',
    }),
    char('ashcrow', '再往前是走廊。沙子会更大，假门也会更多。\n但只要还在一起，就不会迷路。', {
      stage: ['ashcrow', 'heartforge'],
      emotion: 'concern',
    }),
    choice(
      [
        { id: 'A', text: '「继续走。」' },
        { id: 'B', text: '「想不想先补给？」' },
        { id: 'C', text: '「谢谢你们。」' },
      ],
      {
        A: [
          char('ashcrow', '行。', { emotion: 'pride' }),
          char('heartforge', '热的留着，回来再喝。', { emotion: 'friendliness' }),
        ],
        B: [
          char('ashcrow', '补给在身后。先清掉这波。', { emotion: 'concern' }),
          char('heartforge', '听澪的，回来我再灌壶。', { emotion: 'friendliness' }),
        ],
        C: [
          char('heartforge', '谢什么……能并肩就好。', { emotion: 'shame' }),
          char('ashcrow', '……嗯，收到了。', { emotion: 'contentment' }),
        ],
      },
      [
        char('ashcrow', '前面就靠你自己了。风会更真。\n谁出战，还是你点名——别忘。', {
          stage: ['ashcrow', 'heartforge'],
          emotion: 'trust',
        }),
      ],
    ),
  ],
};

export const BEAT_S1_7: StoryBeatDef = {
  id: 's1-7',
  skippable: true,
  bgm: 'tense',
  nodes: [
    char('ashcrow', '上面有大家伙。别一直抬头，沙子会迷枪。\n我去撕口子。芹奈，盾抬高——别让影子盖住灯。', {
      stage: ['ashcrow', 'heartforge'],
      emotion: 'tension',
    }),
    char('heartforge', '别往前冲。墙我来当。你下令就行。', {
      stage: ['ashcrow', 'heartforge'],
      emotion: 'pride',
    }),
    choice(
      [
        { id: 'A', text: '「开火！」' },
        { id: 'B', text: '「澪开路，芹奈挡住。」' },
        { id: 'C', text: '「三秒后一起上。」' },
      ],
      {
        A: [],
        B: [],
        C: [],
      },
      [char('ashcrow', '空档到了。跟上！', { emotion: 'anticipation' })],
    ),
  ],
};

export const BEAT_S1_12: StoryBeatDef = {
  id: 's1-12',
  skippable: true,
  bgm: 'truth',
  nodes: [
    char('stellar', '……零号月台。危险在变长。\n封存舱在响。不是你们的同伴——是旧世界想把一切「结束」掉。', {
      name: '天音',
      charId: 'stellar',
      bubble: 'whisper',
      emotion: 'loneliness',
    }),
    char('ashcrow', '确实在响。杂音不像友军。\n她好像在问：听她那种「结束一切」，还是跟我们活着走回去？', {
      emotion: 'doubt',
    }),
    choice(
      [
        { id: 'A', text: '「先顾我们自己。灯别灭。」' },
        { id: 'B', text: '「敌人解决掉就行，别动我们。」' },
        { id: 'C', text: '「天音，先退一步，听澪的。」' },
      ],
      {
        A: [
          char('stellar', '……结束，可以晚一点。允许。', { name: '天音', charId: 'stellar', emotion: 'loneliness' }),
          char('heartforge', '听着，我们会把你带回去。', { emotion: 'trust' }),
        ],
        B: [
          char('stellar', '明白。前面的，交给你们。', { name: '天音', charId: 'stellar', emotion: 'concern' }),
          char('ashcrow', '行。', { emotion: 'pride' }),
        ],
        C: [
          char('stellar', '……好。我先不插手。', { name: '天音', charId: 'stellar', emotion: 'contentment' }),
          char('ashcrow', '她少见地听话。', { emotion: 'amazement' }),
        ],
      },
      [char('heartforge', '不管用什么词——抓住我的盾。我们回去。', { emotion: 'trust' })],
    ),
  ],
};

/** 后续章节短 beat：章首 / 小BOSS / 章BOSS —— 可继续在本表追加 */
export const BEAT_S2_1: StoryBeatDef = {
  id: 's2-1',
  skippable: true,
  bgm: 'calm2',
  nodes: [
    L('narration', '锈带走廊。塌了半边的管道斜插进沙里，风从破口灌进来，像有人在暗处吹哨。', { bubble: 'narration' }),
    char('mirror', '东南角七成有埋伏。大路看着近，其实是诱饵。大路看着近，其实是诱饵。\n你要是非走直线，报告里大概会多一个灰色名字。——别当那个名字。', {
      name: '玲',
      stage: ['mirror', 'wireguard'],
      emotion: 'doubt',
    }),
    char('wireguard', '哟，也下沙了？滤芯戴好。\n别死在我报告里啊，写你名字我会手酸，笑话都没了。', {
      name: '萤',
      stage: ['mirror', 'wireguard'],
      emotion: 'sarcasm',
    }),
    choice(
      [
        { id: 'A', text: '「听玲的，改道。」' },
        { id: 'B', text: '「萤，辐射还好吗？」' },
        { id: 'C', text: '「……别把我写进报告。」' },
      ],
      {
        A: [
          char('mirror', '这条缝能走。', { name: '玲', emotion: 'pride' }),
          char('wireguard', '哈，总算有人听劝。', { name: '萤', emotion: 'joy' }),
        ],
        B: [char('wireguard', '偏高，但还能笑。你笑一个？……算了，哔一下也行。', { name: '萤', emotion: 'friendliness' })],
        C: [
          char('wireguard', '那你可别真变成报告。', { name: '萤', emotion: 'sarcasm' }),
          char('mirror', '目前还安全。', { name: '玲', emotion: 'concern' }),
        ],
      },
      [char('mirror', '走我标的缝。你待中间。开始。', { name: '玲', emotion: 'pride' })],
    ),
  ],
};

export const BEAT_S2_7: StoryBeatDef = {
  id: 's2-7',
  skippable: true,
  bgm: 'tense',
  nodes: [
    char('neoncoil', '左边切开。别拖泥带水。\n话少。听得懂就动。', { name: '凛', stage: ['neoncoil', 'dustblade'], emotion: 'pride' }),
    char('dustblade', '我先去「打个招呼」。要不要先对自己笑一下？\n道别可以提前说——但这次，我想听你说「会回来」。', {
      name: '椿',
      stage: ['neoncoil', 'dustblade'],
      emotion: 'friendliness',
    }),
    choice(
      [
        { id: 'A', text: '「会回来。」' },
        { id: 'B', text: '「凛开路，椿收尾。」' },
        { id: 'C', text: '「能动的都起来，跟上。」' },
      ],
      {
        A: [
          char('dustblade', '好。那笑，留给回来。', { name: '椿', emotion: 'trust' }),
          char('neoncoil', '……安静多了。', { name: '凛', emotion: 'contentment' }),
        ],
        B: [
          char('neoncoil', '行。', { name: '凛', emotion: 'pride' }),
          char('dustblade', '切口漂亮的话，我少刺一刀。', { name: '椿', emotion: 'sarcasm' }),
        ],
        C: [
          char('neoncoil', '……像样了。', { name: '凛', emotion: 'contentment' }),
          char('dustblade', '哈，这才像指挥官。', { name: '椿', emotion: 'joy' }),
        ],
      },
      [char('neoncoil', '现在。别回头看伤口——回头容易被追上。', { name: '凛', emotion: 'hostility' })],
    ),
  ],
};

export const BEAT_S2_12: StoryBeatDef = {
  id: 's2-12',
  skippable: true,
  bgm: 'truth',
  nodes: [
    char('mirror', '旧哨站还在响。镜子碎了。我以前在这儿算错过一次。', { name: '玲', emotion: 'dejection' }),
    char('wireguard', '计数器叫得难听。这不是玩笑。滤芯还剩多少——报一声。你没肺？那就报灯亮不亮。', {
      name: '萤',
      emotion: 'tension',
    }),
    char('dustblade', '沙漠里要是只爬回一个人，够做一辈子噩梦。\n这次……我想一起爬回去。灯还亮吗？', {
      name: '椿',
      emotion: 'sorrow',
    }),
    choice(
      [
        { id: 'A', text: '「都回来。灯别灭。」' },
        { id: 'B', text: '「玲，走安全的那条。」' },
        { id: 'C', text: '「萤带路，椿别一个人冲。」' },
      ],
      {
        A: [],
        B: [],
        C: [],
      },
      [
        char('mirror', '安全线重算好了。能走。', { name: '玲', emotion: 'pride' }),
        char('wireguard', '跟黄外套走，别朝我开枪。', { name: '萤', emotion: 'friendliness' }),
        char('dustblade', '道别先欠着。先活。', { name: '椿', emotion: 'anticipation' }),
      ],
    ),
  ],
};

export const BEAT_S3_1: StoryBeatDef = {
  id: 's3-1',
  skippable: true,
  bgm: 'calm2',
  nodes: [
    L('narration', '白棺谷。霜把废墟裹成白色，脚踩上去，碎裂声能传出很远。', { bubble: 'narration' }),
    char('skyshard', '谷口好冷。霜会咬关节。\n还好吗？——你可以只哔一声，我听得见。', {
      name: '雫',
      stage: ['skyshard', 'frostline'],
      emotion: 'concern',
    }),
    char('frostline', '……刀还在。\n别从背后叫我。要叫，先走到我看得见的地方。', {
      name: '黑织',
      stage: ['skyshard', 'frostline'],
      emotion: 'hostility',
    }),
    choice(
      [
        { id: 'A', text: '「我还好。我们是一队的。」' },
        { id: 'B', text: '「雫，我没事。黑织，你走旁边。」' },
        { id: 'C', text: '「……你还好吗？」' },
      ],
      {
        A: [
          char('frostline', '……知道了。', { name: '黑织', emotion: 'trust' }),
          char('skyshard', '有人应一声，就不会一个人凉下去。', { name: '雫', emotion: 'contentment' }),
        ],
        B: [
          char('frostline', '侧面我来。', { name: '黑织', emotion: 'pride' }),
          char('skyshard', '护罩准备好了。', { name: '雫', emotion: 'anticipation' }),
        ],
        C: [
          char('skyshard', '嗯。那我也说：还好。', { name: '雫', emotion: 'joy' }),
          char('frostline', '……吵。', { name: '黑织', emotion: 'irritability' }),
        ],
      },
      [char('skyshard', '进谷吧。冷可以一起扛，别一个人忍。', { name: '雫', emotion: 'friendliness' })],
    ),
  ],
};

export const BEAT_S3_7: StoryBeatDef = {
  id: 's3-7',
  skippable: true,
  bgm: 'tense',
  nodes: [
    char('frostline', '我从侧面切。剩下的，夜里收干净。\n雫，护罩。', { name: '黑织', emotion: 'pride' }),
    char('skyshard', '护罩打开。往我这边打。指挥官，交给我护。', { name: '雫', emotion: 'concern' }),
    choice(
      [
        { id: 'A', text: '「侧面听黑织的。」' },
        { id: 'B', text: '「雫，先护住我。」' },
        { id: 'C', text: '「……清干净再回来。」' },
      ],
      { A: [], B: [], C: [] },
      [char('frostline', '动。', { name: '黑织', emotion: 'hostility' })],
    ),
  ],
};

export const BEAT_S3_12: StoryBeatDef = {
  id: 's3-12',
  skippable: true,
  bgm: 'truth',
  nodes: [
    char('frostline', '八年前。雪盖住了所有脸。我记得杀的味道，却记不清被杀的人长什么样。\n锈带需要刀，我就把自己磨成夜。', {
      name: '黑织',
      emotion: 'depression',
    }),
    char('skyshard', '那台和我连着的机兵，灯还亮着。我问过它还好吗。\n今天想问你——如果刀在同伴面前停住，你还要这把刀吗？', {
      name: '雫',
      emotion: 'worry',
    }),
    choice(
      [
        { id: 'A', text: '「可以有刀，但不能伤到自己人。」' },
        { id: 'B', text: '「要刀，也要能回来的人。」' },
        { id: 'C', text: '「黑织，把腰上的带子系紧。」' },
      ],
      {
        A: [
          char('frostline', '……。', { name: '黑织', emotion: 'shame' }),
          char('skyshard', '问句有人答了。', { name: '雫', emotion: 'contentment' }),
        ],
        B: [
          char('frostline', '刀可以进来。不用多说。', { name: '黑织', emotion: 'trust' }),
          char('skyshard', '那就并肩。', { name: '雫', emotion: 'joy' }),
        ],
        C: [
          char('frostline', '……啰嗦。', { name: '黑织', emotion: 'irritability' }),
          char('skyshard', '她听进去了。', { name: '雫', emotion: 'friendliness' }),
        ],
      },
      [char('frostline', '进。别盯着脸看——看路。', { name: '黑织', emotion: 'hostility' })],
    ),
  ],
};

export const BEAT_S4_1: StoryBeatDef = {
  id: 's4-1',
  skippable: true,
  bgm: 'calm2',
  nodes: [
    L('narration', '熔炉城废墟。高炉熄了火，街区的轮廓还立在烟色的天底下。', { bubble: 'narration' }),
    char('heartforge', '高炉熄了，街还在。每一面墙塌的时候，我都记得。\n挨着我。这儿不是家，但还能当通道。', {
      stage: ['heartforge', 'prismrift'],
      emotion: 'sorrow',
    }),
    char('prismrift', '目标距离确认。我装弹的时候，后面要有人看着。\n以前就是因为犹豫，整条防线垮了。这次，先把该打的打掉。', {
      name: '朱里',
      stage: ['heartforge', 'prismrift'],
      emotion: 'tension',
    }),
    choice(
      [
        { id: 'A', text: '「我在盾后面。开火听朱里。」' },
        { id: 'B', text: '「芹奈，这里我听你的。」' },
        { id: 'C', text: '「朱里，还有多远？」' },
      ],
      {
        A: [
          char('heartforge', '好，挨着我。', { emotion: 'trust' }),
          char('prismrift', '开火我来算。你别动。', { name: '朱里', emotion: 'pride' }),
        ],
        B: [char('heartforge', '嗯。这条街我熟。跟我走。', { emotion: 'pride' })],
        C: [char('prismrift', '三百米。直射。', { name: '朱里', emotion: 'concern' })],
      },
      [char('prismrift', '距离报完了。芹奈举盾，人就在这儿。开始。', { name: '朱里', emotion: 'pride' })],
    ),
  ],
};

export const BEAT_S4_7: StoryBeatDef = {
  id: 's4-7',
  skippable: true,
  bgm: 'tense',
  nodes: [
    char('ironrain', '「雨」要下了——字面意思：金属渣会往下掉。退后三步。', { name: '琥珀', emotion: 'worry' }),
    char('prismrift', '炮停三秒。别走进弹道。节奏写死了，别抢。', { name: '朱里', emotion: 'concern' }),
    choice(
      [
        { id: 'A', text: '「退后，等渣落完。」' },
        { id: 'B', text: '「朱里先清出空档。」' },
        { id: 'C', text: '「大腿那条警戒带，我看见了。」' },
      ],
      { A: [], B: [], C: [] },
      [char('ironrain', '雨开始了。别抬头接渣。', { name: '琥珀', emotion: 'tension' })],
    ),
  ],
};

export const BEAT_S4_12: StoryBeatDef = {
  id: 's4-12',
  skippable: true,
  bgm: 'truth',
  nodes: [
    char('heartforge', '最后那个夜里，通讯里名字一个个变灰。我没撤。\n不是想当英雄。是算不清「身后还有没有人」。', {
      emotion: 'sorrow',
    }),
    char('prismrift', '我迟了零点七秒。日志是空白的。我把错记在自己头上。\n这次不准再迟。你下令——我打完。', {
      name: '朱里',
      emotion: 'guilt',
    }),
    choice(
      [
        { id: 'A', text: '「现在开火！」' },
        { id: 'B', text: '「芹奈挡住，标回去的路。」' },
        { id: 'C', text: '「零点七秒，今天拿回来。」' },
      ],
      {
        A: [
          char('heartforge', '挡着呢。', { emotion: 'pride' }),
          char('prismrift', '收到——开火！', { name: '朱里', emotion: 'hostility' }),
        ],
        B: [char('heartforge', '盾竖好了。回去的路，我标着。', { emotion: 'trust' })],
        C: [char('prismrift', '……嗯。这次不迟。', { name: '朱里', emotion: 'guilt' })],
      },
      [
        char('heartforge', '让我挡着。', { emotion: 'pride' }),
        char('prismrift', '距离到了。死城，听这一发。', { name: '朱里', emotion: 'hostility' }),
      ],
    ),
  ],
};

export const BEAT_S5_1: StoryBeatDef = {
  id: 's5-1',
  skippable: true,
  bgm: 'calm2',
  nodes: [
    L('narration', '星核禁区。轨道残骸悬在半空，像被时间遗忘的骨架。', { bubble: 'narration' }),
    char('outercore', '轨道残骸耶～机械兔说你是好人，三票，你赢了。\n禁区会让人想留下来。留下来会出事。所以我先开玩笑。', {
      name: '美羽',
      stage: ['outercore', 'stellar'],
      emotion: 'excitement',
    }),
    char('stellar', '……别靠我太近。也不要和「星」叠在一起。\n危险我读得懂。只要你坚持灯还亮着，结束可以晚一点。', {
      name: '天音',
      stage: ['outercore', 'stellar'],
      emotion: 'loneliness',
    }),
    choice(
      [
        { id: 'A', text: '「看一眼就走。我们回家。」' },
        { id: 'B', text: '「美羽，只打坏人。」' },
        { id: 'C', text: '「天音，你先退开，我来守。」' },
      ],
      { A: [], B: [], C: [] },
      [
        char('outercore', '好哦～', { name: '美羽', emotion: 'joy' }),
        char('stellar', '……结束，后移。', { name: '天音', emotion: 'concern' }),
        char('outercore', '她的意思是：先不把我们一起结束掉。', {
          name: '美羽',
          bubble: 'whisper',
          emotion: 'friendliness',
        }),
      ],
    ),
  ],
};

export const BEAT_S5_7: StoryBeatDef = {
  id: 's5-7',
  skippable: true,
  bgm: 'tense',
  nodes: [
    char('pulse', '别静！一静我就听见旧防空网的尖叫！\n你哔一声——有声音，我的连射才敢打准。', {
      name: '铃',
      emotion: 'anxiety',
    }),
    char('stellar', '射击范围划好了。多一句没有，少一句也没有。', { name: '天音', emotion: 'concern' }),
    choice(
      [
        { id: 'A', text: '「哔。」' },
        { id: 'B', text: '「铃你开火，天音你盯着。」' },
        { id: 'C', text: '「别怕静。我在。」' },
      ],
      {
        A: [
          char('pulse', '会响！你会响！', { name: '铃', emotion: 'excitement' }),
          char('stellar', '……这一声，可以。', { name: '天音', emotion: 'contentment' }),
        ],
        B: [char('pulse', '行行行我响，你也别灭灯！', { name: '铃', emotion: 'fluster' })],
        C: [char('pulse', '行行行我响，你也别灭灯！', { name: '铃', emotion: 'fluster' })],
      },
    ),
  ],
};

export const BEAT_S5_12: StoryBeatDef = {
  id: 's5-12',
  skippable: true,
  bgm: 'truth',
  nodes: [
    char('stellar', '最高危险。\n要结束的是眼前的敌人，不是营地，也不是你的灯。——名单我划过了。', {
      name: '天音',
      emotion: 'hostility',
    }),
    char('outercore', '星要同步了。只咬坏人——说话算话。\n三票还作数吗？好人票？', { name: '美羽', emotion: 'excitement' }),
    char('ashcrow', '路开了。走廊还没死。你把「走到这里」写进这一趟，我认。', {
      emotion: 'pride',
    }),
    choice(
      [
        { id: 'A', text: '「把敌人解决掉。别动我们。」' },
        { id: 'B', text: '「今天先留一口气。别赶尽杀绝到自己人。」' },
        { id: 'C', text: '「三票作数。回家。」' },
      ],
      { A: [], B: [], C: [] },
      [
        char('stellar', '明确。', { name: '天音', emotion: 'pride' }),
        char('outercore', '回家的灯还亮着！', { name: '美羽', emotion: 'ecstasy' }),
        char('ashcrow', '行。跟我走——这一趟也一样。', { emotion: 'trust' }),
      ],
    ),
  ],
};

/** 营地初见引导（首次进入营地时播放一次）：老板娘介绍「家」 */
export const BEAT_CAMP_INTRO: StoryBeatDef = {
  id: 'camp_intro',
  skippable: true,
  bgm: 'calm2',
  nodes: [
    L('narration', '商业街尽头，一扇铁门在身后合上。风沙被关在了外面。', { bubble: 'narration' }),
    L('shopkeeper', '到了。这里就是你们的营地——以后，就是你们的「家」了。', { shopkeeperFacing: 'front' }),
    L('shopkeeper', '签过约的孩子们都住在这儿。想她们了，就去敲敲门，跟她们说说话。', { shopkeeperFacing: 'front' }),
    L('shopkeeper', '她们也惦记着你。有时候不用你开口，她们自己就会来找你聊天。', { shopkeeperFacing: 'front' }),
    L('shopkeeper', '住得久了，还会发生很多有趣的事——泳池、派对、睡前夜谈……日子还长着呢。', { shopkeeperFacing: 'front' }),
    L('shopkeeper', '缺什么，就来商业街的店里找我。货，一直给你们留着。', { shopkeeperFacing: 'back' }),
    { type: 'confirm', label: '知道了' },
  ],
};

export const STORY_BEATS: Record<string, StoryBeatDef> = {
  hub_follow: BEAT_HUB_FOLLOW,
  camp_intro: BEAT_CAMP_INTRO,
  's1-1': BEAT_S1_1,
  's1-2': BEAT_S1_2,
  's1-3': BEAT_S1_3,
  's1-7': BEAT_S1_7,
  's1-12': BEAT_S1_12,
  's2-1': BEAT_S2_1,
  's2-7': BEAT_S2_7,
  's2-12': BEAT_S2_12,
  's3-1': BEAT_S3_1,
  's3-7': BEAT_S3_7,
  's3-12': BEAT_S3_12,
  's4-1': BEAT_S4_1,
  's4-7': BEAT_S4_7,
  's4-12': BEAT_S4_12,
  's5-1': BEAT_S5_1,
  's5-7': BEAT_S5_7,
  's5-12': BEAT_S5_12,
};

/** 关卡 → beat id；仅普通模式；教学 1-1~1-3 + 每章 1/7/12 */
export function resolveStageBeatId(stage: StageDef): string | null {
  if (stage.mode !== 'normal') return null;
  const id = `s${stage.chapter}-${stage.chapterIndex}`;
  if (STORY_BEATS[id]) return id;
  return null;
}

export function shouldPlayStageBeat(stage: StageDef): boolean {
  const beatId = resolveStageBeatId(stage);
  if (!beatId) return false;
  // 教学三关始终挂 beat；其余仅章首/7/12（表里已筛）
  if (stage.chapter === 1 && stage.chapterIndex <= 3) return true;
  return stage.chapterIndex === 1 || stage.chapterIndex === 7 || stage.chapterIndex === 12;
}
