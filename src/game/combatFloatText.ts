import type { Camera } from 'three';
import { Vector3 } from 'three';

/** 3D 战斗飘字：伤害数字 / 技能名（屏幕空间 DOM） */

export type FloatTextKind = 'damage' | 'crit' | 'skill' | 'heal' | 'info';

interface FloatEntry {
  el: HTMLDivElement;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
  kind: FloatTextKind;
}

export class CombatFloatText {
  private readonly layer: HTMLDivElement;
  private readonly entries: FloatEntry[] = [];
  private readonly camera: Camera;
  private readonly parent: HTMLElement;
  private readonly ndc = new Vector3();

  constructor(parent: HTMLElement, camera: Camera) {
    this.parent = parent;
    this.camera = camera;
    this.layer = document.createElement('div');
    this.layer.className = 'combat-float-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.layer);
  }

  /** 在世界坐标处弹出文本；squadSlot 用于分角色伤害配色（0/1/2） */
  spawnWorld(
    world: { x: number; y: number; z: number },
    text: string,
    kind: FloatTextKind = 'damage',
    squadSlot?: number,
  ): void {
    if (kind === 'skill') return;
    this.ndc.set(world.x, world.y, world.z).project(this.camera);
    if (this.ndc.z > 1) return;
    const rect = this.parent.getBoundingClientRect();
    const x = (this.ndc.x * 0.5 + 0.5) * rect.width;
    const y = (-this.ndc.y * 0.5 + 0.5) * rect.height;
    this.spawnScreen(x, y, text, kind, squadSlot);
  }

  spawnScreen(
    x: number,
    y: number,
    text: string,
    kind: FloatTextKind = 'damage',
    squadSlot?: number,
  ): void {
    if (kind === 'skill') return;
    if (this.entries.length > 28) {
      const old = this.entries.shift();
      old?.el.remove();
    }
    const el = document.createElement('div');
    const slotClass =
      typeof squadSlot === 'number' && (kind === 'damage' || kind === 'crit')
        ? ` combat-float--slot${Math.max(0, Math.min(2, squadSlot))}`
        : '';
    el.className = `combat-float combat-float--${kind}${slotClass}`;
    el.textContent = text;
    el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    this.layer.appendChild(el);
    this.entries.push({
      el,
      life: 0,
      maxLife: kind === 'info' ? 1.1 : 0.85,
      vx: (Math.random() - 0.5) * 36,
      vy: -48 - Math.random() * 20,
      x,
      y,
      kind,
    });
  }

  update(dt: number): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      e.life += dt;
      const t = e.life / e.maxLife;
      if (t >= 1) {
        e.el.remove();
        this.entries.splice(i, 1);
        continue;
      }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.vy += 28 * dt;
      const opacity = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      const scale = kindScale(e.kind, t);
      e.el.style.opacity = String(Math.max(0, opacity));
      e.el.style.transform = `translate(-50%, -50%) translate(${e.x}px, ${e.y}px) scale(${scale})`;
    }
  }

  dispose(): void {
    for (const e of this.entries) e.el.remove();
    this.entries.length = 0;
    this.layer.remove();
  }
}

function kindScale(kind: FloatTextKind, t: number): number {
  if (kind === 'crit') return 1.15 + (1 - t) * 0.2;
  return 1 + (1 - t) * 0.1;
}
