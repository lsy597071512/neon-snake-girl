/**
 * 唤醒协议 · 构装体招募（征召大厅）
 * 全屏抽卡页：动态背景 + 等级展柜 + 单抽/十连 + 召唤动画 + 结果揭晓。
 *
 * - 进入：showRecruitPage() 挂载全屏覆盖层；确认离开时回到上一个页面（调用者不需切 view）。
 * - 抽卡：沿用 performGachaPull / applyGachaResult 逻辑（金币/券、保底一致）。
 * - 演出：抽卡播 juesechoukajiemian_dong.mp4 全屏，结束后以「白光旋转·由小变大」
 *   形式逐个揭晓，结果卡按角色档案式竖排（图标在上、立绘在下），SR 蓝 / SSR 紫 / UR 金。
 */
import { saveManager } from '../core/SaveManager';
import { ECONOMY } from '../data/stages';
import { CHARACTER_MAP, CHARACTERS, GACHA_PITY } from '../data/characters';
import { performGachaPull, applyGachaResult, type GachaResult } from '../core/formulas';
import { texUrl } from '../utils/texUrl';
import { playUiSound } from './uiSound';

export const RECRUIT_BG_SRC = './tex/juesechouka/juesechoukajiemian.png';
/** 抽卡页动态背景（循环播放、静音）；RECRUIT_BG_SRC 保留作 poster 静帧与商店/军需官入口按钮图 */
export const RECRUIT_BG_VIDEO_SRC = './tex/juesechouka/juesechoukajiemian.mp4';
export const RECRUIT_CUTSCENE_SRC = './tex/juesechouka/juesechoukajiemian_dong.mp4';

/** 进入抽卡页时预加载召唤动画（商店页打开招募时调用） */
export function preloadRecruitCutscene(): void {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'video';
  link.href = texUrl(RECRUIT_CUTSCENE_SRC);
  link.type = 'video/mp4';
  document.head.appendChild(link);
}

/** 全屏播放召唤动画；首次不可跳过，之后右上角可跳过 */
export function playRecruitCutscene(options: {
  onComplete: () => void;
  onHideForResult?: () => void;
}): void {
  const overlay = document.createElement('div');
  overlay.className = 'recruit-cutscene';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '唤醒协议召唤');

  const video = document.createElement('video');
  video.className = 'recruit-cutscene-video';
  video.src = texUrl(RECRUIT_CUTSCENE_SRC);
  video.playsInline = true;
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('preload', 'auto');
  (video as HTMLVideoElement & { disablePictureInPicture?: boolean }).disablePictureInPicture = true;
  video.muted = false;
  video.defaultMuted = false;

  overlay.appendChild(video);

  let done = false;
  let watchdog = 0;
  const clearWatchdog = () => {
    if (watchdog) window.clearTimeout(watchdog);
    watchdog = 0;
  };
  const complete = () => {
    if (done) return;
    done = true;
    clearWatchdog();
    options.onHideForResult?.();
    overlay.classList.add('is-closing');
    window.setTimeout(() => {
      overlay.remove();
      options.onComplete();
    }, 260);
  };

  /**
   * 看门狗：后台标签页 / 原生自动播放被拒时 video 不会推进，
   * 按片长上限兜底揭晓，绝不把玩家卡在过场里。
   */
  const armWatchdog = (seconds: number) => {
    clearWatchdog();
    watchdog = window.setTimeout(() => {
      if (!video.paused || !video.ended) {
        video.pause();
        complete();
      }
    }, seconds * 1000 + 1500);
  };

  // 召唤动画 ~6s：1.2s 后允许跳过（视频自带音效，前 1s 不可打断）
  window.setTimeout(() => {
    if (!document.body.contains(overlay)) return;
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'recruit-cutscene-skip';
    skip.textContent = '跳过';
    skip.setAttribute('aria-label', '跳过召唤动画');
    overlay.appendChild(skip);
    skip.addEventListener('click', () => {
      playUiSound('cancel');
      video.pause();
      complete();
    });
  }, 1200);

  video.addEventListener('ended', complete, { once: true });
  video.addEventListener('error', complete, { once: true });

  document.body.appendChild(overlay);

  const start = () => {
    overlay.classList.add('is-visible');
    // duration 未知时先按 6s 兜底，拿到真实片长后按实长重置
    armWatchdog(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 6);
    void video.play().catch(() => {
      video.muted = true;
      void video.play().catch(complete);
    });
  };
  video.addEventListener(
    'loadedmetadata',
    () => {
      if (Number.isFinite(video.duration) && video.duration > 0) armWatchdog(video.duration);
    },
    { once: true },
  );
  // rAF 在后台标签页不触发，用双通道保证过场一定开始
  requestAnimationFrame(start);
  window.setTimeout(start, 60);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Rarity = 'SR' | 'SSR' | 'UR';

