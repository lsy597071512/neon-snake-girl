/**
 * Gal 式剧情层：打字机 + ▼ 续页 + 选项/确认；立绘 bust-zoom（contain + transform，不裁源）。
 */
import { CHARACTER_MAP } from '../data/characters';
import { CAMP_SHOPKEEPER_ART, CAMP_SHOPKEEPER_NAME } from '../data/campShopkeeper';
import type { StoryBeatDef, StoryBeatNode, StoryLine } from '../data/storyBeats';
import {
  armSilentPortraitVideo,
  applyLivePortraitPoster,
  canPlayLivePortrait,
  getLivePortraitSrc,
} from './livePortrait';
import { getCharPortraitSrc } from './uiAssets';
import { SUB_UI, subUi } from './subUiAssets';
import { texUrl } from '../utils/texUrl';
import { playUiSound } from './uiSound';

const TYPE_MS = 22;
/** 剧情用立绘（绿幕抠像后）；勿用三视图 zhujue.png */
const COMMANDER_PORTRAIT_SRC = './tex/zhujue_portrait.png';
/** 立绘渐隐渐显时长 */
const PORTRAIT_FADE_MS = 380;

export type StoryPlayResult = {
  skipped: boolean;
  choices: Record<string, 'A' | 'B' | 'C'>;
};

