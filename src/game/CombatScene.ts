import Phaser from 'phaser';
import type { StageDef } from '../types';
import { getSkillModifiers } from '../core/formulas';
import type { SkillEffectModifiers } from '../core/skillEffects';
import { computeCombatPassLimit } from './combatPassBudget';
import { mutateAiLiving } from '../ai/livingService';
import { applyCombatCyberHit } from '../systems/CyberHealthSystem';

export interface CombatSceneData {
  stage: StageDef;
  tcp: number;
  squadIds: string[];
  squadDamage?: Record<string, number>;
  autoMode: boolean;
  onComplete: (result: { victory: boolean; kills: number }) => void;
}

const LANES = [180, 360, 540];
const COLORS = {
  bg: 0x0a1420,
  lane: 0x122840,
  laneGlow: 0x1a4060,
  player: 0x2ecbff,
  enemy: 0x3a5060,
  enemyBoss: 0xff4757,
  barrel: 0xff8c42,
  door: 0xb57dff,
  bullet: 0x2ecbff,
  grid: 0x2ecbff,
};

export class CombatScene extends Phaser.Scene {
  private stage!: StageDef;
  private tcp = 0;
  private squadIds: string[] = [];
  private squadDamage: Record<string, number> = {};
  private autoMode = false;
  private onComplete!: CombatSceneData['onComplete'];

  private laneIndex = 1;
  private player!: Phaser.GameObjects.Rectangle;
  private bullets!: Phaser.GameObjects.Group;
  private enemies!: Phaser.GameObjects.Group;
  private hazards!: Phaser.GameObjects.Group;

  private kills = 0;
  private timeLeft = 0;
  private wave = 0;
  private maxWaves = 0;
  private spawnTimer = 0;
  private fireTimer = 0;
  private passCount = 0;
  private passLimit = 5;
  private comboKills = 0;
  private tripleCooldown = 0;
  private finished = false;

  private timerText!: Phaser.GameObjects.Text;
  private hpText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private skillMods: SkillEffectModifiers = getSkillModifiers([]);

  constructor() {
    super('CombatScene');
  }

  init(data: CombatSceneData): void {
    this.stage = data.stage;
    this.tcp = data.tcp;
    this.squadIds = data.squadIds;
    this.squadDamage = data.squadDamage ?? {};
    this.autoMode = data.autoMode;
    this.onComplete = data.onComplete;
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(COLORS.bg);

    this.skillMods = getSkillModifiers(this.squadIds);
    const dmgValues = this.squadIds.map((id) => this.squadDamage[id] ?? 1);
    const avgShotDamage =
      dmgValues.length > 0 ? dmgValues.reduce((a, b) => a + b, 0) / dmgValues.length : 1;
    this.passLimit = computeCombatPassLimit({
      stageId: this.stage.id,
      waves: this.stage.waves,
      isBoss: this.stage.isBoss,
      enemyDamage: this.stage.enemyDamage,
      recommendedTcp: this.stage.recommendedTcp,
      tcp: this.tcp,
      shieldBonus: this.skillMods.shieldBonus,
      attackSpeedBonus: this.skillMods.attackSpeedBonus,
      projectilePierce: this.skillMods.projectilePierce,
      ironRainEnabled: this.skillMods.ironRainEnabled,
      squadSize: this.squadIds.length,
      avgShotDamage,
    });
    this.passCount = 0;
    this.timeLeft = this.stage.timer;
    this.maxWaves = this.stage.waves;
    this.wave = 1;

    for (let i = 0; i < 3; i++) {
      this.add.rectangle(LANES[i], height / 2, 100, height, COLORS.lane, 0.5);
      this.add.rectangle(LANES[i], height / 2, 96, height, COLORS.laneGlow, 0.15);
    }

    this.player = this.add.rectangle(LANES[this.laneIndex], height - 120, 52, 52, COLORS.player);
    this.player.setStrokeStyle(2, 0xffffff, 0.9);

    this.bullets = this.add.group();
    this.enemies = this.add.group();
    this.hazards = this.add.group();

    this.timerText = this.add.text(16, 16, '', {
      fontFamily: 'Rajdhani, sans-serif',
      fontSize: '22px',
      color: '#ff4757',
      fontStyle: 'bold',
    });
    this.hpText = this.add.text(16, 46, '', {
      fontFamily: 'Rajdhani, sans-serif',
      fontSize: '18px',
      color: '#00e5ff',
    });
    this.infoText = this.add.text(width / 2, 14, this.stage.name, {
      fontFamily: 'Noto Sans SC, sans-serif',
      fontSize: '16px',
      color: '#eef2f8',
    }).setOrigin(0.5, 0);

    this.add.text(width - 16, 16, `TCP ${this.tcp}`, {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: '14px',
      color: '#ffd54f',
    }).setOrigin(1, 0);

    if (this.stage.type === 'door') this.spawnDoors();
    if (this.stage.type === 'barrel') this.spawnBarrels();

    this.setupInput();
    this.spawnWave();

    if (this.autoMode) {
      this.infoText.setText(`${this.stage.name} [自动]`).setColor('#90ee90');
    }
  }

