import { texUrl } from '../utils/texUrl';

let current: HTMLAudioElement | null = null;

export function stopCombatVo(): void {
  if (!current) return;
  current.pause();
  current.removeAttribute('src');
  current.load();
  current = null;
}

/** 播放预制战斗语音；新句打断旧句。失败静默（资源缺失不挡战斗） */
export function playCombatVo(src: string): void {
  if (!src) return;
  stopCombatVo();
  const audio = new Audio(texUrl(src));
  audio.preload = 'auto';
  current = audio;
  audio.onended = () => {
    if (current === audio) current = null;
  };
  audio.onerror = () => {
    if (current === audio) current = null;
  };
  void audio.play().catch(() => {
    if (current === audio) current = null;
  });
}
