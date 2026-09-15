# 战斗特效与打击感规范（P2 打击感升级）

**日期**：2026-09-05（初版）；**2026-09-06 加入文档索引**
**范围**：`src/game/VfxPool.ts`、`src/game/combatSkillFx.ts`、`src/game/Combat3D.ts`、`src/audio/combatSfx.ts`、`src/game/textureUtils.ts`、`src/style.css`
**目标**：让每个角色的技能在战斗中"被看见 + 被听见"，把"打中无反应/全技能同模板"的现状改成"形态可辨 + 打击有顿挫 + 移动端可控"。
**姊妹文档**：
- 美术进包标准：[asset-ship-pipeline.md](./asset-ship-pipeline.md)（本规范新增的所有素材均为**程序生成**，**不影响 SHIP_POLICY_VERSION`2026-08-23-p2-mobile-v2`**）
- 移动端性能优化基线：[performance-optimization-2026-08-29.md](./performance-optimization-2026-08-29.md)（移动 low 端粒子预算上限 `maxVfxParticles = 20`、关闭 Bloom、`maxPixelRatio = 1.5`、关闭 `ambientDust`，本规范必须遵守）
- 战斗逻辑测试覆盖：[scripts/verify-combat-logic.mjs](../scripts/verify-combat-logic.mjs)（`npm run verify-combat` 必须持续通过）

---

## 一、设计原则

1. **零外部素材**：本规范下所有新增贴图均为 Canvas2D 程序生成。**不增加任何 png/webm/mp4 资源**，**不动 `SHIP_POLICY_VERSION`，不影响 `dist/tex/` 体积**。
2. **池化 Sprite**：`VfxPool` 沿用既有对象池（最大 40 Sprite 移动端 `low` 端），新效果通过 `acquire(tpl, critical)` 复用池位；超限时主动挤出最旧 Sprite。
3. **粒度可控**：每个 `ActiveVfx` 新增 `vrot`（自转）、`rot0`（初始旋转）、`ease`（淡出曲线 linear/easeOut/easeIn）和"扩张型 scaleDecay（负值）"，让环波从中心向外自然扩散。
4. **时序分层**：打击感 = 视觉（环波/火花/碎片/光柱）+ 屏幕冲击（相机 shake + FOV 推近 + 短促减速 hit-stop）+ HUD 受击反应（vignette / 全屏闪）+ 音效（WebAudio 合成）。任何一类缺失都会让命中"扁平"。
5. **移动端优先**：所有 audio 走 `MAX_VOICES = 12` 限流，命中/技能音效有音质分级，移动端低音优先；视觉上 key effect 必须立刻出现（≤1 帧），不能依赖连续多帧才能看出"打中了"。

---

## 二、架构总览

```
            触发点（Combat3D）
                    │
        ┌───────────┼─────────────┐
        ▼           ▼             ▼
    VfxPool     combatSfx      HUD/CSS
   (3D 视觉)    (WebAudio)    (vignette / banner)
        │           │             │
        │           │             │
   ┌────┴────┐      │        combat-vignette
   │         │      │        combat-crit-flash
   │      Active     │        combat-skill-banner-v2
   │      Vfx        │
   │         │       │
   │   ┌─────┴──────┴─┐
   │   │  textureUtils │
   │   │  (程序生成)   │
   │   └───────────────┘
   │
   └─ Combat3D.triggerScreenShake({
        shake, intensity, fov, hitLagSeconds
      })
```

**调用边界**：
- 任何"命中/击杀/技能触发/受击"事件都走 `Combat3D` 中的同质化 API（`triggerScreenShake` / `triggerVignette` / `triggerCritFlash` / `showSkillBanner`），**不要**在调用处再拼一遍屏幕冲击参数。
- `VfxPool.spawn*` 方法幂等且对池满 silent-noop，调用方无须判空。
- `combatSfx.play*` 走统一节流：同帧内多次播放自动丢弃（`MAX_VOICES = 12`），**不要**再在外层加 debounce。

---

## 三、贴图（程序生成）

