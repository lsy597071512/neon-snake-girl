/**
 * 对话现实守卫：检测答非所问 / 地点错乱 / 原句复读。
 *
 * 允许：用 Prompt 提示再让模型重写一轮。
 * 禁止：用程序硬编码台词替换 dialogue / action / inner_thought（违背 AI 角色本质）。
 *
 * 现布局：整包 system + 短 user（千问与 Fable 一致）。
 */
import { CAMP_ROOM_MAP } from '../data/campLayout';
import { captureDialogueSceneSnapshot } from './dialogueSceneSync';
import {
  DIALOGUE_PLANNING_RE,
  inferPresentRoomFromSpeech,
  ROOM_PRESENCE_LEXICON,
} from './dialoguePresence';
import { getRecentChatsForPrompt } from './memory';
import type {
  AiLivingSave,
  DialogueRequest,
  DialogueSceneSnapshot,
  LlmDialogueResult,
} from './types';
import { detectAdultEventContext } from './adultEvents';

export type DialogueRealityIssue =
  | 'exact_repeat'
  | 'stale_scene_speech'
  | 'ignore_location_challenge'
  | 'ignore_player_ask';

/** 非浴室却当「正在洗」说的现在时话术（规划句除外）——并入通用 stale 的强信号 */
const STALE_BATH_PRESENT_RE =
  /水都凉了|水凉了|水温|还在洗|洗着澡|冲着澡|冲澡中|在洗澡|在冲澡|浴室里|裹着(?:浴巾|毛巾)|调试着水温|一起冲澡|去冲澡|去洗澡|胡萝卜徽章|擦干了徽章|冲完澡/;

/** 玩家纠正/质疑地点 */
const PLAYER_LOC_CHALLENGE_RE =
  /你不是在|不是在.{0,10}[吗嘛么]|明明在|人不是在|你人在哪|你在哪(?:里|儿)?|不是在娱乐间|不是在大厅|不是在浴室/;

/** 玩家在认真提问/纠正（非纯应承） */
const PLAYER_ASK_RE =
  /[?？]|吗|嘛|么|是不是|对不对|怎么|为什么|为啥|啥意思|你说|我说|有没有|能不能|可不可以/;

function roomLabel(roomId: string): string {
  const r = CAMP_ROOM_MAP[roomId];
  if (!r) return roomId;
  return r.floor ? `${r.floor}楼·${r.label}` : r.label;
}

export function normalizeDialogueCompareKey(text: string): string {
  return (text || '')
    .trim()
    .toLowerCase()
    .replace(/[？?！!。.\s…~～、，,；;：:「」""''（）()【】\[\]·・]+/g, '')
    .replace(/(.)\1{2,}/g, '$1$1');
}

/** 近乎原句复读（完全相同，或长句高重叠） */
export function isNearDuplicateDialogue(a: string, b: string): boolean {
  const ka = normalizeDialogueCompareKey(a);
  const kb = normalizeDialogueCompareKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.length < 10 || kb.length < 10) return false;
  const shorter = ka.length <= kb.length ? ka : kb;
  const longer = ka.length <= kb.length ? kb : ka;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.82) return true;
  const n = Math.min(28, shorter.length);
  if (n >= 16 && shorter.slice(0, n) === longer.slice(0, n)) return true;
  return sharesLongPhrase(ka, kb, 14);
}

/** 长片段重叠（口头禅/金句半句复读） */
export function sharesLongPhrase(a: string, b: string, minLen = 14): boolean {
  if (!a || !b || a.length < minLen || b.length < minLen) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  for (let i = 0; i <= shorter.length - minLen; i++) {
    const sub = shorter.slice(i, i + minLen);
    if (longer.includes(sub)) return true;
  }
  return false;
}

export function playerChallengesLocation(playerMessage: string): boolean {
  return PLAYER_LOC_CHALLENGE_RE.test(playerMessage || '');
}