  private setupInput(): void {
    this.input.keyboard?.on('keydown-LEFT', () => this.moveLane(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.moveLane(1));
    this.input.keyboard?.on('keydown-A', () => this.moveLane(-1));
    this.input.keyboard?.on('keydown-D', () => this.moveLane(1));

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.x < this.scale.width / 2) this.moveLane(-1);
      else this.moveLane(1);
    });
  }

  private moveLane(dir: number): void {
    if (this.finished) return;
    this.laneIndex = Phaser.Math.Clamp(this.laneIndex + dir, 0, 2);
    this.tweens.add({
      targets: this.player,
      x: LANES[this.laneIndex],
      duration: 120,
      ease: 'Power2',
    });
  }

  private spawnWave(): void {
    const count = 4 + this.wave + Math.floor(this.stage.id / 10);
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 300, () => this.spawnEnemy());
    }
    if (this.stage.isBoss && this.wave === this.maxWaves) {
      this.time.delayedCall(1500, () => this.spawnBoss());
    }
  }

  private spawnEnemy(): void {
    const lane = Phaser.Math.Between(0, 2);
    const e = this.add.rectangle(
      LANES[lane],
      -30,
      40,
      40,
      COLORS.enemy,
    ) as Phaser.GameObjects.Rectangle & { hp: number; lane: number };
    e.hp = this.stage.enemyHp;
    e.lane = lane;
    this.enemies.add(e);
  }

  private spawnBoss(): void {
    const e = this.add.rectangle(
      LANES[1],
      -60,
      100,
      80,
      COLORS.enemyBoss,
    ) as Phaser.GameObjects.Rectangle & { hp: number; lane: number; boss: boolean };
    e.hp = this.stage.enemyHp * 8;
    e.lane = 1;
    e.boss = true;
    this.enemies.add(e);
    this.infoText.setText('⚠ BOSS').setColor('#ff4757');
  }

  private spawnDoors(): void {
    const opts = [
      { label: '+20% 攻', bonus: 0.2 },
      { label: '+35% 攻', bonus: 0.35 },
    ];
    opts.forEach((o, i) => {
      const door = this.add.rectangle(LANES[i === 0 ? 0 : 2], 200, 80, 100, COLORS.door, 0.8);
      const txt = this.add.text(door.x, door.y, o.label, { fontSize: '14px', color: '#fff' }).setOrigin(0.5);
      door.setInteractive();
      door.on('pointerdown', () => {
        this.skillMods.attackSpeedBonus += o.bonus;
        txt.setText('✓').setColor('#90ee90');
        door.disableInteractive();
      });
      this.hazards.add(door);
    });
  }

  private spawnBarrels(): void {
    for (let i = 0; i < 3; i++) {
      const lane = i;
      const barrel = this.add.rectangle(LANES[lane], 150 + i * 80, 50, 50, COLORS.barrel);
      const hp = 3;
      (barrel as any).hits = hp;
      barrel.setInteractive();
      barrel.on('pointerdown', () => {
        (barrel as any).hits -= 1;
        if ((barrel as any).hits <= 0) {
          this.skillMods.attackSpeedBonus += 0.15;
          barrel.destroy();
          this.add.text(LANES[lane], 150 + i * 80, '💥', { fontSize: '24px' }).setOrigin(0.5);
        }
      });
      this.hazards.add(barrel);
    }
  }

  private fire(): void {
    const b = this.add.circle(this.player.x, this.player.y - 30, 6, COLORS.bullet);
    this.bullets.add(b);
  }

  private autoMove(): void {
    const nearest = this.getNearestEnemyLane();
    if (nearest !== null && nearest !== this.laneIndex) {
      this.moveLane(nearest > this.laneIndex ? 1 : -1);
    }
  }

  private getNearestEnemyLane(): number | null {
    let best: Phaser.GameObjects.Rectangle | null = null;
    let bestY = -1;
    this.enemies.children.each((child) => {
      const e = child as Phaser.GameObjects.Rectangle;
      if (e.y > bestY) {
        bestY = e.y;
        best = e;
      }
      return true;
    });
    return best ? (best as any).lane : null;
  }

  update(_time: number, delta: number): void {
    if (this.finished) return;

    this.timeLeft -= delta / 1000;
    this.timerText.setText(`⏱ ${Math.ceil(Math.max(0, this.timeLeft))}s`);
    this.hpText.setText(`通过 ${this.passCount}/${this.passLimit}`);

    if (this.autoMode) this.autoMove();

    const fireRate = 350 / (1 + this.skillMods.attackSpeedBonus);
    this.fireTimer += delta;
    if (this.fireTimer >= fireRate) {
      this.fireTimer = 0;
      this.fire();
      if (this.tripleCooldown <= 0 && this.comboKills >= 3) {
        this.time.delayedCall(100, () => this.fire());
        this.time.delayedCall(200, () => this.fire());
        this.tripleCooldown = 8000;
        this.comboKills = 0;
      }
    }
    if (this.tripleCooldown > 0) this.tripleCooldown -= delta;

    this.bullets.children.each((child) => {
      const b = child as Phaser.GameObjects.Arc;
      b.y -= 8;
      if (b.y < -20) b.destroy();
      return true;
    });

    this.enemies.children.each((child) => {
      const e = child as Phaser.GameObjects.Rectangle & { hp: number; lane: number; boss?: boolean };
      e.y += this.stage.isBoss && e.boss ? 1.2 : 2.5;

      if (Math.abs(e.x - this.player.x) < 40 && Math.abs(e.y - this.player.y) < 40) {
        e.destroy();
        this.passCount += 1;
        const hitId = this.squadIds[0];
        if (hitId) {
          mutateAiLiving((living) => {
            applyCombatCyberHit(living, hitId, this.stage.name);
          });
        }
        this.player.setFillStyle(0xff3333);
        this.time.delayedCall(120, () => {
          if (this.player?.active) this.player.setFillStyle(COLORS.player);
        });
        if (this.passCount > this.passLimit) this.endCombat(false);
        return true;
      }

      if (e.y > this.scale.height + 50) {
        e.destroy();
        this.passCount += 1;
        if (this.passCount > this.passLimit) this.endCombat(false);
      }
      return true;
    });

    this.physicsOverlap();

    if (this.enemies.countActive() === 0 && this.wave < this.maxWaves) {
      this.wave++;
      this.spawnWave();
    }

    if (this.enemies.countActive() === 0 && this.wave >= this.maxWaves) {
      this.endCombat(true);
    }
  }

  private physicsOverlap(): void {
    const dmgBase = this.tcp / 10;
    const crit = this.stage.isBoss ? 1 + this.skillMods.bossCritBonus : 1;

    this.bullets.children.each((bChild) => {
      const bullet = bChild as Phaser.GameObjects.Arc;
      this.enemies.children.each((eChild) => {
        const e = eChild as Phaser.GameObjects.Rectangle & { hp: number };
        if (!e.active || !bullet.active) return true;
        if (Phaser.Math.Distance.Between(bullet.x, bullet.y, e.x, e.y) < 30) {
          e.hp -= dmgBase * crit;
          bullet.destroy();
          if (e.hp <= 0) {
            e.destroy();
            this.kills++;
            this.comboKills++;
          }
        }
        return true;
      });
      return true;
    });
  }

  private endCombat(victory: boolean): void {
    if (this.finished) return;
    this.finished = true;

    const overlay = this.add.rectangle(
      this.scale.width / 2,
      this.scale.height / 2,
      this.scale.width,
      this.scale.height,
      0x000000,
      0.7,
    );
    const msg = this.add.text(
      this.scale.width / 2,
      this.scale.height / 2,
      victory ? '✅ 胜利' : '❌ 失败',
      {
        fontFamily: 'Noto Sans SC, sans-serif',
        fontSize: '36px',
        color: victory ? '#5dffa8' : '#ff4757',
      },
    ).setOrigin(0.5);

    this.time.delayedCall(1200, () => {
      overlay.destroy();
      msg.destroy();
      this.onComplete({ victory, kills: this.kills });
      this.scene.stop();
    });
  }
}

export function startCombat(
  game: Phaser.Game,
  data: CombatSceneData,
): void {
  game.scene.start('CombatScene', data);
}