### 3.1 `src/game/textureUtils.ts` 新增

| 贴图 | 函数 | 尺寸 | 用途 |
|------|------|------|------|
| 环波 | `createShockRingTexture(color)` | 256×64 | 命中 / 技能"震源" |
| 能量弧线 | `createEnergyArcTexture(color)` | 128×128 | 开火尾焰 / 翠翼连闪 |
| 竖直拖尾 | `createTrailTexture(color)` | 32×128 | 弹幕 / 贯穿残影（备用，暂未启用） |
| 方形碎片 | `createShardTexture(color)` | 64×64 | 击杀爆炸 / 锻渣雨幕 |
| 六角冰晶 | `createFrostTexture(color)` | 96×96 | 夜爪撕裂 / 冰华护壳 |
| 竖向闪电 | `createLightningTexture(color)` | 24×256 | 光轮裁决 |

### 3.2 缓存策略

`VfxPool` 内 `textureCache` 按 `key:color:mapKind:intensity` 去重，**同色同类型贴图全局只画一次 Canvas**。冷启动一次纹理生成约 6 张（环波 / 能量弧线 / 方形碎片 / 六角冰晶 / 竖向闪电 + 原有 spark/glow）。**战斗中不再触发 Canvas 绘制**。

---

## 四、特效原语（`VfxPool` 新增 API）

所有方法签名稳定，对池满 silent-noop。

### 4.1 环波 / 冲击

```ts
spawnShockRing(x, y, z, color, radius = 2.4, life = 0.32)
spawnShockRingStack(x, y, z, primary, accent) // 双层回响
spawnHeavyKillBurst(x, y, z, color)             // 巨型击杀组合（双环 + 6 碎片 + 4 火花）
```

### 4.2 碎片 / 火花

```ts
spawnImpactSparks(x, y, z, color, count = 6)  // 受重力的弧形火花（受 gy = -8 下落）
spawnShards(x, y, z, color, count = 4)        // 贴地翻滚的方形碎片（gy = -7 + 自转）
```

### 4.3 冰 / 闪电

```ts
spawnFrostShards(x, y, z, color, count = 5)  // 六角冰晶，旋转漂浮，2.5s 长停留
spawnLightningBolt(x, y, z, color, length = 8) // 竖向闪电，160ms 显形
```

### 4.4 尾焰 / 光柱

```ts
spawnEnergyArc(x, y, z, color, length = 1.6, dirZ = 1) // 沿 dirZ 方向的能量弧
spawnLightPillar(x, y, z, color, height = 4, life = 0.4) // 上升光柱
```

### 4.5 既有 API 强化

| 方法 | 旧实现 | 新实现 |
|------|--------|--------|
| `spawnHit` | 单一发光点 + 收缩 | 加 0.18s ease-out，伴随敌人 spawnShockRing + spawnImpactSparks 在 Combat3D 侧调用 |
| `spawnKillBurst` | 8/14 个粒子云 | 自动叠 `spawnShockRingStack` + `spawnShards` |
| `spawnIronRainBeam` | 单一光柱 | 自动叠落地环波 + 5 火花 |
| `spawnSkillBurst` | 中心 glow + 6 spark | 自动叠环波 + accent 色环 |
| `spawnMuzzle` | 单一发光点 | 同时 `spawnEnergyArc`，形成开火尾焰 |

### 4.6 ActiveVfx 扩展字段（向后兼容）

| 字段 | 默认 | 说明 |
|------|------|------|
| `vrot?` | 0 | 弧形 / 碎片自转（弧度/秒）|
| `rot0?` | 0 | 初始旋转弧度 |
| `ease?` | 'linear' | 'linear' / 'easeOut' / 'easeIn' 三种淡出曲线 |
| `scaleDecay` 负值 | — | 扩张型（如环波从 0 张到 radius）|

旧 push 点不传这三个字段，行为保持原状。

---

## 五、技能形状语言（`combatSkillFx.ts`）

每个 `SkillFxDef` 现在携带完整视觉信息：