export function speechClaimsBathPresent(speech: string): boolean {
  const t = speech || '';
  if (!STALE_BATH_PRESENT_RE.test(t)) return false;
  if (DIALOGUE_PLANNING_RE.test(t) && !/水都凉了|还在洗|冲着澡|洗着澡|浴室里/.test(t)) {
    return false;
  }
  return true;
}

/** @deprecated 兼容旧名；请用 stale_scene 检测 */
export function speechClaimsWrongPresentScene(
  speech: string,
  characterId: string,
  currentRoomId: string,
): boolean {
  if (speechClaimsBathPresent(speech) && currentRoomId !== 'room_1f_bath' && currentRoomId !== 'room_2f_wc') {
    return true;
  }
  const claimed = inferPresentRoomFromSpeech(speech, characterId, currentRoomId);
  if (!claimed.roomId || claimed.holdingCurrent) return false;
  return claimed.roomId !== currentRoomId;
}

function speechMentionsCurrentRoom(speech: string, roomId: string): boolean {
  const lex = ROOM_PRESENCE_LEXICON.find((x) => x.roomId === roomId);
  if (!lex) return false;
  return lex.nouns.test(speech) || lex.doingNow.test(speech);
}

/** 玩家提问里的内容词是否至少被对白轻轻接住（极粗） */
function dialogueTouchesPlayerAsk(
  playerMessage: string,
  dialogue: string,
  extraSpeech = '',
): boolean {
  const speech = `${dialogue || ''}${extraSpeech || ''}`;
  const ask = playerMessage || '';
  // 主题锚：问「敏感点」时，答腰/胸/腿等也算接住（不必复读「敏感」二字）
  if (/敏感/.test(ask) && /敏感|腰|胸|乳|腿|臀|耳|尾|胯|会阴|管道|机油|碰|摸|触/.test(speech)) {
    return true;
  }
  if (/材质|布料|面料|什么做的/.test(ask) && /材质|布|皮|丝|甲|纤维|合成|织物|乳胶|皮革/.test(speech)) {
    return true;
  }

  const askKey = normalizeDialogueCompareKey(ask);
  const ans = normalizeDialogueCompareKey(speech);
  if (!askKey || !ans) return false;
  // 抽 2+ 字中文片段
  const chunks: string[] = [];
  for (let i = 0; i < askKey.length - 1; i++) {
    const c = askKey.slice(i, i + 2);
    if (/[\u4e00-\u9fff]{2}/.test(c)) chunks.push(c);
  }
  const uniq = [...new Set(chunks)].filter(
    (c) => !/你是|不是|什么|怎么|为什|可以|能不能|有没有|我说|你说|一下|给我|知道/.test(c),
  );
  if (!uniq.length) return /听见|听到|问的|说的|在这|在这儿|在这里/.test(dialogue);
  let hits = 0;
  for (const c of uniq.slice(0, 12)) {
    if (ans.includes(c)) hits += 1;
  }
  return hits >= 1;
}

