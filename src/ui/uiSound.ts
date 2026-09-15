export type UiSoundKind = 'tap' | 'tab' | 'confirm' | 'cancel' | 'battle' | 'reward';

let audioCtx: AudioContext | null = null;
let enabled = true;
let warmed = false;

function getCtx(): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null;
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.07,
  when = 0,
): void {
  const ctx = getCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function noiseClick(duration = 0.05, volume = 0.04): void {
  const ctx = getCtx();
  if (!ctx) return;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = buffer;
  gain.gain.value = volume;
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

export function setUiSoundEnabled(on: boolean): void {
  enabled = on;
}

export function isUiSoundEnabled(): boolean {
  return enabled;
}

export function warmUiSound(): void {
  if (warmed) return;
  warmed = true;
  tone(880, 0.01, 'sine', 0.0001);
}

export function playUiSound(kind: UiSoundKind): void {
  if (!enabled) return;
  switch (kind) {
    case 'tap':
      tone(920, 0.045, 'triangle', 0.05);
      noiseClick(0.03, 0.018);
      break;
    case 'tab':
      tone(760, 0.05, 'sine', 0.055);
      tone(980, 0.04, 'sine', 0.035, 0.025);
      break;
    case 'confirm':
      tone(620, 0.06, 'sine', 0.06);
      tone(880, 0.08, 'sine', 0.05, 0.05);
      break;
    case 'cancel':
      tone(420, 0.08, 'sine', 0.055);
      tone(320, 0.1, 'sine', 0.04, 0.04);
      break;
    case 'battle':
      tone(520, 0.07, 'square', 0.045);
      tone(780, 0.09, 'square', 0.04, 0.05);
      tone(1040, 0.12, 'square', 0.035, 0.1);
      break;
    case 'reward':
      tone(880, 0.07, 'sine', 0.05);
      tone(1175, 0.09, 'sine', 0.05, 0.06);
      tone(1568, 0.12, 'sine', 0.04, 0.12);
      break;
  }
}

function classifySound(target: Element): UiSoundKind {
  if (
    target.matches(
      '[data-action="fight"], [data-action="sweep"], .wl-banner-expedition, [data-goto="map"]',
    )
  ) {
    return 'battle';
  }
  if (target.matches('[data-close-reward], [data-confirm-ok], [data-close-reward], .btn-primary')) {
    return 'confirm';
  }
  if (target.matches('[data-confirm-cancel], .btn-danger, [data-combat-exit]')) {
    return 'cancel';
  }
  if (target.matches('.wl-nav-tab, .hub-nav-btn, [data-goto], .chip, .tab-bar button')) {
    return 'tab';
  }
  if (target.matches('[data-close-reward], [data-reward-overlay] .btn')) {
    return 'reward';
  }
  return 'tap';
}

export function bindUiSounds(root: ParentNode): void {
  if ((root as HTMLElement).dataset.uiSoundBound === '1') return;
  (root as HTMLElement).dataset.uiSoundBound = '1';

  root.addEventListener(
    'pointerdown',
    (e) => {
      const pe = e as PointerEvent;
      if (pe.button !== 0) return;
      const target = (e.target as HTMLElement).closest<HTMLElement>(
        'button, [role="button"], [data-goto], [data-action], .wl-side-btn, .wl-nav-tab, .hub-nav-btn, .portrait-flip-btn',
      );
      if (!target || target.hasAttribute('disabled') || target.dataset.noSound === 'true') return;
      warmUiSound();
      playUiSound(classifySound(target));
    },
    { capture: true, passive: true },
  );
}