```ts
{
  id: CharacterSkillId;
  name: string;          // 旧字段
  color: string;         // 主色（环波/spark 主源）
  accentColor: string;   // 副色（叠层环波/中心高亮）
  pulseInterval: number; // 周期光环触发间隔（0=无周期）
  pulseLabel: string;    // 状态栏文字
  bannerTitle: string;   // 横幅标题（真实可见，旧实现为空）
  bannerDetail: string;  // 横幅详情
  shapeKind: SkillShape; // 'frost' | 'spark' | 'pierce' | 'rain' | 'shield' | 'judgment' | 'pulse'
  bannerColor: string;   // 横幅配色（CSS 变量）
}
```

### 5.1 7 个技能形状速查

| 技能 ID | 中文名 | shape | 主色 | 关键元素 |
|---------|--------|-------|------|---------|
| `frost_overload` | 夜爪撕裂 | `frost` | `#5ee7ff` | 主爆发 + 护盾脉冲 + 6 冰晶 + 双环波 |
| `resonance_burst` | 翠翼连闪 | `spark` | `#7CFF4A` | 三发 muzzle + 主爆发 + 弧线尾焰 + 上升光柱 |
| `sand_pierce` | 绯尾贯穿 | `pierce` | `#ff5e8a` | 双段 pierce trail + 主爆发 + 5 火花 + 双环波 |
| `iron_rain` | 锻渣雨幕 | `rain` | `#ff8840` | 主爆发 + 4 碎片 + 双环波 + 落地光柱（含环波/火花）|
| `shard_shell` | 冰华护壳 | `shield` | `#b8e0ff` | 护盾脉冲 + 主爆发 + 8 冰晶 + 蓝白光柱 |
| `stellar_judgment` | 光轮裁决 | `judgment` | `#ffd54f` | 主爆发 + 铁雨柱（含环波/火花）+ 6 单位闪电 + 双环波 + **重型击杀** |
| `outer_pulse` | 兔械同调 | `pulse` | `#ff9a4a` | 护盾脉冲 + 主爆发 + 暖光柱 + 4 火花 |

> 角色 → 技能的映射在 `src/data/characters.ts`（每条 `skillId` 字段），修改技能形状不需要改角色数据。

### 5.2 何时触发

- **入场宣告**（`announceSkills`）：开局延迟 0/420/840ms 播放入场特效 + 横幅 + SFX。
- **周期脉冲**（`updateSkillPulses`）：`pulseInterval > 0` 的技能（夜爪撕裂 / 冰华护壳 / 光轮裁决 / 兔械同调）每隔 N 秒再触发一次。脉冲同时调用 `showSkillBanner` + `playSkillSfx`。
- **即时触发**（命中/击杀/开火过程中）：
  - 翠翼连闪：连击达成 3 杀时，`fire()` 内同步触发
  - 绯尾贯穿：弹幕穿透判定通过时同步触发
  - 锻渣雨幕：每 10s 周期触发 `triggerIronRain()`

---

## 六、打击感时序（核心）

### 6.1 `Combat3D.triggerScreenShake(opts)` 单一入口

| 字段 | 类型 | 默认 | 含义 |
|------|------|------|------|
| `shake` | number | 必填 | 注入 `shakeAmount`，相机抖动的强度衰减时间约 0.16s |
| `intensity?` | number | 0 | 注入 `shakeIntensity`，重型震屏的"叠加层"（持续更长，z 轴也参与） |
| `fov?` | number | 0 | 注入 `fovPulse`，FOV 推近 4.5° 倍率，1.4s 衰减 |
| `hitLagSeconds?` | number | 0 | 注入 `hitLag`，短促减速（hit-stop）；`Math.min(0.6 * delta, hitLag)` 单帧上限 |

### 6.2 命中级别 → 时序