export function detectDialogueRealityIssues(
  living: AiLivingSave,
  req: DialogueRequest,
  result: LlmDialogueResult,
  snap?: DialogueSceneSnapshot | null,
): DialogueRealityIssue[] {
  const turn = req.turnMode ?? 'reply';
  const issues: DialogueRealityIssue[] = [];
  const scene = snap ?? captureDialogueSceneSnapshot(living, req.characterId);
  const speech = `${result.dialogue ?? ''}${result.action ?? ''}${result.inner_thought ?? ''}`;

  const recentAssistant = getRecentChatsForPrompt(living, req.characterId)
    .filter((t) => t.role === 'assistant')
    .map((t) => t.text.trim())
    .filter(Boolean);
  const compareAgainst =
    turn === 'continue' ? recentAssistant.slice(-2) : recentAssistant.slice(-1);
  if (
    result.dialogue?.trim() &&
    compareAgainst.some(
      (prev) =>
        isNearDuplicateDialogue(prev, result.dialogue) ||
        sharesLongPhrase(
          normalizeDialogueCompareKey(prev),
          normalizeDialogueCompareKey(result.dialogue),
          14,
        ),
    )
  ) {
    issues.push('exact_repeat');
  }
  // 守卫自己曾用的地点复读模板：若模型（或上一轮硬钳）又吐出来，视为必须打掉
  if (
    /就在这儿啊[——\-]?.{0,40}别的事先放一边/.test(result.dialogue || '') ||
    /你问的是[「"].+[」"].*我听见了/.test(result.dialogue || '')
  ) {
    issues.push('exact_repeat');
  }

  // 通用：对白声称的「此刻房间」与系统快照不一致（浴室只是其中一类）
  if (
    speechClaimsWrongPresentScene(speech, req.characterId, scene.roomId) ||
    (speechClaimsBathPresent(speech) &&
      scene.roomId !== 'room_1f_bath' &&
      scene.roomId !== 'room_2f_wc')
  ) {
    issues.push('stale_scene_speech');
  }

  if (turn === 'reply' && playerChallengesLocation(req.playerMessage)) {
    const answered =
      speechMentionsCurrentRoom(speech, scene.roomId) ||
      new RegExp(roomLabel(scene.roomId).replace(/[·]/g, '.{0,2}')).test(speech) ||
      /就在这|人在这|我在这|就在这儿|就在这里|这儿啊|这里啊|就在娱乐间|就在大厅|人就在/.test(
        speech,
      );
    if (!answered) {
      issues.push('ignore_location_challenge');
    }
  }

  // 答非所问软检测：用于重试提示；硬钳制不得单凭此项用地点模板盖掉正常 RP
  const touched = dialogueTouchesPlayerAsk(
    req.playerMessage,
    result.dialogue || '',
    `${result.action || ''}${result.inner_thought || ''}`,
  );
  if (
    turn === 'reply' &&
    PLAYER_ASK_RE.test(req.playerMessage || '') &&
    (req.playerMessage || '').trim().length >= 4 &&
    result.dialogue?.trim() &&
    !touched
  ) {
    issues.push('ignore_player_ask');
  }

  return [...new Set(issues)];
}

export function buildDialogueRealityRetryHint(
  living: AiLivingSave,
  req: DialogueRequest,
  issues: DialogueRealityIssue[],
  bannedDialogue?: string,
): string {
  const snap = captureDialogueSceneSnapshot(living, req.characterId);
  const place = snap.presenceLabel || roomLabel(snap.roomId);
  const bits: string[] = [
    '【现实守卫·重写】上一稿不合理，必须整段重写 dialogue（禁止复用旧句）。',
    `此刻身体在「${place}」（room=${snap.roomId}，activity=${snap.activity}）。`,
    '优先级：先答指挥官本轮原话 > 此刻地点外观 > 欲望/未了之事（后两者不得写成假现场）。',
  ];
  if (issues.includes('exact_repeat') && bannedDialogue?.trim()) {
    bits.push(`禁止再输出与这句相同或前半截雷同的对白：「${bannedDialogue.trim().slice(0, 48)}」。`);
  }
  if (issues.includes('stale_scene_speech')) {
    bits.push(
      `禁止假装人在别的房间做事。对白的「正在…」必须属于「${place}」；冲澡/洗澡/武器库点检等其它现场一律禁止（规划意图只写 desire_next）。`,
    );
  }
  if (issues.includes('ignore_location_challenge')) {
    bits.push(
      `指挥官在确认/质疑地点。dialogue 必须先承认人就在「${place}」，再答其它。`,
    );
  } else if (issues.includes('ignore_player_ask')) {
    bits.push(
      `指挥官在提问。dialogue 必须先直接回应「${(req.playerMessage || '').trim().slice(0, 80)}」的内容本身（可用角色声线回答要点），禁止改成报地点或复读原话。`,
    );
  }
  bits.push('want_continue 本轮建议 false。');
  return bits.join('');
}

