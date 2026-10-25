/**
 * 营地生活面板：角色信息总览 + 全部 AI 调试入口集中于此。
 */
import { playUiSound } from './uiSound';
import { CHARACTER_MAP } from '../data/characters';
import { saveManager } from '../core/SaveManager';
import {
  acceptPendingAiMessage,
  dismissPendingAiMessage,
  getAiLiving,
  peekPendingAiMessages,
  roamIndoor,
  runHeartbeatOnce,
  runPlayerOutreachOnce,
  setPlayerLocation,
  spawnCampEventNow,
  tickWorldOnly,
} from '../ai/livingService';
import { describePendingNpcSeeks } from '../ai/npcOutreach';
import { getSceneCard, resolveSceneCardImage } from '../ai/sceneCards';
import { CAMP_INDOOR_SCENE_ORDER } from '../data/campLayout';
import { resolvePresence } from '../ai/livingState';
import {
  formatGameClock,
  resolveActiveSceneId,
  resolvePeriod,
  resolveWeather,
} from '../ai/worldClock';
import {
  describeAffinity,
  describeRelation,
  getAffinity,
  getRelation,
  listRelationPairs,
} from '../ai/relationship';
import { getRelationshipArc } from '../ai/relationshipArc';
import { listStructuredFacts } from '../ai/structuredFacts';
import { campMoodChip, getMoodSnapshot } from '../ai/moodContinuum';
import { listBondContentUnlocks } from '../systems/AffinityGameplay';
import { getStoredApiKey, hasApiKey, setStoredApiKey } from '../ai/llmClient';
import { runNetworkDiagnostics, summarizeDiagnostics } from '../ai/netDiagnostics';
import {
  getConfiguredChatModel,
  getConfiguredLifeModel,
  getConfiguredSummaryModel,
  MODEL_OPTIONS,
  setConfiguredChatModel,
} from '../ai/modelConfig';
import {
  DEFAULT_COMPAT_BASE_URL,
  DEFAULT_LOCAL_MODEL,
  PROVIDER_OPTIONS,
  applyHomeGpuConfig,
  applyLocalHomeGpuPreset,
  fetchAndApplyHomeGpuConfig,
  forceApplyShippedHomeGpuConfig,
  getChatProvider,
  getCompatApiKey,
  getCompatBaseUrl,
  getCompatModel,
  isLocalGpuEnabled,
  parseHomeGpuConfigJson,
  setChatProvider,
  setCompatApiKey,
  setCompatBaseUrl,
  setCompatModel,
  type AiChatProviderId,
} from '../ai/providerConfig';
import { AI_STATUS_ICON, stateIcon } from '../ai/assets';
import { showAiDialogue } from './aiDialogueOverlay';
import { showCampWarehousePanel } from './campWarehousePanel';
import { isCampItemLogText } from '../systems/CampWarehouseSystem';
import { listDialogueArchive } from '../ai/dialogueArchive';
import { listActiveCampEventsForUi, stanceLabel } from '../ai/campEvents';
import { getAgenda, isAgendaActive } from '../ai/characterAgenda';
import { getPersona, personaLabel } from '../ai/characterPersona';
import { ensureLifeGoal } from '../ai/lifeGoals';
import { buildLiveCharacterSnapshot } from '../ai/characterLiveSnapshot';
import {
  getCyberHealth,
  listOpenCyberEvents,
  repairCyberHealth,
  seedCyberHealthForOwned,
  tryRollCyberHealthEvents,
  adjustedCyberEventChance,
  applyCombatCyberWear,
  applyCyberAgingByDayIndex,
  CYBER_AGING_DAYS,
} from '../systems/CyberHealthSystem';
import { texUrl } from '../utils/texUrl';
import {
  clearDialogueVoiceSession,
  formatProsody,
  getCharacterVoiceProfile,
  getVoiceWorkspaceId,
  isVoiceEnabled,
  listCharacterVoiceProfiles,
  QWEN_AUDIO_TTS_MODEL,
  resetVoiceIdentities,
  resolveQwenProsody,
  setVoiceEnabled,
  setVoiceWorkspaceId,
  speakDialogue,
} from '../ai/voice';
import type { AiMessageEvent, CampEventReactionKind } from '../ai/types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function kindLabel(kind: AiMessageEvent['kind']): string {
  switch (kind) {
    case 'ask_help':
      return '求助';
    case 'share':
      return '分享';
    case 'invite':
      return '邀请';
    case 'vent':
      return '倾诉';
    case 'report':
      return '汇报';
    default:
      return '闲聊';
  }
}

function activityLabel(act: string | null | undefined): string {
  const map: Record<string, string> = {
    idle: '闲着',
    busy: '忙碌',
    talking: '交谈',
    sleeping: '睡觉',
    patrol: '巡逻',
    maintain: '维护',
    rest: '歇息',
    play: '玩乐',
    bathe: '洗浴',
    eat: '用餐',
    guard: '守门',
  };
  return act ? map[act] ?? act : '—';
}