| 级别 | 视觉 | shake / intensity / fov | hitLag | 音效 |
|------|------|------------------------|--------|------|
| 普通命中 | spawnHit + 蓝色环波 + 4 火花 | 0.08 / 0 / 0 | 0 | `playHitSfx(false)` |
| Boss/暴击命中 | spawnHit + 金环 + 白环 + 4 红火花 + 击退 0.04~0.06 | 0.16 / 0.35 / 0.32 | 0.04~0.07 | `playHitSfx(true)` |
| 普通击杀 | spawnKillBurst（含环波 + 碎片自动叠层）| 0.14 / 0.2 / 0.18 | 0.02 | `playKillSfx(false)` |
| Boss 击杀 | spawnHeavyKillBurst（金色双环 + 6 碎片 + 4 白火花）| 0.32 / 0.7 / 0.6 | 0.08 | `playKillSfx(true)` + `triggerCritFlash()` |
| 光轮裁决 | 双环波 + 闪电 + 铁雨（自带环波/火花）| 0.2 / 0.45 / 0.45 | 0.05 | `playSkillSfx('stellar_judgment')` + 全屏白光 |
| 锻渣雨幕 | 主爆发 + 4 碎片 + 多列铁雨 | 0.18 / 0.35 / 0.25 | 0.03 | `playSkillSfx('iron_rain')` |
| 受击（无护盾）| 角色闪红 + 红色 vignette | — | — | `playHurtSfx()` + `triggerVignette()` |
| 受击（护盾抵消）| 护盾脉冲 | — | — | `playShieldSfx()` |

### 6.3 击退位移

所有被命中的敌人在 `checkHits()` 内 z 轴推进 0.06~0.12（普通）/ 0.04（Boss），让"打中了"有体感。**位移小于本帧 ~0.01 单位，对游戏判定（碰撞）无影响**。

### 6.4 HUD 层（CSS）

| 元素 | CSS 类 | 触发 |
|------|--------|------|
| 技能横幅 | `.combat-skill-banner-v2` + `.is-show` | `showSkillBanner()` |
| 受击红色 vignette | `.combat-vignette` + `.is-show` | `triggerVignette()` |
| 暴击 / Boss 击杀全屏闪 | `.combat-crit-flash` + `.is-show` | `triggerCritFlash()` |
| 根级震动 | `#game-root.combat-tremor` | 当前为预留类，备用 |

CSS 动画统一 1.4s 入场 + 240ms vignette / 1.4s banner；`is-show` 移除后动画立刻倒放消失。**所有动画用 CSS transform / opacity / filter，不触发 layout 重排**。

---

## 七、WebAudio 战斗音效（`src/audio/combatSfx.ts`）

### 7.1 设计

- **零外部素材**：全部使用 OscillatorNode + BufferSource(noise) + BiquadFilterNode + DynamicsCompressorNode 实时合成。
- **节流**：全局 `MAX_VOICES = 12`，超限自动丢弃本次合成（不排队）。
- **主总线压缩**：`DynamicsCompressorNode`（threshold -18dB / ratio 4:1）防止 7 路同帧叠加爆音。
- **解锁机制**：与现有 `uiSound.ts` 风格一致，依赖首次手势 resume AudioContext。在 `Combat3D.start()` 内调用 `unlockCombatAudio()`（内含 0.01s 静默 ping 预热）。

### 7.2 voice 函数

| 函数 | 用途 | 主要音色 |
|------|------|---------|
| `unlockCombatAudio()` | AudioContext 解锁 | 880Hz 0.01s 静默 ping |
| `setCombatSfxEnabled(on)` | 全局静音开关 | — |
| `playFireSfx(seed?)` | 玩家开火 | 720Hz square + 锯齿去谐 + 高频白噪 60ms |
| `playHitSfx(crit?)` | 命中（普通/暴击）| 普通 540Hz / 暴击 880Hz sawtooth + 去谐 + 440Hz sub |
| `playKillSfx(boss?)` | 击杀 | 普通 360Hz / Boss 180Hz sawtooth + 噪声尾音 |
| `playShieldSfx()` | 护盾抵消 | 660Hz sine ping + 1320Hz 二次谐波 |
| `playHurtSfx()` | 我方受击 | 220Hz sawtooth 颤抖 + 低频白噪 |
| `playSkillSfx(skillId)` | 7 个技能独立音色 | 见下表 |

