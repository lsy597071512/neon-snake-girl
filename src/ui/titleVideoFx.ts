/**
 * 开始页视频状态机
 *
 * 四个 clip（全部 muted + playsinline，不要音效；BGM 一律由 syncBgmForView 决定）：
 *  - 冷启动入场 `diyici.mp4`  —— 每次启动（首次安装 / 关闭重开）先播它，结束后进入循环
 *  - 待机循环   `xunhuan.mp4` —— 常态循环（loop），首尾闭合
 *  - 点击过场   `jinru.mp4`   —— 页面上点任一按钮时先播它，结束后再执行按钮动作
 *  - 返回过场   `chuqu.mp4`   —— 从游戏内返回时，**先把开始页切好**（海报/按钮/开始页 BGM
 *                              立即生效），再在开始页舞台上播它；播完进入循环
 *
 * 层叠顺序（关键）：开始页舞台内三个 <video> 靠 z-index 固定 ——
 *   loop(1) < diyici(2) < jinru(3)
 * 否则后挂载的 loop 会盖住一次性过场（历史 BUG：jinru 播了但玩家看不到）。
 * chuqu 走独立的全屏覆盖层（.title-video-exit-layer），先切好开始页再盖上去播。
 *
 * 原生播放键：新版 Android WebView 已无法用 ::-webkit-media-controls 伪元素去掉暂停封面
 * 的大播放键，因此所有开始页视频在首帧真正播出（playing）前都加 `is-awaiting-play`
 * （全局 CSS 里 opacity:0 !important，只露出底下海报），playing/error 后自动显现。
 */

import { texUrl } from '../utils/texUrl';
import { TITLE_STILL_BOOT, TITLE_STILL_LOOP } from './titlePoster';

export const TITLE_DIYICI_SRC = './tex/poster-candidates/diyici.mp4';
export const TITLE_XUNHUAN_SRC = './tex/poster-candidates/xunhuan.mp4';
export const TITLE_JINRU_SRC = './tex/poster-candidates/jinru.mp4';
export const TITLE_CHUQU_SRC = './tex/poster-candidates/chuqu.mp4';

/** 单次过场兜底时长（视频异常不 ended 时也放行，绝不卡死） */
const ONESHOT_FALLBACK_MS = 9000;