function rarityOf(charId: string): Rarity {
  const c = CHARACTER_MAP[charId];
  return c?.rarity === 'UR' ? 'UR' : c?.rarity === 'SSR' ? 'SSR' : 'SR';
}

function nameOf(charId: string): string {
  return CHARACTER_MAP[charId]?.name ?? charId;
}

export interface RecruitPageOptions {
  /** 离开展柜时回调（一般用于刷新商店页金币/券显示） */
  onExit?: () => void;
}

/** 等级展柜席位：UR 居中最大、SSR 前排两侧、SR 后排两列 —— 随机洗牌赋位，高等级永不沉底 */
interface RecruitSlot {
  charId: string;
  rarity: Rarity;
  delay: string;
  drift: string;
}

interface RecruitTier {
  cls: string;
  slots: RecruitSlot[];
}

function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * 三层纵深展柜（前排最大、后排最小）：
 *   前排  SSR · UR · SSR      ← 主体，UR 正中王座
 *   中排  SR · SSR · SR       ← 次席，SSR 居中被围
 *   后排  SR · SR             ← 远景，压暗做气势
 * 名额每轮随机轮换，高等级永远在前排大位。
 */
function buildTiers(): RecruitTier[] {
  const urs = CHARACTERS.filter((c) => c.rarity === 'UR').map((c) => c.id);
  const ssrs = CHARACTERS.filter((c) => c.rarity === 'SSR').map((c) => c.id);
  const srs = CHARACTERS.filter((c) => c.rarity === 'SR').map((c) => c.id);

  const urPick = shuffleArr(urs).slice(0, 1);
  const ssrPick = shuffleArr(ssrs).slice(0, 3);
  const srPick = shuffleArr(srs).slice(0, 4);

  const mk = (id: string, r: Rarity, i: number): RecruitSlot => ({
    charId: id,
    rarity: r,
    delay: `${(Math.random() * 0.9).toFixed(2)}s`,
    drift: `${(5 + Math.random() * 3).toFixed(1)}s`,
  });

  let srIdx = 0;
  const nextSr = () => srPick[srIdx++] ?? srPick[0]!;

  return [
    {
      cls: 'is-front',
      slots: [
        mk(ssrPick[0]!, 'SSR', 0),
        mk(urPick[0]!, 'UR', 1),
        mk(ssrPick[1]!, 'SSR', 2),
      ],
    },
    {
      cls: 'is-mid',
      slots: [mk(nextSr(), 'SR', 3), mk(ssrPick[2]!, 'SSR', 4), mk(nextSr(), 'SR', 5)],
    },
    {
      cls: 'is-back',
      slots: [mk(nextSr(), 'SR', 6), mk(nextSr(), 'SR', 7)],
    },
  ];
}

function portraitSrc(charId: string): string {
  return texUrl(CHARACTER_MAP[charId]?.portraitFront ?? './tex/juese/SR01_2.png');
}

/** 卡通小头像（角色专用头像图集，与档案/编队一致） */
function avatarSrc(charId: string): string {
  return texUrl(`./tex/juese/avatars/${charId}.png`);
}