### 7.3 技能音色表

| 技能 ID | 关键音色 |
|---------|---------|
| `frost_overload` | 220Hz sine 0.4s + 880Hz reveal |
| `resonance_burst` | 880Hz square + 1760Hz 双谐 |
| `sand_pierce` | 1200Hz sawtooth 短促 + 240Hz 低 tail |
| `iron_rain` | 140Hz sawtooth 0.32s + 噪声 |
| `shard_shell` | 620Hz sine + 1240Hz 双谐 |
| `stellar_judgment` | 330Hz sawtooth 上升 + 90Hz sub + 1320Hz 雷击 + 5400Hz→600Hz 噪声 |
| `outer_pulse` | 440Hz triangle + 880Hz 双谐 |

### 7.4 兼容性

- 旧 WebView（无 WebAudio）：`getCtx()` 返回 null，所有 `play*` 静默 no-op；不抛错。
- 静音设备：用户系统级静音后，所有声音自动不再输出（AudioContext 仍在跑但不连接 destination 之外的扬声器）。

---

## 八、性能预算

**两档画质、两套预算**（参考 [combatQuality.ts](../src/game/combatQuality.ts) + [performance-optimization-2026-08-29.md](./performance-optimization-2026-08-29.md)）：

| 配置 | `maxVfxParticles` | `maxPixelRatio` | `bloomEnabled` | `ambientDust` |
|------|-------------------|-----------------|----------------|---------------|
| Desktop medium | 40 | 2.2 | false | 24 |
| Mobile low（本规范真正关心的）| **20** | **1.5** | **false** | **0** |

> ⚠️ 移动端实际命中 **20 sprite** 这个硬上限。所有"重型"技能组合必须在这个预算内完成。

| 项目 | 预算 | 移动 low 端实测 |
|------|------|-----------------|
| 贴图冷启动 Canvas 绘制 | ≤ 8 张 | 6 张（环波/弧线/碎片/冰晶/闪电 + spark/glow）|
| `VfxPool` 池大小 | 40 (desktop) / **20** (mobile low) | 同 |
| 单次 `spawn*` 平均 sprite 数 | ≤ 8 | 普通击杀 14、Heavy Kill Burst 14 |
| 单帧同技能最大 sprite 数（瞬时）| ≤ 22 (desktop) / **≤ 18** (mobile low) | Boss Heavy Kill Burst：14（双环 + 6 碎片 + 4 火花）|
| WebAudio voice 并发 | ≤ 12 | `MAX_VOICES = 12` |
| 新增 CSS 动画 | 仅 transform/opacity/filter | ✓ |
| 移动端 fps 影响 | < 5% | 经验值（需 `verify-mobile-ui` 回归）|

### 8.1 移动 low 端最危险场景

**Boss 击杀瞬时帧（mobile low）**：

```
Heavy Kill Burst                  = 14 sprite
  ├─ spawnShockRing (主色)        = 1
  ├─ spawnShockRing (副色)        = 1
  ├─ spawnShards × 6              = 6
  └─ spawnImpactSparks × 6        = 6   ← 实际复用主色火花
+ 命中环波（checkHits 残留）      = 2 (主+副)
+ 受击火花                        = 4
─────────────────────────────────────────
合计                              ≈ 18 ~ 20   ← 逼近上限
```

### 8.2 关键约束

1. **`acquire(critical = true)` 会按"最早活跃"策略挤掉旧 sprite**（`VfxPool` 已有逻辑）。这是 low 端不掉帧的核心保险，但**也是 Boss 击杀上同时砍掉旧火花可见性的副作用**——属于设计内权衡。
2. **严禁**继续在 `spawnHeavyKillBurst` 内增加 sprite 数；如果要增加强度，只能改单个 sprite 的 `scale / lifetime / vrot / ease`。
3. **移动端 low 端** `maxPixelRatio = 1.5` + 关闭 Bloom + 关闭 ambientDust（已设）三者配合本规范的 sprite 池上限，移动端 60fps 仍然可达。
4. **若 future 检测到 mobile-low 掉帧**，本规范预留以下降级路径（**未启用**）：
   - `spawnHeavyKillBurst` 减成 `spawnShards(count = 4)` 和 `spawnImpactSparks(count = 4)`
   - 光轮裁决的 6 道闪电减到 3 道
   - 翠翼连闪三发 muzzle 减成 2 发
   触发条件：`avgFrameMs > 18ms` 持续 3 秒，写入 `localStorage.ns.combatQualityOverride`。

