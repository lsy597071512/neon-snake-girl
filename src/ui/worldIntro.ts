import { playUiSound } from './uiSound';
import {
  WORLD_INTRO_ART_SRC,
  WORLD_INTRO_DEFAULT_MODE,
  WORLD_INTRO_MIN_MS,
  WORLD_INTRO_SKIP_AFTER_MS,
  WORLD_INTRO_TEXT,
  WORLD_INTRO_TITLE,
  WORLD_INTRO_VIDEO_SRC,
  type WorldIntroMode,
} from '../data/worldIntro';
import { texUrl } from '../utils/texUrl';
import { setBgmTrack, unlockBgm } from '../audio/bgm';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 世界观介绍：默认动漫版 PV，可切换文字版；右上角切换与跳过并列。
 * 音效互斥：文字版播独立 intro BGM；动漫版播 PV 音轨并停掉 BGM，避免重叠。
 */
export function playWorldIntro(): Promise<void> {
  return new Promise((resolve) => {
    unlockBgm();

    const host = document.getElementById('app') ?? document.body;
    const overlay = document.createElement('div');
    overlay.className = 'world-intro';
    overlay.dataset.worldIntro = 'true';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', WORLD_INTRO_TITLE);

    let mode: WorldIntroMode = WORLD_INTRO_DEFAULT_MODE;

    overlay.innerHTML = `
      <div class="world-intro-stage">
        <video
          class="world-intro-video is-awaiting-play"
          src="${texUrl(WORLD_INTRO_VIDEO_SRC)}"
          autoplay
          muted
          playsinline
          webkit-playsinline
          preload="auto"
          controlslist="nodownload nofullscreen noremoteplayback"
          disablepictureinpicture
          aria-hidden="true"
        ></video>
        <img
          class="world-intro-art"
          src="${texUrl(WORLD_INTRO_ART_SRC)}"
          alt=""
          aria-hidden="true"
        />
        <div class="world-intro-veil" aria-hidden="true"></div>
        <div class="world-intro-topbar">
          <button type="button" class="world-intro-chip" data-world-intro-mode>文字版</button>
          <button type="button" class="world-intro-chip world-intro-skip is-hidden" data-world-intro-skip>跳过</button>
        </div>
        <div class="world-intro-copy">
          <p class="world-intro-kicker">WORLD BRIEFING</p>
          <h2 class="world-intro-title">${escapeHtml(WORLD_INTRO_TITLE)}</h2>
          <p class="world-intro-text" data-world-intro-text></p>
        </div>
        <div class="world-intro-actions">
          <button type="button" class="btn btn-primary world-intro-enter is-hidden" data-world-intro-enter>进入锈带</button>
        </div>
      </div>
    `;

    const videoEl = overlay.querySelector('.world-intro-video') as HTMLVideoElement;
    const artEl = overlay.querySelector('.world-intro-art') as HTMLImageElement;
    const veilEl = overlay.querySelector('.world-intro-veil') as HTMLElement;
    const copyEl = overlay.querySelector('.world-intro-copy') as HTMLElement;
    const textEl = overlay.querySelector('[data-world-intro-text]') as HTMLElement;
    const modeBtn = overlay.querySelector('[data-world-intro-mode]') as HTMLButtonElement;
    const skipBtn = overlay.querySelector('[data-world-intro-skip]') as HTMLButtonElement;
    const enterBtn = overlay.querySelector('[data-world-intro-enter]') as HTMLButtonElement;
    const fullText = WORLD_INTRO_TEXT;

    // 原生播放键根治：首帧播出前整只隐藏（此时无画面，大播放键也不可见）
    const armVideoFrame = () => videoEl.classList.add('is-awaiting-play');
    videoEl.addEventListener('playing', () => videoEl.classList.remove('is-awaiting-play'));
    videoEl.addEventListener('error', () => videoEl.classList.remove('is-awaiting-play'));
    videoEl.addEventListener('emptied', armVideoFrame);

    let closed = false;
    let charIndex = 0;
    let typeTimer = 0;
    let skipTimer = 0;
    let enterTimer = 0;
    let checkTypedDone = 0;
    let typingStarted = false;

    const stopTyping = () => {
      window.clearInterval(typeTimer);
      window.clearTimeout(enterTimer);
      window.clearInterval(checkTypedDone);
      typeTimer = 0;
      enterTimer = 0;
      checkTypedDone = 0;
    };

    const pauseVideoAudio = () => {
      videoEl.pause();
      videoEl.muted = true;
      try {
        videoEl.currentTime = 0;
      } catch {
        /* ignore seek errors before ready */
      }
    };

    const playAnime = async () => {
      // 动漫版：停掉介绍 BGM，只播 PV 音轨
      void setBgmTrack(null, { fadeMs: 280 });
      videoEl.muted = false;
      videoEl.loop = false;
      armVideoFrame();
      try {
        await videoEl.play();
      } catch {
        // 若仍被策略拦截，退回静音播画面 + intro BGM（仍不重叠双轨视频）
        videoEl.muted = true;
        void setBgmTrack('intro', { forceRestart: true, fadeMs: 400 });
        try {
          await videoEl.play();
        } catch {
          // 连静音都播不了：不回退到「露出视频」——那会重新带出原生大播放键。
          // 改为显示静态插画兜底，并保留 intro BGM。
          artEl.classList.add('is-active');
        }
      }
    };

    const playTextAudio = () => {
      pauseVideoAudio();
      void setBgmTrack('intro', { forceRestart: true, fadeMs: 500 });
    };

    const startTyping = () => {
      if (typingStarted) return;
      typingStarted = true;
      charIndex = 0;
      textEl.textContent = '';
      textEl.classList.remove('is-complete');
      typeTimer = window.setInterval(() => {
        if (closed || mode !== 'text') return;
        const step = 2;
        charIndex = Math.min(fullText.length, charIndex + step);
        textEl.textContent = fullText.slice(0, charIndex);
        copyEl.scrollTop = copyEl.scrollHeight;
        if (charIndex >= fullText.length) {
          window.clearInterval(typeTimer);
          typeTimer = 0;
          textEl.classList.add('is-complete');
        }
      }, 42);
      enterTimer = window.setTimeout(() => {
        if (!closed && mode === 'text') enterBtn.classList.remove('is-hidden');
      }, WORLD_INTRO_MIN_MS);
      checkTypedDone = window.setInterval(() => {
        if (charIndex >= fullText.length) {
          window.clearInterval(checkTypedDone);
          checkTypedDone = 0;
          if (WORLD_INTRO_MIN_MS <= 0 && mode === 'text') {
            enterBtn.classList.remove('is-hidden');
          }
        }
      }, 200);
    };

    const applyMode = (next: WorldIntroMode) => {
      mode = next;
      overlay.dataset.introMode = mode;
      const isAnime = mode === 'anime';

      videoEl.classList.toggle('is-active', isAnime);
      artEl.classList.toggle('is-active', !isAnime);
      veilEl.classList.toggle('is-light', isAnime);
      copyEl.classList.toggle('is-hidden', isAnime);

      modeBtn.textContent = isAnime ? '文字版' : '动漫版';
      modeBtn.setAttribute('aria-label', isAnime ? '切换到文字版' : '切换到动漫版');

      stopTyping();
      enterBtn.classList.add('is-hidden');
      if (isAnime) {
        void playAnime();
      } else {
        playTextAudio();
        typingStarted = false;
        startTyping();
      }
    };

    const finish = () => {
      if (closed) return;
      closed = true;
      stopTyping();
      window.clearTimeout(skipTimer);
      videoEl.onended = null;
      pauseVideoAudio();
      void setBgmTrack(null, { fadeMs: 500 });
      overlay.classList.add('is-leaving');
      window.setTimeout(() => {
        overlay.remove();
        resolve();
      }, 420);
    };

    modeBtn.addEventListener('click', () => {
      playUiSound('confirm');
      applyMode(mode === 'anime' ? 'text' : 'anime');
    });
    skipBtn.addEventListener('click', () => {
      playUiSound('cancel');
      finish();
    });
    enterBtn.addEventListener('click', () => {
      playUiSound('confirm');
      finish();
    });
    videoEl.addEventListener('ended', () => {
      if (closed || mode !== 'anime') return;
      // PV 播完后显示进入，也可直接结束；给用户一点确认感
      enterBtn.classList.remove('is-hidden');
    });

    host.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-visible'));

    skipTimer = window.setTimeout(() => {
      if (!closed) skipBtn.classList.remove('is-hidden');
    }, WORLD_INTRO_SKIP_AFTER_MS);

    applyMode(WORLD_INTRO_DEFAULT_MODE);
  });
}
