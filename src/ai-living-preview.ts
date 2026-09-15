/**
 * AI 营地生活独立预览页
 * 打开：npm run preview:ai  →  /ai-living-preview.html
 * 调试/角色数值全部在「营地生活」面板内。
 */
import './fonts.css';
import './style.css';
import './cc-ui.css';
import './ui/aiLiving.css';
import './ai-living-preview.css';

import { CHARACTER_MAP } from './data/characters';
import { getSceneCard, resolveSceneCardImage } from './ai/sceneCards';
import {
  createDefaultAiLiving,
  formatGameClock,
  resolveActiveCampImage,
  resolveActiveSceneId,
  resolvePeriod,
  resolveWeather,
  shouldShowRainOverlay,
} from './ai/worldClock';
import { AI_WEATHER_OVERLAY } from './ai/assets';
import { describeAffinity, getAffinity } from './ai/relationship';
import { hasApiKey, getStoredApiKey } from './ai/llmClient';
import { getConfiguredChatModel, getConfiguredSummaryModel } from './ai/modelConfig';
import {
  getAiLiving,
  mutateAiLiving,
  peekPendingAiMessages,
  setPlayerLocation,
  tickWorldOnly,
} from './ai/livingService';
import { listActiveCampEventsForUi } from './ai/campEvents';
import { resolvePresence } from './ai/livingState';
import { saveManager } from './core/SaveManager';
import { showCampLivingPanel } from './ui/campLivingPanel';
import { texUrl } from './utils/texUrl';

const PREVIEW_OWNED = [
  'ashcrow',
  'heartforge',
  'mirror',
  'pulse',
  'frostline',
  'wireguard',
  'dustblade',
  'outercore',
];

const PERIOD_JUMPS: { label: string; hour: number; loc?: string }[] = [
  { label: '清晨', hour: 6 },
  { label: '晴天', hour: 9 },
  { label: '正午', hour: 12 },
  { label: '黄昏', hour: 17 },
  { label: '傍晚', hour: 19 },
  { label: '深夜', hour: 23 },
  { label: '雨昏', hour: 17, loc: 'camp_xiayu_huanghun' },
];

function ensurePreviewSave(): void {
  saveManager.mutate((d) => {
    if (!d.aiLiving) d.aiLiving = createDefaultAiLiving();
    for (const id of PREVIEW_OWNED) {
      if (!d.ownedCharacters.some((c) => c.characterId === id)) {
        d.ownedCharacters.push({ characterId: id, weaponId: null, giftCount: 0 });
      }
    }
    if (!d.squad.length) d.squad = ['ashcrow', 'heartforge', 'pulse'];
    d.settings.hubFeaturedCharId = d.squad[0] ?? 'ashcrow';
  });
}

function jumpToHour(hour: number): void {
  mutateAiLiving((living) => {
    const dayBase = Math.floor(living.gameMinutes / 1440) * 1440;
    living.gameMinutes = dayBase + hour * 60;
    living.lastRealTs = Date.now();
    if (living.playerLocationId.startsWith('camp_') || living.playerLocationId === 'camp_auto') {
      living.playerLocationId = 'camp_auto';
    }
  });
}

function openLivingPanel(): void {
  showCampLivingPanel({
    onChanged: () => render(),
  });
}