function makeVideo(
  src: string,
  loop: boolean,
  zIndex: number,
  preload: 'auto' | 'metadata' | 'none' = 'auto',
): HTMLVideoElement {
  const v = document.createElement('video');
  v.className = 'title-video';
  v.src = texUrl(src);
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute('muted', '');
  v.setAttribute('webkit-playsinline', '');
  v.setAttribute('playsinline', '');
  v.setAttribute('preload', preload);
  v.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback');
  v.setAttribute('x-webkit-airplay', 'deny');
  v.setAttribute('disablepictureinpicture', '');
  v.loop = loop;
  v.autoplay = false;
  v.controls = false;
  v.setAttribute('aria-hidden', 'true');
  v.style.zIndex = String(zIndex);
  (v as HTMLVideoElement & { disablePictureInPicture?: boolean }).disablePictureInPicture = true;
  (v as HTMLVideoElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = true;
  // 原生播放键根治：首帧播出前整只隐藏，playing（或时间推进）后才允许显现
  const reveal = () => v.classList.remove('is-awaiting-play');
  v.addEventListener('playing', reveal);
  v.addEventListener('timeupdate', reveal);
  v.addEventListener('error', reveal);
  return v;
}

class TitleVideoFx {
  /** 待机循环（xunhuan） */
  private loopEl: HTMLVideoElement | null = null;
  /** 冷启动入场（diyici） */
  private bootEl: HTMLVideoElement | null = null;
  /** 按钮点击过场（jinru） */
  private clickEl: HTMLVideoElement | null = null;
  /** 游戏内返回过场（chuqu） */
  private exitEl: HTMLVideoElement | null = null;
  /** chuqu 专用全屏层：切页瞬间挡住旧画面/新海报，避免闪一下 */
  private exitLayer: HTMLDivElement | null = null;

  private stage: HTMLElement | null = null;

  private booted = false;
  private oneshotRunning = false;
  private pendingAction: (() => void) | null = null;
  /** 排队动作是否要先补播 jinru（点击发生在 diyici / 返回过场期间） */
  private pendingNeedsClickFx = false;
  private exiting = false;

  private ensureEls(): void {
    if (this.loopEl && this.bootEl && this.clickEl) return;
    this.loopEl = makeVideo(TITLE_XUNHUAN_SRC, true, 1);
    this.bootEl = makeVideo(TITLE_DIYICI_SRC, false, 2);
    this.clickEl = makeVideo(TITLE_JINRU_SRC, false, 3);
  }

  /** chuqu：app 级全屏覆盖层（盖住游戏画面，也挡住切页瞬间的海报） */
  private ensureExitLayer(): void {
    if (this.exitLayer && this.exitEl) return;
    const layer = document.createElement('div');
    layer.className = 'title-video-exit-layer';
    layer.setAttribute('aria-hidden', 'true');
    const v = makeVideo(TITLE_CHUQU_SRC, false, 1);
    layer.appendChild(v);
    (document.getElementById('app') ?? document.body).appendChild(layer);
    this.exitLayer = layer;
    this.exitEl = v;
  }

  private startLoop(): void {
    const el = this.loopEl;
    if (!el) return;
    this.setStageStill(TITLE_STILL_LOOP);
    el.classList.add('is-visible');
    try {
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
    if (el.paused) el.classList.add('is-awaiting-play');
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => void 0);
  }

  private ensureLoop(): void {
    const el = this.loopEl;
    if (!el) return;
    el.classList.add('is-visible');
    if (el.paused) {
      el.classList.add('is-awaiting-play');
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => void 0);
    }
  }

  /** 标题页渲染后调用：把视频挂到新舞台（重渲染不打断当前播放状态） */
  mountStage(stage: HTMLElement): void {
    this.ensureEls();
    this.stage = stage;
    // DOM 顺序 + z-index 双保险：循环在最底，过场依次盖在上面
    for (const el of [this.loopEl, this.bootEl, this.clickEl]) {
      if (el && el.parentNode !== stage) stage.appendChild(el);
    }
    // 垫底图与即将播放的 clip 对齐（同一次渲染内生效，先于浏览器绘制，不闪帧）
    this.setStageStill(this.booted ? TITLE_STILL_LOOP : TITLE_STILL_BOOT);

    // chuqu 流程自己接管起播，避免循环抢在过场前出现
    if (this.exiting) return;

    if (!this.booted) {
      // 冷启动/重开：先播 diyici，结束后进入循环
      this.booted = true;
      this.runOneShot(this.bootEl!, null, false);
      return;
    }
    if (this.oneshotRunning) return;
    this.ensureLoop();
  }

  /** 切换垫底静态图（视频首帧渲染前露出它，杜绝黑屏间隙） */
  private setStageStill(src: string): void {
    const img = this.stage?.closest('.title-screen')?.querySelector<HTMLImageElement>('img.title-poster');
    if (!img) return;
    const url = texUrl(src);
    if (img.getAttribute('src') !== url) img.src = url;
  }

  /** 等视频首帧真正上屏：timeupdate>0 + 双 rAF；带兜底超时，绝不卡死 */
  private waitForFirstFrame(el: HTMLVideoElement | null, timeoutMs = 2500): Promise<void> {
    if (!el) return Promise.resolve();
    if (!el.paused && el.currentTime > 0) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        el.removeEventListener('timeupdate', onTick);
        el.removeEventListener('playing', onTick);
        el.removeEventListener('error', done);
        resolve();
      };
      const onTick = () => {
        if (el.currentTime > 0) {
          window.requestAnimationFrame(() => window.requestAnimationFrame(done));
        }
      };
      const timer = window.setTimeout(done, timeoutMs);
      el.addEventListener('timeupdate', onTick);
      el.addEventListener('playing', onTick);
      el.addEventListener('error', done);
    });
  }

  /**
   * 点击按钮过场：先播 jinru，结束后执行 action。
   * 若正处一次性过场中，则把 action 排队，等本次过场结束（必要时补播 jinru）再执行。
   */
  playClick(action: () => void): void {
    this.ensureEls();
    if (this.oneshotRunning || this.exiting) {
      if (!this.pendingAction) this.pendingAction = action;
      this.pendingNeedsClickFx = true;
      return;
    }
    this.runOneShot(this.clickEl!, action, true);
  }

  /** 播放一支一次性过场（diyici / jinru），结束后执行 action 或进入循环 */
  private runOneShot(el: HTMLVideoElement, action: (() => void) | null, hideChrome: boolean): void {
    const screen = this.stage?.closest('.title-screen');
    if (hideChrome) screen?.classList.add('is-entering');
    this.oneshotRunning = true;
    this.pendingAction = action;
    el.classList.add('is-visible', 'is-awaiting-play');
    try {
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallback);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('error', onEnd);
      this.finishOneShot();
    };
    const onEnd = () => finish();
    const fallback = window.setTimeout(finish, ONESHOT_FALLBACK_MS);
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onEnd);
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      // 自动播放被拒：直接跳过过场，不卡住玩家
      p.catch(() => finish());
    }
  }

  private finishOneShot(): void {
    if (!this.oneshotRunning) return;
    this.oneshotRunning = false;
    this.bootEl?.classList.remove('is-visible');
    this.clickEl?.classList.remove('is-visible');
    this.stage?.closest('.title-screen')?.classList.remove('is-entering');
    this.resumeOrRunPending();
  }

  /**
   * 一次性过场结束后收口：
   * 有排队动作 → 需要补播 jinru 的补播一次再执行，否则直接执行；
   * 没有排队动作 → 进入 xunhuan 循环。
   */
  private resumeOrRunPending(): void {
    const action = this.pendingAction;
    const needsFx = this.pendingNeedsClickFx;
    this.pendingAction = null;
    this.pendingNeedsClickFx = false;
    if (!action) {
      this.startLoop();
      return;
    }
    if (needsFx && this.clickEl && !this.exiting) {
      this.runOneShot(this.clickEl, action, true);
      return;
    }
    action();
  }

  /**
   * 从游戏内返回该页面：
   * 1) 先盖上层（挡住游戏画面），立刻切页：开始页 BGM / 海报 / 按钮全部就位；
   * 2) 在开始页之上用全屏层播 chuqu（静音，BGM 保持开始页曲）；
   * 3) chuqu 播完**不立刻撤层**——层上仍定格 chuqu 末帧；先在层下起播 xunhuan，
   *    等它首帧真正渲染出来再撤层 → 层淡出即是两段画面的交叠，无黑屏间隙。
   */
  async playExitThen(showTitle: () => void): Promise<void> {
    if (this.exiting) {
      showTitle();
      return;
    }
    this.exiting = true;
    this.loopEl?.pause();
    this.loopEl?.classList.remove('is-visible');
    this.bootEl?.classList.remove('is-visible');
    this.clickEl?.classList.remove('is-visible');

    // ① 先盖上层（挡住游戏画面），立刻切页：开始页 BGM / 海报 / 按钮全部就位
    this.ensureExitLayer();
    this.exitLayer?.classList.add('is-visible');
    showTitle();
    await this.nextPaint();

    // ② 在开始页之上播 chuqu（静音，BGM 保持开始页曲）
    const el = this.exitEl;
    if (el) {
      await this.playStageClip(el);
      // ③ chuqu 末帧仍定格在层上；层下先把 xunhuan 起播，等首帧上屏再撤层（无缝）
      this.startLoop();
      await this.waitForFirstFrame(this.loopEl);
      this.exitLayer?.classList.remove('is-visible');
    } else {
      this.startLoop();
    }

    this.exiting = false;
    if (this.pendingAction) {
      // 返回过程中玩家已点了按钮：过场结束后补播 jinru 再执行
      this.resumeOrRunPending();
      return;
    }
    this.ensureLoop();
  }

  private playStageClip(el: HTMLVideoElement): Promise<void> {
    el.classList.add('is-visible', 'is-awaiting-play');
    try {
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        el.removeEventListener('ended', done);
        el.removeEventListener('error', done);
        resolve();
      };
      const timer = window.setTimeout(done, ONESHOT_FALLBACK_MS);
      el.addEventListener('ended', done);
      el.addEventListener('error', done);
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => done());
    });
  }

  /** 等一帧，确保新标题页已排版（video 已在舞台里）再起播过场 */
  private nextPaint(): Promise<void> {
    return new Promise((resolve) => {
      const t = window.setTimeout(resolve, 60);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.clearTimeout(t);
          resolve();
        });
      });
    });
  }

  /** 离开标题页：暂停舞台内视频省电（保留状态，回来可续） */
  pauseStage(): void {
    this.loopEl?.pause();
    this.bootEl?.pause();
    this.clickEl?.pause();
    this.exitEl?.pause();
  }
}

export const titleVideoFx = new TitleVideoFx();