export function showRecruitPage(opts: RecruitPageOptions = {}): void {
  document.querySelector('[data-recruit-page]')?.remove();
  const root = document.createElement('div');
  root.className = 'recruit-page';
  root.dataset.recruitPage = '1';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '唤醒协议 · 构装体招募');

  let tiers = buildTiers();
  let pulling = false;
  let resultTimers: number[] = [];

  const clearResultTimers = () => {
    while (resultTimers.length) {
      const id = resultTimers.pop();
      if (id != null) window.clearTimeout(id);
    }
  };

  const costText = (count: 1 | 10): string => {
    const gold = count === 1 ? ECONOMY.singlePullGold : ECONOMY.tenPullGold;
    const s = saveManager.get();
    return s.tickets >= count ? `${count}🎫` : `${gold}🪙`;
  };

  const canPull = (count: 1 | 10): boolean => {
    const s = saveManager.get();
    if (s.tickets >= count) return true;
    const gold = count === 1 ? ECONOMY.singlePullGold : ECONOMY.tenPullGold;
    return s.gold >= gold;
  };

  const renderStage = () => {
    const stage = root.querySelector('[data-recruit-stage]');
    if (!stage) return;
    // 后排在上、前排在下：视觉纵深由远及近
    stage.innerHTML = [...tiers]
      .reverse()
      .map(
        (tier) => `
        <div class="recruit-tier ${tier.cls}">
          ${tier.slots
            .map(
              (sl) => `
            <figure class="recruit-figure is-${sl.rarity.toLowerCase()}" style="--enter-delay:${sl.delay};--float-dur:${sl.drift}">
              <span class="recruit-figure-glow" aria-hidden="true"></span>
              <img class="recruit-figure-art" src="${escapeHtml(portraitSrc(sl.charId))}" alt="${escapeHtml(nameOf(sl.charId))}" draggable="false" />
              <span class="recruit-figure-shadow" aria-hidden="true"></span>
              <figcaption class="recruit-figure-tag">
                <i class="recruit-figure-rarity ${sl.rarity.toLowerCase()}">${sl.rarity}</i>
                <b>${escapeHtml(nameOf(sl.charId))}</b>
              </figcaption>
            </figure>`,
            )
            .join('')}
        </div>`,
      )
      .join('');
  };

  const renderHud = () => {
    const hud = root.querySelector('[data-recruit-hud]');
    if (!hud) return;
    const s = saveManager.get();
    hud.innerHTML = `
      <div class="recruit-wallet">
        <span class="recruit-wallet-item">🪙 <b>${s.gold}</b></span>
        <span class="recruit-wallet-item">🎫 <b>${s.tickets}</b></span>
      </div>`;
  };

  const renderPity = () => {
    const el = root.querySelector('[data-recruit-rates]');
    if (!el) return;
    const s = saveManager.get();
    el.innerHTML = `
      <span class="recruit-rate">SR 86%</span><i>·</i>
      <span class="recruit-rate is-ssr">SSR 12.5%</span><i>·</i>
      <span class="recruit-rate is-ur">UR 1.5%</span><i>·</i>
      <span class="recruit-rate">保底 ${GACHA_PITY}（当前 ${s.gachaPity}）</span>`;
  };

  const refreshButtons = () => {
    const one = root.querySelector<HTMLButtonElement>('[data-recruit-pull="1"]');
    const ten = root.querySelector<HTMLButtonElement>('[data-recruit-pull="10"]');
    if (one) {
      one.disabled = pulling || !canPull(1);
      one.querySelector('[data-cost]')!.textContent = costText(1);
    }
    if (ten) {
      ten.disabled = pulling || !canPull(10);
      ten.querySelector('[data-cost]')!.textContent = costText(10);
    }
  };

  const refreshAll = () => {
    renderHud();
    renderPity();
    refreshButtons();
  };

  const showToast = (msg: string) => {
    const el = root.querySelector<HTMLElement>('[data-recruit-toast]');
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    window.setTimeout(() => {
      if (el.textContent === msg) el.hidden = true;
    }, 2400);
  };

  /** 召唤动画结束后：揭晓结果 —— 白光爆发＋旋转＋由小变大，逐张飞入竖排卡 */
  const revealResults = (results: GachaResult[]) => {
    const layer = root.querySelector<HTMLElement>('[data-recruit-result]');
    if (!layer) return;
    const multi = results.length > 1;
    layer.hidden = false;
    layer.classList.add('is-open');
    layer.innerHTML = `
      <div class="recruit-result-veil" aria-hidden="true"></div>
      <div class="recruit-result-inner${multi ? ' is-multi' : ' is-single'}">
        <header class="recruit-result-head">
          <strong>${multi ? `构装体响应 ×${results.length}` : '构装体响应'}</strong>
          <small>唤醒协议 · 已记录</small>
        </header>
        <div class="recruit-result-grid">
          ${results
            .map((r, i) => {
              const rr = rarityOf(r.characterId);
              const cls = rr === 'UR' ? 'ur' : rr === 'SSR' ? 'ssr' : 'sr';
              return `
              <article class="recruit-card is-${cls}" style="--reveal-delay:${(i * 0.24).toFixed(2)}s">
                <span class="recruit-card-burst" aria-hidden="true"><i></i><i></i><i></i></span>
                <span class="recruit-card-flash" aria-hidden="true"></span>
                <div class="recruit-card-frame">
                  <span class="recruit-card-rarity">${rr}</span>
                  <div class="recruit-card-icon" aria-hidden="true">
                    <img class="recruit-card-avatar" src="${escapeHtml(avatarSrc(r.characterId))}" alt="" draggable="false" />
                  </div>
                  <img class="recruit-card-art" src="${escapeHtml(portraitSrc(r.characterId))}" alt="${escapeHtml(nameOf(r.characterId))}" draggable="false" />
                  <div class="recruit-card-foot">
                    <b>${escapeHtml(nameOf(r.characterId))}</b>
                    <small>${r.duplicate ? '重复 → 碎片+1' : '新加入'}</small>
                  </div>
                </div>
              </article>`;
            })
            .join('')}
        </div>
        <button type="button" class="recruit-result-confirm" data-recruit-confirm disabled>
          <span>确认</span>
        </button>
        <p class="recruit-result-hint">正在稳定信号…</p>
      </div>`;

    // 全部卡片揭晓完成后才允许确认（每张 0.24s 错峰 + 1.5s 演出）
    const totalMs = results.length * 240 + 1500;
    resultTimers.push(
      window.setTimeout(() => {
        const btn = layer.querySelector<HTMLButtonElement>('[data-recruit-confirm]');
        const hint = layer.querySelector<HTMLElement>('.recruit-result-hint');
        if (btn) btn.disabled = false;
        if (hint) hint.textContent = '点击确认，返回征召大厅';
        playUiSound('confirm');
      }, totalMs),
    );

    layer.querySelector('[data-recruit-confirm]')?.addEventListener('click', () => {
      playUiSound('tap');
      layer.classList.remove('is-open');
      layer.hidden = true;
      layer.innerHTML = '';
      clearResultTimers();
      pulling = false;
      refreshAll();
    });
  };

  const doPull = (count: 1 | 10) => {
    if (pulling) return;
    if (!canPull(count)) {
      playUiSound('cancel');
      showToast('锈币/抽卡券不足');
      return;
    }
    pulling = true;
    refreshButtons();
    playUiSound('confirm');

    const results: GachaResult[] = [];
    saveManager.mutate((d) => {
      const goldCost = count === 1 ? ECONOMY.singlePullGold : ECONOMY.tenPullGold;
      const useTicket = d.tickets >= count;
      if (!useTicket && d.gold < goldCost) return;
      if (useTicket) d.tickets -= count;
      else d.gold -= goldCost;
      for (let i = 0; i < count; i++) {
        const r = performGachaPull(d);
        applyGachaResult(d, r);
        results.push(r);
      }
    });

    if (!results.length) {
      pulling = false;
      showToast('锈币/抽卡券不足');
      refreshAll();
      return;
    }

    refreshAll();
    // 播放召唤动画 → 揭晓（末帧由揭晓接住）
    let revealed = false;
    playRecruitCutscene({
      onHideForResult: () => {
        revealed = true;
        revealResults(results);
      },
      onComplete: () => {
        if (!revealed) {
          pulling = false;
          refreshAll();
          return;
        }
        refreshButtons();
      },
    });
  };

  const reshuffle = () => {
    if (pulling) return;
    tiers = buildTiers();
    renderStage();
    refreshButtons();
  };

  root.innerHTML = `
    <div class="recruit-bg" aria-hidden="true">
      <video class="recruit-bg-img" src="${texUrl(RECRUIT_BG_VIDEO_SRC)}" poster="${texUrl(RECRUIT_BG_SRC)}"
        autoplay muted loop playsinline webkit-playsinline preload="auto" disablepictureinpicture></video>
      <span class="recruit-bg-shade"></span>
      <span class="recruit-bg-grain"></span>
      <span class="recruit-bg-beam"></span>
    </div>
    <div class="recruit-top">
      <button type="button" class="recruit-back" data-recruit-back aria-label="返回商店">← 返回</button>
      <div class="recruit-title">
        <h2>唤醒协议 · 构装体招募</h2>
      </div>
      <div class="recruit-hud" data-recruit-hud></div>
      <p class="recruit-rates" data-recruit-rates></p>
    </div>
    <div class="recruit-stage" data-recruit-stage aria-label="当前可招募构装体"></div>
    <p class="recruit-toast" data-recruit-toast hidden></p>
    <footer class="recruit-actions">
      <button type="button" class="recruit-pull is-single" data-recruit-pull="1">
        <span class="recruit-pull-label">单抽</span>
        <span class="recruit-pull-cost" data-cost></span>
      </button>
      <button type="button" class="recruit-pull is-ten" data-recruit-pull="10">
        <span class="recruit-pull-label">十连</span>
        <span class="recruit-pull-cost" data-cost></span>
      </button>
    </footer>
    <div class="recruit-result" data-recruit-result hidden></div>`;

  // 动态背景：autoplay 属性在部分 WebView 不生效时显式触发；失败则停在 poster 静帧，不影响流程
  const bgVideo = root.querySelector<HTMLVideoElement>('.recruit-bg-img');
  void bgVideo?.play().catch(() => undefined);

  root.querySelector('[data-recruit-back]')?.addEventListener('click', () => {
    playUiSound('cancel');
    exit();
    root.classList.add('is-leaving');
    window.setTimeout(() => {
      root.remove();
      opts.onExit?.();
    }, 240);
  });

  root.querySelector('[data-recruit-pull="1"]')?.addEventListener('click', () => doPull(1));
  root.querySelector('[data-recruit-pull="10"]')?.addEventListener('click', () => doPull(10));

  // 展柜漫游：每 9 秒轮换一次席位（渐隐渐现，非抽卡时）
  const shuffleTimer = window.setInterval(() => {
    if (!document.body.contains(root) || pulling) return;
    reshuffle();
  }, 9000);
  const stopShuffle = () => window.clearInterval(shuffleTimer);

  const onUnload = () => stopShuffle();
  window.addEventListener('pagehide', onUnload);

  const exit = () => {
    stopShuffle();
    window.removeEventListener('pagehide', onUnload);
    clearResultTimers();
  };

  document.body.appendChild(root);
  playUiSound('tap');
  renderStage();
  refreshAll();
  // 后台标签页/移动端切后台时 rAF 不触发，用双通道保证入场一定生效
  const reveal = () => root.classList.add('is-visible');
  requestAnimationFrame(reveal);
  window.setTimeout(reveal, 60);
}
