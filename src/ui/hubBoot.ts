import { preloadHubAssets } from './hubAssets';

const BOOT_ID = 'hub-boot';

export function showHubBootOverlay(): HTMLElement {
  let el = document.getElementById(BOOT_ID);
  if (el) return el;

  el = document.createElement('div');
  el.id = BOOT_ID;
  el.className = 'hub-boot';
  el.innerHTML = `
    <div class="hub-boot-panel">
      <div class="hub-boot-title">锈带纪元</div>
      <div class="hub-boot-sub">RUST BELT ERA</div>
      <div class="hub-boot-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <span class="hub-boot-bar-fill"></span>
      </div>
      <div class="hub-boot-hint">正在加载废土背景…</div>
    </div>
  `;
  document.body.appendChild(el);
  return el;
}

export function updateHubBootProgress(ratio: number): void {
  const boot = document.getElementById(BOOT_ID);
  if (!boot) return;
  const pct = Math.round(ratio * 100);
  const fill = boot.querySelector('.hub-boot-bar-fill') as HTMLElement | null;
  const bar = boot.querySelector('.hub-boot-bar') as HTMLElement | null;
  if (fill) fill.style.width = `${pct}%`;
  if (bar) bar.setAttribute('aria-valuenow', String(pct));
}

export async function hideHubBootOverlay(): Promise<void> {
  const boot = document.getElementById(BOOT_ID);
  if (!boot) return;
  boot.classList.add('is-hiding');
  await new Promise((r) => window.setTimeout(r, 320));
  boot.remove();
}

/** 启动阶段：先加载主页背景资源，再进入游戏 */
export async function runHubBoot(): Promise<void> {
  const boot = showHubBootOverlay();
  try {
    await preloadHubAssets(updateHubBootProgress);
  } catch {
    const hint = boot.querySelector('.hub-boot-hint');
    if (hint) hint.textContent = '背景加载较慢，正在进入…';
    await new Promise((r) => window.setTimeout(r, 400));
  } finally {
    await hideHubBootOverlay();
  }
}