function render(): void {
  ensurePreviewSave();
  tickWorldOnly();
  const root = document.getElementById('ai-preview-root');
  if (!root) return;

  const living = getAiLiving();
  const sceneId = resolveActiveSceneId(living);
  const scene = getSceneCard(sceneId);
  const isIndoor = scene?.kind === 'indoor';
  const bg = scene
    ? resolveSceneCardImage(scene, resolvePeriod(living))
    : resolveActiveCampImage(living);
  const rain = !isIndoor && shouldShowRainOverlay(living);
  const pending = peekPendingAiMessages().length;
  const events = listActiveCampEventsForUi(living).length;
  const model = getConfiguredChatModel();

  const roster = PREVIEW_OWNED.map((id) => {
    const def = CHARACTER_MAP[id]!;
    const p = resolvePresence(id, living);
    const aff = getAffinity(living, id);
    const src = texUrl(def.portraitFront || def.icon || '');
    return `
      <button type="button" class="aip-roster-card" data-open-living title="在营地生活面板中查看">
        <img src="${src}" alt="" />
        <span class="aip-roster-name">${def.name}</span>
        <span class="aip-roster-meta">${aff}·${describeAffinity(aff)}</span>
        <span class="aip-roster-act">${p.behavior}</span>
      </button>`;
  }).join('');

  const periodBtns = PERIOD_JUMPS.map(
    (p) =>
      `<button type="button" class="aip-chip" data-period-hour="${p.hour}" ${p.loc ? `data-force-scene="${p.loc}"` : ''}>${p.label}</button>`,
  ).join('');

  root.innerHTML = `
    <div class="aip-shell aip-shell-focus">
      <div class="aip-stage">
        <img class="aip-bg" src="${texUrl(bg)}" alt="" />
        ${rain ? `<img class="hub-weather-overlay" src="${AI_WEATHER_OVERLAY.rain}" alt="" />` : ''}
        <div class="aip-veil"></div>
        <header class="aip-top">
          <div>
            <h1>锈带纪元 · AI 营地预览</h1>
            <p class="aip-clock">${formatGameClock(living)} · ${resolvePeriod(living)} / ${resolveWeather(living)}</p>
            <p class="aip-scene-label">${scene?.label ?? sceneId}</p>
            <p class="aip-model-badge">对话 ${model} · 摘要 ${getConfiguredSummaryModel()} · 消息 ${pending} · 事件 ${events}</p>
            <p class="aip-hint">Qwen ${hasApiKey() ? '✓' : '✗'} — 全栈 DashScope · Key 与全部调试在「营地生活」面板</p>
          </div>
          <div class="aip-top-actions">
            <a class="btn btn-secondary btn-sm" href="/?skipTitle">进游戏主城</a>
            <a class="btn btn-secondary btn-sm" href="/">完整游戏</a>
          </div>
        </header>

        <div class="aip-hero-cta">
          <button type="button" class="btn btn-primary aip-open-living" data-open-living>
            打开营地生活面板
          </button>
          <p class="aip-hint">角色属性 / 人格数值 / 主动消息 / 事件 / 关系 / API / 调试按钮 全部在此</p>
        </div>

        <p class="aip-atmosphere">${scene?.atmosphere ?? ''}</p>
      </div>

      <aside class="aip-side">
        <section>
          <h2>时段快切</h2>
          <div class="aip-chips">${periodBtns}</div>
        </section>
        <section>
          <h2>在营角色（点开面板）</h2>
          <div class="aip-roster">${roster}</div>
        </section>
        <section>
          <h2>快捷</h2>
          <div class="aip-chips">
            <button type="button" class="aip-chip aip-chip-accent" data-open-living>营地生活</button>
            <button type="button" class="aip-chip" data-goto-hall>回大厅</button>
            <button type="button" class="aip-chip" data-refresh>刷新预览</button>
          </div>
        </section>
      </aside>
    </div>
  `;

  root.querySelectorAll('[data-open-living]').forEach((btn) => {
    btn.addEventListener('click', () => openLivingPanel());
  });

  root.querySelectorAll('[data-period-hour]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hour = Number((btn as HTMLElement).dataset.periodHour);
      const force = (btn as HTMLElement).dataset.forceScene;
      jumpToHour(hour);
      if (force) setPlayerLocation(force);
      else if (!getAiLiving().playerLocationId.startsWith('indoor_')) {
        mutateAiLiving((l) => {
          l.playerLocationId = 'camp_auto';
        });
      }
      if (force === 'camp_xiayu_huanghun') {
        mutateAiLiving((l) => {
          l.dayIndex = 5;
          l.playerLocationId = 'camp_auto';
        });
        jumpToHour(17);
      }
      render();
    });
  });

  root.querySelector('[data-goto-hall]')?.addEventListener('click', () => {
    setPlayerLocation('indoor_dating');
    render();
  });

  root.querySelector('[data-refresh]')?.addEventListener('click', () => render());
}

ensurePreviewSave();
void getStoredApiKey();
render();

// 自动打开营地生活面板，方便直接调试
window.setTimeout(() => openLivingPanel(), 200);

window.setInterval(() => {
  tickWorldOnly();
  const clock = document.querySelector('.aip-clock');
  if (clock) {
    clock.textContent = `${formatGameClock(getAiLiving())} · ${resolvePeriod(getAiLiving())} / ${resolveWeather(getAiLiving())}`;
  }
}, 5000);