/**
 * 字段收束（不改写任何对白/动作/心里话）。
 * 产品硬规则：聊天可见文案只能来自模型；禁止程序硬编码台词模板。
 */
export function applyDialogueRealityHardClamp(
  living: AiLivingSave,
  req: DialogueRequest,
  result: LlmDialogueResult,
  issues: DialogueRealityIssue[],
  snapIn?: DialogueSceneSnapshot | null,
): LlmDialogueResult {
  if (!issues.length) return result;
  const snap = snapIn ?? captureDialogueSceneSnapshot(living, req.characterId);
  const inBath =
    snap.activity === 'bathe' ||
    snap.roomId === 'room_1f_bath' ||
    snap.roomId === 'room_2f_wc';

  let desire_next = result.desire_next;
  let bath_intimate_consent = result.bath_intimate_consent;
  let world_intent = result.world_intent;
  let stim_target = result.stim_target;
  let stim_zones = result.stim_zones;
  let stim_intensity = result.stim_intensity;
  let stim_duration = result.stim_duration;
  let adult_odd_mood = result.adult_odd_mood;
  let oil_discharge = result.oil_discharge;

  if (!inBath) {
    bath_intimate_consent = '';
  }

  const adultCtx = detectAdultEventContext({
    living,
    characterId: req.characterId,
    userText: req.playerMessage || '',
    assistantText: `${result.dialogue || ''} ${result.action || ''}`,
  });
  if (!adultCtx.active) {
    stim_target = undefined;
    stim_zones = undefined;
    stim_intensity = undefined;
    stim_duration = undefined;
    adult_odd_mood = undefined;
    oil_discharge = undefined;
  }

  if (
    issues.includes('ignore_location_challenge') ||
    issues.includes('stale_scene_speech') ||
    issues.includes('ignore_player_ask')
  ) {
    // 只收系统意图字段，不碰 dialogue / action / inner_thought
    desire_next = undefined;
    if (world_intent && typeof world_intent === 'object') {
      const mt = world_intent.move_to?.trim() || '';
      if (mt && mt !== snap.roomId) {
        world_intent = { ...world_intent, move_to: snap.roomId || '' };
      }
    }
  }

  console.info(
    `[dialogue-reality] ${req.characterId}: field-clamp only (keep model speech) issues=${issues.join(',')}`,
  );

  return {
    ...result,
    desire_next,
    bath_intimate_consent,
    stim_target,
    stim_zones,
    stim_intensity,
    stim_duration,
    adult_odd_mood,
    oil_discharge,
    world_intent,
  };
}

/** Prompt 侧：玩家纠正地点时的硬提醒 */
export function buildLocationChallengePromptBlock(
  living: AiLivingSave,
  req: DialogueRequest,
): string {
  if ((req.turnMode ?? 'reply') !== 'reply') return '';
  if (!playerChallengesLocation(req.playerMessage)) return '';
  const snap = captureDialogueSceneSnapshot(living, req.characterId);
  const place = snap.presenceLabel || roomLabel(snap.roomId);
  return `【地点纠正·硬规则】指挥官在确认/质疑你的位置。你此刻就在「${place}」。dialogue 必须先承认这个地点，再回答；禁止装傻继续推其它房间的假现场。`;
}

/** Prompt 侧：非当前房间时降权「演错现场」 */
export function buildBathAgendaDemotePromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const snap = captureDialogueSceneSnapshot(living, characterId);
  const place = snap.presenceLabel || roomLabel(snap.roomId);
  return `【场景优先】你此刻在「${place}」。dialogue/action 的现在时现场必须属于这里。其它房间的事（浴室冲澡、武器库点检、大门站岗等）只能写 desire_next 或一句过去/之后，且不得压过指挥官本轮提问。`;
}