export type StoryPlayOptions = {
  /** 开战前世界观远景；有则盖满背景，不再透出关卡 UI */
  backdropUrl?: string | null;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function portraitFadeMs(): number {
  return prefersReducedMotion() ? 0 : PORTRAIT_FADE_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

function speakerName(line: StoryLine): string {
  if (line.name) return line.name;
  if (line.speaker === 'shopkeeper') return CAMP_SHOPKEEPER_NAME;
  if (line.speaker === 'commander') return '指挥官';
  if (line.speaker === 'narration') return '';
  if (line.charId && CHARACTER_MAP[line.charId]) return CHARACTER_MAP[line.charId]!.name;
  return '???';
}

function buildPortraitHtml(charId: string, active: boolean): string {
  const live = getLivePortraitSrc(charId, { skinChannel: 'none' });
  const cls = `story-portrait${active ? ' is-active' : ' is-dim'}`;
  if (live && canPlayLivePortrait(live)) {
    const poster = getCharPortraitSrc(charId, 'front', { skinChannel: 'none' });
    const posterAttr = poster ? ` poster="${texUrl(poster)}"` : '';
    return `<div class="${cls}" data-story-char="${charId}">
      <div class="story-portrait-frame">
        <video class="story-portrait-video" src="${texUrl(live)}"${posterAttr}
          autoplay muted loop playsinline webkit-playsinline preload="metadata"></video>
      </div>
    </div>`;
  }
  const src = getCharPortraitSrc(charId, 'front', { skinChannel: 'none' });
  if (src) {
    return `<div class="${cls}" data-story-char="${charId}">
      <div class="story-portrait-frame">
        <img class="story-portrait-img" src="${texUrl(src)}" alt="" />
      </div>
    </div>`;
  }
  return `<div class="${cls}" data-story-char="${charId}"><div class="story-portrait-frame story-portrait-fallback">${CHARACTER_MAP[charId]?.icon ?? '?'}</div></div>`;
}

function buildShopkeeperHtml(facing: 'front' | 'back', active: boolean): string {
  const src = facing === 'back' ? CAMP_SHOPKEEPER_ART.back : CAMP_SHOPKEEPER_ART.front;
  const cls = `story-portrait${active ? ' is-active' : ' is-dim'}`;
  return `<div class="${cls}" data-story-shopkeeper>
    <div class="story-portrait-frame">
      <img class="story-portrait-img" src="${texUrl(src)}" alt="" />
    </div>
  </div>`;
}

function buildCommanderHtml(active: boolean): string {
  const cls = `story-portrait story-portrait--commander${active ? ' is-active' : ' is-dim'}`;
  return `<div class="${cls}" data-story-commander>
    <div class="story-portrait-frame">
      <img class="story-portrait-img" src="${texUrl(COMMANDER_PORTRAIT_SRC)}" alt="" />
    </div>
  </div>`;
}

function storyBtnHtml(label: string, extraClass: string, attrs: string, variant: 'primary' | 'secondary' | 'tiny'): string {
  const bg =
    variant === 'primary' ? SUB_UI.btnPrimary : variant === 'tiny' ? SUB_UI.btnTinyAd : SUB_UI.btnSecondary;
  return `<button type="button" class="btn story-ui-btn ${extraClass}" ${attrs}><img class="btn-bg" src="${subUi(bg)}" alt="" /><span class="btn-text">${escapeHtml(label)}</span></button>`;
}

function linePortraitIds(line: StoryLine): string[] {
  if (line.stage?.length) return line.stage;
  if (line.speaker === 'char' && line.charId) return [line.charId];
  return [];
}

function portraitSignature(line: StoryLine | { kind: 'commander' } | { kind: 'clear' }): string {
  if ('kind' in line) return line.kind;
  if (line.speaker === 'shopkeeper') return `shop:${line.shopkeeperFacing ?? 'front'}`;
  if (line.speaker === 'commander') return 'commander';
  if (line.speaker === 'narration') return 'clear';
  const ids = linePortraitIds(line);
  if (!ids.length) return 'clear';
  return `chars:${ids.join(',')}|active:${line.charId ?? ids[0] ?? ''}`;
}

function buildPortraitsHtml(line: StoryLine): string {
  if (line.speaker === 'shopkeeper') {
    return buildShopkeeperHtml(line.shopkeeperFacing ?? 'front', true);
  }
  if (line.speaker === 'commander') {
    return buildCommanderHtml(true);
  }
  if (line.speaker === 'narration') return '';
  const ids = linePortraitIds(line);
  if (!ids.length) return '';
  return ids.map((id) => buildPortraitHtml(id, id === line.charId || ids.length === 1)).join('');
}

export function playStoryBeat(beat: StoryBeatDef, opts?: StoryPlayOptions): Promise<StoryPlayResult> {
  return new Promise((resolve) => {
    const host = document.getElementById('app') ?? document.body;
    const overlay = document.createElement('div');
    overlay.className = 'story-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '剧情');

    const backdropUrl = opts?.backdropUrl ? texUrl(opts.backdropUrl) : '';
    const backdropHtml = backdropUrl
      ? `<div class="story-backdrop" style="background-image:url('${backdropUrl}')" aria-hidden="true"></div>`
      : '';

    overlay.innerHTML = `
      ${backdropHtml}
      <div class="story-stage">
        <div class="story-veil${backdropUrl ? ' story-veil--on-plate' : ''}" aria-hidden="true"></div>
        <div class="story-portraits" data-story-portraits></div>
        ${beat.skippable ? storyBtnHtml('跳过本场', 'story-skip', 'data-story-skip', 'tiny') : ''}
        <div class="story-dock">
          <div class="story-box wl-sub-panel wl-sub-panel--lower" data-story-box>
            <img class="wl-sub-panel-frame" src="${subUi(SUB_UI.panelLower)}" alt="" />
            <div class="wl-sub-panel-body story-box-body">
              <div class="story-name" data-story-name></div>
              <p class="story-text" data-story-text></p>
              <span class="story-caret is-hidden" data-story-caret>▼</span>
            </div>
          </div>
          <div class="story-choices is-hidden" data-story-choices></div>
          <div class="story-confirm-row is-hidden" data-story-confirm-row></div>
        </div>
      </div>
    `;

    host.appendChild(overlay);

    const portraitsEl = overlay.querySelector('[data-story-portraits]') as HTMLElement;
    const nameEl = overlay.querySelector('[data-story-name]') as HTMLElement;
    const textEl = overlay.querySelector('[data-story-text]') as HTMLElement;
    const caretEl = overlay.querySelector('[data-story-caret]') as HTMLElement;
    const boxEl = overlay.querySelector('[data-story-box]') as HTMLElement;
    const choicesEl = overlay.querySelector('[data-story-choices]') as HTMLElement;
    const confirmRow = overlay.querySelector('[data-story-confirm-row]') as HTMLElement;
    const skipBtn = overlay.querySelector('[data-story-skip]') as HTMLButtonElement | null;

    const choicesLog: Record<string, 'A' | 'B' | 'C'> = {};
    let closed = false;
    let typeTimer = 0;
    let fullText = '';
    let charIndex = 0;
    let awaitingAdvance = false;
    let queue: StoryBeatNode[] = [...beat.nodes];
    let choiceSeq = 0;
    let portraitSig = '';
    let portraitToken = 0;

    const finish = (skipped: boolean) => {
      void (async () => {
        if (closed) return;
        closed = true;
        window.clearInterval(typeTimer);
        const ms = portraitFadeMs();
        if (ms > 0) {
          portraitsEl.classList.add('is-fading-out');
          overlay.classList.add('is-closing');
          await sleep(ms);
        }
        overlay.remove();
        resolve({ skipped, choices: choicesLog });
      })();
    };

    const armVideos = () => {
      portraitsEl.querySelectorAll<HTMLVideoElement>('.story-portrait-video').forEach((v) => {
        armSilentPortraitVideo(v);
        const charId = v.closest('[data-story-char]')?.getAttribute('data-story-char');
        if (charId) applyLivePortraitPoster(v, charId, { skinChannel: 'none' });
        void v.play().catch(() => undefined);
      });
    };

    const applyActiveOnly = (line: StoryLine): boolean => {
      if (!portraitSig.startsWith('chars:') || line.speaker !== 'char') return false;
      const ids = linePortraitIds(line);
      const nextCast = `chars:${ids.join(',')}`;
      const prevCast = portraitSig.split('|')[0] ?? '';
      if (prevCast !== nextCast) return false;
      portraitsEl.querySelectorAll('[data-story-char]').forEach((el) => {
        const id = el.getAttribute('data-story-char');
        const active = Boolean(id && (id === line.charId || ids.length === 1));
        el.classList.toggle('is-active', active);
        el.classList.toggle('is-dim', !active);
        el.classList.remove('is-enter');
      });
      portraitSig = portraitSignature(line);
      return true;
    };

    const mountPortraitsHtml = async (html: string, nextSig: string) => {
      const token = ++portraitToken;
      const ms = portraitFadeMs();
      const had = portraitsEl.childElementCount > 0;

      if (ms > 0 && had) {
        portraitsEl.classList.add('is-fading-out');
        portraitsEl.classList.remove('is-visible');
        await sleep(ms);
        if (closed || token !== portraitToken) return;
      }

      portraitsEl.innerHTML = html;
      armVideos();
      portraitSig = nextSig;
      portraitsEl.classList.remove('is-fading-out');

      if (ms > 0 && html) {
        portraitsEl.classList.add('is-fading-in');
        void portraitsEl.offsetWidth;
        requestAnimationFrame(() => {
          if (closed || token !== portraitToken) return;
          portraitsEl.classList.remove('is-fading-in');
          portraitsEl.classList.add('is-visible');
        });
        portraitsEl.querySelectorAll('.story-portrait').forEach((el) => {
          el.classList.add('is-enter');
        });
      } else {
        portraitsEl.classList.add('is-visible');
      }
    };

    const setPortraits = async (line: StoryLine) => {
      const nextSig = portraitSignature(line);
      if (nextSig === portraitSig) return;
      if (applyActiveOnly(line)) return;
      await mountPortraitsHtml(buildPortraitsHtml(line), nextSig);
    };

    const setCommanderPortrait = async () => {
      const nextSig = 'commander';
      if (nextSig === portraitSig) return;
      await mountPortraitsHtml(buildCommanderHtml(true), nextSig);
    };

    const stopTyping = () => {
      window.clearInterval(typeTimer);
      typeTimer = 0;
    };

    const showFullText = () => {
      stopTyping();
      textEl.textContent = fullText;
      charIndex = fullText.length;
      caretEl.classList.remove('is-hidden');
      awaitingAdvance = true;
    };

    const startTyping = (text: string) => {
      stopTyping();
      fullText = text;
      charIndex = 0;
      textEl.textContent = '';
      caretEl.classList.add('is-hidden');
      awaitingAdvance = false;
      choicesEl.classList.add('is-hidden');
      choicesEl.innerHTML = '';
      confirmRow.classList.add('is-hidden');
      typeTimer = window.setInterval(() => {
        charIndex += 1;
        textEl.textContent = fullText.slice(0, charIndex);
        if (charIndex >= fullText.length) {
          showFullText();
        }
      }, TYPE_MS);
    };

    const playLine = async (line: StoryLine) => {
      await setPortraits(line);
      if (closed) return;
      const name = speakerName(line);
      nameEl.textContent = name;
      nameEl.classList.toggle('is-hidden', !name);
      boxEl.dataset.bubble = line.bubble ?? 'dialogue';
      startTyping(line.text.replace(/\\n/g, '\n'));
    };

    const runNext = () => {
      if (closed) return;
      const node = queue.shift();
      if (!node) {
        finish(false);
        return;
      }
      if (node.type === 'line') {
        void playLine(node.line);
        return;
      }
      if (node.type === 'choice') {
        stopTyping();
        textEl.textContent = '……';
        caretEl.classList.add('is-hidden');
        nameEl.textContent = '指挥官';
        nameEl.classList.remove('is-hidden');
        void setCommanderPortrait();
        confirmRow.classList.add('is-hidden');
        choicesEl.classList.remove('is-hidden');
        choicesEl.innerHTML = node.options
          .map((o) => storyBtnHtml(o.text, 'btn-secondary story-choice-btn', `data-story-choice="${o.id}"`, 'secondary'))
          .join('');
        awaitingAdvance = false;
        const local = node;
        const seq = ++choiceSeq;
        choicesEl.querySelectorAll('[data-story-choice]').forEach((el) => {
          el.addEventListener('click', () => {
            if (closed || seq !== choiceSeq) return;
            playUiSound('tap');
            const id = (el as HTMLElement).dataset.storyChoice as 'A' | 'B' | 'C';
            choicesLog[`${beat.id}:${Object.keys(choicesLog).length}`] = id;
            const branch = local.branches[id] ?? [];
            queue = [...branch, ...(local.join ?? []), ...queue];
            choicesEl.classList.add('is-hidden');
            runNext();
          });
        });
        return;
      }
      if (node.type === 'confirm') {
        stopTyping();
        caretEl.classList.add('is-hidden');
        choicesEl.classList.add('is-hidden');
        confirmRow.classList.remove('is-hidden');
        confirmRow.innerHTML = storyBtnHtml(node.label, 'btn-primary story-confirm-btn', 'data-story-confirm', 'primary');
        awaitingAdvance = false;
        const local = node;
        const confirmBtn = confirmRow.querySelector('[data-story-confirm]') as HTMLButtonElement;
        const onConfirm = () => {
          playUiSound('tap');
          confirmBtn.removeEventListener('click', onConfirm);
          confirmRow.classList.add('is-hidden');
          confirmRow.innerHTML = '';
          queue = [...(local.join ?? []), ...queue];
          runNext();
        };
        confirmBtn.addEventListener('click', onConfirm);
        return;
      }
      if (node.type === 'tapHint') {
        runNext();
      }
    };

    const tryAdvance = () => {
      if (closed) return;
      if (!choicesEl.classList.contains('is-hidden')) return;
      if (!confirmRow.classList.contains('is-hidden')) return;
      if (typeTimer) {
        showFullText();
        return;
      }
      if (awaitingAdvance) {
        awaitingAdvance = false;
        caretEl.classList.add('is-hidden');
        playUiSound('tap');
        runNext();
      }
    };

    boxEl.addEventListener('click', tryAdvance);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || (e.target as HTMLElement).classList.contains('story-veil')) {
        tryAdvance();
      }
    });

    skipBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      playUiSound('tap');
      finish(true);
    });

    runNext();
  });
}
