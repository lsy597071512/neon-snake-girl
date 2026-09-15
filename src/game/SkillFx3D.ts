import * as THREE from 'three';
import type { CharacterSkillId } from '../core/skillEffects';

/**
 * P2+：治本常量——颜色通道上限。
 * SkillFx3D 全部使用 MeshBasicMaterial + AdditiveBlending + 大 opacity（0.85~1），
 * 任意 RGB 通道 ≥ 1.0 在 additive 叠加下都会把屏幕推成白色爆闪。
 * 此处把传入 color/accent 一律压到 ≤ 0.85，从源头杜绝技能特效白色爆闪。
 */
const FX_COLOR_CAP = 0.85;

/**
 * 角色技能 3D 几何包装层
 *
 * 之前所有技能特效都是 2D Sprite（`spawnSkillBurst / spawnLightPillar / spawnImpactSparks` …），
 * 俯视角下就是"贴纸"，缺乏空间立体感——尤其 `frost / pierce / shield / judgment / pulse`
 * 这种"应该围绕角色身体出现"的几何语义，平面贴图完全看不出来。
 *
 * 本模块用真正的 3D Mesh（CylinderGeometry / TorusGeometry / SphereGeometry / ConeGeometry），
 * 给每个 shapeKind 提供"角色专属外壳"，与 Sprite 层并行渲染，透明叠加。
 *
 * - 不替代 VfxPool 的 Sprite 主光效（那是打基础），只在其外再加一层**几何感**包装
 * - 全部 `MeshBasicMaterial + AdditiveBlending + depthWrite=false`，零光照开销，移动端友好
 * - 自动管理生命周期：到时间自动 `dispose + remove`
 */

export type SkillShapeKind =
  | 'frost'
  | 'spark'
  | 'pierce'
  | 'rain'
  | 'shield'
  | 'judgment'
  | 'pulse';

interface ActiveShell {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  materials: THREE.MeshBasicMaterial[];
  life: number;
  maxLife: number;
  /** 每秒角速度（弧度）。绕 Y 轴旋转展示 */
  spin: number;
  /**
   * 由 spawn 时计算的"基准缩放倍率"（referenceHeight/2.2 × CASTER_FX_SIZE_MUL）。
   * update 每帧 group.scale = baseScale × popScale × shrink，避免被弹出/淡出动画覆盖掉。
   */
  baseScale: number;
  /** 缩放从 0 弹出到 1 的速度系数 */
  popIn: number;
  /**
   * 跟随回调（可选）：每帧调用，返回当前世界坐标。
   * 用于让特效跟着施法角色/目标移动。返回 null/false 表示本帧不更新位置。
   */
  follow?: () => { x: number; y: number; z: number } | null | false;
  /**
   * spawn 时的位置（follow 不调用或返回 null 时回退到 group.position，由 spawn 时已经 set）。
   * 可选：旧版 spawn 没设；但 spawn 入口会补上，保持向后兼容。
   */
  origin?: { x: number; y: number; z: number };
}

