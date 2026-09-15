import * as THREE from 'three';
import type { CombatQualityProfile } from './combatQuality';
import type { CombatTheme } from './combatThemes';
import { createGlowTexture, createSparkTexture, createShockRingTexture, createEnergyArcTexture, createTrailTexture, createShardTexture, createFrostTexture, createLightningTexture } from './textureUtils';
import { COMBAT_FIRE_DIR, orientSpriteAlongDir } from './combatVfxOrient';
import type { CharacterSkillId } from '../core/skillEffects';

interface ActiveVfx {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
  /** 重力加速度（负=下坠）。枪口/命中光晕等瞬时贴地为 0 */
  gy: number;
  /** 旋转角速度（弧度/秒）。0 = 不转 */
  vrot?: number;
  scaleDecay: number;
  /** 初始尺寸，用于按比例收缩，保住长条形贴图的纵横比 */
  sx0: number;
  sy0: number;
  /** 初始旋转弧度 */
  rot0?: number;
  /** 不透明度乘区（环境尘等半透明粒子） */
  alphaMul: number;
  /** 自定义淡出曲线（默认线性 1-t；可填 'easeOut'/'easeIn'） */
  ease?: 'linear' | 'easeOut' | 'easeIn';
}

interface MaterialTemplate {
  map: THREE.Texture;
  color: THREE.Color;
  blending: THREE.Blending;
}

/** Sprite 贴图类型键 */
type VfxTexKind = 'spark' | 'glow' | 'ring' | 'arc' | 'trail' | 'shard' | 'frost' | 'lightning';

export class VfxPool {
  private readonly scene: THREE.Scene;
  private readonly profile: CombatQualityProfile;
  private readonly theme: CombatTheme;
  private readonly pool: THREE.Sprite[] = [];
  private readonly active: ActiveVfx[] = [];
  /** 材质模板只建一次；每个池位持有独立材质实例，避免共享材质的 opacity 互踩 */
  private readonly templates = new Map<string, MaterialTemplate>();
  /** 贴图只创建一次；避免 spawn 时重复 Canvas 绘制占满 CPU */
  private readonly textureCache = new Map<string, THREE.Texture>();

  constructor(scene: THREE.Scene, profile: CombatQualityProfile, theme: CombatTheme) {
    this.scene = scene;
    this.profile = profile;
    this.theme = theme;
    this.warmPool(profile.maxVfxParticles);
  }