### 8.3 为什么 desktop / medium 是 40 但 mobile low 是 20

`combatQuality.ts` 默认 `maxVfxParticles: 40`，但 [performance-optimization-2026-08-29.md](./performance-optimization-2026-08-29.md) 把 low 档下放到 **20** 来对冲 GPU 填充率。两个值都是**真实生效配置**，本规范在设计 sprite 数时按**两者中更紧（20）**为准，避免上线后才发现 mobile low 端掉帧。

---

## 九、验收 / 回归

### 9.1 必须通过的检查

```bash
# 类型检查
npx tsc --noEmit                                       # 0 errors

# 资源管线（不应当影响本规范的产物）
npm run assets:audit                                   # = verify-ship-gate + verify-ship-p2

# 战斗逻辑（包含命中/击杀/技能/受击回归）
npm run verify-combat                                  # = verify-combat-logic.mjs

# 构建
npx vite build                                         # 6.x s
```

> 注：`verify-layout` / `verify-character-scale` 启动期会因 `WastelandEnvironment.ts` / `Combat3D.ts` 内的 bare-specifier import（`combatThemes` / `characters`）抛 `ERR_MODULE_NOT_FOUND`，这是 verifier 在 `--experimental-strip-types` 下的环境问题，**与本次 VFX 改动无关**。如需运行，临时改为 `import x from '../src/.../x.ts'` 即可。

### 9.2 手动验证清单（每次发布前）

- [ ] 进任意关卡，**普通命中**有蓝色环波 + 4 火花 + 轻微击退
- [ ] **Boss 战**第一发命中金环 + 白环 + 红色火花 + 屏幕短暂减速（hit-stop）
- [ ] **Boss 击杀**出现金色双环 + 6 碎片 + 全屏闪 + 重型震屏
- [ ] **夜爪撕裂**触发：主爆发 + 6 冰晶 + 横幅"全场减速 42%"
- [ ] **翠翼连闪**触发（连击 3 杀）：三发绿光 + 弧线尾焰 + 横幅 + 屏冲击
- [ ] **绯尾贯穿**触发（穿透时）：双段粉色残影 + 横幅
- [ ] **锻渣雨幕**触发：每 10s 一次多列橙色光柱 + 落地环波
- [ ] **冰华护壳**触发：六角冰晶 + 蓝白光柱
- [ ] **光轮裁决**触发（击杀 boss / 满血 boss）：金色双环 + 闪电 + 雷雨 + 全屏闪
- [ ] **兔械同调**触发：暖光柱 + 橙红脉冲
- [ ] 受击时**有护盾** → 金属 ping + 护盾脉冲
- [ ] 受击时**无护盾** → 低频颤抖 + 红色 vignette
- [ ] 关闭系统音量后，所有音效消失（无报错）

### 9.3 已知非目标

- 不在本规范内：3D 模型替换、新美术资源、UI 整体改版、Boss 阶段切换特效、武器开火动画（这些需要单独 spec）。
- 不在本规范内：3D 模型击杀粉碎（mesh explode），目前仍然走 sprite 残留 + 渐隐。
- 不在本规范内：触屏震动（Vibration API）；等移动端测试稳定后单独启用。

---

## 十、变更履历

| 日期 | 内容 | 作者 |
|------|------|------|
| 2026-09-05 | 首次落档：纹理 / VfxPool / combatSkillFx / combatSfx / Combat3D / CSS 全套 | Cursor |

---

## 附录 A：每个技能对应的 VFX 拼装清单