export class SkillFx3D {
  private readonly scene: THREE.Scene;
  private readonly active: ActiveShell[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** 角色特效设计时的"标准身高"参考值（单位：世界坐标） */
  private static readonly REFERENCE_HEIGHT = 2.2;

  /**
   * 主入口：根据技能 ID 触发对应的 3D 包装。
   * @param referenceHeight 施法角色在场景中的真实渲染身高（米）。特效整体 group 会按
   *   `referenceHeight / 2.2` 缩放，确保任何体型角色下特效大小都"贴合角色"。
   *   不传则用 fallback 2.2。
   */
  /**
   * 角色特效整体尺寸系数：用于在"贴角色"基础上做整体缩放。
   * P2 微调：将作用于角色身上的特效再缩约 50%（用户要求）。
   */
  /** CASTER_FX_SIZE_MUL：贴角色特效的整体倍率（用户二次缩小反馈）。
   *  此前为 0.5，被 update 每帧覆盖不生效；本次再 ×1/3 → 0.167 ≈ 缩小到 1/6。 */
  private static readonly CASTER_FX_SIZE_MUL = 0.5 * (1 / 3);

  spawn(
    skillId: CharacterSkillId,
    x: number,
    y: number,
    z: number,
    color: string,
    accent: string,
    target?: { x: number; y: number; z: number },
    referenceHeight: number = SkillFx3D.REFERENCE_HEIGHT,
    follow?: () => { x: number; y: number; z: number } | null | false,
  ): void {
    // P2+：用户反馈"每个角色的几何大型特效（套筒/光柱/锥/球壳/十字/光环）覆盖在
    // 战斗画面上看起来突兀且容易和 2D 数字飘字互相干扰"——
    // 因此这里**直接 no-op**：不再创建任何 3D 几何（套筒/光柱/球壳/十字/倒锥/光环）。
    // 战斗视觉回到：仅 2D 粒子（VfxPool 的 spark/glow/ring sprite）+ 数字飘字 + 受击飘字。
    // 调用方仍可继续传 skillId，未来想恢复单个特效只需去掉本行 return。
    void skillId; void x; void y; void z; void color; void accent; void target;
    void referenceHeight; void follow;
    return;
  }

  /** 每帧驱动所有活动 shell 的生命周期。Combat3D 在 update() 调用一次即可 */
  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.life += dt;
      const t = Math.min(1, a.life / a.maxLife);

      // 弹出动画：前 20% 从 0 弹出到 1.0；总倍率 = baseScale × popScale × shrink
      const popT = Math.min(1, a.life / (a.maxLife * 0.2));
      const popScale = popT < 1 ? easeOutBack(popT) : 1;
      a.group.scale.setScalar(a.baseScale * popScale * (1 - t * 0.1));

      // 跟随施法者/目标：每帧同步 group.position。
      // 取消 "spawn 一次就钉死在出生点" 的旧行为，让特效跟着角色移动一起跑。
      if (a.follow) {
        const p = a.follow();
        if (p) {
          a.group.position.set(p.x, p.y, p.z);
        }
      }

      // 旋转
      if (a.spin !== 0) {
        a.group.rotation.y += a.spin * dt;
      }

      // 透明度曲线（消除爆闪）：
      //   前 25%  从 0 缓升到上限
      //   25%~60% 维持上限
      //   60%~100% 平滑淡出到 0
      // 整体封顶 MAX_OPACITY，且不开启 toneMapped（避免 sRGB 重建把 0.45 提升成白色）。
      // 真正修复"白色爆闪"靠这两点 + 全程不让任何材质 opacity 越过封顶。
      const MAX_OPACITY = 0.42;
      let env: number;
      if (t < 0.25) {
        env = t / 0.25; // 0 → 1
      } else if (t < 0.6) {
        env = 1;
      } else {
        env = 1 - (t - 0.6) / (1 - 0.6); // 1 → 0
      }
      const opacity = env * MAX_OPACITY;
      for (const m of a.materials) {
        m.opacity = opacity;
        m.toneMapped = false;
      }

      if (a.life >= a.maxLife) {
        for (const m of a.meshes) {
          this.scene.remove(m);
          m.geometry.dispose();
        }
        for (const mat of a.materials) {
          mat.dispose();
        }
        this.active.splice(i, 1);
      }
    }
  }

  /** 关卡结束 / 切场景时清理所有进行中的 shell */
  dispose(): void {
    for (const a of this.active) {
      for (const m of a.meshes) {
        this.scene.remove(m);
        m.geometry.dispose();
      }
      for (const mat of a.materials) {
        mat.dispose();
      }
    }
    this.active.length = 0;
  }

  // ============== 7 种 shapeKind 几何包装 ==============

  /**
   * frost（夜爪撕裂）：双层套筒——外层冰蓝色玻璃柱 + 内层白色冰锥（冰霜向上凝结）
   */
  private spawnFrostShell(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    // 基准：以角色身高 = 1 为设计参考（外筒半径 0.55、总高 1.6）；scale 由 referenceHeight 放大
    const g = new THREE.Group();
    g.position.set(x, y, z);
    // 外层套筒：略宽、半透（直径≈角色 1.1×）
    const outerMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.4, 24, 1, true), outerMat);
    outer.position.y = 0.7;
    // 内层套筒：白色高亮、稍高
    const innerMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.7, 16, 1, true), innerMat);
    inner.position.y = 0.85;
    // 顶冠：冰锥（圆锥朝上）
    const capMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.55, 16), capMat);
    cap.position.y = 1.95;
    // 底环：发光环（薄圈）
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.03, 8, 32), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;

    [outer, inner, cap, ring].forEach((m) => g.add(m));
    this.scene.add(g);
    this.active.push({
      group: g,
      meshes: [outer, inner, cap, ring],
      materials: [outerMat, innerMat, capMat, ringMat],
      life: 0,
      maxLife: 1.6,
      spin: 0.8,
      popIn: 1,
      baseScale: scale,
    });
  }

  /**
   * spark（翠翼连闪）：三道光柱（每道一柱）——绿色细长柱从角色向上射出
   */
  private spawnSparkShell(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    // 三柱间距 0.18（紧贴身体），柱高 ≈ 角色身高 1.2 倍
    const offsets = [-0.18, 0, 0.18];
    const mats: THREE.MeshBasicMaterial[] = [];
    const meshes: THREE.Mesh[] = [];
    for (const ox of offsets) {
      const mat = new THREE.MeshBasicMaterial({
        color: ox === 0 ? accent : color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 12), mat);
      pillar.position.set(ox, 0.85, 0);
      g.add(pillar);
      mats.push(mat);
      meshes.push(pillar);
    }
    // 底部光球
    const orbMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), orbMat);
    orb.position.y = 0.22;
    g.add(orb);
    mats.push(orbMat);
    meshes.push(orb);

    this.scene.add(g);
    this.active.push({
      group: g,
      meshes,
      materials: mats,
      life: 0,
      maxLife: 1.2,
      spin: 0,
      popIn: 1,
      baseScale: scale,
    });
  }

  /**
   * pierce（绯尾贯穿）：一条沿 Z 方向延伸的细长六棱柱（贯穿残影），粉红
   */
  private spawnPierceShell(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    const g = new THREE.Group();
    g.position.set(x, y + 0.5, z);
    // 长条"贯穿柱"——总长约角色身高 3 倍，向前延伸
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.03, 2.6, 12), mat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 1.0;
    g.add(shaft);
    // 顶端尖锥
    const tipMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 12), tipMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 2.5;
    g.add(tip);
    // 尾部光点（贴近身体）
    const tailMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), tailMat);
    tail.position.z = 0;
    g.add(tail);

    this.scene.add(g);
    this.active.push({
      group: g,
      meshes: [shaft, tip, tail],
      materials: [mat, tipMat, tailMat],
      life: 0,
      maxLife: 0.8,
      spin: 0,
      popIn: 1,
      baseScale: scale,
    });
  }

  /**
   * rain（锻渣雨幕）：上空巨型熔渣锥 + 落地冲击环
   */
  private spawnRainShell(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    // 上空倒置熔渣锥：底径 ≈ 角色身高 1×，总高 ≈ 角色身高 1.5×
    const coneMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.4, 16), coneMat);
    cone.position.y = 2.1;
    cone.rotation.x = Math.PI;
    g.add(cone);
    // 锥体底圈（环）
    const topRingMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.04, 8, 24), topRingMat);
    topRing.rotation.x = Math.PI / 2;
    topRing.position.y = 2.7;
    g.add(topRing);
    // 地面冲击环（粗环）
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 8, 32), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);

    this.scene.add(g);
    this.active.push({
      group: g,
      meshes: [cone, topRing, ring],
      materials: [coneMat, topRingMat, ringMat],
      life: 0,
      maxLife: 1.4,
      spin: 1.2,
      popIn: 1,
      baseScale: scale,
    });
  }

  /**
   * shield（冰华护壳）：球形冰晶护盾——双层球壳（外蓝内白）
   */
  private spawnShieldShell(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    const g = new THREE.Group();
    g.position.set(x, y + 0.55, z);
    // 双层球壳：外球半径 ≈ 角色身高 0.7×
    const outerMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      wireframe: true,
    });
    const outer = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), outerMat);
    g.add(outer);
    // 内层白球壳（实心但半透）
    const innerMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.65, 24, 16), innerMat);
    g.add(inner);
    // 赤道环（水平旋转的扁平环，强化"盾"的几何感）
    const ringMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.025, 8, 48), ringMat);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);

    this.scene.add(g);
    this.active.push({
      group: g,
      meshes: [outer, inner, ring],
      materials: [outerMat, innerMat, ringMat],
      life: 0,
      maxLife: 1.8,
      spin: 0.6,
      popIn: 1,
      baseScale: scale,
    });
  }

  /**
   * judgment（光轮裁决）：金黄天罚——从天而降的粗壮光柱 + 顶端"神罚十字"
   */
  private spawnJudgmentShell(
    x: number,
    y: number,
    z: number,
    color: string,
    accent: string,
    target?: { x: number; y: number; z: number },
    scale = 1,
  ): void {
    const p = target ?? { x, y, z };
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    // 主光柱：半径 ≈ 角色身高 0.4×、柱高 ≈ 角色身高 3.5×
    const pillarMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 3.5, 20), pillarMat);
    pillar.position.y = 1.75;
    g.add(pillar);
    // 顶端十字架（两条交叉的细圆柱）
    const crossMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const crossH = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 12), crossMat);
    crossH.rotation.z = Math.PI / 2;
    crossH.position.y = 3.7;
    g.add(crossH);
    const crossV = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 12), crossMat);
    crossV.position.y = 3.7;
    g.add(crossV);
    // 底圈（金色冲击圈）
    const ringMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 32), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
    // 顶端金色光球
    const orbMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), orbMat);
    orb.position.y = 3.7;
    g.add(orb);

    this.scene.add(g);
    this.active.push({
      group: g,
      meshes: [pillar, crossH, crossV, ring, orb],
      materials: [pillarMat, crossMat, ringMat, orbMat],
      life: 0,
      maxLife: 1.4,
      spin: 0,
      popIn: 1,
      baseScale: scale,
    });
  }

  /**
   * pulse（兔械同调）：暖橙脉冲——双层环形扩张体（外环 + 内环，同心旋转）
   */
  private spawnPulseShell(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    const g = new THREE.Group();
    g.position.set(x, y + 0.4, z);
    // 外环：半径 ≈ 角色身高 0.6×
    const outerMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outer = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 8, 48), outerMat);
    g.add(outer);
    // 内环（细，反向色）
    const innerMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 8, 32), innerMat);
    inner.rotation.x = Math.PI / 2;
    g.add(inner);
    // 中心光球
    const orbMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), orbMat);
    g.add(orb);

    this.scene.add(g);
    this.active.push({
      group: g,
      meshes: [outer, inner, orb],
      materials: [outerMat, innerMat, orbMat],
      life: 0,
      maxLife: 1.4,
      spin: 1.6,
      popIn: 1,
      baseScale: scale,
    });
  }
}

/** 弹出曲线：开始略小于 0（拉回），到 1 时回弹略超 1，再回 1 */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