function fmtTs(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function traitBar(label: string, value: number): string {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return `<div class="cl-trait"><span>${escapeHtml(label)}</span><div class="cl-trait-track"><i style="width:${v}%"></i></div><b>${v}</b></div>`;
}

type PanelTab = 'chars' | 'events' | 'relations' | 'logs' | 'api';

export type CampLivingOptions = {
  onChanged?: () => void;
};

export function showCampLivingPanel(opts: CampLivingOptions = {}): void {
  document.querySelector('[data-camp-living-panel]')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'camp-living-overlay';
  overlay.dataset.campLivingPanel = 'true';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '营地生活');

  let activeTab: PanelTab = 'chars';
  let expandedIds = new Set<string>();
  let statusNote = '';

  const setNote = (text: string) => {
    statusNote = text;
    const el = overlay.querySelector('[data-cl-note]');
    if (el) el.textContent = text;
  };

  const render = () => {
    tickWorldOnly();
    const save = saveManager.get();
    const living = getAiLiving();
    const sceneId = resolveActiveSceneId(living);
    const scene = getSceneCard(sceneId);
    const owned = save.ownedCharacters.map((c) => c.characterId);
    const pendingMsgs = peekPendingAiMessages();
    const npcSeeks = describePendingNpcSeeks(living);
    const activeEvents = listActiveCampEventsForUi(living);

    const charCards = owned
      .map((id) => {
        const def = CHARACTER_MAP[id];
        const p = resolvePresence(id, living);
        const aff = getAffinity(living, id);
        const agenda = getAgenda(living, id);
        const persona = getPersona(living, id);
        const lifeGoal = ensureLifeGoal(living, id);
        const lifeGoalPct = Math.min(
          100,
          Math.round((lifeGoal.progress / Math.max(1, lifeGoal.target)) * 100),
        );
        const snap = buildLiveCharacterSnapshot(id, save, living);
        seedCyberHealthForOwned(living, owned);
        const cyberHp = getCyberHealth(living, id);
        const cyberOpen = listOpenCyberEvents(living).find((e) => e.characterId === id);
        const cyberChance = Math.round(adjustedCyberEventChance(living, id) * 100);
        const arc = getRelationshipArc(living, id);
        const facts = listStructuredFacts(living, id).slice(0, 8);
        const bondRows = listBondContentUnlocks(aff);
        const moodChip = campMoodChip(living, id);
        const moodSnap = getMoodSnapshot(living, id);
        const stats = living.aiMessageStats?.[id];
        const pending = pendingMsgs.find((m) => m.characterId === id);
        const mems = (living.memories?.[id] ?? []).slice(0, 4);
        const digests = (living.chatDigests?.[id] ?? []).slice(-3);
        const lastTalk = living.lastTalkAt?.[id] ?? 0;
        const statusSrc =
          AI_STATUS_ICON[
            p.activity === 'busy' ? 'busy' : p.activity === 'talking' ? 'talking' : 'idle'
          ];
        const tags = p.statusTags
          .map((t) => `<img class="ai-state-icon" src="${stateIcon(t)}" alt="${t}" title="${t}" />`)
          .join('');
        const expanded = expandedIds.has(id);
        const portrait = texUrl(snap?.portraitFront || def?.portraitFront || def?.icon || '');

        const topRelations = owned
          .filter((oid) => oid !== id)
          .map((oid) => ({
            oid,
            score: getRelation(living, id, oid),
            name: CHARACTER_MAP[oid]?.name ?? oid,
          }))
          .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
          .slice(0, 4)
          .map(
            (r) =>
              `<span class="cl-pill${r.score < 0 ? ' is-neg' : ''}">${escapeHtml(r.name)} ${r.score}·${escapeHtml(describeRelation(r.score))}</span>`,
          )
          .join('');

        return `
          <article class="cl-char${expanded ? ' is-open' : ''}${pending ? ' has-msg' : ''}" data-char-card="${id}">
            <button type="button" class="cl-char-summary" data-toggle-char="${id}">
              <img class="cl-char-avatar" src="${portrait}" alt="" />
              <div class="cl-char-main">
                <div class="cl-char-row1">
                  <img class="cl-status-ico" src="${statusSrc}" alt="" />
                  <strong>${escapeHtml(def?.name ?? id)}</strong>
                  <span class="cl-rarity">${escapeHtml(snap?.rarity ?? '')}</span>
                  ${pending ? '<span class="cl-badge-msg">来信</span>' : ''}
                </div>
                <div class="cl-char-row2">
                  <span>好感 <b>${aff}</b>·${escapeHtml(describeAffinity(aff))}</span>
                  <span>弧线 <b>${escapeHtml(arc.labelZh)}</b></span>
                  <span class="cl-mood${moodSnap.valence <= -35 ? ' is-low' : moodSnap.valence >= 40 ? ' is-high' : ''}" title="情绪连续体：${escapeHtml(moodSnap.labelZh)}（愉悦 ${moodSnap.valence}｜唤醒 ${moodSnap.arousal}）">心情 <b>${escapeHtml(moodChip)}</b></span>
                  <span>战力 <b>${snap?.power ?? '—'}</b></span>
                  <span>义体健康 <b class="${cyberHp <= 9 ? 'is-neg' : ''}">${cyberHp}</b>${cyberOpen ? '⚠' : ''}</span>
                  <span>${escapeHtml(activityLabel(p.activity))}</span>
                </div>
                <div class="cl-char-row3">${escapeHtml(p.label)} · ${escapeHtml(p.behavior)}</div>
              </div>
              <span class="cl-char-chevron">${expanded ? '▾' : '▸'}</span>
            </button>
            ${
              expanded
                ? `<div class="cl-char-detail">
              <div class="cl-detail-grid">
                <div class="cl-kv"><span>年龄/身高</span><b>${escapeHtml(snap?.age ?? '—')} / ${escapeHtml(snap?.height ?? '—')}</b></div>
                <div class="cl-kv"><span>三围</span><b>${escapeHtml(snap?.measurements ?? '—')}</b></div>
                <div class="cl-kv"><span>性格</span><b>${escapeHtml(snap?.personality ?? '—')}</b></div>
                <div class="cl-kv"><span>职业 tag</span><b>${escapeHtml(snap?.tag ?? '—')}</b></div>
                <div class="cl-kv"><span>武装</span><b>${escapeHtml(snap?.weaponName ?? '无')}</b></div>
                <div class="cl-kv"><span>皮肤</span><b>${escapeHtml(snap?.activeSkinName ?? '默认')}</b></div>
                <div class="cl-kv"><span>礼物次数</span><b>${snap?.giftCount ?? 0}</b></div>
                <div class="cl-kv"><span>房间 id</span><b>${escapeHtml(p.roomId)}</b></div>
                <div class="cl-kv"><span>场景卡</span><b>${escapeHtml(p.locationId)}</b></div>
                <div class="cl-kv"><span>上次对话</span><b>${escapeHtml(fmtTs(lastTalk))}</b></div>
                <div class="cl-kv"><span>未回消息连击</span><b>${stats?.unansweredCount ?? 0}</b></div>
                <div class="cl-kv"><span>上次主动发信</span><b>${escapeHtml(fmtTs(stats?.lastOutreachAt ?? 0))}</b></div>
                <div class="cl-kv"><span>上次被回应</span><b>${escapeHtml(fmtTs(stats?.lastRespondedAt ?? 0))}</b></div>
                <div class="cl-kv"><span>义体健康</span><b class="${cyberHp <= 9 ? 'is-neg' : ''}">${cyberHp}/100 · 告警率约 ${cyberChance}%</b></div>
                <div class="cl-kv"><span>义体告警</span><b>${cyberOpen ? escapeHtml(cyberOpen.note) : '无'}</b></div>
                <div class="cl-kv"><span>状态标签</span><b class="cl-tags">${tags || '无'} ${escapeHtml(p.statusTags.join(' ') || '')}</b></div>
                <div class="cl-kv"><span>Qwen 音色</span><b>${escapeHtml(getCharacterVoiceProfile(id).voiceLabel)}</b></div>
                <div class="cl-kv"><span>语音基线</span><b>${escapeHtml(formatProsody(getCharacterVoiceProfile(id).base))}</b></div>
              </div>

              <div class="cl-block">
                <h4>今日人格</h4>
                <p>模式：<b>${escapeHtml(personaLabel(persona.dayMode))}</b> · 心情：${escapeHtml(persona.moodNote || '—')}</p>
                <p>连续体：<b>${escapeHtml(moodSnap.labelZh)}</b>（愉悦 ${moodSnap.valence} / 唤醒 ${moodSnap.arousal}）</p>
                <p>计划：${escapeHtml(persona.dayPlan || '—')}</p>
                <p>talkStreak <b>${persona.talkStreak}</b> · dayIndex ${persona.dayIndex}</p>
                <div class="cl-traits">
                  ${traitBar('职责 duty', persona.traits.duty)}
                  ${traitBar('温暖 warmth', persona.traits.warmth)}
                  ${traitBar('玩心 play', persona.traits.play)}
                  ${traitBar('谨慎 caution', persona.traits.caution)}
                </div>
              </div>

              <div class="cl-block">
                <h4>人生目标</h4>
                <p>${escapeHtml(lifeGoal.text)}</p>
                <p>进度 <b>${lifeGoalPct}%</b> · 类型 ${escapeHtml(lifeGoal.kind)}</p>
              </div>

              <div class="cl-block">
                <h4>当前意图</h4>
                ${
                  isAgendaActive(agenda) && agenda
                    ? `<p><b>${escapeHtml(agenda.reason)}</b></p>
                       <p>${escapeHtml(agenda.behavior)} → ${escapeHtml(agenda.targetRoomId)}</p>
                       <p>活动 ${escapeHtml(agenda.activity)} · 来源 ${escapeHtml(agenda.source)} · 剩余 <b>${agenda.remainGameMin}</b> 游戏分
                       ${agenda.eventStance ? ` · 姿态 ${escapeHtml(agenda.eventStance)}` : ''}
                       ${agenda.eventInstanceId ? ` · 事件 ${escapeHtml(agenda.eventInstanceId)}` : ''}</p>`
                    : '<p class="camp-living-hint">暂无活跃意图</p>'
                }
              </div>

              <div class="cl-block">
                <h4>对其他角色关系（Top）</h4>
                <div class="cl-pill-row">${topRelations || '<span class="camp-living-hint">—</span>'}</div>
              </div>

              <div class="cl-block">
                <h4>关系弧 · 羁绊兑现</h4>
                <p>阶段 <b>${escapeHtml(arc.labelZh)}</b>（${escapeHtml(arc.id)}）· 好自由度：${escapeHtml(arc.topicFreedom)}</p>
                <ul class="cl-mini-list">${bondRows
                  .map(
                    (r) =>
                      `<li class="${r.unlocked ? '' : 'is-muted'}">${r.unlocked ? '✓' : '·'} ${escapeHtml(r.label)}${
                        r.unlocked ? '' : `（需 ${r.needAffinity}）`
                      }</li>`,
                  )
                  .join('')}</ul>
              </div>

              <div class="cl-block">
                <h4>结构化事实表</h4>
                <ul class="cl-mini-list">${
                  facts.length
                    ? facts
                        .map(
                          (f) =>
                            `<li>[${escapeHtml(f.kind)}·${f.importance}] ${escapeHtml(f.text)}</li>`,
                        )
                        .join('')
                    : '<li>无（对话约定/称呼/memory_write 会写入）</li>'
                }</ul>
              </div>

              <div class="cl-block">
                <h4>近期记忆</h4>
                <ul class="cl-mini-list">${
                  mems.length
                    ? mems
                        .map(
                          (m) =>
                            `<li>[${escapeHtml(m.kind)}·${m.importance}] ${escapeHtml(m.summary)}</li>`,
                        )
                        .join('')
                    : '<li>无</li>'
                }</ul>
              </div>

              <div class="cl-block">
                <h4>对话 digest</h4>
                <ul class="cl-mini-list">${
                  digests.length
                    ? digests.map((d) => `<li>${escapeHtml(d)}</li>`).join('')
                    : '<li>无</li>'
                }</ul>
              </div>

              ${
                pending
                  ? `<div class="cl-block cl-pending-msg">
                <h4>待处理来信 · ${kindLabel(pending.kind)} · 分量 ${pending.significance}</h4>
                <p>${escapeHtml(pending.preview)}</p>
                <p class="camp-living-hint">${escapeHtml(pending.reason)}</p>
                <div class="cl-actions">
                  <button type="button" class="btn btn-primary btn-sm" data-open-msg="${pending.messageId}">打开对话</button>
                  <button type="button" class="btn btn-secondary btn-sm" data-dismiss-msg="${pending.messageId}">忽略</button>
                </div>
              </div>`
                  : ''
              }

              <div class="cl-actions">
                <button type="button" class="btn btn-primary btn-sm" data-talk-btn="${id}">对话</button>
                <button type="button" class="btn btn-secondary btn-sm" data-force-msg="${id}">强制来信</button>
                <button type="button" class="btn btn-secondary btn-sm" data-char-wh="${id}">仓库·义体</button>
                <button type="button" class="btn btn-secondary btn-sm" data-repair-cyber="${id}">免费修义体</button>
              </div>
            </div>`
                : ''
            }
          </article>`;
      })
      .join('');

    const eventRows = activeEvents.length
      ? activeEvents
          .map((e) => {
            const parts = e.participants
              .slice(0, 10)
              .map(
                (p) =>
                  `${escapeHtml(p.name)}·${escapeHtml(stanceLabel(p.reaction as CampEventReactionKind))}${p.inCoScreen ? '·同屏' : ''}`,
              )
              .join('；');
            return `<li>
              <strong>${escapeHtml(e.name)}</strong>
              <span class="camp-living-hint"> ${escapeHtml(e.defId)} · ${escapeHtml(e.phaseLabel)} · 剩${e.remainGameMin}分 · ${escapeHtml(e.focusLabel)}</span>
              ${parts ? `<br/><span class="camp-living-hint">${parts}</span>` : ''}
              ${
                e.coScreenActive
                  ? `<br/><span class="camp-living-hint">同屏 ${e.coScreenIds.length}人${e.topic ? ` ·「${escapeHtml(e.topic)}」` : ''}</span>`
                  : ''
              }
            </li>`;
          })
          .join('')
      : '<li>暂无进行中事件</li>';

    const msgRows = pendingMsgs.length
      ? pendingMsgs
          .map((m) => {
            const name = CHARACTER_MAP[m.characterId]?.name ?? m.characterId;
            const remain = Math.max(0, Math.ceil((m.expiresAt - Date.now()) / 1000));
            return `<li class="cl-msg-row">
              <div>
                <strong>${escapeHtml(name)}</strong> · ${kindLabel(m.kind)} · 分量${m.significance} · ${remain}s
                <div>${escapeHtml(m.preview)}</div>
                <div class="camp-living-hint">${escapeHtml(m.reason)}</div>
              </div>
              <div class="cl-actions">
                <button type="button" class="btn btn-primary btn-sm" data-open-msg="${m.messageId}">打开</button>
                <button type="button" class="btn btn-secondary btn-sm" data-dismiss-msg="${m.messageId}">忽略</button>
              </div>
            </li>`;
          })
          .join('')
      : '<li>暂无待处理主动消息</li>';

    const seekRows = npcSeeks.length
      ? npcSeeks.map((s) => `<li>${escapeHtml(s)}</li>`).join('')
      : '<li>暂无跨房寻找</li>';

    const hist = (living.eventHistory ?? [])
      .slice(0, 8)
      .map(
        (h) =>
          `<li>${escapeHtml(h.summary)}${h.goldDelta ? `（锈币${h.goldDelta > 0 ? '+' : ''}${h.goldDelta}）` : ''} <span class="camp-living-hint">${escapeHtml(h.defId)}</span></li>`,
      )
      .join('');

    const relPairs = listRelationPairs(living, owned);
    const relRows = relPairs.length
      ? relPairs
          .map((r) => {
            const na = CHARACTER_MAP[r.a]?.name ?? r.a;
            const nb = CHARACTER_MAP[r.b]?.name ?? r.b;
            const cls = r.score < 0 ? ' is-neg' : '';
            return `<li><span>${escapeHtml(na)} ↔ ${escapeHtml(nb)} · ${escapeHtml(r.label)}</span><span class="camp-living-rel-score${cls}">${r.score}</span></li>`;
          })
          .join('')
      : '<li>暂无（拥有 ≥2 角色后显示）</li>';

    const logs = living.campLog
      .slice(0, 20)
      .map((l) => {
        const itemCls = isCampItemLogText(l.text) ? ' is-item-log' : '';
        return `<li class="camp-log-line${itemCls}"><span class="camp-living-hint">[${escapeHtml(l.source)}]</span> ${escapeHtml(l.text)}</li>`;
      })
      .join('');

    const indoorBtns = CAMP_INDOOR_SCENE_ORDER.map((id) => getSceneCard(id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map(
        (c) =>
          `<button type="button" class="btn btn-secondary btn-sm${living.playerLocationId === c.id ? ' is-on' : ''}" data-goto-loc="${c.id}">${escapeHtml(c.label)}</button>`,
      )
      .join('');

    const tabBtn = (id: PanelTab, label: string, badge?: number) =>
      `<button type="button" class="cl-tab${activeTab === id ? ' is-on' : ''}" data-tab="${id}">${label}${
        badge != null && badge > 0 ? `<span class="cl-tab-badge">${badge}</span>` : ''
      }</button>`;

    let tabBody = '';
    if (activeTab === 'chars') {
      tabBody = `
        <div class="cl-tab-body">
          <div class="cl-toolbar">
            <span class="camp-living-hint">点击角色展开数值与调试 · 共 ${owned.length} 人</span>
            <button type="button" class="btn btn-secondary btn-sm" data-expand-all>全部展开</button>
            <button type="button" class="btn btn-secondary btn-sm" data-collapse-all>全部收起</button>
          </div>
          <div class="cl-char-list">${charCards || '<p>暂无角色</p>'}</div>
        </div>`;
    } else if (activeTab === 'events') {
      tabBody = `
        <div class="cl-tab-body">
          <section class="cl-sec">
            <h3>进行中事件</h3>
            <ul class="cl-list">${eventRows}</ul>
          </section>
          <section class="cl-sec">
            <h3>主动消息队列</h3>
            <ul class="cl-list">${msgRows}</ul>
          </section>
          <section class="cl-sec">
            <h3>NPC 跨房寻找</h3>
            <ul class="cl-list">${seekRows}</ul>
          </section>
          <section class="cl-sec">
            <h3>最近事件结算</h3>
            <ul class="cl-list">${hist || '<li>暂无</li>'}</ul>
          </section>
        </div>`;
    } else if (activeTab === 'relations') {
      tabBody = `
        <div class="cl-tab-body">
          <section class="cl-sec">
            <h3>角色间关系网 <span class="camp-living-hint">${relPairs.length} 对</span></h3>
            <ul class="camp-living-rel-grid">${relRows}</ul>
          </section>
        </div>`;
    } else if (activeTab === 'logs') {
      tabBody = `
        <div class="cl-tab-body">
          <section class="cl-sec">
            <h3>营地日志</h3>
            <ul class="cl-list">${logs || '<li>暂无</li>'}</ul>
          </section>
          <section class="cl-sec">
            <h3>永久对话档案 <span class="camp-living-hint">IndexedDB · 不耗 token</span></h3>
            <button type="button" class="btn btn-secondary btn-sm" data-load-archive>加载最近 40 条</button>
            <ul class="cl-list" data-archive-list><li>点击上方按钮查看</li></ul>
          </section>
        </div>`;
    } else {
      const voiceRows = listCharacterVoiceProfiles()
        .map((vp) => {
          const n = CHARACTER_MAP[vp.characterId]?.name ?? vp.characterId;
          const sample = resolveQwenProsody({
            characterId: vp.characterId,
            text: '',
            emotion: 'joy',
          });
          return `<li>
            <strong>${escapeHtml(n)}</strong>
            <span class="camp-living-hint"> ${escapeHtml(vp.voiceLabel)}</span><br/>
            <span class="camp-living-hint">${escapeHtml(vp.voice)}</span><br/>
            <span class="camp-living-hint">基线 ${escapeHtml(formatProsody(vp.base))} · 情感增益×${vp.emotionGain} · joy例 ${escapeHtml(formatProsody(sample))}</span><br/>
            <span class="camp-living-hint">${escapeHtml(vp.reason)}</span>
            <button type="button" class="btn btn-secondary btn-sm" data-tts-sample="${vp.characterId}">试听</button>
          </li>`;
        })
        .join('');

      tabBody = `
        <div class="cl-tab-body">
          <section class="cl-sec camp-living-api">
            <h3>语音 · Qwen-Audio-TTS</h3>
            <label class="cl-check">
              <input type="checkbox" data-voice-enabled ${isVoiceEnabled() ? 'checked' : ''} />
              启用语音能力（麦克风说话→角色语音回复；打字→纯文字）
            </label>
            <p class="camp-living-hint">模型：${escapeHtml(QWEN_AUDIO_TTS_MODEL)}（Qwen-Audio-TTS·支持人设指令） · 与对话共用 Qwen API Key（百炼）。失败时自动退回旧通道/系统朗读。</p>
            <p class="camp-living-hint">ASR：有 Key → 百炼识别；无 Key 时系统语音识别（国内机可能报错）。TTS 不再使用 Edge 免费音色。</p>
            <p class="camp-living-hint">每位角色独立基础/系统音色，偏年轻女孩；再用语速音高 + instruction 拉开人设。</p>
            <label class="cl-field">百炼业务空间 ID（可选；Qwen-Audio-TTS 专属域名用）
              <input type="text" data-voice-workspace placeholder="留空则用通用 dashscope 域名" value="${escapeHtml(getVoiceWorkspaceId())}" />
            </label>
            <button type="button" class="btn btn-secondary btn-sm" data-voice-workspace-save>保存业务空间 ID</button>
            <button type="button" class="btn btn-secondary btn-sm" data-voice-reset-lock>重置音色锁定</button>
            <p class="camp-living-hint">每个角色首次出声后即锁定"通道+声线"，之后只允许同一声线重试，绝不中途换人（宁可这一句静音）。改完音色配置可点此解锁一次。</p>
            <h4>13 人音色表</h4>
            <ul class="cl-list cl-voice-list">${voiceRows}</ul>
          </section>
          <section class="cl-sec camp-living-api">
            <h3>模型 / API</h3>
            ${
              isLocalGpuEnabled()
                ? `<label>对话 Provider（默认千问；可切本机 Fable Q4 做 A/B）
              <select data-provider-select>
                ${PROVIDER_OPTIONS.map(
                  (o) =>
                    `<option value="${o.id}"${o.id === getChatProvider() ? ' selected' : ''}>${escapeHtml(o.label)} — ${escapeHtml(o.note)}</option>`,
                ).join('')}
              </select>
            </label>`
                : ''
            }
            ${
              getChatProvider() === 'dashscope' || !isLocalGpuEnabled()
                ? `<label>千问对话模型（当前 ${escapeHtml(getConfiguredChatModel())}）
              <select data-model-select>
                ${MODEL_OPTIONS.map(
                  (o) =>
                    `<option value="${o.id}"${o.id === getConfiguredChatModel() ? ' selected' : ''}>${escapeHtml(o.label)} — ${escapeHtml(o.note)}</option>`,
                ).join('')}
              </select>
            </label>
            <p class="camp-living-hint">离线摘要：${escapeHtml(getConfiguredSummaryModel())} · 生活路径：${escapeHtml(getConfiguredLifeModel())}（DashScope）</p>
            <label>Qwen API Key（阿里云百炼 · 对话/生活/语音）
              <input type="password" data-api-key placeholder="${hasApiKey() ? '已保存（可覆盖）' : 'sk-…'}" value="" />
            </label>
            <button type="button" class="btn btn-secondary btn-sm" data-save-key>保存 Qwen Key</button>
            <button type="button" class="btn btn-secondary btn-sm" data-net-diag>网络自检</button>
            <p class="camp-living-hint">默认方案保留 qwen-plus-character；Key 只存在本机。连不上千问时点「网络自检」，会区分是断网、还是千问域名解析失败。</p>`
                : `            <p class="camp-living-hint">外地测试：电脑保持 <code>Ollama</code> + Cloudflare 隧道（或 <code>npm run start:remote-gpu</code>）。点下面按钮会<strong>自动填好 Base URL / 模型</strong>，不用手填高级。</p>
            <div class="camp-living-nav" style="flex-wrap:wrap;gap:8px;margin:8px 0">
              <button type="button" class="btn btn-primary btn-sm" data-gpu-local>① 一键启用本机 Fable Q4</button>
              <button type="button" class="btn btn-secondary btn-sm" data-gpu-import-file>② 导入 PC 配置</button>
              <button type="button" class="btn btn-primary btn-sm" data-gpu-remote>外地 · 远程地址</button>
              <button type="button" class="btn btn-secondary btn-sm" data-gpu-lan>同 WiFi · 局域网</button>
              <button type="button" class="btn btn-info btn-sm" data-gpu-cloudflare>🌐 Cloudflare 远程</button>
              <button type="button" class="btn btn-secondary btn-sm" data-gpu-tailscale>Tailscale 远程</button>
              <button type="button" class="btn btn-secondary btn-sm" data-test-compat>③ 测试连接</button>
            </div>
            <label class="cl-check"><input type="checkbox" data-gpu-advanced checked /> 高级（已自动填写，可核对）</label>
            <div data-gpu-advanced-panel>
            <label>Base URL
              <input type="text" data-compat-base placeholder="${escapeHtml(DEFAULT_COMPAT_BASE_URL)}" value="${escapeHtml(getCompatBaseUrl())}" />
            </label>
            <label>模型名
              <input type="text" data-compat-model placeholder="${escapeHtml(DEFAULT_LOCAL_MODEL)}" value="${escapeHtml(getCompatModel())}" />
            </label>
            <label>Bearer（无密钥填 ollama）
              <input type="password" data-compat-key placeholder="已保存可覆盖" value="" />
            </label>
            <button type="button" class="btn btn-secondary btn-sm" data-save-compat>保存手动设置</button>
            <label>粘贴 home-gpu-config.json（备用）
              <textarea data-gpu-json rows="3" placeholder='{"model":"fable-q4:latest",...}'></textarea>
            </label>
            <button type="button" class="btn btn-secondary btn-sm" data-gpu-paste>从粘贴内容启用</button>
            </div>
            <label>Qwen API Key（可选 · 生活/语音）
              <input type="password" data-api-key placeholder="${hasApiKey() ? '已保存（可覆盖）' : 'sk-…'}" value="" />
            </label>
            <button type="button" class="btn btn-secondary btn-sm" data-save-key>保存 Qwen Key</button>
            <button type="button" class="btn btn-secondary btn-sm" data-net-diag>网络自检</button>
            <p class="camp-living-hint">当前：${escapeHtml(getCompatModel())} @ ${escapeHtml(getCompatBaseUrl())}</p>`
            }
          </section>
          <section class="cl-sec">
            <h3>场景导航（调试）</h3>
            <div class="camp-living-nav">
              <button type="button" class="btn btn-secondary btn-sm" data-goto-map1>一楼平面</button>
              <button type="button" class="btn btn-secondary btn-sm" data-goto-map2>二楼平面</button>
              <button type="button" class="btn btn-secondary btn-sm" data-goto-hall>回大厅1</button>
              <button type="button" class="btn btn-secondary btn-sm" data-roam-prev>← 上一室</button>
              <button type="button" class="btn btn-secondary btn-sm" data-roam-next>下一室 →</button>
            </div>
            <div class="camp-living-indoor-btns">${indoorBtns}</div>
          </section>
          <section class="cl-sec">
            <h3>运行时数值</h3>
            <ul class="cl-list">
              <li>gameMinutes <b>${living.gameMinutes}</b> · dayIndex <b>${living.dayIndex}</b></li>
              <li>时间流速：现实1分钟 ≈ 游戏5分钟（一天约288现实分钟）</li>
              <li>playerLocation <b>${escapeHtml(living.playerLocationId)}</b></li>
              <li>lastNpcEventAt <b>${escapeHtml(fmtTs(living.lastNpcEventAt))}</b></li>
              <li>lastPlayerOutreachEvalAt <b>${escapeHtml(fmtTs(living.lastPlayerOutreachEvalAt ?? 0))}</b></li>
              <li>lastCampEventSpawnGameMin <b>${living.lastCampEventSpawnGameMin ?? 0}</b></li>
              <li>pendingAiMessages <b>${pendingMsgs.length}</b> · pendingNpcSeeks <b>${npcSeeks.length}</b> · activeEvents <b>${activeEvents.length}</b></li>
              <li>Qwen Key ${hasApiKey() ? '✓' : '✗'}（对话/生活/语音共用）</li>
            </ul>
          </section>
        </div>`;
    }

    overlay.innerHTML = `
      <div class="camp-living-panel cl-panel-wide">
        <header class="camp-living-head">
          <div>
            <h2>营地生活</h2>
            <p class="camp-living-clock">${escapeHtml(formatGameClock(living))} · ${resolvePeriod(living)} / ${resolveWeather(living)}</p>
            <p class="camp-living-scene">场景：${escapeHtml(scene?.label ?? sceneId)} · 角色 ${owned.length} · 消息 ${pendingMsgs.length} · 事件 ${activeEvents.length}</p>
            <p class="cl-status-note" data-cl-note>${escapeHtml(statusNote)}</p>
          </div>
          <div class="cl-head-right">
            <div class="cl-head-preview">
              <img src="${texUrl(scene ? resolveSceneCardImage(scene, resolvePeriod(living)) : './tex/beijing01.png')}" alt="" />
            </div>
            <button type="button" class="btn btn-secondary" data-camp-close>关闭</button>
          </div>
        </header>

        <section class="cl-debug-bar" aria-label="AI 调试">
          <span class="cl-debug-label">调试</span>
          <button type="button" class="btn btn-secondary btn-sm" data-heartbeat>推进心跳</button>
          <button type="button" class="btn btn-primary btn-sm" data-open-camp-wh>仓库商店</button>
          <button type="button" class="btn btn-secondary btn-sm" data-force-outreach>强制主动消息</button>
          <button type="button" class="btn btn-secondary btn-sm" data-spawn-event>刷随机事件</button>
          <button type="button" class="btn btn-secondary btn-sm" data-spawn-chat>刷闲聊小聚</button>
          <button type="button" class="btn btn-secondary btn-sm" data-spawn-pool>刷泳池派对</button>
          <button type="button" class="btn btn-secondary btn-sm" data-spawn-party>刷娱乐局</button>
          <button type="button" class="btn btn-secondary btn-sm" data-spawn-celeb>刷小庆祝</button>
          <button type="button" class="btn btn-secondary btn-sm" data-tick-world>推进时钟</button>
          <button type="button" class="btn btn-secondary btn-sm" data-roll-cyber>掷义体告警</button>
          <button type="button" class="btn btn-secondary btn-sm" data-wear-cyber>全员战斗磨损-1</button>
          <button type="button" class="btn btn-secondary btn-sm" data-age-cyber>强制老化结算</button>
          <button type="button" class="btn btn-secondary btn-sm" data-repair-all-cyber>全员义体修复</button>
          <button type="button" class="btn btn-secondary btn-sm" data-refresh-panel>刷新面板</button>
        </section>

        <nav class="cl-tabs" aria-label="分区">
          ${tabBtn('chars', '角色信息')}
          ${tabBtn('events', '事件·消息', pendingMsgs.length + activeEvents.length)}
          ${tabBtn('relations', '关系网')}
          ${tabBtn('logs', '日志·档案')}
          ${tabBtn('api', 'API·数值')}
        </nav>

        ${tabBody}
      </div>
    `;

    overlay.querySelector('[data-camp-close]')?.addEventListener('click', () => {
      playUiSound('cancel');
      overlay.remove();
      opts.onChanged?.();
    });

    overlay.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = ((btn as HTMLElement).dataset.tab as PanelTab) || 'chars';
        playUiSound('tap');
        render();
      });
    });

    overlay.querySelector('[data-expand-all]')?.addEventListener('click', () => {
      expandedIds = new Set(owned);
      playUiSound('tap');
      render();
    });
    overlay.querySelector('[data-collapse-all]')?.addEventListener('click', () => {
      expandedIds = new Set();
      playUiSound('tap');
      render();
    });

    overlay.querySelectorAll('[data-toggle-char]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.toggleChar!;
        if (expandedIds.has(id)) expandedIds.delete(id);
        else expandedIds.add(id);
        playUiSound('tap');
        render();
      });
    });

    overlay.querySelector('[data-heartbeat]')?.addEventListener('click', () => {
      playUiSound('tap');
      setNote('心跳执行中…');
      void runHeartbeatOnce().then(() => {
        setNote('心跳完成');
        render();
        opts.onChanged?.();
      });
    });
    overlay.querySelector('[data-open-camp-wh]')?.addEventListener('click', () => {
      playUiSound('tap');
      showCampWarehousePanel({
        onChanged: () => {
          render();
          opts.onChanged?.();
        },
      });
    });
    overlay.querySelector('[data-force-outreach]')?.addEventListener('click', () => {
      playUiSound('confirm');
      setNote('正在评估主动消息…');
      void runPlayerOutreachOnce({ bypassCooldown: true }).then((r) => {
        setNote(`主动消息：${r.kind}${r.detail ? ` · ${r.detail}` : ''}`);
        activeTab = 'events';
        render();
        opts.onChanged?.();
      });
    });
    overlay.querySelector('[data-spawn-event]')?.addEventListener('click', () => {
      playUiSound('confirm');
      const id = spawnCampEventNow();
      setNote(id ? `刷出事件 ${id}` : '未刷出事件');
      activeTab = 'events';
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-spawn-chat]')?.addEventListener('click', () => {
      playUiSound('confirm');
      spawnCampEventNow('npc_multi_chat');
      setNote('刷闲聊小聚');
      activeTab = 'events';
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-spawn-pool]')?.addEventListener('click', () => {
      playUiSound('confirm');
      spawnCampEventNow('pool_party');
      setNote('刷泳池派对（有泳装资源者会换装）');
      activeTab = 'events';
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-spawn-party]')?.addEventListener('click', () => {
      playUiSound('confirm');
      spawnCampEventNow('entertainment_night');
      setNote('刷娱乐局');
      activeTab = 'events';
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-spawn-celeb]')?.addEventListener('click', () => {
      playUiSound('confirm');
      spawnCampEventNow('small_celebration');
      setNote('刷小庆祝');
      activeTab = 'events';
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-tick-world]')?.addEventListener('click', () => {
      playUiSound('tap');
      tickWorldOnly();
      setNote('已推进世界时钟');
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-roll-cyber]')?.addEventListener('click', () => {
      playUiSound('confirm');
      let detail = '未触发';
      saveManager.mutate((d) => {
        const liv = d.aiLiving ?? getAiLiving();
        const ids = d.ownedCharacters.map((c) => c.characterId);
        seedCyberHealthForOwned(liv as ReturnType<typeof getAiLiving>, ids);
        const ev = tryRollCyberHealthEvents(liv as ReturnType<typeof getAiLiving>, ids);
        detail = ev ? ev.note : '本轮未掷中（可多点几次）';
        d.aiLiving = liv as typeof d.aiLiving;
      });
      setNote(detail);
      activeTab = 'chars';
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-wear-cyber]')?.addEventListener('click', () => {
      playUiSound('confirm');
      saveManager.mutate((d) => {
        const liv = d.aiLiving ?? getAiLiving();
        const ids = d.ownedCharacters.map((c) => c.characterId);
        applyCombatCyberWear(liv as ReturnType<typeof getAiLiving>, ids, '调试磨损');
        d.aiLiving = liv as typeof d.aiLiving;
      });
      setNote('全员义体健康 -1（模拟出战磨损）');
      activeTab = 'chars';
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-age-cyber]')?.addEventListener('click', () => {
      playUiSound('confirm');
      let steps = 0;
      saveManager.mutate((d) => {
        const liv = d.aiLiving ?? getAiLiving();
        const ids = d.ownedCharacters.map((c) => c.characterId);
        // 回拨 last 标记，强制跨越一个老化周期
        const day = (liv as ReturnType<typeof getAiLiving>).dayIndex ?? 0;
        (liv as ReturnType<typeof getAiLiving>).lastCyberAgingDayIndex =
          day - CYBER_AGING_DAYS;
        steps = applyCyberAgingByDayIndex(liv as ReturnType<typeof getAiLiving>, ids);
        d.aiLiving = liv as typeof d.aiLiving;
      });
      setNote(steps > 0 ? `老化结算 ×${steps}（全员 -${steps}）` : '老化未结算');
      activeTab = 'chars';
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-repair-all-cyber]')?.addEventListener('click', () => {
      playUiSound('confirm');
      let n = 0;
      saveManager.mutate((d) => {
        const liv = d.aiLiving ?? getAiLiving();
        for (const oc of d.ownedCharacters) {
          const r = repairCyberHealth(liv as ReturnType<typeof getAiLiving>, oc.characterId, 'player');
          if (r.ok) n += 1;
        }
        d.aiLiving = liv as typeof d.aiLiving;
      });
      setNote(`已修复 ${n} 人义体健康→100（免费）`);
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-refresh-panel]')?.addEventListener('click', () => {
      playUiSound('tap');
      setNote('已刷新');
      render();
    });

    overlay.querySelectorAll('[data-char-wh]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.charWh!;
        playUiSound('tap');
        showCampWarehousePanel({
          characterId: id,
          onChanged: () => {
            render();
            opts.onChanged?.();
          },
        });
      });
    });
    overlay.querySelectorAll('[data-repair-cyber]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.repairCyber!;
        let msg = '';
        saveManager.mutate((d) => {
          const liv = d.aiLiving ?? getAiLiving();
          const r = repairCyberHealth(liv as ReturnType<typeof getAiLiving>, id, 'player');
          msg = r.msg;
          d.aiLiving = liv as typeof d.aiLiving;
        });
        playUiSound(msg.includes('已满') || msg.includes('无需') ? 'cancel' : 'confirm');
        setNote(msg);
        render();
        opts.onChanged?.();
      });
    });

    overlay.querySelectorAll('[data-force-msg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.forceMsg!;
        playUiSound('confirm');
        setNote(`强制 ${CHARACTER_MAP[id]?.name ?? id} 来信…`);
        void runPlayerOutreachOnce({ forceCharacterId: id, bypassCooldown: true }).then((r) => {
          setNote(`来信结果：${r.kind}${r.detail ? ` · ${r.detail}` : ''}`);
          render();
          opts.onChanged?.();
        });
      });
    });

    overlay.querySelectorAll('[data-talk-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.talkBtn;
        if (!id) return;
        playUiSound('confirm');
        showAiDialogue(id, {
          fromCamp: true,
          onClose: () => {
            render();
            opts.onChanged?.();
          },
        });
      });
    });

    overlay.querySelectorAll('[data-open-msg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mid = (btn as HTMLElement).dataset.openMsg!;
        const accepted = acceptPendingAiMessage(mid);
        if (!accepted) {
          setNote('消息已失效');
          render();
          return;
        }
        playUiSound('confirm');
        showAiDialogue(accepted.characterId, {
          fromCamp: true,
          fromOutreach: true,
          outreachPreview: accepted.preview,
          onClose: () => {
            render();
            opts.onChanged?.();
          },
        });
      });
    });

    overlay.querySelectorAll('[data-dismiss-msg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mid = (btn as HTMLElement).dataset.dismissMsg!;
        playUiSound('cancel');
        dismissPendingAiMessage(mid);
        setNote('已忽略消息（计入未回应）');
        render();
        opts.onChanged?.();
      });
    });

    overlay.querySelector('[data-goto-map1]')?.addEventListener('click', () => {
      playUiSound('tap');
      setPlayerLocation('indoor_1lou_map');
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-goto-map2]')?.addEventListener('click', () => {
      playUiSound('tap');
      setPlayerLocation('indoor_2lou_map');
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-goto-hall]')?.addEventListener('click', () => {
      playUiSound('tap');
      setPlayerLocation('indoor_dating');
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-roam-prev]')?.addEventListener('click', () => {
      playUiSound('tap');
      roamIndoor(-1);
      render();
      opts.onChanged?.();
    });
    overlay.querySelector('[data-roam-next]')?.addEventListener('click', () => {
      playUiSound('tap');
      roamIndoor(1);
      render();
      opts.onChanged?.();
    });
    overlay.querySelectorAll('[data-goto-loc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        playUiSound('tap');
        setPlayerLocation((btn as HTMLElement).dataset.gotoLoc || 'indoor_dating');
        render();
        opts.onChanged?.();
      });
    });

    overlay.querySelector('[data-save-key]')?.addEventListener('click', () => {
      const input = overlay.querySelector<HTMLInputElement>('[data-api-key]');
      if (input?.value.trim()) {
        setStoredApiKey(input.value);
        playUiSound('confirm');
        input.value = '';
        setNote('Qwen Key 已保存');
        render();
      }
    });
    overlay.querySelector('[data-net-diag]')?.addEventListener('click', () => {
      playUiSound('tap');
      setNote('网络自检中…');
      void runNetworkDiagnostics().then((checks) => {
        const lines = checks.map((c) => `${c.label}${c.status === 'ok' ? '通' : '×'}(${c.detail})`);
        setNote(`${summarizeDiagnostics(checks)} ｜ ${lines.join(' ; ')}`);
      });
    });
    overlay.querySelector('[data-save-compat]')?.addEventListener('click', () => {
      const base = overlay.querySelector<HTMLInputElement>('[data-compat-base]');
      const model = overlay.querySelector<HTMLInputElement>('[data-compat-model]');
      const key = overlay.querySelector<HTMLInputElement>('[data-compat-key]');
      if (base?.value.trim()) setCompatBaseUrl(base.value);
      if (model?.value.trim()) setCompatModel(model.value);
      if (key?.value.trim()) {
        setCompatApiKey(key.value);
        key.value = '';
      }
      playUiSound('confirm');
      setNote('家里云端设置已保存');
      render();
    });
    overlay.querySelector('[data-gpu-advanced]')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      const panel = overlay.querySelector<HTMLElement>('[data-gpu-advanced-panel]');
      if (panel) panel.hidden = !on;
    });
    overlay.querySelector('[data-gpu-local]')?.addEventListener('click', () => {
      applyLocalHomeGpuPreset(DEFAULT_LOCAL_MODEL);
      playUiSound('confirm');
      setNote(`已启用本机 Fable Q4 · ${DEFAULT_LOCAL_MODEL}`);
      render();
    });
    overlay.querySelector('[data-gpu-import-file]')?.addEventListener('click', () => {
      playUiSound('tap');
      setNote('正在读取 PC 配置…');
      void fetchAndApplyHomeGpuConfig('localhost').then((r) => {
        if (r.ok) {
          setNote(`已导入并启用本机 · ${r.model}`);
          render();
        } else {
          setNote(r.reason);
        }
      });
    });
    overlay.querySelector('[data-gpu-lan]')?.addEventListener('click', () => {
      playUiSound('tap');
      void fetchAndApplyHomeGpuConfig('lan').then((r) => {
        if (r.ok) {
          setNote(`已切到局域网 · ${r.baseUrl}`);
          render();
        } else {
          setNote(r.reason);
        }
      });
    });
    overlay.querySelector('[data-gpu-remote]')?.addEventListener('click', () => {
      playUiSound('tap');
      void fetchAndApplyHomeGpuConfig('remote').then((r) => {
        if (r.ok) {
          setNote(`已切到远程 · ${r.baseUrl}`);
          render();
        } else {
          setNote(r.reason);
        }
      });
    });
    overlay.querySelector('[data-gpu-cloudflare]')?.addEventListener('click', () => {
      playUiSound('tap');
      void fetchAndApplyHomeGpuConfig('cloudflare').then((r) => {
        if (r.ok) {
          setNote(`✅ Cloudflare 远程已启用 · ${r.model} @ ${r.baseUrl}`);
          render();
        } else {
          setNote(`❌ ${r.reason}`);
        }
      });
    });
    overlay.querySelector('[data-gpu-tailscale]')?.addEventListener('click', () => {
      playUiSound('tap');
      void fetchAndApplyHomeGpuConfig('tailscale').then((r) => {
        if (r.ok) {
          setNote(`✅ Tailscale 远程已启用 · ${r.model} @ ${r.baseUrl}`);
          render();
        } else {
          setNote(`❌ ${r.reason}`);
        }
      });
    });
    overlay.querySelector('[data-gpu-paste]')?.addEventListener('click', () => {
      const ta = overlay.querySelector<HTMLTextAreaElement>('[data-gpu-json]');
      const cfg = parseHomeGpuConfigJson(ta?.value || '');
      if (!cfg) {
        setNote('JSON 无效，请粘贴 setup-home-gpu.ps1 生成的内容');
        return;
      }
      const mode =
        cfg.preferredMode === 'tailscale' ? 'tailscale' :
        cfg.preferredMode === 'cloudflare' ? 'cloudflare' :
        cfg.preferredMode === 'lan' ? 'lan' : 'localhost';
      const r = applyHomeGpuConfig(cfg, mode);
      if (r.ok) {
        playUiSound('confirm');
        setNote(`已从粘贴启用 · ${r.model} @ ${r.baseUrl}`);
        render();
      } else {
        setNote(r.reason);
      }
    });
    overlay.querySelector('[data-test-compat]')?.addEventListener('click', () => {
      const baseEl = overlay.querySelector<HTMLInputElement>('[data-compat-base]');
      const modelEl = overlay.querySelector<HTMLInputElement>('[data-compat-model]');
      const keyEl = overlay.querySelector<HTMLInputElement>('[data-compat-key]');
      if (baseEl?.value.trim()) setCompatBaseUrl(baseEl.value);
      if (modelEl?.value.trim()) setCompatModel(modelEl.value);
      if (keyEl?.value.trim()) setCompatApiKey(keyEl.value);

      const baseUrl = getCompatBaseUrl();
      const model = getCompatModel();
      const apiKey = getCompatApiKey() || 'ollama';
      playUiSound('tap');
      setNote('正在测试家里云端…');
      void (async () => {
        try {
          const ctrl = new AbortController();
          const timer = window.setTimeout(() => ctrl.abort(), 45000);
          const res = await fetch(baseUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            signal: ctrl.signal,
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: 'ping：只回复「ok」一个词。' }],
              max_tokens: 8,
              temperature: 0,
            }),
          });
          window.clearTimeout(timer);
          const text = await res.text();
          if (!res.ok) {
            setNote(`连接失败 HTTP ${res.status}：${text.slice(0, 120)}`);
            return;
          }
          setNote(`连接成功 · ${model}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setNote(
            `连接失败：${msg.slice(0, 160)}（PC 需先跑 scripts/setup-cloudflare-tunnel.ps1 启动 Cloudflare 隧道；或确保 Tailscale 两端已登录）`,
          );
        }
      })();
    });
    overlay.querySelector('[data-provider-select]')?.addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value as AiChatProviderId;
      setChatProvider(id);
      playUiSound('tap');
      if (id === 'openai_compatible') {
        setNote('正在自动套用 PC 家里云端配置…');
        void fetchAndApplyHomeGpuConfig('cloudflare').then((r) => {
          if (!r.ok) {
            return fetchAndApplyHomeGpuConfig('remote').then((r2) => {
              if (r2.ok) {
                setNote(`已自动填好远程 · ${r2.model}`);
                render();
              } else {
                setNote(`${r2.reason}（可再点「Cloudflare 远程」或「外地」）`);
                render();
              }
            });
          }
          setNote(`已自动填好 Cloudflare · ${r.model}`);
          render();
        });
        return;
      }
      render();
    });
    overlay.querySelector('[data-model-select]')?.addEventListener('change', (e) => {
      setConfiguredChatModel((e.target as HTMLSelectElement).value);
      playUiSound('tap');
      render();
    });
    overlay.querySelector('[data-voice-enabled]')?.addEventListener('change', (e) => {
      setVoiceEnabled((e.target as HTMLInputElement).checked);
      playUiSound('tap');
      setNote(`语音朗读已${isVoiceEnabled() ? '开启' : '关闭'}`);
    });
    overlay.querySelector('[data-voice-reset-lock]')?.addEventListener('click', () => {
      resetVoiceIdentities();
      playUiSound('tap');
      setNote('已重置音色锁定，下次说话会重新绑定当前配置的声线');
    });
    overlay.querySelector('[data-voice-workspace-save]')?.addEventListener('click', () => {
      const input = overlay.querySelector<HTMLInputElement>('[data-voice-workspace]');
      setVoiceWorkspaceId(input?.value ?? '');
      playUiSound('tap');
      setNote('业务空间 ID 已保存（Qwen-Audio-TTS 专属域名）');
    });
    overlay.querySelectorAll('[data-tts-sample]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.ttsSample!;
        const name = CHARACTER_MAP[id]?.name ?? id;
        const vp = getCharacterVoiceProfile(id);
        playUiSound('tap');
        setNote(`试听 ${name}…`);
        clearDialogueVoiceSession(id);
        void speakDialogue({
          characterId: id,
          text: `${name}，通讯接通。按当前声线汇报。`,
          emotion: 'neutral',
          type: 'dialogue',
          wantSpeak: true,
        }).then((r) => {
          clearDialogueVoiceSession(id);
          setNote(
            r.ok
              ? `试听完成 · ${vp.voiceLabel} · ${r.prosody ? formatProsody(r.prosody) : ''}`
              : `试听失败：${r.reason || 'unknown'}`,
          );
        });
      });
    });

    overlay.querySelector('[data-load-archive]')?.addEventListener('click', () => {
      playUiSound('tap');
      const ul = overlay.querySelector<HTMLElement>('[data-archive-list]');
      if (!ul) return;
      ul.innerHTML = '<li>加载中…</li>';
      void listDialogueArchive({ limit: 40 }).then((rows) => {
        if (!rows.length) {
          ul.innerHTML = '<li>暂无存档对话</li>';
          return;
        }
        ul.innerHTML = rows
          .slice()
          .reverse()
          .map((e) => {
            const when = new Date(e.ts).toLocaleString();
            const kind = e.kind === 'npc' ? '角色间' : '玩家';
            return `<li><strong>[${kind}]</strong> ${escapeHtml(when)} · ${escapeHtml(e.digest)}</li>`;
          })
          .join('');
      });
    });
  };

  overlay.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).dataset.campLivingPanel) {
      playUiSound('cancel');
      overlay.remove();
      opts.onChanged?.();
    }
  });

  void getStoredApiKey();
  document.body.appendChild(overlay);
  render();

  // 只在用户当前选择了家里 GPU 时刷新包内配置；打开面板不能改变 Provider。
  if (getChatProvider() === 'openai_compatible') {
    void forceApplyShippedHomeGpuConfig().then((r) => {
      if (!r.ok) {
        setNote(`自动配置失败：${r.reason}`);
        return;
      }
      setNote(
        r.forced
          ? `已强制更新家里云端 · ${r.model}`
          : `家里云端已是最新 · ${r.model}`,
      );
      render();
    });
  }
}
