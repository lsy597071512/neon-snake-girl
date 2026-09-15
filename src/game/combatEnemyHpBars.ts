import type { Camera } from 'three';
import { Vector3 } from 'three';

export interface EnemyHpBarTarget {
  id: number;
  hp: number;
  maxHp: number;
  boss?: boolean;
  active: boolean;
  worldX: number;
  worldY: number;
  worldZ: number;
}

interface BarEntry {
  root: HTMLDivElement;
  fill: HTMLDivElement;
}

/** 敌人头顶血条（屏幕空间 DOM，跟随世界坐标） */
export class CombatEnemyHpBars {
  private readonly layer: HTMLDivElement;
  private readonly camera: Camera;
  private readonly parent: HTMLElement;
  private readonly ndc = new Vector3();
  private readonly bars = new Map<number, BarEntry>();

  constructor(parent: HTMLElement, camera: Camera) {
    this.parent = parent;
    this.camera = camera;
    this.layer = document.createElement('div');
    this.layer.className = 'combat-enemy-hp-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.layer);
  }

  sync(targets: readonly EnemyHpBarTarget[]): void {
    const activeIds = new Set<number>();

    for (const t of targets) {
      if (!t.active || t.maxHp <= 0) continue;
      activeIds.add(t.id);

      let bar = this.bars.get(t.id);
      if (!bar) {
        bar = this.createBar(!!t.boss);
        this.bars.set(t.id, bar);
      }

      const ratio = Math.max(0, Math.min(1, t.hp / t.maxHp));
      bar.fill.style.width = `${ratio * 100}%`;
      bar.root.classList.toggle('is-boss', !!t.boss);
      bar.root.classList.toggle('is-low', ratio > 0 && ratio <= 0.35);

      this.ndc.set(t.worldX, t.worldY, t.worldZ).project(this.camera);
      if (this.ndc.z > 1 || this.ndc.z < -1) {
        bar.root.hidden = true;
        continue;
      }

      const rect = this.parent.getBoundingClientRect();
      const x = (this.ndc.x * 0.5 + 0.5) * rect.width;
      const y = (-this.ndc.y * 0.5 + 0.5) * rect.height;
      bar.root.hidden = false;
      bar.root.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
    }

    for (const [id, bar] of this.bars) {
      if (!activeIds.has(id)) {
        bar.root.remove();
        this.bars.delete(id);
      }
    }
  }

  private createBar(boss: boolean): BarEntry {
    const root = document.createElement('div');
    root.className = `combat-enemy-hp${boss ? ' combat-enemy-hp--boss' : ''}`;
    const track = document.createElement('div');
    track.className = 'combat-enemy-hp-track';
    const fill = document.createElement('div');
    fill.className = 'combat-enemy-hp-fill';
    track.appendChild(fill);
    root.appendChild(track);
    this.layer.appendChild(root);
    return { root, fill };
  }

  dispose(): void {
    for (const bar of this.bars.values()) bar.root.remove();
    this.bars.clear();
    this.layer.remove();
  }
}
