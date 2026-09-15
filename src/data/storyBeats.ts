/**
 * 剧情文案表（数据层）——与 UI / 存档分离，便于加章与改台词。
 * 全文案以 docs/story-system.md 为准；此处为可执行结构化版本。
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

export interface GuideStepDef {
  id: GuideStepId;
  highlight: GuideHighlight;
  shopkeeperFacing: 'front' | 'back';
  text: string;
  /** 有则显示确认按钮；否则等条件 */
  confirmLabel?: string;
  /** confirm 步：点确认即推进；condition 步：条件满足自动推进 */
  mode: 'confirm' | 'condition';
}

export const GUIDE_STEP_ORDER: GuideStepId[] = [
  'g_hello',
  'g_identity',
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
    text: '欢迎光临。——更正，现在不是买东西。你出战名单还是空的。我先离开柜台，带你把第一步做完。点「确认」。',
    confirmLabel: '确认',
    mode: 'confirm',
  },
  g_identity: {
    id: 'g_identity',
    highlight: 'hub_commander',
    shopkeeperFacing: 'front',
    text: '先说清楚：你是指挥官。战斗模块拆掉了，自己开不了枪。要出征，就得点名队员。胸口那盏灯亮着，就表示你还在。点一下：「我是指挥官」。',
    confirmLabel: '我是指挥官',
    mode: 'confirm',
  },
  g_squad: {
    id: 'g_squad',
    highlight: 'squad',
    shopkeeperFacing: 'front',
    text: '① 点左边「编队」。② 在下方「可用机体」里点「苍羽·澪」（灰金长发）。③ 再点上方空的「出战槽 1」把她放进去。第一关只能上 1 人，必须是澪——别人上不去。',
    mode: 'condition',
  },
  g_squad_ok: {
    id: 'g_squad_ok',
    highlight: 'map',
    shopkeeperFacing: 'front',
    text: '好了，澪在出战位。点「前往前线」，打开作战图，去打第 1 关。',
    confirmLabel: '前往前线',
    mode: 'confirm',
  },
  g_stage1: {
    id: 'g_stage1',
    highlight: 'map',
    shopkeeperFacing: 'front',
    text: '进「零号月台」，点第 1 关再点出战。开战前澪会说话。注意：出战名单第 1 位必须是澪，否则进不去。',
    mode: 'condition',
  },
  g_task: {
    id: 'g_task',
    highlight: 'tasks',
    shopkeeperFacing: 'front',
    text: '「第一次胜利」做完了。点左边「任务」，找到那条任务，点领取锈币。不领的话，后面开军械箱会卡。',
    mode: 'condition',
  },
  g_shop: {
    id: 'g_shop',
    highlight: 'shop',
    shopkeeperFacing: 'front',
    text: '锈币到了。点左边「商城」（不是底栏武器）。进去后点「开启军械箱」。第一次保证开出新枪。',
    mode: 'condition',
  },
  g_equip: {
    id: 'g_equip',
    highlight: 'weapons',
    shopkeeperFacing: 'front',
    text: '芹奈还没枪。点底栏「武器」，把刚开到的枪装备给「白楯·芹奈」。她有盾，但仍要先装一把武器才能出征。',
    mode: 'condition',
  },
  g_squad2: {
    id: 'g_squad2',
    highlight: 'squad',
    shopkeeperFacing: 'front',
    text: '再回「编队」。第二关可上 2 人：保留澪在槽 1，把「白楯·芹奈」放进槽 2。点机体 → 再点空槽。',
    mode: 'condition',
  },
  g_stage2: {
    id: 'g_stage2',
    highlight: 'map',
    shopkeeperFacing: 'front',
    text: '去打第 2 关。编队里要有澪和芹奈。你自己别冲最前面——让她看得见你那盏灯。',
    mode: 'condition',
  },
  g_stage3: {
    id: 'g_stage3',
    highlight: 'map',
    shopkeeperFacing: 'front',
    text: '教学最后一关：第 3 关。打完营地会开，我回柜台。货还在。',
    mode: 'condition',
  },
  g_camp: {
    id: 'g_camp',
    highlight: 'camp',
    shopkeeperFacing: 'back',
    text: '营地开了。点底栏「营地」进去。我回商店——以后要买东西再来找我。',
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

/** 看板跟随 */
export const BEAT_HUB_FOLLOW: StoryBeatDef = {
  id: 'hub_follow',
  skippable: false,
  nodes: [
    char('ashcrow', '……还亮着。沙也停了。\n这儿是零号月台。铁轨那边风挺干，我量过——能走。', {
      stage: ['ashcrow', 'heartforge'],
    }),
    char('ashcrow', '棚外那次，我差点把你当成废铁踢开。\n后来看见臂壳上那行字：「把路打开。」跟我脑子里剩下的指令一模一样。\n半块能量芯塞回去的时候，我只说了一句——跟我走。', {
      stage: ['ashcrow', 'heartforge'],
    }),
    choice(
      [
        { id: 'A', text: '「跟我走。」' },
        { id: 'B', text: '「灯还亮着就好。」' },
        { id: 'C', text: '「……哔。」' },
      ],
      {
        A: [char('ashcrow', '嗯。听到了。')],
        B: [char('ashcrow', '那就别灭。灭了，我还得回头挖你。')],
        C: [char('ashcrow', '……也行。有时候一声哔，比说一大堆更让人安心。')],
      },
      [
        char('ashcrow', '我第二个站到你身边，不是被谁劝的——是认定你会把断掉的路接上。\n不过你还没点我的名。点了，我才走最前面；没点之前，我就守在三步外。', {
          stage: ['ashcrow', 'heartforge'],
        }),
      ],
    ),
    char('heartforge', '小个子，别往后缩。\n塌管压住你那次，警报叫得好吓人。我拿盾撬开钢架，一路念叨「别动，我来」。\n背你回来的时候，外壳烫得像刚从炉边爬出来。', {
      stage: ['ashcrow', 'heartforge'],
    }),
    char('heartforge', '后来你在棚外摆了一排空盒子，写着「欢迎回来」。\n我站了很久，只回你一句——欢迎回来。\n不是客套。是觉得……这儿又能叫作家了。', {
      stage: ['ashcrow', 'heartforge'],
    }),
    choice(
      [
        { id: 'A', text: '「谢谢你。」' },
        { id: 'B', text: '「那你站我后面。」' },
        { id: 'C', text: '「……欢迎回来。」' },
      ],
      {
        A: [char('heartforge', '谢什么。能回来的人，才配喝一口热的。')],
        B: [char('heartforge', '嗯。你要出征，我就站后面。子弹我不怕——怕的是回头一看，后面空了。')],
        C: [char('heartforge', '……嗯。这句话，只留给还活着的人。')],
      },
      [
        char('heartforge', '盾还在，枪也在。你点我的名，这一趟我负责把人带回家。\n没点之前我也在——灯照得到的地方，扫扫沙，留一壶热的。', {
          stage: ['ashcrow', 'heartforge'],
        }),
        char('ashcrow', '柜台后面那个旧机体，一会儿会来找你。她说话怪，但步骤对。\n听她的：先把编队点上，我们才能出去。', {
          stage: ['ashcrow', 'heartforge'],
        }),
      ],
    ),
  ],
};

export const BEAT_S1_1: StoryBeatDef = {
  id: 's1-1',
  skippable: false,
  nodes: [
    char('ashcrow', '黄沙盖着铁轨，集装箱歪得东倒西歪。\n风我量过——前面大概有三秒空档，够我冲出去撕开一条路。\n你不用开枪。跟着我，灯别灭。'),
    char('ashcrow', '机兵从铁轨那边爬过来了。它们只认编号，不认人。\n我们有名字。……也有你那声哔。有时候，哔比编号管用。'),
    choice(
      [
        { id: 'A', text: '「我跟着你。」' },
        { id: 'B', text: '「前面交给你。」' },
        { id: 'C', text: '「……小心点。」' },
      ],
      {
        A: [char('ashcrow', '嗯。最前面是我。')],
        B: [char('ashcrow', '行。你看着灯就好。')],
        C: [char('ashcrow', '……风里还会说小心的人，不多。')],
      },
      [
        char('ashcrow', '通讯打开。下面那行「下令开火」——是你的。\n你一点，我才动。'),
      ],
    ),
    { type: 'confirm', label: '下令开火', join: [char('ashcrow', '路我开。跟上。三秒——别眨眼。')] },
  ],
};

export const BEAT_S1_2: StoryBeatDef = {
  id: 's1-2',
  skippable: false,
  nodes: [
    char('heartforge', '跟上了。盾擦到沙子，有点响……抱歉。\n站我后面。不是小看你——弹片不长眼。', {
      stage: ['ashcrow', 'heartforge'],
    }),
    char('ashcrow', '你在，我就敢把背交给她。\n芹奈左，我右。你待中间。', {
      stage: ['ashcrow', 'heartforge'],
    }),
    char('heartforge', '以前在熔炉城，通讯里同伴的名字一个个变灰。\n今天别那样。今天要有人回来——哪怕只喝一口热的。', {
      stage: ['ashcrow', 'heartforge'],
    }),
    choice(
      [
        { id: 'A', text: '「我站你后面。」' },
        { id: 'B', text: '「你们两个都要回来。」' },
        { id: 'C', text: '「……嗯。」' },
      ],
      {
        A: [char('heartforge', '好。我挡着。')],
        B: [
          char('ashcrow', '行。'),
          char('heartforge', '那我说定了。'),
        ],
        C: [char('heartforge', '灯一闪，我就当你答应了。')],
      },
      [char('ashcrow', '推进。掉队就喊，别硬撑。', { stage: ['ashcrow', 'heartforge'] })],
    ),
  ],
};

export const BEAT_S1_3: StoryBeatDef = {
  id: 's1-3',
  skippable: false,
  nodes: [
    char('ashcrow', '第三条路接上了。月台还能走。集装箱后面那条缝——我标过，安全。', {
      stage: ['ashcrow', 'heartforge'],
    }),
    char('heartforge', '看见没？你胸口那盏灯，一路都没灭。\n在锈带里，这比喊口号更像「还活着」。', {
      stage: ['ashcrow', 'heartforge'],
    }),
    char('ashcrow', '再往前是走廊。沙子会更大，假门也会更多。\n但只要还在一起，就不会迷路。', {
      stage: ['ashcrow', 'heartforge'],
    }),
    choice(
      [
        { id: 'A', text: '「继续走。」' },
        { id: 'B', text: '「想不想先补给？」' },
        { id: 'C', text: '「谢谢你们。」' },
      ],
      {
        A: [
          char('ashcrow', '行。'),
          char('heartforge', '热的留着，回来再喝。'),
        ],
        B: [
          char('ashcrow', '补给在身后。先清掉这波。'),
          char('heartforge', '听澪的，回来我再灌壶。'),
        ],
        C: [
          char('heartforge', '谢什么……能并肩就好。'),
          char('ashcrow', '……嗯，收到了。'),
        ],
      },
      [
        char('ashcrow', '前面就靠你自己了。风会更真。\n谁出战，还是你点名——别忘。', {
          stage: ['ashcrow', 'heartforge'],
        }),
      ],
    ),
  ],
};

export const BEAT_S1_7: StoryBeatDef = {
  id: 's1-7',
  skippable: true,
  nodes: [
    char('ashcrow', '上面有大家伙。别一直抬头，沙子会迷枪。\n我去撕口子。芹奈，盾抬高——别让影子盖住灯。', {
      stage: ['ashcrow', 'heartforge'],
    }),
    char('heartforge', '别往前冲。墙我来当。你下令就行。', {
      stage: ['ashcrow', 'heartforge'],
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
      [char('ashcrow', '空档到了。跟上！')],
    ),
  ],
};

export const BEAT_S1_12: StoryBeatDef = {
  id: 's1-12',
  skippable: true,
  nodes: [
    char('stellar', '……零号月台。危险在变长。\n封存舱在响。不是你们的同伴——是旧世界想把一切「结束」掉。', {
      name: '天音',
      charId: 'stellar',
      bubble: 'whisper',
    }),
    char('ashcrow', '确实在响。杂音不像友军。\n她好像在问：听她那种「结束一切」，还是跟我们活着走回去？'),
    choice(
      [
        { id: 'A', text: '「先顾我们自己。灯别灭。」' },
        { id: 'B', text: '「敌人解决掉就行，别动我们。」' },
        { id: 'C', text: '「天音，先退一步，听澪的。」' },
      ],
      {
        A: [
          char('stellar', '……结束，可以晚一点。允许。', { name: '天音', charId: 'stellar' }),
          char('heartforge', '听着，我们会把你带回去。'),
        ],
        B: [
          char('stellar', '明白。前面的，交给你们。', { name: '天音', charId: 'stellar' }),
          char('ashcrow', '行。'),
        ],
        C: [
          char('stellar', '……好。我先不插手。', { name: '天音', charId: 'stellar' }),
          char('ashcrow', '她少见地听话。'),
        ],
      },
      [char('heartforge', '不管用什么词——抓住我的盾。我们回去。')],
    ),
  ],
};

/** 后续章节短 beat：章首 / 小BOSS / 章BOSS —— 可继续在本表追加 */
export const BEAT_S2_1: StoryBeatDef = {
  id: 's2-1',
  skippable: true,
  nodes: [
    char('mirror', '锈带走廊。东南角七成有埋伏。大路看着近，其实是诱饵。\n你要是非走直线，报告里大概会多一个灰色名字。——别当那个名字。', {
      name: '玲',
      stage: ['mirror', 'wireguard'],
    }),
    char('wireguard', '哟，也下沙了？滤芯戴好。\n别死在我报告里啊，写你名字我会手酸，笑话都没了。', {
      name: '萤',
      stage: ['mirror', 'wireguard'],
    }),
    choice(
      [
        { id: 'A', text: '「听玲的，改道。」' },
        { id: 'B', text: '「萤，辐射还好吗？」' },
        { id: 'C', text: '「……别把我写进报告。」' },
      ],
      {
        A: [
          char('mirror', '这条缝能走。', { name: '玲' }),
          char('wireguard', '哈，总算有人听劝。', { name: '萤' }),
        ],
        B: [char('wireguard', '偏高，但还能笑。你笑一个？……算了，哔一下也行。', { name: '萤' })],
        C: [
          char('wireguard', '那你可别真变成报告。', { name: '萤' }),
          char('mirror', '目前还安全。', { name: '玲' }),
        ],
      },
      [char('mirror', '走我标的缝。你待中间。开始。', { name: '玲' })],
    ),
  ],
};

export const BEAT_S2_7: StoryBeatDef = {
  id: 's2-7',
  skippable: true,
  nodes: [
    char('neoncoil', '左边切开。别拖泥带水。\n话少。听得懂就动。', { name: '凛', stage: ['neoncoil', 'dustblade'] }),
    char('dustblade', '我先去「打个招呼」。要不要先对自己笑一下？\n道别可以提前说——但这次，我想听你说「会回来」。', {
      name: '椿',
      stage: ['neoncoil', 'dustblade'],
    }),
    choice(
      [
        { id: 'A', text: '「会回来。」' },
        { id: 'B', text: '「凛开路，椿收尾。」' },
        { id: 'C', text: '「……起来，跟上。」' },
      ],
      {
        A: [
          char('dustblade', '好。那笑，留给回来。', { name: '椿' }),
          char('neoncoil', '……安静多了。', { name: '凛' }),
        ],
        B: [
          char('neoncoil', '行。', { name: '凛' }),
          char('dustblade', '切口漂亮的话，我少刺一刀。', { name: '椿' }),
        ],
        C: [
          char('neoncoil', '……', { name: '凛' }),
          char('dustblade', '你们俩，真不会聊天。', { name: '椿' }),
        ],
      },
      [char('neoncoil', '现在。别回头看伤口——回头容易被追上。', { name: '凛' })],
    ),
  ],
};

export const BEAT_S2_12: StoryBeatDef = {
  id: 's2-12',
  skippable: true,
  nodes: [
    char('mirror', '旧哨站还在响。镜子碎了。我以前在这儿算错过一次。', { name: '玲' }),
    char('wireguard', '计数器叫得难听。这不是玩笑。滤芯还剩多少——报一声。你没肺？那就报灯亮不亮。', {
      name: '萤',
    }),
    char('dustblade', '沙漠里要是只爬回一个人，够做一辈子噩梦。\n这次……我想一起爬回去。灯还亮吗？', {
      name: '椿',
    }),
    choice(
      [
        { id: 'A', text: '「都回来。灯别灭。」' },
        { id: 'B', text: '「玲，走安全的那条。」' },
        { id: 'C', text: '「萤带路，椿别一个人冲。」' },
      ],
      { A: [], B: [], C: [] },
      [
        char('mirror', '安全线重算好了。能走。', { name: '玲' }),
        char('wireguard', '跟黄外套走，别朝我开枪。', { name: '萤' }),
        char('dustblade', '道别先欠着。先活。', { name: '椿' }),
      ],
    ),
  ],
};

export const BEAT_S3_1: StoryBeatDef = {
  id: 's3-1',
  skippable: true,
  nodes: [
    char('skyshard', '谷口好冷。霜会咬关节。\n还好吗？——你可以只哔一声，我听得见。', {
      name: '雫',
      stage: ['skyshard', 'frostline'],
    }),
    char('frostline', '……刀还在。\n别从背后叫我。要叫，先走到我看得见的地方。', {
      name: '黑织',
      stage: ['skyshard', 'frostline'],
    }),
    choice(
      [
        { id: 'A', text: '「我还好。我们是一队的。」' },
        { id: 'B', text: '「雫，我没事。黑织，你走旁边。」' },
        { id: 'C', text: '「……你还好吗？」' },
      ],
      {
        A: [
          char('frostline', '……知道了。', { name: '黑织' }),
          char('skyshard', '有人应一声，就不会一个人凉下去。', { name: '雫' }),
        ],
        B: [
          char('frostline', '侧面我来。', { name: '黑织' }),
          char('skyshard', '护罩准备好了。', { name: '雫' }),
        ],
        C: [
          char('skyshard', '嗯。那我也说：还好。', { name: '雫' }),
          char('frostline', '……吵。', { name: '黑织' }),
        ],
      },
      [char('skyshard', '进谷吧。冷可以一起扛，别一个人忍。', { name: '雫' })],
    ),
  ],
};

export const BEAT_S3_7: StoryBeatDef = {
  id: 's3-7',
  skippable: true,
  nodes: [
    char('frostline', '我从侧面切。剩下的，夜里收干净。\n雫，护罩。', { name: '黑织' }),
    char('skyshard', '护罩打开。往我这边打。指挥官的灯，我挡风。', { name: '雫' }),
    choice(
      [
        { id: 'A', text: '「侧面听黑织的。」' },
        { id: 'B', text: '「雫，先护住我。」' },
        { id: 'C', text: '「……清干净再回来。」' },
      ],
      { A: [], B: [], C: [] },
      [char('frostline', '动。', { name: '黑织' })],
    ),
  ],
};

export const BEAT_S3_12: StoryBeatDef = {
  id: 's3-12',
  skippable: true,
  nodes: [
    char('frostline', '八年前。雪盖住了所有脸。我记得杀的味道，却记不清被杀的人长什么样。\n锈带需要刀，我就把自己磨成夜。', {
      name: '黑织',
    }),
    char('skyshard', '那台和我连着的机兵，灯还亮着。我问过它还好吗。\n今天想问你——如果刀在同伴面前停住，你还要这把刀吗？', {
      name: '雫',
    }),
    choice(
      [
        { id: 'A', text: '「可以有刀，但不能伤到自己人。」' },
        { id: 'B', text: '「要刀，也要能回来的人。」' },
        { id: 'C', text: '「黑织，把腰上的带子系紧。」' },
      ],
      {
        A: [
          char('frostline', '……。', { name: '黑织' }),
          char('skyshard', '问句有人答了。', { name: '雫' }),
        ],
        B: [
          char('frostline', '刀可以进来。不用多说。', { name: '黑织' }),
          char('skyshard', '那就并肩。', { name: '雫' }),
        ],
        C: [
          char('frostline', '……啰嗦。', { name: '黑织' }),
          char('skyshard', '她听进去了。', { name: '雫' }),
        ],
      },
      [char('frostline', '进。别盯着脸看——看路。', { name: '黑织' })],
    ),
  ],
};

export const BEAT_S4_1: StoryBeatDef = {
  id: 's4-1',
  skippable: true,
  nodes: [
    char('heartforge', '高炉熄了，街还在。每一面墙塌的时候，我都记得。\n挨着我。这儿不是家，但还能当通道。', {
      stage: ['heartforge', 'prismrift'],
    }),
    char('prismrift', '目标距离确认。我装弹的时候，后面要有人看着。\n以前就是因为犹豫，整条防线垮了。这次，先把该打的打掉。', {
      name: '朱里',
      stage: ['heartforge', 'prismrift'],
    }),
    choice(
      [
        { id: 'A', text: '「我在盾后面。开火听朱里。」' },
        { id: 'B', text: '「芹奈，这里我听你的。」' },
        { id: 'C', text: '「朱里，还有多远？」' },
      ],
      { A: [], B: [], C: [] },
      [char('prismrift', '距离报完了。芹奈举盾，人就在这儿。开始。', { name: '朱里' })],
    ),
  ],
};

export const BEAT_S4_7: StoryBeatDef = {
  id: 's4-7',
  skippable: true,
  nodes: [
    char('ironrain', '「雨」要下了——字面意思：金属渣会往下掉。退后三步。', { name: '琥珀' }),
    char('prismrift', '炮停三秒。别走进弹道。节奏写死了，别抢。', { name: '朱里' }),
    choice(
      [
        { id: 'A', text: '「退后，等渣落完。」' },
        { id: 'B', text: '「朱里先清出空档。」' },
        { id: 'C', text: '「大腿那条警戒带，我看见了。」' },
      ],
      { A: [], B: [], C: [] },
      [char('ironrain', '雨开始了。别抬头接渣。', { name: '琥珀' })],
    ),
  ],
};

export const BEAT_S4_12: StoryBeatDef = {
  id: 's4-12',
  skippable: true,
  nodes: [
    char('heartforge', '最后那个夜里，通讯里名字一个个变灰。我没撤。\n不是想当英雄。是算不清「身后还有没有人」。'),
    char('prismrift', '我迟了零点七秒。日志是空白的。我把错记在自己头上。\n这次不准再迟。你下令——我打完。', {
      name: '朱里',
    }),
    choice(
      [
        { id: 'A', text: '「现在开火！」' },
        { id: 'B', text: '「芹奈挡住，标回去的路。」' },
        { id: 'C', text: '「零点七秒，今天拿回来。」' },
      ],
      { A: [], B: [], C: [] },
      [
        char('heartforge', '让我挡着。'),
        char('prismrift', '距离到了。死城，听这一发。', { name: '朱里' }),
      ],
    ),
  ],
};

export const BEAT_S5_1: StoryBeatDef = {
  id: 's5-1',
  skippable: true,
  nodes: [
    char('outercore', '轨道残骸耶～机械兔说你是好人，三票，你赢了。\n禁区会让人想留下来。留下来会出事。所以我先开玩笑。', {
      name: '美羽',
      stage: ['outercore', 'stellar'],
    }),
    char('stellar', '……别靠我太近。也不要和「星」叠在一起。\n危险我读得懂。只要你坚持灯还亮着，结束可以晚一点。', {
      name: '天音',
      stage: ['outercore', 'stellar'],
    }),
    choice(
      [
        { id: 'A', text: '「看一眼就走。我们回家。」' },
        { id: 'B', text: '「美羽，只打坏人。」' },
        { id: 'C', text: '「天音，你先退开，我来守。」' },
      ],
      { A: [], B: [], C: [] },
      [
        char('outercore', '好哦～', { name: '美羽' }),
        char('stellar', '……结束，后移。', { name: '天音' }),
        char('outercore', '她的意思是：先不把我们一起结束掉。', {
          name: '美羽',
          bubble: 'whisper',
        }),
      ],
    ),
  ],
};

export const BEAT_S5_7: StoryBeatDef = {
  id: 's5-7',
  skippable: true,
  nodes: [
    char('pulse', '别静！一静我就听见旧防空网的尖叫！\n你哔一声——有声音，我的连射才敢打准。', {
      name: '铃',
    }),
    char('stellar', '射击范围划好了。多一句没有，少一句也没有。', { name: '天音' }),
    choice(
      [
        { id: 'A', text: '「哔。」' },
        { id: 'B', text: '「铃你开火，天音你盯着。」' },
        { id: 'C', text: '「别怕静。我在。」' },
      ],
      {
        A: [
          char('pulse', '会响！你会响！', { name: '铃' }),
          char('stellar', '……这一声，可以。', { name: '天音' }),
        ],
        B: [char('pulse', '行行行我响，你也别灭灯！', { name: '铃' })],
        C: [char('pulse', '行行行我响，你也别灭灯！', { name: '铃' })],
      },
    ),
  ],
};

export const BEAT_S5_12: StoryBeatDef = {
  id: 's5-12',
  skippable: true,
  nodes: [
    char('stellar', '最高危险。\n要结束的是眼前的敌人，不是营地，也不是你的灯。——名单我划过了。', {
      name: '天音',
    }),
    char('outercore', '星要同步了。只咬坏人——说话算话。\n三票还作数吗？好人票？', { name: '美羽' }),
    char('ashcrow', '路开了。走廊还没死。你把「走到这里」写进这一趟，我认。'),
    choice(
      [
        { id: 'A', text: '「把敌人解决掉。别动我们。」' },
        { id: 'B', text: '「今天先留一口气。别赶尽杀绝到自己人。」' },
        { id: 'C', text: '「三票作数。回家。」' },
      ],
      { A: [], B: [], C: [] },
      [
        char('stellar', '明确。', { name: '天音' }),
        char('outercore', '回家的灯还亮着！', { name: '美羽' }),
        char('ashcrow', '行。跟我走——这一趟也一样。'),
      ],
    ),
  ],
};

export const STORY_BEATS: Record<string, StoryBeatDef> = {
  hub_follow: BEAT_HUB_FOLLOW,
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