  private warmPool(count: number): void {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        transparent: true,
        // VFX are spawned on their source or target mesh. Do not let the mesh's
        // depth buffer hide them on mobile WebGL implementations.
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 1,
        // P2+：跳过 sRGB tone-mapping，避免任何 sprite 被推到 RGB(1,1,1) 形成白色爆闪。
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 10;
      sprite.visible = false;
      this.pool.push(sprite);
      this.scene.add(sprite);
    }
  }

  private getGlowMap(color: string, intensity: number): THREE.Texture {
    const id = `glow:${color}:${intensity}`;
    let tex = this.textureCache.get(id);
    if (!tex) {
      tex = createGlowTexture(color, intensity);
      this.textureCache.set(id, tex);
    }
    return tex;
  }

  private getSparkMap(color: string): THREE.Texture {
    const id = `spark:${color}`;
    let tex = this.textureCache.get(id);
    if (!tex) {
      tex = createSparkTexture(color);
      this.textureCache.set(id, tex);
    }
    return tex;
  }

  private getShockRingMap(color: string): THREE.Texture {
    const id = `ring:${color}`;
    let tex = this.textureCache.get(id);
    if (!tex) {
      tex = createShockRingTexture(color);
      this.textureCache.set(id, tex);
    }
    return tex;
  }

  private getEnergyArcMap(color: string): THREE.Texture {
    const id = `arc:${color}`;
    let tex = this.textureCache.get(id);
    if (!tex) {
      tex = createEnergyArcTexture(color);
      this.textureCache.set(id, tex);
    }
    return tex;
  }

  private getTrailMap(color: string): THREE.Texture {
    const id = `trail:${color}`;
    let tex = this.textureCache.get(id);
    if (!tex) {
      tex = createTrailTexture(color);
      this.textureCache.set(id, tex);
    }
    return tex;
  }

  private getShardMap(color: string): THREE.Texture {
    const id = `shard:${color}`;
    let tex = this.textureCache.get(id);
    if (!tex) {
      tex = createShardTexture(color);
      this.textureCache.set(id, tex);
    }
    return tex;
  }

  private getFrostMap(color: string): THREE.Texture {
    const id = `frost:${color}`;
    let tex = this.textureCache.get(id);
    if (!tex) {
      tex = createFrostTexture(color);
      this.textureCache.set(id, tex);
    }
    return tex;
  }

  private getLightningMap(color: string): THREE.Texture {
    const id = `lightning:${color}`;
    let tex = this.textureCache.get(id);
    if (!tex) {
      tex = createLightningTexture(color);
      this.textureCache.set(id, tex);
    }
    return tex;
  }

  /** 材质模板（共享贴图与配色），acquire 时拷贝进每个池位自己的材质 */
  private getTemplate(key: string, color: string, mapKind: VfxTexKind = 'spark', glowIntensity = 0.8): MaterialTemplate {
    const id = `${key}:${color}:${mapKind}:${glowIntensity}`;
    let tpl = this.templates.get(id);
    if (!tpl) {
      let tex: THREE.Texture;
      switch (mapKind) {
        case 'glow':
          tex = this.getGlowMap(color, glowIntensity);
          break;
        case 'ring':
          tex = this.getShockRingMap(color);
          break;
        case 'arc':
          tex = this.getEnergyArcMap(color);
          break;
        case 'trail':
          tex = this.getTrailMap(color);
          break;
        case 'shard':
          tex = this.getShardMap(color);
          break;
        case 'frost':
          tex = this.getFrostMap(color);
          break;
        case 'lightning':
          tex = this.getLightningMap(color);
          break;
        default:
          tex = this.getSparkMap(color);
      }
      // P2+：颜色通道上限 0.85——从 template 层治本，杜绝任何 #ffffff / 高亮白进入 sprite。
      const capColor = (raw: string): THREE.Color => {
        const c = new THREE.Color(raw);
        const CAP = 0.85;
        const m = Math.max(c.r, c.g, c.b);
        if (m > CAP) {
          const k = CAP / m;
          c.r *= k;
          c.g *= k;
          c.b *= k;
        }
        return c;
      };
      tpl = {
        map: tex,
        color: capColor(color),
        blending: THREE.AdditiveBlending,
      };
      this.templates.set(id, tpl);
    }
    return tpl;
  }

  private acquire(tpl: MaterialTemplate, critical = false): THREE.Sprite | null {
    if (this.active.length >= this.profile.maxVfxParticles) {
      if (!critical) return null;
      const oldest = this.active.shift();
      if (oldest) this.release(oldest.sprite);
    }
    const sprite = this.pool.find((s) => !s.visible) ?? null;
    if (!sprite) return null;
    const mat = sprite.material as THREE.SpriteMaterial;
    if (mat.map !== tpl.map) {
      mat.map = tpl.map;
      mat.needsUpdate = true;
    }
    mat.color.copy(tpl.color);
    if (mat.blending !== tpl.blending) {
      mat.blending = tpl.blending;
      mat.needsUpdate = true;
    }
    mat.opacity = 1;
    mat.toneMapped = false;
    sprite.visible = true;
    return sprite;
  }

  private release(sprite: THREE.Sprite): void {
    sprite.visible = false;
  }

  spawnMuzzle(camera: THREE.Camera, origin: THREE.Vector3, color = '#2ecbff'): void {
    // 主发光点
    const tpl = this.getTemplate('muzzle', color, 'glow', 0.7);
    const sprite = this.acquire(tpl);
    if (!sprite) return;
    sprite.position.copy(origin);
    orientSpriteAlongDir(sprite, camera, origin, COMBAT_FIRE_DIR, 0.7, 0.32);
    this.active.push({
      sprite,
      life: 0,
      maxLife: 0.1,
      vx: 0,
      vy: 0,
      vz: -2.5,
      gy: 0,
      scaleDecay: 4,
      sx0: 0.7,
      sy0: 0.32,
      alphaMul: 0.55,
      ease: 'easeOut',
    });
    // P2+：用户反馈"一闪一闪的蓝色 wifi 形图标"。spawnEnergyArc 的贴图就是 3 道同心弧线，
    // 每次开火都会在角色位置生成一个蓝色弧线 sprite —— 这正是用户看到的一闪一闪 wifi 图标。
    // 用户要求彻底去掉：直接 no-op，不再生成弧线尾焰。
    // this.spawnEnergyArc(origin.x, origin.y, origin.z, color, 0.9, 1);
  }

  spawnHit(x: number, y: number, z: number, boss = false): void {
    const color = boss ? '#ff4757' : '#88eeff';
    const tpl = this.getTemplate(`hit:${boss}`, color, 'glow', boss ? 0.85 : 0.6);
    const sprite = this.acquire(tpl);
    if (!sprite) return;
    sprite.position.set(x, y, z);
    const s = boss ? 1.2 : 0.7;
    sprite.scale.set(s, s, 1);
    this.active.push({
      sprite,
      life: 0,
      maxLife: 0.18,
      vx: 0,
      vy: 0,
      vz: 0,
      gy: 0,
      scaleDecay: 4.5,
      sx0: s,
      sy0: s,
      alphaMul: boss ? 0.7 : 0.55,
      ease: 'easeOut',
    });
  }

  /**
   * P2：纵向环波（贴地扩散圆环）。从中心 0→1 扩张，从 1→0 衰减。
   * 是命中/技能的"震荡"主源，给打击命中加上"震源"质感。
   */
  spawnShockRing(x: number, y: number, z: number, color: string, radius = 2.4, life = 0.32): void {
    const tpl = this.getTemplate(`ring:${color}`, color, 'ring');
    const sprite = this.acquire(tpl, true);
    if (!sprite) return;
    sprite.position.set(x, y, z);
    sprite.scale.set(0.05, 0.05, 1);
    this.active.push({
      sprite,
      life: 0,
      maxLife: life,
      vx: 0,
      vy: 0,
      vz: 0,
      gy: 0,
      scaleDecay: -radius / life,
      sx0: 0.05,
      sy0: 0.05 * (1 / 6), // ring 贴图宽高比 6:1（在 2D 是横长的椭圆，sprite 圆环时 scale 必须等比）
      alphaMul: 0.7,
      ease: 'easeOut',
    });
  }

  /**
   * P2+：用户反馈"彻底去掉所有角色的技能特效，其他的不要动"。
   * 整个方法体直接 no-op —— 铁雨震波不再产生 sprite 环波。
   * 保留方法签名 + 调用方（Combat3D.ts iron_rain）代码不破坏。 */
  spawnShockRingStack(x: number, y: number, z: number, primary: string, accent: string): void {
    void x; void y; void z; void primary; void accent;
    return;
  }

  /**
   * P2：贴地面飞的火花（受重力弧线落地）。命中 + 击杀的"残片"。
   * count 越大越华丽，最大别超过 8（粒子预算）。
   */
  spawnImpactSparks(x: number, y: number, z: number, color: string, count = 6): void {
    // P2+：用户反馈"一闪而过的特效全部移除" —— 影响点击反馈的 spark 也需降亮，
    // 防止多次叠加（同点 ≥3 个 sprite 出现）瞬间合成白点。
    // alphaMul 1.0 → 0.55；个体 size 0.18~0.36 → 0.16~0.28。
    for (let i = 0; i < count; i++) {
      const tpl = this.getTemplate(`sparks:${color}`, color, 'spark');
      const sprite = this.acquire(tpl);
      if (!sprite) break;
      const ang = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const sp = 3.5 + Math.random() * 2.5;
      const s = 0.16 + Math.random() * 0.12;
      sprite.position.set(x, y + 0.2, z);
      sprite.scale.set(s, s, 1);
      const vrot = (Math.random() - 0.5) * 12;
      const rot0 = Math.random() * Math.PI * 2;
      this.active.push({
        sprite,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.25,
        vx: Math.cos(ang) * sp * 0.45,
        vy: 1.2 + Math.random() * 2.0,
        vz: -Math.abs(Math.sin(ang) * sp * 0.6 + sp * 0.5),
        gy: -8,
        vrot,
        rot0,
        scaleDecay: 0.8,
        sx0: s,
        sy0: s,
        alphaMul: 0.55,
      });
    }
  }

  /**
   * P2：方形碎片（贴地翻滚、抛物）。击杀 + 暴击主元素。
   * 多放一组 (3~5 个) 比闪光的"残余"强很多。
   */
  spawnShards(x: number, y: number, z: number, color: string, count = 4): void {
    for (let i = 0; i < count; i++) {
      const tpl = this.getTemplate(`shard:${color}`, color, 'shard');
      const sprite = this.acquire(tpl);
      if (!sprite) return;
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 4.5 + Math.random() * 2;
      const s = 0.32 + Math.random() * 0.18;
      sprite.position.set(x, y + 0.3, z);
      sprite.scale.set(s, s, 1);
      const vrot = (Math.random() > 0.5 ? 1 : -1) * (8 + Math.random() * 10);
      const rot0 = Math.random() * Math.PI * 2;
      this.active.push({
        sprite,
        life: 0,
        maxLife: 0.55 + Math.random() * 0.35,
        vx: Math.cos(ang) * sp * 0.5,
        vy: 1.5 + Math.random() * 2.2,
        vz: -Math.abs(Math.sin(ang) * sp * 0.7 + sp * 0.4),
        gy: -7,
        vrot,
        rot0,
        scaleDecay: 0,
        sx0: s,
        sy0: s,
        alphaMul: 1,
      });
    }
  }

  /**
   * P2：六角冰晶（旋转、漂浮）。专给冻气/护盾这种"减速/静止"感用。
   */
  spawnFrostShards(x: number, y: number, z: number, color: string, count = 5): void {
    for (let i = 0; i < count; i++) {
      const tpl = this.getTemplate(`frost:${color}`, color, 'frost');
      const sprite = this.acquire(tpl);
      if (!sprite) return;
      const ang = (i / count) * Math.PI * 2;
      const sp = 1.2 + Math.random() * 1.4;
      const s = 0.45 + Math.random() * 0.25;
      sprite.position.set(x, y + 0.2, z);
      sprite.scale.set(s, s, 1);
      const vrot = (Math.random() - 0.5) * 3.5;
      const rot0 = Math.random() * Math.PI * 2;
      this.active.push({
        sprite,
        life: 0,
        maxLife: 0.7 + Math.random() * 0.3,
        vx: Math.cos(ang) * sp,
        vy: 0.6 + Math.random() * 0.8,
        vz: Math.sin(ang) * sp,
        gy: -2.5,
        vrot,
        rot0,
        scaleDecay: 0.4,
        sx0: s,
        sy0: s,
        alphaMul: 0.95,
        ease: 'easeOut',
      });
    }
  }

  /**
   * P2+：竖向闪电链（从空中劈下）。专给高能技能专用。
   * alphaMul 1 → 0.5；闪电贴图已去掉内核白线（见 textureUtils）。
   */
  spawnLightningBolt(x: number, y: number, z: number, color: string, length = 8): void {
    const tpl = this.getTemplate(`lightning:${color}`, color, 'lightning');
    const sprite = this.acquire(tpl, true);
    if (!sprite) return;
    sprite.position.set(x, y + length / 2, z);
    sprite.scale.set(1.0, length, 1);
    this.active.push({
      sprite,
      life: 0,
      maxLife: 0.16,
      vx: 0,
      vy: 0,
      vz: 0,
      gy: 0,
      scaleDecay: 0,
      sx0: 1.0,
      sy0: length,
      alphaMul: 0.5,
      ease: 'easeOut',
    });
  }

  /**
   * P2：能量弧线（沿水平方向的一道弧光），可与 muzzle 叠在一起形成"开火尾焰"。
   */
  spawnEnergyArc(x: number, y: number, z: number, color: string, length = 1.6, dirZ = 1): void {
    const tpl = this.getTemplate(`arc:${color}`, color, 'arc');
    const sprite = this.acquire(tpl);
    if (!sprite) return;
    sprite.position.set(x, y, z);
    sprite.scale.set(length, length, 1);
    // 弧线是横长贴图（128x128 等比），对齐 sprite 朝相机时已经正面；这里再绕 Z 旋转让它指向 dirZ
    sprite.material.rotation = Math.atan2(0, dirZ) + Math.PI / 2;
    this.active.push({
      sprite,
      life: 0,
      maxLife: 0.16,
      vx: 0,
      vy: 0,
      vz: -dirZ * 4,
      gy: 0,
      scaleDecay: 6,
      sx0: length,
      sy0: length,
      alphaMul: 0.7,
      ease: 'easeOut',
    });
  }

  /**
   * P2+：上升光柱（发亮的竖向带，给技能收尾留"余韵"）。
   * alphaMul 0.85 → 0.4；easeOut 防止停留满屏。
   */
  spawnLightPillar(x: number, y: number, z: number, color: string, height = 4, life = 0.4): void {
    const tpl = this.getTemplate(`pillar:${color}`, color, 'glow', 0.7);
    const sprite = this.acquire(tpl);
    if (!sprite) return;
    sprite.position.set(x, y + height / 2, z);
    sprite.scale.set(0.6, height, 1);
    this.active.push({
      sprite,
      life: 0,
      maxLife: life,
      vx: 0,
      vy: 0,
      vz: 0,
      gy: 0,
      scaleDecay: 0,
      sx0: 0.6,
      sy0: height,
      alphaMul: 0.4,
      ease: 'easeOut',
    });
  }

  /**
   * P2+：击杀爆点。
   * 之前 alphaMul=1 + glow 中心白色，击杀瞬间屏幕中心炸出白色扩散圈。
   * 改为：1) alphaMul 0.55；2) 不再使用 spark 的默认 glow，改用 spark 贴图保持色调统一。
   */
  spawnKillBurst(x: number, y: number, z: number, boss = false): void {
    // P2+：用户反馈"一闪而过的特效全部移除" —— 击杀爆点也要砍，避免
    // 多 sprite additive 叠加形成局部白爆。
    // 原 count boss=10 / 普通=6 → 砍到 5 / 3。
    // alphaMul 0.6 → 0.4；sprite size 缩到 0.18~0.30。
    const count = boss ? 5 : 3;
    const color = boss ? '#ff4757' : '#2ecbff';
    for (let i = 0; i < count; i++) {
      const tpl = this.getTemplate(`kill:${boss}`, color, 'spark');
      const sprite = this.acquire(tpl);
      if (!sprite) break;
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed = boss ? 4 + Math.random() * 2.5 : 2.5 + Math.random() * 2;
      const s = 0.18 + Math.random() * 0.12;
      sprite.position.set(x, y + 0.5, z);
      sprite.scale.set(s, s, 1);
      this.active.push({
        sprite,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.25,
        vx: Math.cos(angle) * speed * 0.22,
        vy: 0.15 + Math.random() * 0.25,
        vz: -Math.abs(Math.sin(angle) * speed * 0.55 + speed * 0.45),
        gy: -6,
        scaleDecay: 1.2,
        sx0: s,
        sy0: s,
        alphaMul: 0.4,
      });
    }
    // 碎片（取消环波）
    this.spawnShards(x, y + 0.3, z, color, boss ? 6 : 4);
  }

  /** P2+：升级版击杀（带抖动配合的"重型击杀"——碎片更多 + 大量火花）。
   * 之前 spawnImpactSparks(...,'#ffffff',6) 是白色爆闪主源。改为暖金色 #ffd28a 替代。*/
  spawnHeavyKillBurst(x: number, y: number, z: number, color: string): void {
    this.spawnShards(x, y + 0.3, z, color, 6);
    this.spawnImpactSparks(x, y + 0.4, z, '#ffd28a', 6);
    this.spawnImpactSparks(x, y + 0.4, z, color, 4);
  }

  /**
   * P2+：用户反馈"彻底去掉所有角色的技能特效，其他的不要动"。
   * 整个方法体直接 no-op —— 不再产生 5m 高的天空橙色光柱。
   * 保留方法签名 + 调用方代码不破坏（Combat3D iron_rain 仍在调）。 */
  spawnIronRainBeam(x: number, z: number, groundY: number, color = '#ff8840'): void {
    void x; void z; void groundY; void color;
    return;
  }

  /**
   * P2+：三连闪光。
   * 之前 i ∈ {-1,0,1} = 3 个发光球同时弹出 → 翠翼连闪触发时屏幕中心三重白闪。
   * 现在改成只放 1 个主元素 + 增加 2 个非发光的轻量副元素（避免重复主元素）。
   * alphaMul 也砍 1 → 0.5。
   */
  spawnTripleFlash(camera: THREE.Camera, x: number, y: number, z: number): void {
    // 主元素（1 个，居中）
    const tpl = this.getTemplate('triple', '#ffd54f', 'glow', 0.7);
    const sprite = this.acquire(tpl);
    if (!sprite) return;
    const origin = new THREE.Vector3(x, y, z - 0.2);
    sprite.position.copy(origin);
    orientSpriteAlongDir(sprite, camera, origin, COMBAT_FIRE_DIR, 0.65, 0.32);
    this.active.push({
      sprite,
      life: 0,
      maxLife: 0.12,
      vx: 0,
      vy: 0,
      vz: -1.5,
      gy: 0,
      scaleDecay: 4,
      sx0: 0.65,
      sy0: 0.32,
      alphaMul: 0.5,
      ease: 'easeOut',
    });
    // 副元素：2 个轻量 spark（用 spark 贴图，不用 glow）模拟"三连"但不爆闪
    for (const ox of [-0.35, 0.35]) {
      const sparkTpl = this.getTemplate('triple-spark', '#ffd54f', 'spark');
      const sp = this.acquire(sparkTpl);
      if (!sp) continue;
      sp.position.set(x + ox, y, z - 0.2);
      sp.scale.set(0.18, 0.18, 1);
      this.active.push({
        sprite: sp,
        life: 0,
        maxLife: 0.1,
        vx: 0,
        vy: 0,
        vz: -2,
        gy: 0,
        scaleDecay: 2,
        sx0: 0.18,
        sy0: 0.18,
        alphaMul: 0.7,
        ease: 'easeOut',
      });
    }
  }

  /**
   * P2+：技能主元素（发光球）。
   * 用户反馈"爆闪冲击屏幕"，已做：
   *  - 缩 scale 减半（2.0~2.4 → 1.0~1.3）
   *  - 砍 alphaMul 1.0 → 0.55（additive 上限砍 45%）
   *  - 加 easeOut 让它"亮一下即衰减"，避免停留满屏
   */
  spawnSkillBurst(x: number, y: number, z: number, color: string, scale = 1.0): void {
    const tpl = this.getTemplate(`skill:${color}`, color, 'glow', 0.7);
    const sprite = this.acquire(tpl, true);
    if (!sprite) return;
    sprite.position.set(x, y, z);
    sprite.scale.set(scale, scale, 1);
    this.active.push({ sprite, life: 0, maxLife: 0.42, vx: 0, vy: 0.4, vz: 0, gy: 0, scaleDecay: 1.6, sx0: scale, sy0: scale, alphaMul: 0.55, ease: 'easeOut' });

    for (let i = 0; i < 6; i++) {
      const sparkTpl = this.getTemplate(`skill-spark:${color}`, color);
      const s = this.acquire(sparkTpl);
      if (!s) break;
      const ang = (i / 6) * Math.PI * 2;
      const ss = 0.3;
      s.position.set(x, y, z);
      s.scale.set(ss, ss, 1);
      this.active.push({
        sprite: s,
        life: 0,
        maxLife: 0.4,
        vx: Math.cos(ang) * 2.2,
        vy: 0.8,
        vz: Math.sin(ang) * 1.2,
        gy: -3,
        scaleDecay: 2,
        sx0: ss,
        sy0: ss,
        alphaMul: 0.7,
        ease: 'easeOut',
      });
    }
    // 不再加环波；保留主元素 + 火花作为震感来源
  }

  /**
 * P2+：每个技能使用少量池化 Sprite 组成形状语言。
 * 用户反馈"爆闪冲击屏幕"——已移除/砍掉所有 burst + light pillar + lightning + iron rain beam
 *  （这些是 additive glow 大件，必造成白色爆闪）。震感来源改为：
 *   - 非发光主元素（shards / frost shards / impact sparks）
 *   - 单色环波（已去除居中白点）
 *   - shield pulse 1 个轻量脉冲
 * 命中率与剧情由 VFX 的"形状"传达，文字 banner 仍可读 summary。
 */
  /**
   * P2+：用户反馈"彻底去掉所有角色的技能特效，其他的不要动"。
   * 整个方法体直接 no-op——不再产生任何 2D sprite / 3D mesh。
   * 保留方法签名便于未来恢复。skillId / camera / x / y / z / target 全部 void 掉。
   * 调用方（Combat3D 6 处）继续传参，没有运行时错误。
   * 数字飘字（showSkillBanner）和屏幕震动（triggerScreenShake）由调用方单独触发，不动。 */
  spawnSkillEffect(
    skillId: CharacterSkillId,
    camera: THREE.Camera,
    x: number,
    y: number,
    z: number,
    target?: { x: number; y: number; z: number },
  ): void {
    void skillId; void camera; void x; void y; void z; void target;
    return;
  }

  // 兼容旧 spell 方法签名：保留别名以避免调用方破裂（虽然没有调用方了）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  spawnSkillFxLegacy(
    skillId: CharacterSkillId,
    camera: THREE.Camera,
    x: number,
    y: number,
    z: number,
    target?: { x: number; y: number; z: number },
  ): void {
    this.spawnSkillEffect(skillId, camera, x, y, z, target);
  }

  spawnPierceTrail(x: number, y: number, z: number): void {
    const tpl = this.getTemplate('pierce', '#ff5e8a', 'glow', 0.65);
    const sprite = this.acquire(tpl);
    if (!sprite) return;
    sprite.position.set(x, y, z);
    sprite.scale.set(1.1, 0.35, 1);
    this.active.push({ sprite, life: 0, maxLife: 0.22, vx: 0, vy: 0, vz: -4, gy: 0, scaleDecay: 3, sx0: 1.1, sy0: 0.35, alphaMul: 0.55, ease: 'easeOut' });
  }

  spawnShieldPulse(x: number, y: number, z: number, color = '#b8e0ff'): void {
    const tpl = this.getTemplate(`shield:${color}`, color, 'glow', 0.5);
    const sprite = this.acquire(tpl);
    if (!sprite) return;
    sprite.position.set(x, y + 0.4, z);
    sprite.scale.set(1.6, 1.6, 1);
    this.active.push({ sprite, life: 0, maxLife: 0.5, vx: 0, vy: 0.2, vz: 0, gy: 0, scaleDecay: 0.6, sx0: 1.6, sy0: 1.6, alphaMul: 0.55, ease: 'easeOut' });
  }

  spawnAmbientDust(count: number): void {
    if (count <= 0) return;
    for (let i = 0; i < count; i++) {
      const tpl = this.getTemplate('dust', this.theme.dustHex);
      const sprite = this.acquire(tpl);
      if (!sprite) break;
      const s = 0.08 + Math.random() * 0.12;
      sprite.position.set((Math.random() - 0.5) * 14, 1 + Math.random() * 8, -20 - Math.random() * 60);
      sprite.scale.set(s, s, 1);
      this.active.push({
        sprite,
        life: 0,
        maxLife: 2 + Math.random() * 3,
        vx: (Math.random() - 0.5) * 0.4,
        vy: 0.1 + Math.random() * 0.2,
        vz: 2 + Math.random() * 2,
        gy: 0,
        scaleDecay: 0,
        sx0: s,
        sy0: s,
        alphaMul: 0.25 + Math.random() * 0.35,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const v = this.active[i];
      v.life += dt;
      if (v.life >= v.maxLife) {
        this.release(v.sprite);
        this.active.splice(i, 1);
        continue;
      }
      const t = v.life / v.maxLife;
      v.sprite.position.x += v.vx * dt;
      v.sprite.position.y += v.vy * dt;
      v.sprite.position.z += v.vz * dt;
      v.vy += v.gy * dt;
      // 旋转（弧形/碎片）
      if (v.vrot) v.sprite.material.rotation = (v.rot0 ?? 0) + v.vrot * v.life;
      // 淡出曲线
      let fade: number;
      switch (v.ease) {
        case 'easeOut':
          fade = 1 - t * t; // 开头亮、收尾快
          break;
        case 'easeIn':
          fade = (1 - t) * (1 - t);
          break;
        default:
          fade = 1 - t;
      }
      (v.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, fade) * v.alphaMul;
      if (v.scaleDecay > 0 && v.sx0 > 0.0001) {
        // 长轴先行收缩、短轴按初始纵横比跟随——长条形枪口/拖尾不再被压成方块
        const sx = Math.max(0.05, v.sx0 - v.scaleDecay * v.life);
        const ratio = Math.max(0.05 / v.sx0, sx / v.sx0);
        v.sprite.scale.set(sx, Math.max(0.05, v.sy0 * ratio), 1);
      } else if (v.scaleDecay < 0 && v.sx0 > 0.0001) {
        // 负值 = 扩张（如冲击波/能量从中心向外张开）
        const grow = -v.scaleDecay * v.life;
        const sx = Math.min(v.sx0 * 4, v.sx0 + grow);
        const ratio = sx / v.sx0;
        v.sprite.scale.set(sx, Math.max(0.05, v.sy0 * ratio), 1);
      }
      if (v.sprite.position.z > 12) {
        v.sprite.position.z = -70 - Math.random() * 30;
        v.sprite.position.x = (Math.random() - 0.5) * 14;
      }
    }
  }

  dispose(): void {
    for (const v of this.active) this.release(v.sprite);
    this.active.length = 0;
    for (const sprite of this.pool) {
      this.scene.remove(sprite);
      (sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.pool.length = 0;
    for (const tex of this.textureCache.values()) tex.dispose();
    this.textureCache.clear();
    this.templates.clear();
  }
}