```
frost_overload:
  spawnSkillBurst(x, y, z, '#5ee7ff', 2.0)
  + spawnShieldPulse(x, y, z, '#b8e0ff')
  + spawnFrostShards(x, y+0.3, z, '#b8e0ff', 6)
  + spawnShockRingStack(x, y+0.2, z, '#5ee7ff', '#ffffff')

resonance_burst:
  spawnTripleFlash(camera, x, y, z)            // 3 sprites
  + spawnSkillBurst(x, y, z, '#7CFF4A', 1.4)
  + spawnEnergyArc(x, y, z-0.2, '#aaff66', 2.0)
  + spawnLightPillar(x, y, z-0.3, '#7CFF4A', 3.0, 0.3)

sand_pierce:
  spawnPierceTrail(x, y, z)                    // 长条 sprite
  + spawnPierceTrail(x, y, z-0.6)              // 双段
  + spawnSkillBurst(x, y, z-0.5, '#ff5e8a', 1.0)
  + spawnImpactSparks(x, y+0.2, z, '#ff5e8a', 5)
  + spawnShockRingStack(x, y+0.2, z, '#ff5e8a', '#ffaaca')

iron_rain:
  spawnSkillBurst(x, y, z, '#ff8840', 1.5)
  + spawnShards(x, y+0.2, z, '#ff5a18', 4)
  + spawnShockRingStack(x, y+0.2, z, '#ffaa50', '#ffe0a0')
  // 每个目标额外 spawnIronRainBeam（自带环波+火花）

shard_shell:
  spawnShieldPulse(x, y, z, '#b8e0ff')
  + spawnSkillBurst(x, y, z, '#d9f4ff', 1.2)
  + spawnFrostShards(x, y+0.6, z, '#b8e0ff', 8)
  + spawnLightPillar(x, y, z, '#d9f4ff', 2.4, 0.4)

stellar_judgment:
  p = target ?? { x, y, z }
  spawnSkillBurst(p.x, p.y, p.z, '#ffd54f', 2.4)
  + spawnIronRainBeam(p.x, p.z, p.y - 2.8, '#ffd54f')
  + spawnLightningBolt(p.x, p.y + 4, p.z, '#fff6c0', 6)
  + spawnShockRingStack(p.x, p.y-2.6, p.z, '#ffd54f', '#ffffff')
  // 击杀走 spawnHeavyKillBurst + 全屏闪 + killSfx(true)

outer_pulse:
  spawnShieldPulse(x, y, z, '#ff9a4a')
  + spawnSkillBurst(x, y, z, '#ffcf75', 1.4)
  + spawnLightPillar(x, y, z, '#ffcf75', 2.8, 0.4)
  + spawnImpactSparks(x, y+0.2, z, '#ff9a4a', 4)
```

## 附录 B：被遗弃的旧 API

为保持内部清洁，下列 API 在本规范内不再使用，但保留以备第三方引用：

```ts
// VfxPool 旧入口，仍可用但新代码请用 spawnSkillEffect(skillId, ...)
vfx.spawnSkillBurst(x, y, z, color, scale);            // 基础爆发点
vfx.spawnTripleFlash(camera, x, y, z);                  // 仅用于 resonance_burst 复用
vfx.spawnPierceTrail(x, y, z);                          // 单段穿透（仍可用）
vfx.spawnShieldPulse(x, y, z, color);                  // 护盾扩散
vfx.spawnKillBurst(x, y, z, boss);                      // 普通击杀（已自动叠环波/碎片）
vfx.spawnHit(x, y, z, boss);                            // 命中（已加 ease-out）
vfx.spawnMuzzle(camera, origin, color?);                // 开火（已加弧线尾焰）

// Combat3D 旧字段，已被 triggerScreenShake 替代
combat.shakeAmount   // 仍保留但请用 triggerScreenShake
combat.fovPulse      // 同上
```

`VfxPool.spawnSkillFxLegacy` 是 `spawnSkillEffect` 的别名，仅供历史调用兼容。
